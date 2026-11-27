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
  ['company.profile.manage', 'Manage company profile', 'إدارة بيانات الشركة', 'admin'],
  ['accounting.accounts.read', 'View chart of accounts', 'عرض دليل الحسابات', 'accounting'],
  ['accounting.accounts.create', 'Add accounts to the chart', 'إضافة حسابات للدليل', 'accounting'],
  ['accounting.accounts.update', 'Edit accounts', 'تعديل الحسابات', 'accounting'],
  ['accounting.accounts.delete', 'Delete accounts', 'حذف الحسابات', 'accounting'],
  ['accounting.journal.read', 'View journal entries', 'عرض القيود اليومية', 'accounting'],
  ['accounting.journal.create', 'Create journal entries', 'إنشاء قيود يومية', 'accounting'],
  ['accounting.journal.post', 'Post and reverse entries', 'ترحيل وعكس القيود', 'accounting'],
  ['accounting.fixedassets.read', 'View fixed assets', 'عرض الأصول الثابتة', 'accounting'],
  ['accounting.fixedassets.manage', 'Manage fixed assets', 'إدارة الأصول الثابتة', 'accounting'],
  ['accounting.fixedassets.depreciate', 'Run depreciation', 'تشغيل الإهلاك', 'accounting'],
  ['admin.users.manage', 'Manage users', 'إدارة المستخدمين', 'admin'],
  ['admin.roles.manage', 'Manage roles', 'إدارة الأدوار', 'admin'],
  ['admin.audit.read', 'View audit trail', 'عرض سجل التدقيق', 'admin'],
  ['admin.approvals.read', 'View approval policies and decision history', 'عرض قواعد الموافقات وسجل القرارات', 'admin'],
  ['admin.approvals.manage', 'Configure approval policies and levels', 'إعداد قواعد الموافقات ومستوياتها', 'admin'],
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
  ['inventory.stock.review', 'Review stock vouchers', 'مراجعة أذون المخزون', 'inventory'],
  ['inventory.stock.approve', 'Approve stock vouchers', 'اعتماد أذون المخزون', 'inventory'],
  ['inventory.stock.voucher.create', 'Create and edit warehouse receipt/issue vouchers', 'إنشاء وتعديل أذون الإضافة والصرف', 'inventory'],
  ['inventory.stock.voucher.post', 'Post and reverse approved warehouse vouchers', 'ترحيل وعكس أذون المخازن المعتمدة', 'inventory'],
  ['inventory.transfer.read', 'View staged stock transfers and transit balances', 'عرض التحويلات والأرصدة بالطريق', 'inventory'],
  ['inventory.transfer.create', 'Request a stock transfer', 'طلب تحويل مخزني', 'inventory'],
  ['inventory.transfer.review', 'Review or reject a stock transfer', 'مراجعة أو رفض التحويل المخزني', 'inventory'],
  ['inventory.transfer.approve', 'Approve a stock transfer for dispatch', 'اعتماد التحويل للتسليم', 'inventory'],
  ['inventory.transfer.dispatch', 'Dispatch approved goods into transit', 'تسليم البضاعة للطريق', 'inventory'],
  ['inventory.transfer.receive', 'Receive dispatched transfer quantities', 'استلام كميات التحويل', 'inventory'],
  ['inventory.transfer.settle', 'Settle stock transfer discrepancies', 'تسجيل تسوية فروق التحويل', 'inventory'],
  ['inventory.transfer.settle.approve', 'Approve and post transfer write-offs', 'اعتماد وترحيل إعدام فروق التحويل', 'inventory'],
  ['inventory.transfer.close', 'Close a fully reconciled stock transfer', 'إغلاق التحويل بعد التسوية', 'inventory'],
  ['inventory.transfer.cancel', 'Cancel or reverse a stock transfer by stage', 'إلغاء أو عكس التحويل حسب مرحلته', 'inventory'],
  ['inventory.transfer.report', 'View transfer, transit and discrepancy reports', 'عرض تقارير التحويلات والطريق والفروق', 'inventory'],

  ['sales.invoices.read', 'View sales invoices', 'عرض فواتير البيع', 'sales'],
  ['sales.invoices.create', 'Create sales invoices', 'إنشاء فواتير البيع', 'sales'],
  ['sales.invoices.post', 'Post and reverse sales invoices', 'ترحيل وعكس فواتير البيع', 'sales'],

  ['purchases.invoices.read', 'View purchase invoices', 'عرض فواتير الشراء', 'purchases'],
  ['purchases.invoices.create', 'Create purchase invoices', 'إنشاء فواتير الشراء', 'purchases'],
  ['purchases.invoices.post', 'Post and reverse purchase invoices', 'ترحيل وعكس فواتير الشراء', 'purchases'],

  ['reports.reconciliation-center.read', 'View reconciliation center report', 'عرض تقرير reconciliation center', 'reports'],
  ['reports.receivables-reconciliation.read', 'View receivables reconciliation report', 'عرض تقرير receivables reconciliation', 'reports'],
  ['reports.payables-reconciliation.read', 'View payables reconciliation report', 'عرض تقرير payables reconciliation', 'reports'],
  ['reports.trial-balance.read', 'View trial balance report', 'عرض تقرير trial balance', 'reports'],
  ['reports.profit-and-loss.read', 'View profit and loss report', 'عرض تقرير profit and loss', 'reports'],
  ['reports.customer-balances.read', 'View customer balances report', 'عرض تقرير customer balances', 'reports'],
  ['reports.supplier-balances.read', 'View supplier balances report', 'عرض تقرير supplier balances', 'reports'],
  ['reports.general-journal.read', 'View general journal report', 'عرض تقرير general journal', 'reports'],
  ['reports.general-ledger.read', 'View general ledger report', 'عرض تقرير general ledger', 'reports'],
  ['reports.balance-sheet.read', 'View balance sheet report', 'عرض تقرير balance sheet', 'reports'],
  ['reports.equity-changes.read', 'View equity changes report', 'عرض تقرير equity changes', 'reports'],
  ['reports.cash-flow.read', 'View cash flow report', 'عرض تقرير cash flow', 'reports'],
  ['reports.receivables-aging.read', 'View receivables aging report', 'عرض تقرير receivables aging', 'reports'],
  ['reports.payables-aging.read', 'View payables aging report', 'عرض تقرير payables aging', 'reports'],
  ['reports.account-ledger.read', 'View account ledger report', 'عرض تقرير account ledger', 'reports'],
  ['reports.sales.read', 'View sales report', 'عرض تقرير sales', 'reports'],
  ['reports.purchases.read', 'View purchases report', 'عرض تقرير purchases', 'reports'],
  ['cheques.read', 'View cheques', 'عرض الشيكات', 'cheques'],
  ['cheques.create', 'Register cheques', 'تسجيل الشيكات', 'cheques'],
  ['cheques.manage', 'Deposit, collect, return and cancel cheques', 'إيداع وتحصيل وإرجاع وإلغاء الشيكات', 'cheques'],
  ['withholding.read', 'View withholding tax and its report', 'عرض ضريبة الخصم والإضافة وتقريرها', 'cash'],
  ['withholding.manage', 'Set up withholding tax rates', 'إعداد نسب ضريبة الخصم والإضافة', 'cash'],
  ['reports.vat-return.read', 'View VAT return', 'عرض إقرار ضريبة القيمة المضافة', 'reports'],
  ['reports.expenses.read', 'View expenses report', 'عرض تقرير expenses', 'reports'],
  ['reports.income.read', 'View income report', 'عرض تقرير income', 'reports'],
  ['reports.payments.read', 'View payments report', 'عرض تقرير payments', 'reports'],
  ['reports.cash.read', 'View cash report', 'عرض تقرير cash', 'reports'],
  ['reports.outstanding-invoices.read', 'View outstanding invoices report', 'عرض تقرير outstanding invoices', 'reports'],
  ['reports.party-statement.read', 'View party statements', 'عرض كشوف حساب الأطراف', 'reports'],
  ['reports.read', 'View reports', 'عرض التقارير', 'reports'],
  ['reports.print', 'Print reports', 'طباعة التقارير', 'reports'],
  ['dashboard.view', 'View dashboard', 'عرض لوحة التحكم', 'dashboard'],
  ['dashboard.financial', 'View financial dashboard summaries', 'عرض ملخصات مالية في لوحة التحكم', 'dashboard'],
  // One permission per dashboard section. The dashboard API returns only the
  // sections the caller holds, so a clerk who may raise invoices does not
  // learn the profit, and a treasurer does not learn the stock value, unless
  // an administrator grants that section to their role. `dashboard.financial`
  // remains as a broad grant for the financial sections (revenue, profit,
  // cash, movements) for roles that already hold it.
  ['dashboard.sales', 'View total sales on the dashboard', 'عرض إجمالي المبيعات في لوحة التحكم', 'dashboard'],
  ['dashboard.purchases', 'View total purchases on the dashboard', 'عرض إجمالي المشتريات في لوحة التحكم', 'dashboard'],
  ['dashboard.revenue', 'View revenue and expenses on the dashboard', 'عرض الإيرادات والمصروفات في لوحة التحكم', 'dashboard'],
  ['dashboard.profit', 'View net result on the dashboard', 'عرض صافي النتيجة في لوحة التحكم', 'dashboard'],
  ['dashboard.cash', 'View cash and bank balances on the dashboard', 'عرض أرصدة الخزائن والبنوك في لوحة التحكم', 'dashboard'],
  ['dashboard.movements', 'View receipts and payments on the dashboard', 'عرض المقبوضات والمدفوعات في لوحة التحكم', 'dashboard'],
  ['dashboard.receivables', 'View customer receivables on the dashboard', 'عرض أرصدة ومستحقات العملاء في لوحة التحكم', 'dashboard'],
  ['dashboard.payables', 'View supplier payables on the dashboard', 'عرض أرصدة ومستحقات الموردين في لوحة التحكم', 'dashboard'],
  ['dashboard.stock', 'View stock value on the dashboard', 'عرض قيمة المخزون في لوحة التحكم', 'dashboard'],
  ['dashboard.charts', 'View dashboard charts and comparisons', 'عرض الرسوم البيانية والمقارنات في لوحة التحكم', 'dashboard'],
  ['dashboard.top', 'View top customers and items on the dashboard', 'عرض أفضل العملاء والأصناف في لوحة التحكم', 'dashboard'],
  ['dashboard.recent', 'View recent documents on the dashboard', 'عرض آخر العمليات في لوحة التحكم', 'dashboard'],
  ['sales.orders.read', 'View sales orders', 'عرض أوامر البيع', 'sales'],
  ['sales.orders.create', 'Create sales orders', 'إنشاء أوامر البيع', 'sales'],
  ['sales.orders.approve', 'Approve sales orders', 'اعتماد أوامر البيع', 'sales'],
  ['sales.orders.manage', 'Create and edit sales orders', 'إنشاء وتعديل أوامر البيع', 'sales'],
  ['sales.quotations.read', 'View quotations', 'عرض عروض الأسعار', 'sales'],
  ['sales.quotations.manage', 'Create and edit quotations', 'إنشاء وتعديل عروض الأسعار', 'sales'],
  ['sales.quotations.convert', 'Convert quotations to invoices', 'تحويل عروض الأسعار إلى فواتير', 'sales'],
  ['sales.quotations.export', 'Print and export quotations', 'طباعة وتصدير عروض الأسعار', 'sales'],
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
  ['inventory.reports.item-card.read', 'View inventory item card report', 'عرض تقرير المخزون item card', 'inventory'],
  ['inventory.reports.item-movement.read', 'View inventory item movement report', 'عرض تقرير المخزون item movement', 'inventory'],
  ['inventory.reports.balance-by-warehouse.read', 'View inventory balance by warehouse report', 'عرض تقرير المخزون balance by warehouse', 'inventory'],
  ['inventory.reports.balance-by-branch.read', 'View inventory balance by branch report', 'عرض تقرير المخزون balance by branch', 'inventory'],
  ['inventory.reports.valuation-by-warehouse.read', 'View inventory valuation by warehouse report', 'عرض تقرير المخزون valuation by warehouse', 'inventory'],
  ['inventory.reports.below-minimum.read', 'View inventory below minimum report', 'عرض تقرير المخزون below minimum', 'inventory'],
  ['inventory.reports.above-maximum.read', 'View inventory above maximum report', 'عرض تقرير المخزون above maximum', 'inventory'],
  ['inventory.reports.slow-moving.read', 'View inventory slow moving report', 'عرض تقرير المخزون slow moving', 'inventory'],
  ['inventory.reports.dead-stock.read', 'View inventory dead stock report', 'عرض تقرير المخزون dead stock', 'inventory'],
  ['inventory.reports.zero-stock.read', 'View inventory zero stock report', 'عرض تقرير المخزون zero stock', 'inventory'],
  ['inventory.reports.lots.read', 'View inventory lots report', 'عرض تقرير المخزون lots', 'inventory'],
  ['inventory.reports.expiring.read', 'View inventory expiring report', 'عرض تقرير المخزون expiring', 'inventory'],
  ['inventory.reports.expired.read', 'View inventory expired report', 'عرض تقرير المخزون expired', 'inventory'],
  ['inventory.reports.value-at-risk.read', 'View inventory value at risk report', 'عرض تقرير المخزون value at risk', 'inventory'],
  ['inventory.reports.write-offs.read', 'View inventory write offs report', 'عرض تقرير المخزون write offs', 'inventory'],
  ['inventory.reports.transfers.read', 'View inventory transfers report', 'عرض تقرير المخزون transfers', 'inventory'],
  ['inventory.reports.count-variances.read', 'View inventory count variances report', 'عرض تقرير المخزون count variances', 'inventory'],
  ['inventory.reports.cost-by-warehouse.read', 'View inventory cost by warehouse report', 'عرض تقرير المخزون cost by warehouse', 'inventory'],
  ['inventory.reports.reconciliation.read', 'View inventory reconciliation report', 'عرض تقرير المخزون reconciliation', 'inventory'],
  ['inventory.reports.audit-trail.read', 'View inventory audit trail report', 'عرض تقرير المخزون audit trail', 'inventory'],
  ['inventory.reports.print', 'Print inventory reports', 'طباعة تقارير المخزون', 'inventory'],
  ['admin.backup.restore', 'Restore backups', 'استعادة النسخ الاحتياطية', 'admin'],
  ['admin.users.password', 'Reset other users passwords', 'إعادة تعيين كلمات مرور المستخدمين', 'admin'],

  ['accounting.periods.read', 'View fiscal periods', 'عرض الفترات المالية', 'accounting'],
  ['accounting.periods.manage', 'Manage fiscal periods', 'إدارة الفترات المالية', 'accounting'],

  // Reviewing an entry is a different job from writing one: the whole point of
  // the permission is that the two can be held by different people.
  ['accounting.journal.approve', 'Approve journal entries', 'اعتماد القيود اليومية', 'accounting'],
  ['accounting.costcenters.read', 'View cost centers', 'عرض مراكز التكلفة', 'accounting'],
  ['accounting.costcenters.manage', 'Manage cost centers', 'إدارة مراكز التكلفة', 'accounting'],
  ['accounting.budgets.read', 'View budgets', 'عرض الموازنات', 'accounting'],
  ['accounting.budgets.manage', 'Manage budgets', 'إدارة الموازنات', 'accounting'],
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
  // Reading a cost is its own privilege: a warehouse clerk may price a sale
  // without ever seeing what the goods cost the company, and the print/PDF
  // options can only hide what the API is willing to send.
  ['inventory.cost.read', 'View legacy cost and purchase prices', 'عرض صلاحية التكلفة وأسعار الشراء القديمة', 'inventory'],
  ['purchases.price.read', 'View purchase prices', 'عرض أسعار الشراء', 'purchases'],
  ['sales.price.read', 'View selling prices', 'عرض أسعار البيع', 'sales'],
  ['inventory.items.purchaseprice.manage', 'Set item purchase prices', 'إدخال وتعديل أسعار شراء الأصناف', 'inventory'],
  ['inventory.items.saleprice.manage', 'Set item sale prices', 'إدخال وتعديل أسعار بيع الأصناف', 'inventory'],
  ['inventory.cost.manage', 'Enter inventory valuation costs', 'إدخال تكاليف التقييم المخزني', 'inventory'],
  // A barcode is an identifier, so changing one is guarded separately from
  // editing the item's descriptive fields. Generating a code is a write too.
  ['inventory.barcodes.manage', 'Edit and generate barcodes', 'تعديل وتوليد أكواد الباركود', 'inventory'],
  ['inventory.stock.adjust', 'Adjust, transfer and count stock', 'تسويات وتحويلات وجرد المخزون', 'inventory'],
  // Lots are a separate privilege from the stock card. Receiving a lot is
  // recording what arrived; issuing one is selling or consuming it; destroying
  // one is a decision about the company's money, so it stands alone.
  ['inventory.batches.read', 'View lots, expiry dates and traceability', 'عرض الدفعات وتواريخ الصلاحية والتتبع', 'inventory'],
  ['inventory.batches.receive', 'Receive lots and record their dates', 'استلام الدفعات وتسجيل تواريخها', 'inventory'],
  ['inventory.batches.issue', 'Issue stock from lots', 'صرف المخزون من الدفعات', 'inventory'],
  ['inventory.batches.writeoff', 'Write off and destroy lots', 'إعدام وإتلاف الدفعات', 'inventory'],
  ['inventory.batches.transfer', 'Move lots between warehouses', 'تحويل الدفعات بين المخازن', 'inventory'],
  // Selling expired goods is a decision somebody signs for, not a checkbox on
  // the invoice. It is separate from issuing because the person who keys the
  // sale is rarely the person who may give away a lot that has gone off.
  ['inventory.batches.expired.issue', 'Sell expired lots with a recorded approval', 'صرف دفعات منتهية الصلاحية باعتماد مسجّل', 'inventory'],
  // Counting is four separate acts: opening a session, walking it, approving
  // the difference and booking it. A storekeeper counts; a manager approves.
  ['inventory.stocktake.read', 'View stock-take sessions', 'عرض جلسات الجرد', 'inventory'],
  ['inventory.stocktake.create', 'Open and cancel stock-take sessions', 'فتح وإلغاء جلسات الجرد', 'inventory'],
  ['inventory.stocktake.count', 'Record counted quantities', 'تسجيل الكميات الفعلية', 'inventory'],
  ['inventory.stocktake.approve', 'Approve stock-take differences', 'اعتماد فروق الجرد', 'inventory'],
  ['inventory.stocktake.post', 'Post the adjustment of an approved count', 'ترحيل تسوية الجرد المعتمد', 'inventory'],
  // A write-off is a loss with a document, an approver and a number of its own.
  ['inventory.writeoff.read', 'View write-off documents', 'عرض مستندات الإعدام', 'inventory'],
  ['inventory.writeoff.create', 'Record a write-off', 'تسجيل مستند إعدام', 'inventory'],
  ['inventory.writeoff.approve', 'Approve a write-off', 'اعتماد مستند الإعدام', 'inventory'],
  ['inventory.writeoff.post', 'Post and reverse a write-off', 'ترحيل وعكس مستند الإعدام', 'inventory'],
  // Which warehouses a person may work in, and what they may do there.
  ['inventory.warehouse.access.read', 'View per-user warehouse access', 'عرض صلاحيات المخازن للمستخدمين', 'inventory'],
  ['inventory.warehouse.access.manage', 'Grant and revoke warehouse access', 'منح وسحب صلاحيات المخازن', 'inventory'],
  // The notification centre is program-wide: these are not inventory codes,
  // and a user who is told nothing needs no more than reading.
  ['notifications.read', 'View notifications', 'عرض التنبيهات', 'notifications'],
  ['notifications.manage', 'Configure notification rules', 'إعداد قواعد التنبيهات', 'notifications'],
  ['sales.invoices.export', 'Export sales documents', 'تصدير مستندات البيع', 'sales'],
  ['purchases.invoices.export', 'Export purchase documents', 'تصدير مستندات الشراء', 'purchases'],
  ['reports.export', 'Export reports', 'تصدير التقارير', 'reports']
];
