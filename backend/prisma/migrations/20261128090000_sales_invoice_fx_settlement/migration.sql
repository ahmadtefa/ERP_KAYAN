-- Settling a foreign-currency sales invoice. The invoice keeps how much of its foreign total
-- has been paid, and each receipt allocation keeps what it settled in both currencies, so a
-- reversal gives back exactly what the receipt took and the exchange difference is traceable.
ALTER TABLE sales_invoice_fx ADD COLUMN "foreignPaid" numeric(19,4) NOT NULL DEFAULT 0 CHECK ("foreignPaid" >= 0);

CREATE TABLE voucher_allocation_fx (
  "allocationId" uuid PRIMARY KEY REFERENCES cash_voucher_allocations(id) ON DELETE CASCADE,
  "baseSettled" numeric(19,4) NOT NULL,
  "foreignSettled" numeric(19,4) NOT NULL,
  "exchangeDifference" numeric(19,4) NOT NULL
);
