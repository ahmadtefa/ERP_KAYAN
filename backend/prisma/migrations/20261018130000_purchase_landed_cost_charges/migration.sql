-- Preserve separately named freight, shipping, duty, and other charges on a
-- purchase invoice. The aggregate amount remains the accounting total; this
-- JSON array is the source-level breakdown used by edit, restore, and screens.
ALTER TABLE "purchase_invoices"
  ADD COLUMN IF NOT EXISTS "landedCostCharges" JSONB NOT NULL DEFAULT '[]'::jsonb;
