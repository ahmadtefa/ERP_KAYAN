-- Traceability from a fixed asset to the purchase-invoice line it was
-- capitalised from. Both columns are nullable and carry no foreign
-- key, like the existing supplier/purchase-invoice references: the
-- register must also hold assets bought before this system did, and a
-- historical document must never become undeletable because an asset
-- points at it. The no-double-capitalisation rule (cumulative cost
-- and quantity per line) is enforced in the service transaction.
ALTER TABLE "fixed_assets"
  ADD COLUMN "purchaseInvoiceLineId" UUID,
  ADD COLUMN "purchaseQuantity" DECIMAL(19,4);
