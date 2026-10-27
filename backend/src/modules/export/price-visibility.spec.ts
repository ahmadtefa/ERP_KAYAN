import { applyPriceVisibility } from './price-visibility';
import { ReportTable } from './report-table';

const table: ReportTable = {
  slug: 'items',
  titleEn: 'Items',
  titleAr: 'الأصناف',
  meta: [],
  columns: [
    { key: 'code', labelEn: 'Code', labelAr: 'الكود' },
    { key: 'salePrice', labelEn: 'Sale price', labelAr: 'سعر البيع', numeric: true },
    { key: 'purchasePrice', labelEn: 'Purchase price', labelAr: 'سعر الشراء', numeric: true },
    { key: 'quantity', labelEn: 'Quantity', labelAr: 'الكمية', numeric: true },
  ],
  rows: [{ code: 'A1', salePrice: '20', purchasePrice: '10', quantity: '3' }],
  totals: [],
  notes: [],
};

describe('applyPriceVisibility', () => {
  it('preserves the existing table when both prices are visible', () => {
    expect(applyPriceVisibility(table, {})).toBe(table);
  });

  it('hides sale price without changing the source table or cost', () => {
    const result = applyPriceVisibility(table, { showSalePrice: 'false' });
    expect(result.columns.map((column) => column.key)).toEqual(['code', 'purchasePrice', 'quantity']);
    expect(result.rows[0]).toEqual({ code: 'A1', purchasePrice: '10', quantity: '3' });
    expect(table.rows[0].salePrice).toBe('20');
  });

  it('hides cost independently', () => {
    const result = applyPriceVisibility(table, { showCost: 'false' });
    expect(result.columns.map((column) => column.key)).toEqual(['code', 'salePrice', 'quantity']);
    expect(result.rows[0]).toEqual({ code: 'A1', salePrice: '20', quantity: '3' });
  });

  it('hides both categories when both options are false', () => {
    const result = applyPriceVisibility(table, { showSalePrice: 'false', showCost: 'false' });
    expect(result.columns.map((column) => column.key)).toEqual(['code', 'quantity']);
    expect(result.rows[0]).toEqual({ code: 'A1', quantity: '3' });
  });

  it('removes sales invoice monetary details when sale price is hidden', () => {
    const invoice: ReportTable = {
      ...table,
      slug: 'sales-invoice',
      columns: [
        { key: 'itemCode', labelEn: 'Item code', labelAr: 'كود الصنف' },
        { key: 'quantity', labelEn: 'Quantity', labelAr: 'الكمية', numeric: true },
        { key: 'unitPrice', labelEn: 'Unit price', labelAr: 'سعر الوحدة', numeric: true },
        { key: 'lineTotal', labelEn: 'Line total', labelAr: 'الإجمالي', numeric: true },
      ],
      rows: [{ itemCode: 'A1', quantity: '2', unitPrice: '5', lineTotal: '10' }],
      totals: [{ labelEn: 'Total', labelAr: 'الإجمالي', value: '10' }],
    };
    const result = applyPriceVisibility(invoice, { showSalePrice: false });
    expect(result.columns.map((column) => column.key)).toEqual(['itemCode', 'quantity']);
    expect(result.rows[0]).toEqual({ itemCode: 'A1', quantity: '2' });
    expect(result.totals).toHaveLength(0);
  });
});
