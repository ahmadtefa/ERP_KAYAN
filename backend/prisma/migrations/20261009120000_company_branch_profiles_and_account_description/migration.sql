-- Additive company profile fields and account description.
ALTER TABLE "companies"
  ADD COLUMN "commercialRegistration" TEXT,
  ADD COLUMN "addressEn" TEXT,
  ADD COLUMN "addressAr" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "logoPath" TEXT;

ALTER TABLE "accounts" ADD COLUMN "description" TEXT;

-- Introduce permissions into existing installations without changing existing roles.
INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
VALUES
  (gen_random_uuid(), 'company.profile.manage', 'Manage company profile', 'إدارة بيانات الشركة', 'admin'),
  (gen_random_uuid(), 'accounting.accounts.create', 'Create expense accounts', 'إنشاء حسابات مصروفات', 'accounting'),
  (gen_random_uuid(), 'accounting.accounts.update', 'Update expense accounts', 'تعديل حسابات المصروفات', 'accounting')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
  FROM "roles" r
  CROSS JOIN "permissions" p
 WHERE r."code" = 'ADMIN'
  AND p."code" IN ('company.profile.manage', 'accounting.accounts.create', 'accounting.accounts.update')
ON CONFLICT DO NOTHING;
