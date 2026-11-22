-- A durable ledger is inserted in the same transaction as the order and audit.
-- Existing orders and clients are not rewritten.
CREATE TABLE "order_creation_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "kind" VARCHAR(8) NOT NULL,
  "requestKey" VARCHAR(128) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "orderId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_creation_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "order_creation_requests_companyId_branchId_kind_requestKey_key"
  ON "order_creation_requests"("companyId", "branchId", "kind", "requestKey");
