import { AuthUser } from '../../common/decorators/current-user.decorator';
import { BatchesController } from './batches.controller';

describe('batch warehouse access', () => {
  const service = {
    list: jest.fn(),
    expiryReport: jest.fn(async () => ({})),
    findOne: jest.fn(),
    trace: jest.fn(),
    receive: jest.fn(),
    issue: jest.fn(),
    writeOff: jest.fn(),
    transfer: jest.fn(),
  };
  const controller = new BatchesController(service as never);

  const user = (warehouseAccess: Array<Record<string, unknown>>): AuthUser =>
    ({
      companyId: 'company-1',
      userId: 'user-1',
      branchId: 'branch-1',
      branchIds: ['branch-1'],
      isSuperAdmin: false,
      permissions: ['inventory.batches.read'],
      warehouseAccess,
    }) as AuthUser;

  beforeEach(() => jest.clearAllMocks());

  it('passes only visible warehouse grants to the expiry report', () => {
    controller.expiryReport(
      user([
        { warehouseId: 'warehouse-visible', canView: true },
        { warehouseId: 'warehouse-hidden', canView: false },
      ]),
      {},
    );

    expect(service.expiryReport).toHaveBeenCalledWith(
      'company-1',
      {},
      ['branch-1'],
      ['warehouse-visible'],
    );
  });

  it('redacts expiry values when global or warehouse cost visibility is missing', async () => {
    service.expiryReport.mockResolvedValueOnce({
      atRisk: '125.0000',
      buckets: { EXPIRED: { count: 1, quantity: '2.0000', value: '125.0000' } },
      items: [{ quantity: '2.0000', unitCost: '62.5000', value: '125.0000' }],
    });
    const result = await controller.expiryReport(
      user([
        {
          warehouseId: 'warehouse-visible',
          canView: true,
          canReceive: false,
          canIssue: false,
          canTransfer: false,
          canCount: false,
          canApprove: false,
          canSeeCost: false,
        },
      ]),
      { warehouseId: 'warehouse-visible' },
    ) as any;

    expect(result.atRisk).toBeUndefined();
    expect(result.buckets.EXPIRED).toEqual({ count: 1, quantity: '2.0000' });
    expect(result.items[0]).toEqual({ quantity: '2.0000' });
  });

  it('redacts lot and movement costs when the warehouse grant hides cost', async () => {
    service.findOne.mockResolvedValueOnce({
      id: 'batch-1',
      warehouseId: 'warehouse-visible',
      unitCost: '5.0000',
      movements: [
        {
          id: 'movement-1',
          warehouseId: 'warehouse-visible',
          unitCost: '5.0000',
          totalCost: '10.0000',
          quantity: '2.0000',
        },
      ],
    });
    const result = await controller.findOne(
      user([{ warehouseId: 'warehouse-visible', canView: true, canSeeCost: false }]),
      'batch-1',
    ) as any;

    expect(result.unitCost).toBeUndefined();
    expect(result.movements[0]).toEqual({
      id: 'movement-1',
      warehouseId: 'warehouse-visible',
      quantity: '2.0000',
    });
  });

  it('passes an empty allow-list when configured grants expose no warehouses', () => {
    controller.expiryReport(
      user([{ warehouseId: 'warehouse-hidden', canView: false }]),
      {},
    );

    expect(service.expiryReport).toHaveBeenCalledWith(
      'company-1',
      {},
      ['branch-1'],
      [],
    );
  });
});
