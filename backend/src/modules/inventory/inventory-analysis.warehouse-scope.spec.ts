import { InventoryAnalysisService } from "./inventory-analysis.service";

const companyId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const warehouses = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
];

describe("inventory analysis warehouse query scope", () => {
  const prisma = {
    stockMovement: { findMany: jest.fn(async () => []) },
    warehouseStockBalance: { findMany: jest.fn(async () => []) },
    stockDocument: { findMany: jest.fn(async () => []) },
    $queryRaw: jest.fn(async () => []),
  };
  const service = new InventoryAnalysisService(prisma as never);
  beforeEach(() => jest.clearAllMocks());

  it("uses the exact allowed warehouses and branch scope for movement rows and opening totals", async () => {
    await service.run(
      "item-card",
      companyId,
      {
        itemId: "33333333-3333-4333-8333-333333333333",
        warehouseIds: warehouses,
      },
      [branchId],
    );
    expect(prisma.stockMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          warehouseId: { in: warehouses },
          branchId: { in: [branchId] },
        }),
      }),
    );
    const rawQuery = prisma.$queryRaw as unknown as {
      mock: { calls: unknown[][] };
    };
    const sql = rawQuery.mock.calls[0]?.[0] as {
      strings: string[];
      values: unknown[];
    };
    expect(sql.strings.join("?")).toContain("ANY");
    expect(sql.values).toEqual(
      expect.arrayContaining([warehouses, [branchId]]),
    );
  });

  it("uses the selected warehouses for branch balance aggregation", async () => {
    await service.run(
      "balance-by-branch",
      companyId,
      { warehouseIds: warehouses },
      [branchId],
    );
    expect(prisma.warehouseStockBalance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          warehouseId: { in: warehouses },
          branchId: { in: [branchId] },
        }),
      }),
    );
  });

  it("requires both ends of a transfer to be within the visible warehouse set", async () => {
    await service.run("transfers", companyId, { warehouseIds: warehouses }, [
      branchId,
    ]);
    expect(prisma.stockDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          fromWarehouseId: { in: warehouses },
          toWarehouseId: { in: warehouses },
          branchId: { in: [branchId] },
        }),
      }),
    );
  });

  it("limits a write-off and count report to its controlled physical warehouse", async () => {
    await service.run(
      "write-offs",
      companyId,
      { warehouseIds: [warehouses[0]] },
      [branchId],
    );
    expect(prisma.stockDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          fromWarehouseId: { in: [warehouses[0]] },
        }),
      }),
    );
    await service.run(
      "count-variances",
      companyId,
      { warehouseIds: [warehouses[1]] },
      [branchId],
    );
    expect(prisma.stockDocument.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          toWarehouseId: { in: [warehouses[1]] },
        }),
      }),
    );
  });
});
