-- Fixed assets: the register, monthly depreciation runs, and the
-- per-asset monthly charge whose unique (asset, period) makes a second
-- depreciation of the same asset for the same month impossible at the
-- database level, not merely unlikely in the service.
--
-- Additive only: new tables and enums, three permission catalogue rows,
-- and grants for them (mirroring 20261023120000_system_role_grant_top_up:
-- ADMIN holds the whole catalogue, ACCOUNTANT holds the accounting
-- module). Existing data is untouched; old code ignores the new tables.

CREATE TYPE "FixedAssetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED');
CREATE TYPE "DepreciationMethod" AS ENUM ('STRAIGHT_LINE');

CREATE TABLE "fixed_assets" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "description" TEXT,
    "category" VARCHAR(60),
    "purchaseDate" DATE NOT NULL,
    "inServiceDate" DATE NOT NULL,
    "supplierId" UUID,
    "purchaseInvoiceId" UUID,
    "cost" DECIMAL(19,4) NOT NULL,
    "salvageValue" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "usefulLifeMonths" INTEGER NOT NULL,
    "method" "DepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "assetAccountId" UUID NOT NULL,
    "accumulatedAccountId" UUID NOT NULL,
    "expenseAccountId" UUID NOT NULL,
    "costCenterId" UUID,
    "location" TEXT,
    "status" "FixedAssetStatus" NOT NULL DEFAULT 'DRAFT',
    "acquisitionJournalEntryId" UUID,
    "disposalDate" DATE,
    "disposalProceeds" DECIMAL(19,4),
    "disposalJournalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "depreciation_runs" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "runNumber" TEXT NOT NULL,
    "periodKey" VARCHAR(7) NOT NULL,
    "runDate" DATE NOT NULL,
    "totalAmount" DECIMAL(19,4) NOT NULL,
    "journalEntryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "depreciation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "asset_depreciations" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "periodKey" VARCHAR(7) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "accumulatedAfter" DECIMAL(19,4) NOT NULL,
    "journalEntryId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_depreciations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fixed_assets_companyId_code_key" ON "fixed_assets"("companyId", "code");
CREATE INDEX "fixed_assets_companyId_status_idx" ON "fixed_assets"("companyId", "status");
CREATE INDEX "depreciation_runs_companyId_periodKey_idx" ON "depreciation_runs"("companyId", "periodKey");
CREATE UNIQUE INDEX "asset_depreciations_assetId_periodKey_key" ON "asset_depreciations"("assetId", "periodKey");
CREATE INDEX "asset_depreciations_companyId_periodKey_idx" ON "asset_depreciations"("companyId", "periodKey");

ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_assetAccountId_fkey" FOREIGN KEY ("assetAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_accumulatedAccountId_fkey" FOREIGN KEY ("accumulatedAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "depreciation_runs" ADD CONSTRAINT "depreciation_runs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_runId_fkey" FOREIGN KEY ("runId") REFERENCES "depreciation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "asset_depreciations" ADD CONSTRAINT "asset_depreciations_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The permission catalogue rows (seeded identically by prisma/permissions.ts
-- on a fresh company; existing databases get them here).
INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
SELECT gen_random_uuid(), v.code, v.name_en, v.name_ar, 'accounting'
  FROM (VALUES
    ('accounting.fixedassets.read', 'View fixed assets', 'عرض الأصول الثابتة'),
    ('accounting.fixedassets.manage', 'Manage fixed assets', 'إدارة الأصول الثابتة'),
    ('accounting.fixedassets.depreciate', 'Run depreciation', 'تشغيل الإهلاك')
  ) AS v(code, name_en, name_ar)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p.code = v.code);

-- ADMIN (system): the whole catalogue, as documented in the seed.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  CROSS JOIN "permissions" p
 WHERE r.code = 'ADMIN'
   AND r."isSystem" = true
   AND r."deletedAt" IS NULL
   AND p.code LIKE 'accounting.fixedassets.%'
   AND NOT EXISTS (
     SELECT 1 FROM "role_permissions" x
      WHERE x."roleId" = r.id AND x."permissionId" = p.id
   );

-- ACCOUNTANT (system): the accounting module.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  JOIN "permissions" p ON p.module = 'accounting' AND p.code LIKE 'accounting.fixedassets.%'
 WHERE r.code = 'ACCOUNTANT'
   AND r."isSystem" = true
   AND r."deletedAt" IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM "role_permissions" x
      WHERE x."roleId" = r.id AND x."permissionId" = p.id
   );
