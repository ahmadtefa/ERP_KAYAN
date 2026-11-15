import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { exactBaseQuantity, parseFactor, QUANTITY_SCALE, ResolvedUnit } from './unit-math';

/** Only an order service may construct this from its persisted order line. */
export interface TrustedOrderUnit {
  itemId: string;
  resolved: ResolvedUnit;
}

/** Recreate the historical snapshot; never consult today's unit catalogue. */
export function historicalOrderUnit(input: {
  label: string;
  unitName: string | null;
  unitFactor: Prisma.Decimal | null;
  baseQuantity: Prisma.Decimal;
}): ResolvedUnit {
  if (!input.baseQuantity.isFinite() || input.baseQuantity.lessThanOrEqualTo(0)) {
    throw new BadRequestException(`${input.label}: quantity must be greater than zero`);
  }
  const name = (input.unitName ?? '').trim();
  if (input.unitFactor === null) {
    if (name) throw new BadRequestException(`${input.label}: incomplete historical unit snapshot`);
    return { snapshot: { unitName: null, unitFactor: null, unitQuantity: null },
      baseQuantity: input.baseQuantity, row: null, isLegacy: true };
  }
  if (!name) throw new BadRequestException(`${input.label}: incomplete historical unit snapshot`);
  const factor = parseFactor(input.unitFactor, `${input.label} historical factor`);
  const ExactDecimal = Prisma.Decimal.clone({ precision: 80 });
  const divided = new ExactDecimal(input.baseQuantity.toString()).div(factor.toString());
  if (!divided.isFinite() || divided.lessThanOrEqualTo(0) ||
      !divided.equals(divided.toDecimalPlaces(QUANTITY_SCALE))) {
    throw new BadRequestException(`${input.label}: quantity cannot be represented at historical unit precision`);
  }
  const entered = new Prisma.Decimal(divided.toFixed());
  if (!exactBaseQuantity(entered, factor).equals(input.baseQuantity)) {
    throw new BadRequestException(`${input.label}: quantity cannot be represented at historical unit precision`);
  }
  return { snapshot: { unitName: name, unitFactor: factor, unitQuantity: entered },
    baseQuantity: input.baseQuantity, row: null, isLegacy: false };
}

/** Guard the trusted internal channel against accidental line misalignment. */
export function orderUnitForInvoiceLine(
  units: readonly TrustedOrderUnit[] | undefined,
  index: number,
  itemId: string | null | undefined,
  quantity: Prisma.Decimal,
): ResolvedUnit | undefined {
  if (!units) return undefined;
  const unit = units[index];
  if (!unit || unit.itemId !== itemId ||
      !(unit.resolved.snapshot.unitQuantity ?? unit.resolved.baseQuantity).equals(quantity)) {
    throw new BadRequestException('Order invoice unit snapshot does not match the invoice line');
  }
  return unit.resolved;
}
