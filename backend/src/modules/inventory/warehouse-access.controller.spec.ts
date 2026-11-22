import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PERMISSIONS_KEY } from '../../common/decorators/require-permissions.decorator';
import { WarehouseAccessController } from './warehouse-access.controller';

describe('warehouse access people endpoint', () => {
  it('uses warehouse-read permission rather than user-admin permission', () => {
    const handler = WarehouseAccessController.prototype.usersForAccess;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
      'inventory.warehouse.access.read',
    ]);
  });

  it('returns people scoped to the caller company and assigned branches', async () => {
    const rows = [{ id: 'person-1', username: 'keeper' }];
    const service = { usersForAccess: jest.fn().mockResolvedValue(rows) };
    const controller = new WarehouseAccessController(service as never);
    const user = {
      companyId: 'company-1',
      branchId: 'branch-1',
      branchIds: ['branch-1', 'branch-2'],
    } as AuthUser;

    await expect(controller.usersForAccess(user)).resolves.toEqual(rows);
    expect(service.usersForAccess).toHaveBeenCalledWith('company-1', [
      'branch-1',
      'branch-2',
    ]);
  });
});
