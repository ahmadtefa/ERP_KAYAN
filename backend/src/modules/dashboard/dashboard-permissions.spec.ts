import { effectiveBranches } from './dashboard.service';
import {
  DASHBOARD_SECTIONS,
  dashboardSectionsFor,
  filterDashboardMonthlyPayload,
  filterDashboardSummaryPayload,
} from './dashboard-permissions';

describe('dashboard section permissions', () => {
  it('grants just the independently-authorized sections and maps the legacy financial grant narrowly', () => {
expect([...dashboardSectionsFor({ permissions: ['dashboard.sales'] })]).toEqual([]);
    expect([...dashboardSectionsFor({ permissions: ['dashboard.sales', 'sales.price.read'] })]).toEqual(['sales']);
    expect([...dashboardSectionsFor({ permissions: ['dashboard.purchases', 'purchases.price.read'] })]).toEqual(['purchases']);
    expect([...dashboardSectionsFor({ permissions: ['dashboard.financial'] })].sort()).toEqual([
      'cash', 'movements',
    ]);
    expect([...dashboardSectionsFor({ permissions: ['dashboard.financial', 'sales.price.read', 'purchases.price.read'] })].sort()).toEqual([
      'cash', 'movements', 'profit', 'revenue',
    ]);
  });

  it('allows a Super Admin every section, while retaining the supplied companyId for service queries', () => {
    expect([...dashboardSectionsFor({ isSuperAdmin: true })].sort()).toEqual(
      [...DASHBOARD_SECTIONS].sort(),
    );
    expect(effectiveBranches({
      companyId: 'company-a', isSuperAdmin: true, branchIds: ['branch-a'],
    }, 'branch-b')).toEqual(['branch-b']);
  });

  it('confines a normal user to assigned branches and ignores a requested branch outside that scope', () => {
    const user = { companyId: 'company-a', branchId: 'branch-a', branchIds: ['branch-a', 'branch-b'] };
    expect(effectiveBranches(user)).toEqual(['branch-a', 'branch-b']);
    expect(effectiveBranches(user, 'branch-b')).toEqual(['branch-b']);
    expect(effectiveBranches(user, 'branch-outside')).toEqual(['branch-a', 'branch-b']);
  });

  it('omits unauthorized KPI values and derived totals instead of returning zeroes', () => {
    const safe = filterDashboardSummaryPayload({
      sales: { total: '98.00' },
      purchases: { total: '43.00' },
      revenue: '31.00',
      expenses: '17.00',
      grossResult: '14.00',
      receipts: { total: '9.00' },
      payments: { total: '3.00' },
      cashPosition: '88.00',
      receivables: '7.00',
      payables: '6.00',
      stock: { value: '55.00' },
      topCustomers: [{ total: '98.00' }],
      recentDocuments: [{ amount: '98.00' }],
      hasData: true,
      documentsInPeriod: 4,
      previousPeriod: { revenue: '22', expenses: '11', result: '11', revenueChange: '5' },
      drillDown: {
        trialBalance: '/reports/trial-balance',
        receivablesAging: '/reports/receivables-aging',
        cashAccounts: '/cash/accounts/balances',
      },
    }, new Set(['sales'] as const));

    expect(safe).toMatchObject({ sales: { total: '98.00' }, hasData: true, documentsInPeriod: 4 });
    for (const key of [
      'purchases', 'revenue', 'expenses', 'grossResult', 'receipts', 'payments',
      'cashPosition', 'receivables', 'payables', 'stock', 'topCustomers', 'recentDocuments',
    ]) expect(safe).not.toHaveProperty(key);
    expect(safe.previousPeriod).toBeUndefined();
    expect(safe.drillDown).toBeUndefined();
  });

  it('removes amounts from recent documents unless their financial section is also allowed', () => {
    const safe = filterDashboardSummaryPayload({
      recentDocuments: [
        { kind: 'SALES_INVOICE', amount: '100', number: 'S-1' },
        { kind: 'PURCHASE_INVOICE', amount: '70', number: 'P-1' },
        { kind: 'CASH_RECEIPT', amount: '10', number: 'R-1' },
      ],
    }, new Set(['recent', 'sales'] as const));
    expect(safe.recentDocuments).toEqual([
      { kind: 'SALES_INVOICE', amount: '100', number: 'S-1' },
      { kind: 'PURCHASE_INVOICE', number: 'P-1' },
      { kind: 'CASH_RECEIPT', number: 'R-1' },
    ]);
  });

  it('requires the existing inventory cost permission before granting the stock-value KPI', () => {
    expect([...dashboardSectionsFor({ permissions: ['dashboard.stock'] })]).toEqual([]);
    expect([...dashboardSectionsFor({ permissions: ['dashboard.stock', 'inventory.cost.read'] })]).toEqual(['stock']);
    expect([...dashboardSectionsFor({ permissions: ['dashboard.stock', 'purchases.price.read'] })]).toEqual(['stock']);
  });

  it('strips monthly series and sales-derived counts independently', () => {
    const safe = filterDashboardMonthlyPayload({
      from: '2026-01-01',
      months: [{
        month: '2026-01', sales: '10', salesCount: 3, purchases: '20',
        receipts: '2', payments: '1', revenue: '7', expenses: '4', result: '3',
      }],
    }, new Set(['charts', 'sales'] as const));
    expect(safe.months).toEqual([{ month: '2026-01', sales: '10', salesCount: 3 }]);
  });
});
