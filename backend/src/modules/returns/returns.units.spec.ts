import { BadRequestException } from '@nestjs/common';
import {
  InvoiceDocumentType,
  InvoiceStatus,
  Prisma,
} from '@prisma/client';

import { ReturnsService } from './returns.service';

const D = (v: string | number) => new Prisma.Decimal(v);
const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';

function originalCartonLine(overrides: Record<string, any> = {}) {
  return {
    id: 'line-1',
    itemId: 'item-1',
    description: 'MILK كرتونة',
    // 5 cartons x 10 = 50 base pieces sold.
    quantity: D(50),
    returnedQuantity: D(0),
    returnedSubTotal: D(0),
    returnedTaxTotal: D(0),
    returnedCostTotal: D(0),
    unitPrice: D(97),
    taxRate: D(0),
    taxAmount: D(0),
    lineTotal: D(485),
    unitCost: D('7.5'),
    costTotal: D('375'),
    costCenterId: null,
    // Multi-unit snapshot of the original sale.
    unitName: 'كرتونة',
    unitFactor: D(10),
    unitQuantity: D(5),
    ...overrides,
  };
}

function makeService(originalLines: any[]) {
  const tx = {
    salesInvoice: {
      create: jest.fn(async ({ data }: { data: any }) => ({
        id: 'return-1',
        invoiceNumber: data.invoiceNumber,
        subTotal: data.subTotal,
        taxAmount: data.taxAmount,
        totalAmount: data.totalAmount,
      })),
    },
  };
  const prisma = {
    salesInvoice: {
      findFirst: jest.fn(async () => ({
        id: 'invoice-1',
        companyId: COMPANY,
        branchId: BRANCH,
        invoiceDate: new Date('2026-10-20T00:00:00Z'),
        status: InvoiceStatus.POSTED,
        documentType: InvoiceDocumentType.INVOICE,
        customerId: 'customer-1',
        currency: 'EGP',
        warehouseId: null,
        lines: originalLines,
      })),
    },
    $transaction: jest.fn(async (work: (client: unknown) => unknown) => work(tx)),
  };
  const numbers = { next: jest.fn(async () => 'SR-0001') };
  const service = new ReturnsService(
    prisma as never,
    numbers as never,
    {} as never,
    {} as never,
    { record: jest.fn(async () => undefined) } as never,
    {} as never,
  );
  jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'return-1' } as never);
  return { service, tx };
}

const baseReturnDto = {
  originalInvoiceId: 'invoice-1',
  returnDate: '2026-10-21',
  lines: [] as any[],
};

describe('Sales returns with multiple units', () => {
  it('returns one carton: restores 10 base pieces and keeps the carton snapshot', async () => {
    const { service, tx } = makeService([originalCartonLine()]);
    await service.createSalesReturn(COMPANY, BRANCH, 'user-1', {
      ...baseReturnDto,
      lines: [{ originalLineId: 'line-1', quantity: '1', unitName: 'كرتونة' }],
    } as any);

    const line = tx.salesInvoice.create.mock.calls[0][0].data.lines.create[0];
    // Internal base quantity restored is 10 (1 x factor 10).
    expect(line.quantity.toFixed(4)).toBe('10.0000');
    // Display snapshot preserved.
    expect(line.unitName).toBe('كرتونة');
    expect(line.unitFactor.toFixed(6)).toBe('10.000000');
    expect(line.unitQuantity.toFixed(4)).toBe('1.0000');
    // Money follows the original per-carton price.
    expect(line.unitPrice.toFixed(4)).toBe('97.0000');
  });

  it('rejects returning more cartons than the invoice sold (base-quantity limit)', async () => {
    const { service, tx } = makeService([originalCartonLine()]);
    await expect(
      service.createSalesReturn(COMPANY, BRANCH, 'user-1', {
        ...baseReturnDto,
        // 6 cartons = 60 base pieces > 50 sold.
        lines: [{ originalLineId: 'line-1', quantity: '6', unitName: 'كرتونة' }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.salesInvoice.create).not.toHaveBeenCalled();
  });

  it('allows a partial return of 2 cartons (20 base) against 50 sold', async () => {
    const { service, tx } = makeService([originalCartonLine()]);
    await service.createSalesReturn(COMPANY, BRANCH, 'user-1', {
      ...baseReturnDto,
      lines: [{ originalLineId: 'line-1', quantity: '2', unitName: 'كرتونة' }],
    } as any);
    const line = tx.salesInvoice.create.mock.calls[0][0].data.lines.create[0];
    expect(line.quantity.toFixed(4)).toBe('20.0000');
    expect(line.unitQuantity.toFixed(4)).toBe('2.0000');
  });

  it('rejects a return that names a different unit than the original document', async () => {
    const { service } = makeService([originalCartonLine()]);
    await expect(
      service.createSalesReturn(COMPANY, BRANCH, 'user-1', {
        ...baseReturnDto,
        lines: [{ originalLineId: 'line-1', quantity: '10', unitName: 'علبة' }],
      } as any),
    ).rejects.toThrow(/original document's unit/);
  });

  it('keeps a legacy original line (no snapshot) working with factor 1 and a null snapshot', async () => {
    const legacy = originalCartonLine({
      unitName: null,
      unitFactor: null,
      unitQuantity: null,
      quantity: D(12),
      lineTotal: D(108),
      unitPrice: D(9),
    });
    const { service, tx } = makeService([legacy]);
    await service.createSalesReturn(COMPANY, BRANCH, 'user-1', {
      ...baseReturnDto,
      lines: [{ originalLineId: 'line-1', quantity: '3' }],
    } as any);
    const line = tx.salesInvoice.create.mock.calls[0][0].data.lines.create[0];
    expect(line.quantity.toFixed(4)).toBe('3.0000');
    expect(line.unitName).toBeNull();
    expect(line.unitFactor).toBeNull();
    expect(line.unitQuantity).toBeNull();
  });
});
