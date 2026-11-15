-- Store optional per-table column layouts without changing existing quotation data.
ALTER TABLE "quotation_tables"
  ADD COLUMN IF NOT EXISTS "columns" JSONB;
