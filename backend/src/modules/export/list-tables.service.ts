import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { accountLabel } from '../../common/localization/account-name';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReportTable, TableColumn, TableMeta } from './report-table';

/// A branch is shown in the language the file was asked for, falling back to
/// whatever name it has — never a blank cell.
function branchName(
  branch: { nameEn: string; nameAr: string | null },
  lang?: string,
): string {
  const preferred = lang === 'ar' ? branch.nameAr : branch.nameEn;
  return (preferred && preferred.trim()) || branch.nameEn || '';
}

/// Every list in the program, as a file.
///
/// The reports already had their downloads. This does the same for the lists a
/// person looks at every day - customers, suppliers, items, stock, invoices,
/// entries, accounts, periods, users and the audit trail - so that anything on
/// screen can leave the building as a spreadsheet or a PDF.
///
/// Each list is described once, as columns, and the same three writers turn it
/// into .xlsx, .csv or a printed page. Adding a list here is what makes it
/// downloadable; nothing else needs to know about it.

export const LIST_SLUGS = [
  'customers',
  'suppliers',
  'items',
  'stock',
  'sales-invoices',
  'purchase-invoices',
  'journal-entries',
  'chart-of-accounts',
  'fiscal-periods',
  'users',
  'roles',
  'audit-trail',
  'cash-accounts',
  'cash-vouchers',
  'cash-transfers',
] as const;

export type ListSlug = (typeof LIST_SLUGS)[number];

/// What a person can ask for. Every list accepts the ones it understands and
/// ignores the rest, so one query string works across the whole program.
export interface ListQuery {
  lang?: string;
  /// Free text, matched the way the list's own search box matches it.
  q?: string;
  /// Customers and suppliers.
  includeInactive?: string;
  /// Invoices and entries.
  status?: string;
  from?: string;
  to?: string;
  /// The account ledger needs one; the invoices can be narrowed to one party.
  customerId?: string;
  supplierId?: string;
  itemId?: string;
  branchId?: string;
  /// What the user is allowed to see; the admin lists need it.
  includeDeleted?: string;
}

interface ListSpec {
  slug: ListSlug;
  titleEn: string;
  titleAr: string;
  /// The permission needed to read this list, i.e. the one its own screen uses.
  permission: string;
  build: (service: ListTablesService, companyId: string, query: ListQuery) => Promise<ReportTable>;
}

@Injectable()
export class ListTablesService {
  constructor(private readonly prisma: PrismaService) {}

  /// The lists this installation offers, for a client that wants to know
  /// before it asks.
  catalogue() {
    return SPECS.map((spec) => ({
      slug: spec.slug,
      titleEn: spec.titleEn,
      titleAr: spec.titleAr,
      permission: spec.permission,
    }));
  }

  known(slug: string): ListSpec {
    const spec = SPECS.find((entry) => entry.slug === slug);
    if (!spec) {
      throw new BadRequestException(
        `Unknown list "${slug}". Known lists: ${LIST_SLUGS.join(', ')}.`,
      );
    }
    return spec;
  }

  async build(slug: string, companyId: string, query: ListQuery): Promise<ReportTable> {
    const spec = this.known(slug);
    return spec.build(this, companyId, query);
  }

  /// ───────────────────────────────────────────────── the lists themselves

  /// Customers and suppliers differ only in which table they live in.
  async parties(
    companyId: string,
    query: ListQuery,
    kind: 'customer' | 'supplier',
  ): Promise<ReportTable> {
    const model = kind === 'customer' ? this.prisma.customer : this.prisma.supplier;
    const rows = await (model as Prisma.CustomerDelegate).findMany({
      where: {
        companyId,
        ...(query.includeInactive === 'true' ? {} : { isActive: true }),
        ...(query.q
          ? {
              OR: [
                { code: { contains: query.q, mode: 'insensitive' as const } },
                { nameEn: { contains: query.q, mode: 'insensitive' as const } },
                { nameAr: { contains: query.q, mode: 'insensitive' as const } },
                { phone: { contains: query.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { code: 'asc' },
    });

    const isCustomer = kind === 'customer';
    return this.table({
      slug: isCustomer ? 'customers' : 'suppliers',
      titleEn: isCustomer ? 'Customers' : 'Suppliers',
      titleAr: isCustomer ? 'العملاء' : 'الموردون',
      meta: [this.count(rows.length)],
      columns: [
        { key: 'code', labelEn: 'Code', labelAr: 'الكود', width: 14 },
        { key: 'nameEn', labelEn: 'Name (English)', labelAr: 'الاسم (إنجليزي)', width: 28 },
        { key: 'nameAr', labelEn: 'Name (Arabic)', labelAr: 'الاسم (عربي)', width: 28 },
        { key: 'phone', labelEn: 'Phone', labelAr: 'الهاتف', width: 16 },
        { key: 'email', labelEn: 'Email', labelAr: 'البريد الإلكتروني', width: 26 },
        { key: 'taxNumber', labelEn: 'Tax number', labelAr: 'الرقم الضريبي', width: 18 },
        { key: 'address', labelEn: 'Address', labelAr: 'العنوان', width: 26 },
        {
          key: 'creditLimit',
          labelEn: 'Credit limit',
          labelAr: 'حد الائتمان',
          numeric: true,
          width: 16,
        },
        { key: 'isActive', labelEn: 'Active', labelAr: 'نشط', width: 10, boolean: true },
      ],
      rows: rows as unknown as Array<Record<string, unknown>>,
    });
  }

  async items(companyId: string, query: ListQuery): Promise<ReportTable> {
    const rows = await this.prisma.item.findMany({
      where: {
        companyId,
        ...(query.includeInactive === 'true' ? {} : { isActive: true }),
        ...(query.q
          ? {
              OR: [
                { code: { contains: query.q, mode: 'insensitive' as const } },
                { nameEn: { contains: query.q, mode: 'insensitive' as const } },
                { nameAr: { contains: query.q, mode: 'insensitive' as const } },
                { barcode: { contains: query.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { code: 'asc' },
    });

    return this.table({
      slug: 'items',
      titleEn: 'Items',
      titleAr: 'الأصناف',
      meta: [this.count(rows.length)],
      columns: [
        { key: 'code', labelEn: 'Code', labelAr: 'الكود', width: 14 },
        { key: 'nameEn', labelEn: 'Name (English)', labelAr: 'الاسم (إنجليزي)', width: 28 },
        { key: 'nameAr', labelEn: 'Name (Arabic)', labelAr: 'الاسم (عربي)', width: 28 },
        { key: 'unit', labelEn: 'Unit', labelAr: 'الوحدة', width: 12 },
        { key: 'salePrice', labelEn: 'Sale price', labelAr: 'سعر البيع', numeric: true, width: 14 },
        { key: 'taxRate', labelEn: 'Tax %', labelAr: 'الضريبة %', numeric: true, width: 11 },
        {
          key: 'isStockTracked',
          labelEn: 'In stock',
          labelAr: 'يتتبع بالمخزون',
          boolean: true,
          width: 14,
        },
        { key: 'isActive', labelEn: 'Active', labelAr: 'نشط', boolean: true, width: 10 },
      ],
      rows: rows as unknown as Array<Record<string, unknown>>,
    });
  }

  async stock(companyId: string, query: ListQuery): Promise<ReportTable> {
    const balances = await this.prisma.stockBalance.findMany({
      where: { companyId },
      include: { item: true, branch: true },
      orderBy: { item: { code: 'asc' } },
    });

    const filtered = query.q
      ? balances.filter((row) => {
          const needle = query.q!.toLowerCase();
          return (
            row.item.code.toLowerCase().includes(needle) ||
            row.item.nameEn.toLowerCase().includes(needle) ||
            row.item.nameAr.includes(query.q!) ||
            row.branch.nameEn.toLowerCase().includes(needle)
          );
        })
      : balances;

    return this.table({
      slug: 'stock',
      titleEn: 'Stock balances',
      titleAr: 'أرصدة المخزون',
      meta: [this.count(filtered.length)],
      columns: [
        { key: 'itemCode', labelEn: 'Item code', labelAr: 'كود الصنف', width: 14 },
        { key: 'itemNameEn', labelEn: 'Item (English)', labelAr: 'الصنف (إنجليزي)', width: 26 },
        { key: 'itemNameAr', labelEn: 'Item (Arabic)', labelAr: 'الصنف (عربي)', width: 26 },
        { key: 'branch', labelEn: 'Branch', labelAr: 'الفرع', width: 16 },
        { key: 'quantity', labelEn: 'Quantity', labelAr: 'الكمية', numeric: true, width: 14 },
        {
          key: 'averageCost',
          labelEn: 'Average cost',
          labelAr: 'متوسط التكلفة',
          numeric: true,
          width: 16,
        },
        { key: 'value', labelEn: 'Value', labelAr: 'القيمة', numeric: true, width: 16 },
      ],
      rows: filtered.map((row) => {
        const quantity = new Prisma.Decimal(row.quantity ?? 0);
        const value = new Prisma.Decimal(row.value ?? 0);
        // The average cost is the value the balance carries divided by the
        // quantity it covers. Kept to four places, the same as the money.
        const average = quantity.isZero() ? new Prisma.Decimal(0) : value.div(quantity);
        return {
          itemCode: row.item.code,
          itemNameEn: row.item.nameEn,
          itemNameAr: row.item.nameAr,
          branch: row.branch?.nameEn ?? '',
          quantity: quantity.toFixed(4),
          averageCost: average.toFixed(4),
          value: value.toFixed(4),
        };
      }),
    });
  }

  async invoices(
    companyId: string,
    query: ListQuery,
    kind: 'sales' | 'purchase',
  ): Promise<ReportTable> {
    const isSales = kind === 'sales';
    const where = {
      companyId,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.customerId && isSales ? { customerId: query.customerId } : {}),
      ...(query.supplierId && !isSales ? { supplierId: query.supplierId } : {}),
      ...(query.from || query.to
        ? {
            invoiceDate: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const rows = isSales
      ? await this.prisma.salesInvoice.findMany({
          where,
          include: { customer: true, branch: true },
          orderBy: [{ invoiceDate: 'desc' }, { invoiceNumber: 'desc' }],
        })
      : await this.prisma.purchaseInvoice.findMany({
          where,
          include: { supplier: true, branch: true },
          orderBy: [{ invoiceDate: 'desc' }, { invoiceNumber: 'desc' }],
        });

    const partyName = isSales ? 'customer' : 'supplier';
    const amountKeys = ['subTotal', 'taxAmount', 'totalAmount'] as const;

    return this.table({
      slug: isSales ? 'sales-invoices' : 'purchase-invoices',
      titleEn: isSales ? 'Sales invoices' : 'Purchase invoices',
      titleAr: isSales ? 'فواتير البيع' : 'فواتير الشراء',
      meta: [
        this.count(rows.length),
        ...(query.from || query.to
          ? [
              {
                labelEn: 'Period',
                labelAr: 'الفترة',
                value: `${query.from ?? '—'} → ${query.to ?? '—'}`,
              },
            ]
          : []),
      ],
      columns: [
        {
          key: 'invoiceNumber',
          labelEn: 'Number',
          labelAr: 'الرقم',
          width: 16,
        },
        { key: 'invoiceDate', labelEn: 'Date', labelAr: 'التاريخ', width: 13, date: true },
        {
          key: partyName === 'customer' ? 'partyNameEn' : 'partyNameEn',
          labelEn: isSales ? 'Customer' : 'Supplier',
          labelAr: isSales ? 'العميل' : 'المورد',
          width: 26,
        },
        { key: 'status', labelEn: 'Status', labelAr: 'الحالة', width: 12 },
        { key: 'subTotal', labelEn: 'Subtotal', labelAr: 'الإجمالي قبل الضريبة', numeric: true, width: 18 },
        { key: 'taxAmount', labelEn: 'Tax', labelAr: 'الضريبة', numeric: true, width: 14 },
        { key: 'totalAmount', labelEn: 'Total', labelAr: 'الإجمالي', numeric: true, width: 18 },
        { key: 'paidAmount', labelEn: 'Paid', labelAr: 'المدفوع', numeric: true, width: 16 },
        { key: 'balanceDue', labelEn: 'Due', labelAr: 'المتبقي', numeric: true, width: 16 },
      ],
      rows: rows.map((row) => {
        const party = (row as Record<string, any>)[partyName];
        const out: Record<string, unknown> = { ...row };
        out.partyNameEn = party?.nameEn ?? '';
        for (const key of amountKeys) out[key] = String((row as Record<string, any>)[key] ?? '');
        return out;
      }),
    });
  }

  async journalEntries(companyId: string, query: ListQuery): Promise<ReportTable> {
    const rows = await this.prisma.journalEntry.findMany({
      where: {
        companyId,
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.from || query.to
          ? {
              entryDate: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      include: {
        branch: true,
        lines: { include: { account: true }, orderBy: { lineNumber: 'asc' } },
      },
      orderBy: [{ entryDate: 'desc' }, { entryNumber: 'desc' }],
    });

    // The file goes down to the lines: every entry expands into its account
    // rows, each with the account's code and its name in the language the
    // file was asked for, and the file closes on the grand totals the books
    // balance on.
    const expanded: Array<Record<string, unknown>> = [];
    let grandDebit = new Prisma.Decimal(0);
    let grandCredit = new Prisma.Decimal(0);

    for (const row of rows) {
      for (const line of row.lines) {
        grandDebit = grandDebit.plus(new Prisma.Decimal(line.debit ?? 0));
        grandCredit = grandCredit.plus(new Prisma.Decimal(line.credit ?? 0));
        expanded.push({
          entryNumber: row.entryNumber,
          entryDate: row.entryDate,
          description: row.description ?? '',
          branch: row.branch ? branchName(row.branch, query.lang) : '',
          accountCode: line.account?.code ?? '',
          accountName: line.account
            ? accountLabel(line.account, query.lang === 'ar' ? 'ar' : 'en')
            : '',
          lineDescription: line.description ?? '',
          debit: new Prisma.Decimal(line.debit ?? 0).toFixed(4),
          credit: new Prisma.Decimal(line.credit ?? 0).toFixed(4),
        });
      }
    }

    return this.table({
      slug: 'journal-entries',
      titleEn: 'Journal entries',
      titleAr: 'القيود اليومية',
      meta: [this.count(rows.length)],
      columns: [
        { key: 'entryNumber', labelEn: 'Number', labelAr: 'الرقم', width: 16 },
        { key: 'entryDate', labelEn: 'Date', labelAr: 'التاريخ', width: 13, date: true },
        { key: 'description', labelEn: 'Entry description', labelAr: 'بيان القيد', width: 36 },
        { key: 'branch', labelEn: 'Branch', labelAr: 'الفرع', width: 16 },
        { key: 'accountCode', labelEn: 'Account code', labelAr: 'كود الحساب', width: 12 },
        { key: 'accountName', labelEn: 'Account name', labelAr: 'اسم الحساب', width: 34 },
        { key: 'lineDescription', labelEn: 'Line description', labelAr: 'بيان السطر', width: 28 },
        { key: 'debit', labelEn: 'Debit', labelAr: 'مدين', numeric: true, width: 16 },
        { key: 'credit', labelEn: 'Credit', labelAr: 'دائن', numeric: true, width: 16 },
      ],
      rows: expanded,
      totals: [
        {
          labelEn: 'Grand total',
          labelAr: 'الإجمالي',
          value: `${grandDebit.toFixed(4)} / ${grandCredit.toFixed(4)}`,
          stretch: 7,
        },
      ],
      notes: [
        {
          en: 'One row per journal line. Totals show debit / credit.',
          ar: 'سطر لكل حركة قيد. الإجماليات بالمدين / الدائن.',
        },
      ],
    });
  }

  async chartOfAccounts(companyId: string, query: ListQuery): Promise<ReportTable> {
    const rows = await this.prisma.account.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(query.includeInactive === 'true' ? {} : { isActive: true }),
      },
      orderBy: { code: 'asc' },
    });

    const filtered = query.q
      ? rows.filter(
          (row) =>
            row.code.toLowerCase().includes(query.q!.toLowerCase()) ||
            row.nameEn.toLowerCase().includes(query.q!.toLowerCase()) ||
            row.nameAr.includes(query.q!),
        )
      : rows;

    // The file keeps the tree: accounts come out parents before children, and
    // each row carries its level and its parent, so the hierarchy survives the
    // trip into a spreadsheet.
    const byId = new Map(filtered.map((row) => [row.id, row]));
    const childrenOf = new Map<string | null, typeof filtered>();
    for (const row of filtered) {
      // A parent filtered out by the search still shows through the parent
      // column; the row itself hangs at the top so nothing disappears.
      const parentKey =
        row.parentId && byId.has(row.parentId) ? row.parentId : null;
      const bucket = childrenOf.get(parentKey) ?? [];
      bucket.push(row);
      childrenOf.set(parentKey, bucket);
    }

    const ordered: Array<(typeof filtered)[number] & { level: number }> = [];
    const walk = (parentId: string | null, level: number): void => {
      for (const row of childrenOf.get(parentId) ?? []) {
        ordered.push({ ...row, level });
        walk(row.id, level + 1);
      }
    };
    walk(null, 0);

    return this.table({
      slug: 'chart-of-accounts',
      titleEn: 'Chart of accounts',
      titleAr: 'شجرة الحسابات',
      meta: [this.count(ordered.length)],
      columns: [
        { key: 'level', labelEn: 'Level', labelAr: 'المستوى', numeric: true, width: 8 },
        { key: 'code', labelEn: 'Code', labelAr: 'الكود', width: 14 },
        { key: 'nameEn', labelEn: 'Name (English)', labelAr: 'الاسم (إنجليزي)', width: 30 },
        { key: 'nameAr', labelEn: 'Name (Arabic)', labelAr: 'الاسم (عربي)', width: 30 },
        { key: 'parent', labelEn: 'Parent account', labelAr: 'الحساب الأب', width: 22 },
        { key: 'type', labelEn: 'Type', labelAr: 'النوع', width: 14 },
        { key: 'isPostable', labelEn: 'Postable', labelAr: 'يقبل الترحيل', boolean: true, width: 12 },
        { key: 'isActive', labelEn: 'Active', labelAr: 'نشط', boolean: true, width: 10 },
      ],
      rows: ordered.map((row) => {
        const parent = row.parentId ? byId.get(row.parentId) : null;
        const indent = '\u00A0'.repeat(row.level * 2);
        return {
          ...row,
          level: row.level,
          code: row.code,
          nameEn: indent + row.nameEn,
          nameAr: indent + row.nameAr,
          parent: parent ? `${parent.code} ${parent.nameEn}` : '',
        };
      }),
    });
  }

  async fiscalPeriods(companyId: string): Promise<ReportTable> {
    const rows = await this.prisma.fiscalPeriod.findMany({
      where: { companyId },
      orderBy: { startDate: 'asc' },
    });

    return this.table({
      slug: 'fiscal-periods',
      titleEn: 'Fiscal periods',
      titleAr: 'الفترات المالية',
      meta: [this.count(rows.length)],
      columns: [
        { key: 'code', labelEn: 'Code', labelAr: 'الكود', width: 14 },
        { key: 'nameEn', labelEn: 'Name', labelAr: 'الاسم', width: 24 },
        { key: 'startDate', labelEn: 'From', labelAr: 'من تاريخ', width: 14, date: true },
        { key: 'endDate', labelEn: 'To', labelAr: 'إلى تاريخ', width: 14, date: true },
        { key: 'status', labelEn: 'Status', labelAr: 'الحالة', width: 12 },
        { key: 'closedAt', labelEn: 'Closed at', labelAr: 'تاريخ الإقفال', width: 18, date: true },
      ],
      rows: rows as unknown as Array<Record<string, unknown>>,
    });
  }

  async users(companyId: string): Promise<ReportTable> {
    const rows = await this.prisma.user.findMany({
      where: { companyId },
      include: { userRoles: { include: { role: true } } },
      orderBy: { username: 'asc' },
    });

    return this.table({
      slug: 'users',
      titleEn: 'Users',
      titleAr: 'المستخدمون',
      meta: [this.count(rows.length)],
      columns: [
        { key: 'username', labelEn: 'Username', labelAr: 'اسم المستخدم', width: 20 },
        { key: 'fullName', labelEn: 'Full name', labelAr: 'الاسم الكامل', width: 26 },
        { key: 'email', labelEn: 'Email', labelAr: 'البريد الإلكتروني', width: 26 },
        { key: 'roles', labelEn: 'Roles', labelAr: 'الأدوار', width: 24 },
        { key: 'isActive', labelEn: 'Active', labelAr: 'نشط', boolean: true, width: 10 },
        { key: 'lastLoginAt', labelEn: 'Last sign-in', labelAr: 'آخر دخول', width: 20, date: true },
      ],
      rows: rows.map((row) => ({
        username: row.username,
        fullName: row.fullNameEn ?? row.fullNameAr,
        email: row.email,
        roles: row.userRoles.map((link) => link.role.nameEn).join(', '),
        isActive: row.isActive,
        lastLoginAt: row.lastLoginAt,
      })),
      notes: [
        {
          en: 'Passwords are never part of a file. This list is for review, not for distribution.',
          ar: 'كلمات المرور مش بتخرج في أي ملف. القائمة دي للمراجعة، مش للتوزيع.',
        },
      ],
    });
  }

  /// The roles and how many people hold each one.
  ///
  /// What a role may do is a long list, so the file carries the count and the
  /// role's own description; the permissions themselves are read on screen,
  /// where they can be filtered and pressed one by one.
  async roles(companyId: string): Promise<ReportTable> {
    const rows = await this.prisma.role.findMany({
      // A built-in role belongs to no company and is offered to all of them.
      where: { OR: [{ companyId }, { companyId: null }], deletedAt: null },
      include: {
        rolePermissions: true,
        userRoles: true,
      },
      orderBy: { nameEn: 'asc' },
    });

    return this.table({
      slug: 'roles',
      titleEn: 'Roles',
      titleAr: 'الأدوار',
      meta: [this.count(rows.length)],
      columns: [
        { key: 'name', labelEn: 'Role', labelAr: 'الدور', width: 26 },
        { key: 'nameAr', labelEn: 'Role (Arabic)', labelAr: 'الدور (عربي)', width: 26 },
        { key: 'permissions', labelEn: 'Permissions', labelAr: 'عدد الصلاحيات', numeric: true, width: 14 },
        { key: 'holders', labelEn: 'Users', labelAr: 'عدد المستخدمين', numeric: true, width: 14 },
        { key: 'isSystem', labelEn: 'Built in', labelAr: 'دور أساسي', boolean: true, width: 12 },
      ],
      rows: rows.map((row) => ({
        name: row.nameEn,
        nameAr: row.nameAr,
        permissions: row.rolePermissions.length,
        holders: row.userRoles.length,
        isSystem: row.isSystem,
      })),
      notes: [
        {
          en: 'A role decides what its users may do. The permission list itself is read on the roles screen.',
          ar: 'الدور هو اللي بيحدد المستخدم يقدر يعمل إيه. قائمة الصلاحيات نفسها بتتقرأ من شاشة الأدوار.',
        },
      ],
    });
  }

  async auditTrail(companyId: string, query: ListQuery): Promise<ReportTable> {
    const take = 5000;
    const rows = await this.prisma.auditLog.findMany({
      where: {
        companyId,
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      include: { user: true },
      orderBy: { createdAt: 'desc' },
      take,
    });

    return this.table({
      slug: 'audit-trail',
      titleEn: 'Audit trail',
      titleAr: 'سجل التدقيق',
      meta: [
        this.count(rows.length),
        {
          labelEn: 'Newest first',
          labelAr: 'الأحدث أولاً',
          value: rows.length === take ? `first ${take}` : 'all',
        },
      ],
      columns: [
        { key: 'createdAt', labelEn: 'When', labelAr: 'التاريخ والوقت', width: 22, date: true },
        { key: 'user', labelEn: 'Who', labelAr: 'مين', width: 20 },
        { key: 'action', labelEn: 'Action', labelAr: 'الحركة', width: 18 },
        { key: 'entity', labelEn: 'Entity', labelAr: 'الكيان', width: 20 },
        { key: 'entityId', labelEn: 'Record', labelAr: 'السجل', width: 36 },
        { key: 'ipAddress', labelEn: 'From', labelAr: 'من جهاز', width: 18 },
      ],
      rows: rows.map((row) => ({
        createdAt: row.createdAt,
        user: row.user?.username ?? '—',
        action: row.action,
        entity: row.entity,
        entityId: row.entityId ?? '',
        ipAddress: row.ipAddress ?? '',
      })),
    });
  }

  /// Cash and bank accounts, including the ledger account each one posts to.
  async cashAccounts(companyId: string, query: ListQuery): Promise<ReportTable> {
    const rows = await this.prisma.cashAccount.findMany({
      where: { companyId, deletedAt: null },
      include: {
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        account: { select: { code: true, nameEn: true, nameAr: true } },
      },
      orderBy: { code: 'asc' },
    });
    const balanceRows = await this.prisma.$queryRaw<
      Array<{ accountId: string; net: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT l."accountId" AS "accountId",
             COALESCE(SUM(l.debit - l.credit), 0) AS net
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l."journalEntryId"
       WHERE e."companyId" = ${companyId}::uuid
         AND e.status IN ('POSTED', 'REVERSED')
         AND e."entryDate" <= CURRENT_DATE
       GROUP BY l."accountId"
    `);
    const balanceByAccount = new Map(
      balanceRows.map((row) => [row.accountId, new Prisma.Decimal(row.net)]),
    );
    return this.table({
      slug: 'cash-accounts',
      titleEn: 'Cash and bank accounts',
      titleAr: 'الخزائن والحسابات البنكية',
      meta: [this.count(rows.length)],
      columns: [
        { key: 'code', labelEn: 'Code', labelAr: 'الكود', width: 14 },
        { key: 'name', labelEn: 'Name', labelAr: 'الاسم', width: 28 },
        { key: 'kind', labelEn: 'Type', labelAr: 'النوع', width: 14 },
        { key: 'currency', labelEn: 'Currency', labelAr: 'العملة', width: 12 },
        { key: 'balance', labelEn: 'Current balance', labelAr: 'الرصيد الحالي', numeric: true, width: 18 },
        { key: 'ledgerCode', labelEn: 'Ledger account', labelAr: 'حساب الأستاذ', width: 18 },
        { key: 'ledgerName', labelEn: 'Ledger account name', labelAr: 'اسم حساب الأستاذ', width: 28 },
        { key: 'branch', labelEn: 'Branch', labelAr: 'الفرع', width: 24 },
        { key: 'bankName', labelEn: 'Bank', labelAr: 'البنك', width: 22 },
        { key: 'bankAccountNumber', labelEn: 'Bank account number', labelAr: 'رقم الحساب البنكي', width: 22 },
        { key: 'iban', labelEn: 'IBAN', labelAr: 'آيبان', width: 28 },
        { key: 'isActive', labelEn: 'Active', labelAr: 'نشط', boolean: true, width: 10 },
      ],
      rows: rows.map((row) => ({
        code: row.code,
        name: branchName({ nameEn: row.nameEn, nameAr: row.nameAr }, query.lang),
        kind: row.kind,
        currency: row.currency,
        balance: (balanceByAccount.get(row.accountId) ?? new Prisma.Decimal(0)).toFixed(4),
        ledgerCode: row.account.code,
        ledgerName: branchName({ nameEn: row.account.nameEn, nameAr: row.account.nameAr }, query.lang),
        branch: row.branch ? branchName(row.branch, query.lang) : '',
        bankName: row.bankName ?? '',
        bankAccountNumber: row.bankAccountNumber ?? '',
        iban: row.iban ?? '',
        isActive: row.isActive,
      })),
    });
  }

  /// Receipts and payments, with party, account, posting state and references.
  async cashVouchers(companyId: string, query: ListQuery): Promise<ReportTable> {
    const rows = await this.prisma.cashVoucher.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.from || query.to
          ? {
              voucherDate: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      include: {
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        cashAccount: { select: { code: true, nameEn: true, nameAr: true } },
        customer: { select: { code: true, nameEn: true, nameAr: true } },
        supplier: { select: { code: true, nameEn: true, nameAr: true } },
        counterAccount: { select: { code: true, nameEn: true, nameAr: true } },
      },
      orderBy: [{ voucherDate: 'desc' }, { voucherNumber: 'desc' }],
    });
    return this.table({
      slug: 'cash-vouchers',
      titleEn: 'Cash vouchers',
      titleAr: 'سندات القبض والصرف',
      meta: [this.count(rows.length)],
      columns: [
        { key: 'number', labelEn: 'Voucher number', labelAr: 'رقم السند', width: 18 },
        { key: 'date', labelEn: 'Date', labelAr: 'التاريخ', date: true, width: 14 },
        { key: 'kind', labelEn: 'Type', labelAr: 'النوع', width: 14 },
        { key: 'cashAccount', labelEn: 'Cash/bank account', labelAr: 'الخزنة/البنك', width: 26 },
        { key: 'party', labelEn: 'Customer / supplier', labelAr: 'العميل / المورد', width: 28 },
        { key: 'counterAccount', labelEn: 'Counter account', labelAr: 'الحساب المقابل', width: 26 },
        { key: 'amount', labelEn: 'Amount', labelAr: 'المبلغ', numeric: true, width: 16 },
        { key: 'currency', labelEn: 'Currency', labelAr: 'العملة', width: 12 },
        { key: 'status', labelEn: 'Status', labelAr: 'الحالة', width: 14 },
        { key: 'branch', labelEn: 'Branch', labelAr: 'الفرع', width: 24 },
        { key: 'reference', labelEn: 'Reference', labelAr: 'المرجع', width: 22 },
        { key: 'description', labelEn: 'Description', labelAr: 'البيان', width: 34 },
      ],
      rows: rows.map((row) => {
        const party = row.customer ?? row.supplier;
        return {
          number: row.voucherNumber,
          date: row.voucherDate,
          kind: row.kind,
          cashAccount: branchName(row.cashAccount, query.lang),
          party: party ? `${party.code} — ${branchName(party, query.lang)}` : '',
          counterAccount: row.counterAccount
            ? `${row.counterAccount.code} — ${branchName(row.counterAccount, query.lang)}`
            : '',
          amount: row.amount.toString(),
          currency: row.currency,
          status: row.status,
          branch: branchName(row.branch, query.lang),
          reference: row.reference ?? '',
          description: row.description ?? '',
        };
      }),
    });
  }

  /// Transfers between two company cash/bank accounts.
  async cashTransfers(companyId: string, query: ListQuery): Promise<ReportTable> {
    const rows = await this.prisma.cashTransfer.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.from || query.to
          ? {
              transferDate: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      include: {
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        fromCashAccount: { select: { code: true, nameEn: true, nameAr: true } },
        toCashAccount: { select: { code: true, nameEn: true, nameAr: true } },
      },
      orderBy: [{ transferDate: 'desc' }, { transferNumber: 'desc' }],
    });
    return this.table({
      slug: 'cash-transfers',
      titleEn: 'Cash transfers',
      titleAr: 'التحويلات بين الخزائن والبنوك',
      meta: [this.count(rows.length)],
      columns: [
        { key: 'number', labelEn: 'Transfer number', labelAr: 'رقم التحويل', width: 18 },
        { key: 'date', labelEn: 'Date', labelAr: 'التاريخ', date: true, width: 14 },
        { key: 'from', labelEn: 'From account', labelAr: 'من حساب', width: 28 },
        { key: 'to', labelEn: 'To account', labelAr: 'إلى حساب', width: 28 },
        { key: 'amount', labelEn: 'Amount', labelAr: 'المبلغ', numeric: true, width: 16 },
        { key: 'currency', labelEn: 'Currency', labelAr: 'العملة', width: 12 },
        { key: 'status', labelEn: 'Status', labelAr: 'الحالة', width: 14 },
        { key: 'branch', labelEn: 'Branch', labelAr: 'الفرع', width: 24 },
        { key: 'description', labelEn: 'Description', labelAr: 'البيان', width: 34 },
      ],
      rows: rows.map((row) => ({
        number: row.transferNumber,
        date: row.transferDate,
        from: `${row.fromCashAccount.code} — ${branchName(row.fromCashAccount, query.lang)}`,
        to: `${row.toCashAccount.code} — ${branchName(row.toCashAccount, query.lang)}`,
        amount: row.amount.toString(),
        currency: row.currency,
        status: row.status,
        branch: branchName(row.branch, query.lang),
        description: row.description ?? '',
      })),
    });
  }

  /// ───────────────────────────────────────────────── shared helpers

  /// Every list carries at least when it was made and how many rows it holds,
  /// so a printed page is never a sheet of numbers with no date on it.
  private count(rows: number): TableMeta {
    return {
      labelEn: 'Rows',
      labelAr: 'عدد السجلات',
      value: String(rows),
    };
  }

  private table(input: {
    slug: string;
    titleEn: string;
    titleAr: string;
    columns: TableColumn[];
    rows: Array<Record<string, unknown>>;
    meta?: TableMeta[];
    totals?: Array<{ labelEn: string; labelAr: string; value: string; stretch?: number }>;
    notes?: Array<{ en: string; ar: string }>;
  }): ReportTable {
    return {
      slug: input.slug,
      titleEn: input.titleEn,
      titleAr: input.titleAr,
      meta: [
        ...(input.meta ?? []),
        {
          labelEn: 'Exported',
          labelAr: 'تاريخ التصدير',
          value: new Date().toISOString().slice(0, 19).replace('T', ' '),
        },
      ],
      columns: input.columns,
      rows: input.rows,
      totals: input.totals ?? [],
      notes: input.notes ?? [],
    };
  }

  /// The lists, each with the permission its own screen already requires.
  private get specs(): ListSpec[] {
    return SPECS;
  }
}

/// The one place a list is declared. Adding an entry makes it downloadable in
/// all three formats at once.
const SPECS: ListSpec[] = [
  {
    slug: 'customers',
    titleEn: 'Customers',
    titleAr: 'العملاء',
    permission: 'parties.customers.read',
    build: (service, companyId, query) => service.parties(companyId, query, 'customer'),
  },
  {
    slug: 'suppliers',
    titleEn: 'Suppliers',
    titleAr: 'الموردون',
    permission: 'parties.suppliers.read',
    build: (service, companyId, query) => service.parties(companyId, query, 'supplier'),
  },
  {
    slug: 'items',
    titleEn: 'Items',
    titleAr: 'الأصناف',
    permission: 'inventory.items.read',
    build: (service, companyId, query) => service.items(companyId, query),
  },
  {
    slug: 'stock',
    titleEn: 'Stock balances',
    titleAr: 'أرصدة المخزون',
    permission: 'inventory.stock.read',
    build: (service, companyId, query) => service.stock(companyId, query),
  },
  {
    slug: 'sales-invoices',
    titleEn: 'Sales invoices',
    titleAr: 'فواتير البيع',
    permission: 'sales.invoices.read',
    build: (service, companyId, query) => service.invoices(companyId, query, 'sales'),
  },
  {
    slug: 'purchase-invoices',
    titleEn: 'Purchase invoices',
    titleAr: 'فواتير الشراء',
    permission: 'purchases.invoices.read',
    build: (service, companyId, query) => service.invoices(companyId, query, 'purchase'),
  },
  {
    slug: 'journal-entries',
    titleEn: 'Journal entries',
    titleAr: 'القيود اليومية',
    permission: 'accounting.journal.read',
    build: (service, companyId, query) => service.journalEntries(companyId, query),
  },
  {
    slug: 'chart-of-accounts',
    titleEn: 'Chart of accounts',
    titleAr: 'شجرة الحسابات',
    permission: 'accounting.accounts.read',
    build: (service, companyId, query) => service.chartOfAccounts(companyId, query),
  },
  {
    slug: 'fiscal-periods',
    titleEn: 'Fiscal periods',
    titleAr: 'الفترات المالية',
    permission: 'accounting.periods.read',
    build: (service, companyId, query) => service.fiscalPeriods(companyId),
  },
  {
    slug: 'users',
    titleEn: 'Users',
    titleAr: 'المستخدمون',
    permission: 'admin.users.manage',
    build: (service, companyId, query) => service.users(companyId),
  },
  {
    slug: 'roles',
    titleEn: 'Roles',
    titleAr: 'الأدوار',
    permission: 'admin.roles.manage',
    build: (service, companyId) => service.roles(companyId),
  },
  {
    slug: 'audit-trail',
    titleEn: 'Audit trail',
    titleAr: 'سجل التدقيق',
    permission: 'admin.audit.read',
    build: (service, companyId, query) => service.auditTrail(companyId, query),
  },
  {
    slug: 'cash-accounts',
    titleEn: 'Cash and bank accounts',
    titleAr: 'الخزائن والحسابات البنكية',
    permission: 'cash.accounts.read',
    build: (service, companyId, query) => service.cashAccounts(companyId, query),
  },
  {
    slug: 'cash-vouchers',
    titleEn: 'Cash vouchers',
    titleAr: 'سندات القبض والصرف',
    permission: 'cash.vouchers.read',
    build: (service, companyId, query) => service.cashVouchers(companyId, query),
  },
  {
    slug: 'cash-transfers',
    titleEn: 'Cash transfers',
    titleAr: 'التحويلات بين الخزائن والبنوك',
    permission: 'cash.vouchers.read',
    build: (service, companyId, query) => service.cashTransfers(companyId, query),
  },
];
