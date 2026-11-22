-- What a printed copy may show, per kind of print.
--
-- Additive only: a new table. No price, invoice or item row is touched - the
-- setting decides what is drawn on a copy on its way out, never what is
-- stored. A company with no rows prints exactly what it printed before.

CREATE TABLE IF NOT EXISTS "print_price_settings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "documentType" VARCHAR(48) NOT NULL,
  "showSalePrice" BOOLEAN NOT NULL DEFAULT TRUE,
  "showCost" BOOLEAN NOT NULL DEFAULT TRUE,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" UUID,
  CONSTRAINT "print_price_settings_company_document_key"
    UNIQUE ("companyId", "documentType")
);

CREATE INDEX IF NOT EXISTS "print_price_settings_company_idx"
  ON "print_price_settings" ("companyId");
