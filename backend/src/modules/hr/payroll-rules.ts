import { Prisma } from '@prisma/client';

import { daysInMonth, HrError, TaxBracket } from './hr-rules';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const r2 = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

export type SalaryItem = { kind: 'ALLOWANCE' | 'DEDUCTION'; amount: string; subjectToSI: boolean; subjectToTax: boolean };
export type PayrollInput = {
  month: string; // 2026-03
  hireDate: string; // yyyy-mm-dd
  leaveDate: string | null;
  basic: string;
  coveredBySI: boolean;
  coveredByTax: boolean;
  items: SalaryItem[];
  attendance: { absenceDays: string; overtimeHours: string; penaltyAmount: string } | null;
  settings: {
    siEmployeeRate: string; siEmployerRate: string; siCeiling: string; taxBrackets: TaxBracket[];
    personalExemption: string; overtimeFactor: string; monthDivisor: number;
  };
  loanInstalment: string;
};

export type PayrollLine = {
  basic: string; allowances: string; overtime: string; absenceDeduction: string; penalty: string; gross: string;
  employeeSI: string; employerSI: string; tax: string; deductions: string; loanInstalment: string; net: string;
  proration: string;
};

/** Share of the month the employee was employed: calendar days from hire to leave over days in the month. */
export function prorationFor(month: string, hireDate: string, leaveDate: string | null): Prisma.Decimal {
  const total = daysInMonth(month);
  const first = `${month}-01`;
  const last = `${month}-${String(total).padStart(2, '0')}`;
  const start = hireDate > first ? hireDate : first;
  const end = leaveDate && leaveDate < last ? leaveDate : last;
  if (end < start) return D(0);
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return D(Math.round(ms / 86400000) + 1).div(total);
}

/** Tax on an annual amount by the brackets the company typed in. */
export function bracketTax(annual: Prisma.Decimal, brackets: TaxBracket[]): Prisma.Decimal {
  let tax = D(0);
  for (const b of brackets) {
    const from = D(b.from);
    if (annual.lte(from)) break;
    const upper = b.to === null ? annual : Prisma.Decimal.min(annual, D(b.to));
    tax = tax.add(upper.sub(from).mul(D(b.ratePercent)).div(100));
  }
  return tax;
}

/**
 * One employee, one month. Every rate, ceiling, bracket and divisor comes from the confirmed
 * settings; nothing here is a law figure. Each component is rounded half-up to 2 places and
 * gross and net are sums of those rounded components, so a payslip always adds up.
 */
export function calculateLine(input: PayrollInput): PayrollLine {
  const s = input.settings;
  const f = prorationFor(input.month, input.hireDate, input.leaveDate);
  if (f.isZero()) throw new HrError('PAYROLL_NOT_EMPLOYED', 'The employee was not employed in this month');
  const divisor = D(s.monthDivisor);
  const basicFull = D(input.basic);
  const allowances = input.items.filter((i) => i.kind === 'ALLOWANCE');
  const sum = (items: SalaryItem[], pick?: (i: SalaryItem) => boolean) =>
    items.filter((i) => (pick ? pick(i) : true)).reduce((a, i) => a.add(D(i.amount)), D(0));

  const basic = r2(basicFull.mul(f));
  const allowancesTotal = r2(sum(allowances).mul(f));
  const att = input.attendance ?? { absenceDays: '0', overtimeHours: '0', penaltyAmount: '0' };
  const dailyBase = basicFull.add(sum(allowances, (i) => i.subjectToSI)).div(divisor);
  const absenceDeduction = r2(dailyBase.mul(D(att.absenceDays)));
  const overtime = r2(basicFull.div(divisor).div(8).mul(D(att.overtimeHours)).mul(D(s.overtimeFactor)));
  const penalty = r2(D(att.penaltyAmount));
  const gross = basic.add(allowancesTotal).add(overtime).sub(absenceDeduction).sub(penalty);
  if (gross.lt(0)) throw new HrError('PAYROLL_NEGATIVE_GROSS', 'Absence and penalties are more than the earnings');

  const siBase = input.coveredBySI ? basic.add(r2(sum(allowances, (i) => i.subjectToSI).mul(f))) : D(0);
  const siCapped = Prisma.Decimal.min(siBase, D(s.siCeiling));
  const employeeSI = r2(siCapped.mul(D(s.siEmployeeRate)).div(100));
  const employerSI = r2(siCapped.mul(D(s.siEmployerRate)).div(100));

  let tax = D(0);
  if (input.coveredByTax) {
    const monthlyBase = basic.add(r2(sum(allowances, (i) => i.subjectToTax).mul(f))).add(overtime).sub(absenceDeduction).sub(penalty);
    const annual = Prisma.Decimal.max(monthlyBase.mul(12).sub(D(s.personalExemption)), D(0));
    tax = r2(bracketTax(annual, s.taxBrackets).div(12));
  }
  const deductions = r2(sum(input.items.filter((i) => i.kind === 'DEDUCTION')));
  const loan = r2(D(input.loanInstalment));
  const net = gross.sub(employeeSI).sub(tax).sub(deductions).sub(loan);
  if (net.lt(0)) throw new HrError('PAYROLL_NEGATIVE_NET', 'Deductions are more than the pay');
  const f2 = (v: Prisma.Decimal) => v.toFixed(4);
  return {
    basic: f2(basic), allowances: f2(allowancesTotal), overtime: f2(overtime), absenceDeduction: f2(absenceDeduction), penalty: f2(penalty),
    gross: f2(gross), employeeSI: f2(employeeSI), employerSI: f2(employerSI), tax: f2(tax), deductions: f2(deductions),
    loanInstalment: f2(loan), net: f2(net), proration: f.toFixed(6),
  };
}

/** The instalment due this month: the plan amount, or what is left if that is less. Never negative. */
export function loanInstalmentDue(amount: string, instalments: number, remaining: string): Prisma.Decimal {
  const plan = r2(D(amount).div(instalments));
  const left = D(remaining);
  if (left.lte(0)) return D(0);
  return Prisma.Decimal.min(plan, left);
}
