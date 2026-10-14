-- The document behind a journal entry.
--
-- Until now the link only ran one way: a document kept the id of its entry, so
-- you could go from the invoice to the ledger but not from a ledger line back
-- to the document that caused it. These columns close the loop, and they are
-- what a drill-down in a report reads.
--
-- Additive and nullable: entries that already exist (and manual entries, which
-- have no document behind them) simply have no source.
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "sourceType" VARCHAR(32);
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "sourceId" UUID;
ALTER TABLE "journal_entries" ADD COLUMN IF NOT EXISTS "sourceNumber" VARCHAR(64);

CREATE INDEX IF NOT EXISTS "journal_entries_sourceType_sourceId_idx"
  ON "journal_entries" ("sourceType", "sourceId");
