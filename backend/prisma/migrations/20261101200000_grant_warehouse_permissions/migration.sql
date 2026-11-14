-- Make the warehouse permissions real for databases that already exist.
--
-- An installation seeds its permissions once, on the empty database it was
-- created from. Everything the warehouse gained afterwards - lots, counts with
-- an approval, write-offs with their own number, the notification centre and
-- per-user warehouse access - therefore has no row on a company that has been
-- running since before those screens existed. Without this migration the new
-- screens would answer "permission required" to everybody, including the
-- administrator, which is indistinguishable from a broken feature.
--
-- Purely additive and idempotent:
--
--   * a permission row is inserted only when its code is missing;
--   * a role link is inserted only where the policy below says it belongs, and
--     never when the link already exists;
--   * nothing is deleted, renamed or replaced.
--
-- Policy (narrow on purpose - approval is not handed out by accident):
--
--   reading lots, counts, write-offs, alerts, warehouse access
--        → any role that can already adjust stock, read reports, read sales or
--          purchase invoices, or manage users;
--   receiving and issuing lots, opening and walking a count, recording a
--     write-off
--        → roles that already create purchase invoices (receiving), sales
--          invoices (issuing), or adjust stock;
--   approving and posting a count or a write-off
--        → roles that already create journal entries: the money side signs the
--          loss, which is the separation the count screen promises;
--   configuring alerts and granting warehouse access
--        → roles that already manage users.
--
-- On a fresh database this runs before the seed creates any role, so it links
-- nothing and the seed grants everything to the administrator as before.

-- 1) The catalogue rows, if absent.
INSERT INTO permissions (id, code, "nameEn", "nameAr", module)
VALUES
  (gen_random_uuid(), 'inventory.batches.read',            'View lots, expiry dates and traceability', 'عرض الدفعات وتواريخ الصلاحية والتتبع', 'inventory'),
  (gen_random_uuid(), 'inventory.batches.receive',         'Receive lots and record their dates',      'استلام الدفعات وتسجيل تواريخها',      'inventory'),
  (gen_random_uuid(), 'inventory.batches.issue',           'Issue stock from lots',                    'صرف المخزون من الدفعات',              'inventory'),
  (gen_random_uuid(), 'inventory.batches.writeoff',        'Write off and destroy lots',               'إعدام وإتلاف الدفعات',                'inventory'),
  (gen_random_uuid(), 'inventory.batches.transfer',        'Move lots between warehouses',             'تحويل الدفعات بين المخازن',           'inventory'),
  (gen_random_uuid(), 'inventory.stocktake.read',          'View stock-take sessions',                 'عرض جلسات الجرد',                     'inventory'),
  (gen_random_uuid(), 'inventory.stocktake.create',        'Open and cancel stock-take sessions',      'فتح وإلغاء جلسات الجرد',              'inventory'),
  (gen_random_uuid(), 'inventory.stocktake.count',         'Record counted quantities',                'تسجيل الكميات الفعلية',               'inventory'),
  (gen_random_uuid(), 'inventory.stocktake.approve',       'Approve stock-take differences',           'اعتماد فروق الجرد',                   'inventory'),
  (gen_random_uuid(), 'inventory.stocktake.post',          'Post the adjustment of an approved count', 'ترحيل تسوية الجرد المعتمد',           'inventory'),
  (gen_random_uuid(), 'inventory.writeoff.read',           'View write-off documents',                 'عرض مستندات الإعدام',                 'inventory'),
  (gen_random_uuid(), 'inventory.writeoff.create',         'Record a write-off',                       'تسجيل مستند إعدام',                   'inventory'),
  (gen_random_uuid(), 'inventory.writeoff.approve',        'Approve a write-off',                      'اعتماد مستند الإعدام',                'inventory'),
  (gen_random_uuid(), 'inventory.writeoff.post',           'Post and reverse a write-off',             'ترحيل وعكس مستند الإعدام',            'inventory'),
  (gen_random_uuid(), 'inventory.warehouse.access.read',   'View per-user warehouse access',           'عرض صلاحيات المخازن للمستخدمين',      'inventory'),
  (gen_random_uuid(), 'inventory.warehouse.access.manage', 'Grant and revoke warehouse access',        'منح وسحب صلاحيات المخازن',            'inventory'),
  (gen_random_uuid(), 'notifications.read',                'View notifications',                       'عرض التنبيهات',                       'notifications'),
  (gen_random_uuid(), 'notifications.manage',              'Configure notification rules',             'إعداد قواعد التنبيهات',               'notifications')
ON CONFLICT (code) DO NOTHING;

-- 2) Reading follows: whoever may adjust stock, read reports, read invoices or
--    manage users may see what the warehouse holds.
WITH visible AS (
  SELECT DISTINCT rp."roleId" AS "roleId"
  FROM role_permissions rp
  JOIN permissions p ON p.id = rp."permissionId"
  WHERE p.code IN (
    'inventory.stock.adjust',
    'inventory.items.delete',
    'inventory.barcodes.manage',
    'reports.read',
    'sales.invoices.read',
    'purchases.invoices.read',
    'admin.users.manage'
  )
)
INSERT INTO role_permissions ("roleId", "permissionId")
SELECT v."roleId", p.id
FROM visible v
JOIN roles r ON r.id = v."roleId" AND r."deletedAt" IS NULL
JOIN permissions p ON p.code IN (
  'inventory.batches.read',
  'inventory.stocktake.read',
  'inventory.writeoff.read',
  'inventory.warehouse.access.read',
  'notifications.read'
)
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 3) Receiving a lot follows creating a purchase invoice; issuing one follows
--    selling; walking a count and recording a loss follow adjusting stock.
WITH operational AS (
  SELECT DISTINCT rp."roleId" AS "roleId", p.code AS "code"
  FROM role_permissions rp
  JOIN permissions p ON p.id = rp."permissionId"
  WHERE p.code IN (
    'purchases.invoices.create',
    'sales.invoices.create',
    'inventory.stock.adjust'
  )
)
INSERT INTO role_permissions ("roleId", "permissionId")
SELECT DISTINCT o."roleId", p.id
FROM operational o
JOIN roles r ON r.id = o."roleId" AND r."deletedAt" IS NULL
JOIN permissions p
  ON (o."code" = 'purchases.invoices.create' AND p.code = 'inventory.batches.receive')
  OR (o."code" = 'sales.invoices.create' AND p.code = 'inventory.batches.issue')
  OR (o."code" = 'inventory.stock.adjust' AND p.code IN (
        'inventory.batches.receive',
        'inventory.batches.issue',
        'inventory.batches.transfer',
        'inventory.batches.writeoff',
        'inventory.stocktake.create',
        'inventory.stocktake.count',
        'inventory.writeoff.create'
      ))
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 4) Approving a count or a loss follows keeping the books.
WITH money AS (
  SELECT DISTINCT rp."roleId" AS "roleId"
  FROM role_permissions rp
  JOIN permissions p ON p.id = rp."permissionId"
  WHERE p.code = 'accounting.journal.create'
)
INSERT INTO role_permissions ("roleId", "permissionId")
SELECT m."roleId", p.id
FROM money m
JOIN roles r ON r.id = m."roleId" AND r."deletedAt" IS NULL
JOIN permissions p ON p.code IN (
  'inventory.stocktake.approve',
  'inventory.stocktake.post',
  'inventory.writeoff.approve',
  'inventory.writeoff.post'
)
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 5) Configuring alerts and handing out warehouse access follow managing users.
INSERT INTO role_permissions ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", p.id
FROM role_permissions rp
JOIN permissions anchor ON anchor.id = rp."permissionId" AND anchor.code = 'admin.users.manage'
JOIN roles r ON r.id = rp."roleId" AND r."deletedAt" IS NULL
JOIN permissions p ON p.code IN (
  'notifications.manage',
  'inventory.warehouse.access.manage'
)
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
