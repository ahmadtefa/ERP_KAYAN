import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  QuotationEventType,
  QuotationStatus,
} from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import {
  allocateDocumentDiscount,
  assertDiscountLimit,
  DiscountError,
  effectiveDiscountPercent,
  ResolvedDiscount,
  resolveDiscount,
} from '../../common/pricing/discount';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanySettingsService } from '../../common/settings/company-settings.module';
import { DocumentNumberService } from '../accounting/document-number.service';
import { SalesInvoicesService } from './sales-invoices.service';
import {
  CreateQuotationDto,
  ListQuotationsDto,
  QuotationTableDto,
  UpdateQuotationDto,
} from './dto/quotation.dto';
import {
  COLUMN_LABELS,
  columnLabel,
  normalizeColumns,
  QuotationColumn,
  standardColumns,
} from './quotation-columns';

const MONEY_SCALE = 4;
const RATE_SCALE = 4;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const QUOTATION_INCLUDE = {
  customer: { select: { id: true, code: true, nameEn: true, nameAr: true, phone: true, email: true, taxNumber: true, address: true } },
  tables: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      lines: {
        orderBy: { lineNumber: 'asc' as const },
        include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } },
      },
    },
  },
  events: { orderBy: { createdAt: 'desc' as const } },
  convertedInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, status: true } },
} satisfies Prisma.QuotationInclude;

type QuotationWithRelations = Prisma.QuotationGetPayload<{ include: typeof QUOTATION_INCLUDE }>;

interface PreparedQuotationLine {
  lineNumber: number;
  itemId: string | null;
  description: string;
  countryOfOrigin: string | null;
  unit: string | null;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
}

interface PreparedQuotationTable {
  title: string;
  sortOrder: number;
  discount: ResolvedDiscount;
  subTotal: Prisma.Decimal;
  netTotal: Prisma.Decimal;
  lines: PreparedQuotationLine[];
}

interface PreparedQuotation {
  tables: PreparedQuotationTable[];
  documentDiscount: ResolvedDiscount;
  subTotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
}

/// Quotations: priced offers that are deliberately not invoices.
///
/// Nothing in this service writes a journal entry, issues stock or touches a
/// customer balance. The only path from a quotation to the ledger is
/// `convert`, which asks the ordinary invoice service to raise a draft - and
/// posting that draft is still a separate, permissioned act.
@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly settings: CompanySettingsService,
    private readonly invoices: SalesInvoicesService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ lists

  async findAll(companyId: string, query: ListQuotationsDto) {
    await this.expireOverdue(companyId);

    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
    const where: Prisma.QuotationWhereInput = { companyId, deletedAt: null };
    if (query.customerId) where.customerId = query.customerId;
    if (query.status) {
      const status = this.status(query.status);
      if (!status) throw new BadRequestException(`Unknown quotation status "${query.status}"`);
      where.status = status;
    }
    if (query.from || query.to) {
      where.quotationDate = {};
      if (query.from) where.quotationDate.gte = new Date(query.from);
      if (query.to) where.quotationDate.lte = new Date(query.to);
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { quotationNumber: { contains: search, mode: 'insensitive' } },
        { customer: { nameEn: { contains: search, mode: 'insensitive' } } },
        { customer: { nameAr: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.quotation.findMany({
        where,
        orderBy: [{ quotationDate: 'desc' }, { quotationNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: { select: { id: true, code: true, nameEn: true, nameAr: true } },
          _count: { select: { tables: true } },
        },
      }),
      this.prisma.quotation.count({ where }),
    ]);

    return {
      items: items.map((quotation) => ({
        id: quotation.id,
        quotationNumber: quotation.quotationNumber,
        quotationDate: quotation.quotationDate.toISOString().slice(0, 10),
        validUntil: quotation.validUntil?.toISOString().slice(0, 10) ?? null,
        status: quotation.status.toLowerCase(),
        currency: quotation.currency,
        version: quotation.version,
        customer: quotation.customer,
        subject: quotation.subject,
        subTotal: quotation.subTotal.toFixed(MONEY_SCALE),
        discountTotal: quotation.discountTotal.toFixed(MONEY_SCALE),
        totalAmount: quotation.totalAmount.toFixed(MONEY_SCALE),
        tableCount: quotation._count.tables,
        convertedInvoiceId: quotation.convertedInvoiceId,
      })),
      total,
      page,
      pageSize,
    };
  }

  async findOne(companyId: string, id: string) {
    await this.expireOverdue(companyId);
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, companyId, deletedAt: null },
      include: QUOTATION_INCLUDE,
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    return this.toResponse(quotation, true);
  }

  // ----------------------------------------------------------------- create

  async create(
    companyId: string,
    branchId: string | null,
    userId: string,
    dto: CreateQuotationDto,
  ) {
    if (!branchId) {
      throw new BadRequestException('The signed-in user is not assigned to a branch');
    }
    const customer = await this.activeCustomer(companyId, dto.customerId);
    const settings = await this.settings.get(companyId);
    const currency = (dto.currency ?? customer.currency ?? 'EGP').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestException('The currency must be a three-letter code');
    }

    const prepared = await this.prepare(companyId, dto, settings.maxDiscountPercent);

    const created = await this.prisma.$transaction(async (tx) => {
      const quotationNumber = await this.numbers.next(tx, companyId, 'SALES_QUOTATION', 'QT');
      const quotation = await tx.quotation.create({
        data: {
          companyId,
          branchId,
          quotationNumber,
          quotationDate: this.date(dto.quotationDate, 'quotationDate'),
          validUntil: dto.validUntil ? this.date(dto.validUntil, 'validUntil') : null,
          customerId: dto.customerId,
          currency,
          notes: this.text(dto.notes),
          terms: this.text(dto.terms),
          subject: this.text(dto.subject),
          columns: this.columnData(dto.columns) as unknown as Prisma.InputJsonValue,
          discountType: prepared.documentDiscount.type,
          discountPercent: prepared.documentDiscount.percent,
          discountAmount: prepared.documentDiscount.amount,
          subTotal: prepared.subTotal,
          discountTotal: prepared.discountTotal,
          totalAmount: prepared.totalAmount,
          managerName: this.text(dto.managerName) ?? settings.managerName,
          responsibleName: this.text(dto.responsibleName) ?? settings.salesManagerName,
          responsiblePhone: this.text(dto.responsiblePhone) ?? settings.salesManagerPhone,
          // The offer's own switch wins; omitting it keeps the company default.
          showTaxId: dto.showTaxId ?? settings.showTaxIdOnQuotations,
          createdBy: userId,
          updatedBy: userId,
          tables: {
            create: prepared.tables.map((table) => ({
              title: table.title,
              sortOrder: table.sortOrder,
              discountType: table.discount.type,
              discountPercent: table.discount.percent,
              discountAmount: table.discount.amount,
              subTotal: table.subTotal,
              discountTotal: table.discount.amount,
              netTotal: table.netTotal,
              lines: {
                create: table.lines.map((line) => ({
                  lineNumber: line.lineNumber,
                  itemId: line.itemId,
                  description: line.description,
                  countryOfOrigin: line.countryOfOrigin,
                  unit: line.unit,
                  quantity: line.quantity,
                  unitPrice: line.unitPrice,
                  lineTotal: line.lineTotal,
                })),
              },
            })),
          },
        },
      });
      await tx.quotationEvent.create({
        data: {
          quotationId: quotation.id,
          type: QuotationEventType.CREATED,
          toStatus: QuotationStatus.DRAFT,
          userId,
        },
      });
      return quotation;
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'quotations',
      entityId: created.id,
      after: {
        quotationNumber: created.quotationNumber,
        totalAmount: created.totalAmount.toFixed(MONEY_SCALE),
      },
    });
    return this.findOne(companyId, created.id);
  }

  // ----------------------------------------------------------------- update

  async update(
    companyId: string,
    userId: string,
    id: string,
    dto: UpdateQuotationDto,
  ) {
    const quotation = await this.draft(companyId, id);
    const customer = await this.activeCustomer(companyId, dto.customerId);
    const settings = await this.settings.get(companyId);
    const currency = (dto.currency ?? customer.currency ?? quotation.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new BadRequestException('The currency must be a three-letter code');
    }
    const prepared = await this.prepare(companyId, dto, settings.maxDiscountPercent);

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.quotation.updateMany({
        where: { id, companyId, status: QuotationStatus.DRAFT, deletedAt: null },
        data: {
          quotationDate: this.date(dto.quotationDate, 'quotationDate'),
          validUntil: dto.validUntil ? this.date(dto.validUntil, 'validUntil') : null,
          customerId: dto.customerId,
          currency,
          notes: this.text(dto.notes),
          terms: this.text(dto.terms),
          subject: this.text(dto.subject),
          columns: this.columnData(dto.columns) as unknown as Prisma.InputJsonValue,
          discountType: prepared.documentDiscount.type,
          discountPercent: prepared.documentDiscount.percent,
          discountAmount: prepared.documentDiscount.amount,
          subTotal: prepared.subTotal,
          discountTotal: prepared.discountTotal,
          totalAmount: prepared.totalAmount,
          managerName: this.text(dto.managerName),
          responsibleName: this.text(dto.responsibleName),
          responsiblePhone: this.text(dto.responsiblePhone),
          // Only touch the switch when the client sent it; otherwise a partial
          // update would silently reset the offer's own choice.
          ...(dto.showTaxId === undefined ? {} : { showTaxId: dto.showTaxId }),
          updatedBy: userId,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('Only a draft quotation can be edited');
      }

      // The line set is replaced wholesale: it is a draft, and a partial edit
      // that leaves the stored totals describing the old lines would be worse
      // than an explicit replacement.
      await tx.quotationTable.deleteMany({ where: { quotationId: id } });
      for (const table of prepared.tables) {
        await tx.quotationTable.create({
          data: {
            quotationId: id,
            title: table.title,
            sortOrder: table.sortOrder,
            discountType: table.discount.type,
            discountPercent: table.discount.percent,
            discountAmount: table.discount.amount,
            subTotal: table.subTotal,
            discountTotal: table.discount.amount,
            netTotal: table.netTotal,
            lines: {
              create: table.lines.map((line) => ({
                lineNumber: line.lineNumber,
                itemId: line.itemId,
                description: line.description,
                countryOfOrigin: line.countryOfOrigin,
                unit: line.unit,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                lineTotal: line.lineTotal,
              })),
            },
          },
        });
      }
      await tx.quotationEvent.create({
        data: {
          quotationId: id,
          type: QuotationEventType.UPDATED,
          fromStatus: QuotationStatus.DRAFT,
          toStatus: QuotationStatus.DRAFT,
          userId,
        },
      });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'quotations',
      entityId: id,
      before: { totalAmount: quotation.totalAmount.toFixed(MONEY_SCALE) },
      after: { totalAmount: prepared.totalAmount.toFixed(MONEY_SCALE) },
    });
    return this.findOne(companyId, id);
  }

  // -------------------------------------------------------------- lifecycle

  async send(companyId: string, userId: string, id: string, note?: string) {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, companyId, deletedAt: null },
      include: QUOTATION_INCLUDE,
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.status !== QuotationStatus.DRAFT) {
      throw new BadRequestException('Only a draft quotation can be issued');
    }
    const content = await this.snapshotContent(companyId, quotation);
    const now = new Date();
    const changed = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.quotation.updateMany({
        where: { id, companyId, status: QuotationStatus.DRAFT, deletedAt: null },
        data: {
          status: QuotationStatus.SENT,
          issuedAt: now,
          sentAt: now,
          contentSnapshot: content as unknown as Prisma.InputJsonValue,
          snapshotAt: now,
          showTaxId: content.showTaxId,
          updatedBy: userId,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('Only a draft quotation can be issued');
      }
      await tx.quotationEvent.create({
        data: {
          quotationId: id,
          type: QuotationEventType.SENT,
          fromStatus: QuotationStatus.DRAFT,
          toStatus: QuotationStatus.SENT,
          note: this.text(note),
          userId,
        },
      });
      return true;
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'POST',
      entity: 'quotations',
      entityId: id,
      after: { status: QuotationStatus.SENT, quotationNumber: quotation.quotationNumber },
    });
    return changed ? this.findOne(companyId, id) : null;
  }

  async accept(companyId: string, userId: string, id: string, note?: string) {
    return this.decide(companyId, userId, id, QuotationStatus.ACCEPTED, note);
  }

  async reject(companyId: string, userId: string, id: string, note?: string) {
    return this.decide(companyId, userId, id, QuotationStatus.REJECTED, note);
  }

  private async decide(
    companyId: string,
    userId: string,
    id: string,
    outcome: QuotationStatus,
    note?: string,
  ) {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, companyId, deletedAt: null },
      include: QUOTATION_INCLUDE,
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.status === QuotationStatus.CONVERTED) {
      throw new BadRequestException('A converted quotation can no longer change status');
    }
    if (
      quotation.status !== QuotationStatus.DRAFT &&
      quotation.status !== QuotationStatus.SENT
    ) {
      throw new BadRequestException(`This quotation is already ${quotation.status.toLowerCase()}`);
    }

    // An offer that is being accepted or rejected without having been sent is
    // still issued: capture what was agreed, not what the draft says later.
    const snapshot =
      quotation.contentSnapshot ?? ((await this.snapshotContent(companyId, quotation)) as unknown as Prisma.InputJsonValue);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.quotation.updateMany({
        where: {
          id,
          companyId,
          status: { in: [QuotationStatus.DRAFT, QuotationStatus.SENT] },
          deletedAt: null,
        },
        data: {
          status: outcome,
          contentSnapshot: snapshot,
          snapshotAt: quotation.snapshotAt ?? now,
          showTaxId: (snapshot as unknown as { showTaxId?: boolean }).showTaxId ?? quotation.showTaxId,
          issuedAt: quotation.issuedAt ?? now,
          acceptedAt: outcome === QuotationStatus.ACCEPTED ? now : quotation.acceptedAt,
          rejectedAt: outcome === QuotationStatus.REJECTED ? now : quotation.rejectedAt,
          updatedBy: userId,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This quotation changed while the decision was being saved');
      }
      await tx.quotationEvent.create({
        data: {
          quotationId: id,
          type: outcome === QuotationStatus.ACCEPTED ? QuotationEventType.ACCEPTED : QuotationEventType.REJECTED,
          fromStatus: quotation.status,
          toStatus: outcome,
          note: this.text(note),
          userId,
        },
      });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: 'quotations',
      entityId: id,
      after: { status: outcome },
    });
    return this.findOne(companyId, id);
  }

  /// Copies an issued offer into a fresh draft. The original keeps its content
  /// and its status; the new version points back at it.
  async revise(companyId: string, branchId: string | null, userId: string, id: string) {
    if (!branchId) {
      throw new BadRequestException('The signed-in user is not assigned to a branch');
    }
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, companyId, deletedAt: null },
      include: QUOTATION_INCLUDE,
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.status === QuotationStatus.DRAFT) {
      throw new BadRequestException('A draft is edited directly; revision is for issued quotations');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const quotationNumber = await this.numbers.next(tx, companyId, 'SALES_QUOTATION', 'QT');
      const revision = await tx.quotation.create({
        data: {
          companyId,
          branchId: quotation.branchId,
          quotationNumber,
          quotationDate: new Date(),
          validUntil: quotation.validUntil,
          customerId: quotation.customerId,
          currency: quotation.currency,
          version: quotation.version + 1,
          revisionOfId: quotation.id,
          notes: quotation.notes,
          terms: quotation.terms,
          subject: quotation.subject,
          columns: quotation.columns === null ? Prisma.DbNull : (quotation.columns as Prisma.InputJsonValue),
          discountType: quotation.discountType,
          discountPercent: quotation.discountPercent,
          discountAmount: quotation.discountAmount,
          subTotal: quotation.subTotal,
          discountTotal: quotation.discountTotal,
          totalAmount: quotation.totalAmount,
          managerName: quotation.managerName,
          responsibleName: quotation.responsibleName,
          responsiblePhone: quotation.responsiblePhone,
          // A revision continues the same offer, so it keeps the tax-number
          // choice that offer was sent with rather than today's default.
          showTaxId: quotation.showTaxId,
          createdBy: userId,
          updatedBy: userId,
          tables: {
            create: quotation.tables.map((table) => ({
              title: table.title,
              sortOrder: table.sortOrder,
              discountType: table.discountType,
              discountPercent: table.discountPercent,
              discountAmount: table.discountAmount,
              subTotal: table.subTotal,
              discountTotal: table.discountTotal,
              netTotal: table.netTotal,
              lines: {
                create: table.lines.map((line) => ({
                  lineNumber: line.lineNumber,
                  itemId: line.itemId,
                  description: line.description,
                  countryOfOrigin: line.countryOfOrigin,
                  unit: line.unit,
                  quantity: line.quantity,
                  unitPrice: line.unitPrice,
                  lineTotal: line.lineTotal,
                })),
              },
            })),
          },
        },
      });
      await tx.quotationEvent.create({
        data: {
          quotationId: revision.id,
          type: QuotationEventType.CREATED,
          toStatus: QuotationStatus.DRAFT,
          note: `Revision of ${quotation.quotationNumber}`,
          userId,
        },
      });
      await tx.quotationEvent.create({
        data: {
          quotationId: quotation.id,
          type: QuotationEventType.REVISED,
          note: `Revised as ${quotationNumber}`,
          userId,
        },
      });
      return revision;
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'quotations',
      entityId: created.id,
      after: { quotationNumber: created.quotationNumber, revisionOf: quotation.quotationNumber },
    });
    return this.findOne(companyId, created.id);
  }

  async followUp(companyId: string, userId: string, id: string, note?: string) {
    const text = this.text(note);
    if (!text) throw new BadRequestException('Write what was discussed before saving the follow-up');
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    await this.prisma.quotationEvent.create({
      data: {
        quotationId: id,
        type: QuotationEventType.FOLLOW_UP,
        note: text,
        userId,
      },
    });
    return this.findOne(companyId, id);
  }

  async remove(companyId: string, userId: string, id: string) {
    const quotation = await this.draft(companyId, id);
    await this.prisma.quotation.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
    await this.audit.record({
      companyId,
      userId,
      action: 'DELETE',
      entity: 'quotations',
      entityId: id,
      before: { quotationNumber: quotation.quotationNumber },
    });
    return { id, deleted: true };
  }

  // -------------------------------------------------------------- conversion

  /**
   * Turns an accepted offer into a draft sales invoice.
   *
   * The quotation is claimed before the invoice is created, so two people
   * pressing Convert at the same moment cannot both succeed. If the invoice
   * service refuses (a retired customer, a missing item), the claim is put
   * back and the quotation is left exactly as it was.
   *
   * Table discounts become line discounts (their exact allocated share), and
   * the quotation-wide discount becomes the invoice's document discount, so
   * the net the customer accepted is the net the invoice starts from. Tax is
   * then applied by the invoice's own rules - the quotation is a net offer.
   */
  async convert(
    companyId: string,
    branchId: string | null,
    userId: string,
    id: string,
    dto: { invoiceDate?: string; warehouseId?: string; notes?: string } = {},
  ) {
    if (!branchId) {
      throw new BadRequestException('The signed-in user is not assigned to a branch');
    }
    await this.expireOverdue(companyId);
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { tables: { orderBy: { sortOrder: 'asc' }, include: { lines: { orderBy: { lineNumber: 'asc' } } } } },
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.status === QuotationStatus.CONVERTED || quotation.convertedInvoiceId) {
      throw new BadRequestException('This quotation has already been converted to an invoice');
    }
    if (quotation.status !== QuotationStatus.ACCEPTED) {
      throw new BadRequestException(
        'Only an accepted quotation can become an invoice; record the customer decision first',
      );
    }
    if (quotation.tables.length === 0) {
      throw new BadRequestException('This quotation has no lines to convert');
    }

    // Claim it first. The guard on status and convertedInvoiceId is the whole
    // duplicate-conversion defence: exactly one caller can win.
    const claimed = await this.prisma.quotation.updateMany({
      where: {
        id,
        companyId,
        status: QuotationStatus.ACCEPTED,
        convertedInvoiceId: null,
        deletedAt: null,
      },
      data: { status: QuotationStatus.CONVERTED, convertedAt: new Date(), updatedBy: userId },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('This quotation was converted by someone else a moment ago');
    }

    try {
      const lines: Array<{
        itemId?: string;
        description: string;
        quantity: string;
        unitPrice: string;
        discountType: 'AMOUNT';
        discountAmount: string;
      }> = [];

      for (const table of quotation.tables) {
        const tableDiscount = table.discountAmount;
        if (tableDiscount.greaterThan(0)) {
          const shares = allocateDocumentDiscount(
            table.lines.map((line) => line.lineTotal),
            { type: 'AMOUNT', amount: tableDiscount.toFixed(MONEY_SCALE) },
          ).shares;
          table.lines.forEach((line, index) => {
            lines.push({
              itemId: line.itemId ?? undefined,
              description: line.description,
              quantity: line.quantity.toFixed(MONEY_SCALE),
              unitPrice: line.unitPrice.toFixed(MONEY_SCALE),
              discountType: 'AMOUNT',
              discountAmount: shares[index].toFixed(MONEY_SCALE),
            });
          });
        } else {
          for (const line of table.lines) {
            lines.push({
              itemId: line.itemId ?? undefined,
              description: line.description,
              quantity: line.quantity.toFixed(MONEY_SCALE),
              unitPrice: line.unitPrice.toFixed(MONEY_SCALE),
              discountType: 'AMOUNT',
              discountAmount: '0.0000',
            });
          }
        }
      }

      // Free-text lines are allowed on a quotation, and on a sales invoice
      // too; an item-less line is described by its text.
      if (lines.length === 0) throw new BadRequestException('This quotation has no lines to convert');

      const invoice = await this.invoices.create(companyId, branchId, userId, {
        invoiceDate: dto.invoiceDate ? this.date(dto.invoiceDate, 'invoiceDate').toISOString() : new Date().toISOString(),
        customerId: quotation.customerId,
        warehouseId: dto.warehouseId,
        notes:
          this.text(dto.notes) ??
          `From quotation ${quotation.quotationNumber}` +
            (quotation.tables.length
              ? ` — tables: ${quotation.tables.map((table) => table.title).join(' | ')}`
              : ''),
        discountType: quotation.discountType ?? undefined,
        discountPercent: quotation.discountType === 'PERCENT' ? quotation.discountPercent.toFixed(RATE_SCALE) : undefined,
        discountAmount: quotation.discountAmount.toFixed(MONEY_SCALE),
        lines,
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.quotation.update({
          where: { id },
          data: { convertedInvoiceId: invoice.id, convertedAt: new Date(), updatedBy: userId },
        });
        await tx.quotationEvent.create({
          data: {
            quotationId: id,
            type: QuotationEventType.CONVERTED,
            note: `Invoice ${invoice.invoiceNumber}`,
            userId,
          },
        });
      });

      await this.audit.record({
        companyId,
        userId,
        action: 'UPDATE',
        entity: 'quotations',
        entityId: id,
        after: { convertedInvoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
      });
      return {
        quotation: await this.findOne(companyId, id),
        invoice,
        note:
          'The quotation total is before tax. The invoice applies the company tax rules, so its total may be higher.',
      };
    } catch (error) {
      // Put the offer back so the person can fix the cause and try again.
      await this.prisma.quotation.updateMany({
        where: { id, status: QuotationStatus.CONVERTED, convertedInvoiceId: null },
        data: { status: QuotationStatus.ACCEPTED, convertedAt: null },
      });
      throw error;
    }
  }

  // --------------------------------------------------------------- printing

  /** The HTML behind the print preview and the PDF. Uses the snapshot once issued. */
  async printHtml(companyId: string, id: string, lang: 'en' | 'ar', autoPrint = false) {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, companyId, deletedAt: null },
      include: QUOTATION_INCLUDE,
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    const company = await this.companyHeader(companyId);
    const content =
      quotation.status !== QuotationStatus.DRAFT && quotation.contentSnapshot
        ? (quotation.contentSnapshot as unknown as QuotationSnapshot)
        : await this.snapshotContent(companyId, quotation);
    return this.renderHtml(content, company, lang, autoPrint);
  }

  private async companyHeader(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        nameEn: true,
        nameAr: true,
        taxId: true,
        commercialRegistration: true,
        phone: true,
        email: true,
        address: true,
        addressEn: true,
        addressAr: true,
        logoData: true,
        logoMime: true,
        currency: true,
      },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  // ----------------------------------------------------------------- helpers

  private async expireOverdue(companyId: string) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const overdue = await this.prisma.quotation.findMany({
      where: {
        companyId,
        status: QuotationStatus.SENT,
        validUntil: { lt: today },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (overdue.length === 0) return;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.quotation.findMany({
        where: { id: { in: overdue.map((row) => row.id) }, status: QuotationStatus.SENT },
        select: { id: true },
      });
      if (updated.length === 0) return;
      await tx.quotation.updateMany({
        where: { id: { in: updated.map((row) => row.id) }, status: QuotationStatus.SENT },
        data: { status: QuotationStatus.EXPIRED, expiredAt: now },
      });
      await tx.quotationEvent.createMany({
        data: updated.map((row) => ({
          quotationId: row.id,
          type: QuotationEventType.EXPIRED,
          fromStatus: QuotationStatus.SENT,
          toStatus: QuotationStatus.EXPIRED,
        })),
      });
    });
  }

  private async draft(companyId: string, id: string) {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    if (quotation.status !== QuotationStatus.DRAFT) {
      throw new BadRequestException(
        'This quotation has been issued and can no longer be edited. Start a revision instead.',
      );
    }
    return quotation;
  }

  private async activeCustomer(companyId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId, deletedAt: null },
      select: {
        id: true,
        code: true,
        nameEn: true,
        nameAr: true,
        phone: true,
        email: true,
        taxNumber: true,
        address: true,
        isActive: true,
      },
    });
    if (!customer) throw new BadRequestException('The customer does not exist');
    if (!customer.isActive) throw new BadRequestException('The customer is inactive');

    // The offer's currency is the company's unless somebody chose another;
    // there is no per-customer currency column to guess from.
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { currency: true },
    });
    return { ...customer, currency: company?.currency ?? 'EGP' };
  }

  private async prepare(
    companyId: string,
    dto: CreateQuotationDto,
    maximum: string,
  ): Promise<PreparedQuotation> {
    const limit = new Prisma.Decimal(maximum);
    const preparedTables: PreparedQuotationTable[] = [];

    // One query for every item named, rather than one per line.
    const itemIds = [...new Set(
      dto.tables.flatMap((table) => table.lines.map((line) => line.itemId)).filter((id): id is string => !!id),
    )];
    const items = itemIds.length
      ? await this.prisma.item.findMany({
          where: { id: { in: itemIds }, companyId, deletedAt: null },
          select: { id: true, code: true, nameEn: true, nameAr: true, unit: true, salePrice: true, countryOfOrigin: true, isActive: true },
        })
      : [];
    const itemMap = new Map(items.map((item) => [item.id, item]));

    for (const [tableIndex, rawTable] of dto.tables.entries()) {
      const title = rawTable.title.trim();
      if (!title) throw new BadRequestException(`Table ${tableIndex + 1}: give the table a title`);
      const lines: PreparedQuotationLine[] = [];

      for (const [lineIndex, rawLine] of rawTable.lines.entries()) {
        const where = `Table ${tableIndex + 1}, line ${lineIndex + 1}`;
        const quantity = this.positive(rawLine.quantity, `${where}: quantity`);
        const item = rawLine.itemId ? itemMap.get(rawLine.itemId) : null;
        if (rawLine.itemId && !item) {
          throw new BadRequestException(`${where}: the item does not exist`);
        }
        if (item && !item.isActive) {
          throw new BadRequestException(`${where}: the item is inactive`);
        }
        const unitPrice = rawLine.unitPrice === undefined || rawLine.unitPrice === ''
          ? (item?.salePrice ?? new Prisma.Decimal(0))
          : this.nonNegative(rawLine.unitPrice, `${where}: unit price`);
        const description = (rawLine.description ?? '').trim()
          || (item ? `${item.code} ${item.nameEn}` : '');
        if (!description) {
          throw new BadRequestException(`${where}: give either an item or a description`);
        }
        const lineTotal = quantity.mul(unitPrice).toDecimalPlaces(MONEY_SCALE);
        lines.push({
          lineNumber: lineIndex + 1,
          itemId: item?.id ?? null,
          description,
          countryOfOrigin: (rawLine.countryOfOrigin ?? item?.countryOfOrigin ?? '').trim() || null,
          unit: (rawLine.unit ?? item?.unit ?? '').trim() || null,
          quantity,
          unitPrice,
          lineTotal,
        });
      }

      const subTotal = lines.reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0));
      let discount: ResolvedDiscount;
      try {
        discount = resolveDiscount(subTotal, {
          type: rawTable.discountType,
          percent: rawTable.discountPercent,
          amount: rawTable.discountAmount,
        });
        assertDiscountLimit(discount.percent, limit, `Table ${tableIndex + 1}`);
      } catch (error) {
        throw new BadRequestException(this.discountMessage(error, `Table ${tableIndex + 1}`));
      }

      preparedTables.push({
        title,
        sortOrder: tableIndex + 1,
        discount,
        subTotal,
        netTotal: discount.net,
        lines,
      });
    }

    const subTotal = preparedTables.reduce(
      (sum, table) => sum.plus(table.subTotal),
      new Prisma.Decimal(0),
    );
    const tableDiscountTotal = preparedTables.reduce(
      (sum, table) => sum.plus(table.discount.amount),
      new Prisma.Decimal(0),
    );
    const nets = preparedTables.map((table) => table.netTotal);

    let allocation: ReturnType<typeof allocateDocumentDiscount>;
    try {
      allocation = allocateDocumentDiscount(nets, {
        type: dto.discountType,
        percent: dto.discountPercent,
        amount: dto.discountAmount,
      });
      assertDiscountLimit(
        effectiveDiscountPercent(subTotal, tableDiscountTotal.plus(allocation.discount.amount)),
        limit,
        'Quotation',
      );
    } catch (error) {
      throw new BadRequestException(this.discountMessage(error, 'Quotation'));
    }

    const discountTotal = tableDiscountTotal.plus(allocation.discount.amount);
    return {
      tables: preparedTables,
      documentDiscount: allocation.discount,
      subTotal,
      discountTotal,
      totalAmount: subTotal.minus(discountTotal),
    };
  }

  /// The exact content of an issued offer. Built once and stored.
  private async snapshotContent(companyId: string, quotation: QuotationWithRelations): Promise<QuotationSnapshot> {
    const company = await this.companyHeader(companyId);
    return {
      quotationNumber: quotation.quotationNumber,
      quotationDate: quotation.quotationDate.toISOString().slice(0, 10),
      validUntil: quotation.validUntil?.toISOString().slice(0, 10) ?? null,
      currency: quotation.currency,
      version: quotation.version,
      status: quotation.status,
      customer: {
        code: quotation.customer.code,
        nameEn: quotation.customer.nameEn,
        nameAr: quotation.customer.nameAr,
        phone: quotation.customer.phone,
        email: quotation.customer.email,
        taxNumber: quotation.customer.taxNumber,
        address: quotation.customer.address,
      },
      company: {
        nameEn: company.nameEn,
        nameAr: company.nameAr,
        taxId: company.taxId,
        commercialRegistration: company.commercialRegistration,
        phone: company.phone,
        email: company.email,
        address: company.addressEn || company.address,
        addressAr: company.addressAr || company.address,
      },
      // The offer's own switch, not today's company default: an issued offer
      // must keep printing what it printed when it was issued.
      showTaxId: quotation.showTaxId,
      subject: quotation.subject,
      columns: this.columnsOf(quotation.columns),
      managerName: quotation.managerName,
      responsibleName: quotation.responsibleName,
      responsiblePhone: quotation.responsiblePhone,
      notes: quotation.notes,
      terms: quotation.terms,
      discountType: quotation.discountType,
      discountPercent: quotation.discountPercent.toFixed(RATE_SCALE),
      discountAmount: quotation.discountAmount.toFixed(MONEY_SCALE),
      tables: quotation.tables.map((table) => ({
        title: table.title,
        sortOrder: table.sortOrder,
        subTotal: table.subTotal.toFixed(MONEY_SCALE),
        discountPercent: table.discountPercent.toFixed(RATE_SCALE),
        discountAmount: table.discountAmount.toFixed(MONEY_SCALE),
        netTotal: table.netTotal.toFixed(MONEY_SCALE),
        lines: table.lines.map((line) => ({
          itemCode: line.item?.code ?? null,
          description: line.description,
          countryOfOrigin: line.countryOfOrigin,
          unit: line.unit,
          quantity: line.quantity.toFixed(MONEY_SCALE),
          unitPrice: line.unitPrice.toFixed(MONEY_SCALE),
          lineTotal: line.lineTotal.toFixed(MONEY_SCALE),
        })),
      })),
      totals: {
        subTotal: quotation.subTotal.toFixed(MONEY_SCALE),
        discountTotal: quotation.discountTotal.toFixed(MONEY_SCALE),
        totalAmount: quotation.totalAmount.toFixed(MONEY_SCALE),
      },
    };
  }

  private toResponse(quotation: QuotationWithRelations, detail: boolean) {
    const response: Record<string, unknown> = {
      id: quotation.id,
      quotationNumber: quotation.quotationNumber,
      quotationDate: quotation.quotationDate.toISOString().slice(0, 10),
      validUntil: quotation.validUntil?.toISOString().slice(0, 10) ?? null,
      status: quotation.status.toLowerCase(),
      currency: quotation.currency,
      version: quotation.version,
      revisionOfId: quotation.revisionOfId,
      customer: quotation.customer,
      notes: quotation.notes,
      terms: quotation.terms,
      discountType: quotation.discountType,
      discountPercent: quotation.discountPercent.toFixed(RATE_SCALE),
      discountAmount: quotation.discountAmount.toFixed(MONEY_SCALE),
      subTotal: quotation.subTotal.toFixed(MONEY_SCALE),
      discountTotal: quotation.discountTotal.toFixed(MONEY_SCALE),
      totalAmount: quotation.totalAmount.toFixed(MONEY_SCALE),
      managerName: quotation.managerName,
      responsibleName: quotation.responsibleName,
      responsiblePhone: quotation.responsiblePhone,
      showTaxId: quotation.showTaxId,
      subject: quotation.subject,
      columns: this.columnsOf(quotation.columns),
      issuedAt: quotation.issuedAt?.toISOString() ?? null,
      sentAt: quotation.sentAt?.toISOString() ?? null,
      acceptedAt: quotation.acceptedAt?.toISOString() ?? null,
      rejectedAt: quotation.rejectedAt?.toISOString() ?? null,
      expiredAt: quotation.expiredAt?.toISOString() ?? null,
      snapshotAt: quotation.snapshotAt?.toISOString() ?? null,
      convertedInvoiceId: quotation.convertedInvoiceId,
      convertedAt: quotation.convertedAt?.toISOString() ?? null,
      convertedInvoice: quotation.convertedInvoice
        ? {
            id: quotation.convertedInvoice.id,
            invoiceNumber: quotation.convertedInvoice.invoiceNumber,
            totalAmount: quotation.convertedInvoice.totalAmount.toFixed(MONEY_SCALE),
            status: quotation.convertedInvoice.status.toLowerCase(),
          }
        : null,
      canEdit: quotation.status === QuotationStatus.DRAFT,
      canConvert: quotation.status === QuotationStatus.ACCEPTED && !quotation.convertedInvoiceId,
    };
    if (detail) {
      response.tables = quotation.tables.map((table) => ({
        id: table.id,
        title: table.title,
        sortOrder: table.sortOrder,
        discountType: table.discountType,
        discountPercent: table.discountPercent.toFixed(RATE_SCALE),
        discountAmount: table.discountAmount.toFixed(MONEY_SCALE),
        subTotal: table.subTotal.toFixed(MONEY_SCALE),
        discountTotal: table.discountTotal.toFixed(MONEY_SCALE),
        netTotal: table.netTotal.toFixed(MONEY_SCALE),
        lines: table.lines.map((line) => ({
          id: line.id,
          lineNumber: line.lineNumber,
          itemId: line.itemId,
          itemCode: line.item?.code ?? null,
          itemNameEn: line.item?.nameEn ?? null,
          itemNameAr: line.item?.nameAr ?? null,
          description: line.description,
          countryOfOrigin: line.countryOfOrigin,
          unit: line.unit,
          quantity: line.quantity.toFixed(MONEY_SCALE),
          unitPrice: line.unitPrice.toFixed(MONEY_SCALE),
          lineTotal: line.lineTotal.toFixed(MONEY_SCALE),
        })),
      }));
      response.events = quotation.events.map((event) => ({
        id: event.id,
        type: event.type.toLowerCase(),
        fromStatus: event.fromStatus?.toLowerCase() ?? null,
        toStatus: event.toStatus?.toLowerCase() ?? null,
        note: event.note,
        userId: event.userId,
        createdAt: event.createdAt.toISOString(),
      }));
      response.contentSnapshot = quotation.contentSnapshot ?? null;
    }
    return response;
  }

  private renderHtml(
    content: QuotationSnapshot,
    company: Awaited<ReturnType<QuotationsService['companyHeader']>>,
    lang: 'en' | 'ar',
    autoPrint: boolean,
  ): string {
    const rtl = lang === 'ar';
    const L = (en: string, ar: string) => (rtl ? ar : en);
    const money = (value: string) =>
      `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${content.currency}`;
    const logo = company.logoData?.length
      ? `data:${company.logoMime ?? 'image/png'};base64,${Buffer.from(company.logoData).toString('base64')}`
      : null;
    const companyName = rtl
      ? content.company.nameAr || content.company.nameEn
      : content.company.nameEn || content.company.nameAr;
    const companyAddress = rtl
      ? content.company.addressAr || content.company.address
      : content.company.address || content.company.addressAr;
    const customerName = rtl
      ? content.customer.nameAr || content.customer.nameEn
      : content.customer.nameEn || content.customer.nameAr;

    const details = [
      content.showTaxId && content.company.taxId
        ? `<div><span>${L('Tax registration', 'الرقم الضريبي')}</span><b>${this.escape(content.company.taxId)}</b></div>`
        : '',
      content.company.commercialRegistration
        ? `<div><span>${L('Commercial registration', 'السجل التجاري')}</span><b>${this.escape(content.company.commercialRegistration)}</b></div>`
        : '',
      content.company.phone ? `<div><span>${L('Phone', 'الهاتف')}</span><b>${this.escape(content.company.phone)}</b></div>` : '',
      content.company.email ? `<div><span>${L('Email', 'البريد الإلكتروني')}</span><b>${this.escape(content.company.email)}</b></div>` : '',
    ].filter(Boolean).join('');

    const customerDetails = [
      content.customer.phone ? `<div><span>${L('Phone', 'الهاتف')}</span><b>${this.escape(content.customer.phone)}</b></div>` : '',
      content.customer.email ? `<div><span>${L('Email', 'البريد الإلكتروني')}</span><b>${this.escape(content.customer.email)}</b></div>` : '',
      content.customer.taxNumber ? `<div><span>${L('Tax number', 'الرقم الضريبي')}</span><b>${this.escape(content.customer.taxNumber)}</b></div>` : '',
      content.customer.address ? `<div><span>${L('Address', 'العنوان')}</span><b>${this.escape(content.customer.address)}</b></div>` : '',
    ].filter(Boolean).join('');

    // The offer's own column layout: order, labels and visibility all come
    // from the quotation. An offer that never chose one prints the standard
    // six, exactly as before.
    const columns = (content.columns?.length ? content.columns : standardColumns())
      .filter((column) => column.visible);
    const columnCount = columns.reduce((sum, column) => sum + column.width, 0) || 1;
    const span = columns.length + 1;
    const headCells = columns.map((column) => {
      const numeric = COLUMN_LABELS[column.key].numeric;
      const width = `${Math.round((column.width / columnCount) * 100)}%`;
      return `<th${numeric ? ' class="num"' : ''} style="width:${width}">${this.escape(
        columnLabel(column, lang),
      )}</th>`;
    }).join('');

    const tables = content.tables.map((table) => {
      const rows = table.lines.map((line, index) => {
        const cells = columns.map((column) => {
          const cell = this.columnCell(column, line);
          const classes = [cell.numeric ? 'num' : '', cell.strong ? 'strong' : '', column.key === 'description' ? 'desc' : '']
            .filter(Boolean)
            .join(' ');
          const text = cell.numeric && column.key !== 'quantity' ? money(cell.text) : this.escape(cell.text);
          return `<td${classes ? ` class="${classes}"` : ''}>${text}</td>`;
        }).join('');
        return `
        <tr>
          <td class="idx">${index + 1}</td>
          ${cells}
        </tr>`;
      }).join('');
      return `
      <section class="block">
        <div class="section-title">${this.escape(table.title)}</div>
        <table class="items">
          <thead>
            <tr>
              <th class="idx">#</th>
              ${headCells}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr><th colspan="${span - 1}">${L('Table subtotal', 'إجمالي الجدول')}</th><td class="num">${money(table.subTotal)}</td></tr>
            ${Number(table.discountAmount) > 0
              ? `<tr><th colspan="${span - 1}">${L('Table discount', 'خصم الجدول')}${
                  Number(table.discountPercent) > 0 ? ` (${Number(table.discountPercent)}%)` : ''
                }</th><td class="num">− ${money(table.discountAmount)}</td></tr>
                <tr class="net"><th colspan="${span - 1}">${L('Net after discount', 'الصافي بعد الخصم')}</th><td class="num">${money(table.netTotal)}</td></tr>`
              : ''}
          </tfoot>
        </table>
      </section>`;
    }).join('');

    const summaryRows = content.tables.map((table) => `
      <tr>
        <td>${this.escape(table.title)}</td>
        <td class="num">${money(table.subTotal)}</td>
        <td class="num">${Number(table.discountAmount) > 0 ? `− ${money(table.discountAmount)}` : money('0')}</td>
        <td class="num strong">${money(table.netTotal)}</td>
      </tr>`).join('');
    const quotationDiscount = content.totals.discountTotal
      ? Number(content.totals.discountTotal) - content.tables.reduce((sum, table) => sum + Number(table.discountAmount), 0)
      : 0;

    const terms = content.terms?.trim()
      ? `<section class="terms"><h3>${L('Terms and conditions', 'الشروط والأحكام')}</h3>
         <div class="terms-body">${this.escape(content.terms).replace(/\n/g, '<br>')}</div></section>`
      : '';
    const notes = content.notes?.trim()
      ? `<section class="notes"><h3>${L('Notes', 'ملاحظات')}</h3><div>${this.escape(content.notes).replace(/\n/g, '<br>')}</div></section>`
      : '';

    const signature = [
      content.managerName
        ? `<div class="sign"><div class="line"></div><div>${L('Company manager', 'مدير الشركة')}</div><b>${this.escape(content.managerName)}</b></div>`
        : '',
      content.responsibleName
        ? `<div class="sign"><div class="line"></div><div>${L('Responsible person', 'المسؤول')}</div><b>${this.escape(content.responsibleName)}</b>${
            content.responsiblePhone ? `<div class="small">${this.escape(content.responsiblePhone)}</div>` : ''
          }</div>`
        : '',
    ].filter(Boolean).join('');

    return `<!doctype html>
<html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<title>${this.escape(content.quotationNumber)} — ${this.escape(companyName)}</title>
<style>
  :root { --ink:#152033; --muted:#5b6879; --line:#d9dee6; --accent:#1f4e8c; --wash:#f3f6fb; }
  @page { size: A4; margin: 14mm 12mm 20mm; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; }
  body { font-family: 'Segoe UI', Tahoma, 'Noto Naskh Arabic', Arial, sans-serif; color: var(--ink); font-size: 10.5pt; }
  .toolbar { display:flex; gap:8px; justify-content:flex-end; padding:10px 4px; }
  .toolbar button { font: inherit; padding:8px 16px; border-radius:6px; border:1px solid #c3cbd6; background:#fff; cursor:pointer; }
  .toolbar button.primary { background: var(--accent); border-color: var(--accent); color:#fff; }
  .brand { display:flex; align-items:flex-start; gap:14px; border-bottom:3px solid var(--accent); padding-bottom:12px; }
  .brand .logo { height:64px; width:auto; max-width:180px; object-fit:contain; }
  .brand .who { flex:1; }
  .brand h1 { margin:0; font-size:16pt; letter-spacing:.2px; }
  .brand .muted { color: var(--muted); font-size:9pt; }
  .brand .meta { text-align:${rtl ? 'left' : 'right'}; min-width:190px; }
  .brand .meta .title { font-size:17pt; font-weight:700; color:var(--accent); letter-spacing:1px; }
  .brand .meta .row { font-size:9pt; color:var(--muted); }
  .brand .meta .row b { color:var(--ink); }
  .company-details { display:flex; flex-wrap:wrap; gap:3px 16px; font-size:8.5pt; color:var(--muted); margin-top:6px; }
  .company-details span { margin-inline-end:4px; }
  .subject { margin:10px 0 0; border-inline-start:3px solid var(--accent); padding:4px 0 4px 10px; }
  .subject span { font-size:8.5pt; text-transform:uppercase; letter-spacing:.6px; color:var(--muted); margin-inline-end:8px; }
  .subject b { font-size:12pt; }
  .parties { display:flex; gap:14px; margin:12px 0 14px; }
  .card { flex:1; border:1px solid var(--line); border-radius:6px; padding:9px 11px; }
  .card .label { font-size:8pt; text-transform:uppercase; letter-spacing:.6px; color:var(--muted); margin-bottom:4px; }
  .card h4 { margin:0 0 2px; font-size:11pt; }
  .card .row { font-size:9pt; color:var(--muted); }
  .card .row b { color:var(--ink); font-weight:600; }
  .section-title { background: var(--wash); border:1px solid var(--line); border-bottom:none; padding:6px 9px; font-weight:700; font-size:10.5pt; }
  .block { margin-bottom: 10mm; break-inside: auto; }
  table { width:100%; border-collapse:collapse; }
  .items { font-size:9.5pt; }
  .items th, .items td { border:1px solid var(--line); padding:5px 6px; vertical-align:top; }
  .items thead th { background:var(--accent); color:#fff; font-weight:600; text-align:start; font-size:9pt; }
  .items thead th.num { text-align:${rtl ? 'left' : 'right'}; }
  .items tbody tr:nth-child(even) { background:#fafbfe; }
  .items tfoot th { background:var(--wash); text-align:start; }
  .items tfoot .net th, .items tfoot .net td { background:#e9eff9; font-weight:700; }
  .idx { width:28px; color:var(--muted); }
  .desc { min-width:150px; word-break:break-word; }
  .num { text-align:${rtl ? 'left' : 'right'}; white-space:nowrap; font-variant-numeric: tabular-nums; }
  .strong { font-weight:600; }
  .summary { margin-top: 6mm; }
  .summary h3, .terms h3, .notes h3 { font-size:11pt; margin:0 0 6px; color:var(--accent); }
  .summary table th, .summary table td { border:1px solid var(--line); padding:5px 7px; }
  .summary thead th { background:var(--wash); text-align:start; }
  .totals { display:flex; justify-content:flex-end; margin-top:6px; }
  .totals table { width: 62mm; }
  .totals table td { border:1px solid var(--line); padding:5px 7px; }
  .totals table tr.grand td { background:var(--accent); color:#fff; font-weight:700; font-size:11pt; }
  .terms, .notes { margin-top: 7mm; break-inside: avoid; }
  .terms-body, .notes div { font-size:9pt; color:var(--muted); line-height:1.55; }
  .signs { display:flex; gap:16mm; margin-top: 14mm; break-inside: avoid; }
  .sign { flex:1; font-size:9pt; }
  .sign .line { border-bottom:1px solid #95a0b0; height:14mm; margin-bottom:4px; }
  .sign b { display:block; font-size:10pt; margin-top:2px; }
  .sign .small { color:var(--muted); }
  .footer { position:fixed; bottom:0; inset-inline:0; border-top:1px solid var(--line); padding-top:4px;
            font-size:8pt; color:var(--muted); display:flex; justify-content:space-between; gap:10px; }
  @media print {
    .toolbar { display:none; }
    .items thead { display: table-header-group; }
    .items tr { break-inside: avoid; }
    .block { break-inside: auto; }
    .summary, .terms, .signs { break-inside: avoid; }
  }
</style>
</head>
<body>
${autoPrint ? '' : `<div class="toolbar"><button onclick="window.print()">${L('Print', 'طباعة')}</button><button class="primary" onclick="window.print()">${L('Save as PDF', 'حفظ PDF')}</button></div>`}
<header class="brand">
  ${logo ? `<img class="logo" src="${logo}" alt="">` : ''}
  <div class="who">
    <h1>${this.escape(companyName)}</h1>
    ${companyAddress ? `<div class="muted">${this.escape(companyAddress)}</div>` : ''}
    <div class="company-details">${details}</div>
  </div>
  <div class="meta">
    <div class="title">${L('QUOTATION', 'عرض سعر')}</div>
    <div class="row">${L('No.', 'رقم')} <b>${this.escape(content.quotationNumber)}</b></div>
    <div class="row">${L('Date', 'التاريخ')} <b>${content.quotationDate}</b></div>
    ${content.validUntil ? `<div class="row">${L('Valid until', 'صالح حتى')} <b>${content.validUntil}</b></div>` : ''}
    <div class="row">${L('Version', 'الإصدار')} <b>${content.version}</b></div>
  </div>
</header>

${content.subject?.trim()
  ? `<div class="subject"><span>${L('Subject', 'الموضوع')}</span><b>${this.escape(content.subject.trim())}</b></div>`
  : ''}

<div class="parties">
  <div class="card">
    <div class="label">${L('Prepared for', 'مقدم إلى')}</div>
    <h4>${this.escape(customerName)}</h4>
    <div class="row">${L('Customer code', 'كود العميل')} <b>${this.escape(content.customer.code)}</b></div>
    ${customerDetails}
  </div>
  <div class="card">
    <div class="label">${L('Offer details', 'بيانات العرض')}</div>
    <div class="row">${L('Currency', 'العملة')} <b>${content.currency}</b></div>
    <div class="row">${L('Tables', 'الجداول')} <b>${content.tables.length}</b></div>
    <div class="row">${L('Status', 'الحالة')} <b>${this.statusLabel(content.status, rtl)}</b></div>
  </div>
</div>

${tables}

<section class="summary">
  <h3>${L('Summary', 'الملخص')}</h3>
  <table>
    <thead><tr>
      <th>${L('Table', 'الجدول')}</th>
      <th class="num">${L('Before discount', 'قبل الخصم')}</th>
      <th class="num">${L('Discount', 'الخصم')}</th>
      <th class="num">${L('Net', 'الصافي')}</th>
    </tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>
  <div class="totals">
    <table>
      <tr><td>${L('Subtotal', 'الإجمالي')}</td><td class="num">${money(content.totals.subTotal)}</td></tr>
      <tr><td>${L('Table discounts', 'خصومات الجداول')}</td><td class="num">− ${money(
        content.tables.reduce((sum, table) => sum + Number(table.discountAmount), 0).toFixed(4),
      )}</td></tr>
      ${quotationDiscount > 0
        ? `<tr><td>${L('Quotation discount', 'خصم العرض')}</td><td class="num">− ${money(quotationDiscount.toFixed(4))}</td></tr>`
        : ''}
      ${Number(content.totals.discountTotal) > 0
        ? `<tr><td>${L('Total discounts', 'إجمالي الخصومات')}</td><td class="num">− ${money(content.totals.discountTotal)}</td></tr>`
        : ''}
      <tr class="grand"><td>${L('Final total', 'الإجمالي النهائي')}</td><td class="num">${money(content.totals.totalAmount)}</td></tr>
    </table>
  </div>
</section>

${terms}
${notes}
${signature ? `<section class="signs">${signature}</section>` : ''}

<footer class="footer">
  <span>${this.escape(companyName)}${content.company.phone ? ` · ${this.escape(content.company.phone)}` : ''}${content.company.email ? ` · ${this.escape(content.company.email)}` : ''}</span>
  <span>${L('This offer is not a tax invoice.', 'هذا العرض ليس فاتورة ضريبية.')}</span>
</footer>
${autoPrint ? '<script>window.addEventListener("load",()=>window.print())</script>' : ''}
</body>
</html>`;
  }

  // ------------------------------------------------------------------ types

  /// Deliberately narrow: only what the document needs to print itself.
  // (declared as an interface below the class for readability)

  private status(value: string): QuotationStatus | null {
    const upper = value.trim().toUpperCase();
    const values = Object.values(QuotationStatus) as string[];
    return values.includes(upper) ? (upper as QuotationStatus) : null;
  }

  private date(value: string, field: string): Date {
    if (!DATE_ONLY.test(value.slice(0, 10))) {
      throw new BadRequestException(`${field} must be a date`);
    }
    const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} is not a valid date`);
    return date;
  }

  private decimal(value: string, field: string): Prisma.Decimal {
    try {
      return new Prisma.Decimal(value);
    } catch {
      throw new BadRequestException(`${field} must be a number`);
    }
  }

  private positive(value: string, field: string): Prisma.Decimal {
    const number = this.decimal(value, field);
    if (number.lessThanOrEqualTo(0)) throw new BadRequestException(`${field} must be greater than zero`);
    return number.toDecimalPlaces(MONEY_SCALE);
  }

  private nonNegative(value: string, field: string): Prisma.Decimal {
    const number = this.decimal(value, field);
    if (number.isNegative()) throw new BadRequestException(`${field} cannot be negative`);
    return number.toDecimalPlaces(MONEY_SCALE);
  }

  /// The columns an offer prints. A stored layout always wins; an offer that
  /// never chose one prints the standard six, exactly as it did before this
  /// feature existed.
  private columnsOf(raw: unknown): QuotationColumn[] {
    return normalizeColumns(raw);
  }

  /// Validates what the editor sent before it is stored. A layout with no
  /// visible column would print an empty table, so it is refused rather than
  /// quietly replaced.
  private columnData(raw?: Array<{
    key: string;
    labelEn?: string | null;
    labelAr?: string | null;
    visible?: boolean;
    width?: number;
  }>): QuotationColumn[] {
    if (!raw || raw.length === 0) return standardColumns();
    const seen = new Set<string>();
    for (const entry of raw) {
      if (!COLUMN_LABELS[entry.key]) {
        throw new BadRequestException(`Unknown quotation column "${entry.key}"`);
      }
      if (seen.has(entry.key)) {
        throw new BadRequestException(`The column "${entry.key}" is listed twice`);
      }
      seen.add(entry.key);
    }
    const columns = normalizeColumns(raw);
    if (!columns.some((column) => column.visible)) {
      throw new BadRequestException('Keep at least one column visible');
    }
    return columns;
  }

  /// One cell of a printed line, in the column's own type.
  private columnCell(column: QuotationColumn, line: QuotationSnapshotLine): {
    text: string;
    numeric: boolean;
    strong: boolean;
  } {
    const numeric = COLUMN_LABELS[column.key].numeric;
    switch (column.key) {
      case 'itemCode':
        return { text: line.itemCode ?? '', numeric: false, strong: false };
      case 'countryOfOrigin':
        return { text: line.countryOfOrigin ?? '', numeric: false, strong: false };
      case 'unit':
        return { text: line.unit ?? '', numeric: false, strong: false };
      case 'quantity':
        return { text: this.qty(line.quantity), numeric: true, strong: false };
      case 'unitPrice':
        return { text: line.unitPrice, numeric: true, strong: false };
      case 'lineTotal':
        return { text: line.lineTotal, numeric: true, strong: true };
      default:
        return { text: line.description, numeric: false, strong: false };
    }
  }

  private text(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private discountMessage(error: unknown, subject: string): string {
    if (error instanceof DiscountError) return `${subject}: ${error.message}`;
    if (error instanceof Error) return `${subject}: ${error.message}`;
    return `${subject}: the discount could not be applied`;
  }

  private statusLabel(status: string, rtl: boolean): string {
    const labels: Record<string, [string, string]> = {
      DRAFT: ['Draft', 'مسودة'],
      SENT: ['Sent', 'مُرسل'],
      ACCEPTED: ['Accepted', 'مقبول'],
      REJECTED: ['Rejected', 'مرفوض'],
      EXPIRED: ['Expired', 'منتهي'],
      CONVERTED: ['Converted', 'محوّل إلى فاتورة'],
    };
    const label = labels[status.toUpperCase()];
    if (!label) return status;
    return rtl ? label[1] : label[0];
  }

  private qty(value: string): string {
    const number = Number(value);
    return number.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }

  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

interface QuotationSnapshot {
  quotationNumber: string;
  quotationDate: string;
  validUntil: string | null;
  currency: string;
  version: number;
  status: string;
  customer: {
    code: string;
    nameEn: string;
    nameAr: string;
    phone: string | null;
    email: string | null;
    taxNumber: string | null;
    address: string | null;
  };
  company: {
    nameEn: string;
    nameAr: string;
    taxId: string | null;
    commercialRegistration: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    addressAr: string | null;
  };
  showTaxId: boolean;
  subject: string | null;
  columns: QuotationColumn[];
  managerName: string | null;
  responsibleName: string | null;
  responsiblePhone: string | null;
  notes: string | null;
  terms: string | null;
  discountType: string | null;
  discountPercent: string;
  discountAmount: string;
  tables: Array<{
    title: string;
    sortOrder: number;
    subTotal: string;
    discountPercent: string;
    discountAmount: string;
    netTotal: string;
    lines: QuotationSnapshotLine[];
  }>;
  totals: { subTotal: string; discountTotal: string; totalAmount: string };
}

interface QuotationSnapshotLine {
  itemCode: string | null;
  description: string;
  countryOfOrigin: string | null;
  unit: string | null;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}
