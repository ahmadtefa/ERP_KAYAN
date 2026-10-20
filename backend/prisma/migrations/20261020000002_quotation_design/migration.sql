-- Quotation document design.

-- Additive only: a single JSON column stores per-element styling (font
-- size, weight, color, alignment). Existing quotations keep printing with
-- the default design (empty object).
ALTER TABLE "quotations" ADD COLUMN "design" JSON NOT NULL DEFAULT '{}';
