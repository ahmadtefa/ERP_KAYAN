import {
  canReadCost,
  COST_READ_PERMISSION,
  redactMoney,
} from './cost-visibility';

describe('cost-visibility helper', () => {
  it('grants cost access to a super admin even without the permission row', () => {
    expect(canReadCost({ isSuperAdmin: true, permissions: [] })).toBe(true);
  });

  it('grants cost access when the role carries inventory.cost.read', () => {
    expect(
      canReadCost({ isSuperAdmin: false, permissions: [COST_READ_PERMISSION] }),
    ).toBe(true);
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
