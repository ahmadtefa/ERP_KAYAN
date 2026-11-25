ALTER TABLE "opening_balance_lines" ADD COLUMN "storageLocationId" UUID;
CREATE INDEX "opening_balance_lines_storageLocationId_idx" ON "opening_balance_lines" ("storageLocationId");
