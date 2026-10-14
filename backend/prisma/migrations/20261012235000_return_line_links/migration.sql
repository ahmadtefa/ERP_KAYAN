-- A return has to name the exact invoice line it gives back, not just the
-- invoice: two lines of the same invoice can carry different prices and
-- different costs, and returning "2 of something" against the wrong line would
-- move the wrong amount of money and the wrong amount of stock.
--
-- The column is therefore added to both invoice-line tables, with a foreign
-- key back to the line it returns. It is nullable because the line of an
-- ordinary invoice has no original: only a return names one.
--
-- Idempotent, and additive: an existing invoice keeps every line it already
-- has, with a null link, which reads as "this line was not returned by
-- anything" - which is true.

ALTER TABLE "sales_invoice_lines"
  ADD COLUMN IF NOT EXISTS "originalLineId" UUID;

ALTER TABLE "purchase_invoice_lines"
  ADD COLUMN IF NOT EXISTS "originalLineId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_invoice_lines_originalLineId_fkey'
  ) THEN
    ALTER TABLE "sales_invoice_lines"
      ADD CONSTRAINT "sales_invoice_lines_originalLineId_fkey"
      FOREIGN KEY ("originalLineId") REFERENCES "sales_invoice_lines"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_invoice_lines_originalLineId_fkey'
  ) THEN
    ALTER TABLE "purchase_invoice_lines"
      ADD CONSTRAINT "purchase_invoice_lines_originalLineId_fkey"
      FOREIGN KEY ("originalLineId") REFERENCES "purchase_invoice_lines"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "sales_invoice_lines_originalLineId_idx"
  ON "sales_invoice_lines" ("originalLineId");

CREATE INDEX IF NOT EXISTS "purchase_invoice_lines_originalLineId_idx"
  ON "purchase_invoice_lines" ("originalLineId");

-- The same columns also exist in the migration that introduced the returns
-- module; that one was written for fresh databases. This one brings databases
-- that were already running up to the same shape, and running both in either
-- order leaves the same schema.
