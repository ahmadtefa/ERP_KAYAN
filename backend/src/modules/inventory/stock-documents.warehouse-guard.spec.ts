import { AsyncLocalStorage } from 'node:async_hooks';

import { BadRequestException } from '@nestjs/common';
import {
  InvoiceStatus,
  Prisma,
  StockDocumentKind,
  StockDirection,
} from '@prisma/client';

import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { StockDocumentsService } from './stock-documents.service';

const D = (v: string | number) => new Prisma.Decimal(v);
const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const BRANCH_2 = '22222222-2222-4222-8222-222222222223';
const W_SRC = '55555555-5555-4555-8555-555555555555';
const W_DST = '66666666-6666-4666-8666-666666666666';
const MILK = '77777777-7777-4777-8777-777777777777';

type Movement = {
  warehouseId: string | null;
  itemId: string;
  branchId: string;
  direction: StockDirection;
  quantity: Prisma.Decimal;
  totalCost: Prisma.Decimal;
  referenceType: string;
  _txn?: number;
};

/**
 * In-memory simulator (not PostgreSQL). stock_movements are the source of truth for
 * per-warehouse availability (exactly like the real schema, where
 * stock_balances has no warehouse dimension). Transaction semantics:
 *  - $transaction rolls back only the rows/deltas its own callback created,
 *    so concurrent transactions never undo each other's committed work;
 *  - a per-warehouse promise chain emulates SELECT ... FOR UPDATE: the second
 *    posting blocks until the first releases, then re-reads availability.
 */
function makeHarness(seed: Movement[], allowNegativeStock: boolean) {
  const movements: Movement[] = seed.map((m) => ({ ...m }));
  const branchBalance = new Map<string, Prisma.Decimal>([
    [BRANCH, D(seed.filter((m) => m.branchId === BRANCH).reduce((s, m) => s + Number(m.quantity), 0))],
    [BRANCH_2, D(seed.filter((m) => m.branchId === BRANCH_2).reduce((s, m) => s + Number(m.quantity), 0))],
  ]);
  // Strict FIFO mutex emulating SELECT ... FOR UPDATE per warehouse.
  const lockHeld = new Set<string>();
  const lockQueues = new Map<string, Array<() => void>>();
  const txnLocks = new Map<number, string[]>();
  const acquireLock = async (warehouseId: string): Promise<void> => {
    const txnId = txnStore.getStore() ?? 0;
    // PostgreSQL permits a transaction to lock the same row more than once.
    if ((txnLocks.get(txnId) ?? []).includes(warehouseId)) return;
    if (!lockHeld.has(warehouseId)) {
      lockHeld.add(warehouseId);
      lockQueues.set(warehouseId, []);
      txnLocks.set(txnId, [...(txnLocks.get(txnId) ?? []), warehouseId]);
      return;
    }
    await new Promise<void>((resolve) => lockQueues.get(warehouseId)!.push(resolve));
    txnLocks.set(txnId, [...(txnLocks.get(txnId) ?? []), warehouseId]);
  };
  const releaseLock = (warehouseId: string) => {
    const queue = lockQueues.get(warehouseId);
    if (queue && queue.length) queue.shift()!();
    else lockHeld.delete(warehouseId);
  };
  // Tags every write with the logical transaction that owns it, even when two
  // postings interleave on the microtask queue (AsyncLocalStorage context).
  const txnStore = new AsyncLocalStorage<number>();
  const txnDeltas = new Map<number, Prisma.Decimal>();
  let txnSeq = 0;
  let failOnMovementCall: number | null = null;
  let movementCallCount = 0;
  const movementCreate = jest.fn(async ({ data }: { data: Movement }) => {
    movementCallCount += 1;
    if (failOnMovementCall === movementCallCount) {
      throw new Error('simulated movement failure');
    }
    movements.push({ ...data, _txn: txnStore.getStore() ?? 0 });
    return { id: `m-${movements.length}` };
  });
  const recordDelta = (delta: Prisma.Decimal) => {
    const txnId = txnStore.getStore() ?? 0;
    txnDeltas.set(txnId, (txnDeltas.get(txnId) ?? D(0)).plus(delta));
  };

  const warehouseQuantity = (warehouseId: string, itemId: string) =>
    movements
      .filter((m) => m.warehouseId === warehouseId && m.itemId === itemId)
      .reduce((sum, m) => sum.plus(m.direction === StockDirection.IN ? m.quantity : m.quantity.negated()), D(0));

  const tx = {
    stockDocument: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => ({})),
      create: jest.fn(async ({ data }: { data: unknown }) => ({
        id: 'doc-1',
        documentNumber: (data as { documentNumber: string }).documentNumber,
      })),
    },
    warehouse: {
      // Default: both warehouses belong to BRANCH. Test 5 swaps this mock to
      // place W_SRC in BRANCH_2 for the cross-branch scenario.
      findFirst: jest.fn(async ({ where }: { where: { id?: string; branchId?: string } }) => ({
        id: where.id ?? W_SRC,
        branchId: where.branchId ?? BRANCH,
        isActive: true,
        code: 'WH',
      })),
    },
    stockMovement: { create: movementCreate },
    stockBalance: {
      update: jest.fn(async ({ data }: { data: { quantity?: { decrement: Prisma.Decimal } } }) => {
        const dec = data.quantity?.decrement ?? D(0);
        branchBalance.set(BRANCH, (branchBalance.get(BRANCH) ?? D(0)).minus(dec));
        recordDelta(dec.negated());
        return {};
      }),
      // Prisma upsert args are { where, create, update } (no data wrapper).
      upsert: jest.fn(
        async (arg: {
          create?: { quantity: Prisma.Decimal };
          update?: { quantity: { increment: Prisma.Decimal } };
        }) => {
          const inc = arg.update?.quantity.increment ?? arg.create?.quantity ?? D(0);
          branchBalance.set(BRANCH, (branchBalance.get(BRANCH) ?? D(0)).plus(inc));
          recordDelta(inc);
          return {};
        },
      ),
    },
    stockDocumentLine: { update: jest.fn(async () => ({})) },
    $queryRaw: jest.fn(async (query: Prisma.Sql) => {
      const text = query.sql.replace(/"/g, '');
      const values = query.values as unknown[];
      if (text.includes('FROM warehouses')) {
        const warehouseId = String(values[0]);
        await acquireLock(warehouseId);
        return [{ id: warehouseId }];
      }
      if (text.includes('FROM stock_movements')) {
        // Template order: companyId, warehouseId, itemId
        return [{ quantity: warehouseQuantity(String(values[1]), String(values[2])) }];
      }
      if (text.includes('FROM stock_balances')) {
        // Template order: companyId, branchId, itemId
        const branchId = String(values[1]);
        const qty = branchBalance.get(branchId) ?? D(0);
        return [{ quantity: qty, value: qty.mul(7.5) }];
      }
      throw new Error(`unexpected raw query: ${text}`);
    }),
  };

  const prisma = {
    $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) => {
      const txnId = ++txnSeq;
      return txnStore.run(txnId, async () => {
        try {
          return await work(tx);
        } catch (e) {
          // Roll back only this transaction's writes, like a real DB rollback.
          for (let i = movements.length - 1; i >= 0; i -= 1) {
            if (movements[i]._txn === txnId) movements.splice(i, 1);
          }
          const delta = txnDeltas.get(txnId);
          if (delta) branchBalance.set(BRANCH, (branchBalance.get(BRANCH) ?? D(0)).minus(delta));
          txnDeltas.delete(txnId);
          throw e;
        } finally {
          for (const warehouseId of txnLocks.get(txnId) ?? []) releaseLock(warehouseId);
          txnLocks.delete(txnId);
        }
      });
    }),
    stockDocument: { findFirst: jest.fn() },
    item: {
      findFirst: jest.fn(async ({ where }: { where: { id?: string } }) =>
        where.id
          ? {
              id: where.id,
              code: 'MILK',
              isStockTracked: true,
              unit: 'علبة',
              units: [
                { id: 'u-piece', unit: 'علبة', factor: D(1), isActive: true },
                { id: 'u-carton', unit: 'كرتونة', factor: D(10), isActive: true },
              ],
            }
          : null,
      ),
    },
  };

  const warehouses = new WarehouseService({} as never, {} as never);
  const settings = { get: jest.fn(async () => ({ allowNegativeStock })) };
  const service = new StockDocumentsService(
    prisma as never,
    { next: jest.fn(async () => 'ST-000001') } as never,
    { post: jest.fn(async () => ({ id: 'j1', entryNumber: 'JE-1' })) } as never,
    {
      resolve: jest.fn(async () => ({ inventory: 'acct-inv', inventoryDifference: 'acct-diff' })),
    } as never,
    { record: jest.fn(async () => undefined) } as never,
    settings as never,
    warehouses,
    { assertPostable: jest.fn() } as never,
  );
  jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'doc-1' } as never);

  return {
    service,
    prisma,
    tx,
    state: {
      movements: () => movements,
      warehouseQuantity: (w: string) => warehouseQuantity(w, MILK),
      branchBalance: (b = BRANCH) => branchBalance.get(b) ?? D(0),
      movementCreates: movementCreate,
    },
    controls: {
      failSecondMovement: () => {
        failOnMovementCall = 2;
      },
    },
  };
}

function seedMovement(warehouseId: string, branchId: string, quantity: number): Movement {
  return {
    warehouseId,
    branchId,
    itemId: MILK,
    direction: StockDirection.IN,
    quantity: D(quantity),
    totalCost: D(quantity * 7.5),
    referenceType: 'SEED',
  };
}

function transferDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 'doc-1',
    companyId: COMPANY,
    status: InvoiceStatus.DRAFT,
    kind: StockDocumentKind.TRANSFER,
    documentNumber: 'ST-000001',
    documentDate: new Date('2026-10-28T00:00:00.000Z'),
    branchId: BRANCH,
    fromBranchId: BRANCH,
    fromWarehouseId: W_SRC,
    toWarehouseId: W_DST,
    costCenterId: null,
    reason: null,
    lines: [{ id: 'l1', itemId: MILK, quantity: D(5), unitCost: D(7.5) }],
    ...overrides,
  };
}

describe('warehouse-level negative stock guard on transfer posting', () => {
  it('1. sufficient stock: 20 in source, move 5 -> source 15, destination +5, two movements', async () => {
    const h = makeHarness([seedMovement(W_SRC, BRANCH, 20)], false);
    h.prisma.stockDocument.findFirst.mockResolvedValue(transferDocument());

    await h.service.post(COMPANY, 'user-1', 'doc-1');

    expect(h.state.movements()).toHaveLength(3); // seed + OUT + IN
    expect(h.state.warehouseQuantity(W_SRC).toFixed(4)).toBe('15.0000');
    expect(h.state.warehouseQuantity(W_DST).toFixed(4)).toBe('5.0000');
    expect(h.state.branchBalance().toFixed(4)).toBe('20.0000'); // branch total preserved
    const refs = h.state.movements().slice(-2).map((m) => m.referenceType);
    expect(refs).toEqual(['STOCK_TRANSFER_OUT', 'STOCK_TRANSFER_IN']);
  });

  it('2. insufficient warehouse stock (4 vs 5) is rejected and leaves no movement or balance change', async () => {
    const h = makeHarness([seedMovement(W_SRC, BRANCH, 4), seedMovement(W_DST, BRANCH, 16)], false);
    h.prisma.stockDocument.findFirst.mockResolvedValue(transferDocument());

    await expect(h.service.post(COMPANY, 'user-1', 'doc-1')).rejects.toBeInstanceOf(BadRequestException);

    expect(h.state.movements()).toHaveLength(2); // both seeds remain, nothing added
    expect(h.state.warehouseQuantity(W_SRC).toFixed(4)).toBe('4.0000');
    expect(h.state.warehouseQuantity(W_DST).toFixed(4)).toBe('16.0000');
    expect(h.state.branchBalance().toFixed(4)).toBe('20.0000');
    expect(h.state.movementCreates).not.toHaveBeenCalled();
  });

  it('3. allowNegativeStock=true keeps the permissive behaviour at warehouse level', async () => {
    // The branch holds 5 in another warehouse; the source warehouse is empty.
    // With negatives permitted the posting succeeds and drives the source to -5.
    const h = makeHarness([seedMovement(W_DST, BRANCH, 5)], true);
    h.prisma.stockDocument.findFirst.mockResolvedValue(transferDocument());

    await h.service.post(COMPANY, 'user-1', 'doc-1');

    expect(h.state.warehouseQuantity(W_SRC).toFixed(4)).toBe('-5.0000');
    expect(h.state.warehouseQuantity(W_DST).toFixed(4)).toBe('10.0000');
    expect(h.state.movements()).toHaveLength(3);
  });

  it('4. two warehouses of the same branch are checked independently (the reported defect)', async () => {
    const h = makeHarness([seedMovement(W_SRC, BRANCH, 4), seedMovement(W_DST, BRANCH, 16)], false);
    h.prisma.stockDocument.findFirst.mockResolvedValue(transferDocument());

    // Branch total is 20 and covered 5 before the fix; the source holds only 4.
    await expect(h.service.post(COMPANY, 'user-1', 'doc-1')).rejects.toThrow(/selected warehouse/);
    expect(h.state.warehouseQuantity(W_SRC).toFixed(4)).toBe('4.0000');

    // A feasible transfer of 4 succeeds and touches only its two warehouses.
    h.prisma.stockDocument.findFirst.mockResolvedValue(
      transferDocument({
        id: 'doc-2',
        documentNumber: 'ST-000002',
        lines: [{ id: 'l2', itemId: MILK, quantity: D(4), unitCost: D(7.5) }],
      }),
    );
    await h.service.post(COMPANY, 'user-1', 'doc-2');
    expect(h.state.warehouseQuantity(W_SRC).toFixed(4)).toBe('0.0000');
    expect(h.state.warehouseQuantity(W_DST).toFixed(4)).toBe('20.0000');
  });

  it('5. cross-branch transfer is guarded on the resolved source warehouse', async () => {
    const h = makeHarness([seedMovement(W_SRC, BRANCH_2, 10)], false);
    h.tx.warehouse.findFirst.mockImplementation(
      async ({ where }: { where: { id?: string; branchId?: string } }) => ({
        id: where.id ?? W_SRC,
        branchId: where.branchId ?? (where.id === W_SRC ? BRANCH_2 : BRANCH),
        isActive: true,
        code: where.id === W_SRC ? 'WH2' : 'WH',
      }),
    );
    h.prisma.stockDocument.findFirst.mockResolvedValue(
      transferDocument({
        fromBranchId: BRANCH_2,
        lines: [{ id: 'l1', itemId: MILK, quantity: D(3), unitCost: D(7.5) }],
      }),
    );

    await h.service.post(COMPANY, 'user-1', 'doc-1');
    expect(h.state.warehouseQuantity(W_SRC).toFixed(4)).toBe('7.0000');
    expect(h.state.warehouseQuantity(W_DST).toFixed(4)).toBe('3.0000');
  });

  it('6. non-base units are compared in base units (2 cartons = 20 pieces)', async () => {
    const h = makeHarness([seedMovement(W_SRC, BRANCH, 20)], false);
    h.prisma.stockDocument.findFirst.mockResolvedValue(
      transferDocument({
        lines: [
          { id: 'l1', itemId: MILK, quantity: D(20), unitCost: D(7.5), unitName: 'كرتونة', unitFactor: D(10), unitQuantity: D(2) },
        ],
      }),
    );
    await h.service.post(COMPANY, 'user-1', 'doc-1');
    expect(h.state.warehouseQuantity(W_SRC).toFixed(4)).toBe('0.0000');

    const h2 = makeHarness([seedMovement(W_SRC, BRANCH, 20)], false);
    h2.prisma.stockDocument.findFirst.mockResolvedValue(
      transferDocument({
        documentNumber: 'ST-000009',
        lines: [
          { id: 'l1', itemId: MILK, quantity: D(25), unitCost: D(7.5), unitName: 'كرتونة', unitFactor: D(10), unitQuantity: D(2.5) },
        ],
      }),
    );
    await expect(h2.service.post(COMPANY, 'user-1', 'doc-9')).rejects.toBeInstanceOf(BadRequestException);
    expect(h2.state.warehouseQuantity(W_SRC).toFixed(4)).toBe('20.0000');
  });

  it('7. a transfer onto the same warehouse is refused at creation (no movements)', async () => {
    const h = makeHarness([seedMovement(W_SRC, BRANCH, 20)], false);
    await expect(
      h.service.create(COMPANY, BRANCH, 'user-1', {
        kind: StockDocumentKind.TRANSFER,
        branchId: BRANCH,
        fromBranchId: BRANCH,
        fromWarehouseId: W_SRC,
        toWarehouseId: W_SRC,
        documentDate: '2026-10-28',
        lines: [{ itemId: MILK, quantity: '5' }],
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.state.movementCreates).not.toHaveBeenCalled();
  });

  it('8. reposting a non-draft document is refused before any transaction work', async () => {
    const h = makeHarness([seedMovement(W_SRC, BRANCH, 20)], false);
    h.prisma.stockDocument.findFirst.mockResolvedValue(transferDocument({ status: InvoiceStatus.POSTED }));

    await expect(h.service.post(COMPANY, 'user-1', 'doc-1')).rejects.toThrow(/draft/);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(h.state.movements()).toHaveLength(1);
  });

  it('9. a failure mid-posting rolls the whole transfer back (no half transfer)', async () => {
    const h = makeHarness([seedMovement(W_SRC, BRANCH, 20)], false);
    h.controls.failSecondMovement();
    h.prisma.stockDocument.findFirst.mockResolvedValue(transferDocument());

    await expect(h.service.post(COMPANY, 'user-1', 'doc-1')).rejects.toThrow(/simulated/);
    expect(h.state.movements()).toHaveLength(1); // seed only; the OUT was rolled back too
    expect(h.state.warehouseQuantity(W_SRC).toFixed(4)).toBe('20.0000');
    expect(h.state.warehouseQuantity(W_DST).toFixed(4)).toBe('0.0000');
    expect(h.state.branchBalance().toFixed(4)).toBe('20.0000');
  });

  it('10. two concurrent transfers of 7 from a warehouse holding 10 cannot both succeed', async () => {
    const h = makeHarness([seedMovement(W_SRC, BRANCH, 10)], false);
    const line7 = { id: 'l1', itemId: MILK, quantity: D(7), unitCost: D(7.5) };
    h.prisma.stockDocument.findFirst
      .mockResolvedValueOnce(
        transferDocument({ id: 'doc-a', documentNumber: 'ST-000010', lines: [line7] }),
      )
      .mockResolvedValueOnce(
        transferDocument({ id: 'doc-b', documentNumber: 'ST-000011', lines: [line7] }),
      );

    const [first, second] = await Promise.allSettled([
      h.service.post(COMPANY, 'user-1', 'doc-a'),
      h.service.post(COMPANY, 'user-1', 'doc-b'),
    ]);

    const outcomes = [first, second].map((r) => r.status);
    expect(outcomes).toContain('fulfilled');
    expect(outcomes).toContain('rejected');
    expect(h.state.warehouseQuantity(W_SRC).toFixed(4)).toBe('3.0000'); // 10 - 7, never negative
    expect(h.state.warehouseQuantity(W_DST).toFixed(4)).toBe('7.0000');
    expect(h.state.movements().filter((m) => m.referenceType.startsWith('STOCK_TRANSFER'))).toHaveLength(2);
    const rejected = [first, second].find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(BadRequestException);
  });

  it('11. a negative adjustment beyond the named warehouse is blocked when negatives are disallowed', async () => {
    const h = makeHarness([seedMovement(W_DST, BRANCH, 3), seedMovement(W_SRC, BRANCH, 17)], false);
    h.prisma.stockDocument.findFirst.mockResolvedValue({
      ...transferDocument({
        kind: StockDocumentKind.ADJUSTMENT,
        fromBranchId: null,
        fromWarehouseId: null,
        toWarehouseId: W_DST,
        lines: [{ id: 'l1', itemId: MILK, quantity: D(-5), unitCost: D(7.5) }],
      }),
    });

    await expect(h.service.post(COMPANY, 'user-1', 'doc-1')).rejects.toThrow(/selected warehouse/);
    expect(h.state.warehouseQuantity(W_DST).toFixed(4)).toBe('3.0000');
  });

  it('12. a COUNT document keeps reconciliation semantics and is not warehouse-gated', async () => {
    const h = makeHarness([seedMovement(W_DST, BRANCH, 3), seedMovement(W_SRC, BRANCH, 17)], false);
    h.prisma.stockDocument.findFirst.mockResolvedValue({
      ...transferDocument({
        kind: StockDocumentKind.COUNT,
        fromBranchId: null,
        fromWarehouseId: null,
        toWarehouseId: W_DST,
        lines: [{ id: 'l1', itemId: MILK, quantity: D(0), countedQuantity: D(2), unitCost: D(7.5) }],
      }),
    });

    await h.service.post(COMPANY, 'user-1', 'doc-1'); // counting 2 where the warehouse shows 3
    expect(h.state.movements().some((m) => m.referenceType === 'STOCK_COUNT')).toBe(true);

    // The count is of the place named on it. The branch holds 20 (17 in the
    // other warehouse, 3 here), so measuring the difference against the branch
    // would post 2 - 20 = -18 out of a warehouse that only ever held 3, and
    // would move stock nobody counted. The figure compared with is this
    // warehouse's own card, exactly as the difference report states it.
    const countMovement = h.state.movements().find((m) => m.referenceType === 'STOCK_COUNT') as
      | { quantity: Prisma.Decimal; direction: string }
      | undefined;
    expect(countMovement?.direction).toBe('OUT');
    expect(countMovement?.quantity.toFixed(4)).toBe('1.0000');
    expect(h.state.warehouseQuantity(W_DST).toFixed(4)).toBe('2.0000');
    expect(h.state.branchBalance().toFixed(4)).toBe('19.0000');
  });
});

describe('warehouse-level stock guard on reversal', () => {
  const posted = (overrides: Record<string, unknown> = {}) =>
    transferDocument({ status: InvoiceStatus.POSTED, journalEntryId: null, ...overrides });

  it('refuses to post or automatically reverse legacy transfers with negative quantities', async () => {
    const h = makeHarness([seedMovement(W_SRC, BRANCH, 20)], false);
    const lines = [{ id: 'l1', itemId: MILK, quantity: D(-5), unitCost: D(7.5) }];
    h.prisma.stockDocument.findFirst.mockResolvedValue(transferDocument({ lines }));
    await expect(h.service.post(COMPANY, 'user-1', 'doc-1')).rejects.toThrow(/quantities must be positive/);
    h.prisma.stockDocument.findFirst.mockResolvedValue(posted({ lines }));
    await expect(h.service.reverse(COMPANY, 'user-1', 'doc-1')).rejects.toThrow(/negative quantities/);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(h.state.movementCreates).not.toHaveBeenCalled();
  });

  it('rejects a transfer reversal when destination stock was consumed despite sufficient branch stock', async () => {
    const h = makeHarness([seedMovement(W_SRC, BRANCH, 17), seedMovement(W_DST, BRANCH, 3)], false);
    h.prisma.stockDocument.findFirst.mockResolvedValue(posted());
    await expect(h.service.reverse(COMPANY, 'user-1', 'doc-1')).rejects.toThrow(/selected warehouse/);
    expect(h.state.warehouseQuantity(W_SRC).toFixed(4)).toBe('17.0000');
    expect(h.state.warehouseQuantity(W_DST).toFixed(4)).toBe('3.0000');
    expect(h.state.movementCreates).not.toHaveBeenCalled();
  });

  it('reverses an affordable transfer into the original source', async () => {
    const h = makeHarness([seedMovement(W_SRC, BRANCH, 12), seedMovement(W_DST, BRANCH, 8)], false);
    h.prisma.stockDocument.findFirst.mockResolvedValue(posted());
    await h.service.reverse(COMPANY, 'user-1', 'doc-1');
    expect(h.state.warehouseQuantity(W_SRC).toFixed(4)).toBe('17.0000');
    expect(h.state.warehouseQuantity(W_DST).toFixed(4)).toBe('3.0000');
    expect(h.state.branchBalance().toFixed(4)).toBe('20.0000');
  });

  it('aggregates repeated item lines before checking the warehouse', async () => {
    const h = makeHarness([seedMovement(W_SRC, BRANCH, 15), seedMovement(W_DST, BRANCH, 5)], false);
    h.prisma.stockDocument.findFirst.mockResolvedValue(posted({
      lines: [
        { id: 'l1', itemId: MILK, quantity: D(3), unitCost: D(7.5) },
        { id: 'l2', itemId: MILK, quantity: D(3), unitCost: D(7.5) },
      ],
    }));
    await expect(h.service.reverse(COMPANY, 'user-1', 'doc-1')).rejects.toThrow(/selected warehouse/);
    expect(h.state.movementCreates).not.toHaveBeenCalled();
  });

  it('serializes concurrent reversals competing for the same destination stock', async () => {
    const h = makeHarness([seedMovement(W_SRC, BRANCH, 13), seedMovement(W_DST, BRANCH, 7)], false);
    h.prisma.stockDocument.findFirst.mockImplementation(async ({ where }: any) => posted({ id: where.id }));
    const results = await Promise.allSettled([
      h.service.reverse(COMPANY, 'user-1', 'doc-1'),
      h.service.reverse(COMPANY, 'user-1', 'doc-2'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(h.state.warehouseQuantity(W_DST).toFixed(4)).toBe('2.0000');
    expect(h.state.branchBalance().toFixed(4)).toBe('20.0000');
  });

  it('respects the existing company setting permitting warehouse-level negatives', async () => {
    const h = makeHarness([seedMovement(W_SRC, BRANCH, 17), seedMovement(W_DST, BRANCH, 3)], true);
    h.prisma.stockDocument.findFirst.mockResolvedValue(posted());
    await h.service.reverse(COMPANY, 'user-1', 'doc-1');
    expect(h.state.warehouseQuantity(W_DST).toFixed(4)).toBe('-2.0000');
    expect(h.state.branchBalance().toFixed(4)).toBe('20.0000');
  });

  it('rejects reversing a positive count adjustment if that stock is gone', async () => {
    const h = makeHarness([seedMovement(W_SRC, BRANCH, 17), seedMovement(W_DST, BRANCH, 3)], false);
    h.prisma.stockDocument.findFirst.mockResolvedValue(posted({
      kind: StockDocumentKind.COUNT, fromBranchId: null, fromWarehouseId: null,
      lines: [{ id: 'l1', itemId: MILK, quantity: D(5), unitCost: D(7.5) }],
    }));
    await expect(h.service.reverse(COMPANY, 'user-1', 'doc-1')).rejects.toThrow(/selected warehouse/);
    expect(h.state.movementCreates).not.toHaveBeenCalled();
  });

  it('rolls back the first movement if the second movement fails', async () => {
    const h = makeHarness([seedMovement(W_SRC, BRANCH, 12), seedMovement(W_DST, BRANCH, 8)], false);
    h.prisma.stockDocument.findFirst.mockResolvedValue(posted());
    h.controls.failSecondMovement();
    await expect(h.service.reverse(COMPANY, 'user-1', 'doc-1')).rejects.toThrow('simulated movement failure');
    expect(h.state.warehouseQuantity(W_SRC).toFixed(4)).toBe('12.0000');
    expect(h.state.warehouseQuantity(W_DST).toFixed(4)).toBe('8.0000');
    expect(h.state.branchBalance().toFixed(4)).toBe('20.0000');
  });
});
