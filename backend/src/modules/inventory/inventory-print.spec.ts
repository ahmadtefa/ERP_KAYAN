import { applyPriceVisibility } from '../export/price-visibility';
import {
  inventoryValuationTable,
  reorderTable,
  slowMovingTable,
  stockDocumentTable,
  type StockDocumentView,
} from './inventory-print';

const RECEIPT: StockDocumentView = {
  documentNumber: 'SD-2026-0004',
  kind: 'TRANSFER',
  documentDate: '2026-11-01',
  branch: { code: 'MAIN', nameEn: 'Main warehouse', nameAr: 'المخزن الرئيسي' },
  fromBranch: { nameEn: 'Main warehouse', nameAr: 'المخزن الرئيسي' },
  toBranch: { nameEn: 'Branch store', nameAr: 'مخزن الفرع' },
  notes: 'نقل أسبوعي',
  lines: [
    {
      lineNumber: 1,
      itemCode: 'SKU-1',
      itemNameEn: 'Network cable',
      itemNameAr: 'كابل شبكة',
      unit: 'قطعة',
      unitName: 'كرتونة',
      unitFactor: '12.000000',
      unitQuantity: '2.0000',
      quantity: '24.0000',
      unitCost: '10.0000',
    },
  ],
};

describe('the stock document sheet', () => {
  it('prints the unit that was entered, its factor and the base quantity', () => {
    const table = stockDocumentTable(RECEIPT);
    const keys = table.columns.map((column) => column.key);
    expect(keys).toEqual(
      expect.arrayContaining(['unit', 'unitFactor', 'unitQuantity', 'quantity']),
    );
    expect(table.rows[0]).toMatchObject({
      unit: 'كرتونة',
      unitFactor: '12.000000',
      unitQuantity: '2.0000',
      quantity: '24.0000',
    });
  });

  it('carries the transfer direction on the sheet', () => {
    const table = stockDocumentTable(RECEIPT);
    expect(table.meta.map((row) => row.value)).toEqual(
      expect.arrayContaining(['Main warehouse', 'Branch store']),
    );
    expect(table.titleEn).toBe('Stock transfer');
  });

  it('adds the counted figure to a physical count and not to a transfer', () => {
    const count = stockDocumentTable({
      ...RECEIPT,
      kind: 'COUNT',
      lines: [{ ...RECEIPT.lines[0], countedQuantity: '23.0000' }],
    });
    expect(count.columns.map((column) => column.key)).toContain('countedQuantity');
    expect(count.rows[0].countedQuantity).toBe('23.0000');
    expect(
      stockDocumentTable(RECEIPT).columns.map((column) => column.key),
    ).not.toContain('countedQuantity');
  });

  it('totals the value of the document when the costs may be seen', () => {
    const table = stockDocumentTable(RECEIPT);
    expect(table.totals).toHaveLength(1);
    // 24 pieces at 10 each.
    expect(table.totals[0].value).toBe('240.0000');
  });

  it('drops every cost and the value total when this copy may not show them', () => {
    const redacted = applyPriceVisibility(stockDocumentTable(RECEIPT), {
      showCost: 'false',
    });
    const keys = redacted.columns.map((column) => column.key);
    expect(keys).not.toContain('unitCost');
    expect(keys).not.toContain('costValue');
    expect(redacted.totals).toEqual([]);
    // The quantities are not money and stay: the sheet is still a stock sheet.
    expect(keys).toEqual(expect.arrayContaining(['quantity', 'unitQuantity', 'unitFactor']));
    expect(redacted.rows[0].quantity).toBe('24.0000');
    expect(redacted.rows[0]).not.toHaveProperty('unitCost');
  });
});

describe('the inventory report sheets', () => {
  const valuation = {
    rows: [
      {
        itemCode: 'SKU-1',
        itemNameEn: 'Network cable',
        unit: 'قطعة',
        branchCode: 'MAIN',
        quantity: '24.0000',
        averageCost: '10.0000',
        value: '240.0000',
      },
    ],
    totals: { value: '240.0000' },
  };

  it('prints the valuation with its cost columns for a permitted caller', () => {
    const table = inventoryValuationTable(valuation);
    expect(table.columns.map((column) => column.key)).toContain('averageCost');
    expect(table.totals[0].value).toBe('240.0000');
  });

  it('leaves no cost in the valuation when the copy may not show it', () => {
    const redacted = applyPriceVisibility(inventoryValuationTable(valuation), {
      showCost: 'false',
    });
    const keys = redacted.columns.map((column) => column.key);
    expect(keys).not.toContain('averageCost');
    expect(keys).not.toContain('value');
    expect(redacted.totals).toEqual([]);
    expect(JSON.stringify(redacted.rows)).not.toContain('240');
    expect(JSON.stringify(redacted.rows)).not.toContain('10.0000');
  });

  it('keeps the slow-moving and reorder sheets as quantity reports', () => {
    const slow = slowMovingTable({
      days: 90,
      rows: [
        {
          itemCode: 'SKU-2',
          itemNameAr: 'لفة كابل',
          unit: 'لفة',
          quantity: '5.0000',
          value: '500.0000',
          lastIssuedOn: null,
          daysSinceLastIssue: 120,
        },
      ],
      totals: { value: '500.0000', items: 1 },
    });
    expect(slow.titleAr).toContain('90');
    const reorder = reorderTable({
      rows: [
        {
          itemCode: 'SKU-3',
          itemNameEn: 'Switch',
          unit: 'قطعة',
          quantity: '2.0000',
          reorderLevel: '5',
          shortfall: '3',
        },
      ],
    });
    expect(reorder.rows[0]).toMatchObject({ reorderLevel: '5', shortfall: '3' });
    const hidden = applyPriceVisibility(slow, { showCost: 'false' });
    expect(JSON.stringify(hidden.rows)).not.toContain('500');
  });
});
