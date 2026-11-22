import {
  canReadCost,
  COST_READ_PERMISSION,
  PURCHASE_PRICE_READ_PERMISSION,
  SALES_PRICE_READ_PERMISSION,
  canReadPurchasePrice,
  canReadSalePrice,
  redactMoney,
} from './cost-visibility';

describe('cost-visibility helper', () => {
  it('grants cost access to a super admin even without the permission row', () => {
    expect(canReadCost({ isSuperAdmin: true, permissions: [] })).toBe(true);
  });

  it('retains legacy inventory.cost.read for cost only, not purchase prices', () => {
    const legacyCost = { isSuperAdmin: false, permissions: [COST_READ_PERMISSION] };
    expect(canReadCost(legacyCost)).toBe(true);
    expect(canReadPurchasePrice(legacyCost)).toBe(false);
  });

  it('keeps sale price, purchase price, and inventory cost independent', () => {
    const purchaseOnly = { isSuperAdmin: false, permissions: [PURCHASE_PRICE_READ_PERMISSION] };
    const saleOnly = { isSuperAdmin: false, permissions: [SALES_PRICE_READ_PERMISSION] };
    const costOnly = { isSuperAdmin: false, permissions: [COST_READ_PERMISSION] };

    expect(canReadPurchasePrice(purchaseOnly)).toBe(true);
    expect(canReadCost(purchaseOnly)).toBe(false);
    expect(canReadSalePrice(purchaseOnly)).toBe(false);

    expect(canReadSalePrice(saleOnly)).toBe(true);
    expect(canReadPurchasePrice(saleOnly)).toBe(false);
    expect(canReadCost(saleOnly)).toBe(false);

    expect(canReadCost(costOnly)).toBe(true);
    expect(canReadPurchasePrice(costOnly)).toBe(false);
    expect(canReadSalePrice(costOnly)).toBe(false);
  });

  it('denies cost access to an ordinary role without the permission', () => {
    expect(
      canReadCost({
        isSuperAdmin: false,
        permissions: ['inventory.items.read', 'sales.invoices.read'],
      }),
    ).toBe(false);
  });

  it('redacts money values only for callers who may not read cost', () => {
    const value = { toFixed: (scale?: number) => `12.${scale ?? 4}` };
    expect(redactMoney(value, true)).toBe('12.4');
    expect(redactMoney(value, false)).toBeNull();
  });
});
