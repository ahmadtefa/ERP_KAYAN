-- A purchase invoice raised by a supplier in a foreign currency. Like a sales invoice, the
-- invoice itself (lines, totals, ledger, payables ageing, VAT) stays in the company currency,
-- converted once at the rate saved here. This table keeps the foreign figures the supplier
-- billed and how much of them has been paid, so a later payment can settle the foreign amount.
CREATE TABLE purchase_invoice_fx (
  "invoiceId" uuid PRIMARY KEY REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  rate numeric(19,8) NOT NULL CHECK (rate > 0),
  "rateSource" varchar(10) NOT NULL CHECK ("rateSource" IN ('TYPED','TABLE')),
  "foreignSubTotal" numeric(19,4) NOT NULL,
  "foreignTaxAmount" numeric(19,4) NOT NULL,
  "foreignTotal" numeric(19,4) NOT NULL,
  "foreignPaid" numeric(19,4) NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_invoice_fx_company_idx ON purchase_invoice_fx ("companyId");
