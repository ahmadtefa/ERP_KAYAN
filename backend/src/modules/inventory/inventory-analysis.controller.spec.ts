import { ForbiddenException } from '@nestjs/common';

import { AuthUser } from '../../common/decorators/current-user.decorator';
import { InventoryAnalysisController } from './inventory-analysis.controller';

describe('inventory report warehouse and cost access', () => {
  const service = {
    catalogue: jest.fn(),
    run: jest.fn(async () => ({
      slug: 'valuation-by-warehouse',
      opening: { quantity: '4.0000', value: '25.0000' },
      rows: [
        {
          warehouseCode: 'MAIN',
          quantity: '4.0000',
          unitCost: '6.2500',
          averageCost: '6.2500',
          value: '25.0000',
        },
      ],
      totals: { value: '25.0000' },
    })),
  };
  const controller = new InventoryAnalysisController(service as never);

  const user = (overrides: Record<string, unknown> = {}): AuthUser =>
    ({
      companyId: 'company-1',
      userId: 'user-1',
      branchId: 'branch-1',
      branchIds: ['branch-1'],
      isSuperAdmin: false,
      permissions: ['inventory.stock.read'],
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
      ...overrides,
    }) as AuthUser;

  beforeEach(() => jest.clearAllMocks());

  it('requires a warehouse filter when warehouse grants restrict the caller', async () => {
    await expect(
      controller.run(user(), 'valuation-by-warehouse', {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.run).not.toHaveBeenCalled();
  });

  it('rejects a report for a warehouse the caller cannot see', async () => {
    await expect(
      controller.run(user(), 'valuation-by-warehouse', { warehouseId: 'warehouse-hidden' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.run).not.toHaveBeenCalled();
  });

  it('redacts all cost fields recursively even when the report contains totals', async () => {
    const result = await controller.run(
      user(),
      'valuation-by-warehouse',
      { warehouseId: 'warehouse-a' },
    ) as any;

    expect(result.opening).toEqual({ quantity: '4.0000' });
    expect(result.rows[0]).toEqual({ warehouseCode: 'MAIN', quantity: '4.0000' });
    expect(result.totals).toEqual({});
  });

  it('returns costs only when both global and warehouse cost permissions allow them', async () => {
    const result = await controller.run(
      user({
        permissions: ['inventory.stock.read', 'inventory.cost.read'],
        warehouseAccess: [
          {
            warehouseId: 'warehouse-a',
            canView: true,
            canReceive: false,
            canIssue: false,
            canTransfer: false,
            canCount: false,
            canApprove: false,
            canSeeCost: true,
          },
        ],
      }),
      'valuation-by-warehouse',
      { warehouseId: 'warehouse-a' },
    ) as any;

    expect(result.rows[0].unitCost).toBe('6.2500');
    expect(result.totals.value).toBe('25.0000');
  });
});
