import { Prisma } from '@prisma/client';

import { BatchesService } from './batches.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const WAREHOUSE = '33333333-3333-4333-8333-333333333333';
const OTHER_WAREHOUSE = '33333333-3333-4333-8333-333333333344';
const SHELF = '66666666-6666-4666-8666-666666666666';

const D = (value: string | number) => new Prisma.Decimal(value);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/// The expiry screen's feed.
///
/// The screen has to answer three different questions - what has expired, what
/// is about to, and what is still good - from one read, and each row has to
/// carry the shelf it sits on and the alert standing against it. These tests
/// pin the decisions that make the list true: which lots are eligible at all,
/// how the band becomes a group, and that a lot with no shelf does not invent
/// one.
describe('the expiry alert feed', () => {
  type Row = Record<string, any>;

  function lot(overrides: Row = {}): Row {
    return {
      id: 'lot-1',
      companyId: COMPANY,
      batchNumber: 'LOT-1',
      productionDate: day('2026-01-01'),
      expiryDate: day('2026-03-10'),
      remainingQuantity: D('10'),
      receivedQuantity: D('10'),
      unitCost: D('2'),
      status: 'OPEN',
      deletedAt: null,
      branchId: 'branch-1',
      warehouseId: WAREHOUSE,
      storageLocationId: SHELF,
      item: { id: 'item-1', code: 'MILK', nameEn: 'Milk', nameAr: 'حليب', unit: 'L' },
      warehouse: { id: WAREHOUSE, code: 'MAIN', nameEn: 'Main store', nameAr: 'الرئيسي' },
      ...overrides,
    };
  }

  function makeHarness(seed: { lots?: Row[]; notifications?: Row[]; locations?: Row[] } = {}) {
    const state = {
      lots: seed.lots ?? [],
      notifications: seed.notifications ?? [],
      locations: seed.locations ?? [
        { id: SHELF, code: 'A-01', nameEn: 'Aisle A shelf 1', nameAr: 'ممر أ رف ١' },
      ],
    };
    const prisma: Record<string, any> = {
      itemBatch: {
        findMany: jest.fn(async (args: Row = {}) => {
          const where = args.where ?? {};
          return state.lots.filter((row) => {
            if (where.companyId && row.companyId !== where.companyId) return false;
            if (where.deletedAt === null && row.deletedAt !== null) return false;
            if (where.remainingQuantity?.gt !== undefined) {
              if (!D(row.remainingQuantity).greaterThan(where.remainingQuantity.gt)) return false;
            }
            if (where.expiryDate?.not === null && row.expiryDate === null) return false;
            if (where.status?.notIn && where.status.notIn.includes(row.status)) return false;
            if (where.itemId && row.item.id !== where.itemId) return false;
            if (where.warehouseId?.in && !where.warehouseId.in.includes(row.warehouseId)) return false;
            return true;
          });
        }),
      },
      storageLocation: {
        findMany: jest.fn(async (args: Row = {}) =>
          state.locations.filter((row) => args.where.id.in.includes(row.id)),
        ),
      },
      notification: {
        findMany: jest.fn(async (args: Row = {}) =>
          state.notifications.filter((row) => {
            if (args.where.entityType && row.entityType !== args.where.entityType) return false;
            if (args.where.entityId?.in && !args.where.entityId.in.includes(row.entityId)) return false;
            if (args.where.type?.in && !args.where.type.in.includes(row.type)) return false;
            return true;
          }),
        ),
      },
    };
    const service = new BatchesService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma, state };
  }

  const AS_OF = day('2026-03-01');

  it('splits the feed into expired, expiring soon and valid', async () => {
    const { service } = makeHarness({
      lots: [
        lot({ id: 'gone', batchNumber: 'LOT-A', expiryDate: day('2026-02-20') }),
        lot({ id: 'soon', batchNumber: 'LOT-B', expiryDate: day('2026-03-05') }),
        lot({ id: 'good', batchNumber: 'LOT-C', expiryDate: day('2027-01-01') }),
      ],
    });

    const answer = await service.expiryAlerts(COMPANY, { asOf: '2026-03-01' });

    expect(answer.counts).toEqual({ expired: 1, expiringSoon: 1, valid: 1, total: 3 });
    expect(answer.items.map((row) => [row.batchNumber, row.group])).toEqual([
      ['LOT-A', 'EXPIRED'],
      ['LOT-B', 'EXPIRING_SOON'],
      ['LOT-C', 'VALID'],
    ]);
    expect(answer.asOf).toBe('2026-03-01');
  });

  it('says how many days are left, counted in whole days', async () => {
    const { service } = makeHarness({
      lots: [
        lot({ id: 'gone', expiryDate: day('2026-02-27') }),
        lot({ id: 'today', expiryDate: day('2026-03-01') }),
        lot({ id: 'later', expiryDate: day('2026-04-30') }),
      ],
    });

    const answer = await service.expiryAlerts(COMPANY, { asOf: '2026-03-01' });
    const byId = new Map(answer.items.map((row) => [row.id, row.daysToExpiry]));

    expect(byId.get('gone')).toBe(-2);
    // The last day a lot may still be sold is day zero, not "expired".
    expect(byId.get('today')).toBe(0);
    expect(byId.get('later')).toBe(60);
  });

  it('shows the shelf, the warehouse, the dates and the quantity on every row', async () => {
    const { service } = makeHarness({ lots: [lot()] });

    const answer = await service.expiryAlerts(COMPANY, { asOf: '2026-03-01' });
    const [row] = answer.items;

    expect(row.batchNumber).toBe('LOT-1');
    expect(row.itemNameEn).toBe('Milk');
    expect(row.itemNameAr).toBe('حليب');
    expect(row.warehouseCode).toBe('MAIN');
    expect(row.productionDate).toEqual(day('2026-01-01'));
    expect(row.expiryDate).toEqual(day('2026-03-10'));
    expect(row.quantity).toBe('10.0000');
    expect(row.storageLocation).toEqual({
      id: SHELF,
      code: 'A-01',
      nameEn: 'Aisle A shelf 1',
      nameAr: 'ممر أ رف ١',
    });
  });

  it('leaves the shelf null rather than inventing one for a lot that has none', async () => {
    const { service } = makeHarness({
      lots: [lot({ storageLocationId: null })],
    });

    const answer = await service.expiryAlerts(COMPANY, { asOf: '2026-03-01' });

    expect(answer.items[0].storageLocation).toBeNull();
  });

  it('ignores lots that are empty, deleted, written off or have no expiry', async () => {
    const { service, prisma } = makeHarness({
      lots: [
        lot({ id: 'empty', remainingQuantity: D('0') }),
        lot({ id: 'deleted', deletedAt: new Date() }),
        lot({ id: 'written', status: 'WRITTEN_OFF' }),
        lot({ id: 'no-date', expiryDate: null }),
        lot({ id: 'live' }),
      ],
    });

    const answer = await service.expiryAlerts(COMPANY, { asOf: '2026-03-01' });

    expect(answer.items.map((row) => row.id)).toEqual(['live']);
    // The filter is in the query, not applied after loading every lot.
    const where = prisma.itemBatch.findMany.mock.calls[0][0].where;
    expect(where.remainingQuantity).toEqual({ gt: 0 });
    expect(where.deletedAt).toBeNull();
    expect(where.expiryDate).toEqual({ not: null });
    expect(where.status).toEqual({ notIn: ['WRITTEN_OFF', 'CLOSED'] });
  });

  it('filters to one warehouse when the screen asks for it', async () => {
    const { service, prisma } = makeHarness({
      lots: [
        lot({ id: 'mine', warehouseId: WAREHOUSE }),
        lot({
          id: 'theirs',
          warehouseId: OTHER_WAREHOUSE,
          warehouse: { id: OTHER_WAREHOUSE, code: 'SEC', nameEn: 'Second', nameAr: 'الثاني' },
        }),
      ],
    });

    const answer = await service.expiryAlerts(COMPANY, {
      asOf: '2026-03-01',
      warehouseId: OTHER_WAREHOUSE,
    });

    expect(answer.items.map((row) => row.id)).toEqual(['theirs']);
    expect(prisma.itemBatch.findMany.mock.calls[0][0].where.warehouseId).toEqual({
      in: [OTHER_WAREHOUSE],
    });
  });

  it('never returns a shelf from another warehouse', async () => {
    // The shelf id on the lot does not belong to this company's list, which is
    // the shape a stale or hand-edited row would take.
    const { service } = makeHarness({
      lots: [lot({ storageLocationId: 'not-ours' })],
      locations: [],
    });

    const answer = await service.expiryAlerts(COMPANY, { asOf: '2026-03-01' });

    expect(answer.items[0].storageLocation).toBeNull();
  });

  it('reports the horizon it used, so the screen can label the tab', async () => {
    const { service } = makeHarness({ lots: [lot()] });

    const answer = await service.expiryAlerts(COMPANY, { asOf: '2026-03-01', days: '30' });

    // A lot 9 days out is inside a 30-day horizon.
    expect(answer.days).toEqual([30]);
    expect(answer.horizonDays).toBe(30);
    expect(answer.items[0].group).toBe('EXPIRING_SOON');
  });

  describe('the alert standing against a lot', () => {
    it('returns the loudest open alert per lot', async () => {
      const { service } = makeHarness({
        notifications: [
          {
            entityId: 'lot-1',
            entityType: 'ItemBatch',
            type: 'STOCK_EXPIRY_SOON',
            status: 'OPEN',
            severity: 'WARNING',
            raisedCount: 1,
            lastRaisedAt: day('2026-02-28'),
          },
          {
            entityId: 'lot-1',
            entityType: 'ItemBatch',
            type: 'STOCK_EXPIRED',
            status: 'OPEN',
            severity: 'CRITICAL',
            raisedCount: 3,
            lastRaisedAt: day('2026-03-01'),
          },
        ],
      });

      const states = await service.expiryAlertStates(COMPANY, ['lot-1']);

      expect(states.get('lot-1')).toEqual({
        type: 'STOCK_EXPIRED',
        status: 'OPEN',
        severity: 'CRITICAL',
        raisedCount: 3,
        lastRaisedAt: day('2026-03-01'),
      });
    });

    it('reads the feed from the notification rows, not from the dates', async () => {
      const { service } = makeHarness({
        lots: [lot({ id: 'lot-1', expiryDate: day('2026-03-05') })],
        // No notification row exists: the scanner has not raised this lot yet,
        // so the screen must say "no alert" rather than "warning".
        notifications: [],
      });

      const feed = await service.expiryAlerts(COMPANY, { asOf: '2026-03-01' });
      const states = await service.expiryAlertStates(COMPANY, feed.items.map((row) => row.id));

      expect(feed.items[0].group).toBe('EXPIRING_SOON');
      expect(states.get('lot-1')).toBeUndefined();
    });

    it('asks for nothing when there are no lots to ask about', async () => {
      const { service, prisma } = makeHarness();

      const states = await service.expiryAlertStates(COMPANY, []);

      expect(states.size).toBe(0);
      expect(prisma.notification.findMany).not.toHaveBeenCalled();
    });
  });
});
