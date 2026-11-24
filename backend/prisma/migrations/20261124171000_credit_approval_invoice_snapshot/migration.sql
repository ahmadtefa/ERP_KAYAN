-- An approval is valid only for the exact draft it was given for: the invoice
-- row must not have been edited since (editing and editing back does not revive it).
ALTER TABLE "sales_invoice_credit_approvals" ADD COLUMN IF NOT EXISTS "invoiceUpdatedAt" timestamp(3);
ALTER TABLE "sales_invoice_credit_approvals" ADD COLUMN IF NOT EXISTS "paidAmount" numeric(19,4);
