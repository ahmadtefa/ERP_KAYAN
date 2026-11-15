import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Reading the units a person typed on the item form.
 *
 * The item screen now carries the whole packing hierarchy - the base unit and
 * every carton, pack or dozen - instead of sending the operator to a second
 * dialog after saving. That means one request can carry arbitrary unit rows,
 * so the rules have to be checked once, in one place, before anything is
 * written:
 *
 *   - a name is required, free text, and unique inside the item (a second
 *     "كرتونة" would be two answers to the same question);
 *   - the factor is always "how many base units is one of these", never a
 *     chain (كرتونة = 4 دستات would silently drift the moment a دستة changed);
 *   - the base unit's factor is 1 and nothing else;
 *   - prices are optional and independent per unit.
 *
 * Everything here is pure: the service does the writing, this module decides
 * what a valid plan looks like.
 */

export const UNIT_NAME_MAX = 40;
export const UNIT_FACTOR_SCALE = 6;
const MONEY_SCALE = 4;

export interface ParsedUnitRow {
  /** Present when the row already exists and is being edited. */
  id?: string;
  unit: string;
  factor: Prisma.Decimal;
  barcode: string | null;
  salePrice: Prisma.Decimal | null;
  purchasePrice: Prisma.Decimal | null;
  abbreviation: string | null;
  allowFraction: boolean;
  usedInSales: boolean;
  usedInPurchases: boolean;
  sortOrder: number;
  /// Which optional fields the caller actually sent.
  ///
  /// The difference matters: a role without `inventory.cost.read` is shown the
  /// unit table without purchase prices, so the row it sends back has none -
  /// and writing that as "no purchase price" would erase what the company paid
  /// every time somebody without the grant edited a carton. Absent means
  /// "leave it", empty means "clear it".
  barcodeProvided: boolean;
  salePriceProvided: boolean;
  purchasePriceProvided: boolean;
  abbreviationProvided: boolean;
  allowFractionProvided: boolean;
  usageProvided: boolean;
  sortOrderProvided: boolean;
}

export interface ExistingUnitRow {
  id: string;
  unit: string;
  factor: Prisma.Decimal;
  isActive?: boolean;
}

export interface UnitPlan {
  /** Rows to update, keyed by the row they replace. */
  updates: Array<{ id: string; row: ParsedUnitRow }>;
  /** Rows that do not exist yet. */
  creates: ParsedUnitRow[];
  /** Rows that disappeared from the form: switched off, never deleted. */
  deactivateIds: string[];
  /** The base unit name the item must end up carrying. */
  baseUnit: string;
  /**
   * A base row that already exists but is named something else. Renaming it
   * must keep its barcode and its prices, so it is not sent as an ordinary
   * update row.
   */
  baseRename: { id: string; unit: string } | null;
  /** The item has no factor-1 row at all (imported before units existed). */
  createBase: boolean;
}

function flag(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['false', '0', 'no', 'لا'].includes(text)) return false;
  if (['true', '1', 'yes', 'نعم'].includes(text)) return true;
  return fallback;
}

function optionalAmount(value: unknown, label: string): Prisma.Decimal | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (text === '') return null;
  let parsed: Prisma.Decimal;
  try {
    parsed = new Prisma.Decimal(text);
  } catch {
    throw new BadRequestException(
      `${label}: "${text}" is not a number / ليست قيمة رقمية صحيحة`,
    );
  }
  if (parsed.isNegative()) {
    throw new BadRequestException(
      `${label} cannot be negative / لا يمكن أن تكون سالبة`,
    );
  }
  return parsed.toDecimalPlaces(MONEY_SCALE);
}

function integer(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Turns the `units` array of the request into validated rows.
 *
 * Returns null when the caller did not send `units` at all: that is the
 * difference between "leave the units alone" and "the form says there are
 * none", and conflating the two would switch off a catalogue by omission.
 */
export function parseUnitRows(
  raw: unknown,
  baseUnit: string,
): ParsedUnitRow[] | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) {
    throw new BadRequestException(
      'units must be a list / يجب أن تكون الوحدات قائمة',
    );
  }

  const base = String(baseUnit ?? '').trim();
  const baseKey = base.toLowerCase();
  const seen = new Set<string>();
  const rows: ParsedUnitRow[] = [];

  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') {
      throw new BadRequestException(
        'Every unit row must be an object / كل سطر وحدة يجب أن يكون بيانات',
      );
    }
    const row = entry as Record<string, unknown>;
    const unit = String(row.unit ?? '').trim();
    const label = unit === '' ? 'unit' : unit;

    if (unit === '') {
      throw new BadRequestException(
        'Every unit needs a name / كل وحدة تحتاج اسمًا',
      );
    }
    if (unit.length > UNIT_NAME_MAX) {
      throw new BadRequestException(
        `Unit name "${unit}" is longer than ${UNIT_NAME_MAX} characters / اسم الوحدة أطول من المسموح`,
      );
    }
    const key = unit.toLowerCase();
    if (seen.has(key)) {
      throw new BadRequestException(
        `Unit "${unit}" is listed twice; a unit name must be unique inside the item / الوحدة "${unit}" مكررة داخل الصنف`,
      );
    }
    seen.add(key);

    const rawFactor = String(row.factor ?? '').trim();
    const factorText = rawFactor === '' ? (key === baseKey ? '1' : '') : rawFactor;
    if (factorText === '') {
      throw new BadRequestException(
        `Unit "${label}" needs a conversion factor / الوحدة "${label}" تحتاج معامل تحويل`,
      );
    }
    let factor: Prisma.Decimal;
    try {
      factor = new Prisma.Decimal(factorText);
    } catch {
      throw new BadRequestException(
        `Unit "${label}" has an invalid factor: "${factorText}" / معامل تحويل غير صالح`,
      );
    }
    if (!factor.greaterThan(0)) {
      throw new BadRequestException(
        `Unit "${label}" factor must be greater than zero / معامل التحويل يجب أن يكون أكبر من صفر`,
      );
    }
    factor = factor.toDecimalPlaces(UNIT_FACTOR_SCALE);
    if (key === baseKey && !factor.equals(1)) {
      throw new BadRequestException(
        `The base unit factor must be 1 / معامل الوحدة الأساسية يجب أن يكون 1`,
      );
    }

    const barcodeText = String(row.barcode ?? '').trim();
    const idText = String(row.id ?? '').trim();

    const provided = (key: string) =>
      Object.prototype.hasOwnProperty.call(row, key);

    rows.push({
      ...(idText === '' ? {} : { id: idText }),
      unit,
      factor,
      barcode: barcodeText === '' ? null : barcodeText,
      salePrice: optionalAmount(row.salePrice, `Sale price of "${label}"`),
      purchasePrice: optionalAmount(
        row.purchasePrice,
        `Purchase price of "${label}"`,
      ),
      abbreviation: String(row.abbreviation ?? '').trim() || null,
      allowFraction: flag(row.allowFraction, true),
      usedInSales: flag(row.usedInSales, true),
      usedInPurchases: flag(row.usedInPurchases, true),
      sortOrder: integer(row.sortOrder),
      barcodeProvided: provided('barcode'),
      salePriceProvided: provided('salePrice'),
      purchasePriceProvided: provided('purchasePrice'),
      abbreviationProvided: provided('abbreviation'),
      allowFractionProvided: provided('allowFraction'),
      usageProvided: provided('usedInSales') || provided('usedInPurchases'),
      sortOrderProvided: provided('sortOrder'),
    });
  }

  return rows;
}

/**
 * What has to change in `item_units` for the item to match the form.
 *
 * Existing rows are matched by id first and by name second, so a form that
 * was opened before an item had ids (or a client that sends only names) still
 * edits the row it means instead of creating a twin. A row that vanished from
 * the form is switched off, never deleted: old documents must keep naming a
 * unit that exists.
 */
export function planUnitChanges(options: {
  baseUnit: string;
  rows: ParsedUnitRow[] | null;
  existing: ExistingUnitRow[];
}): UnitPlan | null {
  const { baseUnit, rows, existing } = options;
  if (rows === null) return null;

  const base = baseUnit.trim();
  const baseKey = base.toLowerCase();
  const byId = new Map(existing.map((row) => [row.id, row]));
  const byName = new Map(existing.map((row) => [row.unit.trim().toLowerCase(), row]));

  const updates: Array<{ id: string; row: ParsedUnitRow }> = [];
  const creates: ParsedUnitRow[] = [];
  const matched = new Set<string>();
  const baseRow = existing.find((row) => row.factor.equals(1));

  for (const row of rows) {
    const key = row.unit.trim().toLowerCase();
    // By id when the form carried one, otherwise by name - but only ever
    // against a row of *this* item, since `existing` is already scoped to it.
    // A row carrying the base unit's name is the base row even when it was
    // renamed, so the rename edits that row instead of creating a twin.
    const target = row.id
      ? (byId.get(row.id) ?? byName.get(key))
      : (byName.get(key) ?? (key === baseKey ? baseRow : undefined));
    if (target) {
      matched.add(target.id);
      updates.push({ id: target.id, row });
    } else {
      creates.push(row);
    }
  }

  // The base unit must exist as a factor-1 row whatever the form sent, because
  // every conversion resolves against it. Its name follows the item.
  let baseRename: { id: string; unit: string } | null = null;
  let createBase = false;
  if (!rows.some((row) => row.unit.trim().toLowerCase() === baseKey)) {
    if (baseRow) {
      matched.add(baseRow.id);
      if (baseRow.unit.trim().toLowerCase() !== baseKey) {
        baseRename = { id: baseRow.id, unit: base };
      }
    } else {
      createBase = true;
    }
  }

  const deactivateIds = existing
    .filter((row) => !matched.has(row.id))
    .filter((row) => row.isActive !== false)
    .map((row) => row.id);

  return {
    updates,
    creates,
    deactivateIds,
    baseUnit: base,
    baseRename,
    createBase,
  };
}
