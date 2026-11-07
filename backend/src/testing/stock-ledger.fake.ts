import { Prisma } from '@prisma/client';

/// A stand-in for the per-warehouse ledger, for specs that drive a service
/// against an in-memory transaction.
///
/// It writes through the same `stockBalance` primitives the services used
/// before the ledger existed - an increment on a receipt, a decrement on an
/// issue - so a spec that asserts what reached the branch book keeps asserting
/// the same thing. The shelf book is updated only when the fake transaction
/// carries one, which keeps the in-memory harnesses honest without pretending
/// they have a database.
export interface FakeLedgerOptions {
  /// What `position` answers on a shelf. Defaults to an empty shelf.
  position?: { quantity: Prisma.Decimal | string | number; value: Prisma.Decimal | string | number };
}

export function fakeLedger(options: FakeLedgerOptions = {}) {
  const at = options.position ?? { quantity: 0, value: 0 };
  const position = () => {
    const quantity = new Prisma.Decimal(at.quantity);
    const value = new Prisma.Decimal(at.value);
    return {
      quantity,
      value,
      unitCost: quantity.isZero() ? new Prisma.Decimal(0) : value.div(quantity),
    };
  };

  return {
    position: jest.fn(async () => position()),
    averageCost: jest.fn(async () => position().unitCost),
    issuePrice: jest.fn(
      (
        onHand: { quantity: Prisma.Decimal; value: Prisma.Decimal },
        quantity: Prisma.Decimal | string | number,
      ) => {
        const issued = new Prisma.Decimal(quantity);
        const unitCost = onHand.quantity.isZero()
          ? new Prisma.Decimal(0)
          : onHand.value.div(onHand.quantity);
        return { unitCost, value: issued.mul(unitCost) };
      },
    ),
    issueValue: jest.fn(async (_tx: unknown, _target: unknown, quantity: unknown) => {
      const issued = new Prisma.Decimal(String(quantity));
      const current = position();
      const unitCost = current.unitCost;
      return { unitCost, value: issued.mul(unitCost) };
    }),
    post: jest.fn(
      async (
        tx: any,
        posting: {
          companyId: string;
          branchId: string;
          warehouseId?: string | null;
          itemId: string;
          quantity: Prisma.Decimal | string | number;
          value: Prisma.Decimal | string | number;
        },
      ) => {
        const quantity = new Prisma.Decimal(posting.quantity);
        const value = new Prisma.Decimal(posting.value);
        if (quantity.isZero() && value.isZero()) return position();

        const where = {
          companyId_branchId_itemId: {
            companyId: posting.companyId,
            branchId: posting.branchId,
            itemId: posting.itemId,
          },
        };
        if (quantity.greaterThanOrEqualTo(0)) {
          await tx.stockBalance.upsert({
            where,
            create: {
              companyId: posting.companyId,
              branchId: posting.branchId,
              itemId: posting.itemId,
              quantity,
              value,
            },
            update: {
              quantity: { increment: quantity },
              value: { increment: value },
            },
          });
        } else if (tx.stockBalance?.update) {
          await tx.stockBalance.update({
            where,
            data: {
              quantity: { decrement: quantity.abs() },
              value: { decrement: value.abs() },
            },
          });
        }

        if (posting.warehouseId && tx.warehouseStockBalance?.upsert) {
          await tx.warehouseStockBalance.upsert({
            where: {
              companyId_branchId_warehouseId_itemId: {
                companyId: posting.companyId,
                branchId: posting.branchId,
                warehouseId: posting.warehouseId,
                itemId: posting.itemId,
              },
            },
            create: {
              companyId: posting.companyId,
              branchId: posting.branchId,
              warehouseId: posting.warehouseId,
              itemId: posting.itemId,
              quantity,
              value,
            },
            update: {
              quantity: { increment: quantity },
              value: { increment: value },
            },
          });
        }
        return position();
      },
    ),
    receive: jest.fn(async (_tx: unknown, _target: unknown, quantity: unknown, value: unknown) => {
      const current = position();
      const incoming = new Prisma.Decimal(String(quantity));
      const incomingValue = new Prisma.Decimal(String(value));
      const quantityAfter = current.quantity.plus(incoming);
      const valueAfter = current.value.plus(incomingValue);
      return {
        unitCost: quantityAfter.isZero()
          ? new Prisma.Decimal(0)
          : valueAfter.div(quantityAfter),
        position: current,
      };
    }),
    rebuildFromMovements: jest.fn(async () => position()),
  };
}

export type FakeLedger = ReturnType<typeof fakeLedger>;
