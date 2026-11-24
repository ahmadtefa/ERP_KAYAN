import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { BranchWriteGuard } from './branch-write.guard';

const OWN = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '33333333-3333-4333-8333-333333333333';
const DOC = '44444444-4444-4444-8444-444444444444';
const WH_OWN = '55555555-5555-4555-8555-555555555555';
const WH_FOREIGN = '66666666-6666-4666-8666-666666666666';

function setup(docBranch: string | null = FOREIGN) {
  const prisma = {
    stockDocument: { findFirst: jest.fn(async () => ({ branchId: docBranch })) },
    warehouse: {
      findFirst: jest.fn(async (args: { where: { id: string } }) => ({
        branchId: args.where.id === WH_OWN ? OWN : FOREIGN,
      })),
    },
  };
  const guard = new BranchWriteGuard(prisma as never);
  const run = (
    method: string,
    url: string,
    body: unknown = {},
    user: object = { companyId: 'c', branchIds: [OWN], roles: ['CASHIER'] },
  ) =>
    guard.canActivate({
      switchToHttp: () => ({ getRequest: () => ({ method, url, body, user }) }),
    } as never);
  return { run };
}

describe('BranchWriteGuard stock documents', () => {
  it('refuses to create a document for a foreign branch', async () => {
    const { run } = setup();
    await expect(
      run('POST', '/api/v1/inventory/stock-documents', { branchId: FOREIGN }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a foreign warehouse even when the branch is own', async () => {
    const { run } = setup();
    await expect(
      run('POST', '/api/v1/inventory/stock-documents/vouchers', {
        branchId: OWN,
        toWarehouseId: WH_FOREIGN,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets an own-branch, own-warehouse create through', async () => {
    const { run } = setup();
    await expect(
      run('POST', '/api/v1/inventory/stock-documents', {
        branchId: OWN,
        warehouseId: WH_OWN,
      }),
    ).resolves.toBe(true);
  });

  it('hides a foreign document from read, post and reverse as not found', async () => {
    const { run } = setup(FOREIGN);
    for (const [m, s] of [['GET', ''], ['POST', '/post'], ['POST', '/reverse']]) {
      await expect(
        run(m, `/api/v1/inventory/stock-documents/${DOC}${s}`),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('lets an own-branch document through', async () => {
    const { run } = setup(OWN);
    await expect(
      run('GET', `/api/v1/inventory/stock-documents/${DOC}`),
    ).resolves.toBe(true);
  });

  it('does not restrict super administrators or unrelated reads', async () => {
    const { run } = setup();
    await expect(
      run('POST', '/api/v1/inventory/stock-documents', { branchId: FOREIGN }, { isSuperAdmin: true, companyId: 'c' }),
    ).resolves.toBe(true);
    await expect(run('GET', '/api/v1/items')).resolves.toBe(true);
  });
});
