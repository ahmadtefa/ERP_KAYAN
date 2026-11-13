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
    expiryAlerts: jest.fn(async () => ({ items: [], counts: {} })),
    expiryAlertStates: jest.fn(async () => new Map()),
  };
  const notifications = { scanStock: jest.fn(async () => ({ raised: 0, closed: 0 })) };
  const controller = new BatchesController(service as never, notifications as never);

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

describe('the expiry alerts route', () => {
  type Row = Record<string, unknown>;
  const service = {
    expiryAlerts: jest.fn(async () => ({
      asOf: '2026-03-01',
      days: [7, 30, 60, 90],
      horizonDays: 90,
      counts: { expired: 1, expiringSoon: 1, valid: 0, total: 2 },
      items: [
        {
          id: 'lot-expired',
          batchNumber: 'LOT-A',
          warehouseId: 'warehouse-1',
          quantity: '5.0000',
          unitCost: '2.0000',
          value: '10.0000',
          group: 'EXPIRED',
        },
        {
          id: 'lot-soon',
          batchNumber: 'LOT-B',
          warehouseId: 'warehouse-1',
          quantity: '3.0000',
          unitCost: '1.0000',
          value: '3.0000',
          group: 'EXPIRING_SOON',
        },
      ],
    })),
    expiryAlertStates: jest.fn(
      async () =>
        new Map([
          [
            'lot-expired',
            {
              type: 'STOCK_EXPIRED',
              status: 'OPEN',
              severity: 'CRITICAL',
              raisedCount: 2,
              lastRaisedAt: new Date('2026-02-28T00:00:00.000Z'),
            },
          ],
        ]),
    ),
    list: jest.fn(),
    expiryReport: jest.fn(),
    findOne: jest.fn(),
    trace: jest.fn(),
    receive: jest.fn(),
    issue: jest.fn(),
    writeOff: jest.fn(),
    transfer: jest.fn(),
  };
  const notifications = { scanStock: jest.fn(async () => ({ raised: 2, closed: 0, types: 6 })) };

  const reader = (overrides: Row = {}): AuthUser =>
    ({
      companyId: 'company-1',
      username: 'reader',
      userId: 'user-1',
      branchId: 'branch-1',
      branchIds: ['branch-1'],
      isSuperAdmin: false,
      permissions: ['inventory.batches.read'],
      ...overrides,
    }) as unknown as AuthUser;

  beforeEach(() => jest.clearAllMocks());

  it('shows the expired alert standing against the lot that raised it', async () => {
    const controller = new BatchesController(service as never, notifications as never);

    const answer = (await controller.alerts(reader(), {})) as {
      items: Array<{ id: string; alert: Row | null }>;
    };

    expect(answer.items).toHaveLength(2);
    expect(answer.items[0].alert).toMatchObject({ status: 'OPEN', raisedCount: 2 });
    // A lot with no alert says so instead of inventing a status.
    expect(answer.items[1].alert).toBeNull();
    expect(service.expiryAlertStates).toHaveBeenCalledWith('company-1', ['lot-expired', 'lot-soon']);
  });

  it('asks the scanner to run when the screen requests it and the user may scan', async () => {
    const controller = new BatchesController(service as never, notifications as never);

    await controller.alerts(
      reader({ permissions: ['inventory.batches.read', 'notifications.manage'] }),
      { scan: 'true' },
    );

    expect(notifications.scanStock).toHaveBeenCalledWith('company-1');
  });

  it('never scans for a user who may only read', async () => {
    const controller = new BatchesController(service as never, notifications as never);

    await controller.alerts(reader(), { scan: 'true' });

    expect(notifications.scanStock).not.toHaveBeenCalled();
    // The list is still answered: reading alerts is not a management act.
    expect(service.expiryAlerts).toHaveBeenCalled();
  });

  it('answers with the list even when the scan it was asked for fails', async () => {
    notifications.scanStock.mockRejectedValueOnce(new Error('scanner exploded'));
    const controller = new BatchesController(service as never, notifications as never);

    await expect(
      controller.alerts(
        reader({ permissions: ['inventory.batches.read', 'notifications.manage'] }),
        { scan: 'true' },
      ),
    ).resolves.toBeTruthy();
    expect(service.expiryAlerts).toHaveBeenCalled();
  });

  it('hides what a lot cost when the user may not read costs', async () => {
    const controller = new BatchesController(service as never, notifications as never);

    const answer = (await controller.alerts(reader(), {})) as {
      items: Array<Row>;
    };

    // No cost visibility grant on this user, so the value never leaves the API.
    expect(answer.items[0]).not.toHaveProperty('unitCost');
    expect(answer.items[0]).not.toHaveProperty('value');
    expect(answer.items[0]).toHaveProperty('quantity');
  });

  it('scopes the feed to the warehouses the user may view', async () => {
    const controller = new BatchesController(service as never, notifications as never);

    await controller.alerts(
      reader({
        warehouseAccess: [
          { warehouseId: 'warehouse-1', canView: true },
          { warehouseId: 'warehouse-2', canView: false },
        ],
      }),
      {},
    );

    expect(service.expiryAlerts).toHaveBeenCalledWith(
      'company-1',
      {},
      ['branch-1'],
      ['warehouse-1'],
    );
  });
});
