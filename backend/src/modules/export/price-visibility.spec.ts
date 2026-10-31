import { applyPriceVisibility, resolvePriceVisibility } from './price-visibility';
import { toPrintHtml } from './writers';
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

describe('applyPriceVisibility on the finished output', () => {
  // The screen is not the last word: the printed page and the PDF are built
  // from this table, so the hidden figure must be absent from the HTML itself,
  // not merely from a widget the user is looking at.
  const invoice: ReportTable = {
    slug: 'sales-invoice',
    titleEn: 'Sales invoice',
    titleAr: 'فاتورة بيع',
    meta: [],
    columns: [
      { key: 'itemCode', labelEn: 'Item', labelAr: 'الصنف' },
      { key: 'quantity', labelEn: 'Quantity', labelAr: 'الكمية', numeric: true },
      { key: 'unitPrice', labelEn: 'Unit price', labelAr: 'سعر الوحدة', numeric: true },
      { key: 'purchasePrice', labelEn: 'Cost', labelAr: 'التكلفة', numeric: true },
      { key: 'lineTotal', labelEn: 'Line total', labelAr: 'إجمالي السطر', numeric: true },
    ],
    rows: [
      { itemCode: 'A1', quantity: '2', unitPrice: '150.00', purchasePrice: '90.00', lineTotal: '300.00' },
    ],
    totals: [
      { labelEn: 'Cost', labelAr: 'التكلفة', value: '180.00' },
      { labelEn: 'Total', labelAr: 'الإجمالي', value: '300.00' },
    ],
    notes: [],
  };

  it('leaves no hidden cost in the rendered print page', () => {
    const shown = toPrintHtml(invoice, 'en', 'KAYAN', { generatedAt: new Date('2026-10-27T00:00:00Z') });
    expect(shown).toContain('90.00');
    expect(shown).toContain('180.00');

    const hiddenCost = applyPriceVisibility(invoice, { showCost: false });
    const page = toPrintHtml(hiddenCost, 'en', 'KAYAN', { generatedAt: new Date('2026-10-27T00:00:00Z') });
    expect(page).not.toContain('90.00');
    expect(page).not.toContain('180.00');
    // The selling side is a different figure and is still there.
    expect(page).toContain('150.00');
  });

  it('leaves no hidden sale price in the rendered print page', () => {
    const hiddenSale = applyPriceVisibility(invoice, { showSalePrice: false });
    const page = toPrintHtml(hiddenSale, 'en', 'KAYAN', { generatedAt: new Date('2026-10-27T00:00:00Z') });
    expect(page).not.toContain('150.00');
    expect(page).not.toContain('300.00');
    expect(page).toContain('90.00');
  });

  it('hides both independently: cost off, sale price on', () => {
    const page = toPrintHtml(
      applyPriceVisibility(invoice, { showSalePrice: true, showCost: false }),
      'ar',
      'كيان',
      { generatedAt: new Date('2026-10-27T00:00:00Z') },
    );
    expect(page).not.toContain('90.00');
    expect(page).toContain('150.00');
    // Quantities never disappear: the copy must still add up to the same goods.
    expect(page).toContain('2');
  });
});

describe('resolvePriceVisibility', () => {
  const allowed = { isSuperAdmin: false, permissions: ['inventory.items.read', 'inventory.cost.read'] };
  const clerk = { isSuperAdmin: false, permissions: ['inventory.items.read'] };

  it('honours the request of a caller who may read costs', () => {
    expect(resolvePriceVisibility(allowed, { showSalePrice: 'true', showCost: 'false' })).toEqual({
      showSalePrice: 'true',
      showCost: 'false',
    });
  });

  it('forces costs off for a caller without the cost permission, whatever the link says', () => {
    expect(resolvePriceVisibility(clerk, { showSalePrice: 'true', showCost: 'true' })).toEqual({
      showSalePrice: 'true',
      showCost: false,
    });
  });

  it('never lets a stranger turn costs back on, even when the query omits them', () => {
    const options = resolvePriceVisibility(clerk, {});
    const priced: ReportTable = {
      slug: 'inventory-valuation',
      titleEn: 'Valuation',
      titleAr: 'تقييم المخزون',
      meta: [],
      columns: [
        { key: 'itemCode', labelEn: 'Item', labelAr: 'الصنف' },
        { key: 'averageCost', labelEn: 'Average cost', labelAr: 'متوسط التكلفة', numeric: true },
      ],
      rows: [{ itemCode: 'A1', averageCost: '90.00' }],
      totals: [],
      notes: [],
    };
    expect(JSON.stringify(applyPriceVisibility(priced, options))).not.toContain('90.00');
  });

  it('gives a super admin what they asked for', () => {
    expect(
      resolvePriceVisibility({ isSuperAdmin: true, permissions: [] }, { showCost: 'true' }),
    ).toEqual({ showSalePrice: undefined, showCost: 'true' });
  });
});

describe('applyPriceVisibility on the stock list table', () => {
  const stockTable: ReportTable = {
    slug: 'stock',
    titleEn: 'Stock balances',
    titleAr: 'أرصدة المخزون',
    meta: [],
    columns: [
      { key: 'itemCode', labelEn: 'Item code', labelAr: 'كود الصنف' },
      { key: 'quantity', labelEn: 'Quantity', labelAr: 'الكمية', numeric: true },
      { key: 'averageCost', labelEn: 'Average cost', labelAr: 'متوسط التكلفة', numeric: true },
      // Generic key whose label says only "Value": it is the cost valuation
      // of stock and must leave together with averageCost.
      { key: 'value', labelEn: 'Value', labelAr: 'القيمة', numeric: true },
    ],
    rows: [{ itemCode: 'A1', quantity: '5', averageCost: '10.0000', value: '50.0000' }],
    totals: [],
    notes: [],
  };

  it('removes both the averageCost and the generic value column when cost is hidden', () => {
    const clerk = { isSuperAdmin: false, permissions: ['inventory.stock.read'] };
    const options = resolvePriceVisibility(clerk, { showCost: 'true' });
    const result = applyPriceVisibility(stockTable, options);
    expect(result.columns.map((c) => c.key)).toEqual(['itemCode', 'quantity']);
    expect(JSON.stringify(result)).not.toContain('50.0000');
    expect(JSON.stringify(result)).not.toContain('10.0000');
  });

  it('keeps the value column for a caller allowed to read cost', () => {
    const accountant = {
      isSuperAdmin: false,
      permissions: ['inventory.stock.read', 'inventory.cost.read'],
    };
    const options = resolvePriceVisibility(accountant, { showCost: 'true' });
    const result = applyPriceVisibility(stockTable, options);
    expect(result.columns.map((c) => c.key)).toContain('value');
    expect(JSON.stringify(result)).toContain('50.0000');
  });
});

describe('applyPriceVisibility on a stock movement sheet', () => {
  const ledger: ReportTable = {
    slug: 'stock-ledger',
    titleEn: 'Stock card',
    titleAr: 'بطاقة صنف',
    meta: [],
    columns: [
      { key: 'date', labelEn: 'Date', labelAr: 'التاريخ' },
      { key: 'quantity', labelEn: 'Quantity', labelAr: 'الكمية', numeric: true },
      { key: 'unitCost', labelEn: 'Unit cost', labelAr: 'تكلفة الوحدة', numeric: true },
      { key: 'totalCost', labelEn: 'Cost', labelAr: 'التكلفة', numeric: true },
      { key: 'runningQuantity', labelEn: 'Running quantity', labelAr: 'الرصيد الجاري', numeric: true },
      { key: 'runningValue', labelEn: 'Running value', labelAr: 'القيمة الجارية', numeric: true },
    ],
    rows: [
      {
        date: '2026-01-01',
        quantity: '12.0000',
        unitCost: '10.0000',
        totalCost: '120.0000',
        runningQuantity: '12.0000',
        runningValue: '120.0000',
      },
    ],
    totals: [],
    notes: [],
  };

  it('takes every cost column off the sheet, including the running valuation', () => {
    const result = applyPriceVisibility(ledger, { showCost: 'false' });
    expect(result.columns.map((column) => column.key)).toEqual([
      'date',
      'quantity',
      'runningQuantity',
    ]);
    expect(result.rows[0]).toEqual({
      date: '2026-01-01',
      quantity: '12.0000',
      runningQuantity: '12.0000',
    });
    const html = toPrintHtml(result, 'en', 'KAYAN', { autoPrint: false, logo: null, companyDetails: [] });
    expect(html).not.toContain('10.0000');
    expect(html).not.toContain('120.0000');
  });

  it('keeps the quantities a storekeeper needs, and only those', () => {
    const result = applyPriceVisibility(ledger, { showCost: 'false', showSalePrice: 'false' });
    expect(result.rows[0]).toEqual({
      date: '2026-01-01',
      quantity: '12.0000',
      runningQuantity: '12.0000',
    });
  });
});
