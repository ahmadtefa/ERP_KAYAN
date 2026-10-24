-- Reading opening balances becomes its own permission, split from managing
-- them. The catalogue row is inserted here so a database that is only
-- migrated still knows the new name, matching how earlier catalogue growth
-- was shipped.
INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
SELECT
  gen_random_uuid(),
  'accounting.openingbalances.read',
  'View opening balances',
  'عرض الأرصدة الافتتاحية',
  'accounting'
WHERE NOT EXISTS (
  SELECT 1 FROM "permissions" p WHERE p.code = 'accounting.openingbalances.read'
);

-- Until now the read endpoints were guarded by accounting.journal.read, so
-- every role holding it could view opening balances. Grant those roles the
-- new code: an upgrade must not lock anyone out of screens they already use.
-- Managing opening balances is untouched and stays a separate permission.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT rp."roleId", pn.id
FROM "role_permissions" rp
JOIN "permissions" pj
  ON pj.id = rp."permissionId" AND pj.code = 'accounting.journal.read'
JOIN "permissions" pn
  ON pn.code = 'accounting.openingbalances.read'
ON CONFLICT DO NOTHING;
