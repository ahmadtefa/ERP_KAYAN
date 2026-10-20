-- Two additions that finish the cost-centre dimension:
--
--   1. a budget definition per cost centre, account and period, so
--      "budget against actual" can be answered from posted ledger lines;
--   2. an optional cost centre on a stock adjustment or count, so the
--      inventory difference those documents post is attributed to the
--      department or project that caused it.
--
-- Additive and non-destructive: no existing row is rewritten, no historical
-- document is given a centre, and no allocation is invented. Every statement
-- is idempotent, so running the migration twice changes nothing.

-- ----------------------------------------------------------------- budgets

CREATE TABLE IF NOT EXISTS "budgets" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId"    UUID NOT NULL,
  "costCenterId" UUID NOT NULL,
  "accountId"    UUID NOT NULL,
  "periodStart"  DATE NOT NULL,
  "periodEnd"    DATE NOT NULL,
  "amount"       DECIMAL(18, 4) NOT NULL,
  "currency"     VARCHAR(3) NOT NULL,
  "notes"        VARCHAR(500),
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"    UUID,
  "updatedBy"    UUID,
  "deletedAt"    TIMESTAMP(3),
  CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "budgets_companyId_periodStart_periodEnd_idx"
  ON "budgets"("companyId", "periodStart", "periodEnd");
CREATE INDEX IF NOT EXISTS "budgets_companyId_costCenterId_idx"
  ON "budgets"("companyId", "costCenterId");
CREATE INDEX IF NOT EXISTS "budgets_accountId_idx" ON "budgets"("accountId");

-- A budget is never negative: a negative plan is a correction, not a plan.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budgets_amount_not_negative') THEN
    ALTER TABLE "budgets"
      ADD CONSTRAINT "budgets_amount_not_negative" CHECK ("amount" >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budgets_period_order') THEN
    ALTER TABLE "budgets"
      ADD CONSTRAINT "budgets_period_order" CHECK ("periodEnd" >= "periodStart");
  END IF;
END $$;

-- One active definition per centre, account and period. A partial unique index
-- rather than a table constraint: a budget that was retired keeps its row for
-- history, and it must be possible to define a fresh one for the same period.
CREATE UNIQUE INDEX IF NOT EXISTS "budgets_active_definition_key"
  ON "budgets"("companyId", "costCenterId", "accountId", "periodStart", "periodEnd")
  WHERE "deletedAt" IS NULL;

ALTER TABLE "budgets" DROP CONSTRAINT IF EXISTS "budgets_companyId_fkey";
ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "budgets" DROP CONSTRAINT IF EXISTS "budgets_costCenterId_fkey";
ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_costCenterId_fkey"
  FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "budgets" DROP CONSTRAINT IF EXISTS "budgets_accountId_fkey";
ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------- stock document attribution

ALTER TABLE "stock_documents"
  ADD COLUMN IF NOT EXISTS "costCenterId" UUID;

CREATE INDEX IF NOT EXISTS "stock_documents_costCenterId_idx"
  ON "stock_documents"("costCenterId");

ALTER TABLE "stock_documents" DROP CONSTRAINT IF EXISTS "stock_documents_costCenterId_fkey";
ALTER TABLE "stock_documents"
  ADD CONSTRAINT "stock_documents_costCenterId_fkey"
  FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ------------------------------------------------------ permission catalogue

INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
SELECT gen_random_uuid(), 'accounting.budgets.read',
       'View budgets', 'عرض الموازنات', 'accounting'
WHERE NOT EXISTS (
  SELECT 1 FROM "permissions" WHERE "code" = 'accounting.budgets.read'
);

INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
SELECT gen_random_uuid(), 'accounting.budgets.manage',
       'Manage budgets', 'إدارة الموازنات', 'accounting'
WHERE NOT EXISTS (
  SELECT 1 FROM "permissions" WHERE "code" = 'accounting.budgets.manage'
);

-- Preparing and editing a budget is bookkeeping work, so the two seeded roles
-- that keep the books receive it. Additive only: nothing is revoked, and a
-- company that manages its own grants keeps them exactly as they were.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT DISTINCT r."id", target."id"
  FROM "roles" r
 CROSS JOIN "permissions" target
 WHERE r."code" IN ('ADMIN', 'ACCOUNTANT')
   AND r."deletedAt" IS NULL
   AND target."code" IN ('accounting.budgets.read', 'accounting.budgets.manage')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
