-- Multi-role RBAC, part one: the columns.
--
-- Additive only. Every row already in the database keeps its values, its
-- assignments and its password hash; nothing is dropped or rewritten except the
-- two category labels the two existing roles should have had all along.

ALTER TABLE "roles"
  ADD COLUMN IF NOT EXISTS "descriptionEn" TEXT,
  ADD COLUMN IF NOT EXISTS "descriptionAr" TEXT,
  ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'CUSTOM',
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "user_permissions"
  ADD COLUMN IF NOT EXISTS "isDenied" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "reason" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- The existing ADMIN and ACCOUNTANT roles are the two roles every installation
-- has; label them so the roles screen groups them correctly on first open.
UPDATE "roles" SET "category" = 'MANAGEMENT' WHERE "code" = 'ADMIN' AND "category" = 'CUSTOM';
UPDATE "roles" SET "category" = 'FINANCE'    WHERE "code" = 'ACCOUNTANT' AND "category" = 'CUSTOM';

-- The roles screen filters by company and category, and a disabled role must
-- stop granting without being removed, so both are worth an index.
CREATE INDEX IF NOT EXISTS "roles_companyId_category_idx" ON "roles" ("companyId", "category");
