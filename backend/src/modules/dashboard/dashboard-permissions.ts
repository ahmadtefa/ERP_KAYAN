/**
 * Which dashboard sections a caller may see.
 *
 * The dashboard is the most sensitive screen in the program: it puts profit,
 * cash, debts and stock value on the first screen. One permission per
 * section lets an administrator decide, for each role, which of those a
 * person sees — and the API returns only those sections, so hiding a card in
 * the client is never the only thing standing between a clerk and the profit.
 *
 * `dashboard.financial` is the broad grant that predates the sections: a
 * caller who holds it is treated as holding the financial sections
 * (revenue, profit, cash, movements). It does not grant charts, top lists or
 * recent documents, which stay independently controlled.
 */

import { mayReadCompanyAggregates } from '../../common/auth/company-aggregate-visibility';

export const DASHBOARD_SECTIONS = [
  'sales',
  'purchases',
  'revenue',
  'profit',
  'cash',
  'movements',
  'receivables',
  'payables',
  'stock',
  'charts',
  'top',
  'recent',
] as const;

export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];

export const DASHBOARD_SECTION_PERMISSION: Record<DashboardSection, string> = {
  sales: 'dashboard.sales',
  purchases: 'dashboard.purchases',
  revenue: 'dashboard.revenue',
  profit: 'dashboard.profit',
  cash: 'dashboard.cash',
  movements: 'dashboard.movements',
  receivables: 'dashboard.receivables',
  payables: 'dashboard.payables',
  stock: 'dashboard.stock',
  charts: 'dashboard.charts',
  top: 'dashboard.top',
  recent: 'dashboard.recent',
};

/** Sections covered by the broad `dashboard.financial` grant. */
const FINANCIAL_SECTIONS: ReadonlySet<DashboardSection> = new Set([
  'revenue',
  'profit',
  'cash',
  'movements',
]);

export interface DashboardPrincipal {
  isSuperAdmin?: boolean;
  permissions?: string[] | null;
  roles?: string[] | null;
}

/** The sections this caller may see, as a set of section names. */
export function dashboardSectionsFor(
  user: DashboardPrincipal,
): Set<DashboardSection> {
  const granted = new Set(user.permissions ?? []);
  const allowed = new Set<DashboardSection>();
  if (user.isSuperAdmin) {
    for (const section of DASHBOARD_SECTIONS) allowed.add(section);
    return allowed;
  }
  if (!mayReadCompanyAggregates(user)) {
    // The recent-document list is not an aggregate; its individual amounts
    // are independently stripped below according to document permissions.
    if (granted.has('dashboard.recent')) allowed.add('recent');
    return allowed;
  }
  const financial = granted.has('dashboard.financial');
  for (const section of DASHBOARD_SECTIONS) {
    if (granted.has(DASHBOARD_SECTION_PERMISSION[section])) {
      // Price-bearing dashboard values inherit the same permission floor as the
      // documents they summarize; dashboard visibility alone cannot reveal them.
      const maySeePriceBearingSection =
        (section !== 'sales' && section !== 'top' || granted.has('sales.price.read')) &&
        (section !== 'purchases' && section !== 'payables' || granted.has('purchases.price.read') || granted.has('inventory.cost.read')) &&
        (section !== 'stock' || granted.has('purchases.price.read') || granted.has('inventory.cost.read')) &&
        (section !== 'receivables' || granted.has('sales.price.read')) &&
        (section !== 'revenue' && section !== 'profit' ||
          (granted.has('sales.price.read') && (granted.has('purchases.price.read') || granted.has('inventory.cost.read'))));
      if (maySeePriceBearingSection) allowed.add(section);
    } else if (financial && FINANCIAL_SECTIONS.has(section)) {
      const maySeePriceAggregates = section !== 'revenue' && section !== 'profit' ||
        (granted.has('sales.price.read') &&
          (granted.has('purchases.price.read') || granted.has('inventory.cost.read')));
      if (maySeePriceAggregates) allowed.add(section);
    }
  }
  return allowed;
}

export function maySeeDashboardSection(
  user: DashboardPrincipal,
  section: DashboardSection,
): boolean {
  return dashboardSectionsFor(user).has(section);
}

/**
 * A final allow-list at the serialization boundary. The service also avoids
 * constructing unauthorized response fields, but this second check makes a
 * future KPI addition fail closed instead of silently becoming public.
 */
export function filterDashboardSummaryPayload(
  source: Record<string, unknown>,
  allowed: ReadonlySet<DashboardSection>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...source,
    allowedSections: [...allowed].sort(),
  };
  const fields: Record<DashboardSection, string[]> = {
    sales: ['sales'],
    purchases: ['purchases'],
    revenue: ['revenue', 'expenses'],
    profit: ['grossResult'],
    cash: ['cashPosition', 'cashAccounts'],
    movements: ['receipts', 'payments'],
    receivables: ['receivables', 'overdue', 'outstanding'],
    payables: ['payables'],
    stock: ['stock'],
    charts: [],
    top: ['topCustomers', 'topItems'],
    recent: ['recentDocuments'],
  };
  for (const section of DASHBOARD_SECTIONS) {
    if (allowed.has(section)) continue;
    for (const field of fields[section]) delete payload[field];
  }

  // The period's "has data" hint and count are derived from invoices. They
  // are returned only if the caller can see at least one invoice total.
  if (!allowed.has('sales') && !allowed.has('purchases')) {
    delete payload.hasData;
    delete payload.documentsInPeriod;
  }

  // Recent activity is its own permission, but an invoice amount inside an
  // activity row still belongs to the corresponding financial section.
  if (allowed.has('recent') && Array.isArray(payload.recentDocuments)) {
    payload.recentDocuments = payload.recentDocuments.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const row = { ...(item as Record<string, unknown>) };
      const kind = String(row.kind ?? '').toUpperCase();
      const maySeeAmount = kind.includes('SALES')
        ? allowed.has('sales')
        : kind.includes('PURCHASE')
          ? allowed.has('purchases')
          : kind.includes('CASH')
            ? allowed.has('movements')
            : false;
      if (!maySeeAmount) delete row.amount;
      return row;
    });
  }

  const previous = payload.previousPeriod;
  if (previous && typeof previous === 'object') {
    const safePrevious = { ...(previous as Record<string, unknown>) };
    if (!allowed.has('revenue')) {
      delete safePrevious.revenue;
      delete safePrevious.expenses;
      delete safePrevious.revenueChange;
    }
    if (!allowed.has('profit')) delete safePrevious.result;
    if (!allowed.has('revenue') && !allowed.has('profit')) delete payload.previousPeriod;
    else payload.previousPeriod = safePrevious;
  }

  const drillDown = payload.drillDown;
  if (drillDown && typeof drillDown === 'object') {
    const safe = { ...(drillDown as Record<string, unknown>) };
    const group = ['trialBalance', 'profitAndLoss', 'balanceSheet', 'cashFlow'];
    if (!allowed.has('revenue') && !allowed.has('profit')) {
      for (const key of group) delete safe[key];
    }
    if (!allowed.has('receivables')) delete safe.receivablesAging;
    if (!allowed.has('payables')) delete safe.payablesAging;
    if (!allowed.has('cash')) delete safe.cashAccounts;
    if (!allowed.has('stock')) delete safe.stockValuation;
    if (Object.keys(safe).length === 0) delete payload.drillDown;
    else payload.drillDown = safe;
  }
  return payload;
}

/** Strip any monthly series that is not independently granted. */
export function filterDashboardMonthlyPayload(
  source: { from?: string; months?: Array<Record<string, unknown>> },
  allowed: ReadonlySet<DashboardSection>,
): { from?: string; months: Array<Record<string, unknown>>; allowedSections: string[] } {
  const months = allowed.has('charts') ? (source.months ?? []).map((sourceRow) => {
    const row = { ...sourceRow };
    if (!allowed.has('sales')) {
      delete row.sales;
      delete row.salesCount;
    }
    if (!allowed.has('purchases')) {
      delete row.purchases;
      delete row.purchasesCount;
    }
    if (!allowed.has('movements')) {
      delete row.receipts;
      delete row.payments;
    }
    if (!allowed.has('revenue')) {
      delete row.revenue;
      delete row.expenses;
    }
    if (!allowed.has('profit')) delete row.result;
    return row;
  }) : [];
  return {
    ...(source.from ? { from: source.from } : {}),
    months,
    allowedSections: [...allowed].sort(),
  };
}
