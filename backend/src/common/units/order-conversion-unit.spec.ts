import { Prisma } from '@prisma/client';
import { historicalOrderUnit, orderUnitForInvoiceLine } from './order-conversion-unit';

const D = (value: string | number) => new Prisma.Decimal(value);

describe('historical order conversion units', () => {
  it('uses the persisted factor with exact quantities', () => {
    const result = historicalOrderUnit({ label: 'Line 1', unitName: 'carton', unitFactor: D(12), baseQuantity: D(24) });
    expect(result.snapshot.unitQuantity?.toFixed(4)).toBe('2.0000');
    expect(result.snapshot.unitFactor?.toFixed(6)).toBe('12.000000');
    expect(result.baseQuantity.toFixed(4)).toBe('24.0000');
  });
  it('keeps a legacy no-snapshot line in base units', () => {
    const result = historicalOrderUnit({ label: 'Line 1', unitName: null, unitFactor: null, baseQuantity: D(3) });
    expect(result.isLegacy).toBe(true);
    expect(result.snapshot.unitFactor).toBeNull();
    expect(result.baseQuantity.toFixed(4)).toBe('3.0000');
  });
  it('rejects incomplete snapshots and nonrepresentable partial quantities', () => {
    expect(() => historicalOrderUnit({ label: 'Line 1', unitName: 'carton', unitFactor: null, baseQuantity: D(3) })).toThrow(/incomplete/);
    expect(() => historicalOrderUnit({ label: 'Line 1', unitName: null, unitFactor: D(3), baseQuantity: D(3) })).toThrow(/incomplete/);
    expect(() => historicalOrderUnit({ label: 'Line 1', unitName: 'carton', unitFactor: D(3), baseQuantity: D(1) })).toThrow(/precision/);
  });
  it('rejects accidentally misaligned item or quantity on the internal channel', () => {
    const resolved = historicalOrderUnit({ label: 'Line 1', unitName: 'carton', unitFactor: D(10), baseQuantity: D(20) });
    const units = [{ itemId: 'one', resolved }];
    expect(orderUnitForInvoiceLine(units, 0, 'one', D(2))).toBe(resolved);
    expect(() => orderUnitForInvoiceLine(units, 0, 'two', D(2))).toThrow(/does not match/);
    expect(() => orderUnitForInvoiceLine(units, 0, 'one', D(3))).toThrow(/does not match/);
    expect(() => orderUnitForInvoiceLine(units, 1, 'one', D(2))).toThrow(/does not match/);
  });
});
