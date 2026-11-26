-- Customer payment terms: twelve ways to count the days. Existing customers
-- keep behaving exactly as before: FROM_INVOICE_DATE plus their days.
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "paymentTermMethod" varchar(30) NOT NULL DEFAULT 'FROM_INVOICE_DATE',
  ADD COLUMN IF NOT EXISTS "paymentTermConfig" jsonb;
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_payment_term_method_check" CHECK ("paymentTermMethod" IN (
    'FROM_INVOICE_DATE','FROM_MONTH_END','FROM_NEXT_MONTH_START','FROM_DELIVERY_DATE',
    'FIXED_DAY_NEXT_MONTH','EARLY_DISCOUNT','COD_ADVANCE','INSTALLMENTS','DAY_WINDOWS',
    'MILESTONES','LATE_PENALTY','WEEKLY_CUTOFF'));

ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "lastPaymentTermMethod" varchar(30);

ALTER TABLE "sales_invoices"
  ADD COLUMN IF NOT EXISTS "deliveryDate" date,
  ADD COLUMN IF NOT EXISTS "dueSchedule" jsonb;

-- An invoice for a customer who has overdue invoices cannot be posted until
-- someone holding sales.credit.approve signs for that invoice. Bound to the
-- invoice and to the overdue amount it was given for.
CREATE TABLE IF NOT EXISTS "sales_invoice_term_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" uuid NOT NULL REFERENCES "companies"("id"),
  "invoiceId" uuid NOT NULL REFERENCES "sales_invoices"("id"),
  "customerId" uuid NOT NULL,
  "invoiceUpdatedAt" timestamp(3) NOT NULL,
  "overdueAmount" numeric(19,4) NOT NULL,
  "reason" text NOT NULL,
  "approvedBy" uuid NOT NULL,
  "approvedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sales_invoice_term_approvals_reason_check" CHECK (char_length(btrim("reason")) >= 3)
);
CREATE INDEX IF NOT EXISTS "sales_invoice_term_approvals_invoice_idx"
  ON "sales_invoice_term_approvals" ("companyId", "invoiceId");
