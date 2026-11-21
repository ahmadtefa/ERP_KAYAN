import { of, lastValueFrom } from 'rxjs';
import {
  CompanyAggregateVisibilityInterceptor,
  mayReadCompanyAggregates,
  redactCompanyAggregates,
} from './company-aggregate-visibility';

describe('company aggregate visibility', () => {
  it('only grants company-wide aggregates to managers and super-admins', () => {
    expect(mayReadCompanyAggregates({ roles: ['SALES_MANAGER'] })).toBe(false);
    expect(mayReadCompanyAggregates({ roles: ['ACCOUNTANT'] })).toBe(false);
    expect(mayReadCompanyAggregates({ roles: ['finance_manager'] })).toBe(true);
    expect(mayReadCompanyAggregates({ roles: ['GENERAL_MANAGER'] })).toBe(true);
    expect(mayReadCompanyAggregates({ isSuperAdmin: true })).toBe(true);
  });

  it('removes aggregate totals and statistics recursively, preserving permitted detail rows', () => {
    expect(redactCompanyAggregates({
      totals: { revenue: '100' },
      total: 3,
      rows: [{ account: 'A', debit: '50', totalAmount: '50', totals: { debit: '50' } }],
      drillDown: { summary: { balance: '50' }, accountId: 'A' },
    })).toEqual({
      rows: [{ account: 'A', debit: '50', totalAmount: '50' }],
      drillDown: { accountId: 'A' },
    });
  });

  it('applies API redaction at the response boundary but preserves manager responses', async () => {
    const interceptor = new CompanyAggregateVisibilityInterceptor();
    const response = { totals: { net: '10' }, rows: [{ id: 'row-1' }] };
    const next = { handle: () => of(response) };
    const context = (roles: string[]) => ({
      switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
    });
    await expect(lastValueFrom(interceptor.intercept(context(['SALES_MANAGER']) as never, next)))
      .resolves.toEqual({ rows: [{ id: 'row-1' }] });
    await expect(lastValueFrom(interceptor.intercept(context(['FINANCE_MANAGER']) as never, next)))
      .resolves.toBe(response);
  });
});
