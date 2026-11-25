-- Backgrounds may now be uploaded as a picture as well as a PDF, and carry a
-- PNG preview for the in-app preview plus the artwork zones (as fractions of the
-- background page's height) and the page size, so the printed text can keep
-- clear of the artwork whichever way the background is fitted to A4.
-- Additive: nullable columns, older rows are filled on first use.
ALTER TABLE quotation_backgrounds ADD COLUMN IF NOT EXISTS preview BYTEA;
ALTER TABLE quotation_backgrounds ADD COLUMN IF NOT EXISTS kind VARCHAR(8) NOT NULL DEFAULT 'pdf';
ALTER TABLE quotation_backgrounds ADD COLUMN IF NOT EXISTS "pageCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE quotation_backgrounds ADD COLUMN IF NOT EXISTS "topFraction" DOUBLE PRECISION;
ALTER TABLE quotation_backgrounds ADD COLUMN IF NOT EXISTS "bottomFraction" DOUBLE PRECISION;
ALTER TABLE quotation_backgrounds ADD COLUMN IF NOT EXISTS "widthPt" DOUBLE PRECISION;
ALTER TABLE quotation_backgrounds ADD COLUMN IF NOT EXISTS "heightPt" DOUBLE PRECISION;
