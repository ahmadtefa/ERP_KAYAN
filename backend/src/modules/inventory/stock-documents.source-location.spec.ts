import { Prisma, StockDirection } from '@prisma/client';
import { StockDocumentsService } from './stock-documents.service';

const D = (v: string) => new Prisma.Decimal(v);
const service = Object.create(StockDocumentsService.prototype) as unknown as {
  assertSourceLocation(tx: unknown, input: Record<string, unknown>): Promise<void>;
};
const tx = (rows: Array<{ id: string; code: string; quantity: Prisma.Decimal }>) => ({ $queryRaw: jest.fn(async () => rows) });
const base = {
  companyId: 'c', itemId: 'i', direction: StockDirection.OUT, quantity: D('3'),
  referenceType: 'STOCK_WRITE_OFF', referenceNumber: 'WO-1', warehouseId: 'w',
};
const shelves = [{ id: 'A', code: 'A-01', quantity: D('4') }, { id: 'B', code: 'B-01', quantity: D('2') }];
const fail = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as { response?: { code?: string; message?: string } }).response; } return undefined; };

describe('stock document source location rule', () => {
  it('refuses a write-off with no shelf while the item has located stock, and names the shelves', async () => {
    const err = await fail(service.assertSourceLocation(tx(shelves), base));
    expect(err?.code).toBe('STOCK_DOC_LOCATION_REQUIRED');
    expect(String(err?.message)).toContain('A-01: 4.0000');
    expect(String(err?.message)).toContain('B-01: 2.0000');
  });
  it('refuses a named shelf that holds less, says what it holds and what is available', async () => {
    const err = await fail(service.assertSourceLocation(tx(shelves), { ...base, storageLocationId: 'B' }));
    expect(err?.code).toBe('STOCK_DOC_SHELF_SHORT');
    expect(String(err?.message)).toContain('2.0000');
  });
  it('accepts a named shelf that holds enough', async () => {
    await expect(service.assertSourceLocation(tx(shelves), { ...base, storageLocationId: 'A' })).resolves.toBeUndefined();
  });
  it('keeps the legacy behaviour for an item with no located stock, and for other kinds', async () => {
    await expect(service.assertSourceLocation(tx([]), base)).resolves.toBeUndefined();
    await expect(service.assertSourceLocation(tx(shelves), { ...base, referenceType: 'STOCK_COUNT' })).resolves.toBeUndefined();
    await expect(service.assertSourceLocation(tx(shelves), { ...base, direction: StockDirection.IN })).resolves.toBeUndefined();
  });
  it('applies to a transfer out too', async () => {
    const err = await fail(service.assertSourceLocation(tx(shelves), { ...base, referenceType: 'STOCK_TRANSFER_OUT' }));
    expect(err?.code).toBe('STOCK_DOC_LOCATION_REQUIRED');
  });
});
