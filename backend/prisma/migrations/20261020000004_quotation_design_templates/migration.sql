-- Keep existing column templates valid while allowing the complete quotation design to be reused.
ALTER TABLE "quotation_column_templates"
  ADD COLUMN IF NOT EXISTS "design" JSONB NOT NULL DEFAULT '{}'::jsonb;
