import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CashVoucherKind, InvoiceStatus, JournalStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccountMapService } from '../accounting/account-map.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { PostingService } from '../accounting/posting.service';

const MONEY_SCALE = 4;

export interface AllocationInput {
  salesInvoiceId?: string;
  purchaseInvoiceId?: string;
  amount: string | number;
}

/**
 * Receipts and payments.
 *
 * A voucher is one document with two jobs: it moves money in or out of a box
 * or bank, and - when it names invoices - it says which invoices the money
 * settled. Both happen in a single transaction, so an invoice can never show
 * as paid while the ledger says nobody paid it.
 *
 * Posting twice is impossible by construction: the status is claimed with a
 * conditional update (`WHERE status = 'DRAFT'`), and a second attempt finds
 * nothing to claim. That is a database-level guarantee, not a UI one, and it
 * holds when two users press the button at the same moment.
 */
@Injectable()
export class CashVouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: DocumentNumberService,
    private readonly posting: PostingService,
    private readonly accounts: AccountMapService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    companyId: string,
    query: {
      kind?: string;
      status?: string;
      cashAccountId?: string;
      customerId?: string;
      supplierId?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    const where: Prisma.CashVoucherWhereInput = { companyId, deletedAt: null };
    if (query.kind) {
      const kind = query.kind.toUpperCase();
      if (!Object.values(CashVoucherKind).includes(kind as CashVoucherKind)) {
        throw new BadRequestException(`Unknown voucher kind: ${query.kind}`);
      }
      where.kind = kind as CashVoucherKind;
    }
    if (query.status) where.status = query.status.toUpperCase() as InvoiceStatus;
    if (query.cashAccountId) where.cashAccountId = query.cashAccountId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.from || query.to) {
      where.voucherDate = {};
      if (query.from) (where.voucherDate as Prisma.DateTimeFilter).gte = new Date(query.from);
      if (query.to) (where.voucherDate as Prisma.DateTimeFilter).lte = new Date(query.to);
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.cashVoucher.findMany({
        where,
        orderBy: [{ voucherDate: 'desc' }, { voucherNumber: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          cashAccount: { select: { code: true, nameEn: true, nameAr: true, kind: true } },
          customer: { select: { code: true, nameEn: true, nameAr: true } },
          supplier: { select: { code: true, nameEn: true, nameAr: true } },
        },
      }),
      this.prisma.cashVoucher.count({ where }),
    ]);

    return { items: items.map((row) => this.toResponse(row)), total, page, pageSize };
  }

  async findOne(companyId: string, id: string) {
    const voucher = await this.prisma.cashVoucher.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        cashAccount: { select: { code: true, nameEn: true, nameAr: true, kind: true } },
        customer: { select: { code: true, nameEn: true, nameAr: true } },
        supplier: { select: { code: true, nameEn: true, nameAr: true } },
        allocations: {
          include: {
            salesInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, paidAmount: true } },
            purchaseInvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, paidAmount: true } },
          },
        },
      },
    });
    if (!voucher) throw new NotFoundException('Cash voucher not found');

    return {
      ...this.toResponse(voucher),
      allocations: voucher.allocations.map((allocation) => ({
        id: allocation.id,
        salesInvoiceId: allocation.salesInvoiceId,
        purchaseInvoiceId: allocation.purchaseInvoiceId,
        invoiceNumber:
          allocation.salesInvoice?.invoiceNumber ?? allocation.purchaseInvoice?.invoiceNumber ?? null,
        amount: allocation.amount.toFixed(MONEY_SCALE),
      })),
    };
  }

  /** Creates a DRAFT voucher. Nothing reaches the ledger until it is posted. */
  async create(
    companyId: string,
    branchId: string | null,
    userId: string,
    dto: {
      kind: string;
      cashAccountId: string;
      voucherDate: string;
      amount: string | number;
      customerId?: string;
      supplierId?: string;
      counterAccountId?: string;
      description?: string;
      reference?: string;
      allocations?: AllocationInput[];
    },
  ) {
    if (!branchId) {
      throw new BadRequestException('The signed-in user is not assigned to a branch');
    }

    const kind = String(dto.kind ?? '').toUpperCase() as CashVoucherKind;
    if (!Object.values(CashVoucherKind).includes(kind)) {
      throw new BadRequestException('kind must be RECEIPT or PAYMENT');
    }

    const amount = this.positive(dto.amount, 'amount');
    const cashAccount = await this.requireCashAccount(companyId, dto.cashAccountId);
    if (!cashAccount.isActive) throw new BadRequestException('That cash account is inactive');

    const date = this.date(dto.voucherDate, 'voucherDate');
    const party = await this.resolveParty(companyId, dto);

    const allocations = dto.allocations ?? [];
    const allocationTotal = allocations.reduce(
      (sum, allocation) => sum.plus(this.positive(allocation.amount, 'allocation amount')),
      new Prisma.Decimal(0),
    );
    if (allocationTotal.greaterThan(amount)) {
      throw new BadRequestException(
        `The allocations (${allocationTotal.toFixed(MONEY_SCALE)}) are more than the voucher ` +
          `(${amount.toFixed(MONEY_SCALE)}). A voucher cannot pay more than it carries.`,
      );
    }
    if (allocations.length > 0 && !party.customerId && !party.supplierId) {
      throw new BadRequestException(
        'A voucher can only be allocated against invoices when it names a customer or a supplier',
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const key = kind === CashVoucherKind.RECEIPT ? 'RECEIPT_VOUCHER' : 'PAYMENT_VOUCHER';
      const prefix = kind === CashVoucherKind.RECEIPT ? 'RC' : 'PV';
      const voucherNumber = await this.numbers.next(tx, companyId, key, prefix);

      const voucher = await tx.cashVoucher.create({
        data: {
          companyId,
          branchId,
          voucherNumber,
          voucherDate: date,
          kind,
          cashAccountId: cashAccount.id,
          amount,
          currency: cashAccount.currency,
          customerId: party.customerId,
          supplierId: party.supplierId,
          counterAccountId: party.counterAccountId,
          description: dto.description?.trim() || null,
          reference: dto.reference?.trim() || null,
          status: InvoiceStatus.DRAFT,
          createdBy: userId,
          allocations: {
            create: allocations.map((allocation) => ({
              salesInvoiceId: allocation.salesInvoiceId ?? null,
              purchaseInvoiceId: allocation.purchaseInvoiceId ?? null,
              amount: this.positive(allocation.amount, 'allocation amount'),
            })),
          },
        },
      });
      return voucher;
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: 'cash_vouchers',
      entityId: created.id,
      after: {
        voucherNumber: created.voucherNumber,
        kind,
        amount: amount.toFixed(MONEY_SCALE),
      },
    });

    return this.findOne(companyId, created.id);
  }

  /**
   * Posts the voucher: money moves, invoices are marked as settled, and one
   * journal entry records all of it.
   */
  async post(companyId: string, userId: string, id: string) {
    const voucher = await this.prisma.cashVoucher.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        allocations: true,
        cashAccount: { select: { id: true, accountId: true, isActive: true, code: true } },
      },
    });
    if (!voucher) throw new NotFoundException('Cash voucher not found');
    if (voucher.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        `Only a draft voucher can be posted (current status: ${voucher.status})`,
      );
    }
    if (!voucher.cashAccount.isActive) {
      throw new BadRequestException('That cash account is inactive');
    }

    const accounts = await this.accounts.resolve(
      this.prisma as never,
      companyId,
      ['accountsReceivable', 'accountsPayable'],
    );

    const result = await this.prisma.$transaction(async (tx) => {
      // Claim the voucher. Two people posting at the same moment: exactly one
      // update matches, and the other is told the voucher is already posted.
      const claimed = await tx.cashVoucher.updateMany({
        where: { id: voucher.id, status: InvoiceStatus.DRAFT, deletedAt: null },
        data: { status: InvoiceStatus.POSTED, postedAt: new Date(), postedBy: userId },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException(
          'This voucher has just been posted by someone else. Reload it to see the current state.',
        );
      }

      // ---- allocations: what the money settled
      let allocated = new Prisma.Decimal(0);
      for (const allocation of voucher.allocations) {
        if (allocation.salesInvoiceId) {
          const invoice = await tx.salesInvoice.findFirst({
            where: { id: allocation.salesInvoiceId, companyId, deletedAt: null },
            select: { id: true, invoiceNumber: true, totalAmount: true, paidAmount: true, status: true },
          });
          if (!invoice) throw new BadRequestException('An allocation references a missing sales invoice');
          if (invoice.status === InvoiceStatus.DRAFT) {
            throw new BadRequestException(
              `Sales invoice ${invoice.invoiceNumber} is not posted yet, so it cannot be paid`,
            );
          }
          const due = invoice.totalAmount.minus(invoice.paidAmount);
          if (allocation.amount.greaterThan(due)) {
            throw new BadRequestException(
              `Sales invoice ${invoice.invoiceNumber} has only ${due.toFixed(MONEY_SCALE)} left to pay; ` +
                `${allocation.amount.toFixed(MONEY_SCALE)} was allocated to it.`,
            );
          }
          await tx.salesInvoice.update({
            where: { id: invoice.id },
            data: { paidAmount: { increment: allocation.amount } },
          });
        }
        if (allocation.purchaseInvoiceId) {
          const invoice = await tx.purchaseInvoice.findFirst({
            where: { id: allocation.purchaseInvoiceId, companyId, deletedAt: null },
            select: { id: true, invoiceNumber: true, totalAmount: true, paidAmount: true, status: true },
          });
          if (!invoice) throw new BadRequestException('An allocation references a missing purchase invoice');
          if (invoice.status === InvoiceStatus.DRAFT) {
            throw new BadRequestException(
              `Purchase invoice ${invoice.invoiceNumber} is not posted yet, so it cannot be paid`,
            );
          }
          const due = invoice.totalAmount.minus(invoice.paidAmount);
          if (allocation.amount.greaterThan(due)) {
            throw new BadRequestException(
              `Purchase invoice ${invoice.invoiceNumber} has only ${due.toFixed(MONEY_SCALE)} left to pay; ` +
                `${allocation.amount.toFixed(MONEY_SCALE)} was allocated to it.`,
            );
          }
          await tx.purchaseInvoice.update({
            where: { id: invoice.id },
            data: { paidAmount: { increment: allocation.amount } },
          });
        }
        allocated = allocated.plus(allocation.amount);
      }

      // Whatever the allocations did not claim is still money that moved: it
      // belongs on the partner's account, which is what makes an unallocated
      // receipt an on-account credit rather than a lost document.
      const unallocated = voucher.amount.minus(allocated);

      const lines: Array<{
        accountId: string;
        debit?: Prisma.Decimal;
        credit?: Prisma.Decimal;
        description: string;
      }> = [];

      if (unallocated.greaterThan(0)) {
        if (voucher.customerId) {
          lines.push({
            accountId: accounts.accountsReceivable,
            debit: voucher.kind === CashVoucherKind.RECEIPT ? undefined : unallocated,
            credit: voucher.kind === CashVoucherKind.RECEIPT ? unallocated : undefined,
            description: 'On account',
          });
        } else if (voucher.supplierId) {
          lines.push({
            accountId: accounts.accountsPayable,
            debit: voucher.kind === CashVoucherKind.RECEIPT ? undefined : unallocated,
            credit: voucher.kind === CashVoucherKind.RECEIPT ? unallocated : undefined,
            description: 'On account',
          });
        } else if (voucher.counterAccountId) {
          lines.push({
            accountId: voucher.counterAccountId,
            debit: voucher.kind === CashVoucherKind.RECEIPT ? undefined : unallocated,
            credit: voucher.kind === CashVoucherKind.RECEIPT ? unallocated : undefined,
            description: voucher.description ?? 'Counter account',
          });
        } else {
          throw new BadRequestException(
            'Give the voucher a customer, a supplier or a counter account: the money has to come from somewhere.',
          );
        }
      }

      // Allocated money is applied against the partner's control account for
      // the invoice type it settles.
      if (allocated.greaterThan(0)) {
        const salesAllocated = voucher.allocations
          .filter((a) => a.salesInvoiceId)
          .reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));
        const purchaseAllocated = voucher.allocations
          .filter((a) => a.purchaseInvoiceId)
          .reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));

        if (salesAllocated.greaterThan(0)) {
          lines.push({
            accountId: accounts.accountsReceivable,
            debit: voucher.kind === CashVoucherKind.RECEIPT ? undefined : salesAllocated,
            credit: voucher.kind === CashVoucherKind.RECEIPT ? salesAllocated : undefined,
            description: 'Settlement of sales invoices',
          });
        }
        if (purchaseAllocated.greaterThan(0)) {
          lines.push({
            accountId: accounts.accountsPayable,
            debit: voucher.kind === CashVoucherKind.RECEIPT ? undefined : purchaseAllocated,
            credit: voucher.kind === CashVoucherKind.RECEIPT ? purchaseAllocated : undefined,
            description: 'Settlement of purchase invoices',
          });
        }
      }

      // The cash side always carries the full amount.
      lines.push({
        accountId: voucher.cashAccount.accountId,
        debit: voucher.kind === CashVoucherKind.RECEIPT ? voucher.amount : undefined,
        credit: voucher.kind === CashVoucherKind.PAYMENT ? voucher.amount : undefined,
        description: voucher.kind === CashVoucherKind.RECEIPT ? 'Receipt' : 'Payment',
      });

      const journal = await this.posting.post(tx, {
        companyId,
        branchId: voucher.branchId,
        userId,
        entryDate: voucher.voucherDate,
        description:
          voucher.description ??
          (voucher.kind === CashVoucherKind.RECEIPT ? 'Receipt voucher' : 'Payment voucher'),
        sourceType: 'CASH_VOUCHER',
        sourceId: voucher.id,
        sourceNumber: voucher.voucherNumber,
        currency: voucher.currency,
        lines,
      });

      await tx.cashVoucher.update({
        where: { id: voucher.id },
        data: { journalEntryId: journal.id },
      });

      return { journal };
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'POST',
      entity: 'cash_vouchers',
      entityId: id,
      before: { status: InvoiceStatus.DRAFT },
      after: {
        status: InvoiceStatus.POSTED,
        journalNumber: result.journal.entryNumber,
        amount: voucher.amount.toFixed(MONEY_SCALE),
      },
    });

    return this.findOne(companyId, id);
  }

  /**
   * Reverses a posted voucher: a mirror journal entry, the allocations given
   * back, and the invoices returned to what they were owed.
   */
  async reverse(companyId: string, userId: string, id: string, reason?: string) {
    const voucher = await this.prisma.cashVoucher.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { allocations: true },
    });
    if (!voucher) throw new NotFoundException('Cash voucher not found');
    if (voucher.status !== InvoiceStatus.POSTED || !voucher.journalEntryId) {
      throw new BadRequestException('Only a posted voucher can be reversed');
    }

    const journal = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.cashVoucher.updateMany({
        where: { id: voucher.id, status: InvoiceStatus.POSTED },
        data: { status: InvoiceStatus.REVERSED },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This voucher has just been changed by someone else.');
      }

      for (const allocation of voucher.allocations) {
        if (allocation.salesInvoiceId) {
          await tx.salesInvoice.update({
            where: { id: allocation.salesInvoiceId },
            data: { paidAmount: { decrement: allocation.amount } },
          });
        }
        if (allocation.purchaseInvoiceId) {
          await tx.purchaseInvoice.update({
            where: { id: allocation.purchaseInvoiceId },
            data: { paidAmount: { decrement: allocation.amount } },
          });
        }
      }

      return this.posting.reverse(
        tx,
        companyId,
        userId,
        voucher.journalEntryId as string,
        reason?.trim() || `Reversal of voucher ${voucher.voucherNumber}`,
      );
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'REVERSE',
      entity: 'cash_vouchers',
      entityId: id,
      after: { reversalJournalNumber: journal.entryNumber, reason: reason ?? null },
    });

    return this.findOne(companyId, id);
  }

  /**
   * Which posted invoices are still owed, for the picker that fills an
   * allocation. Reading this instead of guessing is what keeps a receipt from
   * being allocated twice.
   */
  async openInvoices(
    companyId: string,
    kind: 'customer' | 'supplier',
    partyId: string,
  ) {
    if (kind === 'customer') {
      const invoices = await this.prisma.salesInvoice.findMany({
        where: {
          companyId,
          customerId: partyId,
          deletedAt: null,
          status: InvoiceStatus.POSTED,
        },
        orderBy: { invoiceDate: 'asc' },
        select: {
          id: true,
          invoiceNumber: true,
          invoiceDate: true,
          dueDate: true,
          totalAmount: true,
          paidAmount: true,
          currency: true,
          documentType: true,
        },
      });
      return {
        items: invoices
          .map((invoice) => ({
            id: invoice.id,
            number: invoice.invoiceNumber,
            date: invoice.invoiceDate.toISOString().slice(0, 10),
            dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
            documentType: invoice.documentType.toLowerCase(),
            currency: invoice.currency,
            total: invoice.totalAmount.toFixed(MONEY_SCALE),
            paid: invoice.paidAmount.toFixed(MONEY_SCALE),
            balance: invoice.totalAmount.minus(invoice.paidAmount).toFixed(MONEY_SCALE),
          }))
          .filter((invoice) => new Prisma.Decimal(invoice.balance).greaterThan(0)),
      };
    }

    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: {
        companyId,
        supplierId: partyId,
        deletedAt: null,
        status: InvoiceStatus.POSTED,
      },
      orderBy: { invoiceDate: 'asc' },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        totalAmount: true,
        paidAmount: true,
        currency: true,
        documentType: true,
      },
    });
    return {
      items: invoices
        .map((invoice) => ({
          id: invoice.id,
          number: invoice.invoiceNumber,
          date: invoice.invoiceDate.toISOString().slice(0, 10),
          dueDate: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
          documentType: invoice.documentType.toLowerCase(),
          currency: invoice.currency,
          total: invoice.totalAmount.toFixed(MONEY_SCALE),
          paid: invoice.paidAmount.toFixed(MONEY_SCALE),
          balance: invoice.totalAmount.minus(invoice.paidAmount).toFixed(MONEY_SCALE),
        }))
        .filter((invoice) => new Prisma.Decimal(invoice.balance).greaterThan(0)),
    };
  }

  // ------------------------------------------------------------------ helpers

  private async requireCashAccount(companyId: string, id: string) {
    const cashAccount = await this.prisma.cashAccount.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true, accountId: true, currency: true, isActive: true, code: true },
    });
    if (!cashAccount) throw new BadRequestException('The cash account does not exist');
    return cashAccount;
  }

  private async resolveParty(
    companyId: string,
    dto: { customerId?: string; supplierId?: string; counterAccountId?: string },
  ) {
    if (dto.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, companyId, deletedAt: null },
        select: { id: true, isActive: true },
      });
      if (!customer) throw new BadRequestException('The customer does not exist');
      if (!customer.isActive) throw new BadRequestException('The customer is inactive');
    }
    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: dto.supplierId, companyId, deletedAt: null },
        select: { id: true, isActive: true },
      });
      if (!supplier) throw new BadRequestException('The supplier does not exist');
      if (!supplier.isActive) throw new BadRequestException('The supplier is inactive');
    }
    if (dto.counterAccountId) {
      const account = await this.prisma.account.findFirst({
        where: { id: dto.counterAccountId, companyId, deletedAt: null },
        select: { id: true, code: true, isPostable: true, isActive: true },
      });
      if (!account) throw new BadRequestException('The counter account does not exist');
      if (!account.isPostable) {
        throw new BadRequestException(`Account ${account.code} is a grouping account`);
      }
      if (!account.isActive) throw new BadRequestException(`Account ${account.code} is inactive`);
    }

    const parties = [dto.customerId, dto.supplierId].filter(Boolean).length;
    if (parties > 1) {
      throw new BadRequestException('A voucher is against a customer or a supplier, not both');
    }

    return {
      customerId: dto.customerId ?? null,
      supplierId: dto.supplierId ?? null,
      counterAccountId: dto.counterAccountId ?? null,
    };
  }

  private positive(value: unknown, field: string): Prisma.Decimal {
    let decimal: Prisma.Decimal;
    try {
      decimal = new Prisma.Decimal(String(value)).toDecimalPlaces(MONEY_SCALE);
    } catch {
      throw new BadRequestException(`${field} is not a valid amount`);
    }
    if (decimal.lessThanOrEqualTo(0)) {
      throw new BadRequestException(`${field} must be greater than zero`);
    }
    return decimal;
  }

  private date(value: string, field: string): Date {
    const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field} is not a valid date`);
    return parsed;
  }

  private toResponse(voucher: {
    id: string;
    voucherNumber: string;
    voucherDate: Date;
    kind: CashVoucherKind;
    amount: Prisma.Decimal;
    currency: string;
    status: InvoiceStatus;
    description: string | null;
    reference: string | null;
    journalEntryId: string | null;
    postedAt: Date | null;
    reconciledAt: Date | null;
    createdAt: Date;
    cashAccount?: { code: string; nameEn: string; nameAr: string; kind?: string };
    customer?: { code: string; nameEn: string; nameAr: string } | null;
    supplier?: { code: string; nameEn: string; nameAr: string } | null;
  }) {
    return {
      id: voucher.id,
      voucherNumber: voucher.voucherNumber,
      voucherDate: voucher.voucherDate.toISOString().slice(0, 10),
      kind: voucher.kind.toLowerCase(),
      amount: voucher.amount.toFixed(MONEY_SCALE),
      currency: voucher.currency,
      status: voucher.status.toLowerCase(),
      description: voucher.description,
      reference: voucher.reference,
      cashAccount: voucher.cashAccount,
      customer: voucher.customer ?? null,
      supplier: voucher.supplier ?? null,
      journalEntryId: voucher.journalEntryId,
      postedAt: voucher.postedAt?.toISOString() ?? null,
      reconciledAt: voucher.reconciledAt?.toISOString() ?? null,
      createdAt: voucher.createdAt.toISOString(),
    };
  }
}
