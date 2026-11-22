import { Prisma, StockDirection } from '@prisma/client';
import { takeOriginalStockMovement } from './original-stock-movement';

const D = (value: number) => new Prisma.Decimal(value);
const expected = { itemId: 'item', branchId: 'branch', warehouseId: 'warehouse',
  direction: StockDirection.OUT, referenceType: 'STOCK_ADJUSTMENT', quantity: D(2) };
const movement = (id: string, cost: number) => ({
  ...expected, id, unitCost: D(cost), totalCost: D(cost).mul(2),
});

describe('original stock movement valuation', () => {
  it('uses the posted movement and refuses reuse or a different warehouse', () => {
    const used = new Set<string>();
    const row = takeOriginalStockMovement([movement('one', 7)], used, expected);
    expect(row.totalCost.toFixed(4)).toBe('14.0000');
    expect(() => takeOriginalStockMovement([row], used, expected)).toThrow(/missing or ambiguous/);
    expect(() => takeOriginalStockMovement([row], new Set(), { ...expected, warehouseId: null }))
      .toThrow(/missing or ambiguous/);
  });
  it('accepts identical duplicates but rejects ambiguous valuations', () => {
    const used = new Set<string>();
    const same = [movement('one', 7), movement('two', 7)];
    expect(takeOriginalStockMovement(same, used, expected).id)
      .not.toBe(takeOriginalStockMovement(same, used, expected).id);
    expect(() => takeOriginalStockMovement([movement('one', 7), movement('two', 8)], new Set(), expected))
      .toThrow(/missing or ambiguous/);
  });
});
