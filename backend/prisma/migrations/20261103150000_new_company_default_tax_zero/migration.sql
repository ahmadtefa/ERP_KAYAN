-- Change only the default for new settings. Existing company rates and
-- historical document values must remain exactly as they are.
ALTER TABLE "company_settings" ALTER COLUMN "taxRate" SET DEFAULT 0;
