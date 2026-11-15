import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type OrderLine = { id: string; quantity: Prisma.Decimal; invoicedQuantity: Prisma.Decimal };
type Allocation = { orderLineId: string | null; quantity: Prisma.Decimal };

/** Compute new order counters while preserving allocations from other invoices. */
export function planOrderReallocation(
  lines: readonly OrderLine[],
  prior: readonly Allocation[],
  requested: ReadonlyMap<string, Prisma.Decimal>,
): Map<string, Prisma.Decimal> {
  if (prior.length === 0) throw new BadRequestException('Order invoice has no allocations; manual review required');
  const original = new Map<string, Prisma.Decimal>();
  const ids = new Set(lines.map((line) => line.id));
  for (const allocation of prior) {
    if (!allocation.orderLineId || !ids.has(allocation.orderLineId) ||
        !allocation.quantity.isFinite() || allocation.quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Historical order invoice lacks trustworthy allocations; manual review required');
    }
    original.set(allocation.orderLineId,
      (original.get(allocation.orderLineId) ?? new Prisma.Decimal(0)).plus(allocation.quantity));
  }
  const result = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    const old = original.get(line.id) ?? new Prisma.Decimal(0);
    const next = requested.get(line.id) ?? new Prisma.Decimal(0);
    const other = line.invoicedQuantity.minus(old);
    if (other.lessThan(0) || line.invoicedQuantity.greaterThan(line.quantity)) {
      throw new BadRequestException('Order allocation is inconsistent; manual review required');
    }
    const allocated = other.plus(next);
    if (allocated.greaterThan(line.quantity)) {
      throw new BadRequestException(`Order line ${line.id}: requested quantity exceeds remaining amount`);
    }
    result.set(line.id, allocated);
  }
  return result;
}
