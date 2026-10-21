CREATE TABLE IF NOT EXISTS quotation_design_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL REFERENCES "companies"(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  design JSONB NOT NULL DEFAULT '{}'::jsonb,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" UUID,
  "updatedBy" UUID,
  "deletedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS quotation_design_templates_company_name_active_key
  ON quotation_design_templates ("companyId", lower(name))
  WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS quotation_design_templates_company_active_idx
  ON quotation_design_templates ("companyId", "isActive")
  WHERE "deletedAt" IS NULL;
