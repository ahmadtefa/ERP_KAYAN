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
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

import { PERMISSIONS } from './permissions';
import { EIGHT_DIGIT_STARTER_ACCOUNTS, LEGACY_STARTER_ACCOUNTS } from './starter-chart';

const SEED_LEGACY_CHART = process.env.KAYAN_SEED_ACCOUNT_CODE_SCHEME === 'LEGACY';
import { seededRoles } from './role-catalogue';

// The client runs on the plain `pg` driver (engine-less Prisma runtime), so
// the seed opens its connection the same way the server does.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});



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
      accountCodeScheme: SEED_LEGACY_CHART ? 'LEGACY' : 'EIGHT_DIGIT',
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

  // Every role the program ships with, from the one list the roles screen and
  // the start-up bootstrap also read. ADMIN and ACCOUNTANT keep their codes so
  // that an upgrade never rewrites an assignment or a session.
  const permissionRows = await prisma.permission.findMany();
  const permissionIdByCode = new Map(permissionRows.map((row) => [row.code, row.id]));
  let adminRoleId: string | null = null;
  for (const definition of seededRoles(PERMISSIONS.map(([code]) => code))) {
    const role = await prisma.role.upsert({
      where: { companyId_code: { companyId: company.id, code: definition.code } },
      update: {
        nameEn: definition.nameEn,
        nameAr: definition.nameAr,
        descriptionEn: definition.descriptionEn,
        descriptionAr: definition.descriptionAr,
        category: definition.category,
      },
      create: {
        companyId: company.id,
        code: definition.code,
        nameEn: definition.nameEn,
        nameAr: definition.nameAr,
        descriptionEn: definition.descriptionEn,
        descriptionAr: definition.descriptionAr,
        category: definition.category,
        isSystem: true,
      },
    });
    if (definition.code === 'ADMIN') adminRoleId = role.id;
    for (const code of definition.permissions) {
      const permissionId = permissionIdByCode.get(code);
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      });
    }
  }
  if (!adminRoleId) throw new Error('The ADMIN role was not seeded');
  const adminRole = { id: adminRoleId };

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
    where: { companyId_username: { companyId: company.id, username: adminUsername } },
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

  // An account created here is an account like any other: it consumes one
  // seat. The packaged installer creates the first administrator through this
  // program rather than through the setup endpoint, so without this a
  // five-seat licence would allow six accounts on every fresh installation.
  // The row is skipped when the account already has one - the licensing
  // migration backfills accounts that existed before it, and setup.service
  // reserves the same seat when it revives this account itself.
  const existingSeat = await prisma.licenseSeatUsage.findFirst({
    where: { userId: admin.id },
    select: { id: true },
  });
  if (!existingSeat) {
    await prisma.licenseSeatUsage.create({
      data: {
        userId: admin.id,
        username: admin.username,
        reason: 'SETUP_ADMIN',
        idempotencyKey: `setup:${company.id}:${admin.username}`,
      },
    });
  }

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
  const sorted = [...(SEED_LEGACY_CHART ? LEGACY_STARTER_ACCOUNTS : EIGHT_DIGIT_STARTER_ACCOUNTS)].sort((a, b) => a.code.length - b.code.length);
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
