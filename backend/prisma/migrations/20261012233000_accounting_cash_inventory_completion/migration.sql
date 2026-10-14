-- Completing the ERP: cost centers, company settings, cash and banks, opening
-- balances, stock documents, returns and backup history.
--
-- Additive only. Every new table is new, every new column is nullable or has a
-- default, and the two enum changes only add values. Nothing is dropped,
-- renamed, or rewritten, so this runs against an empty database and against
-- one that already holds a company's full books without touching a row.
--
-- Applied by `prisma migrate deploy`, or - when the Prisma schema engine
-- cannot be downloaded, which is the normal case on an on-premise server -
-- by `node scripts/apply-migrations.mjs`, which applies this same file.

-- ───────────────────────────────────────────────────────── enum extensions
-- A journal entry can now wait for a second pair of eyes, and it can be
-- cancelled instead of deleted. Adding a value to an existing enum keeps every
-- row that already carries the old values exactly where it is.

ALTER TYPE "JournalStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL' AFTER 'DRAFT';
ALTER TYPE "JournalStatus" ADD VALUE IF NOT EXISTS 'APPROVED' AFTER 'PENDING_APPROVAL';
ALTER TYPE "JournalStatus" ADD VALUE IF NOT EXISTS 'CANCELLED' AFTER 'REVERSED';

-- CreateEnum
CREATE TYPE "InvoiceDocumentType" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE');
CREATE TYPE "CashAccountKind" AS ENUM ('CASH', 'BANK');
CREATE TYPE "CashVoucherKind" AS ENUM ('RECEIPT', 'PAYMENT');
CREATE TYPE "StockDocumentKind" AS ENUM ('ADJUSTMENT', 'TRANSFER', 'COUNT', 'OPENING');

-- ─────────────────────────────────────────────────────────── cost centers

CREATE TABLE "cost_centers" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cost_centers_companyId_code_key" ON "cost_centers"("companyId", "code");
CREATE INDEX IF NOT EXISTS "cost_centers_companyId_isActive_idx" ON "cost_centers"("companyId", "isActive");

ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A line may now name the cost center it belongs to. Existing lines keep a
-- NULL, which means "not allocated" - exactly what they meant before.
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "costCenterId" UUID;
CREATE INDEX IF NOT EXISTS "journal_lines_costCenterId_idx" ON "journal_lines"("costCenterId");
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_costCenterId_fkey"
  FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────── company settings

CREATE TABLE "company_settings" (
    "companyId" UUID NOT NULL,
    "taxRate" DECIMAL(9,4) NOT NULL DEFAULT 14,
    "pricesIncludeTax" BOOLEAN NOT NULL DEFAULT false,
    "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false,
    "inventoryValuation" VARCHAR(32) NOT NULL DEFAULT 'WEIGHTED_AVERAGE',
    "approvalRequiredForJournal" BOOLEAN NOT NULL DEFAULT false,
    "segregationOfDuties" BOOLEAN NOT NULL DEFAULT false,
    "backupRetentionCount" INTEGER NOT NULL DEFAULT 14,
    "backupIntervalHours" INTEGER NOT NULL DEFAULT 24,
    "maxDiscountPercent" DECIMAL(9,4) NOT NULL DEFAULT 100,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" UUID,
    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("companyId")
);

ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────── item extras

CREATE TABLE "item_categories" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "item_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "item_categories_companyId_code_key" ON "item_categories"("companyId", "code");
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "item_units" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "unit" TEXT NOT NULL,
    "factor" DECIMAL(19,6) NOT NULL,
    "barcode" TEXT,
    "salePrice" DECIMAL(19,4),
    "purchasePrice" DECIMAL(19,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "item_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "item_units_itemId_unit_key" ON "item_units"("itemId", "unit");
ALTER TABLE "item_units" ADD CONSTRAINT "item_units_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "purchasePrice" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "reorderLevel" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "categoryId" UUID;

CREATE INDEX IF NOT EXISTS "items_categoryId_idx" ON "items"("categoryId");
ALTER TABLE "items" ADD CONSTRAINT "items_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "item_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────── cash and banks

CREATE TABLE "cash_accounts" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "kind" "CashAccountKind" NOT NULL DEFAULT 'CASH',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
    "accountId" UUID NOT NULL,
    "bankName" TEXT,
    "bankAccountNumber" TEXT,
    "iban" TEXT,
    "swiftCode" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "cash_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cash_accounts_companyId_code_key" ON "cash_accounts"("companyId", "code");
CREATE INDEX IF NOT EXISTS "cash_accounts_companyId_kind_idx" ON "cash_accounts"("companyId", "kind");
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "bank_reconciliations" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "cashAccountId" UUID NOT NULL,
    "statementDate" DATE NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "statementBalance" DECIMAL(19,4) NOT NULL,
    "bookBalance" DECIMAL(19,4) NOT NULL,
    "difference" DECIMAL(19,4) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "bank_reconciliations_companyId_cashAccountId_statementDate_idx"
  ON "bank_reconciliations"("companyId", "cashAccountId", "statementDate");
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_cashAccountId_fkey"
  FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "cash_vouchers" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "voucherNumber" TEXT NOT NULL,
    "voucherDate" DATE NOT NULL,
    "kind" "CashVoucherKind" NOT NULL,
    "cashAccountId" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
    "customerId" UUID,
    "supplierId" UUID,
    "counterAccountId" UUID,
    "description" TEXT,
    "reference" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "journalEntryId" UUID,
    "postedAt" TIMESTAMP(3),
    "postedBy" UUID,
    "reconciledAt" TIMESTAMP(3),
    "reconciliationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "cash_vouchers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cash_vouchers_companyId_voucherNumber_key" ON "cash_vouchers"("companyId", "voucherNumber");
CREATE INDEX IF NOT EXISTS "cash_vouchers_companyId_voucherDate_idx" ON "cash_vouchers"("companyId", "voucherDate");
CREATE INDEX IF NOT EXISTS "cash_vouchers_companyId_status_idx" ON "cash_vouchers"("companyId", "status");
CREATE INDEX IF NOT EXISTS "cash_vouchers_cashAccountId_voucherDate_idx" ON "cash_vouchers"("cashAccountId", "voucherDate");
ALTER TABLE "cash_vouchers" ADD CONSTRAINT "cash_vouchers_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_vouchers" ADD CONSTRAINT "cash_vouchers_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_vouchers" ADD CONSTRAINT "cash_vouchers_cashAccountId_fkey"
  FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_vouchers" ADD CONSTRAINT "cash_vouchers_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_vouchers" ADD CONSTRAINT "cash_vouchers_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_vouchers" ADD CONSTRAINT "cash_vouchers_counterAccountId_fkey"
  FOREIGN KEY ("counterAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_vouchers" ADD CONSTRAINT "cash_vouchers_reconciliationId_fkey"
  FOREIGN KEY ("reconciliationId") REFERENCES "bank_reconciliations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "cash_voucher_allocations" (
    "id" UUID NOT NULL,
    "voucherId" UUID NOT NULL,
    "salesInvoiceId" UUID,
    "purchaseInvoiceId" UUID,
    "amount" DECIMAL(19,4) NOT NULL,
    CONSTRAINT "cash_voucher_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cash_voucher_allocations_voucherId_idx" ON "cash_voucher_allocations"("voucherId");
CREATE INDEX IF NOT EXISTS "cash_voucher_allocations_salesInvoiceId_idx" ON "cash_voucher_allocations"("salesInvoiceId");
CREATE INDEX IF NOT EXISTS "cash_voucher_allocations_purchaseInvoiceId_idx" ON "cash_voucher_allocations"("purchaseInvoiceId");
ALTER TABLE "cash_voucher_allocations" ADD CONSTRAINT "cash_voucher_allocations_voucherId_fkey"
  FOREIGN KEY ("voucherId") REFERENCES "cash_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_voucher_allocations" ADD CONSTRAINT "cash_voucher_allocations_salesInvoiceId_fkey"
  FOREIGN KEY ("salesInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_voucher_allocations" ADD CONSTRAINT "cash_voucher_allocations_purchaseInvoiceId_fkey"
  FOREIGN KEY ("purchaseInvoiceId") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "cash_transfers" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "transferDate" DATE NOT NULL,
    "fromCashAccountId" UUID NOT NULL,
    "toCashAccountId" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EGP',
    "description" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "journalEntryId" UUID,
    "postedAt" TIMESTAMP(3),
    "postedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "cash_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cash_transfers_companyId_transferNumber_key" ON "cash_transfers"("companyId", "transferNumber");
CREATE INDEX IF NOT EXISTS "cash_transfers_companyId_transferDate_idx" ON "cash_transfers"("companyId", "transferDate");
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_fromCashAccountId_fkey"
  FOREIGN KEY ("fromCashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_toCashAccountId_fkey"
  FOREIGN KEY ("toCashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────────────────────────────────────────────── opening balances

CREATE TABLE "opening_balances" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "description" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "totalDebit" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalCredit" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "journalEntryId" UUID,
    "postedAt" TIMESTAMP(3),
    "postedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "opening_balances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "opening_balances_companyId_documentNumber_key" ON "opening_balances"("companyId", "documentNumber");
CREATE INDEX IF NOT EXISTS "opening_balances_companyId_asOfDate_idx" ON "opening_balances"("companyId", "asOfDate");
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "opening_balance_lines" (
    "id" UUID NOT NULL,
    "openingBalanceId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "customerId" UUID,
    "supplierId" UUID,
    "itemId" UUID,
    "debit" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "quantity" DECIMAL(19,4),
    "unitCost" DECIMAL(19,4),
    "description" TEXT,
    "lineNumber" INTEGER NOT NULL,
    CONSTRAINT "opening_balance_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "opening_balance_lines_openingBalanceId_lineNumber_key"
  ON "opening_balance_lines"("openingBalanceId", "lineNumber");
CREATE INDEX IF NOT EXISTS "opening_balance_lines_openingBalanceId_idx" ON "opening_balance_lines"("openingBalanceId");
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_openingBalanceId_fkey"
  FOREIGN KEY ("openingBalanceId") REFERENCES "opening_balances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opening_balance_lines" ADD CONSTRAINT "opening_balance_lines_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────── stock documents

CREATE TABLE "stock_documents" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "kind" "StockDocumentKind" NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "documentDate" DATE NOT NULL,
    "fromBranchId" UUID,
    "toBranchId" UUID,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "notes" TEXT,
    "journalEntryId" UUID,
    "postedAt" TIMESTAMP(3),
    "postedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "stock_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_documents_companyId_documentNumber_key" ON "stock_documents"("companyId", "documentNumber");
CREATE INDEX IF NOT EXISTS "stock_documents_companyId_kind_documentDate_idx"
  ON "stock_documents"("companyId", "kind", "documentDate");
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "stock_document_lines" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantity" DECIMAL(19,4) NOT NULL,
    "unitCost" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "countedQuantity" DECIMAL(19,4),
    "notes" TEXT,
    "lineNumber" INTEGER NOT NULL,
    CONSTRAINT "stock_document_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_document_lines_documentId_lineNumber_key"
  ON "stock_document_lines"("documentId", "lineNumber");
CREATE INDEX IF NOT EXISTS "stock_document_lines_documentId_idx" ON "stock_document_lines"("documentId");
ALTER TABLE "stock_document_lines" ADD CONSTRAINT "stock_document_lines_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "stock_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_document_lines" ADD CONSTRAINT "stock_document_lines_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────────────────────────────────────────────────── backup runs

CREATE TABLE "backup_runs" (
    "id" UUID NOT NULL,
    "companyId" UUID,
    "kind" VARCHAR(24) NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "createdBy" UUID,
    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "backup_runs_companyId_createdAt_idx" ON "backup_runs"("companyId", "createdAt");
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ──────────────────────────────────── returns, discounts and journal review

-- Invoices gain a document type so a return is its own document that points at
-- the invoice it returns. Every existing row is an INVOICE, which is what it is.
ALTER TABLE "sales_invoices"
  ADD COLUMN IF NOT EXISTS "documentType" "InvoiceDocumentType" NOT NULL DEFAULT 'INVOICE',
  ADD COLUMN IF NOT EXISTS "originalInvoiceId" UUID,
  ADD COLUMN IF NOT EXISTS "returnReason" TEXT,
  ADD COLUMN IF NOT EXISTS "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discountAmount" DECIMAL(19,4) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "sales_invoices_originalInvoiceId_idx" ON "sales_invoices"("originalInvoiceId");
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_originalInvoiceId_fkey"
  FOREIGN KEY ("originalInvoiceId") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_invoice_lines"
  ADD COLUMN IF NOT EXISTS "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discountAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "returnedQuantity" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "originalLineId" UUID;

ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_originalLineId_fkey"
  FOREIGN KEY ("originalLineId") REFERENCES "sales_invoice_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_invoices"
  ADD COLUMN IF NOT EXISTS "documentType" "InvoiceDocumentType" NOT NULL DEFAULT 'INVOICE',
  ADD COLUMN IF NOT EXISTS "originalInvoiceId" UUID,
  ADD COLUMN IF NOT EXISTS "returnReason" TEXT,
  ADD COLUMN IF NOT EXISTS "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discountAmount" DECIMAL(19,4) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "purchase_invoices_originalInvoiceId_idx" ON "purchase_invoices"("originalInvoiceId");
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_originalInvoiceId_fkey"
  FOREIGN KEY ("originalInvoiceId") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_invoice_lines"
  ADD COLUMN IF NOT EXISTS "discountPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discountAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "returnedQuantity" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "originalLineId" UUID;

ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "purchase_invoice_lines_originalLineId_fkey"
  FOREIGN KEY ("originalLineId") REFERENCES "purchase_invoice_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Who submitted, approved or cancelled a journal entry. Existing entries are
-- already posted or reversed and keep NULL here, which reads as "posted before
-- the workflow existed".
ALTER TABLE "journal_entries"
  ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "submittedBy" UUID,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedBy" UUID,
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelledBy" UUID,
  ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;

-- ──────────────────────────────────── the audit trail is append-only

-- The audit trail is the one table whose value depends on nobody being able to
-- rewrite it. Application code already only inserts; this makes the database
-- itself refuse an update, and refuse a delete unless the session has
-- explicitly announced that it is an audited purge (the "reset company data"
-- operation, which takes a backup first and needs a permission of its own).
CREATE OR REPLACE FUNCTION kayan_audit_logs_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_logs is append-only: rows cannot be updated'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE'
     AND coalesce(current_setting('kayan.allow_audit_purge', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'audit_logs is append-only: deleting requires an audited purge session'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_append_only ON "audit_logs";
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION kayan_audit_logs_append_only();

-- ───────────────────────────────── company settings for existing companies

-- A company that already exists gets its settings row with the same defaults a
-- new company gets, so the program never has to cope with a missing row.
INSERT INTO "company_settings" ("companyId", "updatedAt")
SELECT "id", now() FROM "companies"
ON CONFLICT ("companyId") DO NOTHING;
