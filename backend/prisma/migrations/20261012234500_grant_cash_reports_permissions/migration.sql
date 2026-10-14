-- The new modules (cash and banks, cost centers, opening balances, stock
-- documents, approvals) brought new permissions with them. A database that is
-- already in use never runs the seed again, so the grants are filled in here.
--
-- Two rules this migration follows:
--   * it never deletes a grant: an administrator who gave somebody a
--     permission keeps that decision;
--   * it grants each new permission only to the roles that already hold the
--     permission that means the same thing in the same module. Nobody gains
--     access to something they could not already do by hand.
--
-- It is idempotent: running it twice changes nothing.

-- ---------------------------------------------------------------- permissions

INSERT INTO "permissions" ("id", "code", "nameEn", "nameAr", "module")
SELECT gen_random_uuid(), v.code, v."nameEn", v."nameAr", v.module
  FROM (VALUES
    ('accounting.journal.approve', 'Approve journal entries', 'اعتماد القيود اليومية', 'accounting'),
    ('accounting.costcenters.manage', 'Manage cost centers', 'إدارة مراكز التكلفة', 'accounting'),
    ('accounting.openingbalances.manage', 'Open the books: opening balances', 'إدخال الأرصدة الافتتاحية', 'accounting'),
    ('accounting.periods.close', 'Close a fiscal year', 'إقفال السنة المالية', 'accounting'),
    ('cash.accounts.read', 'View cash boxes and banks', 'عرض الخزائن والبنوك', 'cash'),
    ('cash.accounts.manage', 'Manage cash boxes and banks', 'إدارة الخزائن والبنوك', 'cash'),
    ('cash.vouchers.read', 'View receipts and payments', 'عرض سندات القبض والصرف', 'cash'),
    ('cash.vouchers.create', 'Create receipts and payments', 'إنشاء سندات القبض والصرف', 'cash'),
    ('cash.vouchers.post', 'Post and reverse receipts and payments', 'ترحيل وعكس سندات القبض والصرف', 'cash'),
    ('cash.reconcile', 'Reconcile bank statements', 'تسوية كشف البنك', 'cash'),
    ('inventory.items.delete', 'Deactivate items', 'إيقاف الأصناف', 'inventory'),
    ('inventory.stock.adjust', 'Adjust, transfer and count stock', 'تسويات وتحويلات وجرد المخزون', 'inventory'),
    ('sales.invoices.export', 'Export sales documents', 'تصدير مستندات البيع', 'sales'),
    ('purchases.invoices.export', 'Export purchase documents', 'تصدير مستندات الشراء', 'purchases'),
    ('reports.export', 'Export reports', 'تصدير التقارير', 'reports')
  ) AS v(code, "nameEn", "nameAr", module)
 WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p.code = v.code);

-- ---------------------------------------------------------------- role grants

-- Accounting: whoever could post entries may approve them, manage cost
-- centers and open the books; whoever could manage periods may close a year.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  JOIN "permissions" source ON source.code = 'accounting.journal.post'
  JOIN "role_permissions" rp ON rp."roleId" = r.id AND rp."permissionId" = source.id
  JOIN "permissions" p ON p.code IN (
    'accounting.journal.approve',
    'accounting.costcenters.manage',
    'accounting.openingbalances.manage'
  )
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x WHERE x."roleId" = r.id AND x."permissionId" = p.id
 );

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  JOIN "permissions" source ON source.code = 'accounting.periods.manage'
  JOIN "role_permissions" rp ON rp."roleId" = r.id AND rp."permissionId" = source.id
  JOIN "permissions" p ON p.code = 'accounting.periods.close'
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x WHERE x."roleId" = r.id AND x."permissionId" = p.id
 );

-- Cash: a role that could post a sales or purchase invoice could already take
-- money in and out of the company by hand. The cash module gives that a proper
-- document, with the same people allowed to use it.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  JOIN "permissions" source ON source.code = 'sales.invoices.read'
  JOIN "role_permissions" rp ON rp."roleId" = r.id AND rp."permissionId" = source.id
  JOIN "permissions" p ON p.code IN ('cash.accounts.read', 'cash.vouchers.read')
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x WHERE x."roleId" = r.id AND x."permissionId" = p.id
 );

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  JOIN "permissions" source ON source.code = 'sales.invoices.create'
  JOIN "role_permissions" rp ON rp."roleId" = r.id AND rp."permissionId" = source.id
  JOIN "permissions" p ON p.code IN ('cash.vouchers.create', 'cash.accounts.manage')
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x WHERE x."roleId" = r.id AND x."permissionId" = p.id
 );

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  JOIN "permissions" source ON source.code = 'sales.invoices.post'
  JOIN "role_permissions" rp ON rp."roleId" = r.id AND rp."permissionId" = source.id
  JOIN "permissions" p ON p.code IN ('cash.vouchers.post', 'cash.reconcile')
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x WHERE x."roleId" = r.id AND x."permissionId" = p.id
 );

-- Inventory: whoever could add items may deactivate them; whoever could post
-- an invoice may record a stock adjustment.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  JOIN "permissions" source ON source.code = 'inventory.items.update'
  JOIN "role_permissions" rp ON rp."roleId" = r.id AND rp."permissionId" = source.id
  JOIN "permissions" p ON p.code = 'inventory.items.delete'
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x WHERE x."roleId" = r.id AND x."permissionId" = p.id
 );

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  JOIN "permissions" source ON source.code = 'inventory.stock.read'
  JOIN "role_permissions" rp ON rp."roleId" = r.id AND rp."permissionId" = source.id
  JOIN "permissions" p ON p.code = 'inventory.stock.adjust'
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x WHERE x."roleId" = r.id AND x."permissionId" = p.id
 );

-- Exports: reading a report already means reading these files out of it.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
  FROM "roles" r
  JOIN "permissions" source ON source.code = 'reports.read'
  JOIN "role_permissions" rp ON rp."roleId" = r.id AND rp."permissionId" = source.id
  JOIN "permissions" p ON p.code IN ('reports.export', 'sales.invoices.export', 'purchases.invoices.export')
 WHERE NOT EXISTS (
   SELECT 1 FROM "role_permissions" x WHERE x."roleId" = r.id AND x."permissionId" = p.id
 );

-- ------------------------------------------------------------- the two new
-- accounts the automatic postings need (opening balances and inventory
-- differences). Created only where they are missing, by code, so a company
-- that renumbered its chart of accounts keeps its own numbering.

INSERT INTO "accounts" ("id", "companyId", "code", "nameEn", "nameAr", "type", "parentId", "isPostable", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), c.id, '3103', 'Opening balance equity', 'أرصدة افتتاحية', 'EQUITY',
       (SELECT a.id FROM "accounts" a WHERE a."companyId" = c.id AND a.code = '3' AND a."deletedAt" IS NULL LIMIT 1),
       true, true, now(), now()
  FROM "companies" c
 WHERE NOT EXISTS (
   SELECT 1 FROM "accounts" a WHERE a."companyId" = c.id AND a.code = '3103' AND a."deletedAt" IS NULL
 );

INSERT INTO "accounts" ("id", "companyId", "code", "nameEn", "nameAr", "type", "parentId", "isPostable", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), c.id, '5107', 'Inventory differences', 'فروق المخزون', 'EXPENSE',
       (SELECT a.id FROM "accounts" a WHERE a."companyId" = c.id AND a.code = '5' AND a."deletedAt" IS NULL LIMIT 1),
       true, true, now(), now()
  FROM "companies" c
 WHERE NOT EXISTS (
   SELECT 1 FROM "accounts" a WHERE a."companyId" = c.id AND a.code = '5107' AND a."deletedAt" IS NULL
 );

-- ------------------------------------------------------------- company settings
-- Every company gets a settings row (a database migrated before the settings
-- table existed may not have one yet).
INSERT INTO "company_settings" ("companyId", "updatedAt")
SELECT c.id, now() FROM "companies" c
ON CONFLICT ("companyId") DO NOTHING;
