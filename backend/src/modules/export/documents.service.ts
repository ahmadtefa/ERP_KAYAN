import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { columnLabel, normalizeColumns } from '../sales/quotation-columns';
import { ReportTable, TableColumn } from './report-table';

export const DOCUMENT_KINDS = [
  'sales-invoice',
  'purchase-invoice',
  'sales-order',
  'purchase-order',
  'sales-quotation',
  'cash-voucher',
  'journal-entry',
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export interface DocumentSpec {
  kind: DocumentKind;
  readPermission: string;
  exportPermission: string;
}

export const DOCUMENT_SPECS: Record<DocumentKind, DocumentSpec> = {
  'sales-invoice': {
    kind: 'sales-invoice',
    readPermission: 'sales.invoices.read',
    exportPermission: 'sales.invoices.export',
  },
  'purchase-invoice': {
    kind: 'purchase-invoice',
    readPermission: 'purchases.invoices.read',
    exportPermission: 'purchases.invoices.export',
  },
  'sales-order': {
    kind: 'sales-order',
    readPermission: 'sales.orders.read',
    exportPermission: 'sales.invoices.export',
  },
  'purchase-order': {
    kind: 'purchase-order',
    readPermission: 'purchases.orders.read',
    exportPermission: 'purchases.invoices.export',
  },
  'cash-voucher': {
    kind: 'cash-voucher',
    readPermission: 'cash.vouchers.read',
    exportPermission: 'cash.vouchers.export',
  },
  'journal-entry': {
    kind: 'journal-entry',
    readPermission: 'accounting.journal.read',
    exportPermission: 'reports.export',
  },
  'sales-quotation': {
    kind: 'sales-quotation',
    readPermission: 'sales.quotations.read',
    exportPermission: 'sales.quotations.export',
  },
};

const MONEY = 4;

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  spec(kind: string): DocumentSpec {
    if (!DOCUMENT_KINDS.includes(kind as DocumentKind)) {
      throw new BadRequestException(
        `Unknown document \"${kind}\". Known: ${DOCUMENT_KINDS.join(', ')}.`,
      );
    }
    return DOCUMENT_SPECS[kind as DocumentKind];
  }

  async build(kind: DocumentKind, companyId: string, id: string, lang: 'ar' | 'en'): Promise<ReportTable> {
    switch (kind) {
      case 'sales-invoice':
        return this.salesInvoice(companyId, id, lang);
      case 'purchase-invoice':
        return this.purchaseInvoice(companyId, id, lang);
      case 'sales-order':
        return this.salesOrder(companyId, id);
      case 'purchase-order':
        return this.purchaseOrder(companyId, id);
      case 'sales-quotation':
        return this.salesQuotation(companyId, id, lang);
      case 'cash-voucher':
        return this.cashVoucher(companyId, id, lang);
      case 'journal-entry':
        return this.journalEntry(companyId, id, lang);
    }
  }

  private async salesInvoice(companyId: string, id: string, lang: 'ar' | 'en'): Promise<ReportTable> {
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        customer: { select: { code: true, nameEn: true, nameAr: true } },
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Sales invoice not found');
    const party = invoice.customer;
    const partyName = lang === 'ar' ? party?.nameAr || party?.nameEn : party?.nameEn;
    return this.lineDocument({
      slug: 'sales-invoice',
      titleEn: `Sales invoice ${invoice.invoiceNumber}`,
      titleAr: `فاتورة بيع ${invoice.invoiceNumber}`,
      meta: [
        { labelEn: 'Number', labelAr: 'الرقم', value: invoice.invoiceNumber },
        { labelEn: 'Date', labelAr: 'التاريخ', value: invoice.invoiceDate.toISOString().slice(0, 10) },
        { labelEn: 'Status', labelAr: 'الحالة', value: invoice.status },
        { labelEn: 'Customer', labelAr: 'العميل', value: `${party?.code ?? ''} ${partyName ?? ''}`.trim() },
        {
          labelEn: 'Branch',
          labelAr: 'الفرع',
          value: lang === 'ar' ? invoice.branch?.nameAr || invoice.branch?.nameEn || '' : invoice.branch?.nameEn || '',
        },
        { labelEn: 'Notes', labelAr: 'ملاحظات', value: invoice.notes ?? '' },
      ],
      lines: invoice.lines.map((l: any) => ({
        lineNumber: String(l.lineNumber),
        itemCode: l.item?.code ?? '',
        description: l.description || (lang === 'ar' ? l.item?.nameAr || l.item?.nameEn : l.item?.nameEn) || '',
        // Show the unit the user chose and the quantity they typed, not the
        // internal base-unit conversion. Legacy rows fall back to item unit.
        unit: l.unitName ?? l.item?.unit ?? '',
        quantity: (l.unitQuantity ?? l.quantity).toFixed(MONEY),
        unitPrice: l.unitPrice.toFixed(MONEY),
        taxAmount: l.taxAmount.toFixed(MONEY),
        lineTotal: l.lineTotal.toFixed(MONEY),
      })),
      totals: [
        { labelEn: 'Subtotal', labelAr: 'المجموع الفرعي', value: invoice.subTotal.toFixed(MONEY) },
        { labelEn: 'Tax', labelAr: 'الضريبة', value: invoice.taxAmount.toFixed(MONEY) },
        { labelEn: 'Total', labelAr: 'الإجمالي', value: invoice.totalAmount.toFixed(MONEY) },
      ],
    });
  }

  private async purchaseInvoice(companyId: string, id: string, lang: 'ar' | 'en'): Promise<ReportTable> {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        supplier: { select: { code: true, nameEn: true, nameAr: true } },
        branch: { select: { code: true, nameEn: true, nameAr: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } },
        },
      },
    });
    if (!invoice) throw new NotFoundException('Purchase invoice not found');
    const party = invoice.supplier;
    const partyName = lang === 'ar' ? party?.nameAr || party?.nameEn : party?.nameEn;
    return this.lineDocument({
      slug: 'purchase-invoice',
      titleEn: `Purchase invoice ${invoice.invoiceNumber}`,
      titleAr: `فاتورة شراء ${invoice.invoiceNumber}`,
      meta: [
        { labelEn: 'Number', labelAr: 'الرقم', value: invoice.invoiceNumber },
        { labelEn: 'Date', labelAr: 'التاريخ', value: invoice.invoiceDate.toISOString().slice(0, 10) },
        { labelEn: 'Status', labelAr: 'الحالة', value: invoice.status },
        { labelEn: 'Supplier', labelAr: 'المورد', value: `${party?.code ?? ''} ${partyName ?? ''}`.trim() },
        {
          labelEn: 'Branch',
          labelAr: 'الفرع',
          value: lang === 'ar' ? invoice.branch?.nameAr || invoice.branch?.nameEn || '' : invoice.branch?.nameEn || '',
        },
        { labelEn: 'Notes', labelAr: 'ملاحظات', value: invoice.notes ?? '' },
      ],
      lines: invoice.lines.map((l: any) => ({
        lineNumber: String(l.lineNumber),
        itemCode: l.item?.code ?? '',
        description: l.description || (lang === 'ar' ? l.item?.nameAr || l.item?.nameEn : l.item?.nameEn) || '',
        // Chosen unit and entered quantity; legacy rows fall back to base unit.
        unit: l.unitName ?? l.item?.unit ?? '',
        quantity: (l.unitQuantity ?? l.quantity).toFixed(MONEY),
        unitPrice: l.unitPrice.toFixed(MONEY),
        taxAmount: l.taxAmount.toFixed(MONEY),
        lineTotal: l.lineTotal.toFixed(MONEY),
      })),
      totals: [
        { labelEn: 'Subtotal', labelAr: 'المجموع الفرعي', value: invoice.subTotal.toFixed(MONEY) },
        { labelEn: 'Tax', labelAr: 'الضريبة', value: invoice.taxAmount.toFixed(MONEY) },
        { labelEn: 'Total', labelAr: 'الإجمالي', value: invoice.totalAmount.toFixed(MONEY) },
      ],
    });
  }

  private async salesOrder(companyId: string, id: string): Promise<ReportTable> {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        customer: { select: { code: true, nameEn: true, nameAr: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } },
        },
      },
    });
    if (!order) throw new NotFoundException('Sales order not found');
    return this.lineDocument({
      slug: 'sales-order',
      titleEn: `Sales order ${order.orderNumber}`,
      titleAr: `أمر بيع ${order.orderNumber}`,
      meta: [
        { labelEn: 'Number', labelAr: 'الرقم', value: order.orderNumber },
        { labelEn: 'Date', labelAr: 'التاريخ', value: order.orderDate.toISOString().slice(0, 10) },
        { labelEn: 'Status', labelAr: 'الحالة', value: order.status },
        {
          labelEn: 'Customer',
          labelAr: 'العميل',
          value: `${order.customer?.code ?? ''} ${order.customer?.nameEn ?? ''}`.trim(),
        },
      ],
      lines: order.lines.map((l: any) => ({
        lineNumber: String(l.lineNumber),
        itemCode: l.item?.code ?? '',
        description: l.description || l.item?.nameEn || '',
        unit: l.unitName ?? l.item?.unit ?? '',
        quantity: (l.unitQuantity ?? l.quantity).toFixed(MONEY),
        unitPrice: l.unitPrice.toFixed(MONEY),
        taxAmount: '0.0000',
        lineTotal: l.lineTotal.toFixed(MONEY),
      })),
      totals: [{ labelEn: 'Total', labelAr: 'الإجمالي', value: order.totalAmount.toFixed(MONEY) }],
    });
  }

  private async purchaseOrder(companyId: string, id: string): Promise<ReportTable> {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        supplier: { select: { code: true, nameEn: true, nameAr: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { item: { select: { code: true, nameEn: true, nameAr: true, unit: true } } },
        },
      },
    });
    if (!order) throw new NotFoundException('Purchase order not found');
    return this.lineDocument({
      slug: 'purchase-order',
      titleEn: `Purchase order ${order.orderNumber}`,
      titleAr: `أمر شراء ${order.orderNumber}`,
      meta: [
        { labelEn: 'Number', labelAr: 'الرقم', value: order.orderNumber },
        { labelEn: 'Date', labelAr: 'التاريخ', value: order.orderDate.toISOString().slice(0, 10) },
        { labelEn: 'Status', labelAr: 'الحالة', value: order.status },
        {
          labelEn: 'Supplier',
          labelAr: 'المورد',
          value: `${order.supplier?.code ?? ''} ${order.supplier?.nameEn ?? ''}`.trim(),
        },
      ],
      lines: order.lines.map((l: any) => ({
        lineNumber: String(l.lineNumber),
        itemCode: l.item?.code ?? '',
        description: l.description || l.item?.nameEn || '',
        unit: l.unitName ?? l.item?.unit ?? '',
        quantity: (l.unitQuantity ?? l.quantity).toFixed(MONEY),
        unitPrice: l.unitPrice.toFixed(MONEY),
        taxAmount: '0.0000',
        lineTotal: l.lineTotal.toFixed(MONEY),
      })),
      totals: [{ labelEn: 'Total', labelAr: 'الإجمالي', value: order.totalAmount.toFixed(MONEY) }],
    });
  }

  /// A quotation as a file. The columns are the offer's own layout, in its
  /// own order and with its own labels, so the spreadsheet matches the printed
  /// page. A table title is added as the first column because a flat file
  /// loses the section headings the page shows.
  private async salesQuotation(
    companyId: string,
    id: string,
    lang: 'ar' | 'en',
  ): Promise<ReportTable> {
    const quotation = await this.prisma.quotation.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        customer: { select: { code: true, nameEn: true, nameAr: true } },
        tables: {
          orderBy: { sortOrder: 'asc' },
          include: {
            lines: {
              orderBy: { lineNumber: 'asc' },
              include: { item: { select: { code: true, nameEn: true, nameAr: true } } },
            },
          },
        },
      },
    });
    if (!quotation) throw new NotFoundException('Quotation not found');

    const layout = normalizeColumns(quotation.columns).filter((column) => column.visible);
    const columns: TableColumn[] = [
      { key: 'table', labelEn: 'Table', labelAr: 'الجدول', width: 18 },
      ...layout.map((column) => ({
        key: column.key,
        labelEn: columnLabel(column, 'en'),
        labelAr: columnLabel(column, 'ar'),
        // Built-in money columns carry their flag in the layout; a
        // user-defined column is never looked up in the built-in catalogue,
        // where its key does not exist.
        numeric: column.numeric === true,
        width: Math.max(8, column.width * 6),
      })),
    ];

    const rows: Array<Record<string, unknown>> = [];
    for (const table of quotation.tables) {
      for (const line of table.lines) {
        const description =
          line.description ||
          (lang === 'ar' ? line.item?.nameAr || line.item?.nameEn : line.item?.nameEn) ||
          '';
        const row: Record<string, unknown> = {
          table: table.title,
          itemCode: line.item?.code ?? '',
          description,
          countryOfOrigin: line.countryOfOrigin ?? '',
          unit: line.unit ?? '',
          quantity: line.quantity.toFixed(MONEY),
          unitPrice: line.unitPrice.toFixed(MONEY),
          lineTotal: line.lineTotal.toFixed(MONEY),
        };
        // The value under each user-defined column is stored per line; a line
        // that left it blank must still produce a cell, not shift the row.
        const custom = (line.customValues as Record<string, unknown> | null) ?? {};
        for (const column of layout) {
          if (column.key in row) continue;
          const value = custom[column.key];
          row[column.key] =
            typeof value === 'string'
              ? value
              : value === undefined || value === null
                ? ''
                : String(value);
        }
        rows.push(row);
      }
    }

    const party = quotation.customer;
    const partyName = lang === 'ar' ? party?.nameAr || party?.nameEn : party?.nameEn;
    const tableDiscounts = quotation.tables.reduce(
      (sum: number, table: { discountTotal: unknown }) => sum + Number(table.discountTotal),
      0,
    );
    const quotationDiscount = Number(quotation.discountTotal) - tableDiscounts;
    return {
      slug: 'sales-quotation',
      titleEn: `Quotation ${quotation.quotationNumber}`,
      titleAr: `عرض سعر ${quotation.quotationNumber}`,
      meta: [
        { labelEn: 'Number', labelAr: 'الرقم', value: quotation.quotationNumber },
        { labelEn: 'Date', labelAr: 'التاريخ', value: quotation.quotationDate.toISOString().slice(0, 10) },
        {
          labelEn: 'Valid until',
          labelAr: 'صالح حتى',
          value: quotation.validUntil?.toISOString().slice(0, 10) ?? '',
        },
        {
          labelEn: 'Customer',
          labelAr: 'العميل',
          value: `${party?.code ?? ''} ${partyName ?? ''}`.trim(),
        },
        { labelEn: 'Subject', labelAr: 'الموضوع', value: quotation.subject ?? '' },
        { labelEn: 'Currency', labelAr: 'العملة', value: quotation.currency },
        { labelEn: 'Version', labelAr: 'الإصدار', value: String(quotation.version) },
        { labelEn: 'Status', labelAr: 'الحالة', value: quotation.status },
      ].filter((item) => item.value.trim().length > 0),
      columns,
      rows,
      totals: [
        { labelEn: 'Subtotal', labelAr: 'الإجمالي قبل الخصم', value: quotation.subTotal.toFixed(MONEY) },
        { labelEn: 'Table discounts', labelAr: 'خصومات الجداول', value: tableDiscounts.toFixed(MONEY) },
        {
          labelEn: 'Quotation discount',
          labelAr: 'خصم العرض',
          value: (quotationDiscount > 0 ? quotationDiscount : 0).toFixed(MONEY),
        },
        { labelEn: 'Total', labelAr: 'الإجمالي النهائي', value: quotation.totalAmount.toFixed(MONEY) },
      ],
      notes: [
        { en: 'This offer is not a tax invoice.', ar: 'هذا العرض ليس فاتورة ضريبية.' },
        ...(quotation.terms ? [{ en: quotation.terms, ar: quotation.terms }] : []),
      ],
    };
  }

  private async cashVoucher(companyId: string, id: string, lang: 'ar' | 'en'): Promise<ReportTable> {
    const voucher = await this.prisma.cashVoucher.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        cashAccount: { select: { code: true, nameEn: true, nameAr: true } },
        customer: { select: { code: true, nameEn: true, nameAr: true } },
        supplier: { select: { code: true, nameEn: true, nameAr: true } },
        allocations: {
          include: {
            salesInvoice: { select: { invoiceNumber: true, totalAmount: true } },
            purchaseInvoice: { select: { invoiceNumber: true, totalAmount: true } },
          },
        },
      },
    });
    if (!voucher) throw new NotFoundException('Cash voucher not found');
    const party =
      voucher.customer
        ? `${voucher.customer.code} ${lang === 'ar' ? voucher.customer.nameAr || voucher.customer.nameEn : voucher.customer.nameEn}`
        : voucher.supplier
          ? `${voucher.supplier.code} ${lang === 'ar' ? voucher.supplier.nameAr || voucher.supplier.nameEn : voucher.supplier.nameEn}`
          : '';
    const cashName =
      lang === 'ar'
        ? voucher.cashAccount.nameAr || voucher.cashAccount.nameEn
        : voucher.cashAccount.nameEn;
    return {
      slug: 'cash-voucher',
      titleEn: `${voucher.kind} ${voucher.voucherNumber}`,
      titleAr: `${voucher.kind === 'RECEIPT' ? 'سند قبض' : 'سند صرف'} ${voucher.voucherNumber}`,
      meta: [
        { labelEn: 'Number', labelAr: 'الرقم', value: voucher.voucherNumber },
        { labelEn: 'Date', labelAr: 'التاريخ', value: voucher.voucherDate.toISOString().slice(0, 10) },
        { labelEn: 'Kind', labelAr: 'النوع', value: voucher.kind },
        { labelEn: 'Status', labelAr: 'الحالة', value: voucher.status },
        { labelEn: 'Cash / bank', labelAr: 'الخزينة / البنك', value: `${voucher.cashAccount.code} ${cashName}` },
        { labelEn: 'Party', labelAr: 'الطرف', value: party },
        { labelEn: 'Description', labelAr: 'البيان', value: voucher.description ?? '' },
        { labelEn: 'Currency', labelAr: 'العملة', value: voucher.currency },
      ],
      columns: [
        { key: 'document', labelEn: 'Document', labelAr: 'المستند', width: 22 },
        { key: 'amount', labelEn: 'Amount', labelAr: 'المبلغ', numeric: true, width: 16 },
      ],
      rows:
        voucher.allocations.length > 0
          ? voucher.allocations.map((a: any) => ({
              document: a.salesInvoice?.invoiceNumber || a.purchaseInvoice?.invoiceNumber || '',
              amount: a.amount.toFixed(MONEY),
            }))
          : [{ document: voucher.description ?? voucher.voucherNumber, amount: voucher.amount.toFixed(MONEY) }],
      totals: [{ labelEn: 'Amount', labelAr: 'المبلغ', value: voucher.amount.toFixed(MONEY) }],
      notes: [],
    };
  }

  private async journalEntry(companyId: string, id: string, lang: 'ar' | 'en'): Promise<ReportTable> {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, companyId },
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { account: { select: { code: true, nameEn: true, nameAr: true } } },
        },
      },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    return {
      slug: 'journal-entry',
      titleEn: `Journal ${entry.entryNumber}`,
      titleAr: `قيد يومية ${entry.entryNumber}`,
      meta: [
        { labelEn: 'Number', labelAr: 'الرقم', value: entry.entryNumber },
        { labelEn: 'Date', labelAr: 'التاريخ', value: entry.entryDate.toISOString().slice(0, 10) },
        { labelEn: 'Status', labelAr: 'الحالة', value: entry.status },
        { labelEn: 'Description', labelAr: 'البيان', value: entry.description ?? '' },
      ],
      columns: [
        { key: 'lineNumber', labelEn: '#', labelAr: '#', numeric: true, width: 6 },
        { key: 'account', labelEn: 'Account', labelAr: 'الحساب', width: 36 },
        { key: 'debit', labelEn: 'Debit', labelAr: 'مدين', numeric: true, width: 16 },
        { key: 'credit', labelEn: 'Credit', labelAr: 'دائن', numeric: true, width: 16 },
        { key: 'memo', labelEn: 'Memo', labelAr: 'البيان', width: 28 },
      ],
      rows: entry.lines.map((l: any) => ({
        lineNumber: String(l.lineNumber),
        account: `${l.account.code} ${lang === 'ar' ? l.account.nameAr || l.account.nameEn : l.account.nameEn}`,
        debit: l.debit.toFixed(MONEY),
        credit: l.credit.toFixed(MONEY),
        memo: l.description ?? '',
      })),
      totals: [
        { labelEn: 'Debit', labelAr: 'مدين', value: entry.totalDebit.toFixed(MONEY) },
        { labelEn: 'Credit', labelAr: 'دائن', value: entry.totalCredit.toFixed(MONEY) },
      ],
      notes: [],
    };
  }

  private lineDocument(input: {
    slug: string;
    titleEn: string;
    titleAr: string;
    meta: ReportTable['meta'];
    lines: Array<Record<string, string>>;
    totals: ReportTable['totals'];
  }): ReportTable {
    return {
      slug: input.slug,
      titleEn: input.titleEn,
      titleAr: input.titleAr,
      meta: input.meta,
      columns: [
        { key: 'lineNumber', labelEn: '#', labelAr: '#', numeric: true, width: 6 },
        { key: 'itemCode', labelEn: 'Item', labelAr: 'الصنف', width: 14 },
        { key: 'description', labelEn: 'Description', labelAr: 'الوصف', width: 32 },
        { key: 'unit', labelEn: 'Unit', labelAr: 'الوحدة', width: 10 },
        { key: 'quantity', labelEn: 'Qty', labelAr: 'الكمية', numeric: true, width: 12 },
        { key: 'unitPrice', labelEn: 'Price', labelAr: 'السعر', numeric: true, width: 14 },
        { key: 'taxAmount', labelEn: 'Tax', labelAr: 'الضريبة', numeric: true, width: 12 },
        { key: 'lineTotal', labelEn: 'Line total', labelAr: 'الإجمالي', numeric: true, width: 14 },
      ],
      rows: input.lines,
      totals: input.totals,
      notes: [],
    };
  }
}
