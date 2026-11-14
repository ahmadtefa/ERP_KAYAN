-- Legacy stock documents keep their existing behavior. The review/approval
-- workflow applies only to explicitly marked receipt and issue vouchers.
ALTER TABLE "stock_documents"
  ADD COLUMN IF NOT EXISTS "voucherKind" VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "counterpartyName" VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewedBy" UUID,
  -- A write-off carries its own approval (added by
  -- 20261101190000_warehouse_average_stock_take_writeoffs), so the column may
  -- already be here; the voucher workflow shares it rather than duplicating it.
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvedBy" UUID;

-- The two checks are added separately so the file can be replayed: a second
-- run finds the constraint already guarding the table and leaves it alone.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_voucher_kind_check'
  ) THEN
    ALTER TABLE "stock_documents"
      ADD CONSTRAINT "stock_voucher_kind_check"
      CHECK ("voucherKind" IS NULL OR ("voucherKind" IN ('RECEIPT', 'ISSUE') AND kind = 'ADJUSTMENT' AND "counterpartyName" IS NOT NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_voucher_approval_check'
  ) THEN
    ALTER TABLE "stock_documents"
      ADD CONSTRAINT "stock_voucher_approval_check"
      CHECK ("approvedAt" IS NULL OR "reviewedAt" IS NOT NULL);
  END IF;
END $$;

-- Administrators explicitly assign these new permissions; no existing role is
-- silently granted review or approval authority.
INSERT INTO permissions (id, code, "nameEn", "nameAr", module)
VALUES (gen_random_uuid(), 'inventory.stock.review', 'Review stock vouchers', 'مراجعة أذون المخزون', 'inventory'),
       (gen_random_uuid(), 'inventory.stock.approve', 'Approve stock vouchers', 'اعتماد أذون المخزون', 'inventory')
ON CONFLICT (code) DO NOTHING;
