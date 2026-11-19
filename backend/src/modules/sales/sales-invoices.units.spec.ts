import { BadRequestException } from '@nestjs/common';
import {
  InvoiceDocumentType,
  InvoiceStatus,
  Prisma,
  StockDirection,
} from '@prisma/client';

import { SalesInvoicesService } from './sales-invoices.service';
import { fakeBatches, fakeLedger } from '../../testing/fake-batches-issue';
import { historicalOrderUnit } from '../../common/units/order-conversion-unit';

const D = (v: string | number) => new Prisma.Decimal(v);
const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '33333333-3333-4333-8333-333333333333';
const CUSTOMER = '99999999-9999-4999-8999-999999999999';
const MILK = '77777777-7777-4777-8777-777777777777';

const milkItem = {
  id: MILK,
  code: 'MILK',
  nameEn: 'Milk',
  nameAr: 'لبن',
  taxRate: D(0),
  isActive: true,
  isStockTracked: true,
  salePrice: D(9),
  unit: 'علبة',
  units: [
    { id: 'u-piece', unit: 'علبة', factor: D(1), isActive: true, salePrice: D(9), purchasePrice: null },
    { id: 'u-carton', unit: 'كرتونة', factor: D(10), isActive: true, salePrice: D(97), purchasePrice: D(75) },
  ],
};

function makeService(itemOverride: any = milkItem) {
  const itemFind = jest.fn(async () => itemOverride);
  const tx = {
    salesInvoice: {
      findFirst: jest.fn(),
      create: jest.fn(async ({ data }: { data: any }) => ({
        id: 'invoice-1',
        invoiceNumber: data.invoiceNumber,
        subTotal: data.subTotal,
        taxAmount: data.taxAmount,
        totalAmount: data.totalAmount,
        costOfGoods: D(0),
      })),
      update: jest.fn(async () => ({ id: 'invoice-1' })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    salesInvoiceLine: { update: jest.fn(async () => ({})) },
    customer: { findFirst: jest.fn(async () => ({ id: CUSTOMER, isActive: true })) },
    item: { findFirst: itemFind },
    costCenter: { findFirst: jest.fn() },
    stockMovement: { create: jest.fn(async () => ({})) },
    stockBalance: { update: jest.fn(async () => ({})) },
    $queryRaw: jest.fn(async () => [{ quantity: D(50), value: D(375) }]),
  };

  const prisma = {
    customer: { findFirst: jest.fn(async () => ({ id: CUSTOMER, nameEn: 'Cust', isActive: true })) },
    item: { findFirst: itemFind },
    costCenter: { findFirst: jest.fn() },
    salesInvoice: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(async (work: (client: unknown) => unknown) => work(tx)),
  };

  const numbers = { next: jest.fn(async () => 'SI-0001') };
  const posting = { post: jest.fn(async () => ({ id: 'je-1', entryNumber: 'JV-1' })) };
  const accounts = { resolve: jest.fn(async () => ({})) };
  const settings = {
    get: jest.fn(async () => ({
      taxRate: '0.0000',
      maxDiscountPercent: '100.0000',
      pricesIncludeTax: false,
    })),
  };
  // The warehouse-level guard itself is covered in warehouse-guard.spec.ts and
  // stock-documents.warehouse-guard.spec.ts; this suite stays focused on units.
  const warehouses = {
    resolve: jest.fn(async () => 'warehouse-1'),
    assertWarehouseAvailable: jest.fn().mockResolvedValue(undefined),
  };
  const prices = { resolvePrice: jest.fn(async () => null) };
  const audit = { record: jest.fn(async () => undefined), recordRequired: jest.fn(async () => undefined) };

  const service = new SalesInvoicesService(
    prisma as never,
    numbers as never,
    posting as never,
    accounts as never,
    settings as never,
    warehouses as never,
    prices as never,
    audit as never,
    fakeBatches({ onHand: { quantity: 50, value: 375 } }) as never,
    fakeLedger() as never,
  );
  jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'invoice-1' } as never);

  return { service, prisma, tx, prices, posting, warehouses, settings };
}

const baseDto = {
  invoiceDate: '2026-10-27',
  customerId: CUSTOMER,
  lines: [] as any[],
};

describe('Sales multi-unit — milk scenario', () => {
  it('preserves a trusted order unit even when the catalogue factor changes or is disabled', async () => {
    const changed = { ...milkItem, units: [milkItem.units[0], { ...milkItem.units[1], factor: D(12), isActive: false }] };
    const { service, tx } = makeService(changed);
    const resolved = historicalOrderUnit({ label: 'Line 1', unitName: 'كرتونة', unitFactor: D(10), baseQuantity: D(20) });
    await service.create(COMPANY, BRANCH, 'user-1', { ...baseDto, lines: [{ itemId: MILK, quantity: '2', unitName: 'كرتونة', unitPrice: '75', taxRate: '0' }] } as any, [{ itemId: MILK, resolved }]);
    const line = tx.salesInvoice.create.mock.calls[0][0].data.lines.create[0];
    expect(line.quantity.toFixed(4)).toBe('20.0000');
    expect(line.unitFactor.toFixed(6)).toBe('10.000000');
    expect(line.unitQuantity.toFixed(4)).toBe('2.0000');
    expect(line.grossLineTotal.toFixed(4)).toBe('150.0000');
  });

  it('uses the historical order tax-exclusive price when company policy changes', async () => {
    const { service, tx, settings } = makeService();
    settings.get.mockResolvedValue({ taxRate: '14', maxDiscountPercent: '100', pricesIncludeTax: true });
    const resolved = historicalOrderUnit({ label: 'Line 1', unitName: 'كرتونة', unitFactor: D(10), baseQuantity: D(20) });
    await service.create(COMPANY, BRANCH, 'user-1', { ...baseDto,
      lines: [{ itemId: MILK, quantity: '2', unitName: 'كرتونة', unitPrice: '75', taxRate: '14' }] } as any,
      [{ itemId: MILK, resolved }]);
    const line = tx.salesInvoice.create.mock.calls[0][0].data.lines.create[0];
    expect(line.grossLineTotal.toFixed(4)).toBe('150.0000');
    expect(line.taxAmount.toFixed(4)).toBe('21.0000');
  });

  it('does not turn a null item tax into company tax for a new invoice', async () => {
    const { service, tx, settings } = makeService({ ...milkItem, taxRate: null });
    settings.get.mockResolvedValue({ taxRate: '14', maxDiscountPercent: '100', pricesIncludeTax: false });
    await service.create(COMPANY, BRANCH, 'user-1', { ...baseDto,
      lines: [{ itemId: MILK, quantity: '1' }] } as any);
    expect(tx.salesInvoice.create.mock.calls[0][0].data.lines.create[0].taxRate.toFixed(4)).toBe('0.0000');
  });

  it.each([[null, '0.0000'], ['', '0.0000'], ['   ', '0.0000'], ['0', '0.0000'], ['7', '7.0000']])
    ('persists the explicit line rate %s as %s', async (taxRate, expected) => {
      const { service, tx } = makeService({ ...milkItem, taxRate: D(14) });
      await service.create(COMPANY, BRANCH, 'user-1', { ...baseDto, lines: [{ itemId: MILK, quantity: '1', taxRate }] } as any);
      const line = tx.salesInvoice.create.mock.calls[0][0].data.lines.create[0];
      expect(line.taxRate.toFixed(4)).toBe(expected);
    });

  it('does not silently add company tax to an item-less line whose tax was omitted', async () => {
    const {service, tx, settings} = makeService();
    settings.get.mockResolvedValue({taxRate:'14', maxDiscountPercent:'100', pricesIncludeTax:false});
    await service.create(COMPANY, BRANCH, 'user-1', {...baseDto,
      lines:[{description:'Service without catalog item', quantity:'1', unitPrice:'100'}]} as any);
    const line = tx.salesInvoice.create.mock.calls[0][0].data.lines.create[0];
    expect(line.taxRate.toFixed(4)).toBe('0.0000');
    expect(line.taxAmount.toFixed(4)).toBe('0.0000');
    expect(line.lineTotal.toFixed(4)).toBe('100.0000');
  });

  it.each([[null, '0.0000'], ['', '0.0000'], ['   ', '0.0000'], ['7', '7.0000']])
    ('honours a free-text line tax of %s as %s', async (taxRate, expected) => {
      const {service, tx, settings} = makeService();
      settings.get.mockResolvedValue({taxRate:'14', maxDiscountPercent:'100', pricesIncludeTax:false});
      await service.create(COMPANY, BRANCH, 'user-1', {...baseDto,
        lines:[{description:'Service', quantity:'1', unitPrice:'100', taxRate}]} as any);
      expect(tx.salesInvoice.create.mock.calls[0][0].data.lines.create[0].taxRate.toFixed(4)).toBe(expected);
    });

  it('treats both blank and omitted line tax as zero even when the item rate is nonzero', async () => {
    const { service, tx } = makeService({ ...milkItem, taxRate: D(14) });
    await service.create(COMPANY, BRANCH, 'user-1', { ...baseDto,
      lines: [{ itemId: MILK, quantity: '1', taxRate: '' }, { itemId: MILK, quantity: '1' }] } as any);
    const lines = tx.salesInvoice.create.mock.calls[0][0].data.lines.create;
    expect(lines[0].taxRate.toFixed(4)).toBe('0.0000');
    expect(lines[1].taxRate.toFixed(4)).toBe('0.0000');
  });

  it('sells 3 pieces: base qty 3 at 9 each, line total 27', async () => {
    const { service, tx } = makeService();
    await service.create(COMPANY, BRANCH, 'user-1', {
      ...baseDto,
      lines: [{ itemId: MILK, quantity: '3', unitName: 'علبة' }],
    } as any);
    const line = tx.salesInvoice.create.mock.calls[0][0].data.lines.create[0];
    expect(line.unitPrice.toFixed(4)).toBe('9.0000');
    expect(line.quantity.toFixed(4)).toBe('3.0000');
    expect(line.unitQuantity.toFixed(4)).toBe('3.0000');
    expect(line.grossLineTotal.toFixed(4)).toBe('27.0000');
    expect(line.unitName).toBe('علبة');
    expect(line.unitFactor.toFixed(6)).toBe('1.000000');
  });

  it('sells ONE carton at 97: shows 1 carton but stock moves 10 pieces — never 10 cartons', async () => {
    const { service, tx } = makeService();
    await service.create(COMPANY, BRANCH, 'user-1', {
      ...baseDto,
      lines: [{ itemId: MILK, quantity: '1', unitName: 'كرتونة' }],
    } as any);
    const line = tx.salesInvoice.create.mock.calls[0][0].data.lines.create[0];
    // Independent carton price, independent of 10 x piece price.
    expect(line.unitPrice.toFixed(4)).toBe('97.0000');
    // Money is entered qty (1) x carton price (97) = 97, not 10 x 97.
    expect(line.grossLineTotal.toFixed(4)).toBe('97.0000');
    expect(line.lineTotal.toFixed(4)).toBe('97.0000');
    // Display snapshot stays exactly what the user typed.
    expect(line.unitName).toBe('كرتونة');
    expect(line.unitQuantity.toFixed(4)).toBe('1.0000');
    expect(line.unitFactor.toFixed(6)).toBe('10.000000');
    // Internal stock quantity is 10 base pieces.
    expect(line.quantity.toFixed(4)).toBe('10.0000');
  });

  /// The manual-unit-change case, written where the mistake would actually
  /// happen.
  ///
  /// An operator scans a carton, so the screen sends `quantity: 1` with
  /// `unitName: "كرتونة"`. Then they change their mind on the same line and pick
  /// the piece unit. The screen keeps the figure they own ("1") and only changes
  /// the unit. The server must therefore multiply by the NEW factor once - 1 x 1
  /// = one piece - and not carry the carton's 10 forward and multiply it again.
  ///
  /// The failure this pins was real: a screen that converted on scan and then
  /// let the server convert the already-converted figure stores 10 x 10 = 100
  /// pieces for a line the operator believes says one piece.
  it('a unit changed by hand converts once, with the unit finally chosen', async () => {
    const { service, tx } = makeService();

    // The same line, sent twice: once as scanned, once after the unit changed.
    await service.create(COMPANY, BRANCH, 'user-1', {
      ...baseDto,
      lines: [{ itemId: MILK, quantity: '1', unitName: 'كرتونة' }],
    } as any);
    await service.create(COMPANY, BRANCH, 'user-1', {
      ...baseDto,
      lines: [{ itemId: MILK, quantity: '1', unitName: 'علبة' }],
    } as any);

    const asScanned = tx.salesInvoice.create.mock.calls[0][0].data.lines.create[0];
    const afterChange = tx.salesInvoice.create.mock.calls[1][0].data.lines.create[0];

    // Scanned as a carton: one carton, ten base pieces.
    expect(asScanned.quantity.toFixed(4)).toBe('10.0000');

    // Changed to pieces: ONE piece. Not 10 (the carton's conversion carried
    // forward), and not 100 (that figure multiplied again by the carton).
    expect(afterChange.quantity.toFixed(4)).toBe('1.0000');
    expect(afterChange.unitQuantity.toFixed(4)).toBe('1.0000');
    expect(afterChange.unitFactor.toFixed(6)).toBe('1.000000');
    expect(afterChange.unitName).toBe('علبة');
    // The money follows the unit that was finally chosen.
    expect(afterChange.unitPrice.toFixed(4)).toBe('9.0000');
    expect(afterChange.grossLineTotal.toFixed(4)).toBe('9.0000');
  });

  it('derives a carton price from the base price only once when no unit price exists', async () => {
    const item = {
      ...milkItem,
      units: [milkItem.units[0], { ...milkItem.units[1], factor: D(12), salePrice: null }],
    };
    const { service, tx } = makeService(item);
    await service.create(COMPANY, BRANCH, 'user-1', {
      ...baseDto,
      lines: [{ itemId: MILK, quantity: '3', unitName: 'كرتونة' }],
    } as any);
    const line = tx.salesInvoice.create.mock.calls[0][0].data.lines.create[0];
    expect(line.unitPrice.toFixed(4)).toBe('108.0000');
    expect(line.grossLineTotal.toFixed(4)).toBe('324.0000');
    expect(line.quantity.toFixed(4)).toBe('36.0000');
  });

  it('posts both lines: exactly two OUT movements of 3 and 10 base pieces at average cost, never doubled', async () => {
    const { service, prisma, tx } = makeService();
    await service.create(COMPANY, BRANCH, 'user-1', {
      ...baseDto,
      lines: [
        { itemId: MILK, quantity: '3', unitName: 'علبة' },
        { itemId: MILK, quantity: '1', unitName: 'كرتونة' },
      ],
    } as any);

    // Build the posted invoice from the lines create() stored, with ids + item.
    const stored = tx.salesInvoice.create.mock.calls[0][0].data.lines.create.map(
      (l: any, i: number) => ({ ...l, id: `line-${i}`, itemId: MILK }),
    );

    (prisma.salesInvoice.findFirst as jest.Mock).mockResolvedValue({
      id: 'invoice-1',
      companyId: COMPANY,
      branchId: BRANCH,
      invoiceNumber: 'SI-0001',
      invoiceDate: new Date('2026-10-27T00:00:00Z'),
      status: InvoiceStatus.DRAFT,
      documentType: InvoiceDocumentType.INVOICE,
      warehouseId: null,
      customer: { code: 'C-1', nameEn: 'Cust' },
      totalAmount: D(124),
      taxAmount: D(0),
      lines: stored,
    });
    // The header read before claiming the row may be stale. Posting must use
    // the transaction read, after claiming it, for stock and accounting.
    tx.salesInvoice.findFirst.mockResolvedValue(await prisma.salesInvoice.findFirst());
    (prisma.salesInvoice.findFirst as jest.Mock).mockResolvedValueOnce({
      ...(await tx.salesInvoice.findFirst()),
      lines: [],
    });
    await service.post(COMPANY, 'user-1', 'invoice-1');
    expect(tx.salesInvoice.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(tx.salesInvoice.findFirst.mock.invocationCallOrder.at(-1)!);

    // Two lines -> exactly two stock OUT movements (one per line), not four.
    const outMoves = tx.stockMovement.create.mock.calls.map((c: any) => c[0].data);
    expect(outMoves).toHaveLength(2);
    expect(outMoves.every((m: any) => m.direction === StockDirection.OUT)).toBe(true);
    expect(outMoves.map((m: any) => m.quantity.toFixed(4))).toEqual(['3.0000', '10.0000']);
    // Average cost 375 / 50 = 7.5 per piece.
    expect(outMoves.map((m: any) => m.totalCost.toFixed(4))).toEqual(['22.5000', '75.0000']);
    // Two balance decrements matching the same base quantities (no double movement).
    const decrements = tx.stockBalance.update.mock.calls.map((c: any) =>
      c[0].data.quantity.decrement.toFixed(4),
    );
    expect(decrements).toEqual(['3.0000', '10.0000']);
  });
});

describe('Sales unit validation and legacy behaviour', () => {
  it('rejects an inactive unit on a new document', async () => {
    const { service } = makeService({
      ...milkItem,
      units: [milkItem.units[0], { ...milkItem.units[1], isActive: false }],
    });
    await expect(
      service.create(COMPANY, BRANCH, 'user-1', {
        ...baseDto,
        lines: [{ itemId: MILK, quantity: '1', unitName: 'كرتونة' }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown unit', async () => {
    const { service } = makeService();
    await expect(
      service.create(COMPANY, BRANCH, 'user-1', {
        ...baseDto,
        lines: [{ itemId: MILK, quantity: '1', unitName: 'بالته' }],
      } as any),
    ).rejects.toThrow(/not defined/);
  });

  it('a legacy line with no unit stores a null snapshot and keeps quantity as entered', async () => {
    const { service, tx } = makeService();
    await service.create(COMPANY, BRANCH, 'user-1', {
      ...baseDto,
      lines: [{ itemId: MILK, quantity: '5', unitPrice: '9' }],
    } as any);
    const line = tx.salesInvoice.create.mock.calls[0][0].data.lines.create[0];
    expect(line.quantity.toFixed(4)).toBe('5.0000');
    expect(line.unitName).toBeNull();
    expect(line.unitFactor).toBeNull();
    expect(line.unitQuantity).toBeNull();
    expect(line.grossLineTotal.toFixed(4)).toBe('45.0000');
  });
});
