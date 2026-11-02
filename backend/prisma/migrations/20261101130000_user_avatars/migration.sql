-- A photo per user account.
--
-- Purely additive: three nullable columns on `users`. Every existing account
-- keeps working and shows the initial-letter placeholder until someone uploads
-- a picture, so this migration cannot fail on a populated installation and
-- cannot change any existing behaviour.
--
-- Why bytes in the row rather than a file path:
--   * the product's backup and restore (full dump, company JSON, the copy
--     restored on another machine) carry the tables - a file outside them
--     would silently not be restored, and the person would lose their photo
--     on the very operation meant to be lossless;
--   * the installation is often offline with no shared storage;
--   * a `bytea` column is not base64: it costs 1 byte per byte, is streamed
--     back as image/* with no decode step, and is bounded by the check below.
--
-- The size and type are enforced by the API (PNG/JPEG/WebP, magic-number
-- checked, bounded); the column just stores what the API accepted.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "avatarData"      bytea,
  ADD COLUMN IF NOT EXISTS "avatarMime"      varchar(40),
  ADD COLUMN IF NOT EXISTS "avatarUpdatedAt" timestamp(3);

COMMENT ON COLUMN "users"."avatarData" IS
  'The user''s photo bytes. Null means "no photo" - the client draws the initial instead.';
COMMENT ON COLUMN "users"."avatarMime" IS
  'image/png, image/jpeg or image/webp, decided from the file content when it was uploaded.';

-- The user list asks each row whether it has a photo; that expression is
-- computed from this column for every row of every list. A partial index keeps
-- the "who has no photo" scan cheap without storing the images twice.
CREATE INDEX IF NOT EXISTS "users_avatar_present_idx"
  ON "users" ("companyId")
  WHERE "avatarData" IS NOT NULL;
