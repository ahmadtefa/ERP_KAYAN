import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceDocumentType, InvoiceStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PartiesService } from '../parties/parties.service';
import {
  DEFAULT_PAYMENT_TERM_METHOD,
  DueSchedule,
  formatDate,
  overdueMinor,
  PaymentTermConfig,
  penaltyMinor,
} from '../parties/payment-terms';

const SCALE = 4;

/**
 * Credit limit at posting time. Drafts are never checked. A positive limit is
 * enforced; zero means no limit is set. The figure compared is the customer's
 * recorded net balance (company wide, the same number as the customer card)
 * plus what this invoice still leaves unpaid. Quotations, orders and other
 * drafts are not counted.
 */
@Injectable()
export class CustomerCreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parties: PartiesService,
    private readonly audit: AuditService,
  ) {}

  /** Runs inside the posting transaction, before the invoice is claimed. */
  async assertCanPost(tx: Prisma.TransactionClient, companyId: string, invoiceId: string, mayDiscloseBalance = false) {
    const check = await this.evaluate(tx, companyId, invoiceId, true);
    if (!check || !check.exceeds) return;
    const approvals = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM sales_invoice_credit_approvals
       WHERE "companyId" = ${companyId}::uuid AND "invoiceId" = ${invoiceId}::uuid
         AND "customerId" = ${check.customerId}::uuid
         AND "totalAmount" = ${check.totalAmount}
         AND "paidAmount" = ${check.paidAmount}
         AND "invoiceUpdatedAt" = ${check.invoiceUpdatedAt}
         AND "projectedBalance" >= ${check.projected}
       LIMIT 1`);
    if (approvals.length > 0) return;
    // The company-wide figures are the customer card's figures: only someone
    // who may read that card gets them. Everyone else learns only that an
    // approval is needed.
    if (!mayDiscloseBalance) {
      throw new ConflictException({
        code: 'CUSTOMER_CREDIT_LIMIT_EXCEEDED',
        message: 'This invoice needs credit approval before it can be posted.',
      });
    }
    throw new ConflictException({
      code: 'CUSTOMER_CREDIT_LIMIT_EXCEEDED',
      message:
        `Posting this invoice would take ${check.customerName} to ${check.projected.toFixed(SCALE)}, ` +
        `above the credit limit of ${check.creditLimit.toFixed(SCALE)}. It needs approval from someone allowed to approve credit overrides.`,
      customerId: check.customerId,
      creditLimit: check.creditLimit.toFixed(SCALE),
      currentBalance: check.balance.toFixed(SCALE),
      invoiceAmount: check.remaining.toFixed(SCALE),
      projectedBalance: check.projected.toFixed(SCALE),
      // The same figures as one object the problem-details filter forwards.
      // Only this permitted branch ever builds it.
      creditSummary: {
        creditLimit: check.creditLimit.toFixed(SCALE),
        currentBalance: check.balance.toFixed(SCALE),
        invoiceAmount: check.remaining.toFixed(SCALE),
        projectedBalance: check.projected.toFixed(SCALE),
      },
    });
  }

  /**
   * The payment period at posting time. A customer whose terms are set and who
   * already has overdue invoices cannot be invoiced again without a signed
   * approval for this very invoice. Runs in the posting transaction right after
   * the credit-limit check (which already holds the customer row lock).
   * Customers with no terms (0 days, the default method) are never blocked.
   */
  async assertPeriodCanPost(tx: Prisma.TransactionClient, companyId: string, invoiceId: string, mayDiscloseBalance = false) {
    const check = await this.evaluatePeriod(tx, companyId, invoiceId);
    if (!check || check.overdueCount === 0) return;
    const approvals = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM sales_invoice_term_approvals
       WHERE "companyId" = ${companyId}::uuid AND "invoiceId" = ${invoiceId}::uuid
         AND "customerId" = ${check.customerId}::uuid
         AND "invoiceUpdatedAt" = ${check.invoiceUpdatedAt}
         AND "overdueAmount" >= ${check.overdue}
       LIMIT 1`);
    if (approvals.length > 0) return;
    if (!mayDiscloseBalance) {
      throw new ConflictException({
        code: 'CUSTOMER_PAYMENT_TERM_EXCEEDED',
        message: 'This customer is past the agreed payment period. The invoice needs approval before it can be posted.',
      });
    }
    throw new ConflictException({
      code: 'CUSTOMER_PAYMENT_TERM_EXCEEDED',
      message:
        `${check.customerName} has ${check.overdueCount} overdue invoice(s) totalling ${check.overdue.toFixed(SCALE)} ` +
        `(oldest due ${check.oldestDue})` +
        (check.penalty.greaterThan(0) ? `, late penalty so far ${check.penalty.toFixed(SCALE)}` : '') +
        '. The invoice needs approval from someone allowed to approve credit overrides.',
    });
  }

  /** One approval for one draft invoice whose customer is past the payment period. */
  async approvePeriod(companyId: string, userId: string, invoiceId: string, reason: string, branchScope: string[] | null = null) {
    const text = (reason ?? '').trim();
    if (text.length < 3) throw new BadRequestException('A written reason is required');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM sales_invoices
         WHERE id = ${invoiceId}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL FOR UPDATE`);
      const check = await this.evaluatePeriod(tx, companyId, invoiceId);
      if (!check || (branchScope && !branchScope.includes(check.branchId))) throw new NotFoundException('Draft sales invoice not found');
      if (check.overdueCount === 0) throw new BadRequestException('This invoice does not need payment-period approval');
      if (check.createdBy && check.createdBy === userId) {
        throw new ForbiddenException('The person who created the invoice cannot approve its payment-period exception. / لا يجوز لمنشئ الفاتورة أن يوافق على تجاوزها لمدة السداد.');
      }
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM sales_invoice_term_approvals
         WHERE "companyId" = ${companyId}::uuid AND "invoiceId" = ${invoiceId}::uuid`);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO sales_invoice_term_approvals
          ("companyId","invoiceId","customerId","invoiceUpdatedAt","overdueAmount","reason","approvedBy")
        VALUES (${companyId}::uuid, ${invoiceId}::uuid, ${check.customerId}::uuid, ${check.invoiceUpdatedAt},
                ${check.overdue}, ${text}, ${userId}::uuid)`);
      await this.audit.record({
        companyId, userId, action: 'PAYMENT_TERM_OVERRIDE', entity: 'sales_invoices', entityId: invoiceId,
        after: { customerId: check.customerId, overdue: check.overdue.toFixed(SCALE), overdueCount: check.overdueCount, reason: text },
      });
      return { invoiceId, approved: true };
    });
  }

  private async evaluatePeriod(tx: Prisma.TransactionClient, companyId: string, invoiceId: string) {
    const invoice = await tx.salesInvoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
      select: { customerId: true, branchId: true, createdBy: true, updatedAt: true, status: true, documentType: true, invoiceDate: true },
    });
    if (!invoice || invoice.status !== InvoiceStatus.DRAFT || invoice.documentType !== InvoiceDocumentType.INVOICE) return null;
    const customer = await tx.customer.findFirst({
      where: { id: invoice.customerId, companyId },
      select: { nameEn: true, paymentTermDays: true, paymentTermMethod: true, paymentTermConfig: true },
    });
    if (!customer) return null;
    if (customer.paymentTermDays <= 0 && customer.paymentTermMethod === DEFAULT_PAYMENT_TERM_METHOD) return null;
    const asOf = formatDate(invoice.invoiceDate);
    // dueDate is the first due share, so an invoice with no share due before
    // [asOf] cannot be overdue and is not read at all.
    const rows = await tx.salesInvoice.findMany({
      where: {
        companyId,
        customerId: invoice.customerId,
        status: InvoiceStatus.POSTED,
        documentType: InvoiceDocumentType.INVOICE,
        deletedAt: null,
        id: { not: invoiceId },
        dueDate: { lt: invoice.invoiceDate },
      },
      select: { id: true, dueDate: true, dueSchedule: true, totalAmount: true, paidAmount: true },
    });
    const cfg = customer.paymentTermConfig as PaymentTermConfig | null;
    let overdue = new Prisma.Decimal(0);
    let penalty = new Prisma.Decimal(0);
    let overdueCount = 0;
    let oldest: string | null = null;
    for (const r of rows) {
      const shares = Array.isArray(r.dueSchedule)
        ? (r.dueSchedule as unknown as DueSchedule['shares'])
        : [{ dueDate: formatDate(r.dueDate!), percent: 100 }];
      const schedule: DueSchedule = { shares, firstDueDate: shares[0].dueDate, lastDueDate: shares[shares.length - 1].dueDate };
      const totalMinor = r.totalAmount.mul(10 ** SCALE).toDecimalPlaces(0).toNumber();
      const paidMinor = r.paidAmount.mul(10 ** SCALE).toDecimalPlaces(0).toNumber();
      const late = overdueMinor(schedule, totalMinor, paidMinor, asOf);
      if (late <= 0) continue;
      overdueCount += 1;
      overdue = overdue.plus(new Prisma.Decimal(late).div(10 ** SCALE));
      const first = schedule.firstDueDate;
      if (!oldest || first < oldest) oldest = first;
      if (cfg?.penalty) penalty = penalty.plus(new Prisma.Decimal(penaltyMinor(late, first, asOf, cfg.penalty)).div(10 ** SCALE));
    }
    return {
      customerId: invoice.customerId,
      customerName: customer.nameEn,
      branchId: invoice.branchId,
      createdBy: invoice.createdBy,
      invoiceUpdatedAt: invoice.updatedAt,
      overdueCount,
      overdue,
      penalty,
      oldestDue: oldest ?? '',
    };
  }

  /** One approval, for one draft invoice, with a written reason. */
  async approve(companyId: string, userId: string, invoiceId: string, reason: string, branchScope: string[] | null = null) {
    const text = (reason ?? '').trim();
    if (text.length < 3) throw new BadRequestException('A written reason is required');
    return this.prisma.$transaction(async (tx) => {
      const check = await this.evaluate(tx, companyId, invoiceId, true);
      if (!check || (branchScope && !branchScope.includes(check.branchId))) throw new NotFoundException('Draft sales invoice not found');
      if (!check.exceeds) {
        throw new BadRequestException('This invoice does not need credit approval');
      }
      // The approval is a second person's review: whoever created the invoice
      // cannot sign for its credit exception, even with the permission.
      if (check.createdBy && check.createdBy === userId) {
        throw new ForbiddenException('The person who created the invoice cannot approve its credit exception. / لا يجوز لمنشئ الفاتورة أن يوافق على تجاوزها لحد الائتمان.');
      }
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM sales_invoice_credit_approvals
         WHERE "companyId" = ${companyId}::uuid AND "invoiceId" = ${invoiceId}::uuid`);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO sales_invoice_credit_approvals
          ("companyId","invoiceId","customerId","totalAmount","paidAmount","invoiceUpdatedAt","creditLimit","projectedBalance","reason","approvedBy")
        VALUES (${companyId}::uuid, ${invoiceId}::uuid, ${check.customerId}::uuid, ${check.totalAmount},
                ${check.paidAmount}, ${check.invoiceUpdatedAt}, ${check.creditLimit}, ${check.projected}, ${text}, ${userId}::uuid)`);
      await this.audit.record({
        companyId, userId, action: 'CREDIT_LIMIT_OVERRIDE', entity: 'sales_invoices', entityId: invoiceId,
        after: { customerId: check.customerId, creditLimit: check.creditLimit.toFixed(SCALE), projected: check.projected.toFixed(SCALE), reason: text },
      });
      return { invoiceId, approved: true };
    });
  }

  private async evaluate(tx: Prisma.TransactionClient, companyId: string, invoiceId: string, lock: boolean) {
    // Lock order is always invoice row, then customer row (the same order the
    // draft editor uses: it locks the invoice and never the customer). The
    // invoice is read only after its lock is held, so an edit that was waiting
    // or running is already committed and the decision is made on what will
    // really be posted; the lock then keeps it from changing until commit.
    if (lock) {
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM sales_invoices
         WHERE id = ${invoiceId}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL
         FOR UPDATE`);
    }
    const invoice = await tx.salesInvoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
      select: { customerId: true, branchId: true, createdBy: true, updatedAt: true, status: true, documentType: true, totalAmount: true, paidAmount: true },
    });
    if (!invoice || invoice.status !== InvoiceStatus.DRAFT || invoice.documentType !== InvoiceDocumentType.INVOICE) return null;
    // Two invoices for one customer posted together must see each other: the
    // customer row is the lock that makes them take turns. That only matters
    // when there is a limit to protect, so the row is read without a lock
    // first and locked only for a customer who has a limit. Customers with no
    // limit (the usual case) no longer queue behind each other at posting.
    let rows = lock
      ? await tx.$queryRaw<Array<{ creditLimit: Prisma.Decimal; nameEn: string }>>(Prisma.sql`
          SELECT "creditLimit", "nameEn" FROM customers
           WHERE id = ${invoice.customerId}::uuid AND "companyId" = ${companyId}::uuid`)
      : [];
    if (lock && rows[0] && new Prisma.Decimal(rows[0].creditLimit).greaterThan(0)) {
      rows = await tx.$queryRaw<Array<{ creditLimit: Prisma.Decimal; nameEn: string }>>(Prisma.sql`
        SELECT "creditLimit", "nameEn" FROM customers
         WHERE id = ${invoice.customerId}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`);
    }
    const row = rows[0];
    if (!row) return null;
    const creditLimit = new Prisma.Decimal(row.creditLimit);
    if (!creditLimit.greaterThan(0)) return { exceeds: false } as { exceeds: false } & Record<string, never>;
    const figures = await this.parties.balanceFigures(companyId, 'customer', invoice.customerId, tx);
    const remaining = invoice.totalAmount.minus(invoice.paidAmount);
    const projected = figures.netBalance.plus(remaining);
    return {
      exceeds: projected.greaterThan(creditLimit),
      customerId: invoice.customerId,
      customerName: row.nameEn,
      totalAmount: invoice.totalAmount,
      paidAmount: invoice.paidAmount,
      invoiceUpdatedAt: invoice.updatedAt,
      branchId: invoice.branchId,
      createdBy: invoice.createdBy,
      creditLimit,
      balance: figures.netBalance,
      remaining,
      projected,
    };
  }
}
