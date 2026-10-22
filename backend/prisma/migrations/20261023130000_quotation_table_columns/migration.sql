-- Per-table quotation column layouts.
--
-- Until now one layout (quotations."columns") governed every table in an
-- offer, so two sections could not show different columns. Each table now
-- carries its own optional layout; NULL keeps meaning "use the
-- quotation-level layout", so existing offers print byte-for-byte what
-- they printed before.
--
-- The backfill copies the quotation-level layout into its tables. That is
-- a behaviour-preserving denormalisation: after it runs, the editor can
-- hand each table the layout it already printed with, and changing one
-- table's columns can no longer disturb the others. The quotation-level
-- column itself is kept (legacy default + snapshot fallback), never
-- dropped here.
--
-- Idempotent: the ADD COLUMN is guarded and the backfill only touches
-- rows that still have no layout of their own.

ALTER TABLE "quotation_tables"
  ADD COLUMN IF NOT EXISTS "columns" JSONB;

UPDATE "quotation_tables" t
   SET "columns" = q."columns"
  FROM "quotations" q
 WHERE t."quotationId" = q.id
   AND t."columns" IS NULL
   AND q."columns" IS NOT NULL;
