-- Exact-key evidence for a chain decision. The key is written in the same
-- statement-level unit as the decision, and a repeated key cannot create a
-- second decision. Old rows keep NULL and are never matched by key.
ALTER TABLE "approval_decisions" ADD COLUMN "requestKey" VARCHAR(160), ADD COLUMN "requestHash" VARCHAR(64), ADD COLUMN "completesChain" BOOLEAN;
CREATE UNIQUE INDEX "approval_decisions_company_entity_request_key"
  ON "approval_decisions" ("companyId", "entityType", "entityId", "requestKey")
  WHERE "requestKey" IS NOT NULL;
