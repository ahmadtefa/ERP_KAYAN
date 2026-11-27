/**
 * Customer installment plans.
 *
 * A plan splits one posted sales invoice into dated installments. Nothing is
 * paid "against an installment": the customer pays the invoice as usual, and
 * what has been paid so far is allocated to the installments oldest first.
 * All money is worked in whole piasters.
 */
export class InstallmentError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

export interface PlanInput {
  totalPiasters: number;
  downPaymentPiasters: number;
  count: number;
  intervalMonths: number;
  firstDue: string; // YYYY-MM-DD, due date of the first regular installment
  invoiceDate: string; // the down payment is due on the invoice date
}

export interface PlannedInstallment {
  no: number;
  dueDate: string;
  amountPiasters: number;
  isDownPayment: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function parseIsoDate(value: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new InstallmentError('Enter a date as YYYY-MM-DD');
  const y = Number(match[1]); const m = Number(match[2]); const d = Number(match[3]);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (m < 1 || m > 12 || d < 1 || d > dim) throw new InstallmentError('Enter a real calendar date');
  return { y, m, d };
}

/** The date `months` after `value`; a day past the end of the month falls on the month's last day. */
export function addMonths(value: string, months: number): string {
  const { y, m, d } = parseIsoDate(value);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad(nm)}-${pad(Math.min(d, dim))}`;
}

export function planInstallments(input: PlanInput): PlannedInstallment[] {
  const { totalPiasters, downPaymentPiasters, count, intervalMonths } = input;
  if (!Number.isInteger(totalPiasters) || totalPiasters <= 0) throw new InstallmentError('The invoice has no amount to split', 'INSTALLMENT_NO_AMOUNT');
  if (!Number.isInteger(downPaymentPiasters) || downPaymentPiasters < 0) throw new InstallmentError('The down payment cannot be negative');
  if (downPaymentPiasters >= totalPiasters) throw new InstallmentError('The down payment must be less than the invoice total', 'INSTALLMENT_DOWN_TOO_BIG');
  if (!Number.isInteger(count) || count < 2 || count > 120) throw new InstallmentError('Choose from 2 to 120 installments');
  if (!Number.isInteger(intervalMonths) || intervalMonths < 1 || intervalMonths > 12) throw new InstallmentError('The gap between installments is 1 to 12 months');
  parseIsoDate(input.invoiceDate);
  parseIsoDate(input.firstDue);
  if (input.firstDue < input.invoiceDate) throw new InstallmentError('The first installment cannot fall before the invoice date', 'INSTALLMENT_FIRST_BEFORE_INVOICE');
  const rest = totalPiasters - downPaymentPiasters;
  const base = Math.floor(rest / count);
  if (base < 1) throw new InstallmentError('Too many installments for this amount', 'INSTALLMENT_TOO_MANY');
  const remainder = rest - base * count;
  const out: PlannedInstallment[] = [];
  let no = 1;
  if (downPaymentPiasters > 0) out.push({ no: no++, dueDate: input.invoiceDate, amountPiasters: downPaymentPiasters, isDownPayment: true });
  for (let i = 0; i < count; i++) {
    out.push({
      no: no++,
      dueDate: addMonths(input.firstDue, i * intervalMonths),
      // The last installment takes the odd piasters so the plan adds up exactly.
      amountPiasters: base + (i === count - 1 ? remainder : 0),
      isDownPayment: false,
    });
  }
  return out;
}

export type InstallmentStatus = 'PAID' | 'PARTIAL' | 'OVERDUE' | 'UPCOMING';

export interface AllocatedInstallment extends PlannedInstallment {
  paidPiasters: number;
  remainingPiasters: number;
  status: InstallmentStatus;
}

/** Spreads what the customer has paid over the installments, oldest first. */
export function allocatePaid(plan: PlannedInstallment[], paidPiasters: number, today: string): AllocatedInstallment[] {
  let left = Math.max(0, paidPiasters);
  return [...plan]
    .sort((a, b) => a.no - b.no)
    .map((p) => {
      const paid = Math.min(left, p.amountPiasters);
      left -= paid;
      const remaining = p.amountPiasters - paid;
      const status: InstallmentStatus = remaining === 0 ? 'PAID' : p.dueDate < today ? 'OVERDUE' : paid > 0 ? 'PARTIAL' : 'UPCOMING';
      return { ...p, paidPiasters: paid, remainingPiasters: remaining, status };
    });
}

/** Whole days an installment is late as of `today`; 0 when it is not late. */
export function daysLate(dueDate: string, today: string): number {
  const a = parseIsoDate(dueDate); const b = parseIsoDate(today);
  const diff = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
  return diff > 0 ? diff : 0;
}

export const piasters = (n: number) => (n / 100).toFixed(2);

/** Money text to whole piasters, at most two decimals. */
export function parseMoney(value: unknown, field = 'amount'): number {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new InstallmentError(`Enter ${field} with at most two decimals`);
  const [whole, frac = ''] = text.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}
