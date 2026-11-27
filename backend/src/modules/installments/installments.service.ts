import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { allocatePaid, daysLate, InstallmentError, parseMoney, piasters, planInstallments, PlannedInstallment } from './installment-rules';

function fail(field: string, message: string, code = 'VALIDATION'): never {
  throw new BadRequestException({ code, message, field });
}

function rules<T>(field: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof InstallmentError) fail(field, e.message, e.code);
    throw e;
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const cents = (v: Prisma.Decimal | number | string) => Math.round(Number(v) * 100);

type PlanRow = { id: string; downPayment: Prisma.Decimal; installmentCount: number; intervalMonths: number; firstDue: Date };
type InvRow = { id: string; invoiceNumber: string; invoiceDate: Date; status: string; documentType: string; totalAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; customerEn?: string | null; customerAr?: string | null };

@Injectable()
export class InstallmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async invoice(companyId: string, invoiceId: string): Promise<InvRow> {
    const [inv] = await this.prisma.$queryRaw<InvRow[]>(Prisma.sql`
      SELECT i.id, i."invoiceNumber", i."invoiceDate", i.status::text AS status, i."documentType"::text AS "documentType", i."totalAmount", i."paidAmount",
             cu."nameEn" AS "customerEn", cu."nameAr" AS "customerAr"
        FROM sales_invoices i LEFT JOIN customers cu ON cu.id = i."customerId"
       WHERE i.id = ${invoiceId}::uuid AND i."companyId" = ${companyId}::uuid AND i."deletedAt" IS NULL`);
    if (!inv) throw new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'That sales invoice does not exist' });
    return inv;
  }

  private async rows(planId: string): Promise<PlannedInstallment[]> {
    const rows = await this.prisma.$queryRaw<{ no: number; dueDate: Date; amount: Prisma.Decimal; isDownPayment: boolean }[]>(Prisma.sql`
      SELECT no, "dueDate", amount, "isDownPayment" FROM installments WHERE "planId" = ${planId}::uuid ORDER BY no`);
    return rows.map((r) => ({ no: r.no, dueDate: iso(r.dueDate), amountPiasters: cents(r.amount), isDownPayment: r.isDownPayment }));
  }

  private view(inv: InvRow, plan: PlanRow, rows: PlannedInstallment[]) {
    const t = today();
    const items = allocatePaid(rows, cents(inv.paidAmount), t).map((i) => ({
      no: i.no, dueDate: i.dueDate, isDownPayment: i.isDownPayment, amount: Number(piasters(i.amountPiasters)), paid: Number(piasters(i.paidPiasters)),
      remaining: Number(piasters(i.remainingPiasters)), status: i.status, daysLate: i.status === 'OVERDUE' ? daysLate(i.dueDate, t) : 0,
    }));
    const overdue = items.filter((i) => i.status === 'OVERDUE');
    return {
      invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, invoiceDate: iso(inv.invoiceDate), customerEn: inv.customerEn ?? null, customerAr: inv.customerAr ?? null,
      total: Number(inv.totalAmount), paid: Number(inv.paidAmount), downPayment: Number(plan.downPayment), count: plan.installmentCount,
      intervalMonths: plan.intervalMonths, firstDue: iso(plan.firstDue), items,
      overdueAmount: Number(piasters(overdue.reduce((s, i) => s + Math.round(i.remaining * 100), 0))),
      overdueCount: overdue.length,
      nextDue: items.find((i) => i.status !== 'PAID')?.dueDate ?? null,
    };
  }

  async forInvoice(companyId: string, invoiceId: string) {
    const inv = await this.invoice(companyId, invoiceId);
    const [plan] = await this.prisma.$queryRaw<PlanRow[]>(Prisma.sql`
      SELECT id, "downPayment", "installmentCount", "intervalMonths", "firstDue" FROM installment_plans WHERE "salesInvoiceId" = ${invoiceId}::uuid`);
    if (!plan) throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'This invoice has no installment plan' });
    return this.view(inv, plan, await this.rows(plan.id));
  }

  /** Creates the plan, or replaces it. Replacing is safe because payments are never recorded on installments: they follow the invoice. */
  async save(companyId: string, userId: string, invoiceId: string, input: { downPayment?: unknown; count?: unknown; intervalMonths?: unknown; firstDue?: string }) {
    const inv = await this.invoice(companyId, invoiceId);
    if (inv.status !== 'POSTED' || inv.documentType !== 'INVOICE') fail('invoiceId', 'An installment plan belongs to a posted sales invoice', 'INSTALLMENT_INVOICE_NOT_POSTED');
    const down = input.downPayment === undefined || input.downPayment === '' || input.downPayment === null ? 0 : rules('downPayment', () => parseMoney(input.downPayment, 'the down payment'));
    const count = Number(input.count);
    const interval = input.intervalMonths === undefined || input.intervalMonths === '' ? 1 : Number(input.intervalMonths);
    const plan = rules('count', () =>
      planInstallments({
        totalPiasters: cents(inv.totalAmount), downPaymentPiasters: down, count, intervalMonths: interval,
        firstDue: String(input.firstDue ?? ''), invoiceDate: iso(inv.invoiceDate),
      }),
    );
    const planId = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM sales_invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM installment_plans WHERE "salesInvoiceId" = ${invoiceId}::uuid`);
      const id = randomUUID();
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO installment_plans (id,"companyId","salesInvoiceId","downPayment","installmentCount","intervalMonths","firstDue","createdBy")
        VALUES (${id}::uuid, ${companyId}::uuid, ${invoiceId}::uuid, ${piasters(down)}::numeric, ${count}, ${interval}, ${String(input.firstDue)}::date, ${userId}::uuid)`);
      for (const p of plan) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO installments (id,"planId",no,"dueDate",amount,"isDownPayment")
          VALUES (${randomUUID()}::uuid, ${id}::uuid, ${p.no}, ${p.dueDate}::date, ${piasters(p.amountPiasters)}::numeric, ${p.isDownPayment})`);
      }
      return id;
    });
    await this.audit.record({ companyId, userId, action: 'INSTALLMENT_PLAN_SAVE', entity: 'sales_invoices', entityId: invoiceId, after: { planId, count, interval, down: piasters(down) } });
    return this.forInvoice(companyId, invoiceId);
  }

  async remove(companyId: string, userId: string, invoiceId: string) {
    await this.invoice(companyId, invoiceId);
    const n = await this.prisma.$executeRaw(Prisma.sql`DELETE FROM installment_plans WHERE "salesInvoiceId" = ${invoiceId}::uuid AND "companyId" = ${companyId}::uuid`);
    if (!n) throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'This invoice has no installment plan' });
    await this.audit.record({ companyId, userId, action: 'INSTALLMENT_PLAN_REMOVE', entity: 'sales_invoices', entityId: invoiceId });
    return { removed: true };
  }

  private async plansWithInvoices(companyId: string) {
    const plans = await this.prisma.$queryRaw<(PlanRow & { salesInvoiceId: string })[]>(Prisma.sql`
      SELECT p.id, p."salesInvoiceId", p."downPayment", p."installmentCount", p."intervalMonths", p."firstDue"
        FROM installment_plans p JOIN sales_invoices i ON i.id = p."salesInvoiceId"
       WHERE p."companyId" = ${companyId}::uuid AND i.status = 'POSTED' ORDER BY p."createdAt" DESC LIMIT 1000`);
    const out = [];
    for (const p of plans) {
      const inv = await this.invoice(companyId, p.salesInvoiceId);
      out.push(this.view(inv, p, await this.rows(p.id)));
    }
    return out;
  }

  /** Every plan with its state. `status` filters to plans that are open (something left to pay) or overdue. */
  async listPlans(companyId: string, query: { status?: string }) {
    let items = await this.plansWithInvoices(companyId);
    const st = (query.status ?? '').toUpperCase();
    if (st && !['OPEN', 'OVERDUE', 'PAID'].includes(st)) fail('status', 'Unknown status');
    if (st === 'OVERDUE') items = items.filter((i) => i.overdueCount > 0);
    if (st === 'OPEN') items = items.filter((i) => i.items.some((x) => x.status !== 'PAID'));
    if (st === 'PAID') items = items.filter((i) => i.items.every((x) => x.status === 'PAID'));
    return { items };
  }

  /** Each overdue installment, one row, oldest first. */
  async overdue(companyId: string) {
    const plans = await this.plansWithInvoices(companyId);
    const items = plans.flatMap((p) =>
      p.items.filter((i) => i.status === 'OVERDUE').map((i) => ({
        invoiceId: p.invoiceId, invoiceNumber: p.invoiceNumber, customerEn: p.customerEn, customerAr: p.customerAr,
        no: i.no, dueDate: i.dueDate, remaining: i.remaining, daysLate: i.daysLate,
      })),
    );
    items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.invoiceNumber.localeCompare(b.invoiceNumber));
    return { items, totals: { count: items.length, amount: items.reduce((s, i) => s + Math.round(i.remaining * 100), 0) / 100 } };
  }
}
