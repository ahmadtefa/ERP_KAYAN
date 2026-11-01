import { BadRequestException, NotFoundException } from '@nestjs/common';

import { WarehouseAccessService } from './warehouse-access.service';

/// Who may work in which warehouse, without a database.
///
/// The screen and every guarded request read the same rows, so what this
/// service stores *is* the permission. The two things that must never drift:
/// an empty set means unrestricted (not "no warehouse"), and a save replaces
/// the old rows instead of merging with them - otherwise un-ticking a box in
/// the admin screen would leave the person still able to issue from that shelf.
describe('warehouse access', () => {
  const COMPANY = '11111111-1111-4111-8111-111111111111';
  const ACTOR = '99999999-9999-4999-8999-999999999999';
  const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const WH_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const WH_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  const userRow = { id: USER, username: 'storekeeper', fullNameEn: 'Keeper', fullNameAr: 'أمين' };

  function makeService(options: { user?: Record<string, unknown> | null } = {}) {
    const tx = {
      userWarehouseAccess: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async ({ data }: { data: unknown }) => data),
      },
    };
    const prisma = {
      user: {
        findFirst: jest.fn(async () =>
          options.user === null
            ? null
            : { ...userRow, isSuperAdmin: false, ...options.user },
        ),
      },
      userWarehouseAccess: { findMany: jest.fn(async () => [] as unknown[]) },
      warehouse: {
        findMany: jest.fn(async () => [
          { id: WH_A, code: 'WH-A', nameEn: 'Store A', nameAr: 'مخزن أ', branchId: 'branch-1' },
          { id: WH_B, code: 'WH-B', nameEn: 'Store B', nameAr: 'مخزن ب', branchId: 'branch-1' },
        ]),
      },
      $transaction: jest.fn(async (work: (client: unknown) => unknown) => work(tx)),
    };
    const audit = { record: jest.fn(async () => undefined) };
    const service = new WarehouseAccessService(prisma as never, audit as never);
    return { service, prisma, tx, audit };
  }

  it('treats an empty grant set as unrestricted, and still lists the warehouses', async () => {
    const { service, prisma } = makeService();

    const access = await service.forUser(COMPANY, USER);

    expect(access.restricted).toBe(false);
    expect(access.grants).toEqual([]);
    expect(access.warehouses.map((row) => row.code)).toEqual(['WH-A', 'WH-B']);
    // Reading another company's warehouses is not possible: the company is in
    // the filter, always.
    expect(prisma.warehouse.findMany.mock.calls[0][0].where.companyId).toBe(COMPANY);
  });

  it('restricts the warehouse list to the branches the caller may see', async () => {
    const { service, prisma } = makeService();

    await service.forUser(COMPANY, USER, ['branch-1']);

    expect(prisma.warehouse.findMany.mock.calls[0][0].where.branchId).toEqual({ in: ['branch-1'] });
  });

  it('reports every flag of a grant, not just the fact that one exists', async () => {
    const { service, prisma } = makeService();
    prisma.userWarehouseAccess.findMany.mockResolvedValueOnce([
      {
        warehouseId: WH_A,
        warehouse: { id: WH_A, code: 'WH-A', nameEn: 'Store A', nameAr: 'مخزن أ' },
        canView: true,
        canReceive: true,
        canIssue: false,
        canTransfer: false,
        canCount: true,
        canApprove: false,
        canSeeCost: true,
      },
    ]);

    const access = await service.forUser(COMPANY, USER);

    expect(access.restricted).toBe(true);
    expect(access.grants[0]).toMatchObject({
      warehouseId: WH_A,
      warehouseCode: 'WH-A',
      canReceive: true,
      canIssue: false,
      canCount: true,
      canSeeCost: true,
    });
  });

  it('replaces the old grants inside one transaction instead of merging with them', async () => {
    const { service, tx, audit } = makeService();

    await service.setForUser(COMPANY, ACTOR, USER, [
      { warehouseId: WH_A, canView: true, canIssue: true },
      { warehouseId: WH_B },
    ]);

    expect(tx.userWarehouseAccess.deleteMany).toHaveBeenCalledWith({
      where: { companyId: COMPANY, userId: USER },
    });
    const created = tx.userWarehouseAccess.create.mock.calls.map((call: any) => call[0].data);
    expect(created).toHaveLength(2);
    // An omitted flag is off, except viewing: adding a warehouse to the screen
    // means that person can see it, and nothing more.
    expect(created[1]).toMatchObject({
      warehouseId: WH_B,
      canView: true,
      canReceive: false,
      canIssue: false,
      canTransfer: false,
      canCount: false,
      canApprove: false,
      canSeeCost: false,
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SET_WAREHOUSE_ACCESS', entityId: USER }),
    );
  });

  it('refuses an unknown user before writing anything', async () => {
    const { service, tx } = makeService({ user: null });

    await expect(
      service.setForUser(COMPANY, ACTOR, USER, [{ warehouseId: WH_A }]),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.userWarehouseAccess.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses the same warehouse listed twice, and writes nothing', async () => {
    const { service, tx } = makeService();

    await expect(
      service.setForUser(COMPANY, ACTOR, USER, [
        { warehouseId: WH_A },
        { warehouseId: WH_A, canIssue: true },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.userWarehouseAccess.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses a warehouse outside the caller\u2019s branches', async () => {
    const { service, tx, prisma } = makeService();
    // The verification query returns one row for two ids: one is not theirs.
    prisma.warehouse.findMany.mockResolvedValueOnce([{ id: WH_A }]);

    await expect(
      service.setForUser(COMPANY, ACTOR, USER, [{ warehouseId: WH_A }, { warehouseId: WH_B }]),
    ).rejects.toThrow(/not available to you/i);
    expect(tx.userWarehouseAccess.deleteMany).not.toHaveBeenCalled();
  });

  it('clears a person\u2019s restrictions when the admin saves an empty list', async () => {
    const { service, tx, audit } = makeService();

    await service.setForUser(COMPANY, ACTOR, USER, []);

    expect(tx.userWarehouseAccess.deleteMany).toHaveBeenCalled();
    expect(tx.userWarehouseAccess.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ after: { warehouses: 0, restricted: false } }),
    );
  });
});
