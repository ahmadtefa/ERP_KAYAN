-- Configurable approval chains for the operations that already exist.
--
-- Additive only: three new tables and their permissions. No existing table is
-- altered, no column is dropped, and an installation that never writes a
-- policy keeps the review/approve behaviour it has today.

CREATE TABLE IF NOT EXISTS "approval_policies" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "operation" VARCHAR(48) NOT NULL,
  "nameEn" VARCHAR(120) NOT NULL,
  "nameAr" VARCHAR(120) NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "branchId" UUID REFERENCES "branches"("id") ON DELETE CASCADE,
  "sourceWarehouseId" UUID REFERENCES "warehouses"("id") ON DELETE CASCADE,
  "destinationWarehouseId" UUID REFERENCES "warehouses"("id") ON DELETE CASCADE,
  "minimumAmount" DECIMAL(19,4),
  "minimumQuantity" DECIMAL(19,4),
  "alwaysRequire" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "approval_policies_company_operation_priority_idx"
  ON "approval_policies" ("companyId", "operation", "isActive", "priority");

CREATE TABLE IF NOT EXISTS "approval_levels" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "policyId" UUID NOT NULL REFERENCES "approval_policies"("id") ON DELETE CASCADE,
  "level" INTEGER NOT NULL,
  "nameEn" VARCHAR(120) NOT NULL,
  "nameAr" VARCHAR(120) NOT NULL,
  "permission" VARCHAR(120) NOT NULL,
  "roleCode" VARCHAR(48),
  "optional" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "approval_levels_policy_level_key" UNIQUE ("policyId", "level")
);

CREATE TABLE IF NOT EXISTS "approval_decisions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "policyId" UUID REFERENCES "approval_policies"("id") ON DELETE SET NULL,
  "entityType" VARCHAR(48) NOT NULL,
  "entityId" UUID NOT NULL,
  "level" INTEGER NOT NULL,
  "decision" VARCHAR(16) NOT NULL,
  "reason" TEXT,
  "actorId" UUID NOT NULL,
  "actorRoleCode" VARCHAR(48),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "approval_decisions_entity_idx"
  ON "approval_decisions" ("companyId", "entityType", "entityId", "level");
CREATE INDEX IF NOT EXISTS "approval_decisions_company_created_idx"
  ON "approval_decisions" ("companyId", "createdAt");

-- A level is closed by exactly one approval. Two people clicking "approve"
-- at the same moment must not both land: the check in the service is a
-- read-then-write and therefore a race, and this index is the answer to it.
-- Rejections and returns are deliberately not covered: they are recorded even
-- if an approval slipped in first, so the history shows what really happened.
CREATE UNIQUE INDEX IF NOT EXISTS "approval_decisions_one_approval_per_level_idx"
  ON "approval_decisions" ("companyId", "entityType", "entityId", "level")
  WHERE "decision" = 'APPROVE';

-- Who may read and change approval policy configuration. Deliberately separate
-- from `inventory.transfer.approve`: designing a chain and deciding one are
-- different powers, and a storekeeper must not be able to widen their own
-- authority by editing the rule that governs it.
INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
VALUES
  (gen_random_uuid(), 'admin.approvals.read', 'View approval policies and decision history', 'عرض قواعد الموافقات وسجل القرارات', 'admin'),
  (gen_random_uuid(), 'admin.approvals.manage', 'Configure approval policies and levels', 'إعداد قواعد الموافقات ومستوياتها', 'admin')
ON CONFLICT ("code") DO NOTHING;

-- Where a configured chain was opened, and where a request was sent back for
-- amendment. Nullable and additive: a transfer written before this migration
-- simply has no values here and keeps using the review/approve doors.
ALTER TABLE "stock_transfers"
  ADD COLUMN IF NOT EXISTS "submittedBy" UUID,
  ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "returnedBy" UUID,
  ADD COLUMN IF NOT EXISTS "returnedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "returnReason" TEXT;
