-- Each item may have one default sales unit and one default purchase unit.
-- Existing records retain their current behavior: their base unit is default.
ALTER TABLE "item_units"
  ADD COLUMN "isDefaultSale" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isDefaultPurchase" BOOLEAN NOT NULL DEFAULT false;

UPDATE "item_units" AS unit
SET "isDefaultSale" = true,
    "isDefaultPurchase" = true
FROM "items" AS item
WHERE item."id" = unit."itemId"
  AND item."unit" = unit."unit";

CREATE UNIQUE INDEX "item_units_one_default_sale_per_item"
  ON "item_units"("itemId") WHERE "isDefaultSale";
CREATE UNIQUE INDEX "item_units_one_default_purchase_per_item"
  ON "item_units"("itemId") WHERE "isDefaultPurchase";
