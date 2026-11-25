ALTER TABLE "stock_take_lines" ADD COLUMN "storageLocationId" UUID;
CREATE INDEX "stock_take_lines_storageLocationId_idx" ON "stock_take_lines"("storageLocationId");
