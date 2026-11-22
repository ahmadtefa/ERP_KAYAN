import { SearchController } from './search.controller';

describe('search price visibility', () => {
  it('keeps purchase prices, selling prices and valuation costs on independent grants', async () => {
    const service = { search: jest.fn().mockResolvedValue({ results: [], total: 0 }) };
    const controller = new SearchController(service as never);
    const principal = (permissions: string[]) => ({
      userId: 'u', username: 'operator', companyId: 'c', branchId: null,
      isSuperAdmin: false, permissions,
    });

    await controller.search(principal(['inventory.cost.read']) as never, 'item');
    expect(service.search.mock.calls.at(-1)?.[3]).toEqual({ sale: false, purchase: false });

    await controller.search(principal(['purchases.price.read']) as never, 'item');
    expect(service.search.mock.calls.at(-1)?.[3]).toEqual({ sale: false, purchase: true });

    await controller.search(principal(['sales.price.read']) as never, 'item');
    expect(service.search.mock.calls.at(-1)?.[3]).toEqual({ sale: true, purchase: false });
  });
});
