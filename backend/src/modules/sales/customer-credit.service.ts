import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceDocumentType, InvoiceStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PartiesService } from '../parties/parties.service';

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
  async assertCanPost(tx: Prisma.TransactionClient, companyId: string, invoiceId: string) {
    const check = await this.evaluate(tx, companyId, invoiceId, true);
    if (!check || !check.exceeds) return;
    const approvals = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM sales_invoice_credit_approvals
       WHERE "companyId" = ${companyId}::uuid AND "invoiceId" = ${invoiceId}::uuid
         AND "customerId" = ${check.customerId}::uuid
         AND "totalAmount" = ${check.totalAmount}
       LIMIT 1`);
    if (approvals.length > 0) return;
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
    });
  }

  /** One approval, for one draft invoice, with a written reason. */
  async approve(companyId: string, userId: string, invoiceId: string, reason: string) {
    const text = (reason ?? '').trim();
    if (text.length < 3) throw new BadRequestException('A written reason is required');
    return this.prisma.$transaction(async (tx) => {
      const check = await this.evaluate(tx, companyId, invoiceId, true);
      if (!check) throw new NotFoundException('Draft sales invoice not found');
      if (!check.exceeds) {
        throw new BadRequestException('This invoice does not exceed the customer credit limit, so it needs no approval');
      }
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM sales_invoice_credit_approvals
         WHERE "companyId" = ${companyId}::uuid AND "invoiceId" = ${invoiceId}::uuid`);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO sales_invoice_credit_approvals
          ("companyId","invoiceId","customerId","totalAmount","creditLimit","projectedBalance","reason","approvedBy")
        VALUES (${companyId}::uuid, ${invoiceId}::uuid, ${check.customerId}::uuid, ${check.totalAmount},
                ${check.creditLimit}, ${check.projected}, ${text}, ${userId}::uuid)`);
      await this.audit.record({
        companyId, userId, action: 'CREDIT_LIMIT_OVERRIDE', entity: 'sales_invoices', entityId: invoiceId,
        after: { customerId: check.customerId, creditLimit: check.creditLimit.toFixed(SCALE), projected: check.projected.toFixed(SCALE), reason: text },
      });
      return { invoiceId, approved: true, projectedBalance: check.projected.toFixed(SCALE) };
    });
  }

  private async evaluate(tx: Prisma.TransactionClient, companyId: string, invoiceId: string, lock: boolean) {
    const invoice = await tx.salesInvoice.findFirst({
      where: { id: invoiceId, companyId, deletedAt: null },
      select: { customerId: true, status: true, documentType: true, totalAmount: true, paidAmount: true },
    });
    if (!invoice || invoice.status !== InvoiceStatus.DRAFT || invoice.documentType !== InvoiceDocumentType.INVOICE) return null;
    // Two invoices for one customer posted together must see each other: the
    // customer row is the lock that makes them take turns.
    const rows = lock
      ? await tx.$queryRaw<Array<{ creditLimit: Prisma.Decimal; nameEn: string }>>(Prisma.sql`
          SELECT "creditLimit", "nameEn" FROM customers
           WHERE id = ${invoice.customerId}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`)
      : [];
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
      creditLimit,
      balance: figures.netBalance,
      remaining,
      projected,
    };
  }
}
