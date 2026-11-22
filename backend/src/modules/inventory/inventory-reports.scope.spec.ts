import { BadRequestException, ForbiddenException } from "@nestjs/common";

import { AuthUser } from "../../common/decorators/current-user.decorator";
import { InventoryReportsService } from "./inventory-reports.service";
import { InventoryReportsController } from "./inventory-reports.controller";

const branchA = "11111111-1111-4111-8111-111111111111";
const branchB = "22222222-2222-4222-8222-222222222222";
const warehouseA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function build() {
  const service = {
    valuation: jest.fn().mockResolvedValue({ rows: [] }),
    costCenterMovements: jest.fn().mockResolvedValue({ items: [] }),
    slowMoving: jest.fn().mockResolvedValue({ rows: [] }),
    reorder: jest.fn().mockResolvedValue({ rows: [] }),
  };
  const controller = new InventoryReportsController(
    service as unknown as InventoryReportsService,
    {} as never,
  );
  return { controller, service };
}
function user(
  branchIds: string[],
  branchId: string | null = null,
  warehouseAccess?: AuthUser["warehouseAccess"],
): AuthUser {
  return {
    userId: "user-1",
    username: "reporter",
    companyId: "company-1",
    branchId,
    branchIds,
    isSuperAdmin: false,
    permissions: ["inventory.stock.read"],
    warehouseAccess,
  };
}

describe("legacy inventory reports branch and warehouse scope", () => {
  it("filters a single-branch user to their branch", () => {
    const { controller, service } = build();
    controller.valuation(user([branchA]), {});
    expect(service.valuation).toHaveBeenCalledWith(
      "company-1",
      { branchId: branchA, categoryId: undefined, warehouseIds: undefined },
      false,
    );
  });
  it("rejects an explicitly requested branch outside the user scope", () => {
    const { controller } = build();
    expect(() =>
      controller.reorder(user([branchA]), { branchId: branchB }),
    ).toThrow(ForbiddenException);
  });
  it("passes the selected visible warehouse scope to the legacy report service", () => {
    const { controller, service } = build();
    const restricted = user([branchA], null, [
      {
        warehouseId: warehouseA,
        canView: true,
        canReceive: false,
        canIssue: false,
        canTransfer: false,
        canCount: false,
        canApprove: false,
        canSeeCost: false,
      },
    ]);
    controller.valuation(restricted, {});
    expect(service.valuation).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        branchId: branchA,
        warehouseIds: [warehouseA],
      }),
      false,
    );
  });
  it("uses active branch for multi-branch users and requires a choice if none is active", () => {
    const { controller, service } = build();
    controller.slowMoving(user([branchA, branchB], branchB), {});
    expect(service.slowMoving).toHaveBeenCalledWith(
      "company-1",
      { days: undefined, branchId: branchB, warehouseIds: undefined },
      false,
    );
    expect(() => controller.slowMoving(user([branchA, branchB]), {})).toThrow(
      BadRequestException,
    );
  });
  it("applies branch and warehouse scope to cost-center movement reports", () => {
    const { controller, service } = build();
    controller.costCenterMovements(user([branchA]), {});
    expect(service.costCenterMovements).toHaveBeenCalledWith(
      "company-1",
      { costCenterId: undefined, branchId: branchA, warehouseIds: undefined },
      false,
    );
  });
});
