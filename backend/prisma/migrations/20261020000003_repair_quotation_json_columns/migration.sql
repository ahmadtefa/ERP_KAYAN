-- Repair additive quotation JSON columns on databases where an earlier
-- migration was recorded as applied even though its SQL was stored as one
-- escaped line and therefore executed only as a comment. Safe for both fresh
-- installs and upgrades: existing values are preserved.
ALTER TABLE "quotation_lines"
  ADD COLUMN IF NOT EXISTS "customValues" JSON NOT NULL DEFAULT '{}';

ALTER TABLE "quotations"
  ADD COLUMN IF NOT EXISTS "design" JSON NOT NULL DEFAULT '{}';
