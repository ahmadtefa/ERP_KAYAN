import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const MONEY_SCALE = 4;
const RATE_SCALE = 4;

export interface DiscountableInvoiceLine {
  lineTotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  discountPercent?: Prisma.Decimal;
  discountAmount?: Prisma.Decimal;
  landedCostAmount?: Prisma.Decimal;
  inventoryCostTotal?: Prisma.Decimal;
}

/**
 * Applies one document-wide discount before tax. A fixed discount is spread
 * proportionally across lines; the last non-zero line receives the rounding
 * remainder so the allocations always equal the requested discount exactly.
 * Tax is reduced by the same proportion as each line's net amount. For
 * purchase lines, inventory value is recomputed after discount plus landed cost.
 */
export function applyInvoiceDiscount<T extends DiscountableInvoiceLine>(
  sourceLines: T[],
  rawPercent?: string | null,
  rawAmount?: string | null,
): {
  lines: Array<T & { discountPercent: Prisma.Decimal; discountAmount: Prisma.Decimal }>;
  discountPercent: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
} {
  const percent = parseNonNegative(rawPercent ?? '0', 'discountPercent', RATE_SCALE);
  const fixed = parseNonNegative(rawAmount ?? '0', 'discountAmount', MONEY_SCALE);
  if (percent.greaterThan(0) && fixed.greaterThan(0)) {
    throw new BadRequestException('Choose either a percentage discount or a fixed discount, not both');
  }
  if (percent.greaterThan(100)) {
    throw new BadRequestException('discountPercent must be between 0 and 100');
  }

  const subtotal = sourceLines.reduce(
    (sum, line) => sum.plus(line.lineTotal),
    new Prisma.Decimal(0),
  );
  if (fixed.greaterThan(subtotal)) {
    throw new BadRequestException('discountAmount cannot exceed the invoice subtotal');
  }
  if (percent.greaterThan(0) && subtotal.isZero()) {
    throw new BadRequestException('A percentage discount requires a non-zero subtotal');
  }

  const requested = percent.greaterThan(0)
    ? subtotal.mul(percent).div(100).toDecimalPlaces(MONEY_SCALE)
    : fixed;
  const lastEligible = sourceLines.reduce(
    (last, line, index) => line.lineTotal.greaterThan(0) ? index : last,
    -1,
  );
  let remaining = requested;
  const lines = sourceLines.map((line, index) => {
    let allocated = new Prisma.Decimal(0);
    if (line.lineTotal.greaterThan(0)) {
      if (index === lastEligible) {
        allocated = remaining;
      } else if (percent.greaterThan(0)) {
        allocated = line.lineTotal.mul(percent).div(100).toDecimalPlaces(MONEY_SCALE);
      } else if (!subtotal.isZero()) {
        allocated = requested.mul(line.lineTotal).div(subtotal).toDecimalPlaces(MONEY_SCALE);
      }
      if (allocated.greaterThan(line.lineTotal)) allocated = line.lineTotal;
      remaining = remaining.minus(allocated);
    }

    const taxReduction = line.lineTotal.isZero()
      ? new Prisma.Decimal(0)
      : line.taxAmount.mul(allocated).div(line.lineTotal).toDecimalPlaces(MONEY_SCALE);
    const discountedTotal = line.lineTotal.minus(allocated);
    const effectivePercent = line.lineTotal.isZero()
      ? new Prisma.Decimal(0)
      : allocated.mul(100).div(line.lineTotal).toDecimalPlaces(RATE_SCALE);

    const result = {
      ...line,
      lineTotal: discountedTotal,
      taxAmount: line.taxAmount.minus(taxReduction),
      discountPercent: effectivePercent,
      discountAmount: allocated,
    };
    if (line.landedCostAmount !== undefined) {
      result.inventoryCostTotal = discountedTotal.plus(line.landedCostAmount);
    }
    return result;
  });

  const allocatedTotal = lines.reduce(
    (sum, line) => sum.plus(line.discountAmount),
    new Prisma.Decimal(0),
  );
  return {
    lines,
    discountPercent: percent,
    discountAmount: allocatedTotal,
  };
}

function parseNonNegative(value: string, field: string, scale: number): Prisma.Decimal {
  let result: Prisma.Decimal;
  try {
    result = new Prisma.Decimal(value).toDecimalPlaces(scale);
  } catch {
    throw new BadRequestException(`${field} is not a valid number`);
  }
  if (result.isNegative()) throw new BadRequestException(`${field} cannot be negative`);
  return result;
}
