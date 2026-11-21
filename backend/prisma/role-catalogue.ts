/**
 * The roles the program ships with.
 *
 * One list, shared by the development seed, the start-up bootstrap and the
 * tests, so the three can never disagree about what "مدير مبيعات" may do.
 *
 * Each role names permission *prefixes* rather than 40 codes by hand:
 * `sales.` means every sales permission, `cash.vouchers.` only the vouchers.
 * The list is expanded against the catalogue in `permissions.ts`, and a test
 * fails if a prefix matches nothing — a typo would otherwise turn a manager
 * into a person who can open nothing at all.
 *
 * Codes ADMin and ACCOUNTANT are the two roles existing installations already
 * have, and they keep their codes on purpose: a user who holds ACCOUNTANT today
 * holds ACCOUNTANT after the upgrade, with no row rewritten and no session
 * invalidated by the migration itself.
 */

export type RoleCategory =
  | 'MANAGEMENT'
  | 'FINANCE'
  | 'SALES'
  | 'PURCHASING'
  | 'INVENTORY'
  | 'CASH'
  | 'AUDIT'
  | 'CUSTOM';

export interface RoleDefinition {
  code: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  category: RoleCategory;
  /** `*` means every permission the program has. */
  permissions: string[];
  /**
   * Seeded roles are marked `isSystem`: they cannot be deleted and their code
   * cannot change, but a company may still tune what they may do — a business
   * that wants its accountant to post journals should not have to fork the
   * role to do it.
   */
  seeded: boolean;
}

export const CUSTOM_ROLE_CODE = 'CUSTOM';

export const ROLE_CATALOGUE: readonly RoleDefinition[] = [
  {
    code: 'ADMIN',
    nameEn: 'System administrator',
    nameAr: 'مدير النظام',
    descriptionEn: 'Every permission, including users, roles, licence and backups.',
    descriptionAr: 'كل الصلاحيات، بما فيها المستخدمون والأدوار والترخيص والنسخ الاحتياطي.',
    category: 'MANAGEMENT',
    permissions: ['*'],
    seeded: true,
  },
  {
    code: 'GENERAL_MANAGER',
    nameEn: 'General manager',
    nameAr: 'مدير عام',
    descriptionEn: 'Sees the whole business and approves what others prepare; does not administer users or backups.',
    descriptionAr: 'يرى العمل كله ويعتمد ما يعده الآخرون، دون إدارة المستخدمين أو النسخ الاحتياطي.',
    category: 'MANAGEMENT',
    permissions: [
      'dashboard.',
      'reports.',
      'notifications.',
      'inventory.cost.read',
      'sales.orders.approve',
      'purchases.orders.approve',
      'inventory.stock.approve',
      'inventory.writeoff.approve',
      'inventory.stocktake.approve',
      'accounting.journal.approve',
      'accounting.periods.close',
      'admin.audit.read',
      '.read',
    ],
    seeded: true,
  },
  {
    code: 'FINANCE_MANAGER',
    nameEn: 'Finance manager',
    nameAr: 'مدير مالي',
    descriptionEn: 'Owns the books, the cash and the bank, and sees cost and profit.',
    descriptionAr: 'يملك الحسابات والخزينة والبنوك، ويرى التكلفة والربح.',
    category: 'FINANCE',
    permissions: [
      'accounting.',
      'cash.',
      'reports.',
      'dashboard.financial',
      'inventory.cost.read',
      'admin.audit.read',
      'notifications.',
      'sales.invoices.read',
      'purchases.invoices.read',
      'parties.customers.read',
      'parties.suppliers.read',
      'inventory.stock.read',
    ],
    seeded: true,
  },
  {
    code: 'ACCOUNTANT',
    nameEn: 'Accountant',
    nameAr: 'محاسب',
    descriptionEn: 'Keeps the books: journal, accounts, periods, cost centres, fixed assets and cash vouchers.',
    descriptionAr: 'يمسك الدفاتر: القيود والحسابات والفترات ومراكز التكلفة والأصول الثابتة وسندات الخزينة.',
    category: 'FINANCE',
    permissions: [
      'accounting.accounts.',
      'accounting.journal.read',
      'accounting.journal.create',
      'accounting.journal.post',
      'accounting.periods.',
      'accounting.costcenters.',
      'accounting.budgets.',
      'accounting.openingbalances.',
      'accounting.fixedassets.',
      'cash.vouchers.',
      'cash.accounts.read',
      'cash.reports.read',
      'parties.customers.read',
      'parties.suppliers.read',
      'reports.read',
      'reports.print',
      'reports.export',
      'inventory.stock.read',
      'inventory.items.read',
      'sales.invoices.read',
      'purchases.invoices.read',
      'dashboard.view',
      'dashboard.financial',
      'dashboard.charts',
      'dashboard.sales',
      'dashboard.purchases',
      'dashboard.receivables',
      'dashboard.payables',
      'dashboard.stock',
      'dashboard.top',
      'dashboard.recent',
      'notifications.read',
    ],
    seeded: true,
  },
  {
    code: 'SALES_MANAGER',
    nameEn: 'Sales manager',
    nameAr: 'مدير مبيعات',
    descriptionEn: 'Runs sales: invoices, orders, quotations, returns and the customer list.',
    descriptionAr: 'يدير المبيعات: الفواتير والأوامر وعروض الأسعار والمرتجعات وقائمة العملاء.',
    category: 'SALES',
    permissions: [
      'sales.',
      'sales.price.read',
      'parties.customers.',
      'inventory.items.read',
      'inventory.stock.read',
      'inventory.batches.read',
      'reports.',
      'dashboard.view',
      'dashboard.sales',
      'dashboard.receivables',
      'dashboard.charts',
      'dashboard.top',
      'dashboard.recent',
      'notifications.',
    ],
    seeded: true,
  },
  {
    code: 'SALES_CLERK',
    nameEn: 'Sales clerk',
    nameAr: 'موظف مبيعات',
    descriptionEn: 'Prepares sales invoices, orders and quotations; cannot post or reverse them.',
    descriptionAr: 'يُعِد فواتير البيع والأوامر وعروض الأسعار، ولا يملك ترحيلها أو عكسها.',
    category: 'SALES',
    permissions: [
      'sales.invoices.read',
      'sales.invoices.create',
      'sales.price.read',
      'sales.orders.read',
      'sales.orders.create',
      'sales.orders.manage',
      'sales.quotations.read',
      'sales.quotations.manage',
      'sales.quotations.convert',
      'sales.returns.read',
      'sales.print',
      'parties.customers.read',
      'parties.customers.create',
      'parties.customers.update',
      'inventory.items.read',
      'inventory.stock.read',
      'inventory.batches.read',
      'dashboard.view',
      'dashboard.sales',
      'notifications.read',
    ],
    seeded: true,
  },
  {
    code: 'PURCHASING_MANAGER',
    nameEn: 'Purchasing manager',
    nameAr: 'مدير مشتريات',
    descriptionEn: 'Runs purchasing: invoices, orders, returns and the supplier list.',
    descriptionAr: 'يدير المشتريات: الفواتير والأوامر والمرتجعات وقائمة الموردين.',
    category: 'PURCHASING',
    permissions: [
      'purchases.',
      'purchases.price.read',
      'parties.suppliers.',
      'inventory.items.read',
      'inventory.stock.read',
      'reports.',
      'dashboard.view',
      'dashboard.purchases',
      'dashboard.payables',
      'dashboard.charts',
      'dashboard.top',
      'dashboard.recent',
      'notifications.',
    ],
    seeded: true,
  },
  {
    code: 'PURCHASING_CLERK',
    nameEn: 'Purchasing clerk',
    nameAr: 'موظف مشتريات',
    descriptionEn: 'Prepares purchase invoices and orders; cannot post them.',
    descriptionAr: 'يُعِد فواتير الشراء والأوامر، ولا يملك ترحيلها.',
    category: 'PURCHASING',
    permissions: [
      'purchases.invoices.read',
      'purchases.invoices.create',
      'purchases.price.read',
      'purchases.orders.read',
      'purchases.orders.create',
      'purchases.orders.manage',
      'purchases.returns.read',
      'purchases.print',
      'parties.suppliers.read',
      'inventory.items.read',
      'inventory.stock.read',
      'dashboard.view',
      'dashboard.purchases',
      'notifications.read',
    ],
    seeded: true,
  },
  {
    code: 'WAREHOUSE_MANAGER',
    nameEn: 'Warehouse manager',
    nameAr: 'مدير مخازن',
    descriptionEn: 'Every stock permission, including adjustments, write-offs and approvals.',
    descriptionAr: 'كل صلاحيات المخزون، بما فيها التسويات والإعدام والاعتماد.',
    category: 'INVENTORY',
    permissions: [
      'inventory.',
      'reports.read',
      'reports.print',
      'dashboard.view',
      'dashboard.stock',
      'notifications.manage',
    ],
    seeded: true,
  },
  {
    code: 'STOREKEEPER',
    nameEn: 'Storekeeper',
    nameAr: 'أمين مخزن',
    descriptionEn: 'Receives, issues and transfers stock in the warehouses he is given; cannot approve or adjust.',
    descriptionAr: 'يستلم ويصرف ويحوّل المخزون في المخازن المصرح له بها، ولا يعتمد أو يسوّي.',
    category: 'INVENTORY',
    permissions: [
      'inventory.items.read',
      'inventory.stock.read',
      'inventory.stock.voucher.create',
      'inventory.stock.voucher.post',
      'accounting.costcenters.read',
      'inventory.batches.read',
      'inventory.batches.receive',
      'inventory.batches.issue',
      'inventory.batches.transfer',
      'inventory.stocktake.read',
      'inventory.stocktake.count',
      'inventory.writeoff.read',
      'inventory.writeoff.create',
      'inventory.warehouses.read',
      'inventory.export',
      'dashboard.view',
      'dashboard.stock',
      'notifications.read',
    ],
    seeded: true,
  },
  {
    code: 'STOCK_AUDITOR',
    nameEn: 'Stock auditor',
    nameAr: 'مسؤول جرد',
    descriptionEn: 'Counts and reconciles stock: stock takes and their posting, without selling or buying.',
    descriptionAr: 'يجرد ويطابق المخزون: الجرد وترحيله، دون بيع أو شراء.',
    category: 'INVENTORY',
    permissions: [
      'inventory.stocktake.',
      'inventory.stock.read',
      'inventory.items.read',
      'inventory.batches.read',
      'inventory.writeoff.read',
      'inventory.warehouses.read',
      'reports.read',
      'dashboard.view',
      'notifications.read',
    ],
    seeded: true,
  },
  {
    code: 'TREASURER',
    nameEn: 'Treasurer',
    nameAr: 'أمين خزينة',
    descriptionEn: 'Receipts and payments: cash vouchers, their posting and the cash reports.',
    descriptionAr: 'المقبوضات والمدفوعات: سندات الخزينة وترحيلها وتقارير الخزينة.',
    category: 'CASH',
    permissions: [
      'cash.vouchers.',
      'cash.accounts.read',
      'cash.reports.read',
      'parties.customers.read',
      'parties.suppliers.read',
      'sales.invoices.read',
      'purchases.invoices.read',
      'dashboard.view',
      'dashboard.cash',
      'dashboard.movements',
      'notifications.read',
    ],
    seeded: true,
  },
  {
    code: 'BANK_OFFICER',
    nameEn: 'Bank officer',
    nameAr: 'مسؤول بنوك',
    descriptionEn: 'Bank accounts and reconciliation; no inventory and no user administration.',
    descriptionAr: 'الحسابات البنكية والمطابقات، دون مخزون أو إدارة مستخدمين.',
    category: 'CASH',
    permissions: [
      'cash.accounts.',
      'cash.reconcile',
      'cash.vouchers.read',
      'cash.reports.read',
      'dashboard.view',
      'dashboard.cash',
      'notifications.read',
    ],
    seeded: true,
  },
  {
    code: 'COLLECTION_OFFICER',
    nameEn: 'Collections officer',
    nameAr: 'مسؤول تحصيل',
    descriptionEn: 'Chases receivables and records receipts against invoices.',
    descriptionAr: 'يتابع المستحقات ويسجل المقبوضات على الفواتير.',
    category: 'CASH',
    permissions: [
      'sales.invoices.read',
      'cash.vouchers.read',
      'cash.vouchers.create',
      'parties.customers.read',
      'reports.read',
      'dashboard.view',
      'dashboard.receivables',
      'dashboard.movements',
      'notifications.read',
    ],
    seeded: true,
  },
  {
    code: 'INTERNAL_AUDITOR',
    nameEn: 'Internal auditor',
    nameAr: 'مراجع داخلي',
    descriptionEn: 'Reads everything and sees the audit trail; changes nothing.',
    descriptionAr: 'يقرأ كل شيء ويرى سجل التدقيق، ولا يغيّر شيئًا.',
    category: 'AUDIT',
    permissions: ['admin.audit.read', 'reports.export', '.read', 'notifications.read'],
    seeded: true,
  },
  {
    code: 'REPORT_USER',
    nameEn: 'Reports officer',
    nameAr: 'مسؤول تقارير',
    descriptionEn: 'Builds, prints and exports reports from data he may read.',
    descriptionAr: 'يبني ويطبع ويصدّر التقارير من بيانات يصرح له بقراءتها.',
    category: 'AUDIT',
    permissions: ['reports.', 'dashboard.', 'notifications.read', '.read'],
    seeded: true,
  },
  {
    code: 'READ_ONLY',
    nameEn: 'Read-only user',
    nameAr: 'مستخدم للقراءة فقط',
    descriptionEn: 'Looks at screens and reports and cannot change a single row.',
    descriptionAr: 'يطلع على الشاشات والتقارير ولا يغيّر أي صف.',
    category: 'CUSTOM',
    permissions: ['.read', 'dashboard.view', 'notifications.read'],
    seeded: true,
  },
  {
    code: CUSTOM_ROLE_CODE,
    nameEn: 'Custom role',
    nameAr: 'دور مخصص',
    descriptionEn: 'A starting point with no permissions; name it and tick what it may do.',
    descriptionAr: 'نقطة بداية بلا صلاحيات؛ سمّه وحدد ما يملكه.',
    category: 'CUSTOM',
    permissions: [],
    // Not seeded: a company creates it when it needs one, and the roles screen
    // offers it as a template that creates a real, editable role.
    seeded: false,
  },
];

/// Prefixes that end a permission code rather than a module name.
const EXACT_PREFIXES = new Set(['*', '.read']);

/**
 * Expands the prefixes of one role against the permission catalogue.
 *
 * `sales.` matches `sales.invoices.read`; `.read` matches every code that ends
 * in `.read` (any module's read permission); `*` matches everything.
 */
export function permissionsForRole(
  definition: Pick<RoleDefinition, 'permissions'>,
  catalogue: readonly string[],
): string[] {
  const wanted = new Set<string>();
  for (const prefix of definition.permissions) {
    if (prefix === '*') {
      for (const code of catalogue) wanted.add(code);
      continue;
    }
    if (prefix === '.read') {
      for (const code of catalogue) if (code.endsWith('.read')) wanted.add(code);
      continue;
    }
    for (const code of catalogue) {
      if (code === prefix || code.startsWith(prefix)) wanted.add(code);
    }
  }
  return [...wanted].sort();
}

/// The roles an installation should have, ready to be written.
export function seededRoles(catalogue: readonly string[]): Array<{
  code: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  category: RoleCategory;
  permissions: string[];
}> {
  return ROLE_CATALOGUE.filter((role) => role.seeded).map((role) => ({
    code: role.code,
    nameEn: role.nameEn,
    nameAr: role.nameAr,
    descriptionEn: role.descriptionEn,
    descriptionAr: role.descriptionAr,
    category: role.category,
    permissions: permissionsForRole(role, catalogue),
  }));
}

export { EXACT_PREFIXES };
