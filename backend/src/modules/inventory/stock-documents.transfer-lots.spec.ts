import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { fakeLedger } from '../../testing/stock-ledger.fake';

import { StockDocumentsService } from './stock-documents.service';

const D = (value: string | number) => new Prisma.Decimal(value);
const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const FROM = '33333333-3333-4333-8333-333333333333';
const TO = '44444444-4444-4444-8444-444444444444';
const ITEM = '55555555-5555-4555-8555-555555555555';

/// Carrying the lots with the goods on a warehouse transfer.
///
/// The defect this holds shut: a document transfer moved the shelf's quantity
/// and left every lot behind, so the source lot went on claiming goods that had
/// already left and the destination held stock no lot could account for - which
/// a later issue then refused, on a shelf that visibly showed the goods.
describe('lots on a document transfer', () => {
  type Lot = Record<string, any>;

  function makeService(sourceLots: Lot[], destinationLots: Lot[] = []) {
    const state = { lots: [...sourceLots, ...destinationLots] };
    let sequence = 0;

    const tx: any = {
      itemBatch: {
        findMany: jest.fn(async ({ where }: any) =>
          state.lots.filter(
            (lot) =>
              lot.warehouseId === where.warehouseId &&
              lot.itemId === where.itemId &&
              Number(lot.remainingQuantity) > 0 &&
              (!where.id || lot.id === where.id),
          ),
        ),
        findFirst: jest.fn(async ({ where }: any) =>
          state.lots.find(
            (lot) =>
              lot.warehouseId === where.warehouseId &&
              lot.itemId === where.itemId &&
              lot.batchNumber === where.batchNumber,
          ) ?? null,
        ),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `lot-new-${++sequence}`, ...data };
          state.lots.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = state.lots.find((lot) => lot.id === where.id);
          if (!row) throw new Error('lot not found');
          if (data.receivedQuantity?.increment) {
            row.receivedQuantity = row.receivedQuantity.plus(data.receivedQuantity.increment);
          }
          if (data.remainingQuantity?.increment) {
            row.remainingQuantity = row.remainingQuantity.plus(data.remainingQuantity.increment);
          }
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const row = state.lots.find((lot) => lot.id === where.id);
          if (!row) return { count: 0 };
          const minimum = where.remainingQuantity?.gte;
          if (minimum !== undefined && row.remainingQuantity.lessThan(minimum)) {
            return { count: 0 };
          }
          if (data.remainingQuantity?.decrement) {
            row.remainingQuantity = row.remainingQuantity.minus(data.remainingQuantity.decrement);
          }
          return { count: 1 };
        }),
      },
      $executeRaw: jest.fn(async () => 1),
    };

    const service = new StockDocumentsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      fakeLedger() as never,
    );

    const move = (quantity: string | number, batchId: string | null = null) =>
      (service as any).moveLots(tx, {
        companyId: COMPANY,
        userId: 'user-1',
        itemId: ITEM,
        fromWarehouseId: FROM,
        toWarehouseId: TO,
        toBranchId: BRANCH,
        quantity: D(quantity),
        batchId,
        date: new Date('2026-11-01T00:00:00.000Z'),
        referenceNumber: 'TR-2026-0001',
      }) as Promise<Prisma.Decimal>;

    return { service, tx, state, move };
  }

  const lot = (overrides: Lot): Lot => ({
    id: 'lot-1',
    companyId: COMPANY,
    branchId: BRANCH,
    warehouseId: FROM,
    itemId: ITEM,
    batchNumber: 'LOT-A',
    productionDate: new Date('2026-10-01T00:00:00.000Z'),
    expiryDate: new Date('2027-10-01T00:00:00.000Z'),
    receivedQuantity: D('10'),
    remainingQuantity: D('10'),
    unitCost: D('12'),
    status: 'OPEN',
    ...overrides,
  });

  it('takes the goods out of the source lot and creates the destination lot at the same cost', async () => {
    const { state, move } = makeService([lot({})]);

    const moved = await move(4);

    expect(moved.toFixed(4)).toBe('4.0000');
    expect(state.lots[0].remainingQuantity.toFixed(4)).toBe('6.0000');
    const arrived = state.lots[1];
    expect(arrived).toMatchObject({
      companyId: COMPANY,
      branchId: BRANCH,
      warehouseId: TO,
      itemId: ITEM,
      batchNumber: 'LOT-A',
      status: 'OPEN',
      sourceType: 'BATCH_TRANSFER',
      sourceNumber: 'TR-2026-0001',
    });
    expect(arrived.remainingQuantity.toFixed(4)).toBe('4.0000');
    expect(arrived.receivedQuantity.toFixed(4)).toBe('4.0000');
    // The goods did not change what they cost by being carried to the next
    // store: the destination re-averages with the figure they arrived at.
    expect(arrived.unitCost.toFixed(4)).toBe('12.0000');
    expect(arrived.expiryDate).toEqual(new Date('2027-10-01T00:00:00.000Z'));
  });

  it('adds to a destination lot that already carries the same number, instead of copying it', async () => {
    const { state, move } = makeService(
      [lot({})],
      [lot({ id: 'lot-in-to', warehouseId: TO, receivedQuantity: D('5'), remainingQuantity: D('5') })],
    );

    await move(3);

    expect(state.lots).toHaveLength(2);
    expect(state.lots[1].remainingQuantity.toFixed(4)).toBe('8.0000');
    expect(state.lots[1].receivedQuantity.toFixed(4)).toBe('8.0000');
  });

  it('takes the soonest expiry first and splits a transfer across two lots', async () => {
    const { state, move } = makeService([
      lot({ id: 'lot-later', batchNumber: 'LOT-LATER', expiryDate: new Date('2028-01-01T00:00:00.000Z'), remainingQuantity: D('10') }),
      lot({ id: 'lot-sooner', batchNumber: 'LOT-SOONER', expiryDate: new Date('2026-12-01T00:00:00.000Z'), remainingQuantity: D('6') }),
    ]);

    const moved = await move(8);

    expect(moved.toFixed(4)).toBe('8.0000');
    const sooner = state.lots.find((row) => row.id === 'lot-sooner');
    const later = state.lots.find((row) => row.id === 'lot-later');
    expect(sooner.remainingQuantity.toFixed(4)).toBe('0.0000');
    expect(later.remainingQuantity.toFixed(4)).toBe('8.0000');
    const arrived = state.lots.filter((row) => row.warehouseId === TO);
    expect(arrived.map((row: Lot) => row.batchNumber).sort()).toEqual(['LOT-LATER', 'LOT-SOONER']);
  });

  it('moves nothing when the shelf has no lots, and invents none', async () => {
    const { state, move, tx } = makeService([]);

    const moved = await move(5);

    expect(moved.toFixed(4)).toBe('0.0000');
    expect(state.lots).toHaveLength(0);
    expect(tx.itemBatch.create).not.toHaveBeenCalled();
  });

  it('moves only part of the quantity when the lots cannot cover it, and never invents the rest', async () => {
    const { state, move } = makeService([lot({ remainingQuantity: D('3') })]);

    const moved = await move(5);

    expect(moved.toFixed(4)).toBe('3.0000');
    const arrived = state.lots.find((row) => row.warehouseId === TO);
    expect(arrived.remainingQuantity.toFixed(4)).toBe('3.0000');
  });

  it('restricts the move to the lot the line names', async () => {
    const { state, move } = makeService([
      lot({ id: 'lot-a', batchNumber: 'LOT-A', remainingQuantity: D('5') }),
      lot({ id: 'lot-b', batchNumber: 'LOT-B', remainingQuantity: D('5') }),
    ]);

    const moved = await move(4, 'lot-b');

    expect(moved.toFixed(4)).toBe('4.0000');
    expect(state.lots.find((row) => row.id === 'lot-a').remainingQuantity.toFixed(4)).toBe('5.0000');
    expect(state.lots.find((row) => row.warehouseId === TO).batchNumber).toBe('LOT-B');
  });

  it('refuses rather than half-moving when the lot changed underneath it', async () => {
    const { tx, move } = makeService([lot({})]);
    tx.itemBatch.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(move(4)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.itemBatch.create).not.toHaveBeenCalled();
  });
});
