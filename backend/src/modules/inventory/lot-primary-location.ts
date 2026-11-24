import { Prisma } from '@prisma/client';

/// A lot row carries one `storageLocationId`, but a lot can lie on several
/// shelves at once, or partly on none. The movement ledger is the truth. This
/// column names a shelf ONLY when the whole remaining lot is on that one
/// shelf; for a split lot, or one only partly placed, it is null so no screen
/// reads it as "the whole lot is here". Use the per-lot `locations` list for
/// the split.
export async function refreshLotPrimaryLocation(
  tx: Prisma.TransactionClient,
  companyId: string,
  batchId: string,
  userId: string | null,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ storageLocationId: string | null; quantity: Prisma.Decimal }>>(
    Prisma.sql`
      SELECT "storageLocationId",
             SUM(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END) AS "quantity"
        FROM "stock_movements"
       WHERE "companyId" = ${companyId}::uuid
         AND "batchId" = ${batchId}::uuid
       GROUP BY "storageLocationId"
      HAVING SUM(CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END) > 0
    `,
  );
  const only = rows.length === 1 && rows[0].storageLocationId ? rows[0].storageLocationId : null;
  await tx.itemBatch.updateMany({
    where: { id: batchId, companyId },
    data: { storageLocationId: only, ...(userId ? { updatedBy: userId } : {}) },
  });
}
