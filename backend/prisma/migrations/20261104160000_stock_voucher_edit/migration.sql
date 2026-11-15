-- A monotonic revision makes draft edits and workflow transitions comparable,
-- even if two writes occur within the same timestamp precision.
ALTER TABLE "stock_documents" ADD COLUMN "editVersion" INTEGER NOT NULL DEFAULT 0;

-- The edit retry ledger commits atomically with the edited document and audit.
CREATE TABLE "stock_voucher_edit_requests" (
  "companyId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "requestKey" VARCHAR(128) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "documentId" UUID NOT NULL,
  "resultVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_voucher_edit_requests_pkey" PRIMARY KEY ("companyId", "branchId", "requestKey"),
  CONSTRAINT "stock_voucher_edit_requests_document_fkey" FOREIGN KEY ("documentId") REFERENCES "stock_documents"("id") ON DELETE RESTRICT
);
