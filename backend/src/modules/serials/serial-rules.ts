/**
 * Serial numbers and warranty.
 *
 * A serial unit is one physical piece of an item. It is registered into stock,
 * assigned to a posted sales invoice when it is sold (which starts its warranty),
 * and may come back (returned) or be written off (scrapped).
 */
export type SerialStatus = 'IN_STOCK' | 'SOLD' | 'RETURNED' | 'SCRAPPED';
export type SerialAction = 'sell' | 'return' | 'scrap';

export class SerialError extends Error {}

const MOVES: Record<SerialAction, { from: SerialStatus[]; to: SerialStatus }> = {
  sell: { from: ['IN_STOCK', 'RETURNED'], to: 'SOLD' },
  return: { from: ['SOLD'], to: 'RETURNED' },
  scrap: { from: ['IN_STOCK', 'RETURNED'], to: 'SCRAPPED' },
};

export function nextSerialStatus(current: SerialStatus, action: SerialAction): SerialStatus {
  const move = MOVES[action];
  if (!move.from.includes(current)) {
    throw new SerialError(`A serial that is ${current.toLowerCase().replace('_', ' ')} cannot be ${action === 'sell' ? 'sold' : action === 'return' ? 'returned' : 'scrapped'}`);
  }
  return move.to;
}

export const MAX_SERIAL_LENGTH = 64;
export const MAX_BATCH = 500;

/** One serial as typed: trimmed, inner spaces refused, case kept but compared case-insensitively. */
export function cleanSerial(raw: unknown): string {
  const v = String(raw ?? '').trim();
  if (!v) throw new SerialError('A serial number cannot be empty');
  if (v.length > MAX_SERIAL_LENGTH) throw new SerialError(`Serial "${v.slice(0, 20)}..." is longer than ${MAX_SERIAL_LENGTH} characters`);
  if (/\s/.test(v)) throw new SerialError(`Serial "${v}" has a space inside it`);
  return v;
}

/** A pasted list: one per line or separated by commas or semicolons. Repeats inside the list are an error. */
export function parseSerialList(input: unknown): string[] {
  const items = (Array.isArray(input) ? input : String(input ?? '').split(/[\n\r,;]+/))
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0);
  if (items.length === 0) throw new SerialError('Enter at least one serial number');
  if (items.length > MAX_BATCH) throw new SerialError(`At most ${MAX_BATCH} serial numbers at a time`);
  const cleaned = items.map(cleanSerial);
  const seen = new Set<string>();
  for (const s of cleaned) {
    const key = s.toLowerCase();
    if (seen.has(key)) throw new SerialError(`Serial "${s}" is entered twice in the list`);
    seen.add(key);
  }
  return cleaned;
}

/** Whole months, 0 to 240. Empty means no warranty. */
export function parseWarrantyMonths(value: unknown): number {
  if (value === undefined || value === null || String(value).trim() === '') return 0;
  const text = String(value).trim();
  if (!/^\d{1,3}$/.test(text)) throw new SerialError('Warranty months must be a whole number');
  const n = Number(text);
  if (n > 240) throw new SerialError('Warranty cannot be longer than 240 months');
  return n;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The last day of the warranty: the sale date plus whole months, and a day that does not
 * exist in the target month falls on that month's last day (31 Jan + 1 month = 28/29 Feb).
 * The warranty covers the whole of the end date.
 */
export function warrantyEndDate(soldOn: string, months: number): string | null {
  if (months <= 0) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(soldOn);
  if (!m) throw new SerialError('The sale date must be YYYY-MM-DD');
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const total = y * 12 + mo + months;
  const ty = Math.floor(total / 12);
  const tm = total % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${pad(tm + 1)}-${pad(Math.min(d, last))}`;
}

export type WarrantyState = 'NOT_SOLD' | 'NONE' | 'ACTIVE' | 'EXPIRED';

export function warrantyState(status: SerialStatus, endsOn: string | null, today: string): WarrantyState {
  if (status !== 'SOLD') return 'NOT_SOLD';
  if (!endsOn) return 'NONE';
  return today <= endsOn ? 'ACTIVE' : 'EXPIRED';
}

/** Days left on an active warranty (0 on its last day), or null when not active. */
export function warrantyDaysLeft(endsOn: string | null, today: string): number | null {
  if (!endsOn || today > endsOn) return null;
  return Math.round((Date.parse(endsOn) - Date.parse(today)) / 86_400_000);
}
