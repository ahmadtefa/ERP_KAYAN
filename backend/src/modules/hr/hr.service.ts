import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { asHttp, checkBrackets, daysInMonth, HrError, isoDate, maskTail, money, monthKey, nationalId, percent } from './hr-rules';

export type EmployeeInput = {
  code?: string; nameAr?: string; nameEn?: string; nationalId?: string; siNumber?: string; hireDate?: string;
  leaveDate?: string | null; status?: string; branchId?: string | null; costCenterId?: string | null;
  jobTitle?: string; bankAccount?: string;
};
export type SalaryItemInput = { kind?: string; nameAr?: string; amount?: string | number; subjectToSI?: boolean; subjectToTax?: boolean };
export type SalaryInput = { effectiveFrom?: string; basic?: string | number; coveredBySI?: boolean; coveredByTax?: boolean; items?: SalaryItemInput[] };
export type AttendanceRow = { employeeId?: string; workingDays?: string | number; absenceDays?: string | number; overtimeHours?: string | number; penaltyAmount?: string | number };
export type SettingsInput = {
  effectiveFrom?: string; siEmployeeRate?: string | number; siEmployerRate?: string | number; siCeiling?: string | number;
  taxBrackets?: unknown; personalExemption?: string | number; overtimeFactor?: string | number; monthDivisor?: number | string;
};

type EmployeeRow = {
  id: string; code: string; nameAr: string; nameEn: string | null; nationalId: string | null; siNumber: string | null;
  hireDate: Date; leaveDate: Date | null; status: string; branchId: string | null; costCenterId: string | null;
  jobTitle: string | null; bankAccount: string | null;
};
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const dec = (v: Prisma.Decimal.Value, p = 4) => new Prisma.Decimal(v).toFixed(p);

/** Employee file, salary structures, monthly attendance and the typed-in insurance/tax parameters. */
@Injectable()
export class HrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private view(r: EmployeeRow, personal: boolean) {
    return {
      id: r.id, code: r.code, nameAr: r.nameAr, nameEn: r.nameEn, hireDate: day(r.hireDate), leaveDate: day(r.leaveDate),
      status: r.status, branchId: r.branchId, costCenterId: r.costCenterId, jobTitle: r.jobTitle,
      nationalId: personal ? r.nationalId : maskTail(r.nationalId),
      siNumber: personal ? r.siNumber : maskTail(r.siNumber),
      bankAccount: personal ? r.bankAccount : maskTail(r.bankAccount),
      personalDataHidden: !personal,
    };
  }

  private async mustEmployee(companyId: string, id: string): Promise<EmployeeRow> {
    const [row] = await this.prisma.$queryRaw<EmployeeRow[]>(Prisma.sql`
      SELECT * FROM hr_employees WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid`);
    if (!row) throw new HrError('HR_EMPLOYEE_NOT_FOUND', 'Employee not found');
    return row;
  }

  private text(value: unknown, field: string, max: number, required: boolean): string | null {
    const v = String(value ?? '').trim();
    if (!v) {
      if (required) throw new HrError('HR_FIELD_REQUIRED', `${field} is required`, { field });
      return null;
    }
    if (v.length > max) throw new HrError('HR_FIELD_LONG', `${field} is too long`, { field });
    return v;
  }

  private async checkRefs(companyId: string, branchId: unknown, costCenterId: unknown) {
    if (branchId) {
      const [b] = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM branches WHERE id = ${String(branchId)}::uuid AND "companyId" = ${companyId}::uuid`);
      if (!b) throw new HrError('HR_BRANCH_NOT_FOUND', 'Branch not found');
    }
    if (costCenterId) {
      const [c] = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM cost_centers WHERE id = ${String(costCenterId)}::uuid AND "companyId" = ${companyId}::uuid AND "deletedAt" IS NULL`);
      if (!c) throw new HrError('HR_COST_CENTER_NOT_FOUND', 'Cost center not found');
    }
  }

  async listEmployees(companyId: string, query: { status?: string; q?: string }, personal: boolean) {
    const status = query.status === 'LEFT' || query.status === 'ALL' ? query.status : 'ACTIVE';
    const q = String(query.q ?? '').trim();
    const rows = await this.prisma.$queryRaw<EmployeeRow[]>(Prisma.sql`
      SELECT * FROM hr_employees
       WHERE "companyId" = ${companyId}::uuid
         AND (${status} = 'ALL' OR status = ${status})
         AND (${q} = '' OR code ILIKE ${'%' + q + '%'} OR "nameAr" ILIKE ${'%' + q + '%'} OR "nameEn" ILIKE ${'%' + q + '%'})
       ORDER BY code`);
    return { items: rows.map((r) => this.view(r, personal)) };
  }

  async getEmployee(companyId: string, id: string, personal: boolean) {
    try { return this.view(await this.mustEmployee(companyId, id), personal); } catch (e) { return asHttp(e); }
  }

  async createEmployee(companyId: string, userId: string, input: EmployeeInput) {
    try {
      const code = this.text(input.code, 'code', 32, true)!;
      const nameAr = this.text(input.nameAr, 'nameAr', 160, true)!;
      const hireDate = isoDate(input.hireDate, 'hireDate');
      await this.checkRefs(companyId, input.branchId, input.costCenterId);
      const id = randomUUID();
      try {
        await this.prisma.$executeRaw(Prisma.sql`
          INSERT INTO hr_employees (id,"companyId",code,"nameAr","nameEn","nationalId","siNumber","hireDate","branchId","costCenterId","jobTitle","bankAccount","createdBy")
          VALUES (${id}::uuid, ${companyId}::uuid, ${code}, ${nameAr}, ${this.text(input.nameEn, 'nameEn', 160, false)},
                  ${nationalId(input.nationalId)}, ${this.text(input.siNumber, 'siNumber', 32, false)}, ${hireDate}::date,
                  ${input.branchId ?? null}::uuid, ${input.costCenterId ?? null}::uuid,
                  ${this.text(input.jobTitle, 'jobTitle', 120, false)}, ${this.text(input.bankAccount, 'bankAccount', 64, false)}, ${userId}::uuid)`);
      } catch (error) {
        if (String((error as Error).message).includes('hr_employees_code')) throw new HrError('HR_EMPLOYEE_CODE_DUPLICATE', 'An employee with that code already exists', { code });
        throw error;
      }
      await this.audit.record({ companyId, userId, action: 'CREATE', entity: 'hr_employees', entityId: id, after: { code } });
      return this.view(await this.mustEmployee(companyId, id), true);
    } catch (e) { return asHttp(e); }
  }

  async updateEmployee(companyId: string, userId: string, id: string, input: EmployeeInput) {
    try {
      const cur = await this.mustEmployee(companyId, id);
      const nameAr = input.nameAr !== undefined ? this.text(input.nameAr, 'nameAr', 160, true)! : cur.nameAr;
      const hireDate = input.hireDate !== undefined ? isoDate(input.hireDate, 'hireDate') : day(cur.hireDate)!;
      const status = input.status !== undefined ? String(input.status).toUpperCase() : cur.status;
      if (status !== 'ACTIVE' && status !== 'LEFT') throw new HrError('HR_STATUS_BAD', 'Status must be ACTIVE or LEFT');
      const leaveDate = status === 'ACTIVE' ? null : input.leaveDate !== undefined && input.leaveDate !== null ? isoDate(input.leaveDate, 'leaveDate') : day(cur.leaveDate);
      if (status === 'LEFT' && !leaveDate) throw new HrError('HR_LEAVE_DATE_REQUIRED', 'A leaving date is required when the employee has left');
      if (leaveDate && leaveDate < hireDate) throw new HrError('HR_LEAVE_BEFORE_HIRE', 'The leaving date cannot be before the hire date');
      const branchId = input.branchId !== undefined ? input.branchId : cur.branchId;
      const costCenterId = input.costCenterId !== undefined ? input.costCenterId : cur.costCenterId;
      await this.checkRefs(companyId, branchId, costCenterId);
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE hr_employees SET "nameAr" = ${nameAr},
          "nameEn" = ${input.nameEn !== undefined ? this.text(input.nameEn, 'nameEn', 160, false) : cur.nameEn},
          "nationalId" = ${input.nationalId !== undefined ? nationalId(input.nationalId) : cur.nationalId},
          "siNumber" = ${input.siNumber !== undefined ? this.text(input.siNumber, 'siNumber', 32, false) : cur.siNumber},
          "hireDate" = ${hireDate}::date, "leaveDate" = ${leaveDate}::date, status = ${status},
          "branchId" = ${branchId ?? null}::uuid, "costCenterId" = ${costCenterId ?? null}::uuid,
          "jobTitle" = ${input.jobTitle !== undefined ? this.text(input.jobTitle, 'jobTitle', 120, false) : cur.jobTitle},
          "bankAccount" = ${input.bankAccount !== undefined ? this.text(input.bankAccount, 'bankAccount', 64, false) : cur.bankAccount},
          "updatedAt" = now()
         WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid`);
      await this.audit.record({ companyId, userId, action: 'UPDATE', entity: 'hr_employees', entityId: id, after: { status } });
      return this.view(await this.mustEmployee(companyId, id), true);
    } catch (e) { return asHttp(e); }
  }

  // ---- salary structures: each save is a new dated version, old ones stay ----

  async setSalary(companyId: string, userId: string, employeeId: string, input: SalaryInput) {
    try {
      await this.mustEmployee(companyId, employeeId);
      const effectiveFrom = isoDate(input.effectiveFrom, 'effectiveFrom');
      const basic = money(input.basic, 'basic', { allowZero: true });
      const items = (input.items ?? []).map((i, n) => {
        const kind = String(i.kind ?? '').toUpperCase();
        if (kind !== 'ALLOWANCE' && kind !== 'DEDUCTION') throw new HrError('HR_ITEM_KIND_BAD', 'Each line must be an allowance or a deduction', { row: String(n + 1) });
        return {
          kind, nameAr: this.text(i.nameAr, 'nameAr', 120, true)!, amount: money(i.amount, 'amount'),
          subjectToSI: i.subjectToSI !== false, subjectToTax: i.subjectToTax !== false,
        };
      });
      const structureId = randomUUID();
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hr_salary_structures (id,"companyId","employeeId","effectiveFrom",basic,"coveredBySI","coveredByTax","createdBy")
            VALUES (${structureId}::uuid, ${companyId}::uuid, ${employeeId}::uuid, ${effectiveFrom}::date, ${basic.toFixed(4)}::numeric,
                    ${input.coveredBySI !== false}, ${input.coveredByTax !== false}, ${userId}::uuid)`);
          for (const it of items) {
            await tx.$executeRaw(Prisma.sql`
              INSERT INTO hr_salary_structure_items (id,"structureId",kind,"nameAr",amount,"subjectToSI","subjectToTax")
              VALUES (${randomUUID()}::uuid, ${structureId}::uuid, ${it.kind}, ${it.nameAr}, ${it.amount.toFixed(4)}::numeric, ${it.subjectToSI}, ${it.subjectToTax})`);
          }
        });
      } catch (error) {
        if (String((error as Error).message).includes('hr_salary_structures_employeeId_effectiveFrom_key')) {
          throw new HrError('HR_SALARY_DATE_EXISTS', 'A salary structure already starts on that date. Choose a later date', { date: effectiveFrom });
        }
        throw error;
      }
      await this.audit.record({ companyId, userId, action: 'SALARY_SET', entity: 'hr_salary_structures', entityId: structureId, after: { employeeId, effectiveFrom } });
      return (await this.salaryHistory(companyId, employeeId)).items[0];
    } catch (e) { return asHttp(e); }
  }

  async salaryHistory(companyId: string, employeeId: string) {
    try {
      await this.mustEmployee(companyId, employeeId);
      const heads = await this.prisma.$queryRaw<{ id: string; effectiveFrom: Date; basic: Prisma.Decimal; coveredBySI: boolean; coveredByTax: boolean }[]>(Prisma.sql`
        SELECT id,"effectiveFrom",basic,"coveredBySI","coveredByTax" FROM hr_salary_structures
         WHERE "companyId" = ${companyId}::uuid AND "employeeId" = ${employeeId}::uuid ORDER BY "effectiveFrom" DESC`);
      const items = heads.length
        ? await this.prisma.$queryRaw<{ structureId: string; kind: string; nameAr: string; amount: Prisma.Decimal; subjectToSI: boolean; subjectToTax: boolean }[]>(Prisma.sql`
            SELECT "structureId",kind,"nameAr",amount,"subjectToSI","subjectToTax" FROM hr_salary_structure_items
             WHERE "structureId" IN (${Prisma.join(heads.map((h) => Prisma.sql`${h.id}::uuid`))}) ORDER BY kind, "nameAr"`)
        : [];
      return {
        items: heads.map((h) => ({
          id: h.id, effectiveFrom: day(h.effectiveFrom), basic: dec(h.basic), coveredBySI: h.coveredBySI, coveredByTax: h.coveredByTax,
          lines: items.filter((i) => i.structureId === h.id).map((i) => ({ kind: i.kind, nameAr: i.nameAr, amount: dec(i.amount), subjectToSI: i.subjectToSI, subjectToTax: i.subjectToTax })),
        })),
      };
    } catch (e) { return asHttp(e); }
  }

  // ---- attendance ----

  async getAttendance(companyId: string, monthRaw: string) {
    try {
      const month = monthKey(monthRaw);
      const rows = await this.prisma.$queryRaw<{ employeeId: string; code: string; nameAr: string; workingDays: Prisma.Decimal | null; absenceDays: Prisma.Decimal | null; overtimeHours: Prisma.Decimal | null; penaltyAmount: Prisma.Decimal | null }[]>(Prisma.sql`
        SELECT e.id AS "employeeId", e.code, e."nameAr", a."workingDays", a."absenceDays", a."overtimeHours", a."penaltyAmount"
          FROM hr_employees e LEFT JOIN hr_attendance_summaries a ON a."employeeId" = e.id AND a.month = ${month}
         WHERE e."companyId" = ${companyId}::uuid AND e.status = 'ACTIVE' ORDER BY e.code`);
      return {
        month, daysInMonth: daysInMonth(month),
        items: rows.map((r) => ({
          employeeId: r.employeeId, code: r.code, nameAr: r.nameAr, entered: r.workingDays !== null,
          workingDays: r.workingDays ? dec(r.workingDays, 2) : null, absenceDays: r.absenceDays ? dec(r.absenceDays, 2) : null,
          overtimeHours: r.overtimeHours ? dec(r.overtimeHours, 2) : null, penaltyAmount: r.penaltyAmount ? dec(r.penaltyAmount) : null,
        })),
      };
    } catch (e) { return asHttp(e); }
  }

  async saveAttendance(companyId: string, userId: string, monthRaw: string, rows: AttendanceRow[]) {
    try {
      const month = monthKey(monthRaw);
      const days = daysInMonth(month);
      if (!Array.isArray(rows) || rows.length === 0) throw new HrError('HR_ATTENDANCE_EMPTY', 'There are no attendance rows to save');
      const num = (v: unknown, field: string, max: number) => {
        const t = String(v ?? '0').trim() || '0';
        if (!/^\d+(\.\d{1,2})?$/.test(t) || Number(t) > max) throw new HrError('HR_ATTENDANCE_DAYS_INVALID', `${field} is not valid for this month`, { field, month, days: String(days) });
        return new Prisma.Decimal(t);
      };
      const seen = new Set<string>();
      const prepared: Array<{ employeeId: string; working: Prisma.Decimal; absence: Prisma.Decimal; overtime: Prisma.Decimal; penalty: Prisma.Decimal }> = [];
      for (const r of rows) {
        const employeeId = String(r.employeeId ?? '');
        if (seen.has(employeeId)) throw new HrError('HR_ATTENDANCE_DUPLICATE', 'An employee appears twice in the attendance list');
        seen.add(employeeId);
        await this.mustEmployee(companyId, employeeId);
        const working = num(r.workingDays, 'workingDays', days);
        const absence = num(r.absenceDays, 'absenceDays', days);
        if (absence.gt(days)) throw new HrError('HR_ATTENDANCE_DAYS_INVALID', 'absenceDays is not valid for this month', { field: 'absenceDays', month, days: String(days) });
        prepared.push({ employeeId, working, absence, overtime: num(r.overtimeHours, 'overtimeHours', 744), penalty: money(r.penaltyAmount ?? '0', 'penaltyAmount', { allowZero: true }) });
      }
      await this.prisma.$transaction(async (tx) => {
        for (const p of prepared) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hr_attendance_summaries (id,"companyId","employeeId",month,"workingDays","absenceDays","overtimeHours","penaltyAmount","createdBy")
            VALUES (${randomUUID()}::uuid, ${companyId}::uuid, ${p.employeeId}::uuid, ${month}, ${p.working.toFixed(2)}::numeric, ${p.absence.toFixed(2)}::numeric,
                    ${p.overtime.toFixed(2)}::numeric, ${p.penalty.toFixed(4)}::numeric, ${userId}::uuid)
            ON CONFLICT ("companyId","employeeId",month) DO UPDATE SET "workingDays" = EXCLUDED."workingDays", "absenceDays" = EXCLUDED."absenceDays",
              "overtimeHours" = EXCLUDED."overtimeHours", "penaltyAmount" = EXCLUDED."penaltyAmount", "createdBy" = EXCLUDED."createdBy", "updatedAt" = now()`);
        }
      });
      await this.audit.record({ companyId, userId, action: 'ATTENDANCE_SAVE', entity: 'hr_attendance_summaries', entityId: month, after: { rows: prepared.length } });
      return this.getAttendance(companyId, month);
    } catch (e) { return asHttp(e); }
  }

  // ---- insurance / tax parameter sets: typed by the company, confirmed before any run uses them ----

  async listSettings(companyId: string) {
    const rows = await this.prisma.$queryRaw<{ id: string; effectiveFrom: Date; siEmployeeRate: Prisma.Decimal; siEmployerRate: Prisma.Decimal; siCeiling: Prisma.Decimal; taxBrackets: unknown; personalExemption: Prisma.Decimal; overtimeFactor: Prisma.Decimal; monthDivisor: number; confirmedAt: Date | null }[]>(Prisma.sql`
      SELECT id,"effectiveFrom","siEmployeeRate","siEmployerRate","siCeiling","taxBrackets","personalExemption","overtimeFactor","monthDivisor","confirmedAt"
        FROM payroll_settings WHERE "companyId" = ${companyId}::uuid ORDER BY "effectiveFrom" DESC`);
    return {
      items: rows.map((r) => ({
        id: r.id, effectiveFrom: day(r.effectiveFrom), siEmployeeRate: dec(r.siEmployeeRate), siEmployerRate: dec(r.siEmployerRate),
        siCeiling: dec(r.siCeiling), taxBrackets: r.taxBrackets, personalExemption: dec(r.personalExemption),
        overtimeFactor: dec(r.overtimeFactor, 2), monthDivisor: r.monthDivisor, confirmed: r.confirmedAt !== null,
      })),
    };
  }

  async createSettings(companyId: string, userId: string, input: SettingsInput) {
    try {
      const effectiveFrom = isoDate(input.effectiveFrom, 'effectiveFrom');
      const brackets = checkBrackets(input.taxBrackets ?? []);
      const divisor = Number(input.monthDivisor ?? 30);
      if (!Number.isInteger(divisor) || divisor < 20 || divisor > 31) throw new HrError('HR_DIVISOR_BAD', 'The month divisor must be a whole number between 20 and 31');
      const id = randomUUID();
      try {
        await this.prisma.$executeRaw(Prisma.sql`
          INSERT INTO payroll_settings (id,"companyId","effectiveFrom","siEmployeeRate","siEmployerRate","siCeiling","taxBrackets","personalExemption","overtimeFactor","monthDivisor","createdBy")
          VALUES (${id}::uuid, ${companyId}::uuid, ${effectiveFrom}::date, ${percent(input.siEmployeeRate, 'siEmployeeRate').toFixed(4)}::numeric,
                  ${percent(input.siEmployerRate, 'siEmployerRate').toFixed(4)}::numeric, ${money(input.siCeiling ?? '0', 'siCeiling', { allowZero: true }).toFixed(4)}::numeric,
                  ${JSON.stringify(brackets)}::jsonb, ${money(input.personalExemption ?? '0', 'personalExemption', { allowZero: true }).toFixed(4)}::numeric,
                  ${money(input.overtimeFactor ?? '1', 'overtimeFactor', { allowZero: true }).toFixed(2)}::numeric, ${divisor}, ${userId}::uuid)`);
      } catch (error) {
        if (String((error as Error).message).includes('payroll_settings_companyId_effectiveFrom_key')) {
          throw new HrError('HR_SETTINGS_DATE_EXISTS', 'A parameter set already starts on that date. Choose a later date', { date: effectiveFrom });
        }
        throw error;
      }
      await this.audit.record({ companyId, userId, action: 'CREATE', entity: 'payroll_settings', entityId: id, after: { effectiveFrom } });
      return (await this.listSettings(companyId)).items.find((s) => s.id === id)!;
    } catch (e) { return asHttp(e); }
  }

  async confirmSettings(companyId: string, userId: string, id: string) {
    try {
      const [row] = await this.prisma.$queryRaw<{ confirmedAt: Date | null }[]>(Prisma.sql`
        SELECT "confirmedAt" FROM payroll_settings WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid`);
      if (!row) throw new HrError('HR_SETTINGS_NOT_FOUND', 'Parameter set not found');
      if (row.confirmedAt) throw new ConflictException({ code: 'HR_SETTINGS_ALREADY_CONFIRMED', message: 'This parameter set is already confirmed' });
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE payroll_settings SET "confirmedBy" = ${userId}::uuid, "confirmedAt" = now() WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid`);
      await this.audit.record({ companyId, userId, action: 'CONFIRM', entity: 'payroll_settings', entityId: id });
      return (await this.listSettings(companyId)).items.find((s) => s.id === id)!;
    } catch (e) { return asHttp(e); }
  }
}
