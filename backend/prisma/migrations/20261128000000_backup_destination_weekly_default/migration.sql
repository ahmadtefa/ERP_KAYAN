-- Automatic backups: a weekly schedule is the default for NEW installations.
-- Only the column default changes; no existing company_settings row is touched,
-- so an installation that already has a daily or custom schedule keeps it.
ALTER TABLE company_settings ALTER COLUMN "backupIntervalHours" SET DEFAULT 168;

-- Where scheduled backups are copied to, besides the program's own backup
-- folder. One row per company; the path is chosen by an administrator and
-- checked by the server before it is saved.
CREATE TABLE backup_destinations (
  "companyId" uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  "path" text,
  "startHour" smallint NOT NULL DEFAULT 2 CHECK ("startHour" BETWEEN 0 AND 23),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "updatedBy" uuid
);
