import {
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AccountType, BranchKind, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

import { AuditService } from '../../common/audit/audit.service';
import { LicensingService } from '../licensing/licensing.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { normalizeLogo } from './company.service';
import { PERMISSIONS } from '../../../prisma/permissions';
import { loadAccountCodeScheme } from '../accounting/account-code-scheme';
import { EIGHT_DIGIT_STARTER_ACCOUNTS } from '../../../prisma/starter-chart';
import { InitialSetupDto } from './dto/company.dto';

/**
 * The first-run setup.
 *
 * A new installation has tables but no company, no people and no chart of
 * accounts. This service fills all of that in one transaction: either the
 * installation comes up complete, or nothing changed and the next attempt can
 * run again. Retrying after a dropped connection therefore never produces two
 * companies or two headquarters — a second attempt finds the first one's work
 * and says so.
 *
 * When companies already exist the door is closed: setup is a one-time act,
 * and everything afterwards goes through the normal, permissioned screens.
 */
@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly licensing: LicensingService,
  ) {}

  async status() {
    const [companies, users, activeCompanyUsers, retiredCompany] = await Promise.all([
      // A retired company is not a set-up installation. The reset marks the
      // row deleted precisely so setup can be completed again against it, and
      // the settings screen promises the operator exactly that ("the program
      // will ask to be set up again"). Counting retired rows here contradicted
      // that promise and sent the operator to authorised recovery instead.
      this.prisma.company.count({ where: { deletedAt: null } }),
      // Include retired accounts too: the public setup endpoint refuses any user row.
      this.prisma.user.count(),
      this.prisma.user.count({ where: { deletedAt: null, isActive: true, company: { deletedAt: null } } }),
      // A reset keeps the company row, marked deleted, so setup can be
      // completed against it again. Its presence is what separates "the
      // operator just reset this installation" from "there are user rows and
      // no company at all", which is a damaged database and real recovery.
      this.prisma.company.findFirst({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: 'desc' },
        select: { id: true },
      }),
    ]);
    // Setup is open only on a pristine installation: no company (live or
    // retired) and no account. User rows with no live company are recovery,
    // never setup, and so is a live company that lost every usable account.
    return {
      needsSetup: companies === 0 && users === 0 && retiredCompany === null,
      recoveryRequired: companies === 0 ? users > 0 : activeCompanyUsers === 0,
      companyCount: companies,
      hasUsers: users > 0,
    };
  }

  async initialSetup(dto: InitialSetupDto, ip?: string, userAgent?: string) {
    // This endpoint is public so a genuinely empty installation can be
    // initialized. It must never become an account-recovery endpoint: any
    // existing account, live company or retired company closes it, so a
    // stranger cannot adopt somebody's users or data.
    const [companyRows, userRows, retiredCompany] = await Promise.all([
      this.prisma.company.count({ where: { deletedAt: null } }),
      this.prisma.user.count(),
      this.prisma.company.findFirst({
        where: { deletedAt: { not: null } },
        select: { id: true },
      }),
    ]);
    if (companyRows > 0 || userRows > 0 || retiredCompany !== null) {
      throw new ConflictException({ code: 'SETUP_CLOSED', message: 'This installation already contains company or user data. Initial setup is closed; use the approved recovery process.' });
    }
    let logo: { data: Uint8Array<ArrayBuffer>; mime: string } | null = null;
    if (dto.logoBase64) {
      const buffer = Buffer.from(dto.logoBase64, 'base64');
      logo = await normalizeLogo(buffer, dto.logoMime ?? 'image/png');
    }

    const passwordHash = await argon2.hash(dto.adminPassword);

    const result = await this.prisma.$transaction(async (tx) => {
      // Serialize concurrent first-run requests across application processes;
      // the authoritative company check must occur after acquiring the lock.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(172895144, 485772)`);
      // Repeat the check only after acquiring the transaction-scoped lock.
      const [existingCompanies, existingUsers, retiredInTransaction] = await Promise.all([
        tx.company.count({ where: { deletedAt: null } }),
        tx.user.count(),
        tx.company.findFirst({ where: { deletedAt: { not: null } }, select: { id: true } }),
      ]);
      if (existingCompanies > 0 || existingUsers > 0 || retiredInTransaction !== null) {
        throw new ConflictException({ code: 'SETUP_CLOSED', message: 'This installation already contains company or user data. Initial setup is closed; use the approved recovery process.' });
      }

      const { company, hq, admin } = await this.provisionCompany(tx, dto, {
        logo,
        passwordHash,
        // The first company's administrator is the installation's top administrator.
        isSuperAdmin: true,
      });

      await this.audit.recordRequired({
        companyId: company.id,
        userId: admin.id,
        action: 'CREATE',
        entity: 'companies',
        entityId: company.id,
        after: {
          code: company.code,
          nameEn: company.nameEn,
          nameAr: company.nameAr,
          hq: hq.code,
          adminUsername: admin.username,
        },
        ipAddress: ip ?? null,
        userAgent: userAgent ?? null,
      }, tx);

      // The first-run administrator is always a newly-created account and
      // therefore consumes a seat after the required audit record succeeds.
      await this.licensing.reserveSeat(tx, {
        userId: admin.id,
        username: admin.username,
        reason: 'SETUP_ADMIN',
        idempotencyKey: `setup:${company.id}:${admin.username}`,
      });

      return { company, hq, admin };
    }, { maxWait: 10000, timeout: 30000 });

    return {
      companyId: result.company.id,
      companyCode: result.company.code,
      headquartersId: result.hq.id,
      adminUsername: result.admin.username,
    };
  }

  /// Whether this installation may hold more than one company. The switch is a row
  /// that no API writes; it stays off until the vendor-licensed activation path owns it.
  async multiCompanyEnabled(q: { $queryRaw: <T>(sql: Prisma.Sql) => Promise<T> } = this.prisma as never): Promise<boolean> {
    const rows = await q.$queryRaw<Array<{ enabled: boolean }>>(
      Prisma.sql`SELECT enabled FROM installation_flags WHERE key = 'multi_company'`,
    );
    return rows[0]?.enabled === true;
  }

  /// Adds a company to a running installation. Only the program administrator may call it
  /// (the controller guards that) and only while the multi-company switch is on. The new
  /// company's first administrator belongs to that company alone: never a program administrator.
  async createCompany(dto: InitialSetupDto, actor: { userId: string; companyId: string }, ip?: string, userAgent?: string) {
    if (!(await this.multiCompanyEnabled())) {
      throw new ConflictException({ code: 'COMPANY_CREATE_DISABLED', message: 'This installation is not licensed for more than one company.' });
    }
    let logo: { data: Uint8Array<ArrayBuffer>; mime: string } | null = null;
    if (dto.logoBase64) {
      logo = await normalizeLogo(Buffer.from(dto.logoBase64, 'base64'), dto.logoMime ?? 'image/png');
    }
    const passwordHash = await argon2.hash(dto.adminPassword);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(172895144, 485774)`);
      // Checked again under the lock: the switch may have been turned off since the first look.
      if (!(await this.multiCompanyEnabled(tx as never))) {
        throw new ConflictException({ code: 'COMPANY_CREATE_DISABLED', message: 'This installation is not licensed for more than one company.' });
      }
      const clash = await tx.company.findFirst({ where: { code: { equals: dto.companyCode, mode: 'insensitive' } }, select: { id: true } });
      if (clash) {
        throw new ConflictException({ code: 'COMPANY_CODE_TAKEN', message: 'A company with this code already exists.' });
      }
      const created = await this.provisionCompany(tx, dto, { logo, passwordHash, isSuperAdmin: false });
      await this.audit.recordRequired({
        companyId: created.company.id,
        userId: actor.userId,
        action: 'CREATE',
        entity: 'companies',
        entityId: created.company.id,
        after: {
          code: created.company.code,
          nameEn: created.company.nameEn,
          nameAr: created.company.nameAr,
          adminUsername: created.admin.username,
          createdFromCompanyId: actor.companyId,
        },
        ipAddress: ip ?? null,
        userAgent: userAgent ?? null,
      }, tx);
      return created;
    }, { maxWait: 10000, timeout: 30000 });
    return {
      companyId: result.company.id,
      companyCode: result.company.code,
      headquartersId: result.hq.id,
      adminUsername: result.admin.username,
    };
  }

  /// Everything a new company needs, inside the caller's transaction: the
  /// company, its head office and default warehouse, the permission catalogue,
  /// its two starter roles, its first administrator, the fiscal period and the
  /// chart of accounts. The caller decides who may call it and records the
  /// audit entry and the seat. `isSuperAdmin` is true only for the first
  /// company of an installation: the administrator of a later company is the
  /// administrator of that company alone.
  async provisionCompany(
    tx: Prisma.TransactionClient,
    input: InitialSetupDto,
    options: {
      logo: { data: Uint8Array<ArrayBuffer>; mime: string } | null;
      passwordHash: string;
      isSuperAdmin: boolean;
    },
  ) {
      // The request's own code and names are what the operator is entering.
      const profile = {
        code: input.companyCode,
        nameEn: input.companyNameEn,
        nameAr: input.companyNameAr,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        logoData: options.logo?.data ?? null,
        logoMime: options.logo?.mime ?? null,
      };
      const company = await tx.company.create({ data: { ...profile, accountCodeScheme: 'EIGHT_DIGIT' } });

      const isBranch = input.facilityKind === 'BRANCH';
      const unitKind = isBranch ? BranchKind.BRANCH : BranchKind.HEADQUARTERS;
      const unitCode = input.unitCode ?? input.hqCode ?? (isBranch ? 'BR01' : 'MAIN');
      const unitNameEn = input.unitNameEn ?? input.hqNameEn ?? (isBranch ? 'Branch' : 'Head Office');
      const unitNameAr = input.unitNameAr ?? input.hqNameAr ?? (isBranch ? 'الفرع' : 'المركز الرئيسي');

      const hq = await tx.branch.create({
        data: {
          companyId: company.id,
          code: unitCode,
          nameEn: unitNameEn,
          nameAr: unitNameAr,
          kind: unitKind,
        },
      });

      // The first-run setup creates its branch after migrations have run,
      // so it must establish the branch's default warehouse here as well.
      const baseWarehouseCode = `${hq.code}-MAIN`;
      const codeClash = await tx.warehouse.findFirst({
        where: { companyId: company.id, code: baseWarehouseCode },
        select: { id: true },
      });
      const warehouseCode = codeClash
        ? `${baseWarehouseCode}-${hq.id.slice(0, 8).toUpperCase()}`
        : baseWarehouseCode;
      await tx.warehouse.create({
        data: {
          companyId: company.id,
          branchId: hq.id,
          code: warehouseCode,
          nameEn: `${hq.nameEn} main store`,
          nameAr: `${hq.nameAr} - المخزن الرئيسي`,
          isDefault: true,
          isActive: true,
        },
      });

      // The permission catalogue and the two starter roles come from the same
      // definitions the seed uses, so a web setup and a desktop setup produce
      // identical installations.
      await this.seedPermissions(tx);
      const roles = await this.seedRoles(tx, company.id);

      // The first administrator of this company.
      const admin = await tx.user.create({
        data: {
          companyId: company.id,
          username: input.adminUsername,
          fullNameEn: input.adminFullNameEn ?? 'System Administrator',
          fullNameAr: input.adminFullNameAr ?? 'مدير النظام',
          passwordHash: options.passwordHash,
          isSuperAdmin: options.isSuperAdmin,
        },
      });

      await tx.userRole.create({
        data: {
          userId: admin.id,
          roleId: roles.admin,
          companyId: company.id,
        },
      });
      await tx.userBranch.create({
        data: { userId: admin.id, branchId: hq.id },
      });

      await this.seedFiscalPeriod(tx, company.id);

      if (input.seedChartOfAccounts !== false) {
        await this.seedChartOfAccounts(tx, company.id);
      }

    return { company, hq, admin };
  }

  /// The permission list is part of the program, not of any one company's
  /// data; the same table backs every installation. Upserting keeps an
  /// upgrade that adds a permission safe to run again.
  private async seedPermissions(tx: Prisma.TransactionClient): Promise<void> {
    for (const [code, nameEn, nameAr, module] of SETUP_PERMISSIONS) {
      await tx.permission.upsert({
        where: { code },
        update: { nameEn, nameAr, module },
        create: { code, nameEn, nameAr, module },
      });
    }
  }

  private async seedRoles(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<{ admin: string; accountant: string }> {
    const adminRole = await tx.role.upsert({
      where: { companyId_code: { companyId, code: 'ADMIN' } },
      update: {},
      create: {
        companyId,
        code: 'ADMIN',
        nameEn: 'Administrator',
        nameAr: 'مدير النظام',
        isSystem: true,
      },
    });
    const accountantRole = await tx.role.upsert({
      where: { companyId_code: { companyId, code: 'ACCOUNTANT' } },
      update: {},
      create: {
        companyId,
        code: 'ACCOUNTANT',
        nameEn: 'Accountant',
        nameAr: 'محاسب',
        isSystem: true,
      },
    });

    const all = await tx.permission.findMany();
    for (const p of all) {
      await tx.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: adminRole.id,
            permissionId: p.id,
          },
        },
        update: {},
        create: { roleId: adminRole.id, permissionId: p.id },
      });
    }
    // Keep first-run web setup aligned with prisma/seed.ts. Accountants need
    // the books, parties, stock, and reports, plus read-only invoice access
    // for reconciliation; invoice creation/posting and administration remain
    // with the roles chosen by the company owner.
    const accountantModules = ['accounting', 'parties', 'inventory', 'reports'];
    const accountantReadOnly = ['sales.invoices.read', 'purchases.invoices.read'];
    for (const p of all.filter(
      (permission) =>
        accountantModules.includes(permission.module) ||
        accountantReadOnly.includes(permission.code),
    )) {
      await tx.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: accountantRole.id,
            permissionId: p.id,
          },
        },
        update: {},
        create: { roleId: accountantRole.id, permissionId: p.id },
      });
    }

    return { admin: adminRole.id, accountant: accountantRole.id };
  }

  /// The same default fiscal year the development seed installs.
  private async seedFiscalPeriod(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<void> {
    const year = new Date().getUTCFullYear();
    await tx.fiscalPeriod.upsert({
      where: { companyId_code: { companyId, code: `FY${year}` } },
      update: {},
      create: {
        companyId,
        code: `FY${year}`,
        nameEn: `Fiscal year ${year}`,
        nameAr: `السنة المالية ${year}`,
        startDate: new Date(Date.UTC(year, 0, 1)),
        endDate: new Date(Date.UTC(year, 11, 31)),
      },
    });
  }

  /// The same conventional starter chart the seed installs. It is a template
  /// to edit, not a statutory chart.
  private async seedChartOfAccounts(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<void> {
    const scheme = await loadAccountCodeScheme(tx as never, companyId);
    const starter = scheme === 'EIGHT_DIGIT' ? EIGHT_DIGIT_STARTER_ACCOUNTS : STARTER_ACCOUNTS;
    const sorted = [...starter].sort(
      (a, b) => a.code.length - b.code.length,
    );
    const idByCode = new Map<string, string>();
    for (const a of sorted) {
      const account = await tx.account.upsert({
        where: { companyId_code: { companyId, code: a.code } },
        update: {},
        create: {
          companyId,
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
  }
}

/// Mirrors `PERMISSIONS` in prisma/seed.ts. Kept here so a web-first setup
/// creates exactly the same catalogue as the desktop installer.
export const SETUP_PERMISSIONS = PERMISSIONS;

/// Mirrors `ACCOUNTS` in prisma/seed.ts.
const STARTER_ACCOUNTS: Array<{
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
  // 3103 and 5107 are resolved by code from the account map (opening
  // balances and inventory differences). They existed in the seed chart
  // but not here, so a company created through setup — every real one —
  // failed those postings with "required account does not exist".
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
