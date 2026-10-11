import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AccountType, BranchKind, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { validateLogo } from './company.service';
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
    const existing = await this.prisma.company.count({
      where: { deletedAt: null },
    });
    if (existing > 0) {
      throw new ConflictException(
        'This installation is already set up. Sign in instead, or use the company settings screens to make changes.',
      );
    }

    if (
      await this.prisma.company.findFirst({
        where: { code: dto.companyCode },
        select: { id: true },
      })
    ) {
      throw new ConflictException(
        `A company with the code "${dto.companyCode}" already exists.`,
      );
    }

    let logo: { data: Uint8Array<ArrayBuffer>; mime: string } | null = null;
    if (dto.logoBase64) {
      const buffer = Buffer.from(dto.logoBase64, 'base64');
      logo = validateLogo(buffer, dto.logoMime ?? 'image/png');
    }

    const passwordHash = await argon2.hash(dto.adminPassword);

    const result = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
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

      const hq = await tx.branch.create({
        data: {
          companyId: company.id,
          code: dto.hqCode ?? 'MAIN',
          nameEn: dto.hqNameEn ?? 'Head Office',
          nameAr: dto.hqNameAr ?? 'المركز الرئيسي',
          kind: BranchKind.HEADQUARTERS,
        },
      });

      // The permission catalogue and the two starter roles come from the same
      // definitions the seed uses, so a web setup and a desktop setup produce
      // identical installations.
      await this.seedPermissions(tx);
      const roles = await this.seedRoles(tx, company.id);

      const admin = await tx.user.create({
        data: {
          companyId: company.id,
          username: dto.adminUsername,
          fullNameEn: dto.adminFullNameEn ?? 'System Administrator',
          fullNameAr: dto.adminFullNameAr ?? 'مدير النظام',
          passwordHash,
          isSuperAdmin: true,
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

      if (dto.seedChartOfAccounts !== false) {
        await this.seedChartOfAccounts(tx, company.id);
      }

      return { company, hq, admin };
    });

    await this.audit.record({
      companyId: result.company.id,
      userId: result.admin.id,
      action: 'CREATE',
      entity: 'companies',
      entityId: result.company.id,
      after: {
        code: result.company.code,
        nameEn: result.company.nameEn,
        nameAr: result.company.nameAr,
        hq: result.hq.code,
        adminUsername: result.admin.username,
      },
      ipAddress: ip ?? null,
      userAgent: userAgent ?? null,
    });

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
    return { admin: adminRole.id, accountant: accountantRole.id };
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
const SETUP_PERMISSIONS: Array<[string, string, string, string]> = [
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
  ['accounting.periods.read', 'View fiscal periods', 'عرض الفترات المالية', 'accounting'],
  ['accounting.periods.manage', 'Manage fiscal periods', 'إدارة الفترات المالية', 'accounting'],
];

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
