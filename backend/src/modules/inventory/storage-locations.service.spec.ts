import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { StorageLocationsService } from './storage-locations.service';

const D = (value: string | number) => new Prisma.Decimal(value);
const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const OTHER_BRANCH = '99999999-9999-4999-8999-999999999999';
const WAREHOUSE = '33333333-3333-4333-8333-333333333333';
const OTHER_WAREHOUSE = '55555555-5555-4555-8555-555555555555';
const ITEM = '44444444-4444-4444-8444-444444444444';
const LOT = '66666666-6666-4666-8666-666666666666';
const USER = 'user-storekeeper';

/// The shelf tree: zones, aisles, racks, shelves and bins.
///
/// Two things are under test here. The shape - a bin cannot hold a zone, a
/// shelf cannot live outside an aisle, a location cannot be moved inside its
/// own child - because a tree that lies makes "where is it?" unanswerable. And
/// the refusals: a location holding stock or sub-locations is not deleted, a
/// move between warehouses is not a shelf move, and a move between two shelves
/// never changes the branch's quantity or value.
describe('storage locations', () => {
  type Row = Record<string, any>;

  function valueMatches(actual: unknown, condition: unknown): boolean {
    if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
      const filter = condition as Record<string, any>;
      if ('in' in filter) return (filter.in as unknown[]).includes(actual as never);
      if ('not' in filter) return actual !== filter.not;
      return true;
    }
    if (condition === undefined) return true;
    return actual === condition;
  }

  function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, condition]) => valueMatches(row[key], condition));
  }

  function makeHarness(
    seed: {
      locations?: Row[];
      movements?: Row[];
      balance?: { quantity: string; value: string } | null;
      activeWarehouse?: boolean;
    } = {},
  ) {
    const state = {
      locations: (seed.locations ?? []) as Row[],
      movements: (seed.movements ?? []) as Row[],
      balance: seed.balance === undefined ? null : seed.balance,
      batches: [] as Row[],
      audits: [] as Row[],
      created: [] as Row[],
      updated: [] as Row[],
    };

    const readRaw = (query: { sql?: string; values?: unknown[] }) => {
      const sql = String(query.sql ?? '');
      const values = (query.values ?? []) as any[];
      if (sql.includes('stock_balances')) {
        // PostgreSQL hands back Decimal objects, not strings; the service
        // divides them, so the stand-in must return the same type.
        return state.balance
          ? [{ quantity: D(state.balance.quantity), value: D(state.balance.value) }]
          : [];
      }
      if (sql.includes('ANY(')) {
        const ids = (values[1] ?? []) as string[];
        const grouped = new Map<string, { items: Set<string>; quantity: Prisma.Decimal }>();
        for (const row of state.movements) {
          if (!ids.includes(row.storageLocationId)) continue;
          const entry =
            grouped.get(row.storageLocationId) ?? { items: new Set<string>(), quantity: D(0) };
          entry.items.add(row.itemId);
          entry.quantity = row.direction === 'IN'
            ? entry.quantity.plus(D(row.quantity))
            : entry.quantity.minus(D(row.quantity));
          grouped.set(row.storageLocationId, entry);
        }
        return [...grouped].map(([storageLocationId, entry]) => ({
          storageLocationId,
          items: BigInt(entry.items.size),
          quantity: entry.quantity,
        }));
      }
      // Whole-lot shelf balances, grouped before a move is written.
      if (sql.includes('GROUP BY "storageLocationId"')) {
        const [companyId, itemId, batchId] = values;
        const grouped = new Map<string, Prisma.Decimal>();
        for (const row of state.movements) {
          if (row.companyId !== companyId || row.itemId !== itemId || row.batchId !== batchId) continue;
          const current = grouped.get(row.storageLocationId) ?? D(0);
          grouped.set(
            row.storageLocationId,
            row.direction === 'IN' ? current.plus(D(row.quantity)) : current.minus(D(row.quantity)),
          );
        }
        return [...grouped]
          .filter(([, quantity]) => !quantity.isZero())
          .map(([storageLocationId, quantity]) => ({ storageLocationId, quantity }));
      }
      // A sum over one location, optionally narrowed to one item and one lot.
      const [, locationId, itemId, batchId] = values;
      let total = D(0);
      for (const row of state.movements) {
        if (row.storageLocationId !== locationId) continue;
        if (row.companyId !== values[0]) continue;
        if (itemId && row.itemId !== itemId) continue;
        if (batchId && row.batchId !== batchId) continue;
        total = row.direction === 'IN' ? total.plus(D(row.quantity)) : total.minus(D(row.quantity));
      }
      return [{ quantity: state.movements.length === 0 ? null : total }];
    };

    const itemBatch = {
      updateMany: jest.fn(async (args: Row) => {
        state.batches.push(args);
        return { count: 1 };
      }),
    };
    const stockMovement = {
      create: jest.fn(async (args: Row) => {
        state.movements.push(args.data);
        return args.data;
      }),
    };

    const prisma: Record<string, any> = {
      storageLocation: {
        findMany: jest.fn(async (args: Row) =>
          state.locations
            .filter((row) => matches(row, args?.where))
            .map((row) => ({ ...row, warehouse: { code: 'MAIN' } })),
        ),
        findFirst: jest.fn(async (args: Row) => {
          const found = state.locations.find((row) => matches(row, args?.where));
          return found ? { ...found } : null;
        }),
        count: jest.fn(async (args: Row) =>
          state.locations.filter((row) => matches(row, args?.where)).length,
        ),
        create: jest.fn(async (args: Row) => {
          const row = { id: `loc-${state.locations.length + 1}`, ...args.data };
          state.locations.push(row);
          state.created.push(row);
          return row;
        }),
        update: jest.fn(async (args: Row) => {
          const row = state.locations.find((candidate) => candidate.id === args.where.id);
          if (!row) throw new Error('missing location');
          for (const [key, value] of Object.entries(args.data)) {
            if (value !== undefined) row[key] = value;
          }
          state.updated.push(row);
          return row;
        }),
      },
      warehouse: {
        findFirst: jest.fn(async () =>
          seed.activeWarehouse === false
            ? null
            : {
                id: WAREHOUSE,
                branchId: BRANCH,
                code: 'MAIN',
                deletedAt: null,
                companyId: COMPANY,
              },
        ),
      },
      item: {
        findFirst: jest.fn(async () => ({ id: ITEM, code: 'MILK', unit: 'علبة' })),
      },
      itemBatch,
      stockMovement,
      $queryRaw: jest.fn(async (query: { sql?: string; values?: unknown[] }) => readRaw(query)),
      $transaction: jest.fn(async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          $queryRaw: jest.fn(async (query: { sql?: string; values?: unknown[] }) => readRaw(query)),
          stockMovement,
          itemBatch,
        }),
      ),
    };

    const audit = { record: jest.fn(async (entry: Row) => state.audits.push(entry)) };
    const service = new StorageLocationsService(prisma as never, audit as never);
    return { service, prisma, audit, state };
  }

  const zone = (overrides: Row = {}): Row => ({
    id: 'loc-zone',
    companyId: COMPANY,
    branchId: BRANCH,
    warehouseId: WAREHOUSE,
    parentId: null,
    kind: 'ZONE',
    code: 'Z1',
    nameEn: 'Zone one',
    nameAr: 'المنطقة الأولى',
    isActive: true,
    deletedAt: null,
    ...overrides,
  });

  const shelf = (overrides: Row = {}): Row => ({
    id: 'loc-shelf',
    companyId: COMPANY,
    branchId: BRANCH,
    warehouseId: WAREHOUSE,
    parentId: 'loc-aisle',
    kind: 'SHELF',
    code: 'S1',
    nameEn: 'Shelf one',
    nameAr: 'الرف الأول',
    isActive: true,
    deletedAt: null,
    ...overrides,
  });

  const aisle = (overrides: Row = {}): Row => ({
    id: 'loc-aisle',
    companyId: COMPANY,
    branchId: BRANCH,
    warehouseId: WAREHOUSE,
    parentId: 'loc-zone',
    kind: 'AISLE',
    code: 'A1',
    nameEn: 'Aisle one',
    nameAr: 'الممر الأول',
    isActive: true,
    deletedAt: null,
    ...overrides,
  });

  it('creates a zone at the top of the tree and records it', async () => {
    const { service, state, audit } = makeHarness();

    const created = await service.create(
      COMPANY,
      USER,
      { warehouseId: WAREHOUSE, kind: 'zone', code: ' Z1 ', nameEn: ' Zone one ', nameAr: 'المنطقة' },
      null,
    );

    expect(created).toMatchObject({
      kind: 'ZONE',
      code: 'Z1',
      nameEn: 'Zone one',
      parentId: null,
      branchId: BRANCH,
      isActive: true,
      createdBy: USER,
    });
    expect(state.created).toHaveLength(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CREATE',
        entity: 'storage_locations',
        after: expect.objectContaining({ code: 'Z1', kind: 'ZONE' }),
      }),
    );
  });

  it('places an aisle inside a zone', async () => {
    const { service } = makeHarness({ locations: [zone()] });

    const created = await service.create(
      COMPANY,
      USER,
      { warehouseId: WAREHOUSE, parentId: 'loc-zone', kind: 'AISLE', code: 'A1', nameEn: 'A', nameAr: 'ب' },
      null,
    );

    expect(created).toMatchObject({ kind: 'AISLE', parentId: 'loc-zone' });
  });

  it.each([
    ['BIN', undefined, /must sit inside/i],
    ['SHELF', undefined, /must sit inside/i],
    ['ZONE', 'loc-zone', /cannot be placed inside/i],
  ])('refuses a %s in that position', async (kind, parentId, message) => {
    const { service, state } = makeHarness({ locations: [zone()] });

    await expect(
      service.create(
        COMPANY,
        USER,
        { warehouseId: WAREHOUSE, parentId: parentId as string | undefined, kind, code: 'X1', nameEn: 'X', nameAr: 'س' },
        null,
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create(
        COMPANY,
        USER,
        { warehouseId: WAREHOUSE, parentId: parentId as string | undefined, kind, code: 'X1', nameEn: 'X', nameAr: 'س' },
        null,
      ),
    ).rejects.toThrow(message);
    expect(state.created).toHaveLength(0);
  });

  it('refuses a parent that belongs to another warehouse', async () => {
    // The parent is looked up inside the warehouse being written to, so a
    // caller cannot graft a shelf onto another store's tree.
    const { service } = makeHarness({
      locations: [zone({ warehouseId: OTHER_WAREHOUSE })],
    });

    await expect(
      service.create(
        COMPANY,
        USER,
        { warehouseId: WAREHOUSE, parentId: 'loc-zone', kind: 'AISLE', code: 'A1', nameEn: 'A', nameAr: 'ب' },
        null,
      ),
    ).rejects.toThrow(/not in this warehouse/i);
  });

  it('refuses a code already used in the same warehouse', async () => {
    const { service } = makeHarness({ locations: [zone()] });

    await expect(
      service.create(
        COMPANY,
        USER,
        { warehouseId: WAREHOUSE, kind: 'ZONE', code: 'Z1', nameEn: 'Another', nameAr: 'أخرى' },
        null,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses an unknown kind', async () => {
    const { service } = makeHarness();

    await expect(
      service.create(
        COMPANY,
        USER,
        { warehouseId: WAREHOUSE, kind: 'PALLET', code: 'P1', nameEn: 'P', nameAr: 'ب' },
        null,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a warehouse outside the caller’s branch scope', async () => {
    const { service, state } = makeHarness();

    await expect(
      service.create(
        COMPANY,
        USER,
        { warehouseId: WAREHOUSE, kind: 'ZONE', code: 'Z1', nameEn: 'Z', nameAr: 'ز' },
        [OTHER_BRANCH],
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(state.created).toHaveLength(0);
  });

  it('refuses a warehouse that does not exist', async () => {
    const { service } = makeHarness({ activeWarehouse: false });

    await expect(
      service.create(
        COMPANY,
        USER,
        { warehouseId: WAREHOUSE, kind: 'ZONE', code: 'Z1', nameEn: 'Z', nameAr: 'ز' },
        null,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('builds the tree from the parent links, deepest first', async () => {
    const { service } = makeHarness({
      locations: [zone(), aisle(), shelf(), shelf({ id: 'loc-shelf-2', code: 'S2', parentId: 'loc-aisle' })],
      movements: [
        { companyId: COMPANY, storageLocationId: 'loc-shelf', itemId: ITEM, direction: 'IN', quantity: '4' },
        { companyId: COMPANY, storageLocationId: 'loc-shelf', itemId: 'item-2', direction: 'IN', quantity: '6' },
        { companyId: COMPANY, storageLocationId: 'loc-shelf', itemId: ITEM, direction: 'OUT', quantity: '1' },
      ],
    });

    const tree = (await service.tree(COMPANY, WAREHOUSE)) as { items: Row[] };

    expect(tree.items).toHaveLength(1);
    expect(tree.items[0].code).toBe('Z1');
    expect(tree.items[0].children).toHaveLength(1);
    expect(tree.items[0].children[0].code).toBe('A1');
    expect(tree.items[0].children[0].children).toHaveLength(2);
    const firstShelf = tree.items[0].children[0].children.find((row: Row) => row.code === 'S1');
    expect(firstShelf.stock).toEqual({ items: 2, quantity: '9.0000' });
    const secondShelf = tree.items[0].children[0].children.find((row: Row) => row.code === 'S2');
    expect(secondShelf.stock).toEqual({ items: 0, quantity: '0.0000' });
  });

  it('refuses to show a tree belonging to another branch', async () => {
    const { service } = makeHarness({ locations: [zone()] });

    await expect(service.tree(COMPANY, WAREHOUSE, [OTHER_BRANCH])).rejects.toThrow(ForbiddenException);
  });

  it('lists locations with what is in them, and the kinds the screen may offer', async () => {
    const { service } = makeHarness({
      locations: [zone(), shelf()],
      movements: [
        { companyId: COMPANY, storageLocationId: 'loc-shelf', itemId: ITEM, direction: 'IN', quantity: '3' },
      ],
    });

    const list = await service.list(COMPANY, { warehouseId: WAREHOUSE });

    expect(list.kinds).toEqual(['ZONE', 'AISLE', 'RACK', 'SHELF', 'BIN']);
    const shelved = list.items.find((row) => row.id === 'loc-shelf');
    expect(shelved?.stock).toEqual({ items: 1, quantity: '3.0000' });
    expect(list.items.find((row) => row.id === 'loc-zone')?.stock).toEqual({ items: 0, quantity: '0.0000' });
  });

  it('re-codes a location and records the change', async () => {
    const { service, audit } = makeHarness({ locations: [zone()] });

    const updated = await service.update(
      COMPANY,
      USER,
      'loc-zone',
      { code: 'Z9', nameEn: 'Zone nine' },
      null,
    );

    expect(updated).toMatchObject({ code: 'Z9', nameEn: 'Zone nine' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entityId: 'loc-zone' }),
    );
  });

  it('refuses a re-code that collides with another location in the warehouse', async () => {
    const { service } = makeHarness({ locations: [zone(), zone({ id: 'loc-zone-2', code: 'Z2' })] });

    await expect(
      service.update(COMPANY, USER, 'loc-zone', { code: 'Z2' }, null),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses to make a location its own parent', async () => {
    const { service } = makeHarness({ locations: [shelf()] });

    await expect(
      service.update(COMPANY, USER, 'loc-shelf', { parentId: 'loc-shelf' }, null),
    ).rejects.toThrow(/cannot contain itself/i);
  });

  it('refuses a move that would put a location inside its own child', async () => {
    // Zone -> Aisle. Asking to put the aisle inside the zone's own subtree is
    // what a careless bulk edit does; it would orphan every shelf below.
    const { service } = makeHarness({
      locations: [zone(), aisle(), shelf()],
    });

    await expect(
      service.update(COMPANY, USER, 'loc-zone', { parentId: 'loc-shelf' }, null),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses a kind that cannot sit in the chosen parent', async () => {
    const { service } = makeHarness({ locations: [zone(), shelf()] });

    await expect(
      service.update(COMPANY, USER, 'loc-shelf', { parentId: 'loc-zone' }, null),
    ).rejects.toThrow(/cannot be placed inside/i);
  });

  it('refuses to edit a location belonging to another branch', async () => {
    const { service } = makeHarness({ locations: [zone()] });

    await expect(
      service.update(COMPANY, USER, 'loc-zone', { code: 'Z9' }, [OTHER_BRANCH]),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses to delete a location that still holds sub-locations', async () => {
    const { service, state } = makeHarness({ locations: [zone(), aisle()] });

    await expect(service.remove(COMPANY, USER, 'loc-zone', null)).rejects.toThrow(ConflictException);
    expect(state.locations.find((row) => row.id === 'loc-zone')?.deletedAt).toBeNull();
  });

  it('refuses to delete a location that still holds stock', async () => {
    const { service, state } = makeHarness({
      locations: [zone()],
      movements: [
        { companyId: COMPANY, storageLocationId: 'loc-zone', itemId: ITEM, direction: 'IN', quantity: '5' },
      ],
    });

    await expect(service.remove(COMPANY, USER, 'loc-zone', null)).rejects.toThrow(/holds 5\.0000/);
    expect(state.locations[0].deletedAt).toBeNull();
  });

  it('deletes an empty location by hiding it, never by removing the row', async () => {
    const { service, state, audit } = makeHarness({ locations: [zone()] });

    const answer = await service.remove(COMPANY, USER, 'loc-zone', null);

    expect(answer).toEqual({ id: 'loc-zone', deleted: true });
    expect(state.locations[0].deletedAt).toBeInstanceOf(Date);
    expect(state.locations[0].isActive).toBe(false);
    expect(state.locations).toHaveLength(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', entityId: 'loc-zone' }),
    );
  });

  it('moves stock from one shelf to another in the same warehouse', async () => {
    const { service, state, audit } = makeHarness({
      locations: [shelf(), shelf({ id: 'loc-shelf-2', code: 'S2' })],
      movements: [
        {
          companyId: COMPANY,
          storageLocationId: 'loc-shelf',
          itemId: ITEM,
          batchId: LOT,
          direction: 'IN',
          quantity: '10',
        },
      ],
      balance: { quantity: '10', value: '100' },
    });

    const answer = await service.move(
      COMPANY,
      USER,
      { fromLocationId: 'loc-shelf', toLocationId: 'loc-shelf-2', itemId: ITEM, batchId: LOT, quantity: '4', reason: 're-shelving' },
      null,
    );

    expect(answer).toEqual({
      quantity: '4.0000',
      value: '40.0000',
      from: 'loc-shelf',
      to: 'loc-shelf-2',
      totalCost: '40.0000',
    });
    // Two movements, one out and one in, at the branch's average cost.
    const created = state.movements.slice(1);
    expect(created).toHaveLength(2);
    expect(created.map((row) => row.direction)).toEqual(['OUT', 'IN']);
    expect(created.map((row) => row.storageLocationId)).toEqual(['loc-shelf', 'loc-shelf-2']);
    expect(created[0].unitCost.toFixed(4)).toBe('10.0000');
    expect(created[0].totalCost.toFixed(4)).toBe('40.0000');
    expect(created[0].referenceType).toBe('LOCATION_MOVE_OUT');
    expect(created[1].referenceType).toBe('LOCATION_MOVE_IN');
    expect(created[0].notes).toBe('re-shelving');
    // A partial move splits a lot across shelves. The ledger records the
    // destination quantity; the single-location lot shortcut must stay put.
    expect(state.batches).toHaveLength(0);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MOVE_LOCATION',
        after: expect.objectContaining({ to: 'loc-shelf-2', quantity: '4.0000', value: '40.0000' }),
      }),
    );
  });

  it('updates the lot location only when its entire remaining quantity moves', async () => {
    const { service, state } = makeHarness({
      locations: [shelf(), shelf({ id: 'loc-shelf-2', code: 'S2' })],
      movements: [
        {
          companyId: COMPANY,
          storageLocationId: 'loc-shelf',
          itemId: ITEM,
          batchId: LOT,
          direction: 'IN',
          quantity: '10',
        },
      ],
      balance: { quantity: '10', value: '100' },
    });

    await service.move(
      COMPANY,
      USER,
      { fromLocationId: 'loc-shelf', toLocationId: 'loc-shelf-2', itemId: ITEM, batchId: LOT, quantity: '10' },
      null,
    );

    expect(state.batches).toHaveLength(1);
    expect(state.batches[0]).toMatchObject({
      where: { id: LOT, companyId: COMPANY },
      data: { storageLocationId: 'loc-shelf-2', updatedBy: USER },
    });
  });

  it('keeps the lot shortcut unchanged when the lot already occupies another shelf', async () => {
    const { service, state } = makeHarness({
      locations: [shelf(), shelf({ id: 'loc-shelf-2', code: 'S2' })],
      movements: [
        {
          companyId: COMPANY,
          storageLocationId: 'loc-shelf',
          itemId: ITEM,
          batchId: LOT,
          direction: 'IN',
          quantity: '4',
        },
        {
          companyId: COMPANY,
          storageLocationId: 'loc-shelf-2',
          itemId: ITEM,
          batchId: LOT,
          direction: 'IN',
          quantity: '6',
        },
      ],
      balance: { quantity: '10', value: '100' },
    });

    await service.move(
      COMPANY,
      USER,
      { fromLocationId: 'loc-shelf', toLocationId: 'loc-shelf-2', itemId: ITEM, batchId: LOT, quantity: '4' },
      null,
    );

    expect(state.batches).toHaveLength(0);
  });

  it('refuses to move more than the shelf holds', async () => {
    const { service, state } = makeHarness({
      locations: [shelf(), shelf({ id: 'loc-shelf-2', code: 'S2' })],
      movements: [
        { companyId: COMPANY, storageLocationId: 'loc-shelf', itemId: ITEM, direction: 'IN', quantity: '3' },
      ],
    });

    await expect(
      service.move(
        COMPANY,
        USER,
        { fromLocationId: 'loc-shelf', toLocationId: 'loc-shelf-2', itemId: ITEM, quantity: '4' },
        null,
      ),
    ).rejects.toThrow(/holds 3\.0000/);
    expect(state.movements).toHaveLength(1);
  });

  it.each([
    ['the same location', { fromLocationId: 'loc-shelf', toLocationId: 'loc-shelf' }, /same/i],
    ['a zero quantity', { quantity: '0' }, /positive/i],
    ['a negative quantity', { quantity: '-2' }, /positive/i],
  ])('refuses a move with %s', async (_label, overrides, message) => {
    const { service } = makeHarness({
      locations: [shelf(), shelf({ id: 'loc-shelf-2', code: 'S2' })],
      movements: [
        { companyId: COMPANY, storageLocationId: 'loc-shelf', itemId: ITEM, direction: 'IN', quantity: '10' },
      ],
    });

    await expect(
      service.move(
        COMPANY,
        USER,
        {
          fromLocationId: 'loc-shelf',
          toLocationId: 'loc-shelf-2',
          itemId: ITEM,
          quantity: '1',
          ...(overrides as Row),
        },
        null,
      ),
    ).rejects.toThrow(message);
  });

  it('refuses a shelf move that is really a warehouse transfer', async () => {
    const { service } = makeHarness({
      locations: [
        shelf(),
        shelf({ id: 'loc-shelf-2', code: 'S2', warehouseId: OTHER_WAREHOUSE }),
      ],
      movements: [
        { companyId: COMPANY, storageLocationId: 'loc-shelf', itemId: ITEM, direction: 'IN', quantity: '10' },
      ],
    });

    await expect(
      service.move(
        COMPANY,
        USER,
        { fromLocationId: 'loc-shelf', toLocationId: 'loc-shelf-2', itemId: ITEM, quantity: '1' },
        null,
      ),
    ).rejects.toThrow(/different warehouses/i);
  });

  it('refuses a move out of a location that was deactivated', async () => {
    const { service } = makeHarness({
      locations: [shelf({ isActive: false }), shelf({ id: 'loc-shelf-2', code: 'S2' })],
      movements: [
        { companyId: COMPANY, storageLocationId: 'loc-shelf', itemId: ITEM, direction: 'IN', quantity: '10' },
      ],
    });

    await expect(
      service.move(
        COMPANY,
        USER,
        { fromLocationId: 'loc-shelf', toLocationId: 'loc-shelf-2', itemId: ITEM, quantity: '1' },
        null,
      ),
    ).rejects.toThrow(/must be active/i);
  });

  it('refuses a move between branches the caller may not see', async () => {
    const { service } = makeHarness({
      locations: [shelf(), shelf({ id: 'loc-shelf-2', code: 'S2' })],
      movements: [
        { companyId: COMPANY, storageLocationId: 'loc-shelf', itemId: ITEM, direction: 'IN', quantity: '10' },
      ],
    });

    await expect(
      service.move(
        COMPANY,
        USER,
        { fromLocationId: 'loc-shelf', toLocationId: 'loc-shelf-2', itemId: ITEM, quantity: '1' },
        [OTHER_BRANCH],
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
