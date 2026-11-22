import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { AuthUser } from '../../common/decorators/current-user.decorator';
import { InventoryReportsService } from './inventory-reports.service';
import { InventoryReportsController } from './inventory-reports.controller';

const branchA = '11111111-1111-4111-8111-111111111111';
const branchB = '22222222-2222-4222-8222-222222222222';

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

function user(branchIds: string[], branchId: string | null = null): AuthUser {
  return {
    userId: 'user-1',
    username: 'reporter',
    companyId: 'company-1',
    branchId,
    branchIds,
    isSuperAdmin: false,
    permissions: ['inventory.stock.read'],
  };
}

describe('legacy inventory reports branch scope', () => {
  it('automatically filters a single-branch user to their assigned branch', () => {
    const { controller, service } = build();

    controller.valuation(user([branchA]), undefined, undefined);

    expect(service.valuation).toHaveBeenCalledWith(
      'company-1',
      { branchId: branchA, categoryId: undefined },
      false,
    );
  });

  it('rejects an explicitly requested branch outside the user scope', () => {
    const { controller } = build();

    expect(() => controller.reorder(user([branchA]), branchB)).toThrow(
      ForbiddenException,
    );
  });

  it('does not expose branch-level legacy reports to warehouse-restricted users', () => {
    const { controller, service } = build();
    const restricted = {
      ...user([branchA]),
      warehouseAccess: [
        {
          warehouseId: 'warehouse-a',
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

    expect(() => controller.valuation(restricted, branchA)).toThrow(
      ForbiddenException,
    );
    expect(service.valuation).not.toHaveBeenCalled();
  });

  it('uses the active branch for a multi-branch user unless another allowed branch is requested', () => {
    const { controller, service } = build();

    controller.slowMoving(user([branchA, branchB], branchB));

    expect(service.slowMoving).toHaveBeenCalledWith(
      'company-1',
      { days: undefined, branchId: branchB },
      false,
    );
  });

  it('requires a branch choice when several branches are assigned but none is active', () => {
    const { controller } = build();

    expect(() => controller.slowMoving(user([branchA, branchB]))).toThrow(
      BadRequestException,
    );
  });

  it('applies branch scope to cost-center movement reports', () => {
    const { controller, service } = build();

    controller.costCenterMovements(user([branchA]), undefined);

    expect(service.costCenterMovements).toHaveBeenCalledWith(
      'company-1',
      { costCenterId: undefined, branchId: branchA },
      false,
    );
  });
});
