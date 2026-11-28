-- A sales invoice raised in a foreign currency. The invoice itself (lines, totals, ledger,
-- statements, ageing, VAT) stays in the company currency, converted once at the rate saved
-- here. This table keeps the foreign figures the customer was quoted, so a later receipt
-- can settle the foreign amount and the exchange difference can be worked out.
CREATE TABLE sales_invoice_fx (
  "invoiceId" uuid PRIMARY KEY REFERENCES sales_invoices(id) ON DELETE CASCADE,
  "companyId" uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  rate numeric(19,8) NOT NULL CHECK (rate > 0),
  "rateSource" varchar(10) NOT NULL CHECK ("rateSource" IN ('TYPED','TABLE')),
  "foreignSubTotal" numeric(19,4) NOT NULL,
  "foreignTaxAmount" numeric(19,4) NOT NULL,
  "foreignTotal" numeric(19,4) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_invoice_fx_company_idx ON sales_invoice_fx ("companyId");
