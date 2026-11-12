import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, StockDocumentKind } from '@prisma/client';

import { StockTakesService } from './stock-takes.service';

const D = (value: string | number) => new Prisma.Decimal(value);
const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const WAREHOUSE = '33333333-3333-4333-8333-333333333333';
const COUNTER = 'user-counter';
const APPROVER = 'user-approver';

/// Counting a store, end to end, against an in-memory book.
///
/// The count is the one place where the system's figure and a person's figure
/// meet, so the rules under test are the ones that make the meeting honest:
/// quantities are frozen when the doors shut, the difference is computed by the
/// server from the frozen figure, the person who counted cannot approve it, and
/// posting happens once.
describe('stock takes', () => {
  type Session = Record<string, any>;
  type Line = Record<string, any>;

  function valueMatches(actual: unknown, condition: unknown): boolean {
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const filter = condition as Record<string, any>;
      if ('in' in filter) return (filter.in as unknown[]).includes(actual as never);
      if ('not' in filter) return actual !== filter.not;
      if ('gt' in filter) return Number(actual) > Number(filter.gt);
      if ('gte' in filter) return Number(actual) >= Number(filter.gte);
      return true;
    }
    if (condition === undefined) return true;
    return actual === condition;
  }

  function matches(row: Record<string, any>, where: Record<string, any> = {}): boolean {
    return Object.entries(where).every(([key, condition]) => valueMatches(row[key], condition));
  }

  function makeHarness(seed: {
    itemId?: string;
    lots?: Array<Record<string, any>>;
    balances?: Array<Record<string, any>>;
  } = {}) {
    const itemId = seed.itemId ?? 'item-milk';
    const state = {
      sessions: [] as Session[],
      lines: [] as Line[],
      items: [
        {
          id: itemId,
          code: 'MILK',
          nameEn: 'Milk',
          nameAr: 'حليب',
          unit: 'علبة',
          isStockTracked: true,
          companyId: COMPANY,
          deletedAt: null,
          // One carton of milk holds 24 bottles: the factor a scan relies on,
          // and the one a count must convert with exactly once.
          units: [
            { id: 'u-milk-base', unit: 'علبة', factor: '1', isActive: true },
            { id: 'u-milk-carton', unit: 'كرتونة', factor: '24', isActive: true },
          ],
        },
        { id: 'item-plug', code: 'PLUG', nameEn: 'Plug', nameAr: 'قابس', unit: 'قطعة', isStockTracked: true, companyId: COMPANY, deletedAt: null },
        { id: 'item-service', code: 'SERVICE', nameEn: 'Service', nameAr: 'خدمة', unit: 'مرة', isStockTracked: false, companyId: COMPANY, deletedAt: null },
      ] as Session[],
      lots: (seed.lots ?? []) as Session[],
      balances: (seed.balances ?? []) as Session[],
      stockDocuments: [] as Session[],
    };
    let sequence = 0;

    const withRelations = (session: Session, include?: Record<string, any>) => {
      const copy: Session = { ...session };
      if (include?.warehouse) {
        copy.warehouse = { id: session.warehouseId, code: 'WH-A', nameEn: 'Store A', nameAr: 'مخزن أ' };
      }
      if (include?.lines) {
        copy.lines = state.lines
          .filter((line) => line.sessionId === session.id)
          .map((line) => ({
            ...line,
            item: state.items.find((item) => item.id === line.itemId),
            batch: line.batchId
              ? (state.lots.find((lot) => lot.id === line.batchId) ?? null)
              : null,
          }));
      }
      if (include?._count) {
        copy._count = { lines: state.lines.filter((line) => line.sessionId === session.id).length };
      }
      return copy;
    };

    const tx = {
      stockTakeSession: {
        create: jest.fn(async ({ data }: { data: Session }) => {
          const row = {
            id: `session-${++sequence}`,
            status: 'COUNTING',
            createdAt: new Date(),
            documentId: null,
            journalEntryId: null,
            approvedAt: null,
            approvedBy: null,
            postedAt: null,
            postedBy: null,
            notes: null,
            ...data,
          };
          state.sessions.push(row);
          return row;
        }),
        findFirst: jest.fn(async ({ where, include }: any) => {
          const row = state.sessions.find((session) => matches(session, where));
          return row ? withRelations(row, include) : null;
        }),
        findMany: jest.fn(async ({ where, include }: any) =>
          state.sessions.filter((session) => matches(session, where)).map((row) => withRelations(row, include)),
        ),
        count: jest.fn(async ({ where }: any) => state.sessions.filter((session) => matches(session, where)).length),
        update: jest.fn(async ({ where, data }: any) => {
          const row = state.sessions.find((session) => matches(session, where));
          if (!row) throw new Error('session not found');
          Object.assign(row, data);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const rows = state.sessions.filter((session) => matches(session, where));
          for (const row of rows) Object.assign(row, data);
          return { count: rows.length };
        }),
      },
      stockTakeLine: {
        create: jest.fn(async ({ data }: { data: Line }) => {
          // The database stores decimals and defaults the difference to zero;
          // the fake does the same so the service reads back what it would read
          // in production.
          const row = {
            id: `line-${++sequence}`,
            batchId: null,
            countedQuantity: null,
            varianceQuantity: D(0),
            varianceValue: D(0),
            countedAt: null,
            notes: null,
            ...data,
            systemQuantity: D((data as Line).systemQuantity ?? 0),
            unitCost: D((data as Line).unitCost ?? 0),
          };
          state.lines.push(row);
          return row;
        }),
        findFirst: jest.fn(async ({ where, select }: any) => {
          const line = state.lines.find((row) => matches(row, where));
          if (!line) return null;
          // `record` asks for the item so it can convert a count entered in a
          // packing unit. The fake answers with the shape a real database
          // would, including the item's unit table.
          if (select?.item) {
            const item = state.items.find((row) => row.id === line.itemId);
            return {
              ...line,
              item: item
                ? {
                    unit: item.unit,
                    units: (item.units ?? []).map((unit: any) => ({
                      id: unit.id,
                      unit: unit.unit,
                      factor: D(unit.factor),
                      isActive: unit.isActive !== false,
                    })),
                  }
                : null,
            };
          }
          return line;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = state.lines.find((line) => matches(line, where));
          if (!row) throw new Error('line not found');
          Object.assign(row, data);
          return row;
        }),
        count: jest.fn(async ({ where }: any) =>
          state.lines.filter((line) => matches(line, where)).length,
        ),
      },
      itemBatch: {
        findMany: jest.fn(async ({ where }: any) =>
          state.lots.filter(
            (lot) =>
              matches(lot, { ...where, remainingQuantity: undefined }) &&
              Number(lot.remainingQuantity) > 0,
          ),
        ),
      },
      warehouseStockBalance: {
        findMany: jest.fn(async ({ where }: any) => state.balances.filter((row) => matches(row, where))),
      },
      item: {
        findFirst: jest.fn(async ({ where }: any) => state.items.find((item) => matches(item, where)) ?? null),
        findMany: jest.fn(async ({ where }: any) => state.items.filter((item) => matches(item, where))),
      },
      stockDocument: {
        findFirst: jest.fn(async ({ where }: any) =>
          state.stockDocuments.find((document) => matches(document, where)) ?? null,
        ),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const document = state.stockDocuments.find((row) => matches(row, where));
          if (document) Object.assign(document, data);
          return { count: document ? 1 : 0 };
        }),
      },
      warehouse: { findFirst: jest.fn(async () => null as Record<string, any> | null) },
    };

    // A real transaction is invisible to a connection outside it. The fake says
    // so: reading the session from its own prisma client while the transaction
    // is still open is an error, which is how the "session not found on create"
    // defect is caught here instead of only against PostgreSQL.
    let open = 0;
    const prisma = {
      ...tx,
      stockTakeSession: {
        ...tx.stockTakeSession,
        findFirst: jest.fn(async (args: any) => {
          if (open > 0) {
            throw new Error(
              'read inside the transaction cannot see a row it has not committed yet',
            );
          }
          return tx.stockTakeSession.findFirst(args);
        }),
      },
      $transaction: jest.fn(async (work: (client: unknown) => unknown) => {
        open += 1;
        try {
          return await work(tx);
        } finally {
          open -= 1;
        }
      }),
    };
    const numbers = { next: jest.fn(async () => 'STK-2026-0001') };
    const documents = {
      create: jest.fn(async (companyId: string, branchId: string, _userId: string, dto: any, options: any) => {
        const document = {
          id: 'doc-1',
          companyId,
          branchId,
          kind: dto.kind,
          toWarehouseId: dto.toWarehouseId ?? null,
          status: 'DRAFT',
          deletedAt: null,
          stockTakeSessionId: null,
          idempotencyKey: options?.idempotencyKey,
          lines: dto.lines.map((line: any) => ({
            ...line,
            quantity: D(line.quantity),
            unitCost: D(line.unitCost),
          })),
        };
        state.stockDocuments.push(document);
        return { id: document.id, ...dto };
      }),
      post: jest.fn(async () => {
        const document = state.stockDocuments[0];
        if (document) document.status = 'POSTED';
        return { id: 'doc-1', journalEntryId: 'journal-1' };
      }),
    };
    const audit = { record: jest.fn(async () => undefined) };
    const service = new StockTakesService(
      prisma as never,
      {} as never,
      { post: jest.fn() } as never,
      numbers as never,
      documents as never,
      audit as never,
    );

    return { service, state, tx, prisma, documents, numbers, audit, itemId };
  }

  /// `start` looks the warehouse up on the company's own table; every test that
  /// opens a session needs that answer, so it is wired once here.
  function withWarehouse(harness: ReturnType<typeof makeHarness>, row: Record<string, any> | null) {
    (harness.tx.warehouse.findFirst as jest.Mock).mockResolvedValue(row);
    return harness;
  }

  /// A full count now freezes a line for every stock-tracked item, including
  /// items the system believes are at zero, so a count can record goods it did
  /// not know were there. Any test that wants to finish a session therefore has
  /// to answer all of its lines, not just the one it seeded a balance for.
  function answerEveryLine(
    harness: ReturnType<typeof makeHarness>,
    counted: Record<string, number> = {},
  ) {
    return harness.state.lines.map((line) => ({
      lineId: line.id,
      countedQuantity:
        counted[line.itemId] !== undefined
          ? counted[line.itemId]
          : Number(line.systemQuantity),
    }));
  }

  it('filters the stock take list to warehouses the caller may view', async () => {
    const harness = makeHarness();

    await harness.service.list(COMPANY, {}, null, ['warehouse-visible']);

    expect(harness.prisma.stockTakeSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: COMPANY,
          warehouseId: { in: ['warehouse-visible'] },
        }),
      }),
    );
    expect(harness.prisma.stockTakeSession.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          warehouseId: { in: ['warehouse-visible'] },
        }),
      }),
    );
  });

  it('does not let a requested warehouse override the caller warehouse grants', async () => {
    const harness = makeHarness();

    await harness.service.list(
      COMPANY,
      { warehouseId: 'warehouse-hidden' },
      null,
      ['warehouse-visible'],
    );

    expect(harness.prisma.stockTakeSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ warehouseId: { in: [] } }),
      }),
    );
  });

  it('freezes lots per lot and the rest per item, at the shelf\u2019s own average', async () => {
    const harness = withWarehouse(
      makeHarness({
        lots: [
          { id: 'lot-1', companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-milk', remainingQuantity: D('8'), unitCost: D('12.5'), deletedAt: null },
          { id: 'lot-2', companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-milk', remainingQuantity: D('2'), unitCost: D('10'), deletedAt: null },
        ],
        balances: [
          // The same item as the lots: it must not be frozen twice.
          { companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-milk', quantity: D('10'), value: D('120') },
          { companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-plug', quantity: D('4'), value: D('8') },
        ],
      }),
      { id: WAREHOUSE, branchId: BRANCH },
    );

    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });

    const frozen = harness.state.lines.map((line) => ({
      item: line.itemId,
      batch: line.batchId ?? null,
      quantity: line.systemQuantity.toFixed(4),
      cost: line.unitCost.toFixed(4),
    }));
    expect(frozen).toEqual([
      { item: 'item-milk', batch: 'lot-1', quantity: '8.0000', cost: '12.5000' },
      { item: 'item-milk', batch: 'lot-2', quantity: '2.0000', cost: '10.0000' },
      { item: 'item-plug', batch: null, quantity: '4.0000', cost: '2.0000' },
    ]);
    expect(harness.state.sessions[0]).toMatchObject({
      code: 'STK-2026-0001',
      status: 'COUNTING',
      scope: 'FULL',
      branchId: BRANCH,
    });
    // The freeze is a moment, recorded: without it nobody can tell later which
    // figure the person was counting against.
    expect(harness.state.sessions[0].frozenAt).toBeInstanceOf(Date);
  });

  it('answers with the session it created, read after the transaction commits', async () => {
    const harness = withWarehouse(makeHarness(), { id: WAREHOUSE, branchId: BRANCH });

    const created = await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });

    expect(created.id).toBe(harness.state.sessions[0].id);
    expect(created.status).toBe('COUNTING');
    // And the audit trail is written once the row exists, so a failure between
    // the two cannot leave a log entry for a session that was rolled back.
    expect(harness.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', entityId: created.id }),
    );
  });

  it('refuses a partial count that names no items', async () => {
    const harness = withWarehouse(makeHarness(), { id: WAREHOUSE, branchId: BRANCH });

    await expect(
      harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE, scope: 'PARTIAL', itemIds: [] }),
    ).rejects.toThrow(/must name the items/i);
    expect(harness.state.sessions).toHaveLength(0);
  });

  it('rejects non-stock items in a partial count before creating a session', async () => {
    const harness = withWarehouse(makeHarness(), { id: WAREHOUSE, branchId: BRANCH });

    await expect(
      harness.service.start(COMPANY, COUNTER, {
        warehouseId: WAREHOUSE,
        scope: 'PARTIAL',
        itemIds: ['item-service'],
      }),
    ).rejects.toThrow(/only existing stock-tracked items/i);
    expect(harness.state.sessions).toHaveLength(0);
  });

  it('includes every zero-balance stock-tracked item in a full count', async () => {
    const harness = withWarehouse(makeHarness(), { id: WAREHOUSE, branchId: BRANCH });

    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });

    expect(harness.state.lines.map((line) => line.itemId).sort()).toEqual([
      'item-milk',
      'item-plug',
    ]);
    expect(harness.state.lines.every((line) => line.systemQuantity.isZero())).toBe(true);
  });

  it('gives a partial count a line even for an item that holds nothing', async () => {
    const harness = withWarehouse(makeHarness(), { id: WAREHOUSE, branchId: BRANCH });

    await harness.service.start(COMPANY, COUNTER, {
      warehouseId: WAREHOUSE,
      scope: 'PARTIAL',
      itemIds: ['item-plug'],
    });

    expect(harness.state.lines).toHaveLength(1);
    expect(harness.state.lines[0].systemQuantity.toFixed(4)).toBe('0.0000');
    expect(harness.state.lines[0].unitCost.toFixed(4)).toBe('0.0000');
  });

  it('refuses a warehouse of another branch', async () => {
    const harness = withWarehouse(makeHarness(), { id: WAREHOUSE, branchId: 'branch-other' });

    await expect(
      harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE }, [BRANCH]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.state.sessions).toHaveLength(0);
  });

  it('computes the variance from the frozen figure, whatever the client sent', async () => {
    const harness = withWarehouse(
      makeHarness({
        balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-plug', quantity: D('10'), value: D('100') }],
      }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const lineId = harness.state.lines[0].id;

    await harness.service.record(COMPANY, COUNTER, harness.state.sessions[0].id, {
      lines: [{ lineId, countedQuantity: 7, notes: 'three burst' }],
    });

    const line = harness.state.lines[0];
    expect(line.countedQuantity.toFixed(4)).toBe('7.0000');
    expect(line.varianceQuantity.toFixed(4)).toBe('-3.0000');
    expect(line.varianceValue.toFixed(4)).toBe('-30.0000');
    expect(line.countedBy).toBe(COUNTER);
    expect(line.countedAt).toBeInstanceOf(Date);
  });

  it('counts one carton as 24 bottles, once, and books the variance in base units', async () => {
    // The scanner found a carton of milk. The counter typed 1, meaning one
    // carton, and sent the unit with it. The shelf says one carton; the book
    // froze 48 bottles.
    const harness = withWarehouse(
      makeHarness({
        balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-milk', quantity: D('48'), value: D('480') }],
      }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const line = harness.state.lines.find((row) => row.itemId === 'item-milk')!;

    await harness.service.record(COMPANY, COUNTER, harness.state.sessions[0].id, {
      lines: [{ lineId: line.id, countedQuantity: 1, unitName: 'كرتونة' }],
    });

    // Exactly 24, not 576: the factor was applied once, on the server.
    expect(line.countedQuantity.toFixed(4)).toBe('24.0000');
    expect(line.varianceQuantity.toFixed(4)).toBe('-24.0000');
    // The variance is valued at the frozen unit cost of 10.
    expect(line.varianceValue.toFixed(4)).toBe('-240.0000');
  });

  it('two cartons counted by scan become 48 bottles with no variance', async () => {
    const harness = withWarehouse(
      makeHarness({
        balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-milk', quantity: D('48'), value: D('480') }],
      }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const line = harness.state.lines.find((row) => row.itemId === 'item-milk')!;

    await harness.service.record(COMPANY, COUNTER, harness.state.sessions[0].id, {
      lines: [{ lineId: line.id, countedQuantity: 2, unitName: 'كرتونة' }],
    });

    expect(line.countedQuantity.toFixed(4)).toBe('48.0000');
    expect(line.varianceQuantity.toFixed(4)).toBe('0.0000');
    expect(line.varianceValue.toFixed(4)).toBe('0.0000');
  });

  it('records a shelf found empty, counted in cartons as zero', async () => {
    // "There are none left" is a real count. Zero cartons is zero bottles, and
    // the shared conversion helper refuses a zero result because on a document
    // line it means a posting that would move nothing - here it means the shelf
    // is empty, which is exactly what the count has to say.
    const harness = withWarehouse(
      makeHarness({
        balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-milk', quantity: D('48'), value: D('480') }],
      }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const line = harness.state.lines.find((row) => row.itemId === 'item-milk')!;

    await harness.service.record(COMPANY, COUNTER, harness.state.sessions[0].id, {
      lines: [{ lineId: line.id, countedQuantity: 0, unitName: 'كرتونة' }],
    });

    expect(line.countedQuantity.toFixed(4)).toBe('0.0000');
    expect(line.varianceQuantity.toFixed(4)).toBe('-48.0000');
    expect(line.varianceValue.toFixed(4)).toBe('-480.0000');
  });

  /// A zero count used to skip the unit check entirely, so a misspelled or
  /// inactive unit was accepted the moment the figure was zero. The counter
  /// believed they had counted a carton; the session recorded a zero it never
  /// validated. These two pin that the unit is still checked.
  it('refuses a zero count that names a unit the item does not have', async () => {
    const harness = withWarehouse(
      makeHarness({
        balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-milk', quantity: D('48'), value: D('480') }],
      }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const line = harness.state.lines.find((row) => row.itemId === 'item-milk')!;

    await expect(
      harness.service.record(COMPANY, COUNTER, harness.state.sessions[0].id, {
        lines: [{ lineId: line.id, countedQuantity: 0, unitName: 'صندوق' }],
      }),
    ).rejects.toThrow(/is not defined for this item/);

    // Nothing was written: the line is still uncounted.
    expect(line.countedQuantity).toBeNull();
  });

  it('refuses a zero count that names an inactive unit', async () => {
    const harness = withWarehouse(
      makeHarness({
        balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-milk', quantity: D('48'), value: D('480') }],
      }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const line = harness.state.lines.find((row) => row.itemId === 'item-milk')!;
    // Retire the carton after the session froze its lines. The unit lives on
    // the seeded item, which is where the service reads it from.
    const milk = harness.state.items.find((row) => row.id === 'item-milk')!;
    const carton = milk.units.find((row: any) => row.unit === 'كرتونة');
    carton.isActive = false;

    await expect(
      harness.service.record(COMPANY, COUNTER, harness.state.sessions[0].id, {
        lines: [{ lineId: line.id, countedQuantity: 0, unitName: 'كرتونة' }],
      }),
    ).rejects.toThrow(/inactive/);

    expect(line.countedQuantity).toBeNull();
  });

  it('still keeps a valid zero count as zero, not as a rejected read', async () => {
    // The counterpart to the two above: a *valid* unit with a zero figure must
    // still be accepted, or the fix would have broken "the shelf is empty".
    const harness = withWarehouse(
      makeHarness({
        balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-milk', quantity: D('48'), value: D('480') }],
      }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const line = harness.state.lines.find((row) => row.itemId === 'item-milk')!;

    await harness.service.record(COMPANY, COUNTER, harness.state.sessions[0].id, {
      lines: [{ lineId: line.id, countedQuantity: 0, unitName: 'كرتونة' }],
    });

    expect(line.countedQuantity.toFixed(4)).toBe('0.0000');
    expect(line.varianceQuantity.toFixed(4)).toBe('-48.0000');
  });

  it('counts in pieces when no unit is named, as every older client does', async () => {
    const harness = withWarehouse(
      makeHarness({
        balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-milk', quantity: D('48'), value: D('480') }],
      }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const line = harness.state.lines.find((row) => row.itemId === 'item-milk')!;

    await harness.service.record(COMPANY, COUNTER, harness.state.sessions[0].id, {
      lines: [{ lineId: line.id, countedQuantity: 30 }],
    });

    // A bare figure is a figure in base units, so nothing was multiplied.
    expect(line.countedQuantity.toFixed(4)).toBe('30.0000');
    expect(line.varianceQuantity.toFixed(4)).toBe('-18.0000');
  });

  it('refuses a unit the item does not have, and records nothing', async () => {
    const harness = withWarehouse(
      makeHarness({
        balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-milk', quantity: D('48'), value: D('480') }],
      }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const line = harness.state.lines.find((row) => row.itemId === 'item-milk')!;

    await expect(
      harness.service.record(COMPANY, COUNTER, harness.state.sessions[0].id, {
        lines: [{ lineId: line.id, countedQuantity: 1, unitName: 'شيكارة' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // No half-recorded count: the transaction rolled back the line.
    expect(line.countedQuantity).toBeNull();
  });

  it('counts a cup whose unit is fractional without inflating the count', async () => {
    // A half-litre cup is a legitimate packing unit; the conversion must keep
    // the fraction, not round it away.
    const harness = withWarehouse(
      makeHarness({
        balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-plug', quantity: D('10'), value: D('100') }],
      }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    // Give this item a float-tolerant unit table for the test.
    harness.state.items.find((row) => row.id === 'item-plug')!.units = [
      { id: 'u-plug-base', unit: 'قطعة', factor: '1', isActive: true },
      { id: 'u-plug-half', unit: 'نصف', factor: '0.5', isActive: true },
    ];
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const line = harness.state.lines.find((row) => row.itemId === 'item-plug')!;

    await harness.service.record(COMPANY, COUNTER, harness.state.sessions[0].id, {
      lines: [{ lineId: line.id, countedQuantity: 3, unitName: 'نصف' }],
    });

    expect(line.countedQuantity.toFixed(4)).toBe('1.5000');
    expect(line.varianceQuantity.toFixed(4)).toBe('-8.5000');
  });

  it('refuses a negative count and a line from another session', async () => {
    const harness = withWarehouse(
      makeHarness({
        balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-plug', quantity: D('10'), value: D('100') }],
      }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const sessionId = harness.state.sessions[0].id;
    const lineId = harness.state.lines[0].id;

    await expect(
      harness.service.record(COMPANY, COUNTER, sessionId, { lines: [{ lineId, countedQuantity: -1 }] }),
    ).rejects.toThrow(/cannot be negative/i);
    await expect(
      harness.service.record(COMPANY, COUNTER, sessionId, { lines: [{ lineId: 'line-elsewhere', countedQuantity: 1 }] }),
    ).rejects.toThrow(/does not belong to this session/i);
    expect(harness.state.lines[0].countedQuantity).toBeNull();
  });

  it('refuses to finish while any frozen line remains uncounted', async () => {
    const harness = withWarehouse(
      makeHarness({
        balances: [
          { companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-plug', quantity: D('10'), value: D('100') },
          { companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-milk', quantity: D('4'), value: D('40') },
        ],
      }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const sessionId = harness.state.sessions[0].id;
    const firstLine = harness.state.lines[0];

    await expect(
      harness.service.record(COMPANY, COUNTER, sessionId, {
        lines: [{ lineId: firstLine.id, countedQuantity: 9 }],
        finish: true,
      }),
    ).rejects.toThrow(/1 line\(s\) have not been counted/i);

    expect(harness.state.sessions[0].status).toBe('COUNTING');
    // The in-memory transaction fake does not roll back line updates; the real
    // PostgreSQL transaction rolls the attempted partial finish back atomically.
    expect(harness.state.lines[1].countedQuantity).toBeNull();
  });

  it('finishing locks the count against further edits while it awaits review', async () => {
    const harness = withWarehouse(
      makeHarness({
        balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-plug', quantity: D('10'), value: D('100') }],
      }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const sessionId = harness.state.sessions[0].id;
    const lineId = harness.state.lines[0].id;

    await harness.service.record(COMPANY, COUNTER, sessionId, {
      lines: answerEveryLine(harness, { 'item-plug': 9 }),
      finish: true,
    });
    expect(harness.state.sessions[0].status).toBe('REVIEW');

    await expect(
      harness.service.record(COMPANY, COUNTER, sessionId, {
        lines: [{ lineId, countedQuantity: 9 }],
      }),
    ).rejects.toThrow(/no longer open for counting/i);
    expect(harness.state.sessions[0].status).toBe('REVIEW');
  });

  it('cannot approve a counting session before all lines are submitted for review', async () => {
    const harness = withWarehouse(
      makeHarness({
        balances: [
          { companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-plug', quantity: D('10'), value: D('100') },
          { companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-milk', quantity: D('4'), value: D('40') },
        ],
      }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });

    await expect(
      harness.service.approve(COMPANY, APPROVER, harness.state.sessions[0].id),
    ).rejects.toThrow(/only after every line is counted/i);
    expect(harness.state.sessions[0].status).toBe('COUNTING');
    expect(harness.tx.stockTakeSession.updateMany).not.toHaveBeenCalled();
  });

  it('will not let the person who counted approve their own difference', async () => {
    const harness = withWarehouse(
      makeHarness({ balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-plug', quantity: D('1'), value: D('1') }] }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    await harness.service.record(COMPANY, COUNTER, harness.state.sessions[0].id, {
      lines: answerEveryLine(harness, { 'item-plug': 1 }),
      finish: true,
    });

    await expect(
      harness.service.approve(COMPANY, COUNTER, harness.state.sessions[0].id),
    ).rejects.toThrow(/cannot approve/i);
    // Finishing the count legitimately moves it to REVIEW; what must not
    // happen is the counter approving their own difference.
    expect(harness.state.sessions[0].status).toBe('REVIEW');
  });

  it('approves once, and tells the second approver the truth', async () => {
    const harness = withWarehouse(
      makeHarness({ balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-plug', quantity: D('1'), value: D('1') }] }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const sessionId = harness.state.sessions[0].id;
    await harness.service.record(COMPANY, COUNTER, sessionId, {
      lines: answerEveryLine(harness, { 'item-plug': 1 }),
      finish: true,
    });

    await harness.service.approve(COMPANY, APPROVER, sessionId);
    expect(harness.state.sessions[0]).toMatchObject({ status: 'APPROVED', approvedBy: APPROVER });
    expect(harness.state.sessions[0].approvedAt).toBeInstanceOf(Date);

    await expect(harness.service.approve(COMPANY, 'user-third', sessionId)).rejects.toThrow(
      /already approved/i,
    );
  });

  it('reports a lost race as a conflict, not as a second approval', async () => {
    const harness = withWarehouse(
      makeHarness({ balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-plug', quantity: D('1'), value: D('1') }] }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const sessionId = harness.state.sessions[0].id;
    await harness.service.record(COMPANY, COUNTER, sessionId, {
      lines: answerEveryLine(harness, { 'item-plug': 1 }),
      finish: true,
    });
    // Someone else claimed it between our read and our write.
    (harness.tx.stockTakeSession.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });

    await expect(harness.service.approve(COMPANY, APPROVER, sessionId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    // Still awaiting approval, not approved a second time.
    expect(harness.state.sessions[0].status).toBe('REVIEW');
  });

  it('posts only the differences, as an adjustment with an idempotency key, and links both ways', async () => {
    const harness = withWarehouse(
      makeHarness({
        balances: [
          { companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-plug', quantity: D('10'), value: D('100') },
          { companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-milk', quantity: D('5'), value: D('50') },
        ],
      }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const sessionId = harness.state.sessions[0].id;
    const [plugLine, milkLine] = harness.state.lines;
    // One item is short by 3, the other was counted exactly right.
    await harness.service.record(COMPANY, COUNTER, sessionId, {
      lines: [
        { lineId: plugLine.id, countedQuantity: 7 },
        { lineId: milkLine.id, countedQuantity: 5 },
      ],
      finish: true,
    });
    await harness.service.approve(COMPANY, APPROVER, sessionId);

    await harness.service.post(COMPANY, APPROVER, sessionId);

    const [companyArg, branchArg, userArg, dto, options] = harness.documents.create.mock.calls[0] as any[];
    expect(companyArg).toBe(COMPANY);
    expect(branchArg).toBe(BRANCH);
    expect(userArg).toBe(APPROVER);
    expect(dto.kind).toBe(StockDocumentKind.ADJUSTMENT);
    expect(dto.toWarehouseId).toBe(WAREHOUSE);
    expect(dto.lines).toHaveLength(1);
    expect(dto.lines[0]).toMatchObject({ itemId: 'item-plug', quantity: -3, unitCost: 10 });
    expect(options.idempotencyKey).toBe(`stock-take:${sessionId}`);
    // The document is posted, not left as a draft, and the session carries its
    // number and its journal both ways.
    expect(harness.documents.post).toHaveBeenCalledWith(COMPANY, APPROVER, 'doc-1');
    expect(harness.state.sessions[0]).toMatchObject({ status: 'POSTED', documentId: 'doc-1' });
    expect(harness.tx.stockDocument.updateMany).toHaveBeenCalledWith({
      where: { id: 'doc-1', companyId: COMPANY },
      data: { stockTakeSessionId: sessionId },
    });
  });

  it('closes a count with no differences without inventing a document', async () => {
    const harness = withWarehouse(
      makeHarness({ balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-plug', quantity: D('10'), value: D('100') }] }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const sessionId = harness.state.sessions[0].id;
    await harness.service.record(COMPANY, COUNTER, sessionId, {
      lines: answerEveryLine(harness, { 'item-plug': 10 }),
      finish: true,
    });
    await harness.service.approve(COMPANY, APPROVER, sessionId);

    await harness.service.post(COMPANY, APPROVER, sessionId);

    expect(harness.documents.create).not.toHaveBeenCalled();
    expect(harness.state.sessions[0].status).toBe('POSTED');
  });

  it('refuses to post before approval', async () => {
    const harness = withWarehouse(
      makeHarness({ balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-plug', quantity: D('1'), value: D('1') }] }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });

    await expect(
      harness.service.post(COMPANY, APPROVER, harness.state.sessions[0].id),
    ).rejects.toThrow(/only after it is approved/i);
    expect(harness.documents.create).not.toHaveBeenCalled();
  });

  it('puts the session back to approved when posting fails, so it can be retried', async () => {
    const harness = withWarehouse(
      makeHarness({ balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-plug', quantity: D('10'), value: D('100') }] }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const sessionId = harness.state.sessions[0].id;
    await harness.service.record(COMPANY, COUNTER, sessionId, {
      lines: answerEveryLine(harness, { 'item-plug': 6 }),
      finish: true,
    });
    await harness.service.approve(COMPANY, APPROVER, sessionId);
    harness.documents.post.mockRejectedValueOnce(new Error('the period is closed'));

    await expect(harness.service.post(COMPANY, APPROVER, sessionId)).rejects.toThrow(
      /period is closed/,
    );
    expect(harness.state.sessions[0].status).toBe('APPROVED');
    expect(harness.state.sessions[0].documentId).toBeNull();
    expect(harness.state.stockDocuments[0].status).toBe('DRAFT');

    // The retry must reuse the first draft, not create a second document.
    await harness.service.post(COMPANY, APPROVER, sessionId);
    expect(harness.documents.create).toHaveBeenCalledTimes(1);
    expect(harness.documents.post).toHaveBeenCalledTimes(2);
    expect(harness.state.sessions[0]).toMatchObject({ status: 'POSTED', documentId: 'doc-1' });
    expect(harness.state.stockDocuments[0].stockTakeSessionId).toBe(sessionId);
  });

  it('will not cancel a posted count', async () => {
    const harness = withWarehouse(
      makeHarness({ balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-plug', quantity: D('1'), value: D('1') }] }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    harness.state.sessions[0].status = 'POSTED';

    await expect(
      harness.service.cancel(COMPANY, APPROVER, harness.state.sessions[0].id, 'too late'),
    ).rejects.toThrow(/cannot be cancelled/i);
  });

  it('answers for another company\u2019s session with not found', async () => {
    const harness = withWarehouse(makeHarness(), { id: WAREHOUSE, branchId: BRANCH });

    await expect(harness.service.findOne('another-company', 'session-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
