-- A separate retry ledger for stock document creation. It is written with the
-- document and mandatory audit in one transaction. Existing rows are untouched.
CREATE TABLE "stock_document_creation_requests" (
  "companyId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "requestKey" VARCHAR(128) NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "documentId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_document_creation_requests_pkey" PRIMARY KEY ("companyId", "branchId", "requestKey"),
  CONSTRAINT "stock_document_creation_requests_document_fkey" FOREIGN KEY ("documentId") REFERENCES "stock_documents"("id") ON DELETE RESTRICT
);
