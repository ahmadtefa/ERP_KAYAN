import { Prisma } from '@prisma/client';

import { foldVatRows, VatReturnService } from './vat-return.service';

const d = (v: string) => new Prisma.Decimal(v);
const row = (documentType: string, rate: string, base: string, tax: string, docs = 1) => ({
  documentType, taxRate: d(rate), base: d(base), tax: d(tax), docs,
});

describe('foldVatRows', () => {
  it('adds invoices and debit notes, subtracts credit notes, per rate', () => {
    const r = foldVatRows([
      row('INVOICE', '14', '1000', '140', 3),
      row('CREDIT_NOTE', '14', '100', '14', 1),
      row('DEBIT_NOTE', '14', '50', '7', 1),
      row('INVOICE', '0', '200', '0', 1),
      row('INVOICE', '5', '400', '20', 2),
    ]);
    expect(r.rates.map((x) => [x.rate, x.taxableBase, x.tax, x.documents])).toEqual([
      ['0.00', '200.0000', '0.0000', 1],
      ['5.00', '400.0000', '20.0000', 2],
      ['14.00', '950.0000', '133.0000', 5],
    ]);
    expect(r.tax.toFixed(4)).toBe('153.0000');
    expect(r.taxableBase.toFixed(4)).toBe('1550.0000');
  });
  it('is empty for no documents', () => {
    const r = foldVatRows([]);
    expect(r.rates).toEqual([]);
    expect(r.tax.toFixed(4)).toBe('0.0000');
  });
  it('keeps exact decimals, no float drift', () => {
    const r = foldVatRows([row('INVOICE', '14', '0.1', '0.014'), row('INVOICE', '14', '0.2', '0.028')]);
    expect(r.rates[0].taxableBase).toBe('0.3000');
    expect(r.rates[0].tax).toBe('0.0420');
  });
});

describe('VatReturnService.report', () => {
  const make = (sales: any[], purchases: any[]) => {
    const prisma: any = { $queryRaw: jest.fn().mockResolvedValueOnce(sales).mockResolvedValueOnce(purchases) };
    return new VatReturnService(prisma);
  };
  it('net is output minus input and names the position', async () => {
    const pay = await make([row('INVOICE', '14', '1000', '140')], [row('INVOICE', '14', '500', '70')]).report('c', { from: '2026-01-01', to: '2026-01-31' });
    expect(pay.net).toBe('70.0000');
    expect(pay.position).toBe('PAYABLE');
    const refund = await make([row('INVOICE', '14', '100', '14')], [row('INVOICE', '14', '500', '70')]).report('c', { from: '2026-01-01', to: '2026-01-31' });
    expect(refund.net).toBe('-56.0000');
    expect(refund.position).toBe('REFUNDABLE');
    const nil = await make([], []).report('c', { from: '2026-01-01', to: '2026-01-31' });
    expect(nil.position).toBe('NIL');
  });
  it('refuses a backwards or malformed period', async () => {
    await expect(make([], []).report('c', { from: '2026-02-01', to: '2026-01-01' })).rejects.toThrow(/must not be after/);
    await expect(make([], []).report('c', { from: 'x', to: '2026-01-01' })).rejects.toThrow(/YYYY-MM-DD/);
  });
});
