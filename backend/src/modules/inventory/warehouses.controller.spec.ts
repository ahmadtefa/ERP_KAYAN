import { ForbiddenException } from '@nestjs/common';

import { AuthUser } from '../../common/decorators/current-user.decorator';
import { WarehousesController } from './warehouses.controller';

describe('warehouse controller grants', () => {
  const service = {
    findAll: jest.fn(async () => ({ items: [], total: 0 })),
    balanceReport: jest.fn(async () => ({ rows: [], totals: {} })),
    findOne: jest.fn(async () => ({ id: 'warehouse-a' })),
    stock: jest.fn(async () => ({ rows: [{ value: '12.0000', quantity: '2.0000' }], totals: { value: '12.0000' } })),
  };
  const controller = new WarehousesController(service as never);

  const user = (warehouseAccess: Array<Record<string, unknown>>, permissions = ['inventory.warehouses.read']): AuthUser =>
    ({
      companyId: 'company-1',
      userId: 'user-1',
      branchId: 'branch-1',
      branchIds: ['branch-1'],
      isSuperAdmin: false,
      permissions,
      warehouseAccess,
    }) as AuthUser;

  beforeEach(() => jest.clearAllMocks());

  it('limits the warehouse catalogue to visible warehouse grants', () => {
    controller.findAll(
      user([
        { warehouseId: 'warehouse-a', canView: true },
        { warehouseId: 'warehouse-b', canView: false },
      ]),
      {},
    );
    expect(service.findAll).toHaveBeenCalledWith(
      'company-1',
      { branchId: undefined, includeInactive: false },
      ['branch-1'],
      ['warehouse-a'],
    );
  });

  it('refuses direct access to a warehouse hidden by the grant list', () => {
    expect(() =>
      controller.findOne(
        user([{ warehouseId: 'warehouse-a', canView: false }]),
        'warehouse-a',
      ),
    ).toThrow(ForbiddenException);
    expect(service.findOne).not.toHaveBeenCalled();
  });

  it('filters balance reports to the allowed warehouses and hides their values', () => {
    controller.balance(
      user([
        {
          warehouseId: 'warehouse-a',
          canView: true,
          canSeeCost: false,
        },
      ]),
      {},
    );
    expect(service.balanceReport).toHaveBeenCalledWith(
      'company-1',
      {
        branchId: undefined,
        warehouseId: undefined,
        itemId: undefined,
        q: undefined,
        includeZero: false,
        asOf: undefined,
      },
      ['branch-1'],
      ['warehouse-a'],
      false,
    );
  });

  it('redacts the warehouse stock value unless both cost grants allow it', async () => {
    const result = await controller.stock(
      user([{ warehouseId: 'warehouse-a', canView: true, canSeeCost: false }]),
      'warehouse-a',
      {},
    ) as any;
    expect(result.rows[0]).toEqual({ quantity: '2.0000' });
    expect(result.totals).toEqual({});
  });

  it('allows an explicitly visible warehouse even when other warehouses are hidden', () => {
    expect(() =>
      controller.findOne(
        user([
          { warehouseId: 'warehouse-a', canView: true },
          { warehouseId: 'warehouse-b', canView: false },
        ]),
        'warehouse-a',
      ),
    ).not.toThrow();
    expect(service.findOne).toHaveBeenCalledWith('company-1', 'warehouse-a', ['branch-1']);
  });
});
