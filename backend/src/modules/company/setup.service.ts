import {
  BadRequestException,
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
    const [companies, users] = await Promise.all([
      this.prisma.company.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null } }),
    ]);
    return {
      needsSetup: companies === 0 || users === 0,
      companyCount: companies,
      hasUsers: users > 0,
    };
  }

  async initialSetup(dto: InitialSetupDto, ip?: string, userAgent?: string) {
    // Cheap early refusal avoids hashing a password for a closed setup route.
    // This is only an optimization; the locked check below is authoritative.
    if (await this.prisma.company.count({ where: { deletedAt: null } })) {
      throw new ConflictException(
        'This installation is already set up. Sign in instead, or use the company settings screens to make changes.',
      );
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
      const existing = await tx.company.count({ where: { deletedAt: null } });
      if (existing > 0) {
        throw new ConflictException(
          'This installation is already set up. Sign in instead, or use the company settings screens to make changes.',
        );
      }

      // A dormant company without users or audit rows can still own branches,
      // documents, or other history. Never delete it automatically during setup.
      const dormant = await tx.company.findMany({
        where: { deletedAt: { not: null } },
        select: { id: true, code: true, _count: { select: { users: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const kept = dormant.filter((company) => company._count.users > 0);
      if (kept.length > 1) {
        throw new ConflictException(
          'This installation holds more than one company that was reset. ' +
            'Restore one of them from a backup before setting the program up again.',
        );
      }
      const revivedId = kept[0]?.id ?? null;
      if (revivedId === null || kept[0]!.code !== dto.companyCode) {
        const clash = await tx.company.findFirst({
          where: { code: dto.companyCode },
          select: { id: true },
        });
        if (clash) {
          throw new ConflictException(`A company with the code "${dto.companyCode}" already exists.`);
        }
      }

      // Either the company left behind by a reset, brought back, or a brand
      // new one. Everything after this point is the same either way.
      const company = revivedId
        ? await tx.company.update({
            where: { id: revivedId },
            data: {
              code: dto.companyCode,
              nameEn: dto.companyNameEn,
              nameAr: dto.companyNameAr,
              phone: dto.phone ?? null,
              email: dto.email ?? null,
              address: dto.address ?? null,
              logoData: logo?.data ?? null,
              logoMime: logo?.mime ?? null,
              isActive: true,
              deletedAt: null,
            },
          })
        : await tx.company.create({
            data: {
              code: dto.companyCode,
              nameEn: dto.companyNameEn,
              nameAr: dto.companyNameAr,
              phone: dto.phone ?? null,
              email: dto.email ?? null,
              address: dto.address ?? null,
              logoData: logo?.data ?? null,
              logoMime: logo?.mime ?? null,
            },
          });

      const isBranch = dto.facilityKind === 'BRANCH';
      const unitKind = isBranch ? BranchKind.BRANCH : BranchKind.HEADQUARTERS;
      const unitCode = dto.unitCode ?? dto.hqCode ?? (isBranch ? 'BR01' : 'MAIN');
      const unitNameEn = dto.unitNameEn ?? dto.hqNameEn ?? (isBranch ? 'Branch' : 'Head Office');
      const unitNameAr = dto.unitNameAr ?? dto.hqNameAr ?? (isBranch ? 'الفرع' : 'المركز الرئيسي');

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

      // A reset deliberately leaves the administrator behind so nobody is
      // locked out; a setup run after a reset therefore finds that account
      // and adopts it rather than creating a second administrator. A fresh
      // installation finds nobody and creates one.
      const already = await tx.user.findMany({
        where: { companyId: company.id },
        select: { id: true, username: true },
        orderBy: { createdAt: 'asc' },
      });

      const admin =
        already.length > 0
          ? await tx.user.update({
              where: { id: already[0]!.id },
              data: {
                // The requested name, unless another surviving account has it.
                username: already.some(
                  (candidate) =>
                    candidate.id !== already[0]!.id &&
                    candidate.username === dto.adminUsername,
                )
                  ? already[0]!.username
                  : dto.adminUsername,
                fullNameEn: dto.adminFullNameEn ?? 'System Administrator',
                fullNameAr: dto.adminFullNameAr ?? 'مدير النظام',
                passwordHash,
                isSuperAdmin: true,
                isActive: true,
                deletedAt: null,
              },
            })
          : await tx.user.create({
              data: {
                companyId: company.id,
                username: dto.adminUsername,
                fullNameEn: dto.adminFullNameEn ?? 'System Administrator',
                fullNameAr: dto.adminFullNameAr ?? 'مدير النظام',
                passwordHash,
                isSuperAdmin: true,
              },
            });

      // Only one administrator belongs at the beginning of a company. The
      // extra accounts are switched off and retired rather than deleted: an
      // account the audit trail mentions cannot be removed without the trail's
      // foreign key trying to edit history, which the database refuses — and a
      // retired account is out of every list, every role and every sign-in
      // anyway (`deletedAt` and `isActive` are checked at login).
      if (already.length > 1) {
        await tx.user.updateMany({
          where: { companyId: company.id, id: { not: admin.id }, deletedAt: null },
          data: { isActive: false, deletedAt: new Date() },
        });
      }

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

      if (dto.seedChartOfAccounts !== false) {
        await this.seedChartOfAccounts(tx, company.id);
      }

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

      // Reserve after the required audit and other database writes. The licence
      // store has an independent fail-closed watermark, so an audit failure
      // must not advance it. A later commit failure can still overcount seats.
      // The first-run administrator is a real account like any other, so it
      // consumes a seat. An account revived by setup (already exists) is not
      // created again and therefore reserves nothing.
      if (already.length === 0) {
        await this.licensing.reserveSeat(tx, {
          userId: admin.id,
          username: admin.username,
          reason: 'SETUP_ADMIN',
          idempotencyKey: `setup:${company.id}:${admin.username}`,
        });
      }

      return { company, hq, admin };
    }, { maxWait: 10000, timeout: 30000 });

    return {
      companyId: result.company.id,
      companyCode: result.company.code,
      headquartersId: result.hq.id,
      adminUsername: result.admin.username,
    };
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
    const sorted = [...STARTER_ACCOUNTS].sort(
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
