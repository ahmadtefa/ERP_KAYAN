-- Warehouses grow up: sub-warehouses, shelves, lots with dates, and the
-- thresholds that belong to a place rather than to an item.
--
-- Purely additive. Every column is nullable or has a default, every table is
-- new, and nothing is renamed or dropped, so an installation that already
-- holds stock keeps every row and every screen that worked yesterday still
-- works. The batch switches default to off, which is the only safe answer for
-- items that existed before this migration: a company that never recorded a
-- lot number must not suddenly be refused a receipt.

-- ── 1. sub-warehouses ────────────────────────────────────────────────────
ALTER TABLE "warehouses"
  ADD COLUMN IF NOT EXISTS "parentId" uuid,
  ADD COLUMN IF NOT EXISTS "kind" varchar(16) NOT NULL DEFAULT 'MAIN';

COMMENT ON COLUMN "warehouses"."kind" IS
  'MAIN or SUB. A SUB warehouse is a store room inside another one.';
COMMENT ON COLUMN "warehouses"."parentId" IS
  'The warehouse a sub-warehouse belongs to. Null for a main warehouse.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouses_parentId_fkey'
  ) THEN
    ALTER TABLE "warehouses"
      ADD CONSTRAINT "warehouses_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "warehouses"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'warehouses_kind_check'
  ) THEN
    ALTER TABLE "warehouses"
      ADD CONSTRAINT "warehouses_kind_check" CHECK ("kind" IN ('MAIN', 'SUB'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "warehouses_parentId_idx" ON "warehouses"("parentId");

-- ── 2. storage locations ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "storage_locations" (
  "id"          uuid NOT NULL,
  "companyId"   uuid NOT NULL,
  "branchId"    uuid NOT NULL,
  "warehouseId" uuid NOT NULL,
  "parentId"    uuid,
  "kind"        varchar(16) NOT NULL DEFAULT 'BIN',
  "code"        varchar(40) NOT NULL,
  "nameEn"      text NOT NULL,
  "nameAr"      text NOT NULL,
  "isActive"    boolean NOT NULL DEFAULT true,
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   timestamp(3) NOT NULL,
  "createdBy"   uuid,
  "deletedAt"   timestamp(3),
  CONSTRAINT "storage_locations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "storage_locations_kind_check"
    CHECK ("kind" IN ('ZONE', 'AISLE', 'RACK', 'SHELF', 'BIN'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "storage_locations_warehouseId_code_key"
  ON "storage_locations"("warehouseId", "code");
CREATE INDEX IF NOT EXISTS "storage_locations_companyId_warehouseId_kind_idx"
  ON "storage_locations"("companyId", "warehouseId", "kind");
CREATE INDEX IF NOT EXISTS "storage_locations_parentId_idx"
  ON "storage_locations"("parentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storage_locations_companyId_fkey') THEN
    ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storage_locations_branchId_fkey') THEN
    ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storage_locations_warehouseId_fkey') THEN
    ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storage_locations_parentId_fkey') THEN
    ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 3. per-warehouse thresholds ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "item_warehouse_settings" (
  "id"              uuid NOT NULL,
  "companyId"       uuid NOT NULL,
  "warehouseId"     uuid NOT NULL,
  "itemId"          uuid NOT NULL,
  "minQuantity"     numeric(19,4) NOT NULL DEFAULT 0,
  "reorderQuantity" numeric(19,4) NOT NULL DEFAULT 0,
  "maxQuantity"     numeric(19,4) NOT NULL DEFAULT 0,
  "createdAt"       timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       timestamp(3) NOT NULL,
  "updatedBy"       uuid,
  CONSTRAINT "item_warehouse_settings_pkey" PRIMARY KEY ("id"),
  -- A negative maximum is a typo, not a policy.
  CONSTRAINT "item_warehouse_settings_quantity_check" CHECK (
    "minQuantity" >= 0 AND "reorderQuantity" >= 0 AND "maxQuantity" >= 0
    AND ("maxQuantity" = 0 OR "maxQuantity" >= "minQuantity")
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "item_warehouse_settings_warehouseId_itemId_key"
  ON "item_warehouse_settings"("warehouseId", "itemId");
CREATE INDEX IF NOT EXISTS "item_warehouse_settings_companyId_itemId_idx"
  ON "item_warehouse_settings"("companyId", "itemId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_warehouse_settings_companyId_fkey') THEN
    ALTER TABLE "item_warehouse_settings" ADD CONSTRAINT "item_warehouse_settings_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_warehouse_settings_warehouseId_fkey') THEN
    ALTER TABLE "item_warehouse_settings" ADD CONSTRAINT "item_warehouse_settings_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_warehouse_settings_itemId_fkey') THEN
    ALTER TABLE "item_warehouse_settings" ADD CONSTRAINT "item_warehouse_settings_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 4. the batch policy on the item ──────────────────────────────────────
ALTER TABLE "items"
  ADD COLUMN IF NOT EXISTS "requiresBatch" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "requiresProductionDate" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "requiresExpiryDate" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "useFefo" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "allowExpiredIssue" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "expiredIssueNeedsApproval" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "items"."useFefo" IS
  'Pick the earliest-expiring lot first. An item with no expiry date is unaffected.';
COMMENT ON COLUMN "items"."allowExpiredIssue" IS
  'False refuses an issue from an expired lot: the safe default for every item.';

-- An item that expires must say so; asking for an expiry-checked item with
-- the switch off would silently disable FEFO's only input.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_expiry_policy_check') THEN
    ALTER TABLE "items" ADD CONSTRAINT "items_expiry_policy_check"
      CHECK (NOT "requiresExpiryDate" OR "requiresBatch");
  END IF;
END $$;

-- ── 5. lots ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "item_batches" (
  "id"                uuid NOT NULL,
  "companyId"         uuid NOT NULL,
  "branchId"          uuid NOT NULL,
  "warehouseId"       uuid NOT NULL,
  "itemId"            uuid NOT NULL,
  "batchNumber"       varchar(60) NOT NULL,
  "productionDate"    date,
  "expiryDate"        date,
  "receivedQuantity"  numeric(19,4) NOT NULL,
  "remainingQuantity" numeric(19,4) NOT NULL,
  "reservedQuantity"  numeric(19,4) NOT NULL DEFAULT 0,
  "unitCost"          numeric(19,4) NOT NULL DEFAULT 0,
  "status"            varchar(16) NOT NULL DEFAULT 'OPEN',
  "sourceType"        varchar(32),
  "sourceId"          uuid,
  "sourceNumber"      varchar(48),
  "storageLocationId" uuid,
  "notes"             text,
  "createdAt"         timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         timestamp(3) NOT NULL,
  "createdBy"         uuid,
  "updatedBy"         uuid,
  "deletedAt"         timestamp(3),
  CONSTRAINT "item_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "item_batches_status_check"
    CHECK ("status" IN ('OPEN', 'QUARANTINE', 'EXPIRED', 'WRITTEN_OFF', 'CLOSED')),
  -- A lot cannot hold more than it received, and cannot hold less than none.
  CONSTRAINT "item_batches_quantity_check" CHECK (
    "receivedQuantity" >= 0
    AND "remainingQuantity" >= 0
    AND "remainingQuantity" <= "receivedQuantity"
    AND "reservedQuantity" >= 0
  ),
  -- Expiry before production is not a lot, it is a typo.
  CONSTRAINT "item_batches_dates_check" CHECK (
    "expiryDate" IS NULL OR "productionDate" IS NULL OR "expiryDate" >= "productionDate"
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "item_batches_warehouseId_itemId_batchNumber_key"
  ON "item_batches"("warehouseId", "itemId", "batchNumber");
-- FEFO reads this one: the soonest expiry with something left in it.
CREATE INDEX IF NOT EXISTS "item_batches_companyId_itemId_expiryDate_idx"
  ON "item_batches"("companyId", "itemId", "expiryDate");
CREATE INDEX IF NOT EXISTS "item_batches_companyId_expiryDate_status_idx"
  ON "item_batches"("companyId", "expiryDate", "status");
CREATE INDEX IF NOT EXISTS "item_batches_companyId_warehouseId_itemId_idx"
  ON "item_batches"("companyId", "warehouseId", "itemId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_batches_companyId_fkey') THEN
    ALTER TABLE "item_batches" ADD CONSTRAINT "item_batches_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_batches_branchId_fkey') THEN
    ALTER TABLE "item_batches" ADD CONSTRAINT "item_batches_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_batches_warehouseId_fkey') THEN
    ALTER TABLE "item_batches" ADD CONSTRAINT "item_batches_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_batches_itemId_fkey') THEN
    ALTER TABLE "item_batches" ADD CONSTRAINT "item_batches_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 6. movements name a lot and a shelf ──────────────────────────────────
ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "batchId" uuid,
  ADD COLUMN IF NOT EXISTS "storageLocationId" uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_batchId_fkey') THEN
    ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batchId_fkey"
      FOREIGN KEY ("batchId") REFERENCES "item_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_movements_storageLocationId_fkey') THEN
    ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_storageLocationId_fkey"
      FOREIGN KEY ("storageLocationId") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "stock_movements_batchId_idx" ON "stock_movements"("batchId");
CREATE INDEX IF NOT EXISTS "stock_movements_storageLocationId_idx" ON "stock_movements"("storageLocationId");

-- ── 7. the moving average, written down ──────────────────────────────────
CREATE TABLE IF NOT EXISTS "item_cost_history" (
  "id"            uuid NOT NULL,
  "companyId"     uuid NOT NULL,
  "branchId"      uuid NOT NULL,
  "warehouseId"   uuid,
  "itemId"        uuid NOT NULL,
  "occurredAt"    date NOT NULL,
  "quantityIn"    numeric(19,4) NOT NULL DEFAULT 0,
  "valueIn"       numeric(19,4) NOT NULL DEFAULT 0,
  "quantityAfter" numeric(19,4) NOT NULL,
  "valueAfter"    numeric(19,4) NOT NULL,
  "unitCostAfter" numeric(19,6) NOT NULL,
  "sourceType"    varchar(32) NOT NULL,
  "sourceId"      uuid,
  "createdAt"     timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"     uuid,
  CONSTRAINT "item_cost_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "item_cost_history_companyId_itemId_occurredAt_idx"
  ON "item_cost_history"("companyId", "itemId", "occurredAt");
CREATE INDEX IF NOT EXISTS "item_cost_history_companyId_warehouseId_itemId_occurredAt_idx"
  ON "item_cost_history"("companyId", "warehouseId", "itemId", "occurredAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_cost_history_companyId_fkey') THEN
    ALTER TABLE "item_cost_history" ADD CONSTRAINT "item_cost_history_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_cost_history_branchId_fkey') THEN
    ALTER TABLE "item_cost_history" ADD CONSTRAINT "item_cost_history_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_cost_history_warehouseId_fkey') THEN
    ALTER TABLE "item_cost_history" ADD CONSTRAINT "item_cost_history_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'item_cost_history_itemId_fkey') THEN
    ALTER TABLE "item_cost_history" ADD CONSTRAINT "item_cost_history_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 8. the notification centre ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "notifications" (
  "id"          uuid NOT NULL,
  "companyId"   uuid NOT NULL,
  "branchId"    uuid,
  "warehouseId" uuid,
  "type"        varchar(48) NOT NULL,
  "severity"    varchar(16) NOT NULL DEFAULT 'INFO',
  "status"      varchar(16) NOT NULL DEFAULT 'OPEN',
  "titleEn"     text NOT NULL,
  "titleAr"     text NOT NULL,
  "bodyEn"      text,
  "bodyAr"      text,
  "entityType"  varchar(32),
  "entityId"    uuid,
  "entityRef"   varchar(120),
  "actionPath"  varchar(200),
  "permission"  varchar(64),
  "dedupeKey"   varchar(200) NOT NULL,
  "dueAt"       timestamp(3),
  "createdAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt"      timestamp(3),
  "archivedAt"  timestamp(3),
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_severity_check" CHECK ("severity" IN ('INFO', 'WARNING', 'CRITICAL')),
  CONSTRAINT "notifications_status_check" CHECK ("status" IN ('OPEN', 'READ', 'ARCHIVED'))
);

-- One fact, one row: the scanner may decide the same fact on every pass.
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_companyId_dedupeKey_key"
  ON "notifications"("companyId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "notifications_companyId_status_createdAt_idx"
  ON "notifications"("companyId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "notifications_companyId_type_status_idx"
  ON "notifications"("companyId", "type", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_companyId_fkey') THEN
    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_branchId_fkey') THEN
    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_warehouseId_fkey') THEN
    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "notification_settings" (
  "id"               uuid NOT NULL,
  "companyId"        uuid NOT NULL,
  "type"             varchar(48) NOT NULL,
  "isEnabled"        boolean NOT NULL DEFAULT true,
  "severity"         varchar(16),
  "roles"            jsonb,
  "warehouseIds"     jsonb,
  "expiryDays"       jsonb,
  "repeatAfterHours" integer NOT NULL DEFAULT 24,
  "updatedAt"        timestamp(3) NOT NULL,
  "updatedBy"        uuid,
  CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_settings_companyId_type_key"
  ON "notification_settings"("companyId", "type");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_settings_companyId_fkey') THEN
    ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── The lot a purchase line received ────────────────────────────────────────
-- A receipt has to be able to say which batch arrived and when it expires,
-- otherwise the lot table can only be filled in by a second trip to the same
-- screen. All four columns are nullable: existing invoices keep working, and a
-- line for an item that is not lot-controlled simply leaves them empty.
ALTER TABLE "purchase_invoice_lines"
  ADD COLUMN IF NOT EXISTS "batchNumber" VARCHAR(60),
  ADD COLUMN IF NOT EXISTS "batchProductionDate" DATE,
  ADD COLUMN IF NOT EXISTS "batchExpiryDate" DATE,
  ADD COLUMN IF NOT EXISTS "storageLocationId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = 'purchase_invoice_lines_batch_expiry_check'
       AND table_name = 'purchase_invoice_lines'
  ) THEN
    ALTER TABLE "purchase_invoice_lines"
      ADD CONSTRAINT "purchase_invoice_lines_batch_expiry_check"
      CHECK ("batchExpiryDate" IS NULL
             OR "batchProductionDate" IS NULL
             OR "batchExpiryDate" >= "batchProductionDate");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "purchase_invoice_lines_batchNumber_idx"
  ON "purchase_invoice_lines" ("batchNumber");
