import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { issueAtAverage, movingAverage } from './batch-policy';

/// Where a stock change lands.
///
/// `warehouseId` is the shelf that actually moves. A posting that names no
/// warehouse (an old document, a branch-level adjustment) still changes the
/// branch book, and only the branch book: inventing a warehouse for it would
/// be a valuation nobody could trace back to a movement.
export interface LedgerTarget {
  companyId: string;
  branchId: string;
  warehouseId?: string | null;
  itemId: string;
}

export interface LedgerPosting extends LedgerTarget {
  quantity: Prisma.Decimal | number | string;
  value: Prisma.Decimal | number | string;
}

/// One row of the book, read under lock when the caller says so.
export interface LedgerPosition {
  quantity: Prisma.Decimal;
  value: Prisma.Decimal;
  /// value / quantity, at six decimals. Zero on an empty shelf.
  unitCost: Prisma.Decimal;
}

const COST_SCALE = 6;
const MONEY_SCALE = 4;

/// The stock book every writer shares.
///
/// Two books, one rule. `warehouse_stock_balances` holds what one shelf holds
/// and what it is worth, so the average of a warehouse that bought at 30 is
/// never diluted by a warehouse that bought at 15. `stock_balances` stays as
/// the branch roll-up that reports, reconciliation and the existing screens
/// already read, and it is maintained in the same statement as the shelf so
/// the two can never disagree.
///
/// Every method takes the transaction. There is no ambient client: a ledger
/// write that escapes the posting transaction is a stock figure no reversal
/// can undo.
@Injectable()
export class StockLedgerService {
  /// Reads a shelf (or the branch, when no warehouse is named), locking the
  /// row so two postings draining the same shelf queue behind each other
  /// instead of both seeing the same quantity.
  async position(
    tx: Prisma.TransactionClient,
    target: LedgerTarget,
    options: { forUpdate?: boolean } = {},
  ): Promise<LedgerPosition> {
    if (target.warehouseId) {
      const rows = await tx.$queryRaw<
        Array<{ quantity: Prisma.Decimal; value: Prisma.Decimal }>
      >(Prisma.sql`
        SELECT "quantity", "value"
          FROM "warehouse_stock_balances"
         WHERE "companyId" = ${target.companyId}::uuid
           AND "warehouseId" = ${target.warehouseId}::uuid
           AND "itemId" = ${target.itemId}::uuid
         ${options.forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty}
      `);
      return this.toPosition(rows[0]?.quantity ?? 0, rows[0]?.value ?? 0);
    }

    const rows = await tx.$queryRaw<
      Array<{ quantity: Prisma.Decimal; value: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT "quantity", "value"
        FROM "stock_balances"
       WHERE "companyId" = ${target.companyId}::uuid
         AND "branchId" = ${target.branchId}::uuid
         AND "itemId" = ${target.itemId}::uuid
       ${options.forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty}
    `);
    return this.toPosition(rows[0]?.quantity ?? 0, rows[0]?.value ?? 0);
  }

  /// The average a shelf carries right now. This is the number an issue is
  /// priced at, and it is read from the shelf, not from the branch.
  async averageCost(
    tx: Prisma.TransactionClient,
    target: LedgerTarget,
    options: { forUpdate?: boolean } = {},
  ): Promise<Prisma.Decimal> {
    const position = await this.position(tx, target, options);
    return position.unitCost;
  }

  /// Prices an issue at the shelf average without writing anything.
  issuePrice(
    position: LedgerPosition,
    quantity: Prisma.Decimal | number | string,
  ) {
    return issueAtAverage(
      { quantity: position.quantity, value: position.value },
      quantity,
    );
  }

  /// The value an issue of `quantity` removes at the current average.
  async issueValue(
    tx: Prisma.TransactionClient,
    target: LedgerTarget,
    quantity: Prisma.Decimal | number | string,
  ): Promise<{ unitCost: Prisma.Decimal; value: Prisma.Decimal }> {
    const position = await this.position(tx, target);
    const priced = this.issuePrice(position, quantity);
    return { unitCost: priced.unitCost, value: priced.value };
  }

  /// Moves one item's quantity and value on one shelf, and on the branch.
  ///
  /// Positive quantity adds, negative removes; `value` follows the same sign.
  /// Removing more than the shelf holds is refused here rather than surfacing
  /// as a negative balance nobody can explain - unless the company permits
  /// negative stock, in which case the caller's policy decides and this method
  /// simply records it.
  async post(
    tx: Prisma.TransactionClient,
    posting: LedgerPosting,
    options: { allowNegative?: boolean } = {},
  ): Promise<LedgerPosition> {
    const quantity = new Prisma.Decimal(posting.quantity).toDecimalPlaces(MONEY_SCALE);
    const value = new Prisma.Decimal(posting.value).toDecimalPlaces(MONEY_SCALE);

    if (!quantity.isZero() || !value.isZero()) {
      await this.postBranch(tx, posting, quantity, value, options.allowNegative ?? false);
    }
    if (!posting.warehouseId) {
      return this.position(tx, posting);
    }

    const before = await this.position(tx, posting, { forUpdate: true });
    const after = {
      quantity: before.quantity.plus(quantity),
      value: before.value.plus(value).toDecimalPlaces(MONEY_SCALE),
    };
    if (after.quantity.lessThan(0) && !(options.allowNegative ?? false)) {
      throw new BadRequestException(
        `Not enough stock in the selected warehouse: ${before.quantity.toFixed(MONEY_SCALE)} available, ` +
          `${quantity.abs().toFixed(MONEY_SCALE)} requested.`,
      );
    }
    // An emptied shelf is worth nothing: a rounded average must not leave a
    // fils of valuation floating on a shelf that holds no stock.
    if (after.quantity.isZero()) after.value = new Prisma.Decimal(0);

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
        quantity: after.quantity,
        value: after.value,
      },
      update: { quantity: after.quantity, value: after.value },
    });

    return {
      quantity: after.quantity,
      value: after.value,
      unitCost: after.quantity.isZero()
        ? new Prisma.Decimal(0)
        : after.value.div(after.quantity).toDecimalPlaces(COST_SCALE),
    };
  }

  /// Receives into a shelf and reports the average it now carries.
  async receive(
    tx: Prisma.TransactionClient,
    target: LedgerTarget,
    quantity: Prisma.Decimal | number | string,
    value: Prisma.Decimal | number | string,
  ): Promise<{ unitCost: Prisma.Decimal; position: LedgerPosition }> {
    const before = await this.position(tx, target, { forUpdate: true });
    const after = movingAverage(before, { quantity, value });
    const position = await this.post(tx, { ...target, quantity, value });
    return { unitCost: after.unitCost, position };
  }

  /// The branch roll-up. Kept as its own method because a posting without a
  /// warehouse has nothing else to write, and because every existing report
  /// reads this table.
  private async postBranch(
    tx: Prisma.TransactionClient,
    posting: LedgerPosting,
    quantity: Prisma.Decimal,
    value: Prisma.Decimal,
    allowNegative: boolean,
  ) {
    const before = await tx.$queryRaw<Array<{ quantity: Prisma.Decimal }>>(Prisma.sql`
      SELECT "quantity"
        FROM "stock_balances"
       WHERE "companyId" = ${posting.companyId}::uuid
         AND "branchId" = ${posting.branchId}::uuid
         AND "itemId" = ${posting.itemId}::uuid
       FOR UPDATE
    `);
    const current = new Prisma.Decimal(before[0]?.quantity ?? 0);
    if (current.plus(quantity).lessThan(0) && !allowNegative) {
      throw new BadRequestException(
        `Not enough stock in this branch: ${current.toFixed(MONEY_SCALE)} available, ` +
          `${quantity.abs().toFixed(MONEY_SCALE)} requested.`,
      );
    }

    await tx.stockBalance.upsert({
      where: {
        companyId_branchId_itemId: {
          companyId: posting.companyId,
          branchId: posting.branchId,
          itemId: posting.itemId,
        },
      },
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
  }

  /// Rebuilds one shelf from the movements that produced it. Used by the
  /// integrity check and by the integration suite; never by a posting.
  async rebuildFromMovements(
    tx: Prisma.TransactionClient,
    target: LedgerTarget,
  ): Promise<LedgerPosition> {
    if (!target.warehouseId) {
      throw new BadRequestException('A rebuild needs a warehouse.');
    }
    const rows = await tx.$queryRaw<
      Array<{ quantity: Prisma.Decimal; value: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT COALESCE(SUM(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END), 0) AS "quantity",
             COALESCE(SUM(CASE WHEN "direction" = 'IN' THEN "totalCost" ELSE -"totalCost" END), 0) AS "value"
        FROM "stock_movements"
       WHERE "companyId" = ${target.companyId}::uuid
         AND "warehouseId" = ${target.warehouseId}::uuid
         AND "itemId" = ${target.itemId}::uuid
    `);
    const position = this.toPosition(rows[0]?.quantity ?? 0, rows[0]?.value ?? 0);
    await tx.warehouseStockBalance.upsert({
      where: {
        companyId_branchId_warehouseId_itemId: {
          companyId: target.companyId,
          branchId: target.branchId,
          warehouseId: target.warehouseId,
          itemId: target.itemId,
        },
      },
      create: {
        companyId: target.companyId,
        branchId: target.branchId,
        warehouseId: target.warehouseId,
        itemId: target.itemId,
        quantity: position.quantity,
        value: position.value,
      },
      update: { quantity: position.quantity, value: position.value },
    });
    return position;
  }

  private toPosition(
    quantity: Prisma.Decimal | number | string,
    value: Prisma.Decimal | number | string,
  ): LedgerPosition {
    const q = new Prisma.Decimal(quantity);
    const v = new Prisma.Decimal(value);
    return {
      quantity: q,
      value: v,
      unitCost: q.isZero() ? new Prisma.Decimal(0) : v.div(q).toDecimalPlaces(COST_SCALE),
    };
  }
}
