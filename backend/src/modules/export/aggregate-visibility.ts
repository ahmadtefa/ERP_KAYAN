import { mayReadCompanyAggregates, type AggregateVisibilityPrincipal } from '../../common/auth/company-aggregate-visibility';
import type { ReportTable } from './report-table';

/** Keep report footer totals out of print, PDF, CSV and workbook output for ordinary roles. */
export function filterReportAggregates<T extends ReportTable>(
  table: T,
  user: AggregateVisibilityPrincipal,
): T {
  if (mayReadCompanyAggregates(user)) return table;
  return { ...table, totals: [] };
}
