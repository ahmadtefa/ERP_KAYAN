-- One-page PDF backgrounds (letterheads) a quotation design can sit on.
-- Additive: a new table, nothing existing changes.
CREATE TABLE IF NOT EXISTS quotation_backgrounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL REFERENCES "companies"(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  pdf BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" UUID,
  "deletedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS quotation_backgrounds_company_idx
  ON quotation_backgrounds ("companyId") WHERE "deletedAt" IS NULL;
