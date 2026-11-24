import { redactPriceFields } from './price-redaction';

describe('API price redaction', () => {
  it('redacts both types of explicit price in nested payloads independently', () => {
    const source = {
      salePrice: '20.0000',
      purchasePrice: '10.0000',
      units: [{ salePrice: '18.0000', purchasePrice: '9.0000' }],
    };
    expect(redactPriceFields(source, { sale: false, purchase: true, cost: false })).toEqual({
      purchasePrice: '10.0000',
      units: [{ purchasePrice: '9.0000' }],
    });
    expect(source.salePrice).toBe('20.0000');
  });

  it('removes sales-derived totals only for a sales response', () => {
    const payload = { unitPrice: '8', totalAmount: '16', taxAmount: '2', costOfGoods: '9' };
    expect(redactPriceFields(payload, { sale: false, purchase: true, cost: true }, 'sale')).toEqual({
      costOfGoods: '9',
    });
  });

  it('does not treat purchase visibility as selling-price permission', () => {
    expect(redactPriceFields(
      { salePrice: '20', purchasePrice: '10', unitCost: '8' },
      { sale: false, purchase: true, cost: false },
    )).toEqual({ purchasePrice: '10' });
  });

  it('redacts inventory and returned valuation fields unless cost access is granted', () => {
    const payload = { inventoryCostTotal: '125.00', returnedCostTotal: '25.00' };
    expect(redactPriceFields(payload, { sale: true, purchase: true, cost: false })).toEqual({});
    expect(redactPriceFields(payload, { sale: true, purchase: true, cost: true })).toEqual(payload);
  });

  it('hides caller-named report columns alongside the shared cost set', () => {
    const report = {
      rows: [{ quantity: '4', unitCost: '6', value: '25', difference: '9', purchasePrice: '2' }],
      opening: { quantity: '4', value: '25' },
      totals: { value: '25' },
    };
    expect(redactPriceFields(report, { sale: false, purchase: false, cost: false }, null, {
      costKeys: ['value', 'difference'],
      purchaseKeys: ['purchasePrice'],
    })).toEqual({
      rows: [{ quantity: '4' }],
      opening: { quantity: '4' },
      totals: {},
    });
    // The caller's names extend the hidden set; they do not force a cost
    // column out of a response the user is allowed to read.
    expect(redactPriceFields(report, { sale: false, purchase: false, cost: true }, null, {
      costKeys: ['value', 'difference'],
    })).toEqual({
      rows: [{ quantity: '4', unitCost: '6', value: '25', difference: '9' }],
      opening: { quantity: '4', value: '25' },
      totals: { value: '25' },
    });
  });

  it('leaves the payload untouched when the caller names nothing', () => {
    const payload = { rows: [{ quantity: '4', unitCost: '6' }] };
    expect(redactPriceFields(payload, { sale: true, purchase: true, cost: true }))
      .toEqual(payload);
  });
});
