import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { QuotationStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanySettingsService } from '../../common/settings/company-settings.module';
import { DocumentNumberService } from '../accounting/document-number.service';
import { SalesInvoicesService } from './sales-invoices.service';
import { applyInvoiceDiscount } from '../invoicing/invoice-discount';

const MONEY = 4;
const RATE = 4;

type RawLine = {
  tableTitle?: unknown;
  itemId?: unknown;
  description?: unknown;
  unit?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  taxRate?: unknown;
};
type PreparedLine = {
  tableTitle: string;
  lineNumber: number;
  itemId: string | null;
  description: string;
  unit: string | null;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
};

@Injectable()
export class QuotationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly invoices: SalesInvoicesService,
    private readonly audit: AuditService,
    private readonly settings: CompanySettingsService,
  ) {}

  async findAll(companyId: string, query: { status?: string; customerId?: string; page?: number; pageSize?: number } = {}) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
    const where: Prisma.QuotationWhereInput = { companyId, deletedAt: null };
    if (query.customerId) where.customerId = query.customerId;
    if (query.status) {
      const status = query.status.toUpperCase();
      if (!Object.values(QuotationStatus).includes(status as QuotationStatus)) {
        throw new BadRequestException(`Unknown quotation status: ${query.status}`);
      }
      where.status = status as QuotationStatus;
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.quotation.findMany({
        where,
        orderBy: [{ quotationDate: 'desc' }, { quotationNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { customer: { select: { code: true, nameEn: true, nameAr: true } } },
      }),
      this.prisma.quotation.count({ where }),
    ]);
    return {
      items: items.map((quote) => this.summary(quote)),
      total,
      page,
      pageSize,
    };
  }

  async findOne(companyId: string, id: string) {
    const quote = await this.prisma.quotation.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        customer: { select: { id: true, code: true, nameEn: true, nameAr: true, taxNumber: true, address: true } },
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        lines: {
          orderBy: [{ tableTitle: 'asc' }, { lineNumber: 'asc' }],
          include: { item: { select: { code: true, nameEn: true, nameAr: true } } },
        },
      },
    });
    if (!quote) throw new NotFoundException('Quotation not found');
    return {
      ...this.summary(quote),
      branch: quote.branch,
      customer: quote.customer,
      originCountry: quote.originCountry,
      responsibleManager: quote.responsibleManager,
      showTaxId: quote.showTaxId,
      companySnapshot: quote.companySnapshot,
      termsSnapshot: quote.termsSnapshot,
      notes: quote.notes,
      convertedInvoiceId: quote.convertedInvoiceId,
      issuedAt: quote.issuedAt?.toISOString() ?? null,
      lines: quote.lines.map((line) => ({
        id: line.id,
        tableTitle: line.tableTitle,
        lineNumber: line.lineNumber,
        itemId: line.itemId,
        itemCode: line.item?.code ?? null,
        itemNameEn: line.item?.nameEn ?? null,
        itemNameAr: line.item?.nameAr ?? null,
        description: line.description,
        unit: line.unit,
        quantity: line.quantity.toFixed(MONEY),
        unitPrice: line.unitPrice.toFixed(MONEY),
        discountPercent: line.discountPercent.toFixed(RATE),
        discountAmount: line.discountAmount.toFixed(MONEY),
        taxRate: line.taxRate.toFixed(RATE),
        taxAmount: line.taxAmount.toFixed(MONEY),
        lineTotal: line.lineTotal.toFixed(MONEY),
      })),
    };
  }

  async create(companyId: string, branchId: string | null, userId: string, dto: Record<string, unknown>) {
    if (!branchId) throw new BadRequestException('The signed-in user is not assigned to a branch');
    const customerId = this.requiredText(dto.customerId, 'customerId');
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId, deletedAt: null },
      select: { id: true, isActive: true },
    });
    if (!customer) throw new BadRequestException('The customer does not exist in this company');
    if (!customer.isActive) throw new BadRequestException('The customer is inactive');

    const quoteDate = this.date(dto.quotationDate ?? dto.quoteDate, 'quotationDate');
    const validUntil = dto.validUntil ? this.date(dto.validUntil, 'validUntil') : null;
    if (validUntil && validUntil < quoteDate) throw new BadRequestException('validUntil cannot be before quotationDate');
    const showTaxId = dto.showTaxId === true;
    const companySnapshot = await this.companySnapshot(companyId, showTaxId);
    const termsSnapshot = await this.resolveTerms(companyId, dto.terms);
    const prepared = await this.prepareLines(companyId, dto.lines);
    const discount = applyInvoiceDiscount(
      prepared,
      this.optionalText(dto.discountPercent) ?? '0',
      this.optionalText(dto.discountAmount) ?? '0',
    );
    const lines = discount.lines;
    const subTotal = lines.reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0));
    const taxAmount = lines.reduce((sum, line) => sum.plus(line.taxAmount), new Prisma.Decimal(0));
    const totalAmount = subTotal.plus(taxAmount);

    const created = await this.prisma.$transaction(async (tx) => {
      const quotationNumber = await this.numbers.next(tx, companyId, 'quotation', 'QT');
      return tx.quotation.create({
        data: {
          companyId,
          branchId,
          customerId,
          quotationNumber,
          quotationDate: quoteDate,
          validUntil,
          currency: String(dto.currency ?? 'EGP').slice(0, 3).toUpperCase(),
          status: QuotationStatus.DRAFT,
          discountPercent: discount.discountPercent,
          discountAmount: discount.discountAmount,
          subTotal,
          taxAmount,
          totalAmount,
          originCountry: this.optionalText(dto.originCountry),
          responsibleManager: this.optionalText(dto.responsibleManager),
          showTaxId,
          notes: this.optionalText(dto.notes),
          companySnapshot: companySnapshot as Prisma.InputJsonValue,
          termsSnapshot: termsSnapshot as Prisma.InputJsonValue,
          createdBy: userId,
          lines: {
            create: lines.map((line) => ({
              tableTitle: line.tableTitle,
              lineNumber: line.lineNumber,
              itemId: line.itemId,
              description: line.description,
              unit: line.unit,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              discountPercent: line.discountPercent,
              discountAmount: line.discountAmount,
              taxRate: line.taxRate,
              taxAmount: line.taxAmount,
              lineTotal: line.lineTotal,
            })),
          },
        },
      });
    });
    await this.audit.record({
      companyId, userId, action: 'CREATE', entity: 'quotations', entityId: created.id,
      after: { quotationNumber: created.quotationNumber, totalAmount: totalAmount.toFixed(MONEY) },
    });
    return this.findOne(companyId, created.id);
  }

  async updateDraft(companyId: string, branchId: string | null, userId: string, id: string, dto: Record<string, unknown>) {
    if (!branchId) throw new BadRequestException('The signed-in user is not assigned to a branch');
    const current = await this.prisma.quotation.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: true },
    });
    if (!current) throw new NotFoundException('Quotation not found');
    if (current.status !== QuotationStatus.DRAFT) throw new BadRequestException('Only a draft quotation can be edited');
    if (current.branchId !== branchId) throw new BadRequestException('A quotation can only be edited from its assigned branch');

    const customerId = this.requiredText(dto.customerId, 'customerId');
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, companyId, deletedAt: null },
      select: { id: true, isActive: true },
    });
    if (!customer || !customer.isActive) throw new BadRequestException('The customer does not exist or is inactive');

    const quoteDate = this.date(dto.quotationDate ?? dto.quoteDate, 'quotationDate');
    const validUntil = dto.validUntil ? this.date(dto.validUntil, 'validUntil') : null;
    if (validUntil && validUntil < quoteDate) throw new BadRequestException('validUntil cannot be before quotationDate');
    const showTaxId = dto.showTaxId === true;
    const companySnapshot = await this.companySnapshot(companyId, showTaxId);
    const termsSnapshot = await this.resolveTerms(companyId, dto.terms);
    const discount = applyInvoiceDiscount(
      await this.prepareLines(companyId, dto.lines),
      this.optionalText(dto.discountPercent) ?? '0',
      this.optionalText(dto.discountAmount) ?? '0',
    );
    const lines = discount.lines;
    const subTotal = lines.reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0));
    const taxAmount = lines.reduce((sum, line) => sum.plus(line.taxAmount), new Prisma.Decimal(0));
    const totalAmount = subTotal.plus(taxAmount);

    const claimed = await this.prisma.quotation.updateMany({
      where: { id, companyId, status: QuotationStatus.DRAFT, deletedAt: null },
      data: {
        customerId,
        quotationDate: quoteDate,
        validUntil,
        currency: String(dto.currency ?? current.currency).slice(0, 3).toUpperCase(),
        discountPercent: discount.discountPercent,
        discountAmount: discount.discountAmount,
        subTotal,
        taxAmount,
        totalAmount,
        originCountry: this.optionalText(dto.originCountry),
        responsibleManager: this.optionalText(dto.responsibleManager),
        showTaxId,
        notes: this.optionalText(dto.notes),
        companySnapshot: companySnapshot as Prisma.InputJsonValue,
        termsSnapshot: termsSnapshot as Prisma.InputJsonValue,
        updatedBy: userId,
      },
    });
    if (claimed.count !== 1) throw new BadRequestException('This quotation changed status; reload it before editing');
    await this.prisma.quotationLine.deleteMany({ where: { quotationId: id } });
    await this.prisma.quotationLine.createMany({
      data: lines.map((line) => ({
        quotationId: id,
        tableTitle: line.tableTitle,
        lineNumber: line.lineNumber,
        itemId: line.itemId,
        description: line.description,
        unit: line.unit,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountPercent: line.discountPercent,
        discountAmount: line.discountAmount,
        taxRate: line.taxRate,
        taxAmount: line.taxAmount,
        lineTotal: line.lineTotal,
      })),
    });
    await this.audit.record({
      companyId, userId, action: 'UPDATE', entity: 'quotations', entityId: id,
      after: { quotationNumber: current.quotationNumber, totalAmount: totalAmount.toFixed(MONEY) },
    });
    return this.findOne(companyId, id);
  }

  async issue(companyId: string, userId: string, id: string) {
    const quote = await this.prisma.quotation.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!quote) throw new NotFoundException('Quotation not found');
    if (quote.status !== QuotationStatus.DRAFT) throw new BadRequestException('Only a draft quotation can be issued');
    const updated = await this.prisma.quotation.updateMany({
      where: { id, companyId, status: QuotationStatus.DRAFT, deletedAt: null },
      data: { status: QuotationStatus.ISSUED, issuedAt: new Date(), issuedBy: userId, updatedBy: userId },
    });
    if (updated.count !== 1) throw new BadRequestException('This quotation was issued by someone else');
    await this.audit.record({ companyId, userId, action: 'ISSUE', entity: 'quotations', entityId: id });
    return this.findOne(companyId, id);
  }

  async accept(companyId: string, userId: string, id: string) {
    return this.changeStatus(companyId, userId, id, QuotationStatus.ISSUED, QuotationStatus.ACCEPTED, 'ACCEPT');
  }

  async reject(companyId: string, userId: string, id: string) {
    return this.changeStatus(companyId, userId, id, QuotationStatus.ISSUED, QuotationStatus.REJECTED, 'REJECT');
  }

  async convertToInvoice(companyId: string, branchId: string | null, userId: string, id: string) {
    if (!branchId) throw new BadRequestException('The signed-in user is not assigned to a branch');
    const quote = await this.prisma.quotation.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { lines: { orderBy: [{ tableTitle: 'asc' }, { lineNumber: 'asc' }] } },
    });
    if (!quote) throw new NotFoundException('Quotation not found');
    if (quote.status === QuotationStatus.CONVERTED && quote.convertedInvoiceId) {
      return { quotation: await this.findOne(companyId, id), invoice: await this.invoices.findOne(companyId, quote.convertedInvoiceId) };
    }
    if (quote.status !== QuotationStatus.ACCEPTED) throw new BadRequestException('Accept the quotation before converting it to an invoice');
    if (quote.branchId !== branchId) throw new BadRequestException('A quotation can only be invoiced from its assigned branch');

    const invoice = await this.invoices.create(companyId, branchId, userId, {
      invoiceDate: new Date().toISOString().slice(0, 10),
      customerId: quote.customerId,
      notes: quote.notes ?? undefined,
      discountPercent: quote.discountPercent.greaterThan(0) ? quote.discountPercent.toFixed(RATE) : '0',
      discountAmount: quote.discountPercent.greaterThan(0) ? '0' : quote.discountAmount.toFixed(MONEY),
      lines: quote.lines.map((line) => ({
        itemId: line.itemId ?? undefined,
        description: line.description,
        quantity: line.quantity.toFixed(MONEY),
        unitPrice: line.unitPrice.toFixed(MONEY),
        taxRate: line.taxRate.toFixed(RATE),
      })),
    });
    await this.prisma.quotation.update({
      where: { id },
      data: { status: QuotationStatus.CONVERTED, convertedInvoiceId: invoice.id, updatedBy: userId },
    });
    await this.audit.record({
      companyId, userId, action: 'CONVERT', entity: 'quotations', entityId: id,
      after: { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber },
    });
    return { quotation: await this.findOne(companyId, id), invoice };
  }

  async listTerms(companyId: string) {
    return this.prisma.quotationTermTemplate.findMany({
      where: { companyId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    });
  }

  async createTerm(companyId: string, userId: string, dto: Record<string, unknown>) {
    const title = this.requiredText(dto.title, 'title');
    const body = this.requiredText(dto.body, 'body');
    const created = await this.prisma.quotationTermTemplate.create({
      data: { companyId, title, body, sortOrder: Number(dto.sortOrder ?? 0), createdBy: userId },
    });
    await this.audit.record({ companyId, userId, action: 'CREATE', entity: 'quotation_term_templates', entityId: created.id });
    return created;
  }

  async updateTerm(companyId: string, userId: string, id: string, dto: Record<string, unknown>) {
    const current = await this.prisma.quotationTermTemplate.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!current) throw new NotFoundException('Quotation term not found');
    const updated = await this.prisma.quotationTermTemplate.update({
      where: { id },
      data: {
        title: dto.title === undefined ? current.title : this.requiredText(dto.title, 'title'),
        body: dto.body === undefined ? current.body : this.requiredText(dto.body, 'body'),
        sortOrder: dto.sortOrder === undefined ? current.sortOrder : Number(dto.sortOrder),
        isActive: dto.isActive === undefined ? current.isActive : dto.isActive === true,
        updatedBy: userId,
      },
    });
    await this.audit.record({ companyId, userId, action: 'UPDATE', entity: 'quotation_term_templates', entityId: id });
    return updated;
  }

  async deleteTerm(companyId: string, userId: string, id: string) {
    const current = await this.prisma.quotationTermTemplate.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!current) throw new NotFoundException('Quotation term not found');
    await this.prisma.quotationTermTemplate.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: userId } });
    await this.audit.record({ companyId, userId, action: 'DELETE', entity: 'quotation_term_templates', entityId: id });
  }

  private async changeStatus(companyId: string, userId: string, id: string, from: QuotationStatus, to: QuotationStatus, action: string) {
    const changed = await this.prisma.quotation.updateMany({
      where: { id, companyId, status: from, deletedAt: null },
      data: { status: to, updatedBy: userId },
    });
    if (changed.count !== 1) throw new BadRequestException(`Quotation must be ${from.toLowerCase()} before it can be ${action.toLowerCase()}ed`);
    await this.audit.record({ companyId, userId, action, entity: 'quotations', entityId: id });
    return this.findOne(companyId, id);
  }

  private async prepareLines(companyId: string, raw: unknown): Promise<PreparedLine[]> {
    if (!Array.isArray(raw) || raw.length === 0) throw new BadRequestException('A quotation needs at least one line');
    const result: PreparedLine[] = [];
    const tableLineNumbers = new Map<string, number>();
    for (const value of raw) {
      const line = value as RawLine;
      const tableTitle = this.optionalText(line.tableTitle) ?? 'Items';
      if (tableTitle.length > 160) throw new BadRequestException('A quotation table title cannot exceed 160 characters');
      const quantity = this.decimal(line.quantity, 'quantity');
      const unitPrice = this.decimal(line.unitPrice, 'unitPrice');
      const taxRate = this.decimal(line.taxRate ?? '0', 'taxRate');
      if (quantity.lessThanOrEqualTo(0)) throw new BadRequestException('quantity must be greater than zero');
      if (unitPrice.isNegative()) throw new BadRequestException('unitPrice cannot be negative');
      if (taxRate.isNegative() || taxRate.greaterThan(100)) throw new BadRequestException('taxRate must be between 0 and 100');
      let itemId: string | null = null;
      let unit: string | null = this.optionalText(line.unit);
      const suppliedItemId = this.optionalText(line.itemId);
      if (suppliedItemId) {
        const item = await this.prisma.item.findFirst({
          where: { id: suppliedItemId, companyId, deletedAt: null },
          select: { id: true, unit: true, isActive: true },
        });
        if (!item || !item.isActive) throw new BadRequestException('A quotation item does not exist or is inactive');
        itemId = item.id;
        unit = unit ?? item.unit;
      }
      const description = this.optionalText(line.description);
      if (!description && !itemId) throw new BadRequestException('A line needs an item or a description');
      const base = quantity.mul(unitPrice).toDecimalPlaces(MONEY);
      const taxAmount = base.mul(taxRate).div(100).toDecimalPlaces(MONEY);
      const nextLine = (tableLineNumbers.get(tableTitle) ?? 0) + 1;
      tableLineNumbers.set(tableTitle, nextLine);
      result.push({
        tableTitle,
        lineNumber: nextLine,
        itemId,
        description: description ?? '—',
        unit,
        quantity,
        unitPrice,
        taxRate,
        taxAmount,
        lineTotal: base,
      });
    }
    return result;
  }

  private async resolveTerms(companyId: string, raw: unknown): Promise<Array<{ title: string; body: string }>> {
    if (raw == null) return [];
    if (!Array.isArray(raw)) throw new BadRequestException('terms must be an array');
    const terms: Array<{ title: string; body: string }> = [];
    for (const value of raw) {
      const term = value as { templateId?: unknown; title?: unknown; body?: unknown };
      const templateId = this.optionalText(term.templateId);
      if (templateId) {
        const template = await this.prisma.quotationTermTemplate.findFirst({
          where: { id: templateId, companyId, isActive: true, deletedAt: null },
        });
        if (!template) throw new BadRequestException('A selected quotation term is unavailable');
        terms.push({ title: template.title, body: template.body });
      } else {
        terms.push({ title: this.requiredText(term.title, 'term title'), body: this.requiredText(term.body, 'term body') });
      }
    }
    return terms;
  }

  private async companySnapshot(companyId: string, showTaxId: boolean) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        code: true, nameEn: true, nameAr: true, taxId: true,
        commercialRegistration: true, phone: true, email: true,
        address: true, addressEn: true, addressAr: true, currency: true,
        logoData: true, logoMime: true,
      },
    });
    if (!company) throw new NotFoundException('Company not found');
    const address = company.address;
    return {
      code: company.code,
      nameEn: company.nameEn,
      nameAr: company.nameAr,
      taxId: showTaxId ? company.taxId : null,
      commercialRegistration: company.commercialRegistration,
      phone: company.phone,
      email: company.email,
      address: address,
      addressEn: company.addressEn,
      addressAr: company.addressAr,
      currency: company.currency,
      logoMime: company.logoMime,
      logoBase64: company.logoData ? Buffer.from(company.logoData).toString('base64') : null,
    };
  }

  private summary(quote: {
    id: string; quotationNumber: string; quotationDate: Date; validUntil: Date | null;
    status: QuotationStatus; currency: string; customer?: { code: string; nameEn: string; nameAr: string } | null;
    discountPercent: Prisma.Decimal; discountAmount: Prisma.Decimal; subTotal: Prisma.Decimal;
    taxAmount: Prisma.Decimal; totalAmount: Prisma.Decimal; createdAt: Date;
  }) {
    return {
      id: quote.id,
      quotationNumber: quote.quotationNumber,
      quotationDate: quote.quotationDate.toISOString().slice(0, 10),
      validUntil: quote.validUntil?.toISOString().slice(0, 10) ?? null,
      status: quote.status.toLowerCase(),
      currency: quote.currency,
      customer: quote.customer ?? null,
      discountPercent: quote.discountPercent.toFixed(RATE),
      discountAmount: quote.discountAmount.toFixed(MONEY),
      subTotal: quote.subTotal.toFixed(MONEY),
      taxAmount: quote.taxAmount.toFixed(MONEY),
      totalAmount: quote.totalAmount.toFixed(MONEY),
      createdAt: quote.createdAt.toISOString(),
    };
  }

  private requiredText(value: unknown, field: string): string {
    const text = this.optionalText(value);
    if (!text) throw new BadRequestException(`${field} is required`);
    return text;
  }

  private optionalText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const result = value.trim();
    return result.length ? result : undefined;
  }

  private date(value: unknown, field: string): Date {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new BadRequestException(`${field} must be a valid date`);
    return new Date(value);
  }

  private decimal(value: unknown, field: string): Prisma.Decimal {
    try {
      const result = new Prisma.Decimal(String(value ?? ''));
      if (!result.isFinite()) throw new Error();
      return result.toDecimalPlaces(MONEY);
    } catch {
      throw new BadRequestException(`${field} must be a valid number`);
    }
  }
}
