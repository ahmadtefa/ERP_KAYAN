import { InvoiceDocumentType, InvoiceStatus, Prisma } from '@prisma/client';
import { AgingService } from './aging.service';

const d = (value: number) => new Prisma.Decimal(value);
const party = { id: 'party', code: 'P1', nameEn: 'Party', nameAr: 'طرف' };
const invoice = (type: InvoiceDocumentType, total: number) => ({
  invoiceNumber: 'I1', invoiceDate: new Date('2026-10-01'), dueDate: null,
  documentType: type, totalAmount: d(total), paidAmount: d(0), journalEntryId: 'journal',
  customer: party, supplier: party,
});

describe('aging live debt after invoice and return reversals', () => {
  it.each(['receivables', 'payables'] as const)('%s counts only posted documents and reconciles net credit notes', async (method) => {
    const findMany = jest.fn().mockResolvedValue([
      invoice(InvoiceDocumentType.INVOICE, 114),
      invoice(method === 'receivables' ? InvoiceDocumentType.CREDIT_NOTE : InvoiceDocumentType.DEBIT_NOTE, 34.2),
    ]);
    const prisma = {
      salesInvoice: { findMany }, purchaseInvoice: { findMany },
      $queryRaw: jest.fn().mockResolvedValue([{ net: d(method === 'receivables' ? 79.8 : -79.8) }]),
    };
    const service = new AgingService(prisma as any);
    const result = await service[method]('company', { asOf: '2026-10-18' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: InvoiceStatus.POSTED }) }));
    expect(result.totals.total).toBe('79.8000');
    expect(result.totals.differenceFromLedger).toBe('0.0000');
  });

  it('applies the branch filter to the ledger as well as the documents', async () => {
    const prisma = {
      salesInvoice: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([{ net: d(0) }]),
    };
    await new AgingService(prisma as any).receivables('company', { branchId: 'branch' });
    const query = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.sql).toContain('e."branchId" = ?::uuid');
    expect(query.values).toContain('branch');
  });
});
