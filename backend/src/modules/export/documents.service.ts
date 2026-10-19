import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { ReportTable } from './report-table';

export const DOCUMENT_KINDS = [
  'sales-invoice',
  'purchase-invoice',
  'sales-order',
  'purchase-order',
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
        unit: l.item?.unit ?? '',
        quantity: l.quantity.toFixed(MONEY),
        unitPrice: l.unitPrice.toFixed(MONEY),
        discountAmount: l.discountAmount.toFixed(MONEY),
        discountAmount: l.discountAmount.toFixed(MONEY),
        taxAmount: l.taxAmount.toFixed(MONEY),
        lineTotal: l.lineTotal.toFixed(MONEY),
      })),
      totals: [
        {
          labelEn: 'Subtotal before discount',
          labelAr: 'المجموع قبل الخصم',
          value: invoice.subTotal.plus(invoice.discountAmount).toFixed(MONEY),
        },
        {
          labelEn: 'Discount',
          labelAr: 'الخصم',
          value: invoice.discountAmount.negated().toFixed(MONEY),
        },
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
        unit: l.item?.unit ?? '',
        quantity: l.quantity.toFixed(MONEY),
        unitPrice: l.unitPrice.toFixed(MONEY),
        taxAmount: l.taxAmount.toFixed(MONEY),
        lineTotal: l.lineTotal.toFixed(MONEY),
      })),
      totals: [
        {
          labelEn: 'Subtotal before discount',
          labelAr: 'المجموع قبل الخصم',
          value: invoice.subTotal.plus(invoice.discountAmount).toFixed(MONEY),
        },
        {
          labelEn: 'Discount',
          labelAr: 'الخصم',
          value: invoice.discountAmount.negated().toFixed(MONEY),
        },
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
        unit: l.item?.unit ?? '',
        quantity: l.quantity.toFixed(MONEY),
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
        unit: l.item?.unit ?? '',
        quantity: l.quantity.toFixed(MONEY),
        unitPrice: l.unitPrice.toFixed(MONEY),
        taxAmount: '0.0000',
        lineTotal: l.lineTotal.toFixed(MONEY),
      })),
      totals: [{ labelEn: 'Total', labelAr: 'الإجمالي', value: order.totalAmount.toFixed(MONEY) }],
    });
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
        { key: 'discountAmount', labelEn: 'Discount', labelAr: 'الخصم', numeric: true, width: 12 },
        { key: 'taxAmount', labelEn: 'Tax', labelAr: 'الضريبة', numeric: true, width: 12 },
        { key: 'lineTotal', labelEn: 'Line total', labelAr: 'الإجمالي', numeric: true, width: 14 },
      ],
      rows: input.lines,
      totals: input.totals,
      notes: [],
    };
  }
}
