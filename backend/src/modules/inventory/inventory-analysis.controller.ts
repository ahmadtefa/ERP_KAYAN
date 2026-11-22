import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";

import { AllowQueryToken } from "../../common/decorators/allow-query-token.decorator";
import {
  AuthUser,
  CurrentUser,
} from "../../common/decorators/current-user.decorator";
import { warehouseScopeOf } from "../../common/warehouse/warehouse.service";
import {
  mayReadCompanyAggregates,
  redactCompanyAggregates,
} from "../../common/auth/company-aggregate-visibility";
import {
  InventoryAnalysisService,
  ReportFilter,
} from "./inventory-analysis.service";
import {
  assertWarehouseReportSupported,
  resolveInventoryReportAccess,
  type InventoryReportQuery,
} from "./inventory-report-access";

@Controller("inventory/reports")
export class InventoryAnalysisController {
  constructor(private readonly service: InventoryAnalysisService) {}

  @Get()
  catalogue(@CurrentUser() user: AuthUser) {
    const access = resolveInventoryReportAccess(user, {});
    const result = this.service.catalogue();
    return {
      ...result,
      reports: result.reports.filter((report) => {
        if (!this.hasReportPermission(user, report.slug)) return false;
        try {
          assertWarehouseReportSupported(report.slug, access);
          return true;
        } catch {
          return false;
        }
      }),
    };
  }

  @Get(":slug/export")
  @AllowQueryToken()
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Param("slug") slug: string,
    @Query() query: InventoryReportQuery,
    @Res() response: Response,
  ) {
    this.assertReportPermission(user, slug);
    if (!user.isSuperAdmin && !user.permissions.includes('inventory.export')) {
      throw new ForbiddenException('Missing permission: inventory.export');
    }
    const report = await this.run(user, slug, query);
    const rows =
      (report as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    const header = rows.length > 0 ? Object.keys(rows[0]) : [];
    const escape = (value: unknown) => {
      if (value === null || value === undefined) return "";
      const text =
        value instanceof Date
          ? value.toISOString().slice(0, 10)
          : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = [
      header.join(","),
      ...rows.map((row) => header.map((key) => escape(row[key])).join(",")),
    ].join("\r\n");
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="kayan-${slug}-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    response.send(`\ufeff${csv}`);
    return undefined;
  }

  @Get(":slug")
  run(
    @CurrentUser() user: AuthUser,
    @Param("slug") slug: string,
    @Query() query: InventoryReportQuery,
  ) {
    this.assertReportPermission(user, slug);
    const access = resolveInventoryReportAccess(user, query);
    assertWarehouseReportSupported(slug, access);
    const filter: ReportFilter = {
      from: query.from as string | undefined,
      to: query.to as string | undefined,
      warehouseId:
        access.warehouseIds?.length === 1 ? access.warehouseIds[0] : undefined,
      warehouseIds: access.warehouseIds,
      branchId: access.branchId,
      itemId: query.itemId as string | undefined,
      categoryId: query.categoryId as string | undefined,
      days: query.days ? Number(query.days as string) : undefined,
      limit: query.limit ? Number(query.limit as string) : undefined,
    };
    if (query.warehouseId && access.warehouseIds?.length === 0) {
      throw new ForbiddenException(
        "This report is outside your assigned warehouses.",
      );
    }

    const scope = access.branchId ? [access.branchId] : warehouseScopeOf(user);
    return this.service
      .run(slug, user.companyId, filter, scope)
      .then((report) => {
        const hide = (value: unknown, remove: Set<string>): unknown => {
          if (Array.isArray(value))
            return value.map((child) => hide(child, remove));
          if (!value || typeof value !== "object") return value;
          return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .filter(([key]) => !remove.has(key))
              .map(([key, child]) => [key, hide(child, remove)]),
          );
        };
        const hideCosts = new Set([
          "unitCost",
          "totalCost",
          "averageCost",
          "value",
          "balanceValue",
          "varianceValue",
          "valueIn",
          "valueOut",
          "netValue",
          "stockValue",
          "ledgerValue",
          "difference",
          "varianceValue",
          "estimatedOrderCost",
        ]);
        const hidePurchasePrices = new Set([
          "purchasePrice",
          "estimatedOrderCost",
        ]);
        let safe: unknown = report;
        if (!access.canReadCost) safe = hide(safe, hideCosts);
        if (!access.canReadPurchasePrice) safe = hide(safe, hidePurchasePrices);
        return mayReadCompanyAggregates(user)
          ? safe
          : redactCompanyAggregates(safe);
      });
  }

  private hasReportPermission(user: AuthUser, slug: string): boolean {
    return user.isSuperAdmin || user.permissions.includes(`inventory.reports.${slug}.read`);
  }

  private assertReportPermission(user: AuthUser, slug: string): void {
    if (!this.hasReportPermission(user, slug)) {
      throw new ForbiddenException(`Missing permission: inventory.reports.${slug}.read`);
    }
  }
}
