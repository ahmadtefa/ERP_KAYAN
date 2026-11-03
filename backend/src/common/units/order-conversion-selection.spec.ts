import { Prisma } from '@prisma/client';
import { selectedOrderLineQuantities } from './order-conversion-selection';
import { SalesOrdersService } from '../../modules/sales/sales-orders.service';
import { PurchaseOrdersService } from '../../modules/purchases/purchase-orders.service';

const D = (value: string | number) => new Prisma.Decimal(value);
const choices = [{ id: 'one' }, { id: 'two' }];

describe('explicit order conversion selection', () => {
  it.each([undefined, null, [], {}, 'all', [null], [['one']]])(
    'rejects missing or invalid selections %#', (lines) => {
      expect(() => selectedOrderLineQuantities(lines, choices)).toThrow();
    },
  );
  it.each([
    [{ orderLineId: 'missing', quantity: '1' }],
    [{ orderLineId: 'one', quantity: '0' }],
    [{ orderLineId: 'one', quantity: '-1' }],
    [{ orderLineId: 'one', quantity: 'NaN' }],
    [{ orderLineId: 'one', quantity: '0.00001' }],
    [{ orderLineId: 'one', quantity: '1' }, { orderLineId: 'one', quantity: '2' }],
  ])('rejects invalid quantity, foreign or duplicated line %#', (lines) => {
    expect(() => selectedOrderLineQuantities(lines, choices)).toThrow();
  });

  it.each([
    ['sales', SalesOrdersService, 'salesOrder', 'salesOrderLine', 'salesInvoice'],
    ['purchase', PurchaseOrdersService, 'purchaseOrder', 'purchaseOrderLine', 'purchaseInvoice'],
  ] as const)('%s invoices only explicitly selected lines', async (_kind, Service, orderModel, lineModel, invoiceModel) => {
    const line = (id: string) => ({ id, lineNumber: id === 'one' ? 1 : 2,
      itemId: `item-${id}`, description: id, quantity: D(10), invoicedQuantity: D(0),
      unitPrice: D(3), taxRate: D(0), unitName: null, unitFactor: null });
    const order = { id: 'order', orderNumber: 'O-1', status: 'APPROVED',
      customerId: 'customer', supplierId: 'supplier', lines: [line('one'), line('two')] };
    const update = jest.fn(async (args: unknown) => { void args; return {}; });
    const tx = { [lineModel]: { update, findMany: jest.fn(async () => [
      { quantity: D(10), invoicedQuantity: D(2) }, { quantity: D(10), invoicedQuantity: D(0) },
    ]) }, [invoiceModel]: { update: jest.fn(async () => ({})) },
    [orderModel]: { update: jest.fn(async () => ({})) } };
    const prisma = { [orderModel]: { findFirst: jest.fn(async () => order) },
      $transaction: jest.fn(async (work: (client: unknown) => unknown) => work(tx)) };
    const create = jest.fn(async (...args: [string, string, string, unknown]) => { void args; return { id: 'invoice' }; });
    const service = new Service(prisma as never, {} as never, {} as never, {} as never,
      { create } as never, { record: jest.fn(async () => undefined) } as never);
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'order' } as never);
    await service.convertToInvoice('company', 'branch', 'user', 'order', {
      invoiceDate: '2026-11-03', lines: [{ orderLineId: 'one', quantity: '2' }],
    });
    const dto = create.mock.calls[0][3] as { lines: Array<{ itemId: string; quantity: string }> };
    expect(dto.lines).toEqual([expect.objectContaining({ itemId: 'item-one', quantity: '2.0000' })]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toEqual(expect.objectContaining({ where: { id: 'one' } }));
    await expect(service.convertToInvoice('company', 'branch', 'user', 'order', {})).rejects.toThrow(/Select/);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
