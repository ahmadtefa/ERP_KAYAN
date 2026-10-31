import { canReadCost } from '../auth/cost-visibility';
import {
  DEFAULT_PRINT_TYPE,
  PRINT_TYPES,
  isPrintType,
  printType,
  resolvePrintVisibility,
} from './print-settings';

const CLERK = { isSuperAdmin: false, permissions: ['reports.read'] };
const COST_READER = {
  isSuperAdmin: false,
  permissions: ['reports.read', 'inventory.cost.read'],
};
const ADMIN = { isSuperAdmin: true, permissions: [] };

const saved = (
  documentType: string,
  showSalePrice: boolean,
  showCost: boolean,
) => ({ documentType, showSalePrice, showCost });

describe('print price settings', () => {
  describe('the catalogue', () => {
    it('only names prints the program can actually produce', () => {
      // Every key is a route slug that exists: a saved setting for a print
      // nobody can start would be a setting nobody can verify.
      const keys = PRINT_TYPES.map((type) => type.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of [
        'sales-invoice',
        'purchase-invoice',
        'sales-quotation',
        'stock-document',
        'stock',
        'stock-ledger',
        'items',
        'inventory-valuation',
        'slow-moving',
        'reorder',
        'barcode-labels',
      ]) {
        expect(keys).toContain(key);
        expect(isPrintType(key)).toBe(true);
      }
      expect(isPrintType('made-up-document')).toBe(false);
    });

    it('knows which prints can carry a sale price and which a cost', () => {
      expect(printType('sales-invoice')?.carriesSalePrice).toBe(true);
      expect(printType('purchase-invoice')?.carriesCost).toBe(true);
      expect(printType('journal-entry')?.carriesCost).toBe(false);
      expect(printType('journal-entry')?.carriesSalePrice).toBe(false);
      expect(printType('barcode-labels')?.carriesSalePrice).toBe(true);
    });
  });

  describe('the four combinations the operator asked for', () => {
    it('shows both when nothing has been hidden', () => {
      expect(resolvePrintVisibility(COST_READER, {}, [])).toEqual({
        showSalePrice: true,
        showCost: true,
        source: 'builtin',
        costLocked: false,
      });
    });

    it('hides the sale price only', () => {
      const result = resolvePrintVisibility(COST_READER, { showSalePrice: 'false' }, []);
      expect(result.showSalePrice).toBe(false);
      expect(result.showCost).toBe(true);
    });

    it('hides the cost only', () => {
      const result = resolvePrintVisibility(COST_READER, { showCost: 'false' }, []);
      expect(result.showSalePrice).toBe(true);
      expect(result.showCost).toBe(false);
    });

    it('hides both', () => {
      const result = resolvePrintVisibility(
        COST_READER,
        { showSalePrice: 'false', showCost: 'false' },
        [],
      );
      expect(result.showSalePrice).toBe(false);
      expect(result.showCost).toBe(false);
    });
  });

  describe('permissions are a floor, never a preference', () => {
    it('never gives a cost to a caller who may not read costs', () => {
      const asked = resolvePrintVisibility(
        CLERK,
        { showSalePrice: 'true', showCost: 'true' },
        [saved(DEFAULT_PRINT_TYPE, true, true), saved('sales-invoice', true, true)],
        'sales-invoice',
      );
      expect(canReadCost(CLERK)).toBe(false);
      expect(asked.showCost).toBe(false);
      expect(asked.costLocked).toBe(true);
      // The sale price is a different permission and stays as asked.
      expect(asked.showSalePrice).toBe(true);
    });

    it('never restores a cost from a saved setting for such a caller', () => {
      const result = resolvePrintVisibility(CLERK, {}, [saved('items', true, true)], 'items');
      expect(result.showCost).toBe(false);
    });

    it('lets an administrator read costs without naming the permission', () => {
      const result = resolvePrintVisibility(ADMIN, {}, []);
      expect(result.showCost).toBe(true);
      expect(result.costLocked).toBe(false);
    });
  });

  describe('the order of precedence', () => {
    const settings = [
      saved(DEFAULT_PRINT_TYPE, false, false),
      saved('sales-invoice', true, true),
      saved('purchase-invoice', false, true),
    ];

    it('a choice made on this print wins over the saved setting', () => {
      const result = resolvePrintVisibility(
        COST_READER,
        { showSalePrice: 'false' },
        settings,
        'sales-invoice',
      );
      expect(result.showSalePrice).toBe(false);
      expect(result.source).toBe('request');
      // The half that was not overridden still follows the saved setting.
      expect(result.showCost).toBe(true);
    });

    it('the saved setting for the type wins over the default', () => {
      const result = resolvePrintVisibility(COST_READER, {}, settings, 'purchase-invoice');
      expect(result).toMatchObject({
        showSalePrice: false,
        showCost: true,
        source: 'type',
      });
    });

    it('the default row covers a type that was never configured', () => {
      const result = resolvePrintVisibility(COST_READER, {}, settings, 'trial-balance');
      expect(result).toMatchObject({
        showSalePrice: false,
        showCost: false,
        source: 'default',
      });
    });

    it('an installation that never opened the screen prints as it always did', () => {
      const result = resolvePrintVisibility(COST_READER, {}, [], 'sales-invoice');
      expect(result).toMatchObject({
        showSalePrice: true,
        showCost: true,
        source: 'builtin',
      });
    });
  });

  it('ignores an unreadable query value instead of hiding by accident', () => {
    const result = resolvePrintVisibility(
      COST_READER,
      { showSalePrice: 'maybe' as unknown as string },
      [],
    );
    expect(result.showSalePrice).toBe(true);
    expect(result.source).toBe('builtin');
  });
});
