-- Snapshot cost-center attribution on each append-only stock movement.
-- Old movements with no source-document attribution remain NULL.
ALTER TABLE "stock_movements"
  ADD COLUMN "costCenterId" UUID;

-- Recover attribution for existing stock documents where the source already
-- records it. Transfers are excluded because they do not represent a cost.
UPDATE "stock_movements" AS movement
   SET "costCenterId" = document."costCenterId"
  FROM "stock_documents" AS document
 WHERE movement."companyId" = document."companyId"
   AND movement."referenceId" = document.id
   AND movement."referenceType" IN ('STOCK_ADJUSTMENT', 'STOCK_COUNT', 'STOCK_DOCUMENT_REVERSAL')
   AND document.kind <> 'TRANSFER'
   AND document."costCenterId" IS NOT NULL;

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_costCenterId_fkey"
  FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "stock_movements_companyId_costCenterId_movementDate_idx"
  ON "stock_movements"("companyId", "costCenterId", "movementDate");
