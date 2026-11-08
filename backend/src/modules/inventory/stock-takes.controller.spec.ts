import { ForbiddenException } from '@nestjs/common';

import { AuthUser } from '../../common/decorators/current-user.decorator';
import { StockTakesController } from './stock-takes.controller';

describe('stock take warehouse access', () => {
  const session = { id: 'take-1', warehouseId: 'warehouse-a' };
  const service = {
    list: jest.fn(),
    findOne: jest.fn(async () => session),
    start: jest.fn(),
    record: jest.fn(),
    approve: jest.fn(),
    post: jest.fn(),
    cancel: jest.fn(),
  };
  const controller = new StockTakesController(service as never);

  const user = (grant: Partial<{
    canView: boolean;
    canCount: boolean;
    canApprove: boolean;
  }>): AuthUser =>
    ({
      companyId: 'company-1',
      userId: 'user-1',
      branchId: 'branch-1',
      branchIds: ['branch-1'],
      isSuperAdmin: false,
      permissions: [],
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
          ...grant,
        },
      ],
    }) as AuthUser;

  beforeEach(() => jest.clearAllMocks());

  it('limits the session list to warehouses explicitly visible to the user', () => {
    controller.list(user({ canView: false }), {});
    expect(service.list).toHaveBeenCalledWith(
      'company-1',
      {
        status: undefined,
        warehouseId: undefined,
        page: undefined,
        pageSize: undefined,
      },
      ['branch-1'],
      [],
    );
  });

  it('refuses to reveal a session from a warehouse the user cannot view', async () => {
    await expect(controller.findOne(user({ canView: false }), 'take-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('redacts frozen unit costs and variance values without warehouse cost access', async () => {
    service.findOne.mockResolvedValueOnce({
      id: 'take-cost',
      warehouseId: 'warehouse-a',
      lines: [
        { id: 'line-1', unitCost: '12.5000', varianceValue: '25.0000', varianceQuantity: '2.0000' },
      ],
    });
    const result = await controller.findOne(
      user({ canView: true }),
      'take-cost',
    ) as any;
    expect(result.lines[0]).toEqual({
      id: 'line-1',
      varianceQuantity: '2.0000',
    });
  });

  it('requires the warehouse count grant before cancelling a session', async () => {
    await expect(
      controller.cancel(user({ canView: true, canCount: false }), 'take-1', {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.cancel).not.toHaveBeenCalled();
  });

  it('allows cancellation only after checking the count grant', async () => {
    service.cancel.mockResolvedValueOnce({ id: 'take-1', status: 'CANCELLED' });
    await expect(
      controller.cancel(user({ canView: true, canCount: true }), 'take-1', { reason: 'duplicate' }),
    ).resolves.toEqual({ id: 'take-1', status: 'CANCELLED' });
    expect(service.cancel).toHaveBeenCalledWith(
      'company-1',
      'user-1',
      'take-1',
      'duplicate',
      ['branch-1'],
    );
  });
});
