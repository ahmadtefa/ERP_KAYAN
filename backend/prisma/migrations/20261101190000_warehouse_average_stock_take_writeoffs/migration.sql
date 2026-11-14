-- One cost book per shelf, a counting session with an approval, a write-off
-- with its own number, and the per-user warehouse rights that decide who may
-- do any of it.
--
-- Purely additive. Every new column is nullable or defaulted, every new table
-- is new, and the two backfills are guarded so replaying this file on an empty
-- database inserts nothing. An installation that already holds stock keeps
-- every row: the branch figure it had is split into its warehouses from the
-- movements that produced it, and any residue that the movements cannot
-- explain is parked on the branch's default warehouse rather than dropped.

-- ── 1. a loss is its own kind of document ────────────────────────────────
ALTER TYPE "StockDocumentKind" ADD VALUE IF NOT EXISTS 'WRITE_OFF';

-- ── 2. the document learns approval, idempotency and attachment ──────────
ALTER TABLE "stock_documents"
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedBy" UUID,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "attachmentName" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "attachmentPath" VARCHAR(240),
  ADD COLUMN IF NOT EXISTS "stockTakeSessionId" UUID;

COMMENT ON COLUMN "stock_documents"."idempotencyKey" IS
  'The key the client sent. A retry finds this document instead of posting a second one.';
COMMENT ON COLUMN "stock_documents"."approvedBy" IS
  'Who approved the loss. Posting a write-off requires this to be set.';

CREATE UNIQUE INDEX IF NOT EXISTS "stock_documents_companyId_idempotencyKey_key"
  ON "stock_documents"("companyId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "stock_documents_stockTakeSessionId_idx"
  ON "stock_documents"("stockTakeSessionId");

-- ── 3. a line can name the lot and the shelf it takes ────────────────────
ALTER TABLE "stock_document_lines"
  ADD COLUMN IF NOT EXISTS "totalCost" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "batchId" UUID,
  ADD COLUMN IF NOT EXISTS "storageLocationId" UUID;

-- Existing lines keep their value: quantity x unitCost, where the two were
-- already recorded. Nothing is re-priced.
UPDATE "stock_document_lines"
   SET "totalCost" = ROUND(("quantity" * "unitCost")::numeric, 4)
 WHERE "totalCost" = 0 AND "unitCost" <> 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_document_lines_batchId_fkey') THEN
    ALTER TABLE "stock_document_lines"
      ADD CONSTRAINT "stock_document_lines_batchId_fkey"
      FOREIGN KEY ("batchId") REFERENCES "item_batches"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_document_lines_storageLocationId_fkey') THEN
    ALTER TABLE "stock_document_lines"
      ADD CONSTRAINT "stock_document_lines_storageLocationId_fkey"
      FOREIGN KEY ("storageLocationId") REFERENCES "storage_locations"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "stock_document_lines_batchId_idx"
  ON "stock_document_lines"("batchId");

-- ── 4. the notification centre learns order, audience and repetition ─────
ALTER TABLE "notifications"
  ADD COLUMN IF NOT EXISTS "severityRank" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "audienceRoles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "lastRaisedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "raisedCount" INTEGER NOT NULL DEFAULT 1;

-- Alphabetical severity ordering put WARNING behind INFO. The rank is stored
-- so the list can sort in one indexed column instead of guessing.
UPDATE "notifications"
   SET "severityRank" = CASE UPPER("severity")
                          WHEN 'CRITICAL' THEN 3
                          WHEN 'WARNING'  THEN 2
                          ELSE 1
                        END;
UPDATE "notifications" SET "lastRaisedAt" = "createdAt" WHERE "lastRaisedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "notifications_companyId_entityId_idx"
  ON "notifications"("companyId", "entityId");
CREATE INDEX IF NOT EXISTS "notifications_companyId_severityRank_idx"
  ON "notifications"("companyId", "severityRank");

-- ── 5. one cost book per item per warehouse ──────────────────────────────
CREATE TABLE IF NOT EXISTS "warehouse_stock_balances" (
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "value" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_stock_balances_pkey"
      PRIMARY KEY ("companyId", "branchId", "warehouseId", "itemId")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_stock_balances_companyId_fkey') THEN
    ALTER TABLE "warehouse_stock_balances"
      ADD CONSTRAINT "warehouse_stock_balances_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_stock_balances_branchId_fkey') THEN
    ALTER TABLE "warehouse_stock_balances"
      ADD CONSTRAINT "warehouse_stock_balances_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_stock_balances_warehouseId_fkey') THEN
    ALTER TABLE "warehouse_stock_balances"
      ADD CONSTRAINT "warehouse_stock_balances_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'warehouse_stock_balances_itemId_fkey') THEN
    ALTER TABLE "warehouse_stock_balances"
      ADD CONSTRAINT "warehouse_stock_balances_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "warehouse_stock_balances_companyId_warehouseId_itemId_idx"
  ON "warehouse_stock_balances"("companyId", "warehouseId", "itemId");
CREATE INDEX IF NOT EXISTS "warehouse_stock_balances_companyId_itemId_idx"
  ON "warehouse_stock_balances"("companyId", "itemId");

-- The movements are the ledger; the table is derived from them, so the
-- opening position of every warehouse is what actually moved through it.
INSERT INTO "warehouse_stock_balances"
  ("companyId", "branchId", "warehouseId", "itemId", "quantity", "value", "updatedAt")
SELECT m."companyId",
       w."branchId",
       m."warehouseId",
       m."itemId",
       SUM(CASE WHEN m."direction" = 'IN' THEN m."quantity" ELSE -m."quantity" END),
       SUM(CASE WHEN m."direction" = 'IN' THEN m."totalCost" ELSE -m."totalCost" END),
       CURRENT_TIMESTAMP
  FROM "stock_movements" m
  JOIN "warehouses" w ON w."id" = m."warehouseId"
 WHERE m."warehouseId" IS NOT NULL
 GROUP BY m."companyId", w."branchId", m."warehouseId", m."itemId"
ON CONFLICT ("companyId", "branchId", "warehouseId", "itemId") DO NOTHING;

-- Whatever the branch book holds beyond the sum of its warehouses - history
-- written before the movement table carried a warehouse - is placed on the
-- branch's default warehouse. The branch total is therefore preserved to the
-- last fils, which is what a valuation report written yesterday still expects.
WITH default_warehouse AS (
  SELECT DISTINCT ON (w."companyId", w."branchId")
         w."companyId", w."branchId", w."id" AS "warehouseId"
    FROM "warehouses" w
   WHERE w."deletedAt" IS NULL
   ORDER BY w."companyId", w."branchId", w."isDefault" DESC, w."createdAt" ASC
), residual AS (
  SELECT b."companyId",
         b."branchId",
         b."itemId",
         b."quantity" - COALESCE((
           SELECT SUM(x."quantity") FROM "warehouse_stock_balances" x
            WHERE x."companyId" = b."companyId"
              AND x."branchId" = b."branchId"
              AND x."itemId" = b."itemId"
         ), 0) AS "quantity",
         b."value" - COALESCE((
           SELECT SUM(x."value") FROM "warehouse_stock_balances" x
            WHERE x."companyId" = b."companyId"
              AND x."branchId" = b."branchId"
              AND x."itemId" = b."itemId"
         ), 0) AS "value"
    FROM "stock_balances" b
)
INSERT INTO "warehouse_stock_balances"
  ("companyId", "branchId", "warehouseId", "itemId", "quantity", "value", "updatedAt")
SELECT r."companyId", r."branchId", d."warehouseId", r."itemId",
       r."quantity", r."value", CURRENT_TIMESTAMP
  FROM residual r
  JOIN default_warehouse d
    ON d."companyId" = r."companyId" AND d."branchId" = r."branchId"
 WHERE r."quantity" <> 0 OR r."value" <> 0
ON CONFLICT ("companyId", "branchId", "warehouseId", "itemId") DO UPDATE
  SET "quantity" = "warehouse_stock_balances"."quantity" + EXCLUDED."quantity",
      "value"    = "warehouse_stock_balances"."value" + EXCLUDED."value",
      "updatedAt" = CURRENT_TIMESTAMP;

-- ── 6. who may work in which warehouse ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_warehouse_access" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT true,
    "canReceive" BOOLEAN NOT NULL DEFAULT false,
    "canIssue" BOOLEAN NOT NULL DEFAULT false,
    "canTransfer" BOOLEAN NOT NULL DEFAULT false,
    "canCount" BOOLEAN NOT NULL DEFAULT false,
    "canApprove" BOOLEAN NOT NULL DEFAULT false,
    "canSeeCost" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" UUID,

    CONSTRAINT "user_warehouse_access_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_warehouse_access_companyId_fkey') THEN
    ALTER TABLE "user_warehouse_access"
      ADD CONSTRAINT "user_warehouse_access_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_warehouse_access_userId_fkey') THEN
    ALTER TABLE "user_warehouse_access"
      ADD CONSTRAINT "user_warehouse_access_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_warehouse_access_warehouseId_fkey') THEN
    ALTER TABLE "user_warehouse_access"
      ADD CONSTRAINT "user_warehouse_access_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "user_warehouse_access_userId_warehouseId_key"
  ON "user_warehouse_access"("userId", "warehouseId");
CREATE INDEX IF NOT EXISTS "user_warehouse_access_companyId_warehouseId_idx"
  ON "user_warehouse_access"("companyId", "warehouseId");

-- ── 7. counting sessions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "stock_take_sessions" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "warehouseId" UUID,
    "code" VARCHAR(32) NOT NULL,
    "scope" VARCHAR(16) NOT NULL DEFAULT 'FULL',
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "frozenAt" TIMESTAMP(3),
    "notes" TEXT,
    "documentId" UUID,
    "journalEntryId" UUID,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" UUID,
    "postedAt" TIMESTAMP(3),
    "postedBy" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_take_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "stock_take_lines" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "batchId" UUID,
    "systemQuantity" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "countedQuantity" DECIMAL(19,4),
    "unitCost" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "varianceQuantity" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "varianceValue" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "countedAt" TIMESTAMP(3),
    "countedBy" UUID,
    "notes" TEXT,

    CONSTRAINT "stock_take_lines_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_take_sessions_companyId_fkey') THEN
    ALTER TABLE "stock_take_sessions"
      ADD CONSTRAINT "stock_take_sessions_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_take_sessions_branchId_fkey') THEN
    ALTER TABLE "stock_take_sessions"
      ADD CONSTRAINT "stock_take_sessions_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_take_sessions_warehouseId_fkey') THEN
    ALTER TABLE "stock_take_sessions"
      ADD CONSTRAINT "stock_take_sessions_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_take_lines_sessionId_fkey') THEN
    ALTER TABLE "stock_take_lines"
      ADD CONSTRAINT "stock_take_lines_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "stock_take_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_take_lines_itemId_fkey') THEN
    ALTER TABLE "stock_take_lines"
      ADD CONSTRAINT "stock_take_lines_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_take_lines_batchId_fkey') THEN
    ALTER TABLE "stock_take_lines"
      ADD CONSTRAINT "stock_take_lines_batchId_fkey"
      FOREIGN KEY ("batchId") REFERENCES "item_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_take_sessions_status_check') THEN
    ALTER TABLE "stock_take_sessions"
      ADD CONSTRAINT "stock_take_sessions_status_check"
      CHECK ("status" IN ('DRAFT','COUNTING','REVIEW','APPROVED','POSTED','CANCELLED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_take_sessions_scope_check') THEN
    ALTER TABLE "stock_take_sessions"
      ADD CONSTRAINT "stock_take_sessions_scope_check"
      CHECK ("scope" IN ('FULL','PARTIAL'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "stock_take_sessions_companyId_code_key"
  ON "stock_take_sessions"("companyId", "code");
CREATE INDEX IF NOT EXISTS "stock_take_sessions_companyId_status_createdAt_idx"
  ON "stock_take_sessions"("companyId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "stock_take_sessions_warehouseId_idx"
  ON "stock_take_sessions"("warehouseId");
CREATE INDEX IF NOT EXISTS "stock_take_lines_sessionId_idx"
  ON "stock_take_lines"("sessionId");
CREATE INDEX IF NOT EXISTS "stock_take_lines_itemId_idx"
  ON "stock_take_lines"("itemId");
