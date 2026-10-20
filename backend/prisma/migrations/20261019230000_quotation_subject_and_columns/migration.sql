-- Quotation subject, per-offer tax flag and configurable line columns.
--
-- Additive only: every new column is nullable or defaulted, so an upgrade
-- keeps every existing offer printing exactly as it did. A quotation with
-- `columns` NULL falls back to the standard seven-column layout, and
-- `showTaxId` keeps the value it already had.

ALTER TABLE "quotations" ADD COLUMN "subject" VARCHAR(200);
ALTER TABLE "quotations" ADD COLUMN "columns" JSONB;

CREATE TABLE "quotation_column_templates" (
  "id"        UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "name"      VARCHAR(120) NOT NULL,
  "columns"   JSONB NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdBy" UUID,
  "updatedBy" UUID,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "quotation_column_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quotation_column_templates_companyId_name_key"
  ON "quotation_column_templates"("companyId", "name");
CREATE INDEX "quotation_column_templates_companyId_isActive_idx"
  ON "quotation_column_templates"("companyId", "isActive");

ALTER TABLE "quotation_column_templates"
  ADD CONSTRAINT "quotation_column_templates_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
