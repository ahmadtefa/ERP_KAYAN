import { branchWhere } from '../../common/auth/branch-read-scope';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CashVoucherKind, InvoiceStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccountMapService } from '../accounting/account-map.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { PostingService } from '../accounting/posting.service';
import { CurrencyError, parseRate as parseFxRate, toBase } from '../currency/currency-rules';
import { applyWithholdingToLines, WithholdingError } from '../withholding/withholding-rules';

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
    branchScope: string[] | null = null,
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    const where: Prisma.CashVoucherWhereInput = { companyId, deletedAt: null, ...branchWhere(branchScope) };
    if (query.kind) {
      const kind = query.kind.toUpperCase();
      if (!Object.values(CashVoucherKind).includes(kind as CashVoucherKind)) {
        throw new BadRequestException({ code: 'VOUCHER_KIND_UNKNOWN', message: `Unknown voucher kind: ${query.kind}` });
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

  async findOne(companyId: string, id: string, branchScope: string[] | null = null) {
    const voucher = await this.prisma.cashVoucher.findFirst({
      where: { id, companyId, deletedAt: null, ...branchWhere(branchScope) },
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
    if (!voucher) throw new NotFoundException({ code: 'CASH_VOUCHER_NOT_FOUND', message: 'Cash voucher not found' });

    /// The other half of the chain. A receipt that settled two invoices is
    /// still one entry, and a reversed voucher has its mirror beside it; both
    /// hang off the id the voucher stored when it was posted. Without this the
    /// API stops at the allocation and the entry behind the money has to be
    /// found by hand in the ledger.
    const entries = voucher.journalEntryId
      ? await this.prisma.journalEntry.findMany({
          where: {
            companyId,
            OR: [{ id: voucher.journalEntryId }, { reversalOfId: voucher.journalEntryId }],
          },
          select: {
            id: true,
            entryNumber: true,
            entryDate: true,
            status: true,
            totalDebit: true,
            reversalOfId: true,
          },
        })
      : [];

    return {
      ...this.toResponse(voucher),
      allocations: voucher.allocations.map((allocation) => ({
        id: allocation.id,
        salesInvoiceId: allocation.salesInvoiceId,
        purchaseInvoiceId: allocation.purchaseInvoiceId,
        invoiceNumber:
          allocation.salesInvoice?.invoiceNumber ?? allocation.purchaseInvoice?.invoiceNumber ?? null,
        // What the invoice still owed when the money was applied, so a reader
        // can see the part payment was a part payment.
        invoiceTotal: (
          allocation.salesInvoice?.totalAmount ?? allocation.purchaseInvoice?.totalAmount ?? null
        )?.toFixed(MONEY_SCALE) ?? null,
        amount: allocation.amount.toFixed(MONEY_SCALE),
      })),
      journalEntries: entries
        .sort((a, b) => Number(Boolean(a.reversalOfId)) - Number(Boolean(b.reversalOfId)))
        .map((entry) => ({
          id: entry.id,
          entryNumber: entry.entryNumber,
          entryDate: entry.entryDate.toISOString().slice(0, 10),
          status: entry.status,
          amount: entry.totalDebit.toFixed(MONEY_SCALE),
          isReversal: Boolean(entry.reversalOfId),
        })),
    };
  }

  private async voucherRate(
    companyId: string,
    accountCurrency: string,
    dto: { exchangeRate?: string | number; allocations?: AllocationInput[] },
    party: { customerId: string | null; supplierId: string | null; counterAccountId: string | null },
    date: Date,
  ): Promise<{ rate: Prisma.Decimal; source: 'TYPED' | 'TABLE' } | null> {
    if (accountCurrency === 'EGP') return null;
    const [co] = await this.prisma.$queryRaw<{ currency: string }[]>(Prisma.sql`SELECT currency FROM companies WHERE id = ${companyId}::uuid`);
    if (accountCurrency === (co?.currency ?? 'EGP')) return null;
    // A receipt from a customer that settles foreign-currency sales invoices is the one
    // party voucher a foreign account may carry; create() checks the allocations.
    const settlesForeignSales = Boolean(party.customerId) && !party.supplierId && !party.counterAccountId && (dto.allocations ?? []).length > 0 &&
      (dto.allocations ?? []).every((a) => Boolean(a.salesInvoiceId) && !a.purchaseInvoiceId);
    if (!settlesForeignSales && (party.customerId || party.supplierId || (dto.allocations ?? []).length > 0)) {
      throw new BadRequestException({ code: 'VOUCHER_FX_NO_PARTY', message: 'A voucher on a foreign-currency account cannot name a customer or supplier or settle invoices' });
    }
    if (!party.counterAccountId && !settlesForeignSales) {
      throw new BadRequestException({ code: 'VOUCHER_NEEDS_COUNTERPART', message: 'Give the voucher a counter account' });
    }
    try {
      if (dto.exchangeRate !== undefined && String(dto.exchangeRate).trim() !== '') {
        return { rate: parseFxRate(dto.exchangeRate), source: 'TYPED' };
      }
      const on = date.toISOString().slice(0, 10);
      const [row] = await this.prisma.$queryRaw<{ rate: Prisma.Decimal }[]>(Prisma.sql`
        SELECT rate FROM exchange_rates WHERE "companyId" = ${companyId}::uuid AND "currencyCode" = ${accountCurrency} AND "rateDate" <= ${on}::date
         ORDER BY "rateDate" DESC LIMIT 1`);
      if (!row) throw new CurrencyError('FX_RATE_MISSING', 'No exchange rate has been entered for this currency on or before that date', { code: accountCurrency, date: on });
      return { rate: new Prisma.Decimal(row.rate), source: 'TABLE' };
    } catch (error) {
      if (error instanceof CurrencyError) {
        throw new BadRequestException({ code: error.code, message: error.message, ...(error.params ? { params: error.params } : {}) });
      }
      throw error;
    }
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
      costCenterId?: string | null;
      description?: string;
      reference?: string;
      allocations?: AllocationInput[];
      exchangeRate?: string | number;
    },
    options: { discloseBalance?: boolean } = {},
  ) {
    if (!branchId) {
      throw new BadRequestException({ code: 'USER_NO_BRANCH', message: 'The signed-in user is not assigned to a branch' });
    }

    const kind = String(dto.kind ?? '').toUpperCase() as CashVoucherKind;
    if (!Object.values(CashVoucherKind).includes(kind)) {
      throw new BadRequestException({ code: 'VOUCHER_KIND_UNKNOWN', message: 'kind must be RECEIPT or PAYMENT' });
    }

    const amount = this.positive(dto.amount, 'amount');
    const cashAccount = await this.requireCashAccount(companyId, dto.cashAccountId);
    if (!cashAccount.isActive) throw new BadRequestException({ code: 'CASH_ACCOUNT_INACTIVE', message: 'That cash account is inactive' });

    const date = this.date(dto.voucherDate, 'voucherDate');
    const party = await this.resolveParty(companyId, dto);

    // A voucher on a foreign-currency account is booked at a rate: typed on the voucher, or the
    // newest rate entered for that currency on or before the date. Nothing is ever guessed.
    // It names a counter account only: customer and supplier balances stay in company currency.
    const fx = await this.voucherRate(companyId, cashAccount.currency, dto, party, date);

    // The counter account is the only line a voucher can attribute: the
    // customer/supplier side is a balance, not a cost or a revenue.
    const costCenterId = dto.costCenterId ?? null;
    if (costCenterId) {
      const center = await this.prisma.costCenter.findFirst({
        where: { id: costCenterId, companyId, deletedAt: null },
        select: { id: true, isActive: true, code: true },
      });
      if (!center) throw new BadRequestException({ code: 'VOUCHER_COST_CENTER_MISSING', message: 'The cost center does not exist' });
      if (!center.isActive) {
        throw new BadRequestException(`Cost center ${center.code} is inactive`);
      }
      if (!party.counterAccountId) {
        throw new BadRequestException({ code: 'VOUCHER_COST_CENTER_NEEDS_COUNTER', message: 'A cost center can only be recorded on a voucher that names a counter account' });
      }
    }

    const allocations = dto.allocations ?? [];
    const allocationTotal = allocations.reduce(
      (sum, allocation) => sum.plus(this.positive(allocation.amount, 'allocation amount')),
      new Prisma.Decimal(0),
    );
    if (allocationTotal.greaterThan(amount)) {
      throw new BadRequestException({ code: 'VOUCHER_ALLOC_TOO_BIG', message: `The allocations (${allocationTotal.toFixed(MONEY_SCALE)}) are more than the voucher ` +
          `(${amount.toFixed(MONEY_SCALE)}). A voucher cannot pay more than it carries.` });
    }
    if (allocations.length > 0 && !party.customerId && !party.supplierId) {
      throw new BadRequestException({ code: 'VOUCHER_ALLOC_NEEDS_PARTY', message: 'A voucher can only be allocated against invoices when it names a customer or a supplier' });
    }
    if (allocations.length > 0 && fx) {
      if (kind !== CashVoucherKind.RECEIPT) {
        throw new BadRequestException({ code: 'SETTLE_SALES_NEEDS_RECEIPT', message: 'A sales invoice can only be settled by a receipt' });
      }
      if (!allocationTotal.equals(amount)) {
        throw new BadRequestException({ code: 'VOUCHER_FX_ALLOC_EXACT', message: 'A receipt in a foreign currency must be allocated in full to invoices in that currency' });
      }
      await this.validateForeignSettlement(companyId, cashAccount.currency, party, allocations);
    } else if (allocations.length > 0) {
      await this.validateAllocations(companyId, kind, cashAccount.currency, party, allocations);
    }

    // A payment the box cannot cover is refused now, at save, not later at
    // posting: the clerk hears about it while the entries are still on the
    // screen. Posting re-checks under a row lock, because the balance can
    // change between the two. The check is against the lowest running
    // balance from the voucher's date onward: a later-dated receipt cannot
    // fund this payment. Balance figures leave this method only for a user
    // the controller has confirmed may read them (cash.accounts.read).
    if (kind === CashVoucherKind.PAYMENT) {
      const needed = fx ? toBase(amount, fx.rate) : amount;
      const available = await this.posting.lowestCashBalanceFrom(
        this.prisma as never,
        companyId,
        cashAccount.accountId,
        date,
      );
      if (needed.greaterThan(available)) {
        if (options.discloseBalance) {
          throw new BadRequestException({
            code: 'CASH_SAVE_BALANCE_SHORT',
            message:
              `لم يُحفظ سند الصرف: أدنى رصيد تصل إليه الخزنة أو البنك (${cashAccount.code}) من تاريخ السند فصاعدًا هو ${available.toFixed(MONEY_SCALE)} والمبلغ المطلوب ${amount.toFixed(MONEY_SCALE)}. ` +
              `قلّل المبلغ إلى الرصيد المتاح أو سجّل سند قبض بتاريخ لا يتأخر عن سند الصرف، ثم احفظ مرة أخرى. لم يُنشأ أي سند. / ` +
              `The payment voucher was not saved: the cash or bank account (${cashAccount.code}) runs as low as ${available.toFixed(MONEY_SCALE)} from the voucher's date onward and the payment is ${amount.toFixed(MONEY_SCALE)}. ` +
              `Lower the amount to the available balance or record a receipt dated no later than the payment, then save again. No voucher was created.`,
            errors: {
              cashAccountCode: cashAccount.code,
              requested: needed.toFixed(MONEY_SCALE),
              available: available.toFixed(MONEY_SCALE),
            },
          });
        }
        throw new BadRequestException({
          code: 'CASH_SAVE_BALANCE_SHORT',
          message:
            `لم يُحفظ سند الصرف: رصيد الخزنة أو البنك (${cashAccount.code}) لا يكفي لهذا المبلغ في تاريخ السند. ` +
            `قلّل المبلغ أو سجّل سند قبض أولًا، ثم احفظ مرة أخرى. لم يُنشأ أي سند. / ` +
            `The payment voucher was not saved: the cash or bank account (${cashAccount.code}) cannot cover this amount at the voucher's date. ` +
            `Lower the amount or record a receipt first, then save again. No voucher was created.`,
          errors: { cashAccountCode: cashAccount.code },
        });
      }
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
          costCenterId,
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
      if (fx) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO voucher_exchange_rates ("voucherId", rate, "rateSource") VALUES (${voucher.id}::uuid, ${fx.rate.toString()}::numeric, ${fx.source})`);
      }
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
  async post(
    companyId: string,
    userId: string,
    id: string,
    options: { discloseBalance?: boolean } = {},
  ) {
    const voucher = await this.prisma.cashVoucher.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        allocations: true,
        cashAccount: { select: { id: true, accountId: true, isActive: true, code: true } },
      },
    });
    if (!voucher) throw new NotFoundException({ code: 'CASH_VOUCHER_NOT_FOUND', message: 'Cash voucher not found' });
    if (voucher.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException({ code: 'VOUCHER_NOT_DRAFT', message: `Only a draft voucher can be posted (current status: ${voucher.status})` });
    }
    if (!voucher.cashAccount.isActive) {
      throw new BadRequestException({ code: 'CASH_ACCOUNT_INACTIVE', message: 'That cash account is inactive' });
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
        throw new BadRequestException({ code: 'VOUCHER_POSTED_ELSEWHERE', message: 'This voucher has just been posted by someone else. Reload it to see the current state.' });
      }

      // A receipt on a foreign-currency account that names a customer settles foreign-currency
      // invoices: each allocation is a foreign amount, and the exchange difference is booked.
      const [voucherFx] = await tx.$queryRaw<{ rate: Prisma.Decimal }[]>(Prisma.sql`
        SELECT rate FROM voucher_exchange_rates WHERE "voucherId" = ${voucher.id}::uuid`);
      const settlementMode = Boolean(voucherFx) && Boolean(voucher.customerId) && voucher.allocations.length > 0;
      const voucherRate = voucherFx ? new Prisma.Decimal(voucherFx.rate) : null;
      const settled: Array<{ allocationId: string; base: Prisma.Decimal; foreign: Prisma.Decimal; diff: Prisma.Decimal }> = [];

      // ---- allocations: what the money settled
      let allocated = new Prisma.Decimal(0);
      for (const allocation of voucher.allocations) {
        if (settlementMode && voucherRate) {
          if (!allocation.salesInvoiceId || voucher.kind !== CashVoucherKind.RECEIPT) {
            throw new BadRequestException({ code: 'VOUCHER_FX_NO_PARTY', message: 'A voucher on a foreign-currency account cannot name a customer or supplier or settle invoices' });
          }
          const invoice = await tx.salesInvoice.findFirst({
            where: { id: allocation.salesInvoiceId, companyId, deletedAt: null },
            select: { id: true, invoiceNumber: true, customerId: true, totalAmount: true, paidAmount: true, status: true },
          });
          if (!invoice) throw new BadRequestException({ code: 'VOUCHER_INVOICE_MISSING', message: 'An allocation references a missing sales invoice' });
          if (invoice.status !== InvoiceStatus.POSTED) {
            throw new BadRequestException({ code: 'VOUCHER_INVOICE_NOT_POSTED', message: `Sales invoice ${invoice.invoiceNumber} is not posted, so it cannot be paid` });
          }
          if (invoice.customerId !== voucher.customerId) {
            throw new BadRequestException({ code: 'VOUCHER_INVOICE_OTHER_PARTY', message: `Sales invoice ${invoice.invoiceNumber} does not belong to this voucher's customer` });
          }
          const fxInvoice = await this.foreignDue(tx as never, companyId, invoice.id, true);
          if (!fxInvoice || fxInvoice.currency !== voucher.currency) {
            throw new BadRequestException({ code: 'VOUCHER_INVOICE_CURRENCY', message: `Sales invoice ${invoice.invoiceNumber} is not in ${voucher.currency}; this voucher moves ${voucher.currency}` });
          }
          const dueForeign = fxInvoice.foreignTotal.minus(fxInvoice.foreignPaid);
          if (allocation.amount.greaterThan(dueForeign)) {
            throw new BadRequestException({ code: 'VOUCHER_INVOICE_OVERPAID', message: `Sales invoice ${invoice.invoiceNumber} has only ${dueForeign.toFixed(MONEY_SCALE)} ${voucher.currency} left to pay; ${allocation.amount.toFixed(MONEY_SCALE)} was allocated to it.` });
          }
          // The receivable leaves the books at the invoice's own rate. The last payment clears
          // exactly what is left, so rounding never strands a few piastres on the invoice.
          const dueBase = invoice.totalAmount.minus(invoice.paidAmount);
          const baseSettled = allocation.amount.equals(dueForeign) ? dueBase : toBase(allocation.amount, fxInvoice.rate);
          if (baseSettled.greaterThan(dueBase)) {
            throw new BadRequestException({ code: 'VOUCHER_INVOICE_OVERPAID', message: `Sales invoice ${invoice.invoiceNumber} has only ${dueBase.toFixed(MONEY_SCALE)} left to pay` });
          }
          const cashBase = toBase(allocation.amount, voucherRate);
          settled.push({ allocationId: allocation.id, base: baseSettled, foreign: allocation.amount, diff: cashBase.minus(baseSettled) });
          await tx.salesInvoice.update({ where: { id: invoice.id }, data: { paidAmount: { increment: baseSettled } } });
          await tx.$executeRaw(Prisma.sql`
            UPDATE sales_invoice_fx SET "foreignPaid" = "foreignPaid" + ${allocation.amount.toFixed(4)}::numeric
             WHERE "invoiceId" = ${invoice.id}::uuid AND "companyId" = ${companyId}::uuid`);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO voucher_allocation_fx ("allocationId", "baseSettled", "foreignSettled", "exchangeDifference")
            VALUES (${allocation.id}::uuid, ${baseSettled.toFixed(4)}::numeric, ${allocation.amount.toFixed(4)}::numeric, ${cashBase.minus(baseSettled).toFixed(4)}::numeric)`);
          continue;
        }
        // A draft written before create() learned to check this could still
        // name both invoices (or neither); refuse to settle it either way.
        if (Boolean(allocation.salesInvoiceId) === Boolean(allocation.purchaseInvoiceId)) {
          throw new BadRequestException({ code: 'VOUCHER_ALLOC_ONE_INVOICE', message: 'Each allocation must name exactly one invoice' });
        }
        if (allocation.salesInvoiceId) {
          if (voucher.kind !== CashVoucherKind.RECEIPT) {
            throw new BadRequestException({ code: 'SETTLE_SALES_NEEDS_RECEIPT', message: 'A sales invoice can only be settled by a receipt' });
          }
          const invoice = await tx.salesInvoice.findFirst({
            where: { id: allocation.salesInvoiceId, companyId, deletedAt: null },
            select: {
              id: true,
              invoiceNumber: true,
              customerId: true,
              currency: true,
              totalAmount: true,
              paidAmount: true,
              status: true,
            },
          });
          if (!invoice) throw new BadRequestException({ code: 'VOUCHER_INVOICE_MISSING', message: 'An allocation references a missing sales invoice' });
          if (invoice.status !== InvoiceStatus.POSTED) {
            throw new BadRequestException({ code: 'VOUCHER_INVOICE_NOT_POSTED', message: `Sales invoice ${invoice.invoiceNumber} is not posted, so it cannot be paid` });
          }
          if (invoice.customerId !== voucher.customerId) {
            throw new BadRequestException({ code: 'VOUCHER_INVOICE_OTHER_PARTY', message: `Sales invoice ${invoice.invoiceNumber} does not belong to this voucher's customer` });
          }
          if (invoice.currency !== voucher.currency) {
            throw new BadRequestException({ code: 'VOUCHER_INVOICE_CURRENCY', message: `Sales invoice ${invoice.invoiceNumber} is in ${invoice.currency}; this voucher moves ${voucher.currency}` });
          }
          const due = invoice.totalAmount.minus(invoice.paidAmount);
          if (allocation.amount.greaterThan(due)) {
            throw new BadRequestException({ code: 'VOUCHER_INVOICE_OVERPAID', message: `Sales invoice ${invoice.invoiceNumber} has only ${due.toFixed(MONEY_SCALE)} left to pay; ` +
                `${allocation.amount.toFixed(MONEY_SCALE)} was allocated to it.` });
          }
          await tx.salesInvoice.update({
            where: { id: invoice.id },
            data: { paidAmount: { increment: allocation.amount } },
          });
          // Paid in company currency against a foreign-currency invoice: the foreign balance
          // follows at the invoice's own rate, and a fully paid invoice has no foreign balance left.
          const fxInvoice = await this.foreignDue(tx as never, companyId, invoice.id, true);
          if (fxInvoice) {
            const clears = invoice.totalAmount.minus(invoice.paidAmount).equals(allocation.amount);
            const share = clears
              ? fxInvoice.foreignTotal.minus(fxInvoice.foreignPaid)
              : Prisma.Decimal.min(
                  fxInvoice.foreignTotal.minus(fxInvoice.foreignPaid),
                  allocation.amount.div(fxInvoice.rate).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP),
                );
            await tx.$executeRaw(Prisma.sql`
              UPDATE sales_invoice_fx SET "foreignPaid" = "foreignPaid" + ${share.toFixed(4)}::numeric
               WHERE "invoiceId" = ${invoice.id}::uuid AND "companyId" = ${companyId}::uuid`);
          }
        }
        if (allocation.purchaseInvoiceId) {
          if (voucher.kind !== CashVoucherKind.PAYMENT) {
            throw new BadRequestException({ code: 'SETTLE_PURCHASE_NEEDS_PAYMENT', message: 'A purchase invoice can only be settled by a payment' });
          }
          const invoice = await tx.purchaseInvoice.findFirst({
            where: { id: allocation.purchaseInvoiceId, companyId, deletedAt: null },
            select: {
              id: true,
              invoiceNumber: true,
              supplierId: true,
              currency: true,
              totalAmount: true,
              paidAmount: true,
              status: true,
            },
          });
          if (!invoice) throw new BadRequestException({ code: 'VOUCHER_INVOICE_MISSING', message: 'An allocation references a missing purchase invoice' });
          if (invoice.status !== InvoiceStatus.POSTED) {
            throw new BadRequestException({ code: 'VOUCHER_INVOICE_NOT_POSTED', message: `Purchase invoice ${invoice.invoiceNumber} is not posted, so it cannot be paid` });
          }
          if (invoice.supplierId !== voucher.supplierId) {
            throw new BadRequestException({ code: 'VOUCHER_INVOICE_OTHER_PARTY', message: `Purchase invoice ${invoice.invoiceNumber} does not belong to this voucher's supplier` });
          }
          if (invoice.currency !== voucher.currency) {
            throw new BadRequestException({ code: 'VOUCHER_INVOICE_CURRENCY', message: `Purchase invoice ${invoice.invoiceNumber} is in ${invoice.currency}; this voucher moves ${voucher.currency}` });
          }
          const due = invoice.totalAmount.minus(invoice.paidAmount);
          if (allocation.amount.greaterThan(due)) {
            throw new BadRequestException({ code: 'VOUCHER_INVOICE_OVERPAID', message: `Purchase invoice ${invoice.invoiceNumber} has only ${due.toFixed(MONEY_SCALE)} left to pay; ` +
                `${allocation.amount.toFixed(MONEY_SCALE)} was allocated to it.` });
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
      const unallocated = settlementMode ? new Prisma.Decimal(0) : voucher.amount.minus(allocated);

      const lines: Array<{
        accountId: string;
        debit?: Prisma.Decimal;
        credit?: Prisma.Decimal;
        description: string;
        costCenterId?: string | null;
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
            costCenterId: voucher.costCenterId ?? null,
          });
        } else {
          throw new BadRequestException({ code: 'VOUCHER_NEEDS_COUNTERPART', message: 'Give the voucher a customer, a supplier or a counter account: the money has to come from somewhere.' });
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

      let cashAmount = voucher.amount;
      if (settlementMode && voucherRate) {
        // Booked in company currency: the receivable at the invoices' rates, the cash at the
        // receipt's rate, and the difference as a realised exchange gain or loss.
        const baseTotal = settled.reduce((sum, row) => sum.plus(row.base), new Prisma.Decimal(0));
        const diffTotal = settled.reduce((sum, row) => sum.plus(row.diff), new Prisma.Decimal(0));
        cashAmount = baseTotal.plus(diffTotal);
        lines.push({ accountId: accounts.accountsReceivable, credit: baseTotal, description: 'Settlement of foreign-currency sales invoices' });
        // Only a settlement with a real difference needs the exchange accounts; an ordinary
        // receipt must not depend on them existing.
        const fxAccounts = diffTotal.isZero()
          ? null
          : await this.accounts.resolve(tx as never, companyId, ['exchangeGain', 'exchangeLoss']);
        if (fxAccounts && diffTotal.greaterThan(0)) {
          lines.push({ accountId: fxAccounts.exchangeGain, credit: diffTotal, description: 'Realised exchange gain' });
        } else if (fxAccounts && diffTotal.lessThan(0)) {
          lines.push({ accountId: fxAccounts.exchangeLoss, debit: diffTotal.neg(), description: 'Realised exchange loss' });
        }
      }

      // The cash side always carries the full amount.
      lines.push({
        accountId: voucher.cashAccount.accountId,
        debit: voucher.kind === CashVoucherKind.RECEIPT ? cashAmount : undefined,
        credit: voucher.kind === CashVoucherKind.PAYMENT ? cashAmount : undefined,
        description: voucher.kind === CashVoucherKind.RECEIPT ? 'Receipt' : 'Payment',
      });

      // Withholding tax set on this draft: the cash side carries only the net,
      // and the tax goes to the account its rate names. The voucher amount and
      // the invoices it settles stay gross.
      const [withholding] = await tx.$queryRaw<
        { amount: Prisma.Decimal; direction: 'PAYABLE' | 'RECEIVABLE'; accountId: string }[]
      >(Prisma.sql`SELECT amount, direction, "accountId" FROM voucher_withholdings WHERE "voucherId" = ${voucher.id}::uuid`);
      let journalLines = lines;
      if (withholding) {
        try {
          journalLines = applyWithholdingToLines(
            lines,
            voucher.cashAccount.accountId,
            withholding.direction,
            new Prisma.Decimal(withholding.amount),
            withholding.accountId,
          );
        } catch (error) {
          if (error instanceof WithholdingError) throw new BadRequestException({ code: error.code ?? 'WITHHOLDING_NOT_APPLICABLE', message: error.message });
          throw error;
        }
      }

      const fxRow = voucherFx;
      if (fxRow && withholding) {
        throw new BadRequestException({ code: 'VOUCHER_FX_WITHHOLDING', message: 'Withholding tax is not supported on a foreign-currency voucher' });
      }
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
        currency: settlementMode ? undefined : voucher.currency,
        lines: journalLines,
        ...(fxRow && !settlementMode ? { fx: { currency: voucher.currency, rate: new Prisma.Decimal(fxRow.rate) } } : {}),
        discloseBalance: options.discloseBalance,
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
  async reverse(
    companyId: string,
    userId: string,
    id: string,
    reason?: string,
    options: { discloseBalance?: boolean } = {},
  ) {
    const voucher = await this.prisma.cashVoucher.findFirst({
      where: { id, companyId, deletedAt: null },
      include: { allocations: true },
    });
    if (!voucher) throw new NotFoundException({ code: 'CASH_VOUCHER_NOT_FOUND', message: 'Cash voucher not found' });
    if (voucher.status !== InvoiceStatus.POSTED || !voucher.journalEntryId) {
      throw new BadRequestException({ code: 'ONLY_POSTED_REVERSE', message: 'Only a posted voucher can be reversed' });
    }

    const journal = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.cashVoucher.updateMany({
        where: { id: voucher.id, status: InvoiceStatus.POSTED },
        data: { status: InvoiceStatus.REVERSED },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException({ code: 'VOUCHER_CHANGED_RELOAD', message: 'This voucher has just been changed by someone else.' });
      }

      for (const allocation of voucher.allocations) {
        if (allocation.salesInvoiceId) {
          // A receipt that settled a foreign-currency invoice gives back exactly what it took,
          // in company currency and in the invoice's own currency.
          const [taken] = await tx.$queryRaw<Array<{ baseSettled: Prisma.Decimal; foreignSettled: Prisma.Decimal }>>(Prisma.sql`
            SELECT "baseSettled", "foreignSettled" FROM voucher_allocation_fx WHERE "allocationId" = ${allocation.id}::uuid`);
          if (taken) {
            await tx.salesInvoice.update({
              where: { id: allocation.salesInvoiceId },
              data: { paidAmount: { decrement: new Prisma.Decimal(taken.baseSettled) } },
            });
            await tx.$executeRaw(Prisma.sql`
              UPDATE sales_invoice_fx SET "foreignPaid" = "foreignPaid" - ${new Prisma.Decimal(taken.foreignSettled).toFixed(4)}::numeric
               WHERE "invoiceId" = ${allocation.salesInvoiceId}::uuid`);
          } else {
            await tx.salesInvoice.update({
              where: { id: allocation.salesInvoiceId },
              data: { paidAmount: { decrement: allocation.amount } },
            });
            const fxInvoice = await this.foreignDue(tx as never, companyId, allocation.salesInvoiceId, true);
            if (fxInvoice) {
              // Company-currency receipt on a foreign invoice: put its foreign share back.
              const [inv] = await tx.$queryRaw<Array<{ totalAmount: Prisma.Decimal; paidAmount: Prisma.Decimal }>>(Prisma.sql`
                SELECT "totalAmount", "paidAmount" FROM sales_invoices WHERE id = ${allocation.salesInvoiceId}::uuid`);
              const paidBase = new Prisma.Decimal(inv.paidAmount);
              const target = paidBase.lessThanOrEqualTo(0)
                ? new Prisma.Decimal(0)
                : Prisma.Decimal.min(fxInvoice.foreignTotal, paidBase.div(fxInvoice.rate).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP));
              await tx.$executeRaw(Prisma.sql`
                UPDATE sales_invoice_fx SET "foreignPaid" = ${target.toFixed(4)}::numeric WHERE "invoiceId" = ${allocation.salesInvoiceId}::uuid`);
            }
          }
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
        new Date(),
        options.discloseBalance,
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

  /**
   * Everything an allocation claims, checked before the draft is stored, so a
   * bad claim is rejected where it is made instead of surfacing at posting:
   *
   *  - each row names exactly one invoice: naming both would settle the same
   *    money twice, naming neither would book a settlement against nothing;
   *  - a receipt settles sales invoices and a payment settles purchase
   *    invoices; the other pairing would post the control account backwards;
   *  - the invoice exists in this company, belongs to the voucher's own
   *    customer or supplier, and is kept in the cash account's currency;
   *  - a reversed invoice is never payable again;
   *  - repeated rows against one invoice are summed before they are compared
   *    with what the invoice is still owed, so two half-claims cannot add up
   *    to more than the invoice.
   *
   * A draft invoice may be named here: it can still be posted before the
   * voucher is, and posting is what finally requires POSTED.
   */
  /** The foreign amount a foreign-currency invoice still owes, or null for an ordinary invoice. */
  private async foreignDue(
    q: { $queryRaw: <T>(sql: Prisma.Sql) => Promise<T> },
    companyId: string,
    invoiceId: string,
    lock = false,
  ): Promise<{ currency: string; rate: Prisma.Decimal; foreignTotal: Prisma.Decimal; foreignPaid: Prisma.Decimal } | null> {
    const rows = await q.$queryRaw<Array<{ currency: string; rate: Prisma.Decimal; foreignTotal: Prisma.Decimal; foreignPaid: Prisma.Decimal }>>(
      lock
        ? Prisma.sql`SELECT currency, rate, "foreignTotal", "foreignPaid" FROM sales_invoice_fx WHERE "invoiceId" = ${invoiceId}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`
        : Prisma.sql`SELECT currency, rate, "foreignTotal", "foreignPaid" FROM sales_invoice_fx WHERE "invoiceId" = ${invoiceId}::uuid AND "companyId" = ${companyId}::uuid`,
    );
    if (!rows[0]) return null;
    return {
      currency: rows[0].currency,
      rate: new Prisma.Decimal(rows[0].rate),
      foreignTotal: new Prisma.Decimal(rows[0].foreignTotal),
      foreignPaid: new Prisma.Decimal(rows[0].foreignPaid),
    };
  }

  /** Save-time check of a foreign receipt: every allocation names a posted invoice of this customer in this currency, within what is still owed. */
  private async validateForeignSettlement(
    companyId: string,
    currency: string,
    party: { customerId: string | null },
    allocations: AllocationInput[],
  ): Promise<void> {
    const owed = new Map<string, Prisma.Decimal>();
    for (const allocation of allocations) {
      const id = allocation.salesInvoiceId as string;
      const invoice = await this.prisma.salesInvoice.findFirst({
        where: { id, companyId, deletedAt: null },
        select: { id: true, invoiceNumber: true, customerId: true, status: true },
      });
      if (!invoice) throw new BadRequestException({ code: 'VOUCHER_INVOICE_MISSING', message: 'An allocation references a missing sales invoice' });
      if (invoice.customerId !== party.customerId) {
        throw new BadRequestException({ code: 'VOUCHER_INVOICE_OTHER_PARTY', message: `Sales invoice ${invoice.invoiceNumber} does not belong to this voucher's customer` });
      }
      if (invoice.status !== InvoiceStatus.POSTED) {
        throw new BadRequestException({ code: 'VOUCHER_INVOICE_NOT_POSTED', message: `Sales invoice ${invoice.invoiceNumber} is not posted, so it cannot be paid` });
      }
      const fxInvoice = await this.foreignDue(this.prisma as never, companyId, id);
      if (!fxInvoice || fxInvoice.currency !== currency) {
        throw new BadRequestException({ code: 'VOUCHER_INVOICE_CURRENCY', message: `Sales invoice ${invoice.invoiceNumber} is not in ${currency}; this voucher moves ${currency}` });
      }
      const used = (owed.get(id) ?? new Prisma.Decimal(0)).plus(this.positive(allocation.amount, 'allocation amount'));
      owed.set(id, used);
      const due = fxInvoice.foreignTotal.minus(fxInvoice.foreignPaid);
      if (used.greaterThan(due)) {
        throw new BadRequestException({ code: 'VOUCHER_INVOICE_OVERPAID', message: `Sales invoice ${invoice.invoiceNumber} has only ${due.toFixed(MONEY_SCALE)} ${currency} left to pay; ${used.toFixed(MONEY_SCALE)} was allocated to it.` });
      }
    }
  }

  private async validateAllocations(
    companyId: string,
    kind: CashVoucherKind,
    currency: string,
    party: { customerId: string | null; supplierId: string | null },
    allocations: AllocationInput[],
  ): Promise<void> {
    for (const allocation of allocations) {
      const sales = Boolean(allocation.salesInvoiceId);
      const purchase = Boolean(allocation.purchaseInvoiceId);
      if (sales === purchase) {
        throw new BadRequestException({ code: 'VOUCHER_ALLOC_ONE_INVOICE', message: 'Each allocation must name exactly one invoice' });
      }
      if (sales && kind !== CashVoucherKind.RECEIPT) {
        throw new BadRequestException({ code: 'SETTLE_SALES_NEEDS_RECEIPT', message: 'A sales invoice can only be settled by a receipt' });
      }
      if (purchase && kind !== CashVoucherKind.PAYMENT) {
        throw new BadRequestException({ code: 'SETTLE_PURCHASE_NEEDS_PAYMENT', message: 'A purchase invoice can only be settled by a payment' });
      }
    }

    const salesIds = [
      ...new Set(
        allocations.filter((a) => a.salesInvoiceId).map((a) => a.salesInvoiceId as string),
      ),
    ];
    if (salesIds.length > 0) {
      const invoices = await this.prisma.salesInvoice.findMany({
        where: { id: { in: salesIds }, companyId, deletedAt: null },
        select: {
          id: true,
          invoiceNumber: true,
          customerId: true,
          status: true,
          currency: true,
          totalAmount: true,
          paidAmount: true,
        },
      });
      const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));
      for (const id of salesIds) {
        if (!byId.has(id)) {
          throw new BadRequestException({ code: 'VOUCHER_INVOICE_MISSING', message: 'An allocation references a missing sales invoice' });
        }
      }
      for (const invoice of invoices) {
        if (invoice.customerId !== party.customerId) {
          throw new BadRequestException({ code: 'VOUCHER_INVOICE_OTHER_PARTY', message: `Sales invoice ${invoice.invoiceNumber} does not belong to this voucher's customer` });
        }
        this.assertAllocatable(invoice, 'Sales invoice', currency);
      }
      this.assertWithinDue(
        allocations.filter((a) => a.salesInvoiceId),
        (a) => a.salesInvoiceId as string,
        byId,
        'Sales invoice',
      );
    }

    const purchaseIds = [
      ...new Set(
        allocations.filter((a) => a.purchaseInvoiceId).map((a) => a.purchaseInvoiceId as string),
      ),
    ];
    if (purchaseIds.length > 0) {
      const invoices = await this.prisma.purchaseInvoice.findMany({
        where: { id: { in: purchaseIds }, companyId, deletedAt: null },
        select: {
          id: true,
          invoiceNumber: true,
          supplierId: true,
          status: true,
          currency: true,
          totalAmount: true,
          paidAmount: true,
        },
      });
      const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));
      for (const id of purchaseIds) {
        if (!byId.has(id)) {
          throw new BadRequestException({ code: 'VOUCHER_INVOICE_MISSING', message: 'An allocation references a missing purchase invoice' });
        }
      }
      for (const invoice of invoices) {
        if (invoice.supplierId !== party.supplierId) {
          throw new BadRequestException({ code: 'VOUCHER_INVOICE_OTHER_PARTY', message: `Purchase invoice ${invoice.invoiceNumber} does not belong to this voucher's supplier` });
        }
        this.assertAllocatable(invoice, 'Purchase invoice', currency);
      }
      this.assertWithinDue(
        allocations.filter((a) => a.purchaseInvoiceId),
        (a) => a.purchaseInvoiceId as string,
        byId,
        'Purchase invoice',
      );
    }
  }

  private assertAllocatable(
    invoice: {
      invoiceNumber: string;
      status: InvoiceStatus;
      currency: string;
    },
    label: string,
    currency: string,
  ): void {
    if (invoice.status === InvoiceStatus.REVERSED) {
      throw new BadRequestException({ code: 'VOUCHER_INVOICE_REVERSED', message: `${label} ${invoice.invoiceNumber} has been reversed, so it cannot be paid` });
    }
    if (invoice.currency !== currency) {
      throw new BadRequestException({ code: 'VOUCHER_INVOICE_CURRENCY', message: `${label} ${invoice.invoiceNumber} is in ${invoice.currency}; this voucher moves ${currency}` });
    }
  }

  private assertWithinDue(
    allocations: AllocationInput[],
    invoiceId: (allocation: AllocationInput) => string,
    byId: Map<
      string,
      { invoiceNumber: string; totalAmount: Prisma.Decimal; paidAmount: Prisma.Decimal }
    >,
    label: string,
  ): void {
    const claimed = new Map<string, Prisma.Decimal>();
    for (const allocation of allocations) {
      const id = invoiceId(allocation);
      const amount = this.positive(allocation.amount, 'allocation amount');
      claimed.set(id, (claimed.get(id) ?? new Prisma.Decimal(0)).plus(amount));
    }
    for (const [id, total] of claimed) {
      const invoice = byId.get(id) as {
        invoiceNumber: string;
        totalAmount: Prisma.Decimal;
        paidAmount: Prisma.Decimal;
      };
      const due = invoice.totalAmount.minus(invoice.paidAmount);
      if (total.greaterThan(due)) {
        throw new BadRequestException({ code: 'VOUCHER_INVOICE_OVERPAID', message: `${label} ${invoice.invoiceNumber} has only ${due.toFixed(MONEY_SCALE)} left to pay; ` +
            `${total.toFixed(MONEY_SCALE)} was allocated to it.` });
      }
    }
  }

  private async requireCashAccount(companyId: string, id: string) {
    // Prisma treats an absent filter value as "no filter", so a voucher that
    // did not name a box used to be recorded against the first one. Money
    // must always say which box it moved through.
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new BadRequestException({ code: 'VOUCHER_CASH_ACCOUNT_REQUIRED', message: 'Choose the cash account the money moved through' });
    }
    const cashAccount = await this.prisma.cashAccount.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true, accountId: true, currency: true, isActive: true, code: true },
    });
    if (!cashAccount) throw new BadRequestException({ code: 'CASH_ACCOUNT_MISSING', message: 'The cash account does not exist' });
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
      if (!customer) throw new BadRequestException({ code: 'CUSTOMER_MISSING', message: 'The customer does not exist' });
      if (!customer.isActive) throw new BadRequestException({ code: 'CUSTOMER_INACTIVE', message: 'The customer is inactive' });
    }
    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: dto.supplierId, companyId, deletedAt: null },
        select: { id: true, isActive: true },
      });
      if (!supplier) throw new BadRequestException({ code: 'SUPPLIER_MISSING', message: 'The supplier does not exist' });
      if (!supplier.isActive) throw new BadRequestException({ code: 'SUPPLIER_INACTIVE', message: 'The supplier is inactive' });
    }
    if (dto.counterAccountId) {
      const account = await this.prisma.account.findFirst({
        where: { id: dto.counterAccountId, companyId, deletedAt: null },
        select: { id: true, code: true, isPostable: true, isActive: true },
      });
      if (!account) throw new BadRequestException({ code: 'ACCOUNT_MISSING', message: 'The counter account does not exist' });
      if (!account.isPostable) {
        throw new BadRequestException(`Account ${account.code} is a grouping account`);
      }
      if (!account.isActive) throw new BadRequestException(`Account ${account.code} is inactive`);
    }

    const parties = [dto.customerId, dto.supplierId].filter(Boolean).length;
    if (parties > 1) {
      throw new BadRequestException({ code: 'VOUCHER_PARTY_BOTH', message: 'A voucher is against a customer or a supplier, not both' });
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
      throw new BadRequestException({ code: 'FIELD_BAD_NUMBER', message: `${field} is not a valid amount`, field });
    }
    if (decimal.lessThanOrEqualTo(0)) {
      throw new BadRequestException({ code: 'FIELD_POSITIVE', message: `${field} must be greater than zero`, field });
    }
    return decimal;
  }

  private date(value: string, field: string): Date {
    const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException({ code: 'FIELD_BAD_DATE', message: `${field} is not a valid date`, field });
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
    costCenterId?: string | null;
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
      costCenterId: voucher.costCenterId ?? null,
      journalEntryId: voucher.journalEntryId,
      postedAt: voucher.postedAt?.toISOString() ?? null,
      reconciledAt: voucher.reconciledAt?.toISOString() ?? null,
      createdAt: voucher.createdAt.toISOString(),
    };
  }
}
