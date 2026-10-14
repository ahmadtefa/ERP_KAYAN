-- Preserve the upstream legacy address field alongside localized address fields.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "address" TEXT;
