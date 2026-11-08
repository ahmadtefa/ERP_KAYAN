import { AuthUser } from '../../common/decorators/current-user.decorator';
import { BatchesController } from './batches.controller';

describe('batch warehouse access', () => {
  const service = {
    list: jest.fn(),
    expiryReport: jest.fn(),
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
