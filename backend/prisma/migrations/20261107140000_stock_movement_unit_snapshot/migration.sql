-- Stock movements: the unit the goods were actually entered in, the quantity
-- typed in that unit, and the frozen conversion factor.
--
-- The three columns have existed on `Item`-related line tables since
-- 20261027130000_item_multiple_units -- sales invoice lines, purchase invoice
-- lines, stock document lines -- and Prisma's StockMovement model has carried
-- them since the same feature. They were never added to `stock_movements`
-- itself, so a database built from these migrations alone is missing them.
--
-- The result was not a cosmetic drift. `BatchesService.issueTx` writes the
-- snapshot onto every movement when the caller supplies `movementUnits`, and
-- `SalesInvoicesService.post` supplies it whenever a line carries a non-base
-- unit. Selling "1 carton of 500" therefore failed at posting with
-- P2022 "The column `enteredUnit` does not exist in the current database",
-- on a schema created by the project's own migration files. A shop that only
-- ever sold in base units would never have seen it.
--
-- Nullable, like every other table's copy: rows written before multi-unit
-- existed have no unit to record, and a movement in the item's base unit has
-- nothing extra to say. `quantity` stays the internal base-unit quantity the
-- ledger moves, so no existing row changes meaning.
ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "enteredUnit" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "enteredQuantity" DECIMAL(19, 4),
  ADD COLUMN IF NOT EXISTS "unitFactor" DECIMAL(19, 6);
