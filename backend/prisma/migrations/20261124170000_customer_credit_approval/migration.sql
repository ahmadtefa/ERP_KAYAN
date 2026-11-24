-- A sales invoice that would take a customer over their credit limit cannot be
-- posted until someone holding sales.credit.approve signs for that invoice.
-- The approval is bound to the invoice, the customer and the amount it was
-- given for: if the customer or the total changes, it no longer matches.
CREATE TABLE IF NOT EXISTS "sales_invoice_credit_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" uuid NOT NULL REFERENCES "companies"("id"),
  "invoiceId" uuid NOT NULL REFERENCES "sales_invoices"("id"),
  "customerId" uuid NOT NULL,
  "totalAmount" numeric(19,4) NOT NULL,
  "creditLimit" numeric(19,4) NOT NULL,
  "projectedBalance" numeric(19,4) NOT NULL,
  "reason" text NOT NULL,
  "approvedBy" uuid NOT NULL,
  "approvedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_invoice_credit_approvals_reason_check" CHECK (char_length(btrim("reason")) >= 3)
);
CREATE INDEX IF NOT EXISTS "sales_invoice_credit_approvals_invoice_idx"
  ON "sales_invoice_credit_approvals" ("companyId", "invoiceId");

-- Not granted to any role: an administrator assigns it explicitly.
INSERT INTO permissions (id, code, "nameEn", "nameAr", module)
VALUES (gen_random_uuid(), 'sales.credit.approve', 'Approve sales over a customer credit limit', 'الموافقة على البيع فوق حد ائتمان العميل', 'sales')
ON CONFLICT (code) DO NOTHING;
