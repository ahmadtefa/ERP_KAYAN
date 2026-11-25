-- Exact-key evidence for creating a count. Written in the same transaction as
-- the session, so a key can never exist without its session or the reverse.
-- Older sessions keep NULL and are never matched by key.
ALTER TABLE "stock_take_sessions" ADD COLUMN "createRequestKey" VARCHAR(120), ADD COLUMN "createRequestHash" VARCHAR(64);
CREATE UNIQUE INDEX "stock_take_sessions_actor_create_request_key"
  ON "stock_take_sessions" ("companyId", "createdBy", "createRequestKey")
  WHERE "createRequestKey" IS NOT NULL;
