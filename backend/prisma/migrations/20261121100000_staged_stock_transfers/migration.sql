-- Staged stock transfers. Dispatch moves value to an internal transit shelf;
-- each receipt moves only accepted quantity into the destination. Additive only.
ALTER TABLE "warehouses"
  ADD COLUMN IF NOT EXISTS "isTransit" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "warehouses_one_transit_per_branch_idx"
  ON "warehouses" ("companyId", "branchId") WHERE "isTransit" = true;

CREATE TABLE IF NOT EXISTS "stock_transfers" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL REFERENCES "companies"("id") ON DELETE RESTRICT,
  "sourceBranchId" UUID NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "destinationBranchId" UUID NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "sourceWarehouseId" UUID NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "destinationWarehouseId" UUID NOT NULL REFERENCES "warehouses"("id") ON DELETE RESTRICT,
  "documentNumber" VARCHAR(48) NOT NULL,
  "transferDate" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "status" VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 0,
  "idempotencyKey" VARCHAR(120),
  "costCenterId" UUID,
  "createdBy" UUID NOT NULL,
  "reviewedBy" UUID,
  "reviewedAt" TIMESTAMP(3),
  "approvedBy" UUID,
  "approvedAt" TIMESTAMP(3),
  "rejectedBy" UUID,
  "rejectedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "settlementDocumentId" UUID,
  "settlementRequestedBy" UUID,
  "settlementApprovedBy" UUID,
  "settlementApprovedAt" TIMESTAMP(3),
  "dispatchedBy" UUID,
  "dispatchedAt" TIMESTAMP(3),
  "closedBy" UUID,
  "closedAt" TIMESTAMP(3),
  "cancelledBy" UUID,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_transfers_company_documentNumber_key" UNIQUE ("companyId", "documentNumber"),
  CONSTRAINT "stock_transfers_company_idempotencyKey_key" UNIQUE ("companyId", "idempotencyKey")
);
CREATE INDEX IF NOT EXISTS "stock_transfers_company_status_date_idx"
  ON "stock_transfers" ("companyId", "status", "transferDate");
CREATE INDEX IF NOT EXISTS "stock_transfers_source_status_idx"
  ON "stock_transfers" ("sourceWarehouseId", "status");
CREATE INDEX IF NOT EXISTS "stock_transfers_destination_status_idx"
  ON "stock_transfers" ("destinationWarehouseId", "status");

CREATE TABLE IF NOT EXISTS "stock_transfer_lines" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "transferId" UUID NOT NULL REFERENCES "stock_transfers"("id") ON DELETE CASCADE,
  "itemId" UUID NOT NULL REFERENCES "items"("id") ON DELETE RESTRICT,
  "lineNumber" INTEGER NOT NULL,
  "requestedQuantity" DECIMAL(19,4) NOT NULL,
  "dispatchedQuantity" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "receivedQuantity" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "returnedQuantity" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "writtenOffQuantity" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "reportedShortage" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "reportedDamage" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "unitCost" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "unitName" VARCHAR(40),
  "unitFactor" DECIMAL(19,6),
  "unitQuantity" DECIMAL(19,4),
  "sourceBatchId" UUID REFERENCES "item_batches"("id") ON DELETE RESTRICT,
  "transitBatchId" UUID REFERENCES "item_batches"("id") ON DELETE RESTRICT,
  "notes" TEXT,
  "differenceReason" TEXT,
  CONSTRAINT "stock_transfer_lines_transferId_lineNumber_key" UNIQUE ("transferId", "lineNumber"),
  CONSTRAINT "stock_transfer_lines_nonnegative_quantities_check" CHECK (
    "requestedQuantity" > 0 AND "dispatchedQuantity" >= 0 AND "receivedQuantity" >= 0 AND
    "returnedQuantity" >= 0 AND "writtenOffQuantity" >= 0 AND "reportedShortage" >= 0 AND
    "reportedDamage" >= 0
  )
);
CREATE INDEX IF NOT EXISTS "stock_transfer_lines_item_transfer_idx"
  ON "stock_transfer_lines" ("itemId", "transferId");

CREATE TABLE IF NOT EXISTS "stock_transfer_actions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "transferId" UUID NOT NULL REFERENCES "stock_transfers"("id") ON DELETE RESTRICT,
  "companyId" UUID NOT NULL,
  "requestKey" VARCHAR(120) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "action" VARCHAR(24) NOT NULL,
  "stockDocumentId" UUID,
  "resultVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_transfer_actions_company_transfer_requestKey_key"
    UNIQUE ("companyId", "transferId", "requestKey")
);
CREATE INDEX IF NOT EXISTS "stock_transfer_actions_transfer_action_idx"
  ON "stock_transfer_actions" ("transferId", "action");

ALTER TABLE "stock_documents"
  ADD COLUMN IF NOT EXISTS "stockTransferLineId" UUID;
ALTER TABLE "stock_documents"
  ADD CONSTRAINT "stock_documents_stockTransferLineId_fkey"
  FOREIGN KEY ("stockTransferLineId") REFERENCES "stock_transfer_lines"("id") ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS "stock_documents_stockTransferLineId_idx"
  ON "stock_documents" ("stockTransferLineId");
