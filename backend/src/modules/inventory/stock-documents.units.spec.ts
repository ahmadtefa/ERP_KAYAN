import { BadRequestException } from '@nestjs/common';
import { Prisma, StockDocumentKind } from '@prisma/client';

import { StockDocumentsService } from './stock-documents.service';

const D = (v: string | number) => new Prisma.Decimal(v);
const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const MILK = '33333333-3333-4333-8333-333333333333';

const milkItem = {
  id: MILK,
  code: 'MILK',
  isStockTracked: true,
  unit: 'علبة',
  units: [
    { id: 'u-piece', unit: 'علبة', factor: D(1), isActive: true },
    { id: 'u-carton', unit: 'كرتونة', factor: D(10), isActive: true },
  ],
};

function makeService(item: any = milkItem) {
  const tx = {
    stockDocument: {
      create: jest.fn(async ({ data }: { data: any }) => ({
        id: 'doc-1',
        documentNumber: data.documentNumber,
      })),
    },
  };
  const prisma = {
    item: { findFirst: jest.fn(async () => item) },
    stockDocument: { findFirst: jest.fn() },
    $transaction: jest.fn(async (work: (client: unknown) => unknown) => work(tx)),
  };
  const service = new StockDocumentsService(
    prisma as never,
    { next: jest.fn(async () => 'ST-0001') } as never,
    {} as never,
    {} as never,
    { record: jest.fn(async () => undefined) } as never,
    { get: jest.fn() } as never,
    {} as never,
    { assertPostable: jest.fn() } as never,
  );
  jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'doc-1' } as never);
  return { service, tx };
}

describe('stock documents with multiple units', () => {
  it('a transfer of 2 cartons stores 20 base pieces while keeping the carton snapshot', async () => {
    const { service, tx } = makeService();
    await service.create(COMPANY, BRANCH, 'user-1', {
      kind: StockDocumentKind.TRANSFER,
      fromBranchId: '44444444-4444-4444-8444-444444444444',
      branchId: BRANCH,
      documentDate: '2026-10-27',
      lines: [{ itemId: MILK, quantity: '2', unitName: 'كرتونة' }],
    } as any);

    const line = tx.stockDocument.create.mock.calls[0][0].data.lines.create[0];
    expect(line.quantity.toFixed(4)).toBe('20.0000');
    expect(line.unitName).toBe('كرتونة');
    expect(line.unitFactor.toFixed(6)).toBe('10.000000');
    expect(line.unitQuantity.toFixed(4)).toBe('2.0000');
  });

  it('rejects a negative transfer even when its unit conversion is valid', async () => {
    const { service, tx } = makeService();
    await expect(service.create(COMPANY, BRANCH, 'user-1', {
      kind: StockDocumentKind.TRANSFER,
      fromBranchId: '44444444-4444-4444-8444-444444444444',
      branchId: BRANCH,
      documentDate: '2026-10-27',
      lines: [{ itemId: MILK, quantity: '-2', unitName: 'كرتونة' }],
    } as any)).rejects.toThrow(/transfer quantity must be positive/);
    expect(tx.stockDocument.create).not.toHaveBeenCalled();
  });

  it('a negative adjustment converts the magnitude and restores the minus sign', async () => {
    const { service, tx } = makeService();
    await service.create(COMPANY, BRANCH, 'user-1', {
      kind: StockDocumentKind.ADJUSTMENT,
      branchId: BRANCH,
      documentDate: '2026-10-27',
      lines: [{ itemId: MILK, quantity: '-1', unitName: 'كرتونة' }],
    } as any);

    const line = tx.stockDocument.create.mock.calls[0][0].data.lines.create[0];
    expect(line.quantity.toFixed(4)).toBe('-10.0000');
    expect(line.unitQuantity.toFixed(4)).toBe('-1.0000');
  });

  it('rejects an inactive unit on a new stock document', async () => {
    const { service } = makeService({
      ...milkItem,
      units: [milkItem.units[0], { ...milkItem.units[1], isActive: false }],
    });
    await expect(
      service.create(COMPANY, BRANCH, 'user-1', {
        kind: StockDocumentKind.ADJUSTMENT,
        branchId: BRANCH,
        documentDate: '2026-10-27',
        lines: [{ itemId: MILK, quantity: '1', unitName: 'كرتونة' }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a legacy line without a unit keeps its base quantity and a null snapshot', async () => {
    const { service, tx } = makeService();
    await service.create(COMPANY, BRANCH, 'user-1', {
      kind: StockDocumentKind.ADJUSTMENT,
      branchId: BRANCH,
      documentDate: '2026-10-27',
      lines: [{ itemId: MILK, quantity: '7' }],
    } as any);
    const line = tx.stockDocument.create.mock.calls[0][0].data.lines.create[0];
    expect(line.quantity.toFixed(4)).toBe('7.0000');
    expect(line.unitName).toBeNull();
    expect(line.unitFactor).toBeNull();
    expect(line.unitQuantity).toBeNull();
  });
});
