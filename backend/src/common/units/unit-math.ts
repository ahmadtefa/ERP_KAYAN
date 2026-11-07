import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Multi-unit-of-measure domain logic.
 *
 * The system keeps stock and money in exactly one place each:
 *   - the stock ledger moves the BASE-unit quantity;
 *   - the document stores what the user typed as a frozen snapshot.
 *
 * Nothing here touches a database. Keeping the conversion rules pure is what
 * makes the milk ("1 carton = 10 pieces") and cable ("1 reel = 100 metres")
 * scenarios testable as plain arithmetic, and guarantees that every document
 * path applies the same rule.
 */

/// All quantities are stored at the money/quantity scale used everywhere else.
export const QUANTITY_SCALE = 4;
/// Conversion factors get two extra digits so a small unit can express a
/// fraction of a large one without collapsing to zero.
export const FACTOR_SCALE = 6;

export interface ItemUnitLike {
  id: string;
  unit: string;
  factor: Prisma.Decimal | string | number;
  isActive: boolean;
  salePrice?: Prisma.Decimal | null;
  purchasePrice?: Prisma.Decimal | null;
  /// A short label for printed columns. Falls back to the unit name.
  abbreviation?: string | null;
  /// Whole units only when false. Absent means "allowed", which is what every
  /// unit written before this rule existed meant.
  allowFraction?: boolean | null;
  /// Where the unit may be chosen. Absent means both, again for compatibility.
  usedInSales?: boolean | null;
  usedInPurchases?: boolean | null;
  sortOrder?: number | null;
}

/// Which document is asking. A unit can be a purchase unit only: the supplier
/// sells cartons while the shop sells bottles. Stock movements are neither -
/// goods leave and enter in whatever unit the storekeeper counted in.
export type UnitPurpose = 'sale' | 'purchase' | 'stock';

/**
 * The three columns frozen onto a document line. `null` for every field marks
 * a legacy row (or a line that simply used the base unit): the existing
 * `quantity` is then the entered quantity and needs no conversion.
 */
export interface UnitSnapshot {
  unitName: string | null;
  unitFactor: Prisma.Decimal | null;
  unitQuantity: Prisma.Decimal | null;
}

export interface ResolvedUnit {
  snapshot: UnitSnapshot;
  /// Always populated: the base-unit quantity the stock ledger must move.
  baseQuantity: Prisma.Decimal;
  /// The matched ItemUnit row, or null for a legacy/base-unit line.
  row: ItemUnitLike | null;
  /// True when no snapshot should be written and the line behaves as before.
  isLegacy: boolean;
}

/** Parse and validate a conversion factor: a positive number at factor scale. */
export function parseFactor(value: unknown, field = 'factor'): Prisma.Decimal {
  let factor: Prisma.Decimal;
  try {
    factor = new Prisma.Decimal(String(value));
  } catch {
    throw new BadRequestException(`${field} is not a valid number`);
  }
  if (!factor.isFinite() || factor.isNegative() || factor.isZero() || factor.greaterThanOrEqualTo('1e13')) {
    throw new BadRequestException(`${field} must be greater than zero and fit Decimal(19,6)`);
  }
  // Reject over-precise textual inputs even if their extra digits are zero.
  // Persisted Prisma.Decimal values stringify without artificial zero padding.
  const raw = String(value).trim();
  const match = raw.match(/^[+-]?(?:\d+(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
  const inputScale = match ? (match[1]?.length ?? match[2]?.length ?? 0) - Number(match[3] ?? 0) : 0;
  if (inputScale > FACTOR_SCALE || !factor.equals(factor.toDecimalPlaces(FACTOR_SCALE))) {
    throw new BadRequestException(`${field} supports at most ${FACTOR_SCALE} decimal places`);
  }
  return factor;
}

/**
 * Convert a quantity entered in a chosen unit into the base-unit quantity.
 * Rounding is deterministic (round-half-up via Prisma.Decimal) and limited to
 * the system's single quantity scale, so two documents never disagree about a
 * balance just because one expressed it in a bigger unit.
 */
export function toBaseQuantity(
  unitQuantity: Prisma.Decimal,
  factor: Prisma.Decimal,
): Prisma.Decimal {
  return unitQuantity.mul(factor).toDecimalPlaces(QUANTITY_SCALE);
}

/** Validate a new document quantity without silently changing it. */
export function parseDocumentQuantity(value: unknown, field: string): Prisma.Decimal {
  let quantity: Prisma.Decimal;
  try { quantity = new Prisma.Decimal(String(value)); }
  catch { throw new BadRequestException(`${field} is not a valid number`); }
  if (!quantity.isFinite() || quantity.abs().greaterThanOrEqualTo('1e15') || !quantity.equals(quantity.toDecimalPlaces(QUANTITY_SCALE))) {
    throw new BadRequestException(`${field} must be finite and have at most ${QUANTITY_SCALE} decimal places`);
  }
  return quantity;
}

/** New stock-changing documents must never round a converted quantity. */
export function exactBaseQuantity(quantity: Prisma.Decimal, factor: Prisma.Decimal): Prisma.Decimal {
  // Decimal's default precision is 20 significant digits, but a 19-digit
  // quantity times a 19-digit factor can need up to 38. Use an isolated
  // high-precision constructor so multiplication itself cannot round first.
  if (!quantity.isFinite() || quantity.abs().greaterThanOrEqualTo('1e15') ||
      !factor.isFinite() || factor.lessThanOrEqualTo(0) || factor.greaterThanOrEqualTo('1e13')) {
    throw new BadRequestException('Quantity or factor exceeds the supported storage range');
  }
  const ExactDecimal = Prisma.Decimal.clone({ precision: 80 });
  const exact = new ExactDecimal(quantity.toString()).mul(factor.toString());
  if (!exact.isFinite() || exact.abs().greaterThanOrEqualTo('1e15') || !exact.equals(exact.toDecimalPlaces(QUANTITY_SCALE))) {
    throw new BadRequestException(`Converted quantity cannot be represented at ${QUANTITY_SCALE} decimal places`);
  }
  return new Prisma.Decimal(exact.toFixed());
}

function normaliseLabel(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

/**
 * Resolve the unit a document line names into a frozen snapshot and a base
 * quantity. `units` is the item's full unit list (including inactive rows) so
 * an inactive unit can be reported precisely instead of as "not found".
 *
 * A request that names no unit resolves to the legacy representation: the
 * entered quantity is already the base quantity and no snapshot is written.
 */
export function resolveUnitSelection(input: {
  lineLabel: string;
  requestedUnitId?: string | null;
  requestedUnitName?: string | null;
  enteredQuantity: Prisma.Decimal;
  baseUnitName: string;
  units: ItemUnitLike[];
  /// Which document is asking. Omitted means "any document", which is what
  /// every caller written before unit usage flags existed meant.
  purpose?: UnitPurpose;
}): ResolvedUnit {
  const { lineLabel, enteredQuantity, baseUnitName, units } = input;
  const requestedName = normaliseLabel(input.requestedUnitName);
  const requestedId = normaliseLabel(input.requestedUnitId);

  if (!requestedId && !requestedName) {
    return {
      snapshot: { unitName: null, unitFactor: null, unitQuantity: null },
      baseQuantity: enteredQuantity,
      row: null,
      isLegacy: true,
    };
  }

  let row: ItemUnitLike | undefined;
  if (requestedId) {
    row = units.find((candidate) => candidate.id === requestedId);
    if (!row) {
      throw new BadRequestException(`${lineLabel}: the selected unit does not belong to this item`);
    }
  } else {
    row = units.find(
      (candidate) => candidate.unit.trim().toLowerCase() === requestedName.toLowerCase(),
    );
    if (!row) {
      // The item's own base unit is always valid even if no ItemUnit row has
      // been created for it yet (e.g. data created before this feature).
      if (requestedName.toLowerCase() === normaliseLabel(baseUnitName).toLowerCase()) {
        return {
          snapshot: {
            unitName: normaliseLabel(baseUnitName),
            unitFactor: new Prisma.Decimal(1),
            unitQuantity: enteredQuantity,
          },
          baseQuantity: enteredQuantity,
          row: null,
          isLegacy: false,
        };
      }
      throw new BadRequestException(
        `${lineLabel}: unit "${requestedName}" is not defined for this item`,
      );
    }
  }

  if (!row.isActive) {
    throw new BadRequestException(
      `${lineLabel}: unit "${row.unit}" is inactive and cannot be used on a new document`,
    );
  }

  // A unit that is enabled only for sales or only for purchases may still be
  // refused for the other purpose (a purchase unit on a sales line).
  if (input.purpose) {
    const problem = unitUsageProblem(row, input.purpose);
    if (problem) throw new BadRequestException(`${lineLabel}: ${problem}`);
  }

  const factor = parseFactor(row.factor, `${lineLabel} unit factor`);
  const baseQuantity = exactBaseQuantity(enteredQuantity, factor);
  if (baseQuantity.isZero()) {
    throw new BadRequestException(
      `${lineLabel}: the converted quantity is zero; check the unit factor and quantity`,
    );
  }

  return {
    snapshot: {
      unitName: row.unit,
      unitFactor: factor,
      unitQuantity: enteredQuantity,
    },
    baseQuantity,
    row,
    isLegacy: false,
  };
}

/**
 * Choose the default price of the SELECTED unit. An explicitly typed price
 * always wins (the caller decides that before calling this); otherwise the
 * unit's own price is used. If it has none, the item-level price is per base
 * unit and must be multiplied once by the selected unit's conversion factor.
 * The returned value is always per chosen unit.
 */
export function defaultUnitPrice(
  kind: 'sale' | 'purchase',
  row: ItemUnitLike | null,
  itemLevelPrice: Prisma.Decimal,
): Prisma.Decimal {
  const unitPrice = kind === 'sale' ? row?.salePrice : row?.purchasePrice;
  if (unitPrice !== null && unitPrice !== undefined) {
    return new Prisma.Decimal(unitPrice).toDecimalPlaces(QUANTITY_SCALE);
  }
  const factor = row ? parseFactor(row.factor, 'unit factor') : new Prisma.Decimal(1);
  return itemLevelPrice.mul(factor).toDecimalPlaces(QUANTITY_SCALE);
}

/** The unit label a document line displays, applying the legacy fallback. */
export function displayUnitName(
  line: { unitName?: string | null },
  baseUnitName: string | null | undefined,
): string | null {
  return line.unitName ?? baseUnitName ?? null;
}

/**
 * The quantity a document line displays. Legacy rows (no snapshot) show their
 * stored quantity, which already is the quantity the user entered.
 */
export function displayQuantity(line: {
  unitQuantity?: Prisma.Decimal | null;
  quantity: Prisma.Decimal;
}): Prisma.Decimal {
  return line.unitQuantity ?? line.quantity;
}

/// True when the quantity has a fraction of a unit in it. Used by the
/// whole-units rule, and by nothing else: a factor may be fractional, a price
/// always is.
export function hasFraction(value: Prisma.Decimal): boolean {
  return !value.equals(value.truncated());
}

/// The reason a unit cannot be used here, or null when it can.
export function unitUsageProblem(
  row: ItemUnitLike,
  purpose: UnitPurpose,
): string | null {
  if (purpose === 'sale' && row.usedInSales === false) {
    return `unit "${row.unit}" is not a selling unit for this item`;
  }
  if (purpose === 'purchase' && row.usedInPurchases === false) {
    return `unit "${row.unit}" is not a purchasing unit for this item`;
  }
  return null;
}

/// Compose a base quantity into the item's units, largest pack first, so two
/// screens never disagree about what is on the shelf.
export function composeQuantity(
  baseQuantity: Prisma.Decimal,
  units: ItemUnitLike[],
  baseUnitName: string,
): { text: string; parts: Array<{ unit: string; quantity: string }> } {
  const negative = baseQuantity.isNegative();
  let remaining = baseQuantity.abs();
  const usable = units
    .filter((row) => row.isActive !== false)
    .map((row) => ({
      unit: row.unit,
      factor: new Prisma.Decimal(row.factor).toDecimalPlaces(FACTOR_SCALE),
    }))
    .filter((row) => row.factor.greaterThan(0))
    .sort((left, right) => right.factor.comparedTo(left.factor));

  const parts: Array<{ unit: string; quantity: string }> = [];
  for (const row of usable) {
    if (row.factor.lessThanOrEqualTo(1)) continue;
    const count = remaining.div(row.factor).truncated();
    if (count.lessThanOrEqualTo(0)) continue;
    parts.push({ unit: row.unit, quantity: count.toFixed(0) });
    remaining = remaining.minus(count.mul(row.factor)).toDecimalPlaces(QUANTITY_SCALE);
  }

  const remainder = remaining.toDecimalPlaces(QUANTITY_SCALE);
  if (!remainder.isZero() || parts.length === 0) {
    parts.push({ unit: baseUnitName, quantity: trimZeros(remainder) });
  }

  const pieces = parts.map((part) => `${part.quantity} ${part.unit}`);
  return {
    text: negative ? `-${pieces.join(' - ')}` : pieces.join(' + '),
    parts: negative
      ? parts.map((part) => ({ ...part, quantity: `-${part.quantity}` }))
      : parts,
  };
}

/// Quantity text without a tail of zeros: "400", not "400.0000", but "0.5"
/// keeps its half.
export function trimZeros(value: Prisma.Decimal): string {
  const fixed = value.toFixed(QUANTITY_SCALE);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

/// The unit a movement was written in, as the snapshot the ledger keeps.
export function movementUnitSnapshot(input: {
  enteredUnit?: string | null;
  enteredQuantity?: Prisma.Decimal | null;
  unitFactor?: Prisma.Decimal | null;
  baseUnitName: string;
  baseQuantity: Prisma.Decimal;
}): { enteredUnit: string; enteredQuantity: Prisma.Decimal; unitFactor: Prisma.Decimal } {
  const unit = String(input.enteredUnit ?? '').trim() || String(input.baseUnitName ?? '').trim() || 'unit';
  const factor =
    input.unitFactor !== null && input.unitFactor !== undefined
      ? new Prisma.Decimal(input.unitFactor).toDecimalPlaces(FACTOR_SCALE)
      : new Prisma.Decimal(1);
  const entered =
    input.enteredQuantity !== null && input.enteredQuantity !== undefined
      ? new Prisma.Decimal(input.enteredQuantity).toDecimalPlaces(QUANTITY_SCALE)
      : input.baseQuantity;
  return { enteredUnit: unit, enteredQuantity: entered, unitFactor: factor };
}
