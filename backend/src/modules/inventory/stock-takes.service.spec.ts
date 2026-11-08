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
        { id: itemId, code: 'MILK', nameEn: 'Milk', nameAr: 'حليب', unit: 'علبة', companyId: COMPANY, deletedAt: null },
        { id: 'item-plug', code: 'PLUG', nameEn: 'Plug', nameAr: 'قابس', unit: 'قطعة', companyId: COMPANY, deletedAt: null },
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
        findFirst: jest.fn(async ({ where }: any) => state.lines.find((line) => matches(line, where)) ?? null),
        update: jest.fn(async ({ where, data }: any) => {
          const row = state.lines.find((line) => matches(line, where));
          if (!row) throw new Error('line not found');
          Object.assign(row, data);
          return row;
        }),
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

  it('finishing moves the session to review, and a second count on a closed session is refused', async () => {
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
      lines: [{ lineId, countedQuantity: 9 }],
      finish: true,
    });
    expect(harness.state.sessions[0].status).toBe('REVIEW');

    harness.state.sessions[0].status = 'POSTED';
    await expect(
      harness.service.record(COMPANY, COUNTER, sessionId, { lines: [{ lineId, countedQuantity: 9 }] }),
    ).rejects.toThrow(/can no longer be counted/i);
  });

  it('will not let the person who counted approve their own difference', async () => {
    const harness = withWarehouse(
      makeHarness({ balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-plug', quantity: D('1'), value: D('1') }] }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });

    await expect(
      harness.service.approve(COMPANY, COUNTER, harness.state.sessions[0].id),
    ).rejects.toThrow(/cannot approve/i);
    expect(harness.state.sessions[0].status).toBe('COUNTING');
  });

  it('approves once, and tells the second approver the truth', async () => {
    const harness = withWarehouse(
      makeHarness({ balances: [{ companyId: COMPANY, warehouseId: WAREHOUSE, itemId: 'item-plug', quantity: D('1'), value: D('1') }] }),
      { id: WAREHOUSE, branchId: BRANCH },
    );
    await harness.service.start(COMPANY, COUNTER, { warehouseId: WAREHOUSE });
    const sessionId = harness.state.sessions[0].id;

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
    // Someone else claimed it between our read and our write.
    (harness.tx.stockTakeSession.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });

    await expect(harness.service.approve(COMPANY, APPROVER, sessionId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(harness.state.sessions[0].status).toBe('COUNTING');
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
      lines: [{ lineId: harness.state.lines[0].id, countedQuantity: 10 }],
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
      lines: [{ lineId: harness.state.lines[0].id, countedQuantity: 6 }],
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
