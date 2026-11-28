import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PostingService } from '../accounting/posting.service';
import { asHttp, daysInMonth, HrError, isoDate, money, monthKey, TaxBracket } from './hr-rules';
import { calculateLine, loanInstalmentDue } from './payroll-rules';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const f4 = (v: Prisma.Decimal.Value) => D(v).toFixed(4);
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AccountsInput = {
  salariesExpenseId?: string; employerSiExpenseId?: string; siPayableId?: string; taxPayableId?: string;
  loansReceivableId?: string; salariesPayableId?: string; deductionsPayableId?: string;
};
const ACCOUNT_RULES: Array<[keyof AccountsInput, string[]]> = [
  ['salariesExpenseId', ['EXPENSE']], ['employerSiExpenseId', ['EXPENSE']], ['siPayableId', ['LIABILITY']], ['taxPayableId', ['LIABILITY']],
  ['loansReceivableId', ['ASSET']], ['salariesPayableId', ['LIABILITY']], ['deductionsPayableId', ['LIABILITY']],
];

type RunRow = {
  id: string; month: string; status: string; settingsId: string | null; preparedBy: string | null; approvedBy: string | null;
  journalEntryId: string | null; paymentJournalEntryId: string | null; totalGross: Prisma.Decimal; totalNet: Prisma.Decimal; branchId: string | null;
};
type LineRow = {
  id: string; employeeId: string; code: string; nameAr: string; costCenterId: string | null; basic: Prisma.Decimal; allowances: Prisma.Decimal; overtime: Prisma.Decimal;
  absenceDeduction: Prisma.Decimal; penalty: Prisma.Decimal; gross: Prisma.Decimal; employeeSI: Prisma.Decimal; employerSI: Prisma.Decimal; tax: Prisma.Decimal;
  deductions: Prisma.Decimal; loanInstalment: Prisma.Decimal; net: Prisma.Decimal; proration: Prisma.Decimal;
};

/** Monthly payroll runs: calculate, approve (a second person), post to the ledger, pay, reverse. Employee loans. */
@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  // ---- the accounts payroll posts to, chosen by the company from its own chart ----

  async getAccounts(companyId: string) {
    const [row] = await this.prisma.$queryRaw<Record<string, string>[]>(Prisma.sql`SELECT * FROM payroll_accounts WHERE "companyId" = ${companyId}::uuid`);
    if (!row) return { configured: false };
    const out: Record<string, unknown> = { configured: true };
    for (const [k] of ACCOUNT_RULES) out[k] = row[k];
    return out;
  }

  async setAccounts(companyId: string, userId: string, input: AccountsInput) {
    try {
      const ids: Record<string, string> = {};
      for (const [key, types] of ACCOUNT_RULES) {
        const id = String(input[key] ?? '');
        if (!uuidRe.test(id)) throw new HrError('PAYROLL_ACCOUNT_REQUIRED', 'Choose every payroll account', { field: key });
        const [acc] = await this.prisma.$queryRaw<{ type: string; isPostable: boolean; isActive: boolean }[]>(Prisma.sql`
          SELECT type::text AS type, "isPostable", "isActive" FROM accounts WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL`);
        if (!acc || !acc.isPostable || !acc.isActive || !types.includes(acc.type)) {
          throw new HrError('PAYROLL_ACCOUNT_INVALID', 'The account must be active, postable and of the right type', { field: key, type: types.join('/') });
        }
        ids[key] = id;
      }
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO payroll_accounts ("companyId","salariesExpenseId","employerSiExpenseId","siPayableId","taxPayableId","loansReceivableId","salariesPayableId","deductionsPayableId","updatedBy")
        VALUES (${companyId}::uuid, ${ids.salariesExpenseId}::uuid, ${ids.employerSiExpenseId}::uuid, ${ids.siPayableId}::uuid, ${ids.taxPayableId}::uuid,
                ${ids.loansReceivableId}::uuid, ${ids.salariesPayableId}::uuid, ${ids.deductionsPayableId}::uuid, ${userId}::uuid)
        ON CONFLICT ("companyId") DO UPDATE SET "salariesExpenseId" = EXCLUDED."salariesExpenseId", "employerSiExpenseId" = EXCLUDED."employerSiExpenseId",
          "siPayableId" = EXCLUDED."siPayableId", "taxPayableId" = EXCLUDED."taxPayableId", "loansReceivableId" = EXCLUDED."loansReceivableId",
          "salariesPayableId" = EXCLUDED."salariesPayableId", "deductionsPayableId" = EXCLUDED."deductionsPayableId", "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = now()`);
      await this.audit.record({ companyId, userId, action: 'PAYROLL_ACCOUNTS', entity: 'payroll_accounts', entityId: companyId, after: ids });
      return this.getAccounts(companyId);
    } catch (e) { return asHttp(e); }
  }

  private async accountsOrThrow(tx: Prisma.TransactionClient, companyId: string) {
    const [row] = await tx.$queryRaw<Record<string, string>[]>(Prisma.sql`SELECT * FROM payroll_accounts WHERE "companyId" = ${companyId}::uuid`);
    if (!row) throw new HrError('PAYROLL_ACCOUNTS_MISSING', 'Choose the payroll accounts before posting');
    return row;
  }

  private async branchFor(tx: Prisma.TransactionClient, companyId: string, branchId: string | null): Promise<string> {
    if (branchId) return branchId;
    const [b] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM branches WHERE "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1`);
    if (!b) throw new HrError('PAYROLL_BRANCH_MISSING', 'The company has no branch to post the payroll to');
    return b.id;
  }

  // ---- runs ----

  private async mustRun(tx: Prisma.TransactionClient | PrismaService, companyId: string, id: string, lock = false): Promise<RunRow> {
    const [run] = await tx.$queryRaw<RunRow[]>(Prisma.sql`
      SELECT id, month, status, "settingsId", "preparedBy", "approvedBy", "journalEntryId", "paymentJournalEntryId", "totalGross", "totalNet", "branchId"
        FROM payroll_runs WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
    if (!run) throw new HrError('PAYROLL_RUN_NOT_FOUND', 'Payroll run not found');
    return run;
  }

  private runView(r: RunRow) {
    return { id: r.id, month: r.month, status: r.status, totalGross: f4(r.totalGross), totalNet: f4(r.totalNet), preparedBy: r.preparedBy, approvedBy: r.approvedBy, journalEntryId: r.journalEntryId, paymentJournalEntryId: r.paymentJournalEntryId };
  }

  async listRuns(companyId: string) {
    const rows = await this.prisma.$queryRaw<RunRow[]>(Prisma.sql`
      SELECT id, month, status, "settingsId", "preparedBy", "approvedBy", "journalEntryId", "paymentJournalEntryId", "totalGross", "totalNet", "branchId"
        FROM payroll_runs WHERE "companyId" = ${companyId}::uuid ORDER BY month DESC LIMIT 120`);
    return { items: rows.map((r) => this.runView(r)) };
  }

  /// Company totals per month and per cost centre for posted and paid runs. Never per employee.
  async summaryReport(companyId: string, from: string, to: string) {
    try {
      const a = monthKey(from);
      const b = monthKey(to);
      if (a > b) throw new HrError('HR_MONTH_BAD', 'The first month is after the last month');
      const months = await this.prisma.$queryRaw<Record<string, string | number | Prisma.Decimal>[]>(Prisma.sql`
        SELECT r.month, r.status, count(l.id)::int AS employees,
               COALESCE(sum(l.basic),0) basic, COALESCE(sum(l.allowances),0) allowances, COALESCE(sum(l.overtime),0) overtime,
               COALESCE(sum(l.gross),0) gross, COALESCE(sum(l."employeeSI"),0) "employeeSI", COALESCE(sum(l."employerSI"),0) "employerSI",
               COALESCE(sum(l.tax),0) tax, COALESCE(sum(l.deductions + l."loanInstalment" + l."absenceDeduction" + l.penalty),0) "otherDeductions",
               COALESCE(sum(l.net),0) net
          FROM payroll_runs r JOIN payroll_run_lines l ON l."runId" = r.id
         WHERE r."companyId" = ${companyId}::uuid AND r.status IN ('POSTED','PAID') AND r.month BETWEEN ${a} AND ${b}
         GROUP BY r.month, r.status ORDER BY r.month`);
      const centres = await this.prisma.$queryRaw<Record<string, string | number | Prisma.Decimal | null>[]>(Prisma.sql`
        SELECT cc.code, cc."nameAr", COALESCE(sum(l.gross + l."employerSI"),0) cost
          FROM payroll_runs r JOIN payroll_run_lines l ON l."runId" = r.id
          LEFT JOIN cost_centers cc ON cc.id = l."costCenterId"
         WHERE r."companyId" = ${companyId}::uuid AND r.status IN ('POSTED','PAID') AND r.month BETWEEN ${a} AND ${b}
         GROUP BY cc.code, cc."nameAr" ORDER BY cc.code NULLS LAST`);
      const f = (v: unknown) => new Prisma.Decimal(String(v ?? 0)).toFixed(2);
      return {
        from: a, to: b,
        months: months.map((x) => ({
          month: x.month, status: x.status, employees: Number(x.employees), basic: f(x.basic), allowances: f(x.allowances), overtime: f(x.overtime),
          gross: f(x.gross), employeeSI: f(x.employeeSI), employerSI: f(x.employerSI), tax: f(x.tax), otherDeductions: f(x.otherDeductions), net: f(x.net),
        })),
        costCentres: centres.map((x) => ({ code: x.code ?? null, nameAr: x.nameAr ?? null, cost: f(x.cost) })),
      };
    } catch (e) {
      asHttp(e);
    }
  }

  async getRun(companyId: string, id: string) {
    try {
      const run = await this.mustRun(this.prisma, companyId, id);
      const lines = await this.prisma.$queryRaw<LineRow[]>(Prisma.sql`
        SELECT l.id, l."employeeId", e.code, e."nameAr", l."costCenterId", l.basic, l.allowances, l.overtime, l."absenceDeduction", l.penalty, l.gross,
               l."employeeSI", l."employerSI", l.tax, l.deductions, l."loanInstalment", l.net, l.proration
          FROM payroll_run_lines l JOIN hr_employees e ON e.id = l."employeeId" WHERE l."runId" = ${id}::uuid ORDER BY e.code`);
      return {
        ...this.runView(run),
        lines: lines.map((l) => ({
          id: l.id, employeeId: l.employeeId, code: l.code, nameAr: l.nameAr, basic: f4(l.basic), allowances: f4(l.allowances), overtime: f4(l.overtime),
          absenceDeduction: f4(l.absenceDeduction), penalty: f4(l.penalty), gross: f4(l.gross), employeeSI: f4(l.employeeSI), employerSI: f4(l.employerSI),
          tax: f4(l.tax), deductions: f4(l.deductions), loanInstalment: f4(l.loanInstalment), net: f4(l.net), proration: D(l.proration).toFixed(6),
        })),
      };
    } catch (e) { return asHttp(e); }
  }

  /** Create the month's run and calculate it. One run per month. */
  async createRun(companyId: string, userId: string, branchId: string | null, monthRaw: string) {
    try {
      const month = monthKey(monthRaw);
      const id = randomUUID();
      await this.prisma.$transaction(async (tx) => {
        const [exists] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM payroll_runs WHERE "companyId" = ${companyId}::uuid AND month = ${month}`);
        if (exists) throw new HrError('PAYROLL_MONTH_EXISTS', 'A payroll run already exists for this month', { month });
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO payroll_runs (id,"companyId","branchId",month,"preparedBy") VALUES (${id}::uuid, ${companyId}::uuid, ${branchId}::uuid, ${month}, ${userId}::uuid)`);
        await this.calculateIn(tx, companyId, id, month);
      });
      await this.audit.record({ companyId, userId, action: 'PAYROLL_RUN_CREATE', entity: 'payroll_runs', entityId: id, after: { month } });
      return this.getRun(companyId, id);
    } catch (e) { return asHttp(e); }
  }

  async recalculate(companyId: string, userId: string, id: string) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const run = await this.mustRun(tx, companyId, id, true);
        if (!['DRAFT', 'CALCULATED'].includes(run.status)) throw new HrError('PAYROLL_RUN_LOCKED', 'Only a run that is not yet approved can be recalculated', { status: run.status });
        await this.calculateIn(tx, companyId, id, run.month);
        await tx.$executeRaw(Prisma.sql`UPDATE payroll_runs SET "preparedBy" = ${userId}::uuid WHERE id = ${id}::uuid`);
      });
      await this.audit.record({ companyId, userId, action: 'PAYROLL_RUN_RECALCULATE', entity: 'payroll_runs', entityId: id });
      return this.getRun(companyId, id);
    } catch (e) { return asHttp(e); }
  }

  private async calculateIn(tx: Prisma.TransactionClient, companyId: string, runId: string, month: string) {
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
    const [settings] = await tx.$queryRaw<{ id: string; siEmployeeRate: Prisma.Decimal; siEmployerRate: Prisma.Decimal; siCeiling: Prisma.Decimal; taxBrackets: TaxBracket[]; personalExemption: Prisma.Decimal; overtimeFactor: Prisma.Decimal; monthDivisor: number; confirmedAt: Date | null }[]>(Prisma.sql`
      SELECT id,"siEmployeeRate","siEmployerRate","siCeiling","taxBrackets","personalExemption","overtimeFactor","monthDivisor","confirmedAt"
        FROM payroll_settings WHERE "companyId" = ${companyId}::uuid AND "effectiveFrom" <= ${monthEnd}::date ORDER BY "effectiveFrom" DESC LIMIT 1`);
    if (!settings || !settings.confirmedAt) throw new HrError('PAYROLL_SETTINGS_UNVERIFIED', 'The insurance and tax parameters for this month are missing or not confirmed', { month });

    const employees = await tx.$queryRaw<{ id: string; code: string; hireDate: Date; leaveDate: Date | null; costCenterId: string | null }[]>(Prisma.sql`
      SELECT id, code, "hireDate", "leaveDate", "costCenterId" FROM hr_employees
       WHERE "companyId" = ${companyId}::uuid AND "hireDate" <= ${monthEnd}::date AND ("leaveDate" IS NULL OR "leaveDate" >= ${monthStart}::date) ORDER BY code`);
    if (employees.length === 0) throw new HrError('PAYROLL_NO_EMPLOYEES', 'There are no employees employed in this month', { month });

    await tx.$executeRaw(Prisma.sql`DELETE FROM hr_loan_deductions WHERE "runId" = ${runId}::uuid`);
    await tx.$executeRaw(Prisma.sql`DELETE FROM payroll_run_lines WHERE "runId" = ${runId}::uuid`);
    const missingAttendance: string[] = [];
    const missingSalary: string[] = [];
    let totalGross = D(0);
    let totalNet = D(0);
    for (const emp of employees) {
      const [sal] = await tx.$queryRaw<{ id: string; basic: Prisma.Decimal; coveredBySI: boolean; coveredByTax: boolean }[]>(Prisma.sql`
        SELECT id, basic, "coveredBySI", "coveredByTax" FROM hr_salary_structures WHERE "employeeId" = ${emp.id}::uuid AND "effectiveFrom" <= ${monthEnd}::date ORDER BY "effectiveFrom" DESC LIMIT 1`);
      if (!sal) { missingSalary.push(emp.code); continue; }
      const [att] = await tx.$queryRaw<{ absenceDays: Prisma.Decimal; overtimeHours: Prisma.Decimal; penaltyAmount: Prisma.Decimal }[]>(Prisma.sql`
        SELECT "absenceDays","overtimeHours","penaltyAmount" FROM hr_attendance_summaries WHERE "employeeId" = ${emp.id}::uuid AND month = ${month}`);
      if (!att) { missingAttendance.push(emp.code); continue; }
      const items = await tx.$queryRaw<{ kind: 'ALLOWANCE' | 'DEDUCTION'; amount: Prisma.Decimal; subjectToSI: boolean; subjectToTax: boolean }[]>(Prisma.sql`
        SELECT kind, amount, "subjectToSI", "subjectToTax" FROM hr_salary_structure_items WHERE "structureId" = ${sal.id}::uuid`);
      const loans = await tx.$queryRaw<{ id: string; amount: Prisma.Decimal; instalments: number; remainingBalance: Prisma.Decimal }[]>(Prisma.sql`
        SELECT id, amount, instalments, "remainingBalance" FROM hr_employee_loans
         WHERE "companyId" = ${companyId}::uuid AND "employeeId" = ${emp.id}::uuid AND status = 'OPEN' AND "firstDeductionMonth" <= ${month} ORDER BY "loanDate"`);
      const due = loans.map((l) => ({ id: l.id, due: loanInstalmentDue(f4(l.amount), l.instalments, f4(l.remainingBalance)) })).filter((l) => l.due.gt(0));
      const loanTotal = due.reduce((a, l) => a.add(l.due), D(0));
      const line = calculateLine({
        month, hireDate: emp.hireDate.toISOString().slice(0, 10), leaveDate: emp.leaveDate ? emp.leaveDate.toISOString().slice(0, 10) : null,
        basic: f4(sal.basic), coveredBySI: sal.coveredBySI, coveredByTax: sal.coveredByTax,
        items: items.map((i) => ({ kind: i.kind, amount: f4(i.amount), subjectToSI: i.subjectToSI, subjectToTax: i.subjectToTax })),
        attendance: { absenceDays: String(att.absenceDays), overtimeHours: String(att.overtimeHours), penaltyAmount: f4(att.penaltyAmount) },
        settings: {
          siEmployeeRate: String(settings.siEmployeeRate), siEmployerRate: String(settings.siEmployerRate), siCeiling: f4(settings.siCeiling),
          taxBrackets: settings.taxBrackets, personalExemption: f4(settings.personalExemption), overtimeFactor: String(settings.overtimeFactor), monthDivisor: settings.monthDivisor,
        },
        loanInstalment: loanTotal.toFixed(4),
      });
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO payroll_run_lines (id,"runId","employeeId","costCenterId",basic,allowances,overtime,"absenceDeduction",penalty,gross,"employeeSI","employerSI",tax,deductions,"loanInstalment",net,proration)
        VALUES (${randomUUID()}::uuid, ${runId}::uuid, ${emp.id}::uuid, ${emp.costCenterId}::uuid, ${line.basic}::numeric, ${line.allowances}::numeric, ${line.overtime}::numeric,
                ${line.absenceDeduction}::numeric, ${line.penalty}::numeric, ${line.gross}::numeric, ${line.employeeSI}::numeric, ${line.employerSI}::numeric, ${line.tax}::numeric,
                ${line.deductions}::numeric, ${line.loanInstalment}::numeric, ${line.net}::numeric, ${line.proration}::numeric)`);
      for (const l of due) {
        await tx.$executeRaw(Prisma.sql`INSERT INTO hr_loan_deductions (id,"loanId","runId",amount) VALUES (${randomUUID()}::uuid, ${l.id}::uuid, ${runId}::uuid, ${l.due.toFixed(4)}::numeric)`);
      }
      totalGross = totalGross.add(line.gross);
      totalNet = totalNet.add(line.net);
    }
    if (missingSalary.length) throw new HrError('PAYROLL_SALARY_MISSING', 'Some employees have no salary set for this month', { employees: missingSalary.join(', '), month });
    if (missingAttendance.length) throw new HrError('PAYROLL_ATTENDANCE_MISSING', 'Enter the monthly attendance for every employee first', { employees: missingAttendance.join(', '), month });
    await tx.$executeRaw(Prisma.sql`
      UPDATE payroll_runs SET status = 'CALCULATED', "settingsId" = ${settings.id}::uuid, "totalGross" = ${totalGross.toFixed(4)}::numeric, "totalNet" = ${totalNet.toFixed(4)}::numeric,
        "approvedBy" = NULL, "approvedAt" = NULL, "updatedAt" = now() WHERE id = ${runId}::uuid`);
  }

  /** The approver must be a different person from whoever prepared the run. */
  async approve(companyId: string, userId: string, id: string) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const run = await this.mustRun(tx, companyId, id, true);
        if (run.status !== 'CALCULATED') throw new HrError('PAYROLL_RUN_STATE', 'Only a calculated run can be approved', { status: run.status });
        if (run.preparedBy === userId) throw new HrError('PAYROLL_APPROVER_IS_PREPARER', 'The person who prepared the run cannot approve it');
        await tx.$executeRaw(Prisma.sql`UPDATE payroll_runs SET status = 'APPROVED', "approvedBy" = ${userId}::uuid, "approvedAt" = now(), "updatedAt" = now() WHERE id = ${id}::uuid`);
      });
      await this.audit.record({ companyId, userId, action: 'PAYROLL_RUN_APPROVE', entity: 'payroll_runs', entityId: id });
      return this.getRun(companyId, id);
    } catch (e) { return asHttp(e); }
  }

  /** Post the approved run: expense and liabilities in one balanced entry, loans reduced in the same transaction. */
  async post(companyId: string, userId: string, id: string) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const run = await this.mustRun(tx, companyId, id, true);
        if (run.status !== 'APPROVED') throw new HrError('PAYROLL_RUN_STATE', 'Only an approved run can be posted', { status: run.status });
        const acc = await this.accountsOrThrow(tx, companyId);
        const lines = await tx.$queryRaw<{ costCenterId: string | null; gross: Prisma.Decimal; employeeSI: Prisma.Decimal; employerSI: Prisma.Decimal; tax: Prisma.Decimal; deductions: Prisma.Decimal; loanInstalment: Prisma.Decimal; net: Prisma.Decimal }[]>(Prisma.sql`
          SELECT "costCenterId", gross, "employeeSI", "employerSI", tax, deductions, "loanInstalment", net FROM payroll_run_lines WHERE "runId" = ${id}::uuid`);
        const sum = (pick: (l: (typeof lines)[number]) => Prisma.Decimal) => lines.reduce((a, l) => a.add(pick(l)), D(0));
        const byCentre = new Map<string, { gross: Prisma.Decimal; er: Prisma.Decimal }>();
        for (const l of lines) {
          const k = l.costCenterId ?? '';
          const cur = byCentre.get(k) ?? { gross: D(0), er: D(0) };
          byCentre.set(k, { gross: cur.gross.add(l.gross), er: cur.er.add(l.employerSI) });
        }
        const entry: Array<{ accountId: string; debit?: string; credit?: string; description: string; costCenterId?: string | null }> = [];
        for (const [centre, v] of byCentre) {
          if (v.gross.gt(0)) entry.push({ accountId: acc.salariesExpenseId, debit: v.gross.toFixed(4), description: `Salaries ${run.month}`, costCenterId: centre || null });
          if (v.er.gt(0)) entry.push({ accountId: acc.employerSiExpenseId, debit: v.er.toFixed(4), description: `Employer insurance ${run.month}`, costCenterId: centre || null });
        }
        const credit = (accountId: string, v: Prisma.Decimal, description: string) => { if (v.gt(0)) entry.push({ accountId, credit: v.toFixed(4), description }); };
        credit(acc.siPayableId, sum((l) => l.employeeSI).add(sum((l) => l.employerSI)), `Social insurance ${run.month}`);
        credit(acc.taxPayableId, sum((l) => l.tax), `Payroll tax ${run.month}`);
        credit(acc.loansReceivableId, sum((l) => l.loanInstalment), `Loan instalments ${run.month}`);
        credit(acc.deductionsPayableId, sum((l) => l.deductions), `Other deductions ${run.month}`);
        credit(acc.salariesPayableId, sum((l) => l.net), `Net salaries ${run.month}`);
        const posted = await this.posting.post(tx, {
          companyId, branchId: await this.branchFor(tx, companyId, run.branchId), userId, entryDate: new Date(), description: `Payroll ${run.month}`,
          sourceType: 'PAYROLL_RUN', sourceId: randomUUID(), sourceNumber: `PAY-${run.month}`, lines: entry,
        });
        const deductions = await tx.$queryRaw<{ id: string; loanId: string; amount: Prisma.Decimal }[]>(Prisma.sql`SELECT id, "loanId", amount FROM hr_loan_deductions WHERE "runId" = ${id}::uuid`);
        for (const d of deductions) {
          const [loan] = await tx.$queryRaw<{ remainingBalance: Prisma.Decimal }[]>(Prisma.sql`SELECT "remainingBalance" FROM hr_employee_loans WHERE id = ${d.loanId}::uuid FOR UPDATE`);
          const left = D(loan.remainingBalance).sub(d.amount);
          if (left.lt(0)) throw new HrError('PAYROLL_LOAN_CHANGED', 'A loan balance changed since the run was calculated. Recalculate the run');
          await tx.$executeRaw(Prisma.sql`UPDATE hr_employee_loans SET "remainingBalance" = ${left.toFixed(4)}::numeric, status = ${left.isZero() ? 'SETTLED' : 'OPEN'} WHERE id = ${d.loanId}::uuid`);
          await tx.$executeRaw(Prisma.sql`UPDATE hr_loan_deductions SET applied = true WHERE id = ${d.id}::uuid`);
        }
        await tx.$executeRaw(Prisma.sql`UPDATE payroll_runs SET status = 'POSTED', "postedBy" = ${userId}::uuid, "postedAt" = now(), "journalEntryId" = ${posted.id}::uuid, "updatedAt" = now() WHERE id = ${id}::uuid`);
      });
      await this.audit.record({ companyId, userId, action: 'PAYROLL_RUN_POST', entity: 'payroll_runs', entityId: id });
      return this.getRun(companyId, id);
    } catch (e) { return asHttp(e); }
  }

  /** Pay the net salaries from a cash or bank account. */
  async pay(companyId: string, userId: string, id: string, fundingAccountId: string) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const run = await this.mustRun(tx, companyId, id, true);
        if (run.status !== 'POSTED') throw new HrError('PAYROLL_RUN_STATE', 'Only a posted run can be paid', { status: run.status });
        const acc = await this.accountsOrThrow(tx, companyId);
        if (!uuidRe.test(String(fundingAccountId ?? ''))) throw new HrError('PAYROLL_FUNDING_REQUIRED', 'Choose the cash or bank account the salaries are paid from');
        const [fund] = await tx.$queryRaw<{ type: string; isPostable: boolean; isActive: boolean }[]>(Prisma.sql`
          SELECT type::text AS type, "isPostable", "isActive" FROM accounts WHERE id = ${fundingAccountId}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL`);
        if (!fund || fund.type !== 'ASSET' || !fund.isPostable || !fund.isActive) throw new HrError('PAYROLL_FUNDING_INVALID', 'The paying account must be an active, postable cash or bank account');
        if (D(run.totalNet).gt(0)) {
          const posted = await this.posting.post(tx, {
            companyId, branchId: await this.branchFor(tx, companyId, run.branchId), userId, entryDate: new Date(), description: `Salary payment ${run.month}`,
            sourceType: 'PAYROLL_PAYMENT', sourceId: randomUUID(), sourceNumber: `PAYOUT-${run.month}`,
            lines: [
              { accountId: acc.salariesPayableId, debit: f4(run.totalNet), description: `Net salaries ${run.month}` },
              { accountId: fundingAccountId, credit: f4(run.totalNet), description: `Net salaries ${run.month}` },
            ],
          });
          await tx.$executeRaw(Prisma.sql`UPDATE payroll_runs SET "paymentJournalEntryId" = ${posted.id}::uuid WHERE id = ${id}::uuid`);
        }
        await tx.$executeRaw(Prisma.sql`UPDATE payroll_runs SET status = 'PAID', "paidBy" = ${userId}::uuid, "paidAt" = now(), "updatedAt" = now() WHERE id = ${id}::uuid`);
      });
      await this.audit.record({ companyId, userId, action: 'PAYROLL_RUN_PAY', entity: 'payroll_runs', entityId: id });
      return this.getRun(companyId, id);
    } catch (e) { return asHttp(e); }
  }

  /** Reverse a posted run that has not been paid: the entry is reversed, loans are restored, the run goes back to calculated. */
  async reverse(companyId: string, userId: string, id: string) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const run = await this.mustRun(tx, companyId, id, true);
        if (run.status === 'PAID') throw new HrError('PAYROLL_RUN_PAID', 'A paid run cannot be reversed. Reverse the payment entry first');
        if (run.status !== 'POSTED' || !run.journalEntryId) throw new HrError('PAYROLL_RUN_STATE', 'Only a posted run can be reversed', { status: run.status });
        await this.posting.reverse(tx, companyId, userId, run.journalEntryId, `Reversal of payroll ${run.month}`);
        const deductions = await tx.$queryRaw<{ id: string; loanId: string; amount: Prisma.Decimal }[]>(Prisma.sql`SELECT id, "loanId", amount FROM hr_loan_deductions WHERE "runId" = ${id}::uuid AND applied`);
        for (const d of deductions) {
          await tx.$executeRaw(Prisma.sql`UPDATE hr_employee_loans SET "remainingBalance" = "remainingBalance" + ${f4(d.amount)}::numeric, status = 'OPEN' WHERE id = ${d.loanId}::uuid`);
          await tx.$executeRaw(Prisma.sql`UPDATE hr_loan_deductions SET applied = false WHERE id = ${d.id}::uuid`);
        }
        await tx.$executeRaw(Prisma.sql`UPDATE payroll_runs SET status = 'CALCULATED', "journalEntryId" = NULL, "approvedBy" = NULL, "approvedAt" = NULL, "postedBy" = NULL, "postedAt" = NULL, "updatedAt" = now() WHERE id = ${id}::uuid`);
      });
      await this.audit.record({ companyId, userId, action: 'PAYROLL_RUN_REVERSE', entity: 'payroll_runs', entityId: id });
      return this.getRun(companyId, id);
    } catch (e) { return asHttp(e); }
  }

  /** One employee's payslip for a calculated run: the same figures as the run line, with the company and month. */
  async payslip(companyId: string, runId: string, employeeId: string) {
    try {
      const run = await this.getRun(companyId, runId);
      const line = run.lines.find((l) => l.employeeId === employeeId);
      if (!line) throw new HrError('PAYROLL_PAYSLIP_NOT_FOUND', 'This employee is not in the payroll run');
      const [company] = await this.prisma.$queryRaw<{ nameAr: string }[]>(Prisma.sql`SELECT "nameAr" FROM companies WHERE id = ${companyId}::uuid`);
      return { company: company?.nameAr ?? '', month: run.month, status: run.status, line };
    } catch (e) { return asHttp(e); }
  }

  // ---- employee loans ----

  async listLoans(companyId: string, employeeId?: string) {
    const rows = await this.prisma.$queryRaw<{ id: string; employeeId: string; code: string; nameAr: string; loanDate: Date; amount: Prisma.Decimal; instalments: number; firstDeductionMonth: string; status: string; remainingBalance: Prisma.Decimal; note: string | null }[]>(Prisma.sql`
      SELECT l.id, l."employeeId", e.code, e."nameAr", l."loanDate", l.amount, l.instalments, l."firstDeductionMonth", l.status, l."remainingBalance", l.note
        FROM hr_employee_loans l JOIN hr_employees e ON e.id = l."employeeId"
       WHERE l."companyId" = ${companyId}::uuid ${employeeId ? Prisma.sql`AND l."employeeId" = ${employeeId}::uuid` : Prisma.empty} ORDER BY l."loanDate" DESC LIMIT 500`);
    return {
      items: rows.map((r) => ({
        id: r.id, employeeId: r.employeeId, code: r.code, nameAr: r.nameAr, loanDate: r.loanDate.toISOString().slice(0, 10), amount: f4(r.amount),
        instalments: r.instalments, firstDeductionMonth: r.firstDeductionMonth, status: r.status, remainingBalance: f4(r.remainingBalance), note: r.note,
      })),
    };
  }

  /** Give the employee a loan: the money leaves a cash or bank account into the loans receivable account. */
  async createLoan(companyId: string, userId: string, branchId: string | null, input: { employeeId?: string; loanDate?: string; amount?: string | number; instalments?: number | string; firstDeductionMonth?: string; fundingAccountId?: string; note?: string }) {
    try {
      const employeeId = String(input.employeeId ?? '');
      if (!uuidRe.test(employeeId)) throw new HrError('HR_EMPLOYEE_NOT_FOUND', 'Employee not found');
      const loanDate = isoDate(input.loanDate, 'loanDate');
      const amount = money(input.amount, 'amount');
      const instalments = Number(input.instalments);
      if (!Number.isInteger(instalments) || instalments < 1 || instalments > 120) throw new HrError('PAYROLL_LOAN_INSTALMENTS', 'The number of instalments must be a whole number from 1 to 120');
      const firstDeductionMonth = monthKey(input.firstDeductionMonth);
      const id = randomUUID();
      await this.prisma.$transaction(async (tx) => {
        const [emp] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT id FROM hr_employees WHERE id = ${employeeId}::uuid AND "companyId" = ${companyId}::uuid AND status = 'ACTIVE'`);
        if (!emp) throw new HrError('HR_EMPLOYEE_NOT_FOUND', 'Employee not found or no longer employed');
        const acc = await this.accountsOrThrow(tx, companyId);
        const fundingId = String(input.fundingAccountId ?? '');
        const [fund] = uuidRe.test(fundingId)
          ? await tx.$queryRaw<{ type: string; isPostable: boolean; isActive: boolean }[]>(Prisma.sql`SELECT type::text AS type, "isPostable", "isActive" FROM accounts WHERE id = ${fundingId}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL`)
          : [];
        if (!fund || fund.type !== 'ASSET' || !fund.isPostable || !fund.isActive) throw new HrError('PAYROLL_FUNDING_INVALID', 'The paying account must be an active, postable cash or bank account');
        const posted = await this.posting.post(tx, {
          companyId, branchId: await this.branchFor(tx, companyId, branchId), userId, entryDate: new Date(`${loanDate}T12:00:00Z`), description: 'Employee loan',
          sourceType: 'EMPLOYEE_LOAN', sourceId: id, sourceNumber: `LOAN-${id.slice(0, 8).toUpperCase()}`,
          lines: [
            { accountId: acc.loansReceivableId, debit: amount.toFixed(4), description: 'Employee loan' },
            { accountId: fundingId, credit: amount.toFixed(4), description: 'Employee loan' },
          ],
        });
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO hr_employee_loans (id,"companyId","employeeId","loanDate",amount,instalments,"firstDeductionMonth","journalEntryId","remainingBalance",note,"createdBy")
          VALUES (${id}::uuid, ${companyId}::uuid, ${employeeId}::uuid, ${loanDate}::date, ${amount.toFixed(4)}::numeric, ${instalments}, ${firstDeductionMonth}, ${posted.id}::uuid,
                  ${amount.toFixed(4)}::numeric, ${String(input.note ?? '').slice(0, 200) || null}, ${userId}::uuid)`);
      });
      await this.audit.record({ companyId, userId, action: 'EMPLOYEE_LOAN', entity: 'hr_employee_loans', entityId: id, after: { employeeId, amount: String(input.amount), instalments } });
      return (await this.listLoans(companyId, employeeId)).items.find((l) => l.id === id)!;
    } catch (e) { return asHttp(e); }
  }
}
