import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { dashboardSectionsFor, filterDashboardMonthlyPayload, filterDashboardSummaryPayload } from './dashboard-permissions';

// Real HTTP/controller/serialization boundary with fixture principals and data.
// Authentication and database calculation are not the scope of this test.
describe('dashboard statistics audience over HTTP', () => {
  let app: INestApplication;
  let base: string;
  const permissions = ['dashboard.view', 'dashboard.sales', 'dashboard.charts', 'dashboard.recent', 'sales.price.read'];
  beforeAll(async () => {
    @Module({ controllers: [DashboardController], providers: [{ provide: DashboardService, useValue: {
      summary: (user: any) => filterDashboardSummaryPayload({
        sales: { total: '123.4500' },
        recentDocuments: [{ kind: 'SALES_INVOICE', number: 'S-DEMO-1', amount: '123.4500' }],
      }, dashboardSectionsFor(user)),
      monthly: (user: any) => filterDashboardMonthlyPayload({ months: [{ month: '2026-11', sales: '123.4500', salesCount: 1 }] }, dashboardSectionsFor(user)),
    } }] }) class FixtureModule {}
    app = await NestFactory.create(FixtureModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.use((req: any, _res: any, next: () => void) => {
      // Test-only principal injection, never used in runtime authentication.
      req.user = { companyId: 'fixture', roles: [String(req.headers['x-fixture-role'])], permissions,
        isSuperAdmin: req.headers['x-fixture-super'] === 'true' };
      next();
    });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => app?.close());
  it.each(['ADMIN', 'FINANCE_MANAGER', 'GENERAL_MANAGER', 'ACCOUNTANT', 'SALES_MANAGER', 'UNKNOWN'])(
    'enforces the audience for %s at both dashboard endpoints', async (role) => {
      const headers = { 'x-fixture-role': role, 'x-fixture-super': 'true' };
      const summary = await fetch(`${base}/api/v1/dashboard/summary`, { headers });
      expect(summary.status).toBe(200);
      const data: any = await summary.json();
      const monthly: any = await (await fetch(`${base}/api/v1/dashboard/monthly`, { headers })).json();
      if (['ADMIN', 'FINANCE_MANAGER'].includes(role)) {
        expect(data.sales).toEqual({ total: '123.4500' });
        expect(monthly.months[0].sales).toBe('123.4500');
      } else {
        expect(data).not.toHaveProperty('sales');
        expect(data).not.toHaveProperty('totals');
        expect(data.recentDocuments).toEqual([{ kind: 'SALES_INVOICE', number: 'S-DEMO-1' }]);
        expect(monthly.months).toEqual([]);
      }
    },
  );
});
