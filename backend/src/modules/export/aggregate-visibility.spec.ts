import { filterReportAggregates } from './aggregate-visibility';
import type { ReportTable } from './report-table';

const table: ReportTable = {
  slug: 'sales', titleEn: 'Sales', titleAr: 'المبيعات', meta: [],
  columns: [{ key: 'amount', labelEn: 'Amount', labelAr: 'القيمة', numeric: true }],
  rows: [{ amount: '10.00' }],
  totals: [{ labelEn: 'Total', labelAr: 'الإجمالي', value: '10.00' }],
  notes: [],
};

describe('report print/export aggregate visibility', () => {
  it('preserves detail rows but omits footer totals for non-managers', () => {
    const filtered = filterReportAggregates(table, { roles: ['REPORT_USER'] });
    expect(filtered.totals).toEqual([]);
    expect(filtered.rows).toEqual(table.rows);
  });

  it('preserves full totals for finance and company managers', () => {
    expect(filterReportAggregates(table, { roles: ['FINANCE_MANAGER'] })).toBe(table);
    expect(filterReportAggregates(table, { roles: ['GENERAL_MANAGER'] })).toBe(table);
  });
});
