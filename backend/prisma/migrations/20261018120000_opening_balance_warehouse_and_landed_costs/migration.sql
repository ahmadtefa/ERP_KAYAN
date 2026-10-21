-- Warehouses and correct landed-cost valuation for inventory.
-- Additive migration: existing purchase lines retain their historical cost,
-- and existing opening documents are assigned to the branch's current default
-- warehouse so reversals and warehouse reports use the same physical location.

ALTER TABLE "opening_balances" ADD COLUMN IF NOT EXISTS "warehouseId" UUID;
UPDATE "opening_balances" o
   SET "warehouseId" = w.id
  FROM "warehouses" w
 WHERE o."warehouseId" IS NULL
   AND w."branchId" = o."branchId"
   AND w."companyId" = o."companyId"
   AND w."isDefault" = true
   AND w."deletedAt" IS NULL;
ALTER TABLE "opening_balances" DROP CONSTRAINT IF EXISTS "opening_balances_warehouseId_fkey";
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "opening_balances_warehouseId_idx" ON "opening_balances"("warehouseId");

ALTER TABLE "purchase_invoices"
  ADD COLUMN IF NOT EXISTS "landedCostAmount" DECIMAL(19,4) NOT NULL DEFAULT 0;
ALTER TABLE "purchase_invoice_lines"
  ADD COLUMN IF NOT EXISTS "landedCostAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "inventoryCostTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "returnedCostTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "returnedTaxTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "returnedSubTotal" DECIMAL(19,4) NOT NULL DEFAULT 0;
ALTER TABLE "sales_invoice_lines"
  ADD COLUMN IF NOT EXISTS "returnedCostTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "returnedTaxTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "returnedSubTotal" DECIMAL(19,4) NOT NULL DEFAULT 0;

-- Before landed costs existed, the line total was the full inventory value.
-- Preserve that cost for existing and restored historical purchase invoices.
UPDATE "purchase_invoice_lines"
   SET "inventoryCostTotal" = "lineTotal"
 WHERE "inventoryCostTotal" = 0
   AND "lineTotal" <> 0;

-- Rebuild return accumulators for installations that already have posted
-- credit/debit notes. Reversed notes no longer reserve quantities or value.
UPDATE "sales_invoice_lines" original
   SET "returnedSubTotal" = COALESCE((
         SELECT SUM(return_line."lineTotal")
           FROM "sales_invoice_lines" return_line
           JOIN "sales_invoices" document ON document.id = return_line."invoiceId"
          WHERE return_line."originalLineId" = original.id
            AND document.status = 'POSTED'
            AND document."documentType" = 'CREDIT_NOTE'
       ), 0),
       "returnedCostTotal" = COALESCE((
         SELECT SUM(return_line."costTotal")
           FROM "sales_invoice_lines" return_line
           JOIN "sales_invoices" document ON document.id = return_line."invoiceId"
          WHERE return_line."originalLineId" = original.id
            AND document.status = 'POSTED'
            AND document."documentType" = 'CREDIT_NOTE'
       ), 0),
       "returnedTaxTotal" = COALESCE((
         SELECT SUM(return_line."taxAmount")
           FROM "sales_invoice_lines" return_line
           JOIN "sales_invoices" document ON document.id = return_line."invoiceId"
          WHERE return_line."originalLineId" = original.id
            AND document.status = 'POSTED'
            AND document."documentType" = 'CREDIT_NOTE'
       ), 0)
 WHERE EXISTS (
         SELECT 1 FROM "sales_invoice_lines" return_line
         JOIN "sales_invoices" document ON document.id = return_line."invoiceId"
         WHERE return_line."originalLineId" = original.id
           AND document.status = 'POSTED'
           AND document."documentType" = 'CREDIT_NOTE'
       );

UPDATE "purchase_invoice_lines" original
   SET "returnedSubTotal" = COALESCE((
         SELECT SUM(return_line."lineTotal")
           FROM "purchase_invoice_lines" return_line
           JOIN "purchase_invoices" document ON document.id = return_line."invoiceId"
          WHERE return_line."originalLineId" = original.id
            AND document.status = 'POSTED'
            AND document."documentType" = 'DEBIT_NOTE'
       ), 0),
       "returnedCostTotal" = COALESCE((
         SELECT SUM(CASE WHEN return_line."inventoryCostTotal" <> 0
                         THEN return_line."inventoryCostTotal"
                         ELSE return_line."unitPrice" * return_line.quantity END)
           FROM "purchase_invoice_lines" return_line
           JOIN "purchase_invoices" document ON document.id = return_line."invoiceId"
          WHERE return_line."originalLineId" = original.id
            AND document.status = 'POSTED'
            AND document."documentType" = 'DEBIT_NOTE'
       ), 0),
       "returnedTaxTotal" = COALESCE((
         SELECT SUM(return_line."taxAmount")
           FROM "purchase_invoice_lines" return_line
           JOIN "purchase_invoices" document ON document.id = return_line."invoiceId"
          WHERE return_line."originalLineId" = original.id
            AND document.status = 'POSTED'
            AND document."documentType" = 'DEBIT_NOTE'
       ), 0)
 WHERE EXISTS (
         SELECT 1 FROM "purchase_invoice_lines" return_line
         JOIN "purchase_invoices" document ON document.id = return_line."invoiceId"
         WHERE return_line."originalLineId" = original.id
           AND document.status = 'POSTED'
           AND document."documentType" = 'DEBIT_NOTE'
       );
