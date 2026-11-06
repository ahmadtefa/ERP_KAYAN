import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { exactBaseQuantity, parseDocumentQuantity, parseFactor } from './unit-math';

type ExistingLine = {
  id: string;
  quantity: Prisma.Decimal;
  invoicedQuantity: Prisma.Decimal;
  unitName: string | null;
  unitFactor: Prisma.Decimal | null;
  unitQuantity: Prisma.Decimal | null;
  unitPrice?: Prisma.Decimal;
  discountPercent?: Prisma.Decimal;
  taxRate?: Prisma.Decimal;
};
type PlannedLine = {
  id: string;
  quantity: Prisma.Decimal;
  unitQuantity: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal;
  discountPercent: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
};

/** Amend existing draft lines only; never substitute today's unit factors. */
export function planDraftOrderEdit(existing: readonly ExistingLine[], raw: unknown, approved = false): {
  lines: PlannedLine[]; subTotal: Prisma.Decimal; taxAmount: Prisma.Decimal; totalAmount: Prisma.Decimal;
} {
  if (!Array.isArray(raw) || !existing.length || raw.length !== existing.length) {
    throw new BadRequestException('Every existing order line must be supplied exactly once');
  }
  const selections = new Map<string, Record<string, unknown>>();
  for (const input of raw as unknown[]) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Invalid order line');
    const row = input as Record<string, unknown>;
    const id = typeof row.orderLineId === 'string' ? row.orderLineId.trim() : '';
    if (!id || selections.has(id)) throw new BadRequestException('Invalid or duplicate order line');
    selections.set(id, row);
  }
  const decimal = (value: unknown, label: string, percent = false) => {
    let result: Prisma.Decimal;
    try { result = new Prisma.Decimal(String(value)); }
    catch { throw new BadRequestException(`${label} is not a valid number`); }
    if (!result.isFinite() || result.isNegative() || result.greaterThanOrEqualTo('1e15') ||
      !result.equals(result.toDecimalPlaces(4)) || (percent && result.greaterThan(100))) {
      throw new BadRequestException(`${label} is outside the supported range or precision`);
    }
    return result;
  };
  const Exact = Prisma.Decimal.clone({ precision: 80 });
  const asMoney = (value: Prisma.Decimal, label: string) => {
    const rounded = value.toDecimalPlaces(4);
    if (!rounded.isFinite() || rounded.isNegative() || rounded.greaterThanOrEqualTo('1e15')) {
      throw new BadRequestException(`${label} exceeds the supported money range`);
    }
    return new Prisma.Decimal(rounded.toFixed());
  };
  let sub = new Exact(0);
  let tax = new Exact(0);
  const lines = existing.map((line, index): PlannedLine => {
    const selection = selections.get(line.id);
    if (!selection) throw new BadRequestException('Selected line does not belong to this order');
    if (line.invoicedQuantity.isNegative() || line.invoicedQuantity.greaterThan(line.quantity)) {
      throw new BadRequestException('Order allocations are inconsistent; manual review required');
    }
    if (!approved && !line.invoicedQuantity.isZero()) throw new BadRequestException('Allocated order lines cannot be edited as a draft');
    const entered = parseDocumentQuantity(selection.quantity, `Line ${index + 1} quantity`);
    if (entered.lessThanOrEqualTo(0)) throw new BadRequestException('Quantity must be greater than zero');
    let quantity = entered;
    let unitQuantity: Prisma.Decimal | null = null;
    if (line.unitFactor === null) {
      if (line.unitName !== null || line.unitQuantity !== null) throw new BadRequestException('Incomplete historical unit snapshot');
    } else {
      if (!line.unitName || line.unitQuantity === null) throw new BadRequestException('Incomplete historical unit snapshot');
      const factor = parseFactor(line.unitFactor, 'historical unit factor');
      if (!exactBaseQuantity(line.unitQuantity, factor).equals(line.quantity)) {
        throw new BadRequestException('Inconsistent historical unit snapshot');
      }
      quantity = exactBaseQuantity(entered, factor);
      unitQuantity = entered;
    }
    if (quantity.lessThan(line.invoicedQuantity)) {
      throw new BadRequestException('Quantity cannot be less than the allocated quantity');
    }
    const price = decimal(selection.unitPrice, 'unitPrice');
    const discountPercent = decimal(selection.discountPercent, 'discountPercent', true);
    const taxRate = decimal(selection.taxRate, 'taxRate', true);
    // Existing invoices are immutable snapshots. To keep the order's own
    // aggregate meaningful as well, financial terms of allocated lines cannot
    // be repriced; unallocated lines may still be amended.
    if (approved && !line.invoicedQuantity.isZero() &&
        (!line.unitPrice || !line.discountPercent || !line.taxRate ||
         !price.equals(line.unitPrice) || !discountPercent.equals(line.discountPercent) || !taxRate.equals(line.taxRate))) {
      throw new BadRequestException('Financial terms of allocated lines cannot be changed');
    }
    const net = asMoney(new Exact(entered.toString()).mul(price.toString()), 'line subtotal');
    const discount = asMoney(new Exact(net.toString()).mul(discountPercent.toString()).div(100), 'line discount');
    const taxable = new Exact(net.toString()).minus(discount.toString());
    const lineTax = asMoney(taxable.mul(taxRate.toString()).div(100), 'line tax');
    const lineTotal = asMoney(taxable.plus(lineTax.toString()), 'line total');
    sub = sub.plus(taxable);
    tax = tax.plus(lineTax.toString());
    return { id: line.id, quantity, unitQuantity, unitPrice: price, discountPercent, taxRate, lineTotal };
  });
  return { lines, subTotal: asMoney(sub, 'subtotal'), taxAmount: asMoney(tax, 'tax'), totalAmount: asMoney(sub.plus(tax), 'total') };
}
