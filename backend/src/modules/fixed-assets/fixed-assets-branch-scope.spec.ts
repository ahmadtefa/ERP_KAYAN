import { NotFoundException } from '@nestjs/common';
import { FixedAssetsService } from './fixed-assets.service';

describe('fixed assets branch scope', () => {
  function make(asset: unknown) {
    const prisma = {
      fixedAsset: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(asset) },
      assetDepreciation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new FixedAssetsService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    (svc as never as { accumulatedByAsset: unknown }).accumulatedByAsset = jest.fn().mockResolvedValue(new Map());
    (svc as never as { lastDepreciationByAsset: unknown }).lastDepreciationByAsset = jest.fn().mockResolvedValue(new Map());
    return { svc, prisma };
  }
  it('lists only assets of the caller branches', async () => {
    const { svc, prisma } = make(null);
    await svc.findAll('c', {} as never, ['mns']);
    expect(prisma.fixedAsset.findMany.mock.calls[0][0].where.branchId).toEqual({ in: ['mns'] });
  });
  it('company-wide callers are unfiltered', async () => {
    const { svc, prisma } = make(null);
    await svc.findAll('c', {} as never, null);
    expect(prisma.fixedAsset.findMany.mock.calls[0][0].where.branchId).toBeUndefined();
  });
  it('a foreign-branch asset by id is 404', async () => {
    const { svc } = make({ id: 'a', branchId: 'main' });
    await expect(svc.findOne('c', 'a', ['mns'])).rejects.toThrow(NotFoundException);
  });
});
