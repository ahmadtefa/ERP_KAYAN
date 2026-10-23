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
import { PrismaPg } from '@prisma/adapter-pg';
import { AccountType, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

import { PERMISSIONS } from './permissions';

// The client runs on the plain `pg` driver (engine-less Prisma runtime), so
// the seed opens its connection the same way the server does.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});


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
  { code: '3103', nameEn: 'Opening balance equity', nameAr: 'أرصدة افتتاحية', type: AccountType.EQUITY, parent: '3', postable: true },

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
  { code: '5107', nameEn: 'Inventory differences', nameAr: 'فروق المخزون', type: AccountType.EXPENSE, parent: '5', postable: true },
];

/// What kind of image these bytes really are — the same rule the logo
/// endpoint enforces: the content decides, never the file name.
function sniffImage(bytes: Buffer): string | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length > 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

async function main(): Promise<void> {
  console.log('Seeding development data…');

  // The company comes from the environment when a setup dialog collected it
  // (the desktop installer passes these through); otherwise the familiar
  // development defaults.
  const companyCode = process.env.KAYAN_COMPANY_CODE?.trim() || 'KAYAN';
  const company = await prisma.company.upsert({
    where: { code: companyCode },
    update: {},
    create: {
      code: companyCode,
      nameEn: process.env.KAYAN_COMPANY_NAME_EN?.trim() || 'Kayan Company',
      nameAr: process.env.KAYAN_COMPANY_NAME_AR?.trim() || 'شركة كيان',
      phone: process.env.KAYAN_COMPANY_PHONE?.trim() || null,
      email: process.env.KAYAN_COMPANY_EMAIL?.trim() || null,
      address: process.env.KAYAN_COMPANY_ADDRESS?.trim() || null,
      currency: 'EGP',
      timezone: 'Africa/Cairo',
    },
  });

  // The initial unit (headquarters or branch) the setup dialog named
  // (desktop first-run passes these through the environment), or the familiar defaults.
  const facilityKind = process.env.KAYAN_FACILITY_KIND?.trim() === 'BRANCH' ? 'BRANCH' : 'HEADQUARTERS';
  const defaultUnitCode = facilityKind === 'BRANCH' ? 'BR01' : 'MAIN';
  const defaultUnitNameEn = facilityKind === 'BRANCH' ? 'Branch' : 'Head Office';
  const defaultUnitNameAr = facilityKind === 'BRANCH' ? 'الفرع' : 'المركز الرئيسي';

  const hqCode = (process.env.KAYAN_UNIT_CODE || process.env.KAYAN_HQ_CODE)?.trim() || defaultUnitCode;
  const branch = await prisma.branch.upsert({
    where: { companyId_code: { companyId: company.id, code: hqCode } },
    update: { kind: facilityKind },
    create: {
      companyId: company.id,
      code: hqCode,
      nameEn: (process.env.KAYAN_UNIT_NAME_EN || process.env.KAYAN_HQ_NAME_EN)?.trim() || defaultUnitNameEn,
      nameAr: (process.env.KAYAN_UNIT_NAME_AR || process.env.KAYAN_HQ_NAME_AR)?.trim() || defaultUnitNameAr,
      kind: facilityKind,
    },
  });

  // A first-run company is created after migrations have already run, so
  // it cannot rely on the historical warehouse backfill. Keep seed runs
  // idempotent and ensure its branch always has one active default warehouse.
  const defaultWarehouse = await prisma.warehouse.findFirst({
    where: { companyId: company.id, branchId: branch.id, isDefault: true, deletedAt: null },
    select: { id: true, isActive: true },
  });
  if (defaultWarehouse) {
    if (!defaultWarehouse.isActive) {
      await prisma.warehouse.update({
        where: { id: defaultWarehouse.id },
        data: { isActive: true },
      });
    }
  } else {
    const existingWarehouse = await prisma.warehouse.findFirst({
      where: { companyId: company.id, branchId: branch.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existingWarehouse) {
      await prisma.warehouse.update({
        where: { id: existingWarehouse.id },
        data: { isDefault: true, isActive: true },
      });
    } else {
      const baseWarehouseCode = `${branch.code}-MAIN`;
      const codeClash = await prisma.warehouse.findFirst({
        where: { companyId: company.id, code: baseWarehouseCode },
        select: { id: true },
      });
      const warehouseCode = codeClash
        ? `${baseWarehouseCode}-${branch.id.slice(0, 8).toUpperCase()}`
        : baseWarehouseCode;
      await prisma.warehouse.create({
        data: {
          companyId: company.id,
          branchId: branch.id,
          code: warehouseCode,
          nameEn: `${branch.nameEn} main store`,
          nameAr: `${branch.nameAr} - المخزن الرئيسي`,
          isDefault: true,
          isActive: true,
        },
      });
    }
  }

  // The company logo, when the setup dialog picked one: it travels as a file
  // the shell wrote to a temporary folder (an image does not belong in an
  // environment variable), and the same content rules apply as on the logo
  // endpoint: real PNG/JPEG/WebP bytes, magic numbers checked, 2 MB maximum.
  const logoFile = process.env.KAYAN_COMPANY_LOGO_FILE?.trim();
  if (logoFile) {
    const { existsSync, readFileSync, statSync } = await import('node:fs');
    if (existsSync(logoFile) && statSync(logoFile).size <= 2 * 1024 * 1024) {
      const bytes = readFileSync(logoFile);
      const mime = sniffImage(bytes);
      if (mime) {
        await prisma.company.update({
          where: { id: company.id },
          data: { logoData: bytes, logoMime: mime },
        });
        console.log('Company logo stored from the setup dialog.');
      } else {
        console.warn('The chosen logo is not a real PNG/JPEG/WebP image; skipped.');
      }
    }
  }

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
  // The accountant keeps the books: the ledger, the parties, the stock, the
  // cash and bank accounts, and the reports. Sales and purchase invoices are
  // added read-only, because reconciling receivables and payables needs to see
  // them — raising and posting invoices belongs to whoever runs sales and
  // purchasing.
  //
  // Cash belongs here because a receipt or a payment is a bookkeeping entry:
  // without it an accountant signed in with the seeded role cannot open the
  // cash screen at all, which is what made those screens look broken.
  const accountantModules = [
    'accounting',
    'parties',
    'inventory',
    'cash',
    'reports',
  ];
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

  // The upsert above only sets `isSuperAdmin` when it *creates* the account.
  // An installation whose administrator row already exists without the flag
  // (restored from an archive, say) would keep it missing forever — and with
  // it, the program-reset and full-backup screens, which no screen can grant
  // back. Seeding runs on install and repair, so this is where the invariant
  // "the seeded company always has a super administrator" is restored: only
  // when the company has none, and only onto the account this seed owns.
  const superAdmins = await prisma.user.count({
    where: { companyId: company.id, isSuperAdmin: true, isActive: true, deletedAt: null },
  });
  if (superAdmins === 0) {
    await prisma.user.update({
      where: { id: admin.id },
      data: { isSuperAdmin: true, isActive: true, deletedAt: null },
    });
  }

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
