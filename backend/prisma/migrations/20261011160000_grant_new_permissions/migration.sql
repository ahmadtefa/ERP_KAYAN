-- Grant the newer permissions to the roles that should hold them.
--
-- Databases that were seeded before these permissions existed never see the
-- seed again (it only runs on an empty database), so this migration brings
-- them up to date. It is purely additive and idempotent:
--
--   * permission rows are inserted only when their code is missing;
--   * role links are inserted only where the policy below says they belong
--     and never when the link already exists;
--   * nothing is deleted or replaced — existing grants all stay as they are.
--
-- Policy (deliberately narrow — nobody gains broad administration by
-- accident):
--
--   accounting.accounts.read                    → roles that can already read
--                                                 the ledger, the periods or
--                                                 the reports (they all need
--                                                 to see the chart);
--   accounting.accounts.create/update/delete    → roles that can already
--                                                 create journal entries (the
--                                                 people who keep the books);
--   admin.company.manage                        → roles that can already
--                                                 manage users (admin roles
--                                                 only — never regular users).
--
-- On a fresh database this runs before the seed creates any roles, so it
-- links nothing and the seed does the same job. On an existing database it
-- fills exactly the gaps.

-- 1) The permission catalogue rows, if absent.
INSERT INTO permissions (id, code, "nameEn", "nameAr", module)
VALUES
  (gen_random_uuid(), 'accounting.accounts.read',   'View chart of accounts',           'عرض دليل الحسابات',        'accounting'),
  (gen_random_uuid(), 'accounting.accounts.create', 'Add accounts to the chart',        'إضافة حسابات للدليل',      'accounting'),
  (gen_random_uuid(), 'accounting.accounts.update', 'Edit accounts',                    'تعديل الحسابات',            'accounting'),
  (gen_random_uuid(), 'accounting.accounts.delete', 'Delete accounts',                  'حذف الحسابات',              'accounting'),
  (gen_random_uuid(), 'admin.company.manage',       'Manage company profile and branches', 'إدارة بيانات الشركة والفروع', 'admin')
ON CONFLICT (code) DO NOTHING;

-- 2) Viewing the chart follows viewing the books.
INSERT INTO role_permissions ("roleId", "permissionId")
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'accounting.accounts.read'
WHERE r."deletedAt" IS NULL
  AND EXISTS (
    SELECT 1
    FROM role_permissions rp
    JOIN permissions pp ON pp.id = rp."permissionId"
    WHERE rp."roleId" = r.id
      AND pp.code IN ('accounting.journal.read', 'accounting.periods.read', 'reports.read')
  )
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 3) Maintaining the chart follows maintaining the ledger.
INSERT INTO role_permissions ("roleId", "permissionId")
SELECT r.id, p.id
FROM roles r
JOIN permissions p
  ON p.code IN ('accounting.accounts.create', 'accounting.accounts.update', 'accounting.accounts.delete')
WHERE r."deletedAt" IS NULL
  AND EXISTS (
    SELECT 1
    FROM role_permissions rp
    JOIN permissions pp ON pp.id = rp."permissionId"
    WHERE rp."roleId" = r.id
      AND pp.code = 'accounting.journal.create'
  )
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 4) Company administration follows user administration — admin roles only.
INSERT INTO role_permissions ("roleId", "permissionId")
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'admin.company.manage'
WHERE r."deletedAt" IS NULL
  AND EXISTS (
    SELECT 1
    FROM role_permissions rp
    JOIN permissions pp ON pp.id = rp."permissionId"
    WHERE rp."roleId" = r.id
      AND pp.code = 'admin.users.manage'
  )
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
