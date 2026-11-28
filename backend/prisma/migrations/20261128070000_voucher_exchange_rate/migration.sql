-- A voucher on a foreign-currency cash or bank account keeps the rate it was booked at.
-- The ledger stores company-currency amounts; the voucher keeps its own foreign amount.
CREATE TABLE voucher_exchange_rates (
  "voucherId" uuid PRIMARY KEY REFERENCES cash_vouchers(id) ON DELETE CASCADE,
  rate numeric(19,8) NOT NULL CHECK (rate > 0),
  "rateSource" varchar(10) NOT NULL CHECK ("rateSource" IN ('TYPED','TABLE')),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
