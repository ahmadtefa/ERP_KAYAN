-- Quotation tax (VAT).
--
-- Additive only: both new columns carry a default of zero, so every existing
-- quotation keeps printing exactly as it did (taxRate 0%, taxAmount 0).
-- Newly prepared quotations store the company's tax rate in force at that
-- moment and the VAT computed once on the discounted net value.
ALTER TABLE "quotations" ADD COLUMN "taxRate" DECIMAL(9,4) NOT NULL DEFAULT 0;
ALTER TABLE "quotations" ADD COLUMN "taxAmount" DECIMAL(19,4) NOT NULL DEFAULT 0;
