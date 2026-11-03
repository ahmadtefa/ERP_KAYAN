import { BadRequestException } from '@nestjs/common';
import { Prisma, StockDirection } from '@prisma/client';

/** The immutable movement is the authoritative cost, not the draft line. */
export interface OriginalStockMovement {
  id: string;
  itemId: string;
  branchId: string;
  warehouseId: string | null;
  direction: StockDirection;
  referenceType: string;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  totalCost: Prisma.Decimal;
}

export function takeOriginalStockMovement(
  movements: OriginalStockMovement[],
  used: Set<string>,
  expected: {
    itemId: string;
    branchId: string;
    warehouseId: string | null;
    direction: StockDirection;
    referenceType: string;
    quantity: Prisma.Decimal;
  },
): OriginalStockMovement {
  const candidates = movements.filter((movement) =>
    !used.has(movement.id) &&
    movement.itemId === expected.itemId &&
    movement.branchId === expected.branchId &&
    movement.warehouseId === expected.warehouseId &&
    movement.direction === expected.direction &&
    movement.referenceType === expected.referenceType &&
    movement.quantity.equals(expected.quantity),
  );
  const first = candidates[0];
  // Equal matching movements may be exchanged safely; different valuations
  // cannot be assigned to a line reliably without a movement-to-line key.
  if (!first || candidates.some((candidate) =>
    !candidate.unitCost.equals(first.unitCost) ||
    !candidate.totalCost.equals(first.totalCost),
  )) {
    throw new BadRequestException(
      'The original stock movements are missing or ambiguous; this document cannot be reversed automatically.',
    );
  }
  used.add(first.id);
  return first;
}
