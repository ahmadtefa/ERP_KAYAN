import { SearchService } from './search.service';

function prismaStub() {
  const empty = jest.fn(async (_args?: unknown) => [] as unknown[]);
  return {
    salesInvoice: { findMany: empty },
    purchaseInvoice: { findMany: empty },
    cashVoucher: { findMany: empty },
    journalEntry: { findMany: empty },
    customer: { findMany: empty },
    supplier: { findMany: empty },
    item: { findMany: empty },
  };
}

describe('SearchService', () => {
  it('answers with an empty result for a term that is too short', async () => {
    const prisma = prismaStub();
    const service = new SearchService(prisma as never);
    const result = await service.search('company-1', 'a');
    expect(result.results).toEqual([]);
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });

  it('groups documents, partners and items into one result list', async () => {
    const prisma = prismaStub();
    prisma.salesInvoice.findMany = jest.fn(async (_args?: unknown) => [
      {
        id: 's-1',
        invoiceNumber: 'S-100',
        invoiceDate: new Date('2026-05-01'),
        totalAmount: { toFixed: () => '10.0000' },
        status: 'POSTED',
        customer: { nameEn: 'Acme', nameAr: 'أكمي' },
      },
    ]);
    prisma.customer.findMany = jest.fn(async (_args?: unknown) => [
      { id: 'c-1', code: 'C01', nameEn: 'Acme', nameAr: 'أكمي', phone: '0100' },
    ]);
    prisma.item.findMany = jest.fn(async (_args?: unknown) => [
      {
        id: 'i-1',
        code: 'IT-1',
        nameEn: 'Widget',
        nameAr: 'أداة',
        salePrice: { toFixed: () => '5.0000' },
      },
    ]);
    const service = new SearchService(prisma as never);

    const result = await service.search('company-1', 'acme');

    expect(result.total).toBe(3);
    const types = result.results.map((row: { type: string }) => row.type);
    expect(types).toContain('SALES_INVOICE');
    expect(types).toContain('CUSTOMER');
    expect(types).toContain('ITEM');
    // Every search result must carry a route back to the screen it came from.
    for (const row of result.results) {
      expect(row.route).toMatch(/^\//);
    }
  });

  it('keeps each result inside the caller company', async () => {
    const findMany = jest.fn(async (_args?: unknown) => [] as unknown[]);
    const prisma = prismaStub();
    prisma.salesInvoice.findMany = findMany;
    const service = new SearchService(prisma as never);

    await service.search('company-7', 'invoice');

    for (const call of findMany.mock.calls) {
      expect((call[0] as Record<string, any>).where.companyId).toBe('company-7');
    }
  });
});
