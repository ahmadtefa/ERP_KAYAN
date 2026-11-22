-- Independent report permissions. Existing broad report grants are expanded once
-- to preserve access while leaving each new grant separately manageable.
INSERT INTO permissions (id, code, "nameEn", "nameAr", module) VALUES
  (gen_random_uuid(), 'reports.reconciliation-center.read', 'View reconciliation center report', 'عرض تقرير reconciliation center', 'reports'),
  (gen_random_uuid(), 'reports.receivables-reconciliation.read', 'View receivables reconciliation report', 'عرض تقرير receivables reconciliation', 'reports'),
  (gen_random_uuid(), 'reports.payables-reconciliation.read', 'View payables reconciliation report', 'عرض تقرير payables reconciliation', 'reports'),
  (gen_random_uuid(), 'reports.trial-balance.read', 'View trial balance report', 'عرض تقرير trial balance', 'reports'),
  (gen_random_uuid(), 'reports.profit-and-loss.read', 'View profit and loss report', 'عرض تقرير profit and loss', 'reports'),
  (gen_random_uuid(), 'reports.customer-balances.read', 'View customer balances report', 'عرض تقرير customer balances', 'reports'),
  (gen_random_uuid(), 'reports.supplier-balances.read', 'View supplier balances report', 'عرض تقرير supplier balances', 'reports'),
  (gen_random_uuid(), 'reports.general-journal.read', 'View general journal report', 'عرض تقرير general journal', 'reports'),
  (gen_random_uuid(), 'reports.general-ledger.read', 'View general ledger report', 'عرض تقرير general ledger', 'reports'),
  (gen_random_uuid(), 'reports.balance-sheet.read', 'View balance sheet report', 'عرض تقرير balance sheet', 'reports'),
  (gen_random_uuid(), 'reports.equity-changes.read', 'View equity changes report', 'عرض تقرير equity changes', 'reports'),
  (gen_random_uuid(), 'reports.cash-flow.read', 'View cash flow report', 'عرض تقرير cash flow', 'reports'),
  (gen_random_uuid(), 'reports.receivables-aging.read', 'View receivables aging report', 'عرض تقرير receivables aging', 'reports'),
  (gen_random_uuid(), 'reports.payables-aging.read', 'View payables aging report', 'عرض تقرير payables aging', 'reports'),
  (gen_random_uuid(), 'reports.account-ledger.read', 'View account ledger report', 'عرض تقرير account ledger', 'reports'),
  (gen_random_uuid(), 'reports.sales.read', 'View sales report', 'عرض تقرير sales', 'reports'),
  (gen_random_uuid(), 'reports.purchases.read', 'View purchases report', 'عرض تقرير purchases', 'reports'),
  (gen_random_uuid(), 'reports.expenses.read', 'View expenses report', 'عرض تقرير expenses', 'reports'),
  (gen_random_uuid(), 'reports.income.read', 'View income report', 'عرض تقرير income', 'reports'),
  (gen_random_uuid(), 'reports.payments.read', 'View payments report', 'عرض تقرير payments', 'reports'),
  (gen_random_uuid(), 'reports.cash.read', 'View cash report', 'عرض تقرير cash', 'reports'),
  (gen_random_uuid(), 'reports.outstanding-invoices.read', 'View outstanding invoices report', 'عرض تقرير outstanding invoices', 'reports'),
  (gen_random_uuid(), 'reports.party-statement.read', 'View party statements', 'عرض كشوف حساب الأطراف', 'reports'),
  (gen_random_uuid(), 'inventory.reports.item-card.read', 'View inventory item card report', 'عرض تقرير المخزون item card', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.item-movement.read', 'View inventory item movement report', 'عرض تقرير المخزون item movement', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.balance-by-warehouse.read', 'View inventory balance by warehouse report', 'عرض تقرير المخزون balance by warehouse', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.balance-by-branch.read', 'View inventory balance by branch report', 'عرض تقرير المخزون balance by branch', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.valuation-by-warehouse.read', 'View inventory valuation by warehouse report', 'عرض تقرير المخزون valuation by warehouse', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.below-minimum.read', 'View inventory below minimum report', 'عرض تقرير المخزون below minimum', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.above-maximum.read', 'View inventory above maximum report', 'عرض تقرير المخزون above maximum', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.slow-moving.read', 'View inventory slow moving report', 'عرض تقرير المخزون slow moving', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.dead-stock.read', 'View inventory dead stock report', 'عرض تقرير المخزون dead stock', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.zero-stock.read', 'View inventory zero stock report', 'عرض تقرير المخزون zero stock', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.lots.read', 'View inventory lots report', 'عرض تقرير المخزون lots', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.expiring.read', 'View inventory expiring report', 'عرض تقرير المخزون expiring', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.expired.read', 'View inventory expired report', 'عرض تقرير المخزون expired', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.value-at-risk.read', 'View inventory value at risk report', 'عرض تقرير المخزون value at risk', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.write-offs.read', 'View inventory write offs report', 'عرض تقرير المخزون write offs', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.transfers.read', 'View inventory transfers report', 'عرض تقرير المخزون transfers', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.count-variances.read', 'View inventory count variances report', 'عرض تقرير المخزون count variances', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.cost-by-warehouse.read', 'View inventory cost by warehouse report', 'عرض تقرير المخزون cost by warehouse', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.reconciliation.read', 'View inventory reconciliation report', 'عرض تقرير المخزون reconciliation', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.audit-trail.read', 'View inventory audit trail report', 'عرض تقرير المخزون audit trail', 'inventory'),
  (gen_random_uuid(), 'inventory.reports.print', 'Print inventory reports', 'طباعة تقارير المخزون', 'inventory')
ON CONFLICT (code) DO NOTHING;

-- Preserve the reports each role could read before the split. These are direct
-- assignments, not permanent implications: administrators can now revoke any
-- report individually without affecting the other report permissions.
INSERT INTO role_permissions ("roleId", "permissionId")
SELECT rp."roleId", report_permission.id
FROM role_permissions rp
JOIN permissions legacy ON legacy.id = rp."permissionId" AND legacy.code = 'reports.read'
JOIN permissions report_permission ON report_permission.code LIKE 'reports.%.read'
WHERE report_permission.code <> 'reports.read'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO role_permissions ("roleId", "permissionId")
SELECT rp."roleId", report_permission.id
FROM role_permissions rp
JOIN permissions legacy ON legacy.id = rp."permissionId" AND legacy.code = 'inventory.stock.read'
JOIN permissions report_permission ON report_permission.code LIKE 'inventory.reports.%.read'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO role_permissions ("roleId", "permissionId")
SELECT rp."roleId", print_permission.id
FROM role_permissions rp
JOIN permissions legacy ON legacy.id = rp."permissionId" AND legacy.code = 'inventory.stock.read'
JOIN permissions print_permission ON print_permission.code = 'inventory.reports.print'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Carry explicit per-user grants and denials forward as well as role grants.
INSERT INTO user_permissions ("userId", "permissionId", "isDenied", "updatedAt")
SELECT up."userId", report_permission.id, up."isDenied", up."updatedAt"
FROM user_permissions up
JOIN permissions legacy ON legacy.id = up."permissionId" AND legacy.code = 'reports.read'
JOIN permissions report_permission ON report_permission.code LIKE 'reports.%.read'
WHERE report_permission.code <> 'reports.read'
ON CONFLICT ("userId", "permissionId") DO NOTHING;

INSERT INTO user_permissions ("userId", "permissionId", "isDenied", "updatedAt")
SELECT up."userId", report_permission.id, up."isDenied", up."updatedAt"
FROM user_permissions up
JOIN permissions legacy ON legacy.id = up."permissionId" AND legacy.code = 'inventory.stock.read'
JOIN permissions report_permission ON report_permission.code LIKE 'inventory.reports.%.read'
ON CONFLICT ("userId", "permissionId") DO NOTHING;

INSERT INTO user_permissions ("userId", "permissionId", "isDenied", "updatedAt")
SELECT up."userId", print_permission.id, up."isDenied", up."updatedAt"
FROM user_permissions up
JOIN permissions legacy ON legacy.id = up."permissionId" AND legacy.code = 'inventory.stock.read'
JOIN permissions print_permission ON print_permission.code = 'inventory.reports.print'
ON CONFLICT ("userId", "permissionId") DO NOTHING;
