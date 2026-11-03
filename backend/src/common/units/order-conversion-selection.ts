import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseDocumentQuantity } from './unit-math';

/** Explicit base-unit quantities only; omitted or duplicate lines are ambiguous. */
export function selectedOrderLineQuantities(
  input: unknown,
  orderLines: ReadonlyArray<{ id: string }>,
): Map<string, Prisma.Decimal> {
  if (!Array.isArray(input) || input.length === 0) {
    throw new BadRequestException('Select the order lines and quantities to invoice');
  }
  const available = new Set(orderLines.map((line) => line.id));
  const requested = new Map<string, Prisma.Decimal>();
  for (const value of input as unknown[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Invalid order line selection');
    }
    const raw = value as { orderLineId?: unknown; quantity?: unknown };
    const id = typeof raw.orderLineId === 'string' ? raw.orderLineId.trim() : '';
    if (!id || !available.has(id)) {
      throw new BadRequestException('Selected order line does not belong to this order');
    }
    if (requested.has(id)) {
      throw new BadRequestException('An order line was selected more than once');
    }
    const quantity = parseDocumentQuantity(raw.quantity, 'quantity');
    if (quantity.lessThanOrEqualTo(0)) {
      throw new BadRequestException('quantity must be greater than zero');
    }
    requested.set(id, quantity);
  }
  return requested;
}
