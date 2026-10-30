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
}

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
export function resolveUnitSelection(input: {
  lineLabel: string;
  requestedUnitId?: string | null;
  requestedUnitName?: string | null;
  enteredQuantity: Prisma.Decimal;
  baseUnitName: string;
  units: ItemUnitLike[];
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
