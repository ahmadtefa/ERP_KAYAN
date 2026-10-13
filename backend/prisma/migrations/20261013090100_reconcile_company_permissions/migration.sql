-- Reconciles the two company-administration permission codes that were
-- introduced independently:
--   * company.profile.manage  (granted to ADMIN by 20261009120000)
--   * admin.company.manage    (used by the company/branch endpoints, granted by
--                              20261011160000 to roles that manage users)
--
-- Purely additive: every role that holds company.profile.manage also receives
-- admin.company.manage, so no existing administrator loses access. No grant is
-- removed and no role gains company.profile.manage.

INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
SELECT gen_random_uuid(), 'admin.company.manage', 'Manage company profile and branches',
       'إدارة بيانات الشركة والفروع', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE "code" = 'admin.company.manage');

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", target."id"
FROM "role_permissions" rp
JOIN "permissions" profile ON profile."id" = rp."permissionId" AND profile."code" = 'company.profile.manage'
CROSS JOIN "permissions" target
WHERE target."code" = 'admin.company.manage'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
