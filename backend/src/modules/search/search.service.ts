import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

export interface SearchResult {
  type:
    | 'SALES_INVOICE'
    | 'PURCHASE_INVOICE'
    | 'CASH_VOUCHER'
    | 'JOURNAL_ENTRY'
    | 'CUSTOMER'
    | 'SUPPLIER'
    | 'ITEM';
  id: string;
  title: string;
  subtitle: string;
  date: string | null;
  amount: string | null;
  status: string | null;
  route: string;
}

/**
 * One box that answers "where is that thing?": documents, people and items
 * are searched together, so nobody has to open every screen to find an
 * invoice by its number or a customer by their phone.
 *
 * The search only reads what the caller's company owns, and only the summary
 * of each row - the document itself is still behind its own permission.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(companyId: string, q: string, limit = 8) {
    const term = q.trim();
    if (term.length < 2) return { query: term, results: [] as SearchResult[], total: 0 };
    const take = Math.min(Math.max(limit, 1), 25);
    const contains = { contains: term, mode: 'insensitive' as const };

    const [sales, purchases, vouchers, journals, customers, suppliers, items] =
      await Promise.all([
        this.prisma.salesInvoice.findMany({
          where: {
            companyId,
            deletedAt: null,
            OR: [
              { invoiceNumber: contains },
              { customer: { nameEn: contains } },
              { customer: { nameAr: contains } },
              { customer: { code: contains } },
            ],
          },
          take,
          orderBy: { invoiceDate: 'desc' },
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            totalAmount: true,
            status: true,
            customer: { select: { nameEn: true, nameAr: true } },
          },
        }),
        this.prisma.purchaseInvoice.findMany({
          where: {
            companyId,
            deletedAt: null,
            OR: [
              { invoiceNumber: contains },
              { supplier: { nameEn: contains } },
              { supplier: { nameAr: contains } },
              { supplier: { code: contains } },
            ],
          },
          take,
          orderBy: { invoiceDate: 'desc' },
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            totalAmount: true,
            status: true,
            supplier: { select: { nameEn: true, nameAr: true } },
          },
        }),
        this.prisma.cashVoucher.findMany({
          where: {
            companyId,
            deletedAt: null,
            OR: [
              { voucherNumber: contains },
              { reference: contains },
              { description: contains },
              { customer: { nameEn: contains } },
              { customer: { nameAr: contains } },
              { supplier: { nameEn: contains } },
              { supplier: { nameAr: contains } },
            ],
          },
          take,
          orderBy: { voucherDate: 'desc' },
          select: {
            id: true,
            voucherNumber: true,
            voucherDate: true,
            amount: true,
            kind: true,
            status: true,
          },
        }),
        this.prisma.journalEntry.findMany({
          where: {
            companyId,
            OR: [
              { entryNumber: contains },
              { description: contains },
              { sourceNumber: contains },
            ],
          },
          take,
          orderBy: { entryDate: 'desc' },
          select: {
            id: true,
            entryNumber: true,
            entryDate: true,
            totalDebit: true,
            status: true,
            description: true,
          },
        }),
        this.prisma.customer.findMany({
          where: {
            companyId,
            deletedAt: null,
            OR: [
              { code: contains },
              { nameEn: contains },
              { nameAr: contains },
              { phone: contains },
              { email: contains },
              { taxNumber: contains },
            ],
          },
          take,
          orderBy: { code: 'asc' },
          select: { id: true, code: true, nameEn: true, nameAr: true, phone: true },
        }),
        this.prisma.supplier.findMany({
          where: {
            companyId,
            deletedAt: null,
            OR: [
              { code: contains },
              { nameEn: contains },
              { nameAr: contains },
              { phone: contains },
              { email: contains },
              { taxNumber: contains },
            ],
          },
          take,
          orderBy: { code: 'asc' },
          select: { id: true, code: true, nameEn: true, nameAr: true, phone: true },
        }),
        this.prisma.item.findMany({
          where: {
            companyId,
            deletedAt: null,
            OR: [ { code: contains }, { nameEn: contains }, { nameAr: contains }, { barcode: contains }, { units: { some: { barcode: contains } } } ],
          },
          take,
          orderBy: { code: 'asc' },
          select: { id: true, code: true, nameEn: true, nameAr: true, salePrice: true },
        }),
      ]);

    const money = (value: Prisma.Decimal | null | undefined) =>
      value == null ? null : value.toFixed(4);

    const results: SearchResult[] = [
      ...sales.map((row) => ({
        type: 'SALES_INVOICE' as const,
        id: row.id,
        title: row.invoiceNumber,
        subtitle: `${row.customer.nameAr} / ${row.customer.nameEn}`,
        date: row.invoiceDate.toISOString().slice(0, 10),
        amount: money(row.totalAmount),
        status: row.status,
        route: '/sales/invoices',
      })),
      ...purchases.map((row) => ({
        type: 'PURCHASE_INVOICE' as const,
        id: row.id,
        title: row.invoiceNumber,
        subtitle: `${row.supplier.nameAr} / ${row.supplier.nameEn}`,
        date: row.invoiceDate.toISOString().slice(0, 10),
        amount: money(row.totalAmount),
        status: row.status,
        route: '/purchases/invoices',
      })),
      ...vouchers.map((row) => ({
        type: 'CASH_VOUCHER' as const,
        id: row.id,
        title: row.voucherNumber,
        subtitle: row.kind === 'RECEIPT' ? 'سند قبض / Receipt' : 'سند صرف / Payment',
        date: row.voucherDate.toISOString().slice(0, 10),
        amount: money(row.amount),
        status: row.status,
        route: '/cash',
      })),
      ...journals.map((row) => ({
        type: 'JOURNAL_ENTRY' as const,
        id: row.id,
        title: row.entryNumber,
        subtitle: row.description ?? 'قيد يومية / Journal entry',
        date: row.entryDate.toISOString().slice(0, 10),
        amount: money(row.totalDebit),
        status: row.status,
        route: '/accounting/journal-entries',
      })),
      ...customers.map((row) => ({
        type: 'CUSTOMER' as const,
        id: row.id,
        title: `${row.nameAr} / ${row.nameEn}`,
        subtitle: `${row.code}${row.phone ? ` · ${row.phone}` : ''}`,
        date: null,
        amount: null,
        status: null,
        route: '/parties/customers',
      })),
      ...suppliers.map((row) => ({
        type: 'SUPPLIER' as const,
        id: row.id,
        title: `${row.nameAr} / ${row.nameEn}`,
        subtitle: `${row.code}${row.phone ? ` · ${row.phone}` : ''}`,
        date: null,
        amount: null,
        status: null,
        route: '/parties/suppliers',
      })),
      ...items.map((row) => ({
        type: 'ITEM' as const,
        id: row.id,
        title: `${row.nameAr} / ${row.nameEn}`,
        subtitle: `${row.code} · ${money(row.salePrice) ?? ''}`,
        date: null,
        amount: money(row.salePrice),
        status: null,
        route: '/inventory/items',
      })),
    ];

    return { query: term, results, total: results.length };
  }
}
