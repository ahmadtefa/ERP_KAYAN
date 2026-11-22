import { Prisma } from '@prisma/client';

/// Internal barcode generation and unit conversion.
///
/// Kept free of database access so the arithmetic - and the check digit that
/// makes a printed label readable by a scanner - can be tested on its own.
///
/// The generated codes are EAN-13: twelve digits the program chooses and a
/// thirteenth that is the check digit. A code that fails the check digit is
/// not a code a scanner will read, so generating one without it would produce
/// labels that look right and scan wrong.

/// The prefix of codes the program makes up itself. GS1 reserves 20-29 for
/// internal use, so an internal code can never be mistaken for a
/// manufacturer's product code.
export const INTERNAL_BARCODE_PREFIX = '200';

export function ean13CheckDigit(payload: string): string {
  if (!/^\d{12}$/.test(payload)) {
    throw new Error('EAN-13 payload must be exactly 12 digits');
  }
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const digit = Number(payload[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return String((10 - (sum % 10)) % 10);
}

export function withEan13CheckDigit(payload: string): string {
  return payload + ean13CheckDigit(payload);
}

/// True for a complete 13-digit code whose last digit is the right check
/// digit. Anything else - a supplier's 8-digit code, a QR payload, an
/// internal SKU - is still a valid thing to scan; it simply is not an EAN-13,
/// so this is only used to decide whether *our own* generated code is sound.
export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === code[12];
}

/// A twelve-digit payload for an internal code: the reserved prefix plus a
/// numeric body. The body comes from the caller (a counter or a random
/// number) so the function stays deterministic and testable.
export function internalBarcodePayload(body: string | number): string {
  const digits = String(body).replace(/\D/g, '');
  if (digits.length === 0) throw new Error('a barcode body is required');
  if (digits.length > 12 - INTERNAL_BARCODE_PREFIX.length) {
    throw new Error('barcode body is too long for the internal prefix');
  }
  return INTERNAL_BARCODE_PREFIX + digits.padStart(12 - INTERNAL_BARCODE_PREFIX.length, '0');
}

/// A random internal barcode. Random rather than sequential on purpose: two
/// people adding items on two machines cannot coordinate a counter, but they
/// will almost never collide on a random body, and the caller still checks the
/// result against the database.
export function randomInternalBarcode(): string {
  const body = String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
  return withEan13CheckDigit(internalBarcodePayload(body));
}

/// Base units contained in `quantity` of a unit with the given factor.
///
/// Stock is kept in the item's base unit, and the quantity column has four
/// decimal places. Multiplying by the factor is exact for the factors the
/// program accepts (six decimals), so the only question is what to do with a
/// result that needs more than four places: it is rounded half-up, because
/// truncating would quietly lose stock every time somebody sold a third of a
/// carton.
export function toBaseQuantity(
  quantity: Prisma.Decimal | string | number,
  factor: Prisma.Decimal | string | number,
): Prisma.Decimal {
  const q = new Prisma.Decimal(quantity);
  const f = new Prisma.Decimal(factor);
  return q.mul(f).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

/// The opposite direction, for showing a base-unit balance in the unit a
/// person counts in ("12 cartons", not "240 pieces").
export function fromBaseQuantity(
  baseQuantity: Prisma.Decimal | string | number,
  factor: Prisma.Decimal | string | number,
): Prisma.Decimal {
  const q = new Prisma.Decimal(baseQuantity);
  const f = new Prisma.Decimal(factor);
  if (f.isZero()) throw new Error('factor must not be zero');
  return q.div(f).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}
