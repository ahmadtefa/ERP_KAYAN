import { ForbiddenException } from "@nestjs/common";

import { AuthUser } from "../../common/decorators/current-user.decorator";
import { InventoryAnalysisController } from "./inventory-analysis.controller";

const whA = "warehouse-a";
const whB = "warehouse-b";
const whC = "warehouse-c";
const branch = "branch-1";
const branchOther = "branch-2";
const grant = (warehouseId: string, canSeeCost = false, canView = true) => ({
  warehouseId,
  canView,
  canReceive: false,
  canIssue: false,
  canTransfer: false,
  canCount: false,
  canApprove: false,
  canSeeCost,
});

describe("inventory report grants", () => {
  const service = {
    catalogue: jest.fn(() => ({
      reports: [
        { slug: "item-movement" },
        { slug: "reconciliation" },
        { slug: "audit-trail" },
      ],
    })),
    run: jest.fn(async () => ({
      slug: "valuation-by-warehouse",
      opening: { quantity: "4.0000", value: "25.0000" },
      rows: [
        {
          warehouseCode: "MAIN",
          quantity: "4.0000",
          unitCost: "6.2500",
          averageCost: "6.2500",
          value: "25.0000",
          purchasePrice: "2.0000",
        },
      ],
      totals: { value: "25.0000" },
    })),
  };
  const controller = new InventoryAnalysisController(service as never);
  const user = (
    warehouseAccess: ReturnType<typeof grant>[] | undefined = [grant(whA)],
    overrides: Partial<AuthUser> = {},
  ): AuthUser => ({
    companyId: "company-1",
    userId: "user-1",
    username: "manager",
    branchId: branch,
    branchIds: [branch],
    isSuperAdmin: false,
    permissions: ["inventory.stock.read"],
    warehouseAccess,
    ...overrides,
  });
  beforeEach(() => jest.clearAllMocks());

  it("allows one warehouse and automatically constrains every report to that grant", async () => {
    await controller.run(user(), "item-movement", {});
    expect(service.run).toHaveBeenCalledWith(
      "item-movement",
      "company-1",
      expect.objectContaining({ warehouseIds: [whA] }),
      [branch],
    );
  });

  it("allows a manager to report across multiple assigned warehouses, but no others", async () => {
    await controller.run(user([grant(whA), grant(whB)]), "item-movement", {});
    expect(service.run).toHaveBeenCalledWith(
      "item-movement",
      "company-1",
      expect.objectContaining({ warehouseIds: [whA, whB] }),
      [branch],
    );
    expect(() =>
      controller.run(user([grant(whA), grant(whB)]), "item-movement", {
        warehouseIds: `${whA},${whC}`,
      }),
    ).toThrow(ForbiddenException);
    expect(service.run).toHaveBeenCalledTimes(1);
  });

  it("supports all warehouses assigned to the user without requiring an arbitrary single selection", async () => {
    await controller.run(
      user([grant(whA), grant(whB), grant(whC)]),
      "balance-by-warehouse",
      {},
    );
    expect(service.run).toHaveBeenCalledWith(
      "balance-by-warehouse",
      "company-1",
      expect.objectContaining({ warehouseIds: [whA, whB, whC] }),
      [branch],
    );
  });

  it("rejects an explicitly selected warehouse outside the grant and never queries the report service", async () => {
    expect(() =>
      controller.run(user(), "item-movement", { warehouseId: whB }),
    ).toThrow(ForbiddenException);
    expect(service.run).not.toHaveBeenCalled();
  });

  it("constrains requested branches and rejects a branch outside the account assignment", async () => {
    await controller.run(user(undefined), "item-movement", {
      branchId: branch,
    });
    expect(service.run).toHaveBeenCalledWith(
      "item-movement",
      "company-1",
      expect.anything(),
      [branch],
    );
    expect(() =>
      controller.run(user(undefined), "item-movement", {
        branchId: branchOther,
      }),
    ).toThrow(ForbiddenException);
  });

  it("redacts costs without hiding quantities and movements", async () => {
    const report = (await controller.run(
      user(),
      "valuation-by-warehouse",
      {},
    )) as {
      rows: Array<Record<string, unknown>>;
      opening: Record<string, unknown>;
      totals: Record<string, unknown>;
    };
    expect(report.rows[0]).toEqual({
      warehouseCode: "MAIN",
      quantity: "4.0000",
    });
    expect(report.opening).toEqual({ quantity: "4.0000" });
    expect(report.totals).toEqual({});
  });

  it("requires both the global cost permission and each selected warehouse cost grant", async () => {
    const withBoth = user([grant(whA, true)], {
      permissions: ["inventory.stock.read", "inventory.cost.read"],
    });
    const report = (await controller.run(
      withBoth,
      "valuation-by-warehouse",
      {},
    )) as {
      rows: Array<Record<string, unknown>>;
      totals: Record<string, unknown>;
    };
    expect(report.rows[0].unitCost).toBe("6.2500");
    expect(report.totals.value).toBe("25.0000");
    const mixed = user([grant(whA, true), grant(whB, false)], {
      permissions: ["inventory.stock.read", "inventory.cost.read"],
    });
    const safe = (await controller.run(
      mixed,
      "valuation-by-warehouse",
      {},
    )) as { rows: Array<Record<string, unknown>> };
    expect(safe.rows[0].value).toBeUndefined();
  });

  it("does not grant quantity reports the separate purchase-price permission", async () => {
    const report = (await controller.run(
      user(undefined),
      "item-movement",
      {},
    )) as { rows: Array<Record<string, unknown>> };
    expect(report.rows[0].purchasePrice).toBeUndefined();
    expect(() =>
      controller.run(
        user(undefined, { permissions: ["inventory.export"] }),
        "item-movement",
        {},
      ),
    ).toThrow(ForbiddenException);
  });

  it("exports the same scoped, cost-redacted payload as the report API", async () => {
    const response = { setHeader: jest.fn(), send: jest.fn() };
    const exportUser = user(undefined, {
      permissions: ["inventory.stock.read", "inventory.export"],
    });
    await controller.exportCsv(
      exportUser,
      "item-movement",
      { warehouseIds: whA },
      response as never,
    );
    expect(service.run).toHaveBeenCalledWith(
      "item-movement",
      "company-1",
      expect.objectContaining({ warehouseIds: [whA] }),
      [branch],
    );
    expect(response.send).toHaveBeenCalledWith(
      expect.not.stringContaining("6.2500"),
    );
  });

  it("hides branch-wide reconciliation and cross-entity audit reports from warehouse-restricted users", async () => {
    expect(controller.catalogue(user()).reports.map((row) => row.slug)).toEqual(
      ["item-movement"],
    );
    expect(() => controller.run(user(), "reconciliation", {})).toThrow(
      ForbiddenException,
    );
    expect(() => controller.run(user(), "audit-trail", {})).toThrow(
      ForbiddenException,
    );
  });
});
