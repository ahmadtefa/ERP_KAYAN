-- One count row per session, item, lot and shelf. The unlocated bucket (null
-- shelf) and no-lot rows are keyed with the nil UUID so they stay unique too.
--
-- Preflight: nothing is deleted or merged here. If an old count already holds
-- two rows for the same session, item, lot and shelf, the migration stops with
-- the offending sessions named, so an administrator can review them first.
DO $$
DECLARE
  dup_count integer;
  dup_sample text;
BEGIN
  SELECT count(*), string_agg(s."code" || ' (item ' || d."itemId"::text || ')', ', ')
    INTO dup_count, dup_sample
    FROM (
      SELECT "sessionId", "itemId",
             COALESCE("batchId", '00000000-0000-0000-0000-000000000000'::uuid) AS b,
             COALESCE("storageLocationId", '00000000-0000-0000-0000-000000000000'::uuid) AS l
        FROM "stock_take_lines"
       GROUP BY 1, 2, 3, 4
      HAVING count(*) > 1
    ) d
    JOIN "stock_take_sessions" s ON s."id" = d."sessionId";
  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'stock_take_lines has % duplicated (session, item, lot, shelf) group(s), e.g. %. No data was changed. Review these counts with the administrator (keep one row per group, with its counted quantity checked by hand) and then re-run this migration.',
      dup_count, left(dup_sample, 400);
  END IF;
END $$;

CREATE UNIQUE INDEX "stock_take_lines_session_item_lot_shelf_key"
  ON "stock_take_lines" ("sessionId", "itemId",
    COALESCE("batchId", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("storageLocationId", '00000000-0000-0000-0000-000000000000'::uuid));
