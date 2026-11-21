import { SalesInvoicesController } from './sales-invoices.controller';
import { PurchaseInvoicesController } from '../purchases/purchase-invoices.controller';

describe('price-read permissions on invoice API responses', () => {
  const principal = (permissions: string[]) => ({
    userId: 'user', username: 'test', companyId: 'company', branchId: 'branch',
    isSuperAdmin: false, permissions,
  });

  it('exposes sales figures only with sales.price.read, independently of purchase cost', async () => {
    const service = { findOne: jest.fn().mockResolvedValue({
      unitPrice: '12.0000', totalAmount: '24.0000', unitCost: '5.0000', costOfGoods: '10.0000',
    }) };
    const controller = new SalesInvoicesController(service as never);

    const blocked = await controller.findOne(principal([]) as never, 'invoice') as Record<string, unknown>;
    expect(blocked).toEqual({});

    const saleOnly = await controller.findOne(principal(['sales.price.read']) as never, 'invoice') as Record<string, unknown>;
    expect(saleOnly).toEqual({ unitPrice: '12.0000', totalAmount: '24.0000' });

    const costOnly = await controller.findOne(principal(['inventory.cost.read']) as never, 'invoice') as Record<string, unknown>;
    expect(costOnly).toEqual({ unitCost: '5.0000', costOfGoods: '10.0000' });
  });

  it('redacts purchase invoice prices without removing their allowed status/actions', async () => {
    const service = { findOne: jest.fn().mockResolvedValue({
      unitPrice: '9.0000', totalAmount: '18.0000', status: 'draft',
    }) };
    const controller = new PurchaseInvoicesController(service as never);
    const hidden = await controller.findOne(principal([]) as never, 'invoice') as Record<string, unknown>;
    expect(hidden).toEqual({ status: 'draft' });
    const allowed = await controller.findOne(principal(['purchases.price.read']) as never, 'invoice') as Record<string, unknown>;
    expect(allowed).toMatchObject({ unitPrice: '9.0000', totalAmount: '18.0000', status: 'draft' });
    const costOnly = await controller.findOne(principal(['inventory.cost.read']) as never, 'invoice') as Record<string, unknown>;
    expect(costOnly).toEqual({ status: 'draft' });
  });
});
