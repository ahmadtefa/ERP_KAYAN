import { ForbiddenException } from "@nestjs/common";

import { AuthUser } from "../../common/decorators/current-user.decorator";
import { InventoryPrintController } from "./inventory-print.controller";
import { InventoryReportsService } from "./inventory-reports.service";

const branchId = "11111111-1111-4111-8111-111111111111";
const warehouseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const hiddenWarehouseId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("inventory report print scope", () => {
  const reports = {
    valuation: jest.fn(async () => ({
      rows: [
        {
          itemCode: "A",
          quantity: "3.0000",
          averageCost: "7.0000",
          value: "21.0000",
        },
      ],
      totals: { value: "21.0000" },
    })),
    slowMoving: jest.fn(async () => ({ rows: [], totals: {} })),
    reorder: jest.fn(async () => ({ rows: [], totals: {} })),
    stockTakeVariance: jest.fn(async () => ({ rows: [], totals: {} })),
  };
  const printSettings = {
    resolve: jest.fn(
      async (
        _companyId: string,
        _user: AuthUser,
        query: Record<string, string>,
      ) => ({
        showSalePrice: query.showSalePrice !== "false",
        showPurchasePrice: query.showPurchasePrice !== "false",
        showCost: query.showCost !== "false",
      }),
    ),
  };
  const controller = new InventoryPrintController(
    reports as unknown as InventoryReportsService,
    {} as never,
    {} as never,
    printSettings as never,
    {} as never,
  );
  const restrictedUser: AuthUser = {
    companyId: "company-1",
    userId: "user-1",
    username: "storekeeper",
    branchId,
    branchIds: [branchId],
    isSuperAdmin: false,
    permissions: ["inventory.stock.read", "inventory.cost.read"],
    warehouseAccess: [
      {
        warehouseId,
        canView: true,
        canReceive: false,
        canIssue: false,
        canTransfer: false,
        canCount: false,
        canApprove: false,
        canSeeCost: false,
      },
    ],
  };
  const privateController = controller as unknown as {
    valuationFor: (
      user: AuthUser,
      query: { warehouseId?: string },
    ) => Promise<{
      columns: Array<{ key: string }>;
      rows: Array<Record<string, unknown>>;
      totals: unknown[];
    }>;
  };

  beforeEach(() => jest.clearAllMocks());

  it("filters the print source to assigned warehouses and omits costs when the warehouse grant denies cost", async () => {
    const table = await privateController.valuationFor(restrictedUser, {});
    expect(reports.valuation).toHaveBeenCalledWith(
      "company-1",
      { branchId, categoryId: undefined, warehouseIds: [warehouseId] },
      false,
    );
    expect(printSettings.resolve).toHaveBeenCalledWith(
      "company-1",
      restrictedUser,
      expect.objectContaining({ showCost: "false" }),
      "inventory-valuation",
    );
    expect(table.columns.map((column) => column.key)).not.toContain(
      "averageCost",
    );
    expect(table.rows[0]).toHaveProperty("quantity", "3.0000");
  });

  it("rejects a print request for an unassigned warehouse before reading report data", async () => {
    await expect(
      privateController.valuationFor(restrictedUser, {
        warehouseId: hiddenWarehouseId,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(reports.valuation).not.toHaveBeenCalled();
  });
});
