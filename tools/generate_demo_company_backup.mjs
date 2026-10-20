/**
 * Generates a realistic, verified, interconnected company JSON backup for ERP_KAYAN.
 *
 * Conforms strictly to BackupFile interface in backend/src/modules/backup/backup.service.ts:
 * - format: "kayan-backup"
 * - version: 1
 * - Balanced journal entries (totalDebit === totalCredit)
 * - Demo login: admin / Admin@12345; accountant / Admin@12345
 * - Complete Chart of Accounts with parent hierarchy
 * - Branches, fiscal period, roles, users, items, stock, sales, and purchases
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const argon2 = require('argon2');

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = join(here, '..');

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_HQ_ID = '22222222-2222-4222-8222-222222222201';
const BRANCH_ALX_ID = '22222222-2222-4222-8222-222222222202';
const ROLE_ADMIN_ID = '33333333-3333-4333-8333-333333333301';
const ROLE_ACCT_ID = '33333333-3333-4333-8333-333333333302';
const USER_ADMIN_ID = '44444444-4444-4444-8444-444444444401';
const USER_ACCT_ID = '44444444-4444-4444-8444-444444444402';
const FISCAL_PERIOD_ID = '55555555-5555-4555-8555-555555555501';

// Accounts
const ACC_ASSETS = '66666666-6666-4666-8666-666666666601';
const ACC_CURR_ASSETS = '66666666-6666-4666-8666-666666666602';
const ACC_CASH = '66666666-6666-4666-8666-666666666603';
const ACC_BANK = '66666666-6666-4666-8666-666666666604';
const ACC_AR = '66666666-6666-4666-8666-666666666605';
const ACC_INVENTORY = '66666666-6666-4666-8666-666666666606';
const ACC_VAT_IN = '66666666-6666-4666-8666-666666666607';
const ACC_NON_CURR_ASSETS = '66666666-6666-4666-8666-666666666608';
const ACC_EQUIPMENT = '66666666-6666-4666-8666-666666666609';

const ACC_LIABILITIES = '66666666-6666-4666-8666-666666666610';
const ACC_AP = '66666666-6666-4666-8666-666666666611';
const ACC_VAT_OUT = '66666666-6666-4666-8666-666666666612';

const ACC_EQUITY = '66666666-6666-4666-8666-666666666620';
const ACC_CAPITAL = '66666666-6666-4666-8666-666666666621';
const ACC_RETAINED = '66666666-6666-4666-8666-666666666622';

const ACC_REVENUE = '66666666-6666-4666-8666-666666666630';
const ACC_SALES = '66666666-6666-4666-8666-666666666631';

const ACC_EXPENSES = '66666666-6666-4666-8666-666666666640';
const ACC_COGS = '66666666-6666-4666-8666-666666666641';
const ACC_SALARIES = '66666666-6666-4666-8666-666666666642';
const ACC_RENT = '66666666-6666-4666-8666-666666666643';

// Customers & Suppliers
const CUST_1_ID = '77777777-7777-4777-8777-777777777701';
const CUST_2_ID = '77777777-7777-4777-8777-777777777702';
const SUPP_1_ID = '88888888-8888-4888-8888-888888888801';
const SUPP_2_ID = '88888888-8888-4888-8888-888888888802';

// Items
const ITEM_1_ID = '99999999-9999-4999-8999-999999999901';
const ITEM_2_ID = '99999999-9999-4999-8999-999999999902';
const ITEM_3_ID = '99999999-9999-4999-8999-999999999903';

// Journals & Invoices
const JOURNAL_1_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
const JOURNAL_2_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02';
const SALES_INV_1_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01';
const PURCH_INV_1_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';

const now = new Date('2026-10-12T10:00:00.000Z').toISOString();

export function generateDemoBackup() {
  const branches = [
    {
      id: BRANCH_HQ_ID,
      companyId: COMPANY_ID,
      code: 'MAIN',
      nameEn: 'Head Office - Dokki',
      nameAr: 'المركز الرئيسي - الدقي',
      isActive: true,
      kind: 'HEADQUARTERS',
      parentBranchId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: BRANCH_ALX_ID,
      companyId: COMPANY_ID,
      code: 'ALX',
      nameEn: 'Alexandria Branch',
      nameAr: 'فرع الإسكندرية',
      isActive: true,
      kind: 'BRANCH',
      parentBranchId: BRANCH_HQ_ID,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const roles = [
    {
      id: ROLE_ADMIN_ID,
      companyId: COMPANY_ID,
      code: 'ADMIN',
      nameEn: 'System Administrator',
      nameAr: 'مدير النظام',
      isSystem: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ROLE_ACCT_ID,
      companyId: COMPANY_ID,
      code: 'ACCOUNTANT',
      nameEn: 'Chief Accountant',
      nameAr: 'كبير المحاسبين',
      isSystem: false,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const rolePermissions = [
    // Permission IDs are installation-local. Carry the stable permission code
    // beside each ID so a company JSON restore can remap it safely.
    {
      roleId: ROLE_ADMIN_ID,
      permissionId: '00000000-0000-4000-8000-000000000001',
      permissionCode: 'accounting.accounts.read',
    },
    {
      roleId: ROLE_ADMIN_ID,
      permissionId: '00000000-0000-4000-8000-000000000002',
      permissionCode: 'accounting.accounts.create',
    },
    {
      roleId: ROLE_ACCT_ID,
      permissionId: '00000000-0000-4000-8000-000000000001',
      permissionCode: 'accounting.accounts.read',
    },
  ];

  const users = [
    {
      id: USER_ADMIN_ID,
      companyId: COMPANY_ID,
      username: 'admin',
      email: 'admin@kayan-erp.local',
      fullNameEn: 'System Administrator',
      fullNameAr: 'مدير النظام المالي',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$+74on6554NwUppnFg5r85w$10AECDDGGLlb3m1D2/eA+LiIQVn3AH9kvXc2jJ/ZDZ0',
      isActive: true,
      isSuperAdmin: true,
      failedLoginCount: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: USER_ACCT_ID,
      companyId: COMPANY_ID,
      username: 'accountant',
      email: 'accountant@kayan-erp.local',
      fullNameEn: 'Chief Accountant',
      fullNameAr: 'محاسب عام',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$+74on6554NwUppnFg5r85w$10AECDDGGLlb3m1D2/eA+LiIQVn3AH9kvXc2jJ/ZDZ0',
      isActive: true,
      isSuperAdmin: false,
      failedLoginCount: 0,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const userRoles = [
    { userId: USER_ADMIN_ID, roleId: ROLE_ADMIN_ID, companyId: COMPANY_ID, branchId: null },
    { userId: USER_ACCT_ID, roleId: ROLE_ACCT_ID, companyId: COMPANY_ID, branchId: null },
  ];

  const userBranches = [
    { userId: USER_ADMIN_ID, branchId: BRANCH_HQ_ID },
    { userId: USER_ADMIN_ID, branchId: BRANCH_ALX_ID },
    { userId: USER_ACCT_ID, branchId: BRANCH_HQ_ID },
  ];

  const fiscalPeriods = [
    {
      id: FISCAL_PERIOD_ID,
      companyId: COMPANY_ID,
      code: 'FY2026',
      nameEn: 'Fiscal Year 2026',
      nameAr: 'السنة المالية 2026',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-12-31T23:59:59.000Z',
      status: 'OPEN',
      createdAt: now,
      updatedAt: now,
    },
  ];

  // Chart of accounts (Hierarchical)
  const accounts = [
    // 1 Assets
    { id: ACC_ASSETS, companyId: COMPANY_ID, code: '1', nameEn: 'Assets', nameAr: 'الأصول', type: 'ASSET', parentId: null, isPostable: false, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },
    { id: ACC_CURR_ASSETS, companyId: COMPANY_ID, code: '11', nameEn: 'Current Assets', nameAr: 'الأصول المتداولة', type: 'ASSET', parentId: ACC_ASSETS, isPostable: false, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },
    { id: ACC_CASH, companyId: COMPANY_ID, code: '1101', nameEn: 'Cash on Hand', nameAr: 'النقدية بالصندوق', type: 'ASSET', parentId: ACC_CURR_ASSETS, isPostable: true, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },
    { id: ACC_BANK, companyId: COMPANY_ID, code: '1102', nameEn: 'Bank Account - CIB', nameAr: 'البنك التجاري الدولي', type: 'ASSET', parentId: ACC_CURR_ASSETS, isPostable: true, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },
    { id: ACC_AR, companyId: COMPANY_ID, code: '1103', nameEn: 'Accounts Receivable', nameAr: 'العملاء (المدينون)', type: 'ASSET', parentId: ACC_CURR_ASSETS, isPostable: true, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },
    { id: ACC_INVENTORY, companyId: COMPANY_ID, code: '1104', nameEn: 'Merchandise Inventory', nameAr: 'مخزون بضاعة بغرض البيع', type: 'ASSET', parentId: ACC_CURR_ASSETS, isPostable: true, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },
    { id: ACC_VAT_IN, companyId: COMPANY_ID, code: '1105', nameEn: 'VAT Receivable (Input Tax)', nameAr: 'ضريبة القيمة المضافة - مدخلات', type: 'ASSET', parentId: ACC_CURR_ASSETS, isPostable: true, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },
    { id: ACC_NON_CURR_ASSETS, companyId: COMPANY_ID, code: '12', nameEn: 'Non-Current Assets', nameAr: 'الأصول غير المتداولة', type: 'ASSET', parentId: ACC_ASSETS, isPostable: false, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },
    { id: ACC_EQUIPMENT, companyId: COMPANY_ID, code: '1201', nameEn: 'Equipment & Computers', nameAr: 'أجهزة ومعدات حاسوب', type: 'ASSET', parentId: ACC_NON_CURR_ASSETS, isPostable: true, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },

    // 2 Liabilities
    { id: ACC_LIABILITIES, companyId: COMPANY_ID, code: '2', nameEn: 'Liabilities', nameAr: 'الالتزامات', type: 'LIABILITY', parentId: null, isPostable: false, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },
    { id: ACC_AP, companyId: COMPANY_ID, code: '2101', nameEn: 'Accounts Payable', nameAr: 'الموردون (الدائنون)', type: 'LIABILITY', parentId: ACC_LIABILITIES, isPostable: true, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },
    { id: ACC_VAT_OUT, companyId: COMPANY_ID, code: '2103', nameEn: 'VAT Payable (Output Tax)', nameAr: 'ضريبة القيمة المضافة - مخرجات', type: 'LIABILITY', parentId: ACC_LIABILITIES, isPostable: true, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },

    // 3 Equity
    { id: ACC_EQUITY, companyId: COMPANY_ID, code: '3', nameEn: 'Equity', nameAr: 'حقوق الملكية', type: 'EQUITY', parentId: null, isPostable: false, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },
    { id: ACC_CAPITAL, companyId: COMPANY_ID, code: '3101', nameEn: 'Paid-in Capital', nameAr: 'رأس المال المدفوع', type: 'EQUITY', parentId: ACC_EQUITY, isPostable: true, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },
    { id: ACC_RETAINED, companyId: COMPANY_ID, code: '3102', nameEn: 'Retained Earnings', nameAr: 'الأرباح المحتجزة', type: 'EQUITY', parentId: ACC_EQUITY, isPostable: true, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },

    // 4 Revenue
    { id: ACC_REVENUE, companyId: COMPANY_ID, code: '4', nameEn: 'Revenue', nameAr: 'الإيرادات', type: 'REVENUE', parentId: null, isPostable: false, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },
    { id: ACC_SALES, companyId: COMPANY_ID, code: '4101', nameEn: 'Sales Revenue', nameAr: 'إيرادات المبيعات', type: 'REVENUE', parentId: ACC_REVENUE, isPostable: true, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },

    // 5 Expenses
    { id: ACC_EXPENSES, companyId: COMPANY_ID, code: '5', nameEn: 'Expenses', nameAr: 'المصروفات', type: 'EXPENSE', parentId: null, isPostable: false, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },
    { id: ACC_COGS, companyId: COMPANY_ID, code: '5101', nameEn: 'Cost of Goods Sold', nameAr: 'تكلفة البضاعة المباعة', type: 'EXPENSE', parentId: ACC_EXPENSES, isPostable: true, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },
    { id: ACC_SALARIES, companyId: COMPANY_ID, code: '5102', nameEn: 'Salaries & Wages', nameAr: 'الرواتب والأجور', type: 'EXPENSE', parentId: ACC_EXPENSES, isPostable: true, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },
    { id: ACC_RENT, companyId: COMPANY_ID, code: '5103', nameEn: 'Rent Expense', nameAr: 'إيجار المكاتب والفروع', type: 'EXPENSE', parentId: ACC_EXPENSES, isPostable: true, isActive: true, currency: 'EGP', createdAt: now, updatedAt: now },
  ];

  const customers = [
    {
      id: CUST_1_ID,
      companyId: COMPANY_ID,
      code: 'CUST-001',
      nameEn: 'Al Nour Trading Co.',
      nameAr: 'شركة النور للتجارة والتوريدات',
      phone: '+20 100 123 4567',
      email: 'info@alnour-trade.eg',
      taxNumber: '100-234-567',
      address: 'القاهرة - مدينة نصر',
      creditLimit: '100000.0000',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: CUST_2_ID,
      companyId: COMPANY_ID,
      code: 'CUST-002',
      nameEn: 'Al Amal Contracting',
      nameAr: 'مؤسسة الأمل للمقاولات العامة',
      phone: '+20 101 987 6543',
      email: 'contact@alamal-build.eg',
      taxNumber: '200-345-678',
      address: 'الجيزة - المهندسين',
      creditLimit: '150000.0000',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const suppliers = [
    {
      id: SUPP_1_ID,
      companyId: COMPANY_ID,
      code: 'SUPP-001',
      nameEn: 'Al Ahram Supplies Group',
      nameAr: 'مجموعة الأهرام للتوريدات الهندسية',
      phone: '+20 2 2589 1122',
      email: 'orders@ahram-group.eg',
      taxNumber: '300-456-789',
      address: 'القاهرة - العاشر من رمضان',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: SUPP_2_ID,
      companyId: COMPANY_ID,
      code: 'SUPP-002',
      nameEn: 'Delta Tech Distribution',
      nameAr: 'دلتا تك لتوزيع الإلكترونيات',
      phone: '+20 3 4877 6655',
      email: 'sales@deltatech.eg',
      taxNumber: '400-567-890',
      address: 'الإسكندرية - سموحة',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const items = [
    {
      id: ITEM_1_ID,
      companyId: COMPANY_ID,
      code: 'ITEM-MONITOR-27',
      nameEn: 'IPS Display Monitor 27 inch 4K',
      nameAr: 'شاشة عرض 27 بوصة 4K IPS',
      unit: 'قطعة',
      barcode: '6221000123456',
      salePrice: '9500.0000',
      taxRate: '14.0000',
      isStockTracked: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ITEM_2_ID,
      companyId: COMPANY_ID,
      code: 'ITEM-KB-MECH',
      nameEn: 'Wireless Mechanical Keyboard RGB',
      nameAr: 'لوحة مفاتيح ميكانيكية لاسلكية RGB',
      unit: 'قطعة',
      barcode: '6221000234567',
      salePrice: '1850.0000',
      taxRate: '14.0000',
      isStockTracked: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: ITEM_3_ID,
      companyId: COMPANY_ID,
      code: 'ITEM-PRINTER-LASER',
      nameEn: 'Laser Multi-Function Network Printer',
      nameAr: 'طابعة ليزر متعددة الوظائف شبكية',
      unit: 'قطعة',
      barcode: '6221000345678',
      salePrice: '14500.0000',
      taxRate: '14.0000',
      isStockTracked: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const stockBalances = [
    { companyId: COMPANY_ID, branchId: BRANCH_HQ_ID, itemId: ITEM_1_ID, quantity: '25.0000', value: '187500.0000', updatedAt: now },
    { companyId: COMPANY_ID, branchId: BRANCH_HQ_ID, itemId: ITEM_2_ID, quantity: '60.0000', value: '78000.0000', updatedAt: now },
    { companyId: COMPANY_ID, branchId: BRANCH_HQ_ID, itemId: ITEM_3_ID, quantity: '10.0000', value: '110000.0000', updatedAt: now },
    { companyId: COMPANY_ID, branchId: BRANCH_ALX_ID, itemId: ITEM_1_ID, quantity: '15.0000', value: '112500.0000', updatedAt: now },
  ];

  const stockMovements = [
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd01',
      companyId: COMPANY_ID,
      branchId: BRANCH_HQ_ID,
      itemId: ITEM_1_ID,
      movementDate: '2026-02-01T00:00:00.000Z',
      direction: 'IN',
      quantity: '30.0000',
      unitCost: '7500.0000',
      totalCost: '225000.0000',
      referenceType: 'PURCHASE_INVOICE',
      referenceId: PURCH_INV_1_ID,
      referenceNumber: 'PI-2026-0001',
      notes: 'استلام بضاعة فاتورة مشتريات رقم PI-2026-0001',
      createdAt: now,
      createdBy: USER_ADMIN_ID,
    },
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd02',
      companyId: COMPANY_ID,
      branchId: BRANCH_HQ_ID,
      itemId: ITEM_1_ID,
      movementDate: '2026-02-15T00:00:00.000Z',
      direction: 'OUT',
      quantity: '5.0000',
      unitCost: '7500.0000',
      totalCost: '37500.0000',
      referenceType: 'SALES_INVOICE',
      referenceId: SALES_INV_1_ID,
      referenceNumber: 'SI-2026-0001',
      notes: 'صرف بضاعة فاتورة مبيعات رقم SI-2026-0001',
      createdAt: now,
      createdBy: USER_ADMIN_ID,
    },
  ];

  // Perfectly balanced Journal Entries
  // Entry 1: Capital deposit (Debit Bank 500,000, Credit Capital 500,000)
  // Entry 2: Sales Invoice posting (Debit AR 54,150, Credit Sales 47,500, Credit VAT Out 6,650)
  const journalEntries = [
    {
      id: JOURNAL_1_ID,
      companyId: COMPANY_ID,
      branchId: BRANCH_HQ_ID,
      entryNumber: 'JE-2026-0001',
      entryDate: '2026-01-01T00:00:00.000Z',
      description: 'قيد إيداع رأس المال الافتتاحي في بنك CIB',
      status: 'POSTED',
      currency: 'EGP',
      totalDebit: '500000.0000',
      totalCredit: '500000.0000',
      postedAt: now,
      postedBy: USER_ADMIN_ID,
      createdAt: now,
      updatedAt: now,
      createdBy: USER_ADMIN_ID,
    },
    {
      id: JOURNAL_2_ID,
      companyId: COMPANY_ID,
      branchId: BRANCH_HQ_ID,
      entryNumber: 'JE-2026-0002',
      entryDate: '2026-02-15T00:00:00.000Z',
      description: 'إثبات مبيعات فاتورة رقم SI-2026-0001 لشركة النور',
      status: 'POSTED',
      currency: 'EGP',
      totalDebit: '54150.0000',
      totalCredit: '54150.0000',
      postedAt: now,
      postedBy: USER_ADMIN_ID,
      createdAt: now,
      updatedAt: now,
      createdBy: USER_ADMIN_ID,
    },
  ];

  const journalLines = [
    // Entry 1 lines
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',
      journalEntryId: JOURNAL_1_ID,
      lineNumber: 1,
      accountId: ACC_BANK,
      debit: '500000.0000',
      credit: '0.0000',
      description: 'إيداع نقدي بالبنك',
    },
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02',
      journalEntryId: JOURNAL_1_ID,
      lineNumber: 2,
      accountId: ACC_CAPITAL,
      debit: '0.0000',
      credit: '500000.0000',
      description: 'رأس مال المساهمين',
    },
    // Entry 2 lines
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03',
      journalEntryId: JOURNAL_2_ID,
      lineNumber: 1,
      accountId: ACC_AR,
      debit: '54150.0000',
      credit: '0.0000',
      description: 'استحقاق قيمة الفاتورة على شركة النور',
    },
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04',
      journalEntryId: JOURNAL_2_ID,
      lineNumber: 2,
      accountId: ACC_SALES,
      debit: '0.0000',
      credit: '47500.0000',
      description: 'إيراد بيع 5 شاشات 27 بوصة',
    },
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee05',
      journalEntryId: JOURNAL_2_ID,
      lineNumber: 3,
      accountId: ACC_VAT_OUT,
      debit: '0.0000',
      credit: '6650.0000',
      description: 'ضريبة القيمة المضافة 14%',
    },
  ];

  const salesInvoices = [
    {
      id: SALES_INV_1_ID,
      companyId: COMPANY_ID,
      branchId: BRANCH_HQ_ID,
      invoiceNumber: 'SI-2026-0001',
      invoiceDate: '2026-02-15T00:00:00.000Z',
      dueDate: '2026-03-15T00:00:00.000Z',
      customerId: CUST_1_ID,
      status: 'POSTED',
      currency: 'EGP',
      subTotal: '47500.0000',
      taxAmount: '6650.0000',
      totalAmount: '54150.0000',
      paidAmount: '0.0000',
      costOfGoods: '37500.0000',
      notes: 'توريد شاشات عرض مكتبية للفرع الرئيسي',
      journalEntryId: JOURNAL_2_ID,
      postedAt: now,
      postedBy: USER_ADMIN_ID,
      createdAt: now,
      updatedAt: now,
      createdBy: USER_ADMIN_ID,
    },
  ];

  const salesInvoiceLines = [
    {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffff01',
      invoiceId: SALES_INV_1_ID,
      lineNumber: 1,
      itemId: ITEM_1_ID,
      description: 'شاشة عرض 27 بوصة 4K IPS',
      quantity: '5.0000',
      unitPrice: '9500.0000',
      taxRate: '14.0000',
      taxAmount: '6650.0000',
      lineTotal: '54150.0000',
      unitCost: '7500.0000',
      costTotal: '37500.0000',
    },
  ];

  const purchaseInvoices = [
    {
      id: PURCH_INV_1_ID,
      companyId: COMPANY_ID,
      branchId: BRANCH_HQ_ID,
      invoiceNumber: 'PI-2026-0001',
      supplierReference: 'AHRAM-INV-889',
      invoiceDate: '2026-02-01T00:00:00.000Z',
      dueDate: '2026-03-01T00:00:00.000Z',
      supplierId: SUPP_1_ID,
      status: 'POSTED',
      currency: 'EGP',
      subTotal: '225000.0000',
      taxAmount: '31500.0000',
      totalAmount: '256500.0000',
      paidAmount: '256500.0000',
      notes: 'شراء دفعة شاشات عرض 27 بوصة',
      journalEntryId: null,
      postedAt: now,
      postedBy: USER_ADMIN_ID,
      createdAt: now,
      updatedAt: now,
      createdBy: USER_ADMIN_ID,
    },
  ];

  const purchaseInvoiceLines = [
    {
      id: '10101010-1010-4010-8010-101010101001',
      invoiceId: PURCH_INV_1_ID,
      lineNumber: 1,
      itemId: ITEM_1_ID,
      description: 'شاشة عرض 27 بوصة 4K IPS',
      quantity: '30.0000',
      unitPrice: '7500.0000',
      taxRate: '14.0000',
      taxAmount: '31500.0000',
      lineTotal: '256500.0000',
    },
  ];

  const documentSequences = [
    { id: '20202020-2020-4020-8020-202020202001', companyId: COMPANY_ID, prefix: 'SI', year: 2026, lastNumber: 1, updatedAt: now },
    { id: '20202020-2020-4020-8020-202020202002', companyId: COMPANY_ID, prefix: 'PI', year: 2026, lastNumber: 1, updatedAt: now },
    { id: '20202020-2020-4020-8020-202020202003', companyId: COMPANY_ID, prefix: 'JE', year: 2026, lastNumber: 2, updatedAt: now },
    { id: '20202020-2020-4020-8020-202020202004', companyId: COMPANY_ID, prefix: 'STK', year: 2026, lastNumber: 2, updatedAt: now },
  ];

  const auditLogs = [
    {
      id: '30303030-3030-4030-8030-303030303001',
      companyId: COMPANY_ID,
      userId: USER_ADMIN_ID,
      action: 'CREATE',
      entity: 'company_data',
      entityId: COMPANY_ID,
      createdAt: now,
      after: { event: 'Company initialized with standard books' },
    },
    {
      id: '30303030-3030-4030-8030-303030303002',
      companyId: COMPANY_ID,
      userId: USER_ADMIN_ID,
      action: 'POST',
      entity: 'sales_invoice',
      entityId: SALES_INV_1_ID,
      createdAt: now,
      after: { invoiceNumber: 'SI-2026-0001', totalAmount: '54150.0000' },
    },
  ];

  const tables = {
    branch: branches,
    role: roles,
    rolePermission: rolePermissions,
    user: users,
    userRole: userRoles,
    userBranch: userBranches,
    fiscalPeriod: fiscalPeriods,
    account: accounts,
    customer: customers,
    supplier: suppliers,
    item: items,
    stockBalance: stockBalances,
    stockMovement: stockMovements,
    journalEntry: journalEntries,
    journalLine: journalLines,
    salesInvoice: salesInvoices,
    salesInvoiceLine: salesInvoiceLines,
    purchaseInvoice: purchaseInvoices,
    purchaseInvoiceLine: purchaseInvoiceLines,
    documentSequence: documentSequences,
    auditLog: auditLogs,
  };

  const counts = {};
  for (const [key, rows] of Object.entries(tables)) {
    if (rows.length > 0) counts[key] = rows.length;
  }

  return {
    format: 'kayan-backup',
    version: 1,
    createdAt: now,
    companyId: COMPANY_ID,
    companyCode: 'DEMO',
    companyName: 'شركة كيان للحلول والتجارة (بيانات تجريبية)',
    companyProfile: {
      nameEn: 'KAYAN Demo Trading Company',
      nameAr: 'شركة كيان للحلول والتجارة (بيانات تجريبية)',
      taxId: '000000000000000',
      commercialRegistration: null,
      addressEn: 'Dokki, Giza, Egypt',
      addressAr: 'الدقي، الجيزة، مصر',
      phone: '+20 2 0000 0000',
      email: 'demo@kayan-erp.local',
      address: 'Dokki, Giza, Egypt',
      currency: 'EGP',
      timezone: 'Africa/Cairo',
      logoBase64: null,
      logoMime: null,
    },
    counts,
    tables,
  };
}

// Generate and verify the demo login hashes with the same Argon2 library the
// real authentication endpoint uses. This prevents shipping a backup whose
// user rows exist but whose password hashes can never be used to sign in.
const backup = generateDemoBackup();
for (const user of backup.tables.user) {
  if (!(await argon2.verify(user.passwordHash, 'Admin@12345'))) {
    throw new Error('Demo password hash is invalid for user ' + user.username);
  }
}
const outDir = join(rootDir, 'backend', 'dist-demo');
mkdirSync(outDir, { recursive: true });

const targetFile = join(outDir, 'kayan-company-backup-demo.json');
writeFileSync(targetFile, JSON.stringify(backup, null, 2), 'utf8');

console.log(`Successfully generated demo company JSON backup at:\n  ${targetFile}`);
console.log(`Total tables: ${Object.keys(backup.tables).length}`);
console.log(`Total records: ${Object.values(backup.counts).reduce((a, b) => a + b, 0)}`);
