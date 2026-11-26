-- VAT return report permission. Roles that could already read both the sales and
-- the purchases report keep seeing what they could see, now as a separate grant.
INSERT INTO permissions (id, code, "nameEn", "nameAr", module)
VALUES (gen_random_uuid(), 'reports.vat-return.read', 'View VAT return', 'عرض إقرار ضريبة القيمة المضافة', 'reports')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions ("roleId", "permissionId")
SELECT s."roleId", v.id
FROM role_permissions s
JOIN permissions ps ON ps.id = s."permissionId" AND ps.code = 'reports.sales.read'
JOIN role_permissions p ON p."roleId" = s."roleId"
JOIN permissions pp ON pp.id = p."permissionId" AND pp.code = 'reports.purchases.read'
JOIN permissions v ON v.code = 'reports.vat-return.read'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
