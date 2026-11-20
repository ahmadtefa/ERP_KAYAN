-- Per-person read and dismissal state for notifications.
--
-- Reading an alert and deleting it are personal acts. The old model kept one
-- shared `status`/`readAt` per row, so one person's read silenced the badge
-- for every colleague, and "deleted" had to mean destroying the shared event.
-- This table keeps the event untouched and records only what each person has
-- read and dismissed.

CREATE TABLE "notification_user_states" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_user_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_user_states_notification_id_user_id_key"
    ON "notification_user_states"("notification_id", "user_id");
CREATE INDEX "notification_user_states_user_id_read_at_idx"
    ON "notification_user_states"("user_id", "read_at");
CREATE INDEX "notification_user_states_user_id_dismissed_at_idx"
    ON "notification_user_states"("user_id", "dismissed_at");

ALTER TABLE "notification_user_states"
    ADD CONSTRAINT "notification_user_states_notification_id_fkey"
    FOREIGN KEY ("notification_id") REFERENCES "notifications"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: the legacy shared `readAt` meant "read in this company". Every
-- person in that company therefore starts with that same read state, so the
-- upgrade does not resurrect alerts people had already read.
INSERT INTO "notification_user_states"
    ("id", "notification_id", "user_id", "read_at", "dismissed_at", "created_at")
SELECT gen_random_uuid(), n."id", u."id", n."readAt", NULL, NOW()
FROM "notifications" n
JOIN "users" u ON u."companyId" = n."companyId"
WHERE n."readAt" IS NOT NULL;
