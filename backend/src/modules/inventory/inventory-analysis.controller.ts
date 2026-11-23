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
import { redactPriceFields } from "../../common/auth/price-redaction";
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

/** Cost-named columns that only some inventory reports produce. They are
 * added to the shared cost set, which already covers unitCost, averageCost,
 * valuation and the stock-value family. */
const REPORT_COST_KEYS = [
  "totalCost",
  "value",
  "balanceValue",
  "varianceValue",
  "valueIn",
  "valueOut",
  "netValue",
  "ledgerValue",
  "difference",
  "estimatedOrderCost",
] as const;

/** Purchase-price columns in reports that predate the shared `estimatedOrderCost`
 * cost entry. Kept explicit so a purchase-price denial cannot silently widen. */
const REPORT_PURCHASE_PRICE_KEYS = ["purchasePrice", "estimatedOrderCost"] as const;

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
    // Redaction makes the shape vary by permission, so the public return type
    // stays the service's report type rather than the narrowed redacted one.
    return this.service
      .run(slug, user.companyId, filter, scope)
      .then((report): unknown => {
        // The report figures are named per report, so the report-specific
        // names join the shared redaction sets instead of a second recursive
        // walk living here. One routine decides what leaves the API.
        const safe = redactPriceFields(
          report,
          {
            sale: false,
            purchase: access.canReadPurchasePrice,
            cost: access.canReadCost,
          },
          null,
          {
            costKeys: REPORT_COST_KEYS,
            purchaseKeys: REPORT_PURCHASE_PRICE_KEYS,
          },
        );
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
