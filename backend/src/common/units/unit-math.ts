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
    factor = new Prisma.Decimal(String(value)).toDecimalPlaces(FACTOR_SCALE);
  } catch {
    throw new BadRequestException(`${field} is not a valid number`);
  }
  if (factor.isNegative() || factor.isZero()) {
    throw new BadRequestException(`${field} must be greater than zero`);
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

  if (input.purpose) {
    const problem = unitUsageProblem(row, input.purpose);
    if (problem) throw new BadRequestException(`${lineLabel}: ${problem}`);
  }

  // Whole units only. A carton of twenty-four bottles cannot be handed over as
  // half a carton, so the line is refused here rather than at the shelf.
  if (row.allowFraction === false && hasFraction(enteredQuantity)) {
    throw new BadRequestException(
      `${lineLabel}: unit "${row.unit}" does not accept fractional quantities; ` +
        `${enteredQuantity.toString()} is not a whole number of ${row.unit}`,
    );
  }

  const factor = parseFactor(row.factor, `${lineLabel} unit factor`);
  const baseQuantity = toBaseQuantity(enteredQuantity, factor);
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
 * unit's own price is used, falling back to the item-level price when the unit
 * carries no price of its own. The returned value is always per chosen unit.
 *
 * The item-level price is per BASE unit - that is what `Item.salePrice` means,
 * and what the stock ledger counts in - so choosing a reel of 500 must not
 * quote the price of one metre. When the unit has no price of its own, the
 * item price is multiplied by the unit's factor: a metre at 10 makes a reel of
 * 500 cost 5,000, automatically, with no second number to keep in step.
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
  const basePrice = new Prisma.Decimal(itemLevelPrice);
  if (!row) return basePrice.toDecimalPlaces(QUANTITY_SCALE);
  const factor = parseFactor(row.factor, `${row.unit} factor`);
  return basePrice.mul(factor).toDecimalPlaces(QUANTITY_SCALE);
}

/// A balance written the way a storekeeper says it: "9 rolls + 400 m".
///
/// The stock ledger keeps one number, always in the base unit. That number is
/// correct and unreadable at the same time: nobody counts 4,400 metres of
/// cable by hand. This breaks it into the largest unit that fits, then the
/// remainder, using the item's own units and their factors. Nothing is stored:
/// the composition is a rendering of the same base quantity, so two screens
/// never disagree about what is on the shelf.
///
/// `units` is the item's unit list (any order). The base unit is the row whose
/// factor is 1; a legacy item without one is composed of the base name alone.
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

  // Whatever is left is in base units. It is always shown when nothing else
  // was, so a balance of 3 metres reads "3 م" rather than an empty string.
  const remainder = remaining.toDecimalPlaces(QUANTITY_SCALE);
  if (!remainder.isZero() || parts.length === 0) {
    parts.push({ unit: baseUnitName, quantity: trimZeros(remainder) });
  }

  // A negative balance is written the way a person would read it out: the
  // minus belongs to every part, so the parts are joined with a minus rather
  // than an addition ("-1 لفة - 100 متر", never "-1 لفة + 100 متر").
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

/// The unit price implied by another unit's price and the two factors.
///
/// A reel of 500 m at 5,000 is 10 a metre. This is the arithmetic behind the
/// "implied price" the item screen shows beside a unit, so a person entering
/// both prices can see which one disagrees. It never writes anything.
export function impliedUnitPrice(input: {
  fromPrice: Prisma.Decimal | string | number;
  fromFactor: Prisma.Decimal | string | number;
  toFactor: Prisma.Decimal | string | number;
}): Prisma.Decimal {
  const price = new Prisma.Decimal(input.fromPrice);
  const from = parseFactor(input.fromFactor, 'fromFactor');
  const to = parseFactor(input.toFactor, 'toFactor');
  return price.mul(to).div(from).toDecimalPlaces(QUANTITY_SCALE);
}

/// How far two per-base-unit prices may drift before they are called a
/// contradiction. One piastre on a whole base unit: enough to absorb rounding
/// a person cannot avoid, far less than any deliberate price difference.
export const PRICE_CONSISTENCY_TOLERANCE = new Prisma.Decimal('0.01');

/// The price a unit implies per base unit, and whether another unit's price
/// agrees with it.
export function priceConsistency(input: {
  price: Prisma.Decimal | string | number;
  factor: Prisma.Decimal | string | number;
  expectedPerBaseUnit: Prisma.Decimal;
}): { perBaseUnit: Prisma.Decimal; consistent: boolean } {
  const perBaseUnit = impliedUnitPrice({
    fromPrice: input.price,
    fromFactor: input.factor,
    toFactor: 1,
  });
  return {
    perBaseUnit,
    consistent: perBaseUnit
      .minus(input.expectedPerBaseUnit)
      .abs()
      .lessThanOrEqualTo(PRICE_CONSISTENCY_TOLERANCE),
  };
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

/// The unit a movement was written in, as the snapshot the ledger keeps.
///
/// A document line already freezes this on the line; the movement is what the
/// stock reports read, so it has to carry the same three facts. A base-unit or
/// legacy line is written explicitly as factor 1 in the base unit rather than
/// as null: a movement is a fact about goods, and "500 metres, typed as 500
/// metres" is a different statement from "we do not know how this was typed".
export function movementUnitSnapshot(input: {
  enteredUnit?: string | null;
  enteredQuantity?: Prisma.Decimal | null;
  unitFactor?: Prisma.Decimal | null;
  baseUnitName: string;
  baseQuantity: Prisma.Decimal;
}): { enteredUnit: string; enteredQuantity: Prisma.Decimal; unitFactor: Prisma.Decimal } {
  const unit = normaliseLabel(input.enteredUnit) || normaliseLabel(input.baseUnitName) || 'unit';
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
