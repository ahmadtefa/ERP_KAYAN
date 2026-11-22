-- Add stage-level permissions without broadening the legacy stock-adjust grant.
INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module") VALUES
  (gen_random_uuid(), 'inventory.transfer.read', 'View staged stock transfers and transit balances', 'عرض التحويلات والأرصدة بالطريق', 'inventory'),
  (gen_random_uuid(), 'inventory.transfer.create', 'Request a stock transfer', 'طلب تحويل مخزني', 'inventory'),
  (gen_random_uuid(), 'inventory.transfer.review', 'Review or reject a stock transfer', 'مراجعة أو رفض التحويل المخزني', 'inventory'),
  (gen_random_uuid(), 'inventory.transfer.approve', 'Approve a stock transfer for dispatch', 'اعتماد التحويل للتسليم', 'inventory'),
  (gen_random_uuid(), 'inventory.transfer.dispatch', 'Dispatch approved goods into transit', 'تسليم البضاعة للطريق', 'inventory'),
  (gen_random_uuid(), 'inventory.transfer.receive', 'Receive dispatched transfer quantities', 'استلام كميات التحويل', 'inventory'),
  (gen_random_uuid(), 'inventory.transfer.settle', 'Settle stock transfer discrepancies', 'تسجيل تسوية فروق التحويل', 'inventory'),
  (gen_random_uuid(), 'inventory.transfer.settle.approve', 'Approve and post transfer write-offs', 'اعتماد وترحيل إعدام فروق التحويل', 'inventory'),
  (gen_random_uuid(), 'inventory.transfer.close', 'Close a fully reconciled stock transfer', 'إغلاق التحويل بعد التسوية', 'inventory'),
  (gen_random_uuid(), 'inventory.transfer.cancel', 'Cancel or reverse a stock transfer by stage', 'إلغاء أو عكس التحويل حسب مرحلته', 'inventory'),
  (gen_random_uuid(), 'inventory.transfer.report', 'View transfer, transit and discrepancy reports', 'عرض تقارير التحويلات والطريق والفروق', 'inventory')
ON CONFLICT ("code") DO NOTHING;

-- Storekeepers may create, move and receive goods, but reviews, approvals,
-- discrepancy settlements, cancellation and closure remain separate duties.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'inventory.transfer.read', 'inventory.transfer.create',
  'inventory.transfer.dispatch', 'inventory.transfer.receive'
)
WHERE r."code" = 'STOREKEEPER' AND r."deletedAt" IS NULL
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
