-- The per-person read state could never be written or read on real PostgreSQL.
--
-- `20261120090000_notification_user_state` created the columns as
-- `notification_id`, `user_id`, `read_at`, `dismissed_at`, `created_at`, but
-- the Prisma model declares them without `@map`, so Prisma addresses them as
-- `notificationId`, `userId`, `readAt`, `dismissedAt`, `createdAt` — which is
-- also how every other table in this schema is laid out. The result was a
-- P2022 "column does not exist" the moment the alert centre asked for a
-- person's read state, so the whole centre answered 500:
--
--   * nobody could open the notification list at all;
--   * the badge count failed with it;
--   * the transfer alerts that were raised correctly could not be shown.
--
-- The unit and integration suites did not catch it because they run against a
-- PGlite adapter that resolves field names itself; only a real server shows
-- the difference.
--
-- Renaming preserves the rows, including the backfilled read states, so this
-- is a repair rather than a rebuild. Guarded so it is safe on a database that
-- has already been corrected by hand.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notification_user_states' AND column_name = 'notification_id'
  ) THEN
    ALTER TABLE "notification_user_states" RENAME COLUMN "notification_id" TO "notificationId";
    ALTER TABLE "notification_user_states" RENAME COLUMN "user_id" TO "userId";
    ALTER TABLE "notification_user_states" RENAME COLUMN "read_at" TO "readAt";
    ALTER TABLE "notification_user_states" RENAME COLUMN "dismissed_at" TO "dismissedAt";
    ALTER TABLE "notification_user_states" RENAME COLUMN "created_at" TO "createdAt";
  END IF;
END $$;

-- The index names followed the old spelling; rename them to match the columns
-- so a later `prisma migrate diff` does not try to drop and recreate them.
ALTER INDEX IF EXISTS "notification_user_states_notification_id_user_id_key"
  RENAME TO "notification_user_states_notificationId_userId_key";
ALTER INDEX IF EXISTS "notification_user_states_user_id_read_at_idx"
  RENAME TO "notification_user_states_userId_readAt_idx";
ALTER INDEX IF EXISTS "notification_user_states_user_id_dismissed_at_idx"
  RENAME TO "notification_user_states_userId_dismissedAt_idx";
