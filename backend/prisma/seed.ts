/**
 * Seeds a development dataset.
 *
 * Creates one company, one branch, the permission catalogue, two roles and an
 * administrator, plus a standard chart of accounts.
 *
 * The seed is idempotent: re-running it will not duplicate records.
 *
 * REQUIRES BUSINESS DECISION: the chart of accounts below is a conventional
 * starting template, not an approved Egyptian statutory chart. It must be
 * reviewed by an accountant before real use.
 *
 * Never run this against a production database.
 */
import { AccountType, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const PERMISSIONS: Array<[string, string, string, string]> = [
  ['accounting.accounts.read', 'View chart of accounts', 'عرض دليل الحسابات', 'accounting'],
  ['accounting.accounts.create', 'Create expense accounts', 'إنشاء حسابات مصروفات', 'accounting'],
  ['accounting.accounts.update', 'Update expense accounts', 'تعديل حسابات المصروفات', 'accounting'],
  ['accounting.journal.read', 'View journal entries', 'عرض القيود اليومية', 'accounting'],
  ['accounting.journal.create', 'Create journal entries', 'إنشاء قيود يومية', 'accounting'],
  ['accounting.journal.post', 'Post and reverse entries', 'ترحيل وعكس القيود', 'accounting'],
  ['admin.users.manage', 'Manage users', 'إدارة المستخدمين', 'admin'],
  ['admin.roles.manage', 'Manage roles', 'إدارة الأدوار', 'admin'],
  ['admin.audit.read', 'View audit trail', 'عرض سجل التدقيق', 'admin'],
  ['admin.backup', 'Take and restore backups', 'أخذ واسترجاع نسخة احتياطية', 'admin'],
  ['company.profile.manage', 'Manage company profile', 'إدارة بيانات الشركة', 'admin'],

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

  ['accounting.periods.read', 'View fiscal periods', 'عرض الفترات المالية', 'accounting'],
  ['accounting.periods.manage', 'Manage fiscal periods', 'إدارة الفترات المالية', 'accounting'],

];

const ACCOUNTS: Array<{
  code: string;
  nameEn: string;
  nameAr: string;
  type: AccountType;
  parent?: string;
  postable: boolean;
}> = [
  { code: '1', nameEn: 'Assets', nameAr: 'الأصول', type: AccountType.ASSET, postable: false },
  { code: '11', nameEn: 'Current assets', nameAr: 'الأصول المتداولة', type: AccountType.ASSET, parent: '1', postable: false },
  { code: '1101', nameEn: 'Cash on hand', nameAr: 'النقدية بالصندوق', type: AccountType.ASSET, parent: '11', postable: true },
  { code: '1102', nameEn: 'Bank — current account', nameAr: 'البنك - الحساب الجاري', type: AccountType.ASSET, parent: '11', postable: true },
  { code: '1103', nameEn: 'Accounts receivable', nameAr: 'العملاء (المدينون)', type: AccountType.ASSET, parent: '11', postable: true },
  { code: '1104', nameEn: 'Inventory', nameAr: 'المخزون', type: AccountType.ASSET, parent: '11', postable: true },
  { code: '1105', nameEn: 'VAT receivable', nameAr: 'ضريبة القيمة المضافة - مدخلات', type: AccountType.ASSET, parent: '11', postable: true },
  { code: '12', nameEn: 'Non-current assets', nameAr: 'الأصول غير المتداولة', type: AccountType.ASSET, parent: '1', postable: false },
  { code: '1201', nameEn: 'Furniture and fixtures', nameAr: 'الأثاث والتجهيزات', type: AccountType.ASSET, parent: '12', postable: true },
  { code: '1202', nameEn: 'Vehicles', nameAr: 'السيارات', type: AccountType.ASSET, parent: '12', postable: true },
  { code: '1203', nameEn: 'Accumulated depreciation', nameAr: 'مجمع الإهلاك', type: AccountType.ASSET, parent: '12', postable: true },

  { code: '2', nameEn: 'Liabilities', nameAr: 'الالتزامات', type: AccountType.LIABILITY, postable: false },
  { code: '2101', nameEn: 'Accounts payable', nameAr: 'الموردون (الدائنون)', type: AccountType.LIABILITY, parent: '2', postable: true },
  { code: '2102', nameEn: 'Accrued expenses', nameAr: 'مصروفات مستحقة', type: AccountType.LIABILITY, parent: '2', postable: true },
  { code: '2103', nameEn: 'VAT payable', nameAr: 'ضريبة القيمة المضافة - مخرجات', type: AccountType.LIABILITY, parent: '2', postable: true },
  { code: '2104', nameEn: 'Salaries payable', nameAr: 'رواتب مستحقة', type: AccountType.LIABILITY, parent: '2', postable: true },

  { code: '3', nameEn: 'Equity', nameAr: 'حقوق الملكية', type: AccountType.EQUITY, postable: false },
  { code: '3101', nameEn: 'Capital', nameAr: 'رأس المال', type: AccountType.EQUITY, parent: '3', postable: true },
  { code: '3102', nameEn: 'Retained earnings', nameAr: 'الأرباح المحتجزة', type: AccountType.EQUITY, parent: '3', postable: true },

  { code: '4', nameEn: 'Revenue', nameAr: 'الإيرادات', type: AccountType.REVENUE, postable: false },
  { code: '4101', nameEn: 'Sales revenue', nameAr: 'إيرادات المبيعات', type: AccountType.REVENUE, parent: '4', postable: true },
  { code: '4102', nameEn: 'Sales returns', nameAr: 'مردودات المبيعات', type: AccountType.REVENUE, parent: '4', postable: true },
  { code: '4103', nameEn: 'Other income', nameAr: 'إيرادات أخرى', type: AccountType.REVENUE, parent: '4', postable: true },

  { code: '5', nameEn: 'Expenses', nameAr: 'المصروفات', type: AccountType.EXPENSE, postable: false },
  { code: '5101', nameEn: 'Cost of goods sold', nameAr: 'تكلفة المبيعات', type: AccountType.EXPENSE, parent: '5', postable: true },
  { code: '5102', nameEn: 'Salaries and wages', nameAr: 'الرواتب والأجور', type: AccountType.EXPENSE, parent: '5', postable: true },
  { code: '5103', nameEn: 'Rent', nameAr: 'الإيجار', type: AccountType.EXPENSE, parent: '5', postable: true },
  { code: '5104', nameEn: 'Utilities', nameAr: 'المرافق والخدمات', type: AccountType.EXPENSE, parent: '5', postable: true },
  { code: '5105', nameEn: 'Depreciation expense', nameAr: 'مصروف الإهلاك', type: AccountType.EXPENSE, parent: '5', postable: true },
  { code: '5106', nameEn: 'Professional fees', nameAr: 'أتعاب مهنية', type: AccountType.EXPENSE, parent: '5', postable: true },
];

async function main(): Promise<void> {
  console.log('Seeding development data…');

  const company = await prisma.company.upsert({
    where: { code: 'KAYAN' },
    update: {},
    create: {
      code: 'KAYAN',
      nameEn: 'Kayan Company',
      nameAr: 'شركة كيان',
      currency: 'EGP',
      timezone: 'Africa/Cairo',
    },
  });

  const branch = await prisma.branch.upsert({
    where: { companyId_code: { companyId: company.id, code: 'MAIN' } },
    update: {},
    create: {
      companyId: company.id,
      code: 'MAIN',
      nameEn: 'Head Office',
      nameAr: 'المركز الرئيسي',
    },
  });

  for (const [code, nameEn, nameAr, module] of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: { nameEn, nameAr, module },
      create: { code, nameEn, nameAr, module },
    });
  }

  const adminRole = await prisma.role.upsert({
    where: { companyId_code: { companyId: company.id, code: 'ADMIN' } },
    update: {},
    create: {
      companyId: company.id,
      code: 'ADMIN',
      nameEn: 'Administrator',
      nameAr: 'مدير النظام',
      isSystem: true,
    },
  });

  const accountantRole = await prisma.role.upsert({
    where: { companyId_code: { companyId: company.id, code: 'ACCOUNTANT' } },
    update: {},
    create: {
      companyId: company.id,
      code: 'ACCOUNTANT',
      nameEn: 'Accountant',
      nameAr: 'محاسب',
      isSystem: true,
    },
  });

  const all = await prisma.permission.findMany();
  for (const p of all) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: adminRole.id, permissionId: p.id },
      },
      update: {},
      create: { roleId: adminRole.id, permissionId: p.id },
    });
  }
  // REQUIRES BUSINESS DECISION: the matrix below is a starting point, not a
  // company rule. It is editable at any time from the roles screen, where the
  // owner decides who may do what.
  //
  // The accountant keeps the books: the ledger, the parties, the stock and the
  // reports. Sales and purchase invoices are added read-only, because
  // reconciling receivables and payables needs to see them — raising and
  // posting invoices belongs to whoever runs sales and purchasing.
  const accountantModules = ['accounting', 'parties', 'inventory', 'reports'];
  const accountantReadOnly = ['sales.invoices.read', 'purchases.invoices.read'];
  for (const p of all.filter(
    (p) => accountantModules.includes(p.module) || accountantReadOnly.includes(p.code),
  )) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: accountantRole.id, permissionId: p.id },
      },
      update: {},
      create: { roleId: accountantRole.id, permissionId: p.id },
    });
  }

  // Who the administrator is, and with what password.
  //
  // On a developer's machine these are the familiar defaults. A packaged
  // installation never uses them: the program asks whoever is setting the
  // company up to choose a username and a password, and passes them here
  // through the environment. No password is ever hardcoded in application
  // source, and none ships inside the program.
  const adminUsername = process.env.KAYAN_ADMIN_USERNAME?.trim() || 'admin';
  const adminPassword = process.env.KAYAN_ADMIN_PASSWORD || 'Admin@12345';
  const isDevelopmentDefault = adminUsername === 'admin' && adminPassword === 'Admin@12345';
  const passwordHash = await argon2.hash(adminPassword);

  const admin = await prisma.user.upsert({
    where: { username: adminUsername },
    update: {},
    create: {
      companyId: company.id,
      username: adminUsername,
      fullNameEn: 'System Administrator',
      fullNameAr: 'مدير النظام',
      passwordHash,
      isSuperAdmin: true,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId_companyId: {
        userId: admin.id,
        roleId: adminRole.id,
        companyId: company.id,
      },
    },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id, companyId: company.id },
  });

  await prisma.userBranch.upsert({
    where: { userId_branchId: { userId: admin.id, branchId: branch.id } },
    update: {},
    create: { userId: admin.id, branchId: branch.id },
  });

  // Chart of accounts: parents first so foreign keys resolve.
  const sorted = [...ACCOUNTS].sort((a, b) => a.code.length - b.code.length);
  const idByCode = new Map<string, string>();
  for (const a of sorted) {
    const account = await prisma.account.upsert({
      where: { companyId_code: { companyId: company.id, code: a.code } },
      update: {},
      create: {
        companyId: company.id,
        code: a.code,
        nameEn: a.nameEn,
        nameAr: a.nameAr,
        type: a.type,
        isPostable: a.postable,
        parentId: a.parent ? (idByCode.get(a.parent) ?? null) : null,
      },
    });
    idByCode.set(a.code, account.id);
  }

  // REQUIRES BUSINESS DECISION: the fiscal year below follows the calendar
  // year, which is the usual Egyptian default. A company whose year starts in
  // July closes this period and creates the one it actually uses.
  const year = new Date().getUTCFullYear();
  const period = await prisma.fiscalPeriod.upsert({
    where: { companyId_code: { companyId: company.id, code: `FY${year}` } },
    update: {},
    create: {
      companyId: company.id,
      code: `FY${year}`,
      nameEn: `Fiscal year ${year}`,
      nameAr: `السنة المالية ${year}`,
      startDate: new Date(Date.UTC(year, 0, 1)),
      endDate: new Date(Date.UTC(year, 11, 31)),
    },
  });

  console.log('---------------------------------------------');
  console.log(' company  : %s (%s)', company.nameEn, company.code);
  console.log(' branch   : %s (%s)', branch.nameEn, branch.code);
  console.log(' accounts : %d', idByCode.size);
  console.log(' period   : %s (%s)', period.code, period.status);
  console.log(' users    : %s', adminUsername);
  console.log('---------------------------------------------');
  if (isDevelopmentDefault) {
    // Printed for local development convenience only.
    console.log(' password : %s   (development default)', adminPassword);
    console.log('Change this password before any real use.');
  } else {
    // The password came from whoever ran this, so it is not echoed back into a
    // log file that other people can read.
    console.log(' password : the one that was just entered');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
