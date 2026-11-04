-- Legacy stock documents keep their existing behavior. The review/approval
-- workflow applies only to explicitly marked receipt and issue vouchers.
ALTER TABLE "stock_documents"
  ADD COLUMN "voucherKind" VARCHAR(10),
  ADD COLUMN "counterpartyName" VARCHAR(200),
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedBy" UUID,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedBy" UUID,
  ADD CONSTRAINT "stock_voucher_kind_check" CHECK ("voucherKind" IS NULL OR ("voucherKind" IN ('RECEIPT', 'ISSUE') AND kind = 'ADJUSTMENT' AND "counterpartyName" IS NOT NULL)),
  ADD CONSTRAINT "stock_voucher_approval_check" CHECK ("approvedAt" IS NULL OR "reviewedAt" IS NOT NULL);

-- Administrators explicitly assign these new permissions; no existing role is
-- silently granted review or approval authority.
INSERT INTO permissions (id, code, "nameEn", "nameAr", module)
VALUES (gen_random_uuid(), 'inventory.stock.review', 'Review stock vouchers', 'مراجعة أذون المخزون', 'inventory'),
       (gen_random_uuid(), 'inventory.stock.approve', 'Approve stock vouchers', 'اعتماد أذون المخزون', 'inventory')
ON CONFLICT (code) DO NOTHING;
