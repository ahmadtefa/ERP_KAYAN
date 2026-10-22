-- The quotation workflow distinguishes a draft from an offer that has actually
-- been sent. The first quotation migration created the status type before that
-- distinction existed; add the label here, in its own migration, because
-- PostgreSQL will not let a value added to an enum be used in the same
-- transaction. Existing rows keep their labels, and the legacy ISSUED label is
-- left in place so no stored document loses its status.
ALTER TYPE "QuotationStatus" ADD VALUE IF NOT EXISTS 'SENT';
