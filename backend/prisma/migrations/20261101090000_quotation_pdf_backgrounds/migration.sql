-- PDF artwork the company prints its offers on.
--
-- Additive only: a new table, and nullable columns on two existing ones. A
-- database that already holds quotations keeps every row byte for byte; a
-- quotation with no artwork keeps printing the drawn design exactly as it
-- does today (backgroundFileId NULL, background NULL).

CREATE TABLE IF NOT EXISTS "quotation_backgrounds" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "companyId" UUID NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" VARCHAR(160) NOT NULL,
  "mimeType" VARCHAR(64) NOT NULL DEFAULT 'application/pdf',
  "byteSize" INTEGER NOT NULL,
  "pageCount" INTEGER NOT NULL,
  "pageWidth" DOUBLE PRECISION NOT NULL,
  "pageHeight" DOUBLE PRECISION NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" UUID,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "quotation_backgrounds_page_count_check" CHECK ("pageCount" >= 1),
  CONSTRAINT "quotation_backgrounds_byte_size_check" CHECK ("byteSize" > 0)
);

CREATE INDEX IF NOT EXISTS "quotation_backgrounds_company_idx"
  ON "quotation_backgrounds" ("companyId")
  WHERE "deletedAt" IS NULL;

-- A design template can name the artwork it prints on, and how the artwork's
-- pages are used (repeat / sequence / one chosen page, fit rule, page numbers).
-- NULL means the drawn design, which is what every existing template keeps.
ALTER TABLE "quotation_design_templates"
  ADD COLUMN IF NOT EXISTS "backgroundId" UUID
    REFERENCES "quotation_backgrounds"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "background" JSONB;

-- The offer itself: the file, so a reprint uses the artwork the offer was
-- bound to, and the settings that were in force when it was issued.
ALTER TABLE "quotations"
  ADD COLUMN IF NOT EXISTS "backgroundFileId" UUID
    REFERENCES "quotation_backgrounds"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "background" JSONB;

CREATE INDEX IF NOT EXISTS "quotations_background_file_idx"
  ON "quotations" ("backgroundFileId")
  WHERE "backgroundFileId" IS NOT NULL;
