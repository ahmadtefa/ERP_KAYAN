CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'ISSUED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED');

CREATE TABLE "quotations" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "branchId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "quotationNumber" TEXT NOT NULL,
  "quotationDate" DATE NOT NULL,
  "validUntil" DATE,
  "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
  "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
  "discountAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "subTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "taxAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "totalAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "originCountry" TEXT,
  "responsibleManager" TEXT,
  "showTaxId" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "companySnapshot" JSONB NOT NULL,
  "termsSnapshot" JSONB NOT NULL,
  "convertedInvoiceId" UUID,
  "issuedAt" TIMESTAMP(3),
  "issuedBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdBy" UUID,
  "updatedBy" UUID,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "quotations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quotations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quotations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quotations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "quotations_companyId_quotationNumber_key" ON "quotations"("companyId", "quotationNumber");
CREATE INDEX "quotations_companyId_quotationDate_idx" ON "quotations"("companyId", "quotationDate");
CREATE INDEX "quotations_companyId_status_idx" ON "quotations"("companyId", "status");

CREATE TABLE "quotation_lines" (
  "id" UUID NOT NULL,
  "quotationId" UUID NOT NULL,
  "tableTitle" TEXT NOT NULL DEFAULT 'Items',
  "lineNumber" INTEGER NOT NULL,
  "itemId" UUID,
  "description" TEXT NOT NULL,
  "unit" TEXT,
  "quantity" DECIMAL(19,4) NOT NULL,
  "unitPrice" DECIMAL(19,4) NOT NULL,
  "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
  "discountAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "taxRate" DECIMAL(9,4) NOT NULL DEFAULT 0,
  "taxAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "lineTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quotation_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quotation_lines_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quotation_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "quotation_lines_quotationId_tableTitle_lineNumber_key" ON "quotation_lines"("quotationId", "tableTitle", "lineNumber");
CREATE INDEX "quotation_lines_quotationId_idx" ON "quotation_lines"("quotationId");
CREATE INDEX "quotation_lines_itemId_idx" ON "quotation_lines"("itemId");

CREATE TABLE "quotation_term_templates" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdBy" UUID,
  "updatedBy" UUID,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "quotation_term_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quotation_term_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "quotation_term_templates_companyId_isActive_sortOrder_idx" ON "quotation_term_templates"("companyId", "isActive", "sortOrder");
