import { redactPriceFields } from './price-redaction';

describe('API price redaction', () => {
  it('redacts both types of explicit price in nested payloads independently', () => {
    const source = {
      salePrice: '20.0000',
      purchasePrice: '10.0000',
      units: [{ salePrice: '18.0000', purchasePrice: '9.0000' }],
    };
    expect(redactPriceFields(source, { sale: false, purchase: true })).toEqual({
      salePrice: null,
      purchasePrice: '10.0000',
      units: [{ salePrice: null, purchasePrice: '9.0000' }],
    });
    expect(source.salePrice).toBe('20.0000');
  });

  it('removes sales-derived totals only for a sales response', () => {
    const payload = { unitPrice: '8', totalAmount: '16', taxAmount: '2', costOfGoods: '9' };
    expect(redactPriceFields(payload, { sale: false, purchase: true }, 'sale')).toEqual({
      unitPrice: null,
      totalAmount: null,
      taxAmount: null,
      costOfGoods: '9',
    });
  });

  it('does not treat purchase visibility as selling-price permission', () => {
    expect(redactPriceFields(
      { salePrice: '20', purchasePrice: '10' },
      { sale: false, purchase: true },
    )).toEqual({ salePrice: null, purchasePrice: '10' });
  });
});
