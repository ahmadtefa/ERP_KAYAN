-- Unit precision, unit usage and the entered-unit snapshot on stock movements.
--
-- Three additions, all additive and all with a default that keeps every row
-- written before this migration behaving exactly as it did:
--
--   1. item_units gains the fields a real unit needs beside its factor:
--      an abbreviation for printed documents, whether the unit accepts a
--      fractional quantity, and whether it may be used on sales and on
--      purchases. Defaults say "yes" to everything, because every unit that
--      already exists was used freely.
--
--   2. stock_movements gains the snapshot of what the person typed: the unit
--      label, the quantity in that unit and the factor applied at the time.
--      Until now the movement recorded only the base quantity, so a movement
--      could not say whether 500 metres arrived as one reel or as five hundred
--      single metres. The factor is frozen here for the same reason it is
--      frozen on the document line: changing a unit's definition later must
--      never restate a movement that already happened.
--
-- Neither change rewrites a quantity. Legacy movements keep a null snapshot,
-- which the readers treat as "the base unit, quantity as recorded".

ALTER TABLE "item_units"
  ADD COLUMN IF NOT EXISTS "abbreviation"     varchar(20),
  ADD COLUMN IF NOT EXISTS "allowFraction"    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "usedInSales"      boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "usedInPurchases"  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "sortOrder"        integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN "item_units"."allowFraction" IS
  'Whether a quantity may be fractional in this unit (0.5 reel). False means whole units only.';
COMMENT ON COLUMN "item_units"."usedInSales" IS
  'Whether the unit may be chosen on a sales document.';
COMMENT ON COLUMN "item_units"."usedInPurchases" IS
  'Whether the unit may be chosen on a purchase document.';

ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "enteredUnit"      varchar(40),
  ADD COLUMN IF NOT EXISTS "enteredQuantity"  numeric(19, 4),
  ADD COLUMN IF NOT EXISTS "unitFactor"       numeric(19, 6);

COMMENT ON COLUMN "stock_movements"."enteredUnit" IS
  'The unit the person typed the movement in. Null on movements recorded before units were snapshotted; those are base-unit movements.';
COMMENT ON COLUMN "stock_movements"."enteredQuantity" IS
  'The quantity in enteredUnit. Base quantity = enteredQuantity x unitFactor.';
COMMENT ON COLUMN "stock_movements"."unitFactor" IS
  'The conversion factor frozen at the time of the movement, so a later change to the unit does not restate history.';

-- The balance reports show "9 reels + 400 metres" beside the base quantity, so
-- the units of an item are read for every row of the stock screen. This index
-- keeps that lookup cheap on a catalogue of thousands of items.
CREATE INDEX IF NOT EXISTS "item_units_itemId_sortOrder_idx"
  ON "item_units" ("itemId", "sortOrder", "factor");
