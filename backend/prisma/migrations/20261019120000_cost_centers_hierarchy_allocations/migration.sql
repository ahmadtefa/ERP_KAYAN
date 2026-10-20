-- Cost centers become a real accounting dimension: a type, a parent for the
-- hierarchy, an owner and a validity window, plus a controlled split of a
-- journal line across several centres.
--
-- This migration is additive and non-destructive:
--   * existing cost centers keep their code, names, active flag and history;
--   * every existing row becomes a DEPARTMENT, which is what a flat centre
--     effectively was before a type existed;
--   * existing journal lines keep their single `costCenterId`; no allocation
--     rows are invented for historical entries, and no historical amount is
--     re-attributed;
--   * no row is deleted, renamed or reassigned.
--
-- It is idempotent: running it twice changes nothing.

-- --------------------------------------------------------------- enum + cols

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CostCenterType') THEN
    CREATE TYPE "CostCenterType" AS ENUM ('DEPARTMENT', 'ADMINISTRATIVE_UNIT', 'PROJECT');
  END IF;
END $$;

ALTER TABLE "cost_centers"
  ADD COLUMN IF NOT EXISTS "type" "CostCenterType" NOT NULL DEFAULT 'DEPARTMENT',
  ADD COLUMN IF NOT EXISTS "parentId" UUID,
  ADD COLUMN IF NOT EXISTS "description" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "responsiblePerson" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "startDate" DATE,
  ADD COLUMN IF NOT EXISTS "endDate" DATE;

-- A centre cannot be its own parent. The service also refuses it, but the
-- database is the last line of defence: a cycle would make every hierarchy
-- report loop forever.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cost_centers_parent_not_self'
  ) THEN
    ALTER TABLE "cost_centers"
      ADD CONSTRAINT "cost_centers_parent_not_self" CHECK ("parentId" IS NULL OR "parentId" <> "id");
  END IF;
END $$;

-- A validity window that ends before it starts is a data-entry mistake, not a
-- business rule that can be interpreted later.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cost_centers_date_window'
  ) THEN
    ALTER TABLE "cost_centers"
      ADD CONSTRAINT "cost_centers_date_window"
      CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "endDate" >= "startDate");
  END IF;
END $$;

ALTER TABLE "cost_centers" DROP CONSTRAINT IF EXISTS "cost_centers_parentId_fkey";
ALTER TABLE "cost_centers"
  ADD CONSTRAINT "cost_centers_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "cost_centers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "cost_centers_companyId_parentId_idx"
  ON "cost_centers"("companyId", "parentId");

-- ------------------------------------------------------------- allocations

CREATE TABLE IF NOT EXISTS "journal_line_allocations" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "journalLineId" UUID NOT NULL,
  "costCenterId"  UUID NOT NULL,
  "amount"        DECIMAL(19, 4) NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "journal_line_allocations_amount_positive" CHECK ("amount" > 0)
);

ALTER TABLE "journal_line_allocations"
  DROP CONSTRAINT IF EXISTS "journal_line_allocations_journalLineId_fkey";
ALTER TABLE "journal_line_allocations"
  ADD CONSTRAINT "journal_line_allocations_journalLineId_fkey"
  FOREIGN KEY ("journalLineId") REFERENCES "journal_lines"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "journal_line_allocations"
  DROP CONSTRAINT IF EXISTS "journal_line_allocations_costCenterId_fkey";
ALTER TABLE "journal_line_allocations"
  ADD CONSTRAINT "journal_line_allocations_costCenterId_fkey"
  FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "journal_line_allocations_line_center_key"
  ON "journal_line_allocations"("journalLineId", "costCenterId");
CREATE INDEX IF NOT EXISTS "journal_line_allocations_costCenterId_idx"
  ON "journal_line_allocations"("costCenterId");

-- ------------------------------------------------------ permission catalogue

-- Reading cost centers is its own permission: an accountant who may read the
-- reports must not need the right to create or retire a centre. Writing keeps
-- using `accounting.costcenters.manage`, which already exists.
INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
SELECT gen_random_uuid(), 'accounting.costcenters.read',
       'View cost centers', 'عرض مراكز التكلفة', 'accounting'
WHERE NOT EXISTS (
  SELECT 1 FROM "permissions" WHERE "code" = 'accounting.costcenters.read'
);

-- `manage` has existed since cost centers were first created, but an install
-- old enough to predate them entirely would otherwise have a screen nobody
-- can open and nobody can administer. Adding it is additive: an existing code
-- is left exactly as it is.
INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
SELECT gen_random_uuid(), 'accounting.costcenters.manage',
       'Manage cost centers', 'إدارة مراكز التكلفة', 'accounting'
WHERE NOT EXISTS (
  SELECT 1 FROM "permissions" WHERE "code" = 'accounting.costcenters.manage'
);

-- Everyone who can already read reports can read cost centers; that is the
-- dimension the reports are grouped by. Additive only: no grant is removed.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", target."id"
  FROM "role_permissions" rp
  JOIN "permissions" source ON source."id" = rp."permissionId" AND source."code" = 'reports.read'
 CROSS JOIN "permissions" target
 WHERE target."code" = 'accounting.costcenters.read'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- A super administrator bypasses permission checks, but a company administrator
-- is an ordinary role holder. Without this grant an administrator of a database
-- created before cost centers existed would not see the screen at all.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT DISTINCT r."id", target."id"
  FROM "roles" r
 CROSS JOIN "permissions" target
 WHERE r."code" IN ('ADMIN', 'ACCOUNTANT')
   AND r."deletedAt" IS NULL
   AND target."code" IN ('accounting.costcenters.read', 'accounting.costcenters.manage')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- The same grant for accounts that received the older `reports.read` code by
-- name rather than through a role: none, by design. Per-user grants stay with
-- the person who made them.

-- ------------------------------------------ the dimension on invoice lines

-- Revenue and cost of goods can be attributed at the line that produced them.
-- Nullable and never back-filled: a historical invoice did not name a centre,
-- and inventing one would rewrite what the books say happened.
ALTER TABLE "sales_invoice_lines"
  ADD COLUMN IF NOT EXISTS "costCenterId" UUID;
ALTER TABLE "purchase_invoice_lines"
  ADD COLUMN IF NOT EXISTS "costCenterId" UUID;

ALTER TABLE "sales_invoice_lines"
  DROP CONSTRAINT IF EXISTS "sales_invoice_lines_costCenterId_fkey";
ALTER TABLE "sales_invoice_lines"
  ADD CONSTRAINT "sales_invoice_lines_costCenterId_fkey"
  FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_invoice_lines"
  DROP CONSTRAINT IF EXISTS "purchase_invoice_lines_costCenterId_fkey";
ALTER TABLE "purchase_invoice_lines"
  ADD CONSTRAINT "purchase_invoice_lines_costCenterId_fkey"
  FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "sales_invoice_lines_costCenterId_idx"
  ON "sales_invoice_lines"("costCenterId");
CREATE INDEX IF NOT EXISTS "purchase_invoice_lines_costCenterId_idx"
  ON "purchase_invoice_lines"("costCenterId");

-- A cash receipt or payment can name the cost center its counter-account
-- side belongs to (an expense paid from a box, a project receipt). Partner
-- balances themselves stay unattributed.
ALTER TABLE "cash_vouchers" ADD COLUMN IF NOT EXISTS "costCenterId" UUID;
ALTER TABLE "cash_vouchers" DROP CONSTRAINT IF EXISTS "cash_vouchers_costCenterId_fkey";
ALTER TABLE "cash_vouchers"
  ADD CONSTRAINT "cash_vouchers_costCenterId_fkey"
  FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "cash_vouchers_costCenterId_idx" ON "cash_vouchers"("costCenterId");
