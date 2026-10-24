/**
 * The permission catalogue.
 *
 * One list, shared by the development seed and the demo data builder, so the
 * two can never drift: a permission that exists in one must exist in the
 * other. Rows here are global - they belong to no company - and are safe to
 * upsert at any time.
 *
 * Each entry is [code, English name, Arabic name, module].
 */
export const PERMISSIONS: Array<[string, string, string, string]> = [
  ['accounting.accounts.read', 'View chart of accounts', 'عرض دليل الحسابات', 'accounting'],
  ['accounting.accounts.create', 'Add accounts to the chart', 'إضافة حسابات للدليل', 'accounting'],
  ['accounting.accounts.update', 'Edit accounts', 'تعديل الحسابات', 'accounting'],
  ['accounting.accounts.delete', 'Delete accounts', 'حذف الحسابات', 'accounting'],
  ['accounting.journal.read', 'View journal entries', 'عرض القيود اليومية', 'accounting'],
  ['accounting.journal.create', 'Create journal entries', 'إنشاء قيود يومية', 'accounting'],
  ['accounting.journal.post', 'Post and reverse entries', 'ترحيل وعكس القيود', 'accounting'],
  ['admin.users.manage', 'Manage users', 'إدارة المستخدمين', 'admin'],
  ['admin.roles.manage', 'Manage roles', 'إدارة الأدوار', 'admin'],
  ['admin.audit.read', 'View audit trail', 'عرض سجل التدقيق', 'admin'],
  ['admin.backup', 'Take and restore backups', 'أخذ واسترجاع نسخة احتياطية', 'admin'],
  ['admin.company.manage', 'Manage company profile and branches', 'إدارة بيانات الشركة والفروع', 'admin'],

  ['parties.customers.read', 'View customers', 'عرض العملاء', 'parties'],
  ['parties.customers.create', 'Add customers', 'إضافة عملاء', 'parties'],
  ['parties.customers.update', 'Edit customers', 'تعديل العملاء', 'parties'],
  ['parties.suppliers.read', 'View suppliers', 'عرض الموردين', 'parties'],
  ['parties.suppliers.create', 'Add suppliers', 'إضافة موردين', 'parties'],
  ['parties.suppliers.update', 'Edit suppliers', 'تعديل الموردين', 'parties'],

  ['inventory.items.read', 'View items', 'عرض الأصناف', 'inventory'],
  ['inventory.items.create', 'Add items', 'إضافة أصناف', 'inventory'],
  ['inventory.items.update', 'Edit items', 'تعديل الأصناف', 'inventory'],
  ['inventory.stock.read', 'View stock balances', 'عرض أرصدة المخزون', 'inventory'],

  ['sales.invoices.read', 'View sales invoices', 'عرض فواتير البيع', 'sales'],
  ['sales.invoices.create', 'Create sales invoices', 'إنشاء فواتير البيع', 'sales'],
  ['sales.invoices.post', 'Post and reverse sales invoices', 'ترحيل وعكس فواتير البيع', 'sales'],

  ['purchases.invoices.read', 'View purchase invoices', 'عرض فواتير الشراء', 'purchases'],
  ['purchases.invoices.create', 'Create purchase invoices', 'إنشاء فواتير الشراء', 'purchases'],
  ['purchases.invoices.post', 'Post and reverse purchase invoices', 'ترحيل وعكس فواتير الشراء', 'purchases'],

  ['reports.read', 'View reports', 'عرض التقارير', 'reports'],
  ['reports.print', 'Print reports', 'طباعة التقارير', 'reports'],
  ['dashboard.view', 'View dashboard', 'عرض لوحة التحكم', 'dashboard'],
  ['dashboard.financial', 'View financial dashboard summaries', 'عرض ملخصات مالية في لوحة التحكم', 'dashboard'],
  ['sales.orders.read', 'View sales orders', 'عرض أوامر البيع', 'sales'],
  ['sales.orders.create', 'Create sales orders', 'إنشاء أوامر البيع', 'sales'],
  ['sales.orders.approve', 'Approve sales orders', 'اعتماد أوامر البيع', 'sales'],
  ['sales.orders.manage', 'Create and edit sales orders', 'إنشاء وتعديل أوامر البيع', 'sales'],
  ['sales.returns.read', 'View sales returns', 'عرض مردودات البيع', 'sales'],
  ['sales.returns.manage', 'Create sales returns', 'إنشاء مردودات البيع', 'sales'],
  ['sales.print', 'Print sales documents', 'طباعة مستندات البيع', 'sales'],
  ['purchases.orders.read', 'View purchase orders', 'عرض أوامر الشراء', 'purchases'],
  ['purchases.orders.create', 'Create purchase orders', 'إنشاء أوامر الشراء', 'purchases'],
  ['purchases.orders.approve', 'Approve purchase orders', 'اعتماد أوامر الشراء', 'purchases'],
  ['purchases.orders.manage', 'Create and edit purchase orders', 'إنشاء وتعديل أوامر الشراء', 'purchases'],
  ['purchases.returns.read', 'View purchase returns', 'عرض مردودات الشراء', 'purchases'],
  ['purchases.returns.manage', 'Create purchase returns', 'إنشاء مردودات الشراء', 'purchases'],
  ['purchases.print', 'Print purchase documents', 'طباعة مستندات الشراء', 'purchases'],
  ['cash.vouchers.export', 'Export receipts and payments', 'تصدير سندات القبض والصرف', 'cash'],
  ['cash.reports.read', 'View cash and bank reports', 'عرض تقارير الخزينة والبنوك', 'cash'],
  ['inventory.warehouses.read', 'View warehouses', 'عرض المخازن', 'inventory'],
  ['inventory.warehouses.manage', 'Manage warehouses', 'إدارة المخازن', 'inventory'],
  ['inventory.export', 'Export inventory lists and reports', 'تصدير قوائم وتقارير المخزون', 'inventory'],
  ['admin.backup.restore', 'Restore backups', 'استعادة النسخ الاحتياطية', 'admin'],
  ['admin.reset', 'Reset company data', 'تصفير بيانات الشركة', 'admin'],
  ['admin.users.password', 'Reset other users passwords', 'إعادة تعيين كلمات مرور المستخدمين', 'admin'],

  ['accounting.periods.read', 'View fiscal periods', 'عرض الفترات المالية', 'accounting'],
  ['accounting.periods.manage', 'Manage fiscal periods', 'إدارة الفترات المالية', 'accounting'],

  // Reviewing an entry is a different job from writing one: the whole point of
  // the permission is that the two can be held by different people.
  ['accounting.journal.approve', 'Approve journal entries', 'اعتماد القيود اليومية', 'accounting'],
  ['accounting.costcenters.manage', 'Manage cost centers', 'إدارة مراكز التكلفة', 'accounting'],
  // Seeing the opening figures is a smaller privilege than changing them:
  // the read endpoints carry their own permission, and the migration that
  // introduced it backfilled every role that already read via journal.read.
  ['accounting.openingbalances.read', 'View opening balances', 'عرض الأرصدة الافتتاحية', 'accounting'],
  [
    'accounting.openingbalances.manage',
    'Open the books: opening balances',
    'إدخال الأرصدة الافتتاحية',
    'accounting',
  ],
  // Closing a year is irreversible by design, so it is its own permission.
  ['accounting.periods.close', 'Close a fiscal year', 'إقفال السنة المالية', 'accounting'],

  ['cash.accounts.read', 'View cash boxes and banks', 'عرض الخزائن والبنوك', 'cash'],
  ['cash.accounts.manage', 'Manage cash boxes and banks', 'إدارة الخزائن والبنوك', 'cash'],
  ['cash.vouchers.read', 'View receipts and payments', 'عرض سندات القبض والصرف', 'cash'],
  ['cash.vouchers.create', 'Create receipts and payments', 'إنشاء سندات القبض والصرف', 'cash'],
  ['cash.vouchers.post', 'Post and reverse receipts and payments', 'ترحيل وعكس سندات القبض والصرف', 'cash'],
  ['cash.reconcile', 'Reconcile bank statements', 'تسوية كشوف البنك', 'cash'],

  ['inventory.items.delete', 'Deactivate items', 'إيقاف الأصناف', 'inventory'],
  ['inventory.stock.adjust', 'Adjust, transfer and count stock', 'تسويات وتحويلات وجرد المخزون', 'inventory'],
  ['sales.invoices.export', 'Export sales documents', 'تصدير مستندات البيع', 'sales'],
  ['purchases.invoices.export', 'Export purchase documents', 'تصدير مستندات الشراء', 'purchases'],
  ['reports.export', 'Export reports', 'تصدير التقارير', 'reports']
];
