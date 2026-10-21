-- A committed workbook may be retried after a lost response. Keep its SHA-256
-- fingerprint on the resulting document and enforce company-scoped uniqueness.
ALTER TABLE "opening_balances"
  ADD COLUMN IF NOT EXISTS "importFingerprint" VARCHAR(64);

CREATE UNIQUE INDEX IF NOT EXISTS "opening_balances_companyId_importFingerprint_key"
  ON "opening_balances" ("companyId", "importFingerprint");
