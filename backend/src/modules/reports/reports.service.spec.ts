import { BadRequestException } from '@nestjs/common';
import { ReportsService } from './reports.service';

describe('ReportsService date validation', () => {
  const service = new ReportsService({} as any);

  it('accepts a valid date-only value', () => {
    const parsed = (service as any).parseDate('2026-02-28', 'from') as Date;
    expect(parsed.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('rejects an impossible calendar date', () => {
    expect(() => (service as any).parseDate('2026-02-31', 'from')).toThrow(
      BadRequestException,
    );
  });

  it('rejects an impossible date inside an ISO timestamp', () => {
    expect(() =>
      (service as any).parseDate('2026-02-31T00:00:00Z', 'asOf'),
    ).toThrow(BadRequestException);
  });

  it('accepts a valid ISO timestamp', () => {
    const parsed = (service as any).parseDate('2026-02-28T12:30:00Z', 'asOf') as Date;
    expect(parsed.toISOString()).toBe('2026-02-28T12:30:00.000Z');
  });

  it('rejects an unparseable date', () => {
    expect(() => (service as any).parseDate('not-a-date', 'asOf')).toThrow(
      BadRequestException,
    );
  });

  it('rejects a period whose start is after its end', () => {
    expect(() =>
      (service as any).period({ from: '2026-10-02', to: '2026-10-01' }),
    ).toThrow(BadRequestException);
  });
});

describe('account ledger manual journal navigation', () => {
  it('links a source-less movement to its own journal entry instead of a null document', async () => {
    const d = (value: number) => new (require('@prisma/client').Prisma.Decimal)(value);
    const prisma = {
      account: { findFirst: jest.fn().mockResolvedValue({ id: 'account' }) },
      $queryRaw: jest.fn().mockResolvedValue([{ net: d(0) }]),
      journalLine: { findMany: jest.fn().mockResolvedValue([{
        journalEntryId: 'journal', debit: d(100), credit: d(0), description: null,
        entry: { entryNumber: 'JV-1', entryDate: new Date('2026-10-18'), description: 'Manual', sourceType: null, sourceId: null, sourceNumber: null, reversalOfId: null },
      }]) },
    };
    const result = await new ReportsService(prisma as any).accountLedger('company', 'account', { from: '2026-10-01', to: '2026-10-18' });
    expect(result.movements[0].source).toEqual({ type: 'JOURNAL_ENTRY', id: 'journal', number: 'JV-1' });
    expect(result.closing).toBe('100.0000');
  });
});

describe('customer and supplier balance reports read returns with the right sign', () => {
  const d = (value: string) => new (require('@prisma/client').Prisma.Decimal)(value);

  const serviceFor = (invoices: unknown[]) =>
    new ReportsService({
      customer: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', code: 'C-1', nameEn: 'Alpha', nameAr: 'ألفا', phone: null },
        ]),
      },
      supplier: {
        findMany: jest.fn().mockResolvedValue([
          { id: 's1', code: 'S-1', nameEn: 'Beta', nameAr: 'بيتا', phone: null },
        ]),
      },
      salesInvoice: { findMany: jest.fn().mockResolvedValue(invoices) },
      purchaseInvoice: { findMany: jest.fn().mockResolvedValue(invoices) },
    } as any);

  it('subtracts a sales return from what the customer owes', async () => {
    const result = await serviceFor([
      { customerId: 'c1', documentType: 'INVOICE', totalAmount: d('456'), paidAmount: d('200') },
      { customerId: 'c1', documentType: 'CREDIT_NOTE', totalAmount: d('57'), paidAmount: d('0') },
    ]).customerBalances('company', {});
    // 456 invoiced, 200 collected, 57 returned: the customer owes 199, not 313.
    expect(result.rows[0].invoiced).toBe('399.0000');
    expect(result.rows[0].paid).toBe('200.0000');
    expect(result.rows[0].balance).toBe('199.0000');
  });

  it('subtracts a purchase return from what the company owes the supplier', async () => {
    const result = await serviceFor([
      { supplierId: 's1', documentType: 'INVOICE', totalAmount: d('456'), paidAmount: d('200') },
      { supplierId: 's1', documentType: 'DEBIT_NOTE', totalAmount: d('182.4'), paidAmount: d('0') },
    ]).supplierBalances('company', {});
    expect(result.rows[0].invoiced).toBe('273.6000');
    expect(result.rows[0].balance).toBe('73.6000');
  });

  it('asks only for live invoices, so a reversed invoice is not counted again', async () => {
    const service = serviceFor([]);
    await service.customerBalances('company', {});
    const where = (service as any).prisma.salesInvoice.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('POSTED');
    const select = (service as any).prisma.salesInvoice.findMany.mock.calls[0][0].select;
    expect(select.documentType).toBe(true);
  });
});
