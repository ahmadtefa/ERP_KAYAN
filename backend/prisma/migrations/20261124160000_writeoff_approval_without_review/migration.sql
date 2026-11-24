-- A write-off is approved by a second person without a review step. The
-- review-before-approval rule belongs to stock vouchers only.
ALTER TABLE "stock_documents" DROP CONSTRAINT IF EXISTS "stock_voucher_approval_check";
ALTER TABLE "stock_documents"
  ADD CONSTRAINT "stock_voucher_approval_check"
  CHECK ("voucherKind" IS NULL OR "approvedAt" IS NULL OR "reviewedAt" IS NOT NULL);
