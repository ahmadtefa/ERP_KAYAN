import { Prisma, StockDirection } from '@prisma/client';

/// A stand-in for the lot engine, for specs that drive a service against an
/// in-memory transaction.
///
/// It reproduces what `BatchesService.issueTx` does for an item that keeps no
/// lots - one OUT movement at the shelf's average, and the shelf and branch
/// books moved by the same amount - so a spec that asserts the invoice's
/// quantities and costs keeps asserting the same numbers after posting moved
/// onto the lot engine.
///
/// It is deliberately *not* a model of FEFO. A spec that wants to prove lots
/// are chosen, split, skipped or exhausted drives the real `selectLotsFefo`
/// or a real database, not this.
export interface FakeIssueOptions {
  /// What the shelf holds, used to price the issue.
  onHand?: { quantity: Prisma.Decimal | string | number; value: Prisma.Decimal | string | number };
}

export function fakeBatches(options: FakeIssueOptions = {}) {
  const at = options.onHand ?? { quantity: 0, value: 0 };
  return {
    issueTx: jest.fn(
      async (
        tx: any,
        companyId: string,
        userId: string,
        resolved: { warehouse: { id: string; branchId: string } | null; branchId: string; item: { id: string } },
        input: any,
        quantity: Prisma.Decimal,
      ) => {
        const onHand = new Prisma.Decimal(at.quantity as never);
        const value = new Prisma.Decimal(at.value as never);
        const unitCost = onHand.isZero() ? new Prisma.Decimal(0) : value.div(onHand);
        const total = quantity.mul(unitCost).toDecimalPlaces(4);

        await tx.stockMovement.create({
          data: {
            companyId,
            branchId: resolved.branchId,
            warehouseId: resolved.warehouse?.id ?? null,
            itemId: resolved.item.id,
            movementDate: input.documentDate ? new Date(input.documentDate) : new Date(),
            direction: StockDirection.OUT,
            quantity,
            unitCost: unitCost.toDecimalPlaces(4),
            totalCost: total,
            referenceType: input.referenceType ?? 'STOCK_ISSUE',
            referenceId: input.referenceId ?? null,
            referenceNumber: input.referenceNumber ?? null,
            createdBy: userId,
          },
        });
        await tx.stockBalance.update({
          where: {
            companyId_branchId_itemId: {
              companyId,
              branchId: resolved.branchId,
              itemId: resolved.item.id,
            },
          },
          data: { quantity: { decrement: quantity }, value: { decrement: total } },
        });

        return {
          lots: [] as Array<{ batchId: string; quantity: string; expired: boolean }>,
          quantity: quantity.toFixed(4),
          unitCost: unitCost.toFixed(4),
          value: total.toFixed(4),
          expiredQuantity: '0.0000',
        };
      },
    ),
  };
}

/// The ledger, for specs where the fake issue already moved the books.
export function fakeLedger() {
  return {
    post: jest.fn(async () => ({
      quantity: new Prisma.Decimal(0),
      value: new Prisma.Decimal(0),
      unitCost: new Prisma.Decimal(0),
    })),
    position: jest.fn(async () => ({
      quantity: new Prisma.Decimal(0),
      value: new Prisma.Decimal(0),
      unitCost: new Prisma.Decimal(0),
    })),
  };
}
