import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const MONEY_SCALE = 4;
export type PartyKind = 'customer' | 'supplier';

/**
 * Customers and suppliers differ only in a credit limit, so they share one
 * service and are separated by which table is addressed. Keeping the two code
 * paths identical avoids the classic bug where one learns a fix and the other
 * does not.
 */
@Injectable()
export class PartiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private model(kind: PartyKind) {
    return kind === 'customer' ? this.prisma.customer : this.prisma.supplier;
  }

  async findAll(
    companyId: string,
    kind: PartyKind,
    query: {
      q?: string;
      includeInactive?: boolean;
      page?: number;
      pageSize?: number;
      sort?: string;
      dir?: string;
    },
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);

    const where: Prisma.CustomerWhereInput = { companyId, deletedAt: null };
    if (!query.includeInactive) where.isActive = true;
    if (query.q?.trim()) {
      const q = query.q.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { nameEn: { contains: q, mode: 'insensitive' } },
        { nameAr: { contains: q } },
        { phone: { contains: q } },
      ];
    }

    const sortField =
      query.sort === 'name'
        ? 'nameEn'
        : query.sort === 'createdAt'
          ? 'createdAt'
          : 'code';
    const direction: 'asc' | 'desc' = query.dir === 'desc' ? 'desc' : 'asc';

    const model = this.model(kind) as any;
    const [items, total] = await this.prisma.$transaction([
      model.findMany({
        where,
        orderBy: { [sortField]: direction },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      model.count({ where }),
    ]);

    return {
      items: items.map((i: any) => this.toResponse(i)),
      total,
      page,
      pageSize,
    };
  }

  async findOne(companyId: string, kind: PartyKind, id: string) {
    const model = this.model(kind) as any;
    const row = await model.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!row) throw new NotFoundException(`${kind} not found`);
    return this.toResponse(row);
  }

  /**
   * The partner's card: how much has been traded, what is still open, and the
   * last documents - everything the list screen shows when a row is opened.
   */
  async summary(companyId: string, kind: PartyKind, id: string) {
    const model = this.model(kind) as any;
    const row = await model.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!row) throw new NotFoundException(`${kind} not found`);

    const invoices =
      kind === 'customer'
        ? await this.prisma.salesInvoice.findMany({
            where: {
              companyId,
              customerId: id,
              deletedAt: null,
              status: 'POSTED',
              documentType: 'INVOICE',
            },
            select: {
              id: true,
              invoiceNumber: true,
              invoiceDate: true,
              dueDate: true,
              totalAmount: true,
              paidAmount: true,
              status: true,
            },
            orderBy: { invoiceDate: 'desc' },
          })
        : await this.prisma.purchaseInvoice.findMany({
            where: {
              companyId,
              supplierId: id,
              deletedAt: null,
              status: 'POSTED',
              documentType: 'INVOICE',
            },
            select: {
              id: true,
              invoiceNumber: true,
              invoiceDate: true,
              dueDate: true,
              totalAmount: true,
              paidAmount: true,
              status: true,
            },
            orderBy: { invoiceDate: 'desc' },
          });

    const vouchers = await this.prisma.cashVoucher.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: 'POSTED',
        ...(kind === 'customer' ? { customerId: id } : { supplierId: id }),
      },
      select: {
        id: true,
        voucherNumber: true,
        voucherDate: true,
        kind: true,
        amount: true,
        status: true,
        // What each voucher settled. Whatever it did not settle is money on
        // the partner's account, and leaving it out is how a card ends up
        // disagreeing with the statement and with the control account.
        allocations: { select: { amount: true } },
      },
      orderBy: { voucherDate: 'desc' },
    });

    /// A receipt is a customer's money in our hands; a payment to a customer is
    /// a refund and works the other way. For a supplier it is the mirror image.
    /// Everything below that has a direction is read through this one kind.
    const creditKind = kind === 'customer' ? 'RECEIPT' : 'PAYMENT';

    const totalInvoiced = invoices.reduce((sum, inv) => sum.plus(inv.totalAmount), new Prisma.Decimal(0));
    /// How much the partner's documents have been settled. Positive for both
    /// kinds: for a customer it is what they paid us, for a supplier what we
    /// paid them. A refund in the other direction reduces it.
    const totalPaid = vouchers.reduce(
      (sum, voucher) =>
        voucher.kind === creditKind ? sum.plus(voucher.amount) : sum.minus(voucher.amount),
      new Prisma.Decimal(0),
    );
    const outstanding = invoices.reduce(
      (sum, inv) => sum.plus(inv.totalAmount).minus(inv.paidAmount),
      new Prisma.Decimal(0),
    );
    const overdue = invoices
      .filter(
        (inv) =>
          inv.dueDate &&
          inv.dueDate.getTime() < Date.now() &&
          inv.totalAmount.minus(inv.paidAmount).isPositive(),
      )
      .reduce((sum, inv) => sum.plus(inv.totalAmount).minus(inv.paidAmount), new Prisma.Decimal(0));

    /// Money this partner has with us (a customer receipt) or we have with them
    /// (a supplier payment) that no invoice claimed. It sits on the control
    /// account, so `outstanding` alone is not the balance: the balance is what
    /// is still owed on invoices less what has already been paid on account.
    const onAccount = vouchers.reduce((sum, voucher) => {
      const settled = voucher.allocations.reduce(
        (allocated, allocation) => allocated.plus(allocation.amount),
        new Prisma.Decimal(0),
      );
      const loose = voucher.amount.minus(settled);
      if (!loose.isPositive()) return sum;
      return voucher.kind === creditKind ? sum.plus(loose) : sum.minus(loose);
    }, new Prisma.Decimal(0));
    const netBalance = outstanding.minus(onAccount);

    const recentDocuments = [
      ...invoices.slice(0, 5).map((inv) => ({
        kind: kind === 'customer' ? 'SALES_INVOICE' : 'PURCHASE_INVOICE',
        id: inv.id,
        number: inv.invoiceNumber,
        date: inv.invoiceDate.toISOString().slice(0, 10),
        amount: inv.totalAmount.toFixed(MONEY_SCALE),
        status: inv.status,
      })),
      ...vouchers.slice(0, 5).map((voucher) => ({
        kind: voucher.kind === 'RECEIPT' ? 'CASH_RECEIPT' : 'CASH_PAYMENT',
        id: voucher.id,
        number: voucher.voucherNumber,
        date: voucher.voucherDate.toISOString().slice(0, 10),
        amount: voucher.amount.toFixed(MONEY_SCALE),
        status: voucher.status,
      })),
    ]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 8);

    return {
      party: this.toResponse(row),
      totals: {
        invoiced: totalInvoiced.toFixed(MONEY_SCALE),
        paid: totalPaid.toFixed(MONEY_SCALE),
        outstanding: outstanding.toFixed(MONEY_SCALE),
        /// Positive when the partner has left money with us (a customer
        /// credit or a supplier prepayment). Kept separate from `outstanding`
        /// so a reader can see both what is unpaid and what is already paid.
        onAccount: onAccount.toFixed(MONEY_SCALE),
        /// outstanding - onAccount: the figure the statement closes on and the
        /// one the control account carries.
        netBalance: netBalance.toFixed(MONEY_SCALE),
        overdue: overdue.toFixed(MONEY_SCALE),
        invoices: invoices.length,
        vouchers: vouchers.length,
        lastActivity:
          recentDocuments.length > 0 ? recentDocuments[0].date : null,
      },
      recentDocuments,
    };
  }

  /**
   * Statement of account (كشف حساب): every movement in the period with a
   * running balance, plus the opening balance from everything before it.
   *
   * For a customer, an invoice is a debit (they owe more) and a receipt is a
   * credit (they paid). For a supplier it is the other way round: a purchase
   * invoice is a credit (we owe more) and a payment is a debit.
   */
  async statement(
    companyId: string,
    kind: PartyKind,
    id: string,
    query: { from?: string; to?: string },
  ) {
    const model = this.model(kind) as any;
    const row = await model.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!row) throw new NotFoundException(`${kind} not found`);

    const to = query.to ? new Date(`${query.to.slice(0, 10)}T23:59:59.999Z`) : new Date();
    const from = query.from
      ? new Date(`${query.from.slice(0, 10)}T00:00:00.000Z`)
      : new Date(0);

    const invoiceWhere = {
      companyId,
      deletedAt: null,
      status: 'POSTED',
      ...(kind === 'customer' ? { customerId: id } : { supplierId: id }),
    } as const;

    const [invoices, vouchers] = await Promise.all([
      kind === 'customer'
        ? this.prisma.salesInvoice.findMany({
            where: invoiceWhere,
            select: {
              id: true,
              invoiceNumber: true,
              invoiceDate: true,
              totalAmount: true,
              documentType: true,
              notes: true,
            },
            orderBy: { invoiceDate: 'asc' },
          })
        : this.prisma.purchaseInvoice.findMany({
            where: invoiceWhere,
            select: {
              id: true,
              invoiceNumber: true,
              invoiceDate: true,
              totalAmount: true,
              documentType: true,
              notes: true,
            },
            orderBy: { invoiceDate: 'asc' },
          }),
      this.prisma.cashVoucher.findMany({
        where: {
          companyId,
          deletedAt: null,
          status: 'POSTED',
          ...(kind === 'customer' ? { customerId: id } : { supplierId: id }),
        },
        select: {
          id: true,
          voucherNumber: true,
          voucherDate: true,
          kind: true,
          amount: true,
          description: true,
        },
        orderBy: { voucherDate: 'asc' },
      }),
    ]);

    type Entry = {
      date: Date;
      type: string;
      id: string;
      number: string;
      description: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
    };
    const all: Entry[] = [];
    for (const invoice of invoices) {
      const isReturn = invoice.documentType !== 'INVOICE';
      const amount = invoice.totalAmount;
      const debit =
        kind === 'customer'
          ? isReturn
            ? new Prisma.Decimal(0)
            : amount
          : isReturn
            ? amount
            : new Prisma.Decimal(0);
      const credit =
        kind === 'customer'
          ? isReturn
            ? amount
            : new Prisma.Decimal(0)
          : isReturn
            ? new Prisma.Decimal(0)
            : amount;
      all.push({
        date: invoice.invoiceDate,
        type: isReturn
          ? kind === 'customer'
            ? 'CREDIT_NOTE'
            : 'DEBIT_NOTE'
          : kind === 'customer'
            ? 'SALES_INVOICE'
            : 'PURCHASE_INVOICE',
        id: invoice.id,
        number: invoice.invoiceNumber,
        description: invoice.notes ?? '',
        debit,
        credit,
      });
    }
    for (const voucher of vouchers) {
      // The ledger moves the party's account the same way for both kinds of
      // partner: a receipt credits them (they paid / we received), a payment
      // debits them (we paid / they received). See the voucher posting.
      const isReceipt = voucher.kind === 'RECEIPT';
      const debit = isReceipt ? new Prisma.Decimal(0) : voucher.amount;
      const credit = isReceipt ? voucher.amount : new Prisma.Decimal(0);
      all.push({
        date: voucher.voucherDate,
        type: isReceipt ? 'CASH_RECEIPT' : 'CASH_PAYMENT',
        id: voucher.id,
        number: voucher.voucherNumber,
        description: voucher.description ?? '',
        debit,
        credit,
      });
    }
    all.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Everything before the period is the opening balance; Decimal is
    // immutable, so it is one explicit sum.
    const openingBalance = all
      .filter((entry) => entry.date.getTime() < from.getTime())
      .reduce((sum, entry) => sum.plus(entry.debit).minus(entry.credit), new Prisma.Decimal(0));

    const period = all.filter(
      (entry) =>
        entry.date.getTime() >= from.getTime() && entry.date.getTime() <= to.getTime(),
    );

    let running = openingBalance;
    const rows = period.map((entry) => {
      running = running.plus(entry.debit).minus(entry.credit);
      return {
        date: entry.date.toISOString().slice(0, 10),
        type: entry.type,
        id: entry.id,
        number: entry.number,
        description: entry.description,
        debit: entry.debit.toFixed(MONEY_SCALE),
        credit: entry.credit.toFixed(MONEY_SCALE),
        balance: running.toFixed(MONEY_SCALE),
      };
    });

    const totalDebit = period.reduce((sum, entry) => sum.plus(entry.debit), new Prisma.Decimal(0));
    const totalCredit = period.reduce((sum, entry) => sum.plus(entry.credit), new Prisma.Decimal(0));

    return {
      party: this.toResponse(row),
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      openingBalance: openingBalance.toFixed(MONEY_SCALE),
      totalDebit: totalDebit.toFixed(MONEY_SCALE),
      totalCredit: totalCredit.toFixed(MONEY_SCALE),
      closingBalance: running.toFixed(MONEY_SCALE),
      rows,
    };
  }

  async create(
    companyId: string,
    userId: string,
    kind: PartyKind,
    body: object,
  ) {
    const dto = body as Record<string, any>;
    const code = String(dto.code ?? '').trim();
    if (!code) throw new BadRequestException('code is required');

    const model = this.model(kind) as any;
    const existing = await model.findFirst({
      where: { companyId, code },
      select: { id: true, deletedAt: true },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`${kind} code ${code} is already used`);
    }

    const data: Record<string, unknown> = {
      companyId,
      code,
      nameEn: dto.nameEn,
      nameAr: dto.nameAr,
      phone: (dto.phone as string) ?? null,
      email: (dto.email as string) ?? null,
      taxNumber: (dto.taxNumber as string) ?? null,
      address: (dto.address as string) ?? null,
      notes: (dto.notes as string) ?? null,
      paymentTermDays: this.paymentTerm(dto.paymentTermDays),
      createdBy: userId,
      updatedBy: userId,
    };
    if (kind === 'customer' && dto.creditLimit !== undefined) {
      data.creditLimit = this.money(dto.creditLimit, 'creditLimit');
    }

    const created = await model.create({ data });

    await this.audit.record({
      companyId,
      userId,
      action: 'CREATE',
      entity: kind === 'customer' ? 'customers' : 'suppliers',
      entityId: created.id,
      after: { code: created.code, nameEn: created.nameEn },
    });

    return this.toResponse(created);
  }

  async update(
    companyId: string,
    userId: string,
    kind: PartyKind,
    id: string,
    body: object,
  ) {
    const dto = body as Record<string, any>;
    const model = this.model(kind) as any;
    const before = await model.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!before) throw new NotFoundException(`${kind} not found`);

    const data: Record<string, unknown> = { updatedBy: userId };
    for (const key of [
      'nameEn',
      'nameAr',
      'phone',
      'email',
      'taxNumber',
      'address',
      'notes',
      'isActive',
    ]) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    if (kind === 'customer' && dto.creditLimit !== undefined) {
      data.creditLimit = this.money(dto.creditLimit, 'creditLimit');
    }
    if (dto.paymentTermDays !== undefined) {
      data.paymentTermDays = this.paymentTerm(dto.paymentTermDays);
    }

    const updated = await model.update({ where: { id }, data });

    await this.audit.record({
      companyId,
      userId,
      action: 'UPDATE',
      entity: kind === 'customer' ? 'customers' : 'suppliers',
      entityId: id,
      before: { nameEn: before.nameEn, isActive: before.isActive },
      after: { nameEn: updated.nameEn, isActive: updated.isActive },
    });

    return this.toResponse(updated);
  }

  /**
   * Deactivates rather than deletes. A partner that has been invoiced must
   * stay readable forever, otherwise old documents lose their counterparty.
   */
  async deactivate(
    companyId: string,
    userId: string,
    kind: PartyKind,
    id: string,
  ) {
    const model = this.model(kind) as any;
    const row = await model.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!row) throw new NotFoundException(`${kind} not found`);
    if (!row.isActive) return this.toResponse(row);

    const updated = await model.update({
      where: { id },
      data: { isActive: false, updatedBy: userId },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'DEACTIVATE',
      entity: kind === 'customer' ? 'customers' : 'suppliers',
      entityId: id,
      before: { isActive: true },
      after: { isActive: false },
    });

    return this.toResponse(updated);
  }

  /// Payment terms are whole days. They are validated here as well as in the
  /// DTO because the service is also called from the import path.
  private paymentTerm(value: unknown): number {
    if (value === undefined || value === null || value === '') return 0;
    const days = Number(value);
    if (!Number.isInteger(days) || days < 0 || days > 3650) {
      throw new BadRequestException('paymentTermDays must be a whole number of days between 0 and 3650');
    }
    return days;
  }

  private money(value: unknown, field: string): Prisma.Decimal {
    try {
      const d = new Prisma.Decimal(String(value)).toDecimalPlaces(MONEY_SCALE);
      if (d.isNegative()) throw new BadRequestException(`${field} cannot be negative`);
      return d;
    } catch {
      throw new BadRequestException(`${field} is not a valid amount`);
    }
  }

  private toResponse(row: any) {
    return {
      id: row.id,
      paymentTermDays: row.paymentTermDays ?? 0,
      companyId: row.companyId,
      code: row.code,
      nameEn: row.nameEn,
      nameAr: row.nameAr,
      phone: row.phone,
      email: row.email,
      taxNumber: row.taxNumber,
      address: row.address,
      creditLimit:
        row.creditLimit !== undefined && row.creditLimit !== null
          ? row.creditLimit.toFixed(MONEY_SCALE)
          : undefined,
      isActive: row.isActive,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
