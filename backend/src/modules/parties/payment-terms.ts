/**
 * Customer payment terms: pure date arithmetic, no database.
 *
 * Every method takes a free number of [days]. All dates are calendar dates
 * (UTC midnight), so the result never moves with the server's time zone.
 * Months of different lengths are handled by clamping a requested day of the
 * month to the last day of that month (day 31 in April is April 30).
 */

export const PAYMENT_TERM_METHODS = [
  'FROM_INVOICE_DATE',
  'FROM_MONTH_END',
  'FROM_NEXT_MONTH_START',
  'FROM_DELIVERY_DATE',
  'FIXED_DAY_NEXT_MONTH',
  'EARLY_DISCOUNT',
  'COD_ADVANCE',
  'INSTALLMENTS',
  'DAY_WINDOWS',
  'MILESTONES',
  'LATE_PENALTY',
  'WEEKLY_CUTOFF',
] as const;
export type PaymentTermMethod = (typeof PAYMENT_TERM_METHODS)[number];
export const DEFAULT_PAYMENT_TERM_METHOD: PaymentTermMethod = 'FROM_INVOICE_DATE';

export interface Installment {
  /** Share of the invoice, 0 < percent <= 100. Shares must add up to 100. */
  percent: number;
  /** Days after the base date (the invoice date) this share falls due. */
  afterDays: number;
  /** Milestone name; only used by MILESTONES. */
  label?: string;
}
export interface DayWindow {
  fromDay: number;
  toDay: number;
  /** Day of the month the invoices of this window fall due. */
  payDay: number;
  /** 0 = same month as the invoice, 1 = next month. */
  monthOffset: 0 | 1;
}
export interface PenaltyConfig {
  /** Percent of the overdue amount charged for each period. */
  percent: number;
  period: 'DAY' | 'MONTH';
  /** Days after the due date before the penalty starts. */
  graceDays: number;
}
export interface PaymentTermConfig {
  /** FIXED_DAY_NEXT_MONTH: 1..31. */
  dayOfMonth?: number;
  /** EARLY_DISCOUNT: e.g. 2 percent when paid within 10 days (2/10 net 30). */
  discountPercent?: number;
  discountDays?: number;
  /** INSTALLMENTS and MILESTONES. */
  installments?: Installment[];
  /** DAY_WINDOWS. */
  windows?: DayWindow[];
  /** WEEKLY_CUTOFF: 0 = Sunday ... 6 = Saturday. */
  weekday?: number;
  /** Optional on every method, required for LATE_PENALTY. */
  penalty?: PenaltyConfig;
}
export interface PaymentTerm {
  method: PaymentTermMethod;
  days: number;
  config?: PaymentTermConfig | null;
}
export interface DueShare {
  /** YYYY-MM-DD */
  dueDate: string;
  percent: number;
  label?: string;
}
export interface DueSchedule {
  shares: DueShare[];
  /** The date the first share falls due; ageing starts counting from it. */
  firstDueDate: string;
  lastDueDate: string;
  discount?: { percent: number; lastDay: string };
}

export class PaymentTermError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

const DAY_MS = 86_400_000;

export function parseDate(text: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!m) throw new PaymentTermError('date', 'Invalid date');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw new PaymentTermError('date', 'Invalid date');
  }
  return d;
}
export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}
function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}
/** Day [day] of the month [monthsAhead] after d's month, clamped to its length. */
function dayOfMonth(d: Date, monthsAhead: number, day: number): Date {
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthsAhead, 1));
  const last = daysInMonth(first.getUTCFullYear(), first.getUTCMonth());
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, last)));
}

function intIn(field: string, v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new PaymentTermError(field, `${field} must be a whole number from ${min} to ${max}`);
  }
  return v;
}
function numIn(field: string, v: unknown, minExclusive: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= minExclusive || v > max) {
    throw new PaymentTermError(field, `${field} must be greater than ${minExclusive} and at most ${max}`);
  }
  return v;
}

function validateShares(field: string, list: Installment[] | undefined, needLabel: boolean): Installment[] {
  if (!Array.isArray(list) || list.length < 2 || list.length > 24) {
    throw new PaymentTermError(field, `${field} needs from 2 to 24 entries`);
  }
  let total = 0;
  const out = list.map((s, i) => {
    const percent = numIn(`${field}[${i}].percent`, s?.percent, 0, 100);
    const afterDays = intIn(`${field}[${i}].afterDays`, s?.afterDays, 0, 3650);
    if (needLabel && (typeof s.label !== 'string' || s.label.trim() === '' || s.label.length > 80)) {
      throw new PaymentTermError(`${field}[${i}].label`, 'Each milestone needs a name');
    }
    total += Math.round(percent * 10000);
    return { percent, afterDays, ...(needLabel ? { label: s.label!.trim() } : {}) };
  });
  if (total !== 1_000_000) throw new PaymentTermError(field, 'The shares must add up to exactly 100 percent');
  return out;
}

/** Throws PaymentTermError naming the field when the term is not usable. */
export function validatePaymentTerm(term: PaymentTerm): PaymentTerm {
  if (!(PAYMENT_TERM_METHODS as readonly string[]).includes(term.method)) {
    throw new PaymentTermError('paymentTermMethod', 'Unknown payment term method');
  }
  const days = intIn('paymentTermDays', term.days, 0, 3650);
  const c: PaymentTermConfig = { ...(term.config ?? {}) };
  const out: PaymentTermConfig = {};
  switch (term.method) {
    case 'FIXED_DAY_NEXT_MONTH':
      out.dayOfMonth = intIn('dayOfMonth', c.dayOfMonth, 1, 31);
      break;
    case 'EARLY_DISCOUNT':
      out.discountPercent = numIn('discountPercent', c.discountPercent, 0, 100);
      out.discountDays = intIn('discountDays', c.discountDays, 0, 3650);
      if (out.discountDays >= Math.max(days, 1)) {
        throw new PaymentTermError('discountDays', 'The discount period must be shorter than the payment period');
      }
      break;
    case 'INSTALLMENTS':
      out.installments = validateShares('installments', c.installments, false);
      break;
    case 'MILESTONES':
      out.installments = validateShares('installments', c.installments, true);
      break;
    case 'DAY_WINDOWS': {
      if (!Array.isArray(c.windows) || c.windows.length < 1 || c.windows.length > 12) {
        throw new PaymentTermError('windows', 'windows needs from 1 to 12 entries');
      }
      const seen = new Array<boolean>(32).fill(false);
      out.windows = c.windows.map((w, i) => {
        const fromDay = intIn(`windows[${i}].fromDay`, w?.fromDay, 1, 31);
        const toDay = intIn(`windows[${i}].toDay`, w?.toDay, 1, 31);
        const payDay = intIn(`windows[${i}].payDay`, w?.payDay, 1, 31);
        if (toDay < fromDay) throw new PaymentTermError(`windows[${i}].toDay`, 'toDay must not be before fromDay');
        if (w.monthOffset !== 0 && w.monthOffset !== 1) {
          throw new PaymentTermError(`windows[${i}].monthOffset`, 'monthOffset must be 0 or 1');
        }
        for (let d = fromDay; d <= toDay; d++) {
          if (seen[d]) throw new PaymentTermError('windows', 'Windows must not overlap');
          seen[d] = true;
        }
        return { fromDay, toDay, payDay, monthOffset: w.monthOffset };
      });
      for (let d = 1; d <= 31; d++) {
        if (!seen[d]) throw new PaymentTermError('windows', 'Every day of the month must belong to a window');
      }
      break;
    }
    case 'WEEKLY_CUTOFF':
      out.weekday = intIn('weekday', c.weekday, 0, 6);
      break;
    case 'LATE_PENALTY':
      if (!c.penalty) throw new PaymentTermError('penalty', 'A late penalty needs its rate');
      break;
    default:
      break;
  }
  if (c.penalty) {
    out.penalty = {
      percent: numIn('penalty.percent', c.penalty.percent, 0, 100),
      period: c.penalty.period === 'MONTH' ? 'MONTH' : c.penalty.period === 'DAY' ? 'DAY' : (() => { throw new PaymentTermError('penalty.period', 'period must be DAY or MONTH'); })(),
      graceDays: intIn('penalty.graceDays', c.penalty.graceDays ?? 0, 0, 3650),
    };
  }
  return { method: term.method, days, config: Object.keys(out).length ? out : null };
}

/** The base date the single due date counts from, before adding [days]. */
function baseDate(term: PaymentTerm, invoice: Date, delivery: Date | null): Date {
  const c = term.config ?? {};
  switch (term.method) {
    case 'FROM_MONTH_END':
      return dayOfMonth(invoice, 0, 31);
    case 'FROM_NEXT_MONTH_START':
      return dayOfMonth(invoice, 1, 1);
    case 'FROM_DELIVERY_DATE':
      return delivery ?? invoice;
    case 'FIXED_DAY_NEXT_MONTH':
      return dayOfMonth(invoice, 1, c.dayOfMonth ?? 1);
    case 'DAY_WINDOWS': {
      const day = invoice.getUTCDate();
      const w = (c.windows ?? []).find((x) => day >= x.fromDay && day <= x.toDay);
      if (!w) throw new PaymentTermError('windows', 'No window covers this day of the month');
      return dayOfMonth(invoice, w.monthOffset, w.payDay);
    }
    case 'WEEKLY_CUTOFF': {
      const ahead = ((c.weekday ?? 0) - invoice.getUTCDay() + 7) % 7;
      return addDays(invoice, ahead);
    }
    default:
      return invoice;
  }
}

/**
 * The payment schedule for an invoice dated [invoiceDate] (YYYY-MM-DD).
 * [deliveryDate] is only used by FROM_DELIVERY_DATE; without one the invoice
 * date is used. The term must already be valid.
 */
export function computeDueSchedule(term: PaymentTerm, invoiceDate: string, deliveryDate?: string | null): DueSchedule {
  const t = validatePaymentTerm(term);
  const invoice = parseDate(invoiceDate);
  const delivery = deliveryDate ? parseDate(deliveryDate) : null;
  let shares: DueShare[];
  if (t.method === 'INSTALLMENTS' || t.method === 'MILESTONES') {
    shares = (t.config!.installments ?? []).map((s) => ({
      dueDate: formatDate(addDays(invoice, s.afterDays + t.days)),
      percent: s.percent,
      ...(s.label ? { label: s.label } : {}),
    }));
    shares.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  } else {
    shares = [{ dueDate: formatDate(addDays(baseDate(t, invoice, delivery), t.days)), percent: 100 }];
  }
  const schedule: DueSchedule = {
    shares,
    firstDueDate: shares[0].dueDate,
    lastDueDate: shares[shares.length - 1].dueDate,
  };
  if (t.method === 'EARLY_DISCOUNT') {
    schedule.discount = {
      percent: t.config!.discountPercent!,
      lastDay: formatDate(addDays(invoice, t.config!.discountDays!)),
    };
  }
  return schedule;
}

/**
 * The amounts of each share, in the invoice's smallest unit (e.g. cents).
 * Each share is rounded, and the last takes the remainder so the parts always
 * add up to the total.
 */
export function splitAmount(totalMinor: number, shares: readonly { percent: number }[]): number[] {
  const out: number[] = [];
  let used = 0;
  shares.forEach((s, i) => {
    const part = i === shares.length - 1 ? totalMinor - used : Math.round((totalMinor * Math.round(s.percent * 10000)) / 1_000_000);
    out.push(part);
    used += part;
  });
  return out;
}

/**
 * How much of an invoice is overdue on [asOf]: the shares already due, minus
 * what has been paid, never below zero. A share is due once its date is before
 * [asOf] (paying on the due date itself is on time).
 */
export function overdueMinor(schedule: DueSchedule, totalMinor: number, paidMinor: number, asOf: string): number {
  const parts = splitAmount(totalMinor, schedule.shares);
  let due = 0;
  schedule.shares.forEach((s, i) => {
    if (s.dueDate < asOf) due += parts[i];
  });
  return Math.max(0, due - paidMinor);
}

/**
 * The late penalty on an overdue amount. Charged per started period after the
 * grace days: DAY counts each late day; MONTH counts each started 30 days.
 */
export function penaltyMinor(overdueAmountMinor: number, dueDate: string, asOf: string, penalty: PenaltyConfig): number {
  const late = Math.round((parseDate(asOf).getTime() - parseDate(dueDate).getTime()) / DAY_MS) - penalty.graceDays;
  if (late <= 0 || overdueAmountMinor <= 0) return 0;
  const periods = penalty.period === 'DAY' ? late : Math.ceil(late / 30);
  return Math.round((overdueAmountMinor * Math.round(penalty.percent * 10000) * periods) / 1_000_000);
}
