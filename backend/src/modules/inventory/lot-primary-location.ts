import { BadRequestException } from '@nestjs/common';
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

/// The receipt movements one purchase invoice wrote into lots, in the order
/// they were written. A purchase line names its lot only when it carries a lot
/// number, so the movement is the one record that always knows the lot.
export async function receiptLotMovements(
  tx: Prisma.TransactionClient,
  companyId: string,
  invoiceId: string,
  itemId: string,
) {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      batchId: string | null;
      quantity: Prisma.Decimal;
      storageLocationId: string | null;
      unitCost: Prisma.Decimal;
      sourceLineId: string | null;
    }>
  >(Prisma.sql`
    SELECT "id", "batchId", "quantity", "storageLocationId", "unitCost", "sourceLineId"
      FROM "stock_movements"
     WHERE "companyId" = ${companyId}::uuid
       AND "referenceType" = 'PURCHASE_INVOICE'
       AND "referenceId" = ${invoiceId}::uuid
       AND "itemId" = ${itemId}::uuid
       AND "direction" = 'IN'
       AND "batchId" IS NOT NULL
     ORDER BY "createdAt" ASC, "id" ASC
  `);
  return rows.map((r) => ({ ...r, quantity: new Prisma.Decimal(r.quantity), unitCost: new Prisma.Decimal(r.unitCost) }));
}

/// The receipt movement written for one purchase line. Movements recorded
/// before the line was stored on them are matched the old way (same shelf and
/// size, in line order); anything newer is matched by the line itself.
export function receiptFor<
  M extends { id: string; quantity: Prisma.Decimal; storageLocationId: string | null; sourceLineId: string | null },
>(
  movements: M[],
  line: { id: string; quantity: Prisma.Decimal; storageLocationId: string | null },
  historicalIndex: number,
  used: Set<string> = new Set(),
): M | undefined {
  const bound = movements.find((m) => m.sourceLineId === line.id);
  if (bound) return bound;
  if (movements.some((m) => m.sourceLineId)) return undefined;
  const open = movements.filter((m) => !used.has(m.id));
  const same = open.filter(
    (m) => (m.storageLocationId ?? null) === (line.storageLocationId ?? null) && m.quantity.equals(line.quantity),
  );
  return same[historicalIndex >= 0 ? historicalIndex : 0] ?? (open.length === 1 ? open[0] : undefined);
}

/// Takes `quantity` units bought at `unitCost` out of a lot's average cost, so
/// what stays is valued at what it cost. Call before the lot's remaining
/// quantity is lowered. Does nothing when nothing would remain.
export async function removeFromLotCost(
  tx: Prisma.TransactionClient,
  lotId: string,
  quantity: Prisma.Decimal,
  unitCost: Prisma.Decimal,
): Promise<void> {
  const lot = await tx.itemBatch.findFirst({
    where: { id: lotId },
    select: { remainingQuantity: true, unitCost: true },
  });
  if (!lot) return;
  const left = lot.remainingQuantity.minus(quantity);
  if (left.lessThanOrEqualTo(0)) return;
  const value = lot.remainingQuantity.mul(lot.unitCost).minus(quantity.mul(unitCost));
  const next = value.lessThan(0) ? new Prisma.Decimal(0) : value.div(left);
  await tx.itemBatch.update({ where: { id: lotId }, data: { unitCost: next.toDecimalPlaces(4) } });
}

/// The inverse of removeFromLotCost: puts `quantity` units back into a lot at
/// the cost they left it with, so a sales return restores the original issue
/// cost instead of re-pricing the whole lot. Call before the lot's remaining
/// quantity is raised.
export async function addToLotCost(
  tx: Prisma.TransactionClient,
  lotId: string,
  quantity: Prisma.Decimal,
  unitCost: Prisma.Decimal,
): Promise<void> {
  const lot = await tx.itemBatch.findFirst({
    where: { id: lotId },
    select: { remainingQuantity: true, unitCost: true },
  });
  if (!lot || !lot.remainingQuantity) return;
  const total = lot.remainingQuantity.plus(quantity);
  if (total.lessThanOrEqualTo(0)) return;
  const value = lot.remainingQuantity.mul(lot.unitCost).plus(quantity.mul(unitCost));
  await tx.itemBatch.update({ where: { id: lotId }, data: { unitCost: value.div(total).toDecimalPlaces(4) } });
}

/// True when movements written before document lines were stored on them could
/// belong to more than one line with a different lot or shelf, so no line can
/// be matched to its own movement without guessing.
export function legacyIdentityAmbiguous(
  movements: Array<{ batchId?: string | null; storageLocationId?: string | null; sourceLineId?: string | null; unitCost?: Prisma.Decimal | string | null }>,
): boolean {
  if (movements.length < 2 || movements.some((m) => m.sourceLineId)) return false;
  return new Set(movements.map((m) => `${m.batchId ?? ''}|${m.storageLocationId ?? ''}|${m.unitCost == null ? '' : new Prisma.Decimal(m.unitCost).toFixed(4)}`)).size > 1;
}

/// True when some movements of the document are tied to their line and the
/// line being returned or reversed has none of its own: the rest cannot stand
/// in for it, so its lot, shelf and cost are unknown.
export function boundCoverageMissing(movements: Array<{ sourceLineId?: string | null }>, lineId: string): boolean {
  return movements.some((m) => m.sourceLineId) && !movements.some((m) => m.sourceLineId === lineId);
}

/// The refusal for an old document whose stock movements cannot say which
/// line they belong to. Nothing is written; the document stays as it is.
export function legacyIdentityError(code: string, documentNumber: string | null | undefined, lineNumber: number) {
  const doc = documentNumber ?? '';
  return new BadRequestException({
    code,
    message:
      `السطر ${lineNumber} من المستند ${doc}: سُجّل هذا المستند قبل ربط كل سطر بحركته المخزنية، وفيه عدة أسطر لنفس الصنف بدفعات أو مواقع أو تكاليف مختلفة، فلا يمكن للنظام تحديد الدفعة والموقع والتكلفة الصحيحة دون تخمين. لم يُرحَّل شيء ولم يتغير أي رصيد، وبيانات المرتجع/العكس محفوظة. أبلغ المسؤول أو المحاسب بالمستند ورقم السطر ليتحقق من الدفعة والموقع والتكلفة الأصلية قبل أي تصحيح. / ` +
      `Line ${lineNumber} of ${doc}: this document was posted before each line was tied to its stock movement, and it has several lines of the same item on different lots, locations or costs, so the system cannot tell the right lot, location and cost without guessing. Nothing was posted and no balance changed, and your return or reversal data is kept. Give your administrator or accountant the document number and line number so they can verify the original lot, location and cost before any correction.`,
    errors: { lineNumber: String(lineNumber), documentNumber: doc.slice(0, 64) },
  });
}
