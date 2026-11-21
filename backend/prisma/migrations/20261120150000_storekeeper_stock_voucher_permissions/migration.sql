-- Let the dedicated Storekeeper role work with receipt/issue vouchers without
-- granting the broader stock-adjust permission (which also covers manual
-- adjustments, write-offs and transfers).
--
-- Additive and safe to rerun. This file is a local migration definition only;
-- it must not be applied to the production Supabase database without approval.
INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
VALUES
  (gen_random_uuid(), 'inventory.stock.voucher.create', 'Create and edit warehouse receipt/issue vouchers', 'إنشاء وتعديل أذون الإضافة والصرف', 'inventory'),
  (gen_random_uuid(), 'inventory.stock.voucher.post', 'Post and reverse approved warehouse vouchers', 'ترحيل وعكس أذون المخازن المعتمدة', 'inventory')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."code" IN (
  'inventory.stock.voucher.create',
  'inventory.stock.voucher.post',
  'accounting.costcenters.read'
)
WHERE r."code" = 'STOREKEEPER' AND r."deletedAt" IS NULL
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
