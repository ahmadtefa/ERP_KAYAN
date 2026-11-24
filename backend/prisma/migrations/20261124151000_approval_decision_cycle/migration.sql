-- A request returned for amendment and submitted again starts a new round.
-- The one-approval-per-level guard must apply inside a round, not across the
-- whole life of the document, or a returned request could never be approved.
ALTER TABLE "approval_decisions" ADD COLUMN IF NOT EXISTS "cycle" INTEGER NOT NULL DEFAULT 1;
DROP INDEX IF EXISTS "approval_decisions_one_approval_per_level_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "approval_decisions_one_approval_per_level_idx"
  ON "approval_decisions" ("companyId", "entityType", "entityId", "cycle", "level")
  WHERE "decision" = 'APPROVE';
