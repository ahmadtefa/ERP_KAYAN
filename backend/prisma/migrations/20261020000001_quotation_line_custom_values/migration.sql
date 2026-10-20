-- Quotation line custom column values.
--
-- Additive only: a single JSON column holds values for user-defined columns.
-- Existing lines keep printing exactly as before (empty custom values object).
ALTER TABLE "quotation_lines" ADD COLUMN "customValues" JSON NOT NULL DEFAULT '{}';
