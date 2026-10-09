import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { ReportTable, TableColumn, TableMeta } from './report-table';

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
      include: { branch: true },
      orderBy: [{ entryDate: 'desc' }, { entryNumber: 'desc' }],
    });

    return this.table({
      slug: 'journal-entries',
      titleEn: 'Journal entries',
      titleAr: 'القيود اليومية',
      meta: [this.count(rows.length)],
      columns: [
        { key: 'entryNumber', labelEn: 'Number', labelAr: 'الرقم', width: 16 },
        { key: 'entryDate', labelEn: 'Date', labelAr: 'التاريخ', width: 13, date: true },
        { key: 'description', labelEn: 'Description', labelAr: 'البيان', width: 40 },
        { key: 'branch', labelEn: 'Branch', labelAr: 'الفرع', width: 16 },
        { key: 'status', labelEn: 'Status', labelAr: 'الحالة', width: 12 },
        { key: 'debit', labelEn: 'Debit', labelAr: 'مدين', numeric: true, width: 16 },
        { key: 'credit', labelEn: 'Credit', labelAr: 'دائن', numeric: true, width: 16 },
      ],
      rows: rows.map((row) => ({
        entryNumber: row.entryNumber,
        entryDate: row.entryDate,
        description: row.description ?? '',
        branch: row.branch?.nameEn ?? '',
        status: row.status,
        // The entry carries its own totals, and they are the ones the books
        // balance on, so they are what the file reports.
        debit: new Prisma.Decimal(row.totalDebit ?? 0).toFixed(4),
        credit: new Prisma.Decimal(row.totalCredit ?? 0).toFixed(4),
      })),
    });
  }

  async chartOfAccounts(companyId: string, query: ListQuery): Promise<ReportTable> {
    const rows = await this.prisma.account.findMany({
      where: {
        companyId,
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

    return this.table({
      slug: 'chart-of-accounts',
      titleEn: 'Chart of accounts',
      titleAr: 'شجرة الحسابات',
      meta: [this.count(filtered.length)],
      columns: [
        { key: 'code', labelEn: 'Code', labelAr: 'الكود', width: 14 },
        { key: 'nameEn', labelEn: 'Name (English)', labelAr: 'الاسم (إنجليزي)', width: 30 },
        { key: 'nameAr', labelEn: 'Name (Arabic)', labelAr: 'الاسم (عربي)', width: 30 },
        { key: 'type', labelEn: 'Type', labelAr: 'النوع', width: 14 },
        { key: 'isPostable', labelEn: 'Postable', labelAr: 'يقبل الترحيل', boolean: true, width: 12 },
        { key: 'isActive', labelEn: 'Active', labelAr: 'نشط', boolean: true, width: 10 },
      ],
      rows: filtered as unknown as Array<Record<string, unknown>>,
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
      totals: [],
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
];
