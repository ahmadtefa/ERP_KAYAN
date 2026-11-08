import { Controller, ForbiddenException, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import { AllowQueryToken } from '../../common/decorators/allow-query-token.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { canReadCost } from '../../common/auth/cost-visibility';
import { assertWarehouseAccess, grantsOf } from '../../common/warehouse/warehouse-access';
import { warehouseScopeOf } from '../../common/warehouse/warehouse.service';
import { InventoryAnalysisService, ReportFilter } from './inventory-analysis.service';

/// The analytical reports: the item card, the movement, the valuation per
/// shelf, the idle stock, the lots and their money, write-offs, transfers,
/// count variances, and the reconciliation against the ledger.
///
/// One endpoint per report, all through the same filters, and one CSV export
/// that renders whatever the JSON endpoint would have returned - so a new
/// report is never a new export format to get wrong.
@Controller('inventory/reports')
export class InventoryAnalysisController {
  constructor(private readonly service: InventoryAnalysisService) {}

  @Get()
  @RequirePermissions('inventory.stock.read')
  catalogue() {
    return this.service.catalogue();
  }

  @Get(':slug/export')
  @AllowQueryToken()
  @RequirePermissions('inventory.export')
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Query() query: Record<string, string>,
    @Res() response: Response,
  ) {
    const report = await this.run(user, slug, query);
    const rows = (report as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    const header = rows.length > 0 ? Object.keys(rows[0]) : [];
    const escape = (value: unknown) => {
      if (value === null || value === undefined) return '';
      const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = [header.join(','), ...rows.map((row) => header.map((key) => escape(row[key])).join(','))]
      .join('\r\n');
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="kayan-${slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    // A byte-order mark so Excel opens Arabic headings as Arabic.
    response.send(`\ufeff${csv}`);
    return undefined;
  }

  @Get(':slug')
  @RequirePermissions('inventory.stock.read')
  run(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Query() query: Record<string, string>,
  ) {
    const grant = grantsOf(user);
    if (grant !== null) {
      if (!query.warehouseId) {
        throw new ForbiddenException(
          'Select a warehouse you are allowed to view before opening this report. / اختر مستودعًا مسموحًا لعرض التقرير.',
        );
      }
      assertWarehouseAccess(user, query.warehouseId, 'view');
    } else if (query.warehouseId) {
      assertWarehouseAccess(user, query.warehouseId, 'view');
    }
    const warehouseGrant = query.warehouseId
      ? grant?.find((row) => row.warehouseId === query.warehouseId)
      : undefined;
    const mayReadReportCost = canReadCost(user) && (warehouseGrant === undefined || warehouseGrant.canSeeCost);
    const filter: ReportFilter = {
      from: query.from,
      to: query.to,
      warehouseId: query.warehouseId,
      branchId: query.branchId,
      itemId: query.itemId,
      categoryId: query.categoryId,
      days: query.days ? Number(query.days) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    };
    return this.service.run(slug, user.companyId, filter, warehouseScopeOf(user)).then((report) => {
      if (mayReadReportCost) return report;
      const costFields = new Set([
        'unitCost',
        'totalCost',
        'averageCost',
        'value',
        'balanceValue',
        'varianceValue',
      ]);
      const hideCosts = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(hideCosts);
        if (value === null || typeof value !== 'object') return value;
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .filter(([key]) => !costFields.has(key))
            .map(([key, child]) => [key, hideCosts(child)]),
        );
      };
      return hideCosts(report);
    });
  }
}
