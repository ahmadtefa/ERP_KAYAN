-- Extra permissions per user, on top of roles.
CREATE TABLE IF NOT EXISTS "user_permissions" (
    "userId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("userId", "permissionId")
);

ALTER TABLE "user_permissions"
  ADD CONSTRAINT "user_permissions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_permissions"
  ADD CONSTRAINT "user_permissions_permissionId_fkey"
  FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Catalogue rows are upserted by the seed. Insert any missing codes here so
-- a database that is only migrated still knows the new names.
INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
SELECT gen_random_uuid(), v.code, v.name_en, v.name_ar, v.module
FROM (VALUES
  ('reports.print', 'Print reports', 'طباعة التقارير', 'reports'),
  ('dashboard.view', 'View dashboard', 'عرض لوحة التحكم', 'dashboard'),
  ('dashboard.financial', 'View financial dashboard summaries', 'عرض ملخصات مالية في لوحة التحكم', 'dashboard'),
  ('sales.orders.read', 'View sales orders', 'عرض أوامر البيع', 'sales'),
  ('sales.orders.manage', 'Create and edit sales orders', 'إنشاء وتعديل أوامر البيع', 'sales'),
  ('sales.returns.read', 'View sales returns', 'عرض مردودات البيع', 'sales'),
  ('sales.returns.manage', 'Create sales returns', 'إنشاء مردودات البيع', 'sales'),
  ('sales.print', 'Print sales documents', 'طباعة مستندات البيع', 'sales'),
  ('purchases.orders.read', 'View purchase orders', 'عرض أوامر الشراء', 'purchases'),
  ('purchases.orders.manage', 'Create and edit purchase orders', 'إنشاء وتعديل أوامر الشراء', 'purchases'),
  ('purchases.returns.read', 'View purchase returns', 'عرض مردودات الشراء', 'purchases'),
  ('purchases.returns.manage', 'Create purchase returns', 'إنشاء مردودات الشراء', 'purchases'),
  ('purchases.print', 'Print purchase documents', 'طباعة مستندات الشراء', 'purchases'),
  ('cash.vouchers.export', 'Export receipts and payments', 'تصدير سندات القبض والصرف', 'cash'),
  ('cash.reports.read', 'View cash and bank reports', 'عرض تقارير الخزينة والبنوك', 'cash'),
  ('inventory.warehouses.read', 'View warehouses', 'عرض المخازن', 'inventory'),
  ('inventory.warehouses.manage', 'Manage warehouses', 'إدارة المخازن', 'inventory'),
  ('inventory.export', 'Export inventory lists and reports', 'تصدير قوائم وتقارير المخزون', 'inventory'),
  ('admin.backup.restore', 'Restore backups', 'استعادة النسخ الاحتياطية', 'admin'),
  ('admin.reset', 'Reset company data', 'تصفير بيانات الشركة', 'admin'),
  ('admin.users.password', 'Reset other users passwords', 'إعادة تعيين كلمات مرور المستخدمين', 'admin')
) AS v(code, name_en, name_ar, module)
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p.code = v.code);
