import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';
import { asHttp, HrError, isoDate, money, monthKey } from './hr-rules';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const f4 = (v: Prisma.Decimal.Value) => D(v).toFixed(4);
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Tx = Prisma.TransactionClient;

/**
 * End-of-service provision. The company types the monthly accrual percent of basic pay; no legal
 * figure is built in. Each month is accrued once from a posted payroll run, an employee's balance
 * is what was accrued less what was paid out, and a payout never takes the balance below zero from
 * the provision: any excess is expensed at once.
 */
@Injectable()
export class EosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  async getSettings(companyId: string) {
    const [row] = await this.prisma.$queryRaw<{ accrualPercent: Prisma.Decimal; expenseAccountId: string; provisionAccountId: string }[]>(Prisma.sql`
      SELECT "accrualPercent", "expenseAccountId", "provisionAccountId" FROM hr_eos_settings WHERE "companyId" = ${companyId}::uuid`);
    if (!row) return { configured: false };
    return { configured: true, accrualPercent: D(row.accrualPercent).toFixed(4), expenseAccountId: row.expenseAccountId, provisionAccountId: row.provisionAccountId };
  }

  private async account(tx: Tx | PrismaService, companyId: string, id: unknown, type: string, field: string): Promise<string> {
    if (!uuidRe.test(String(id ?? ''))) throw new HrError('EOS_ACCOUNT_REQUIRED', 'Choose the account', { field });
    const [a] = await tx.$queryRaw<{ type: string; isPostable: boolean; isActive: boolean }[]>(Prisma.sql`
      SELECT type::text AS type, "isPostable", "isActive" FROM accounts WHERE id = ${String(id)}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL`);
    if (!a || a.type !== type || !a.isPostable || !a.isActive) throw new HrError('EOS_ACCOUNT_INVALID', 'The account must be active, postable and of the right type', { field });
    return String(id);
  }

  async setSettings(companyId: string, userId: string, input: { accrualPercent?: string | number; expenseAccountId?: string; provisionAccountId?: string }) {
    try {
      const text = String(input.accrualPercent ?? '').trim();
      if (!/^\d+(\.\d{1,4})?$/.test(text) || D(text).lte(0) || D(text).gt(100)) throw new HrError('EOS_PERCENT_BAD', 'The accrual percent must be above 0 and at most 100');
      const expense = await this.account(this.prisma, companyId, input.expenseAccountId, 'EXPENSE', 'expenseAccountId');
      const provision = await this.account(this.prisma, companyId, input.provisionAccountId, 'LIABILITY', 'provisionAccountId');
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO hr_eos_settings ("companyId","accrualPercent","expenseAccountId","provisionAccountId","updatedBy")
        VALUES (${companyId}::uuid, ${text}::numeric, ${expense}::uuid, ${provision}::uuid, ${userId}::uuid)
        ON CONFLICT ("companyId") DO UPDATE SET "accrualPercent" = EXCLUDED."accrualPercent", "expenseAccountId" = EXCLUDED."expenseAccountId",
          "provisionAccountId" = EXCLUDED."provisionAccountId", "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = now()`);
      await this.audit.record({ companyId, userId, action: 'EOS_SETTINGS', entity: 'hr_eos_settings', entityId: companyId, after: { accrualPercent: text } });
      return this.getSettings(companyId);
    } catch (e) { return asHttp(e); }
  }

  private async branchFor(tx: Tx, companyId: string, branchId: string | null): Promise<string> {
    if (branchId) return branchId;
    const [b] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM branches WHERE "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1`);
    if (!b) throw new HrError('EOS_BRANCH_MISSING', 'The company has no branch to post to');
    return b.id;
  }

  /** Accrue one month from its posted payroll run, once. */
  async accrue(companyId: string, userId: string, monthRaw: string) {
    try {
      const month = monthKey(monthRaw);
      const id = randomUUID();
      await this.prisma.$transaction(async (tx) => {
        const [settings] = await tx.$queryRaw<{ accrualPercent: Prisma.Decimal; expenseAccountId: string; provisionAccountId: string }[]>(Prisma.sql`
          SELECT "accrualPercent", "expenseAccountId", "provisionAccountId" FROM hr_eos_settings WHERE "companyId" = ${companyId}::uuid`);
        if (!settings) throw new HrError('EOS_SETTINGS_MISSING', 'Set the accrual percent and accounts first');
        const [run] = await tx.$queryRaw<{ id: string; status: string; branchId: string | null }[]>(Prisma.sql`
          SELECT id, status, "branchId" FROM payroll_runs WHERE "companyId" = ${companyId}::uuid AND month = ${month} FOR UPDATE`);
        if (!run || (run.status !== 'POSTED' && run.status !== 'PAID')) throw new HrError('EOS_RUN_NOT_POSTED', 'Post the payroll run of that month first', { month });
        const [done] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM hr_eos_accruals WHERE "companyId" = ${companyId}::uuid AND month = ${month} AND status = 'POSTED'`);
        if (done) throw new HrError('EOS_ALREADY_ACCRUED', 'That month is already accrued', { month });
        const lines = await tx.$queryRaw<{ employeeId: string; costCenterId: string | null; basic: Prisma.Decimal }[]>(Prisma.sql`
          SELECT "employeeId", "costCenterId", basic FROM payroll_run_lines WHERE "runId" = ${run.id}::uuid`);
        const pct = D(settings.accrualPercent);
        const rows = lines.map((l) => ({ ...l, amount: D(l.basic).mul(pct).div(100).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP) })).filter((r) => r.amount.gt(0));
        const total = rows.reduce((a, r) => a.add(r.amount), D(0));
        if (total.isZero()) throw new HrError('EOS_NOTHING_TO_ACCRUE', 'No basic pay in that run to accrue on', { month });
        const byCentre = new Map<string, Prisma.Decimal>();
        for (const r of rows) byCentre.set(r.costCenterId ?? '', (byCentre.get(r.costCenterId ?? '') ?? D(0)).add(r.amount));
        const entry: Array<{ accountId: string; debit?: string; credit?: string; description: string; costCenterId?: string | null }> = [];
        for (const [centre, v] of byCentre) entry.push({ accountId: settings.expenseAccountId, debit: f4(v), description: `End-of-service accrual ${month}`, costCenterId: centre || null });
        entry.push({ accountId: settings.provisionAccountId, credit: f4(total), description: `End-of-service provision ${month}` });
        const posted = await this.posting.post(tx, {
          companyId, branchId: await this.branchFor(tx, companyId, run.branchId), userId, entryDate: new Date(), description: `End-of-service accrual ${month}`,
          sourceType: 'EOS_ACCRUAL', sourceId: id, sourceNumber: `EOS-${month}`, lines: entry,
        });
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO hr_eos_accruals (id, "companyId", month, "runId", "accrualPercent", total, "journalEntryId", "postedBy")
          VALUES (${id}::uuid, ${companyId}::uuid, ${month}, ${run.id}::uuid, ${f4(pct)}::numeric, ${f4(total)}::numeric, ${posted.id}::uuid, ${userId}::uuid)`);
        for (const r of rows) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hr_eos_accrual_lines ("accrualId","employeeId",basic,amount) VALUES (${id}::uuid, ${r.employeeId}::uuid, ${f4(r.basic)}::numeric, ${f4(r.amount)}::numeric)`);
        }
      });
      await this.audit.record({ companyId, userId, action: 'EOS_ACCRUE', entity: 'hr_eos_accruals', entityId: id, after: { month } });
      return this.listAccruals(companyId).then((l) => l.items.find((a) => a.id === id));
    } catch (e) { return asHttp(e); }
  }

  /** The balance an employee holds: accrued, less paid out of the provision. */
  private async balanceOf(tx: Tx | PrismaService, companyId: string, employeeId: string): Promise<Prisma.Decimal> {
    const [row] = await tx.$queryRaw<{ accrued: Prisma.Decimal; paid: Prisma.Decimal }[]>(Prisma.sql`
      SELECT
        COALESCE((SELECT sum(l.amount) FROM hr_eos_accrual_lines l JOIN hr_eos_accruals a ON a.id = l."accrualId"
                   WHERE a."companyId" = ${companyId}::uuid AND l."employeeId" = ${employeeId}::uuid AND a.status = 'POSTED'), 0) AS accrued,
        COALESCE((SELECT sum("fromProvision") FROM hr_eos_payouts WHERE "companyId" = ${companyId}::uuid AND "employeeId" = ${employeeId}::uuid AND status = 'POSTED'), 0) AS paid`);
    return D(row.accrued).sub(row.paid);
  }

  /** Reverse a month's accrual, unless an employee has already been paid out of it. */
  async reverseAccrual(companyId: string, userId: string, id: string) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const [acc] = await tx.$queryRaw<{ id: string; status: string; journalEntryId: string; month: string }[]>(Prisma.sql`
          SELECT id, status, "journalEntryId", month FROM hr_eos_accruals WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`);
        if (!acc) throw new HrError('EOS_ACCRUAL_NOT_FOUND', 'Accrual not found');
        if (acc.status !== 'POSTED') throw new HrError('EOS_ACCRUAL_STATE', 'Only a posted accrual can be reversed');
        const lines = await tx.$queryRaw<{ employeeId: string; amount: Prisma.Decimal }[]>(Prisma.sql`SELECT "employeeId", amount FROM hr_eos_accrual_lines WHERE "accrualId" = ${id}::uuid`);
        for (const l of lines) {
          if ((await this.balanceOf(tx, companyId, l.employeeId)).sub(l.amount).lt(0)) {
            throw new HrError('EOS_ACCRUAL_USED', 'An employee has already been paid out of this provision, so the month cannot be reversed');
          }
        }
        await this.posting.reverse(tx, companyId, userId, acc.journalEntryId, `Reversal of end-of-service accrual ${acc.month}`);
        await tx.$executeRaw(Prisma.sql`UPDATE hr_eos_accruals SET status = 'REVERSED' WHERE id = ${id}::uuid`);
      });
      await this.audit.record({ companyId, userId, action: 'EOS_ACCRUAL_REVERSE', entity: 'hr_eos_accruals', entityId: id });
      return this.listAccruals(companyId).then((l) => l.items.find((a) => a.id === id));
    } catch (e) { return asHttp(e); }
  }

  /** Pay a leaver. The amount is typed by the company; the provision is used first, the rest is expensed. */
  async settle(companyId: string, userId: string, input: { employeeId?: string; amount?: string | number; payoutDate?: string; fundingAccountId?: string; note?: string }) {
    try {
      const amount = money(input.amount, 'amount');
      const date = isoDate(input.payoutDate, 'payoutDate');
      if (!uuidRe.test(String(input.employeeId ?? ''))) throw new HrError('EOS_EMPLOYEE_REQUIRED', 'Choose the employee');
      const id = randomUUID();
      await this.prisma.$transaction(async (tx) => {
        const [settings] = await tx.$queryRaw<{ expenseAccountId: string; provisionAccountId: string }[]>(Prisma.sql`
          SELECT "expenseAccountId", "provisionAccountId" FROM hr_eos_settings WHERE "companyId" = ${companyId}::uuid`);
        if (!settings) throw new HrError('EOS_SETTINGS_MISSING', 'Set the accrual percent and accounts first');
        const [emp] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM hr_employees WHERE id = ${String(input.employeeId)}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`);
        if (!emp) throw new HrError('EOS_EMPLOYEE_NOT_FOUND', 'Employee not found');
        const funding = await this.account(tx, companyId, input.fundingAccountId, 'ASSET', 'fundingAccountId');
        const balance = await this.balanceOf(tx, companyId, emp.id);
        const fromProvision = Prisma.Decimal.min(balance.lt(0) ? D(0) : balance, amount);
        const extra = amount.sub(fromProvision);
        const entry: Array<{ accountId: string; debit?: string; credit?: string; description: string }> = [];
        if (fromProvision.gt(0)) entry.push({ accountId: settings.provisionAccountId, debit: f4(fromProvision), description: 'End-of-service paid from provision' });
        if (extra.gt(0)) entry.push({ accountId: settings.expenseAccountId, debit: f4(extra), description: 'End-of-service above provision' });
        entry.push({ accountId: funding, credit: f4(amount), description: 'End-of-service payment' });
        const posted = await this.posting.post(tx, {
          companyId, branchId: await this.branchFor(tx, companyId, null), userId, entryDate: new Date(`${date}T00:00:00Z`), description: 'End-of-service payment',
          sourceType: 'EOS_PAYOUT', sourceId: id, sourceNumber: `EOSPAY-${id.slice(0, 8)}`, lines: entry,
        });
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO hr_eos_payouts (id,"companyId","employeeId","payoutDate",amount,"fromProvision","extraExpense","fundingAccountId",note,"journalEntryId","postedBy")
          VALUES (${id}::uuid, ${companyId}::uuid, ${emp.id}::uuid, ${date}::date, ${f4(amount)}::numeric, ${f4(fromProvision)}::numeric, ${f4(extra)}::numeric,
                  ${funding}::uuid, ${String(input.note ?? '').slice(0, 300) || null}, ${posted.id}::uuid, ${userId}::uuid)`);
      });
      await this.audit.record({ companyId, userId, action: 'EOS_PAYOUT', entity: 'hr_eos_payouts', entityId: id, after: { amount: f4(amount) } });
      const [row] = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        SELECT id, "employeeId", "payoutDate"::text AS "payoutDate", amount::text AS amount, "fromProvision"::text AS "fromProvision", "extraExpense"::text AS "extraExpense", status
          FROM hr_eos_payouts WHERE id = ${id}::uuid`);
      return row;
    } catch (e) { return asHttp(e); }
  }

  async reversePayout(companyId: string, userId: string, id: string) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const [p] = await tx.$queryRaw<{ status: string; journalEntryId: string }[]>(Prisma.sql`
          SELECT status, "journalEntryId" FROM hr_eos_payouts WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`);
        if (!p) throw new HrError('EOS_PAYOUT_NOT_FOUND', 'Payout not found');
        if (p.status !== 'POSTED') throw new HrError('EOS_PAYOUT_STATE', 'Only a posted payout can be reversed');
        await this.posting.reverse(tx, companyId, userId, p.journalEntryId, 'Reversal of end-of-service payment');
        await tx.$executeRaw(Prisma.sql`UPDATE hr_eos_payouts SET status = 'REVERSED' WHERE id = ${id}::uuid`);
      });
      await this.audit.record({ companyId, userId, action: 'EOS_PAYOUT_REVERSE', entity: 'hr_eos_payouts', entityId: id });
      return { id, status: 'REVERSED' };
    } catch (e) { return asHttp(e); }
  }

  async listAccruals(companyId: string) {
    const rows = await this.prisma.$queryRaw<{ id: string; month: string; total: Prisma.Decimal; accrualPercent: Prisma.Decimal; status: string; journalEntryId: string | null }[]>(Prisma.sql`
      SELECT id, month, total, "accrualPercent", status, "journalEntryId" FROM hr_eos_accruals WHERE "companyId" = ${companyId}::uuid ORDER BY month DESC, "createdAt" DESC`);
    return { items: rows.map((r) => ({ id: r.id, month: r.month, total: f4(r.total), accrualPercent: f4(r.accrualPercent), status: r.status, journalEntryId: r.journalEntryId })) };
  }

  /** Balance per employee: accrued, paid out of the provision, and what is left. */
  async balances(companyId: string) {
    const rows = await this.prisma.$queryRaw<{ employeeId: string; code: string; nameAr: string; accrued: Prisma.Decimal; paid: Prisma.Decimal }[]>(Prisma.sql`
      SELECT e.id AS "employeeId", e.code, e."nameAr",
             COALESCE((SELECT sum(l.amount) FROM hr_eos_accrual_lines l JOIN hr_eos_accruals a ON a.id = l."accrualId" WHERE a.status = 'POSTED' AND l."employeeId" = e.id), 0) AS accrued,
             COALESCE((SELECT sum(p."fromProvision") FROM hr_eos_payouts p WHERE p.status = 'POSTED' AND p."employeeId" = e.id), 0) AS paid
        FROM hr_employees e WHERE e."companyId" = ${companyId}::uuid ORDER BY e.code`);
    const items = rows.filter((r) => D(r.accrued).gt(0) || D(r.paid).gt(0)).map((r) => ({
      employeeId: r.employeeId, code: r.code, nameAr: r.nameAr, accrued: f4(r.accrued), paid: f4(r.paid), balance: f4(D(r.accrued).sub(r.paid)),
    }));
    return { items, totalBalance: f4(items.reduce((a, r) => a.add(r.balance), D(0))) };
  }
}
