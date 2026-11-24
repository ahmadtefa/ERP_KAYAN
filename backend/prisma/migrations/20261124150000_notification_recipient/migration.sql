-- A decision about somebody's request is that person's own news. The column
-- addresses one alert to one user; existing rows keep a null recipient and
-- stay permission/branch based.
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "recipientUserId" UUID;
CREATE INDEX IF NOT EXISTS "notifications_companyId_recipientUserId_status_idx"
  ON "notifications"("companyId", "recipientUserId", "status");
