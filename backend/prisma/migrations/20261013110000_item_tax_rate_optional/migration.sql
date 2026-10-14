-- An item's VAT rate becomes optional, so that "not set" can mean "whatever
-- the company charges" instead of being indistinguishable from "exempt".
--
-- Existing rows keep the value they already have: an item that was taxed at 0
-- stays excluded from VAT, which is what its invoices said.
ALTER TABLE "items" ALTER COLUMN "taxRate" DROP DEFAULT;
ALTER TABLE "items" ALTER COLUMN "taxRate" DROP NOT NULL;
