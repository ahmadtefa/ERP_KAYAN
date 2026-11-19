import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  STOCK_ABOVE_MAXIMUM,
  STOCK_BELOW_MINIMUM,
  STOCK_EXPIRED,
  STOCK_EXPIRED_WRITE_OFF_PENDING,
  STOCK_EXPIRY_SOON,
  STOCK_OUT_OF_STOCK,
} from './notification-kinds';
import { NotificationsService } from './notifications.service';

const D = (value: string | number) => new Prisma.Decimal(value);
const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const WAREHOUSE = '33333333-3333-4333-8333-333333333333';
const ITEM = '44444444-4444-4444-8444-444444444444';
const LOT = '55555555-5555-4555-8555-555555555555';
const TODAY = new Date('2026-03-01T00:00:00.000Z');
const days = (offset: number) => new Date(TODAY.getTime() + offset * 86_400_000);

/// The notification centre: what it shows, to whom, and how often it repeats.
///
/// The centre is the one screen that can leak a fact a person is not allowed to
/// know, so the filters are the point: a row is visible only to somebody who
/// holds its permission, whose branch it belongs to, whose role it was
/// addressed to, and whose shelves it sits on. The scanner half is about
/// telling the truth once - the same lot does not shout every hour, and an
/// alert that stopped being true is closed rather than left standing.
describe('notifications', () => {
  type Row = Record<string, any>;

  function fieldMatches(actual: unknown, condition: unknown): boolean {
    if (condition === undefined) return true;
    if (condition === null) return actual === null || actual === undefined;
    if (
      typeof condition !== 'object' ||
      condition instanceof Date ||
      condition instanceof Prisma.Decimal
    ) {
      return actual === condition;
    }
    return Object.entries(condition as Record<string, any>).every(([operator, value]) => {
      switch (operator) {
        case 'in':
          return (value as unknown[]).includes(actual as never);
        case 'notIn':
          return !(value as unknown[]).includes(actual as never);
        case 'not':
          return value === null ? actual !== null && actual !== undefined : actual !== value;
        case 'gt':
          return Number(actual) > Number(value);
        case 'gte':
          return Number(actual) >= Number(value);
        case 'lt':
          return Number(actual) < Number(value);
        case 'lte':
          return Number(actual) <= Number(value);
        case 'has':
          return Array.isArray(actual) && actual.includes(value);
        case 'hasSome':
          return Array.isArray(actual) && (value as unknown[]).some((one) => actual.includes(one));
        case 'isEmpty': {
          const rows = (actual ?? []) as unknown[];
          return value === true ? rows.length === 0 : rows.length > 0;
        }
        default:
          return true;
      }
    });
  }

  function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, condition]) => {
      if (key === 'AND') return (condition as Row[]).every((part) => matches(row, part));
      if (key === 'OR') return (condition as Row[]).some((part) => matches(row, part));
      return fieldMatches(row[key], condition);
    });
  }

  function makeHarness(seed: { notifications?: Row[]; settings?: Row[] } = {}) {
    const state = {
      notifications: (seed.notifications ?? []) as Row[],
      settings: (seed.settings ?? []) as Row[],
      lots: [] as Row[],
      thresholds: [] as Row[],
      onHand: [] as Array<{ warehouseId: string; itemId: string; quantity: string }>,
      audits: [] as Row[],
    };
    let nextId = 1;

    const findNotification = (where: Row): Row | undefined => {
      if (where.companyId_dedupeKey) {
        const key = where.companyId_dedupeKey;
        return state.notifications.find(
          (row) => row.companyId === key.companyId && row.dedupeKey === key.dedupeKey,
        );
      }
      if (where.id) return state.notifications.find((row) => row.id === where.id);
      return state.notifications.find((row) => matches(row, where));
    };

    const sortRows = (rows: Row[], orderBy?: Row[] | Row) => {
      const keys = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
      if (keys.length === 0) return rows;
      return [...rows].sort((left, right) => {
        for (const key of keys) {
          const [field, direction] = Object.entries(key)[0];
          const a = left[field];
          const b = right[field];
          if (a === b) continue;
          const numeric = field === 'severityRank';
          const one = numeric ? Number(a) : new Date(a as string).getTime();
          const two = numeric ? Number(b) : new Date(b as string).getTime();
          return direction === 'desc' ? two - one : one - two;
        }
        return 0;
      });
    };

    const prisma: Record<string, any> = {
      notification: {
        findMany: jest.fn(async (args: Row = {}) => {
          const rows = sortRows(
            state.notifications.filter((row) => matches(row, args.where)),
            args.orderBy,
          );
          const skip = args.skip ?? 0;
          const take = args.take ?? rows.length;
          return rows.slice(skip, skip + take).map((row) => ({ ...row }));
        }),
        count: jest.fn(
          async (args: Row = {}) =>
            state.notifications.filter((row) => matches(row, args.where)).length,
        ),
        findFirst: jest.fn(async (args: Row = {}) => {
          const found = state.notifications.find((row) => matches(row, args.where));
          return found ? { ...found } : null;
        }),
        findUnique: jest.fn(async (args: Row = {}) => {
          const found = findNotification(args.where ?? {});
          return found ? { ...found } : null;
        }),
        upsert: jest.fn(async (args: Row) => {
          const found = findNotification(args.where);
          if (!found) {
            const created = { id: `notification-${nextId++}`, ...args.create };
            state.notifications.push(created);
            return { ...created };
          }
          if (state.notifications.filter((row) => row.dedupeKey === found.dedupeKey).length > 1) {
            throw new Error('duplicate key');
          }
          Object.assign(found, args.update);
          return { ...found };
        }),
        update: jest.fn(async (args: Row) => {
          const found = findNotification(args.where);
          if (!found) throw new Error('missing notification');
          Object.assign(found, args.data);
          return { ...found };
        }),
        updateMany: jest.fn(async (args: Row) => {
          const rows = state.notifications.filter((row) => matches(row, args.where));
          for (const row of rows) Object.assign(row, args.data);
          return { count: rows.length };
        }),
      },
      notificationSetting: {
        findMany: jest.fn(async (args: Row = {}) =>
          state.settings.filter((row) => matches(row, args.where)).map((row) => ({ ...row })),
        ),
        findUnique: jest.fn(async (args: Row = {}) => {
          const key = args.where?.companyId_type;
          const found = state.settings.find(
            (row) => row.companyId === key?.companyId && row.type === key?.type,
          );
          return found ? { ...found } : null;
        }),
        upsert: jest.fn(async (args: Row) => {
          const found = state.settings.find(
            (row) =>
              row.companyId === args.where.companyId_type.companyId &&
              row.type === args.where.companyId_type.type,
          );
          if (found) {
            Object.assign(found, args.update);
            return { ...found };
          }
          const created = { id: `setting-${nextId++}`, ...args.create };
          state.settings.push(created);
          return { ...created };
        }),
      },
      itemBatch: {
        findMany: jest.fn(async (args: Row = {}) =>
          state.lots.filter((row) => matches(row, args.where)),
        ),
      },
      itemWarehouseSetting: {
        findMany: jest.fn(async (args: Row = {}) =>
          state.thresholds.filter((row) => matches(row, args.where)),
        ),
      },
      $queryRaw: jest.fn(async () => state.onHand),
    };

    const service = new NotificationsService(prisma as never);
    return { service, prisma, state };
  }

  const notification = (overrides: Row = {}): Row => ({
    id: 'notification-1',
    companyId: COMPANY,
    branchId: BRANCH,
    warehouseId: WAREHOUSE,
    type: STOCK_EXPIRED,
    severity: 'CRITICAL',
    severityRank: 3,
    status: 'OPEN',
    audienceRoles: [],
    permission: 'inventory.stock.read',
    dedupeKey: 'STOCK_EXPIRED:lot-1',
    titleEn: 'Expired lot',
    titleAr: 'دفعة منتهية',
    bodyEn: null,
    bodyAr: null,
    entityType: 'ItemBatch',
    entityId: LOT,
    entityRef: 'LOT-1',
    actionPath: '/inventory/batches?batch=x',
    dueAt: null,
    lastRaisedAt: TODAY,
    raisedCount: 1,
    readAt: null,
    archivedAt: null,
    createdAt: TODAY,
    ...overrides,
  });

  const user = (overrides: Row = {}): Row => ({
    userId: 'user-1',
    companyId: COMPANY,
    permissions: ['inventory.stock.read'],
    branchIds: [BRANCH],
    roles: [],
    ...overrides,
  });

  // ──────────────────────────────────────────────────────────── reading

  it('shows open and read alerts by default, newest and loudest first', async () => {
    const { service, prisma } = makeHarness({
      notifications: [
        notification({ id: 'a', severityRank: 1, severity: 'INFO', createdAt: days(-3) }),
        notification({ id: 'b', severityRank: 3, createdAt: days(-2) }),
        notification({ id: 'c', severityRank: 2, severity: 'WARNING', createdAt: days(-1) }),
        notification({ id: 'd', status: 'CLOSED', createdAt: days(-4) }),
      ],
    });

    const answer = await service.list(user() as never);

    expect(answer.items.map((row) => row.id)).toEqual(['b', 'c', 'a']);
    expect(answer.total).toBe(3);
    const where = prisma.notification.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['OPEN', 'READ'] });
    expect(where.archivedAt).toBeNull();
    expect(prisma.notification.findMany.mock.calls[0][0].orderBy).toEqual([
      { severityRank: 'desc' },
      { createdAt: 'desc' },
    ]);
  });

  it('keeps the page size sane whatever the caller asks for', async () => {
    const { service, prisma } = makeHarness({ notifications: [notification()] });

    const first = await service.list(user() as never, { page: 0, pageSize: 5000 });
    expect(first.page).toBe(1);
    expect(first.pageSize).toBe(200);
    expect(prisma.notification.findMany.mock.calls[0][0].skip).toBe(0);

    const second = await service.list(user() as never, { page: 3, pageSize: 0 });
    expect(second.pageSize).toBe(1);
    expect(prisma.notification.findMany.mock.calls[1][0].skip).toBe(2);
  });

  it('filters by type and severity when the screen asks', async () => {
    const { service, prisma } = makeHarness({ notifications: [notification()] });

    await service.list(user() as never, { type: 'stock_expired', severity: 'critical' });

    const where = prisma.notification.findMany.mock.calls[0][0].where;
    expect(where.type).toBe('STOCK_EXPIRED');
    expect(where.severity).toBe('CRITICAL');
  });

  it('shows everything when the caller asks for ALL', async () => {
    const { service, prisma } = makeHarness({
      notifications: [notification(), notification({ id: 'archived', status: 'ARCHIVED' })],
    });

    const answer = await service.list(user() as never, { status: 'all' });

    expect(answer.total).toBe(2);
    expect(prisma.notification.findMany.mock.calls[0][0].where.status).toBeUndefined();
  });

  it('hides a row written for a permission the person does not hold', async () => {
    const { service } = makeHarness({
      notifications: [
        notification({ id: 'stock', permission: 'inventory.stock.read' }),
        notification({ id: 'cost', permission: 'inventory.cost.read' }),
        notification({ id: 'public', permission: null }),
      ],
    });

    const answer = await service.list(user() as never);

    expect(answer.items.map((row) => row.id)).toEqual(['stock', 'public']);
  });

  it('hides a row addressed to a role the person does not hold', async () => {
    const { service } = makeHarness({
      notifications: [
        notification({ id: 'everyone', audienceRoles: [] }),
        notification({ id: 'accountants', audienceRoles: ['ACCOUNTANT'] }),
        notification({ id: 'managers', audienceRoles: ['MANAGER', 'OWNER'] }),
      ],
    });

    const answer = await service.list(user({ roles: ['MANAGER'] }) as never);

    expect(answer.items.map((row) => row.id)).toEqual(['everyone', 'managers']);
  });

  it('restricts the list to the branches and shelves the person works in', async () => {
    const otherBranch = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const otherWarehouse = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const { service } = makeHarness({
      notifications: [
        notification({ id: 'mine' }),
        notification({ id: 'other-branch', branchId: otherBranch }),
        notification({ id: 'other-shelf', warehouseId: otherWarehouse }),
        notification({ id: 'company-wide', branchId: null, warehouseId: null }),
      ],
    });

    const answer = await service.list(
      user({ warehouseAccess: [{ warehouseId: WAREHOUSE, canView: true }] }) as never,
    );

    expect(answer.items.map((row) => row.id)).toEqual(['mine', 'company-wide']);
  });

  it('gives a super administrator the whole centre', async () => {
    const { service } = makeHarness({
      notifications: [
        notification({ id: 'mine' }),
        notification({ id: 'elsewhere', branchId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
      ],
    });

    const answer = await service.list(user({ isSuperAdmin: true, branchIds: [] }) as never);

    expect(answer.total).toBe(2);
  });

  it('counts only what the person could open', async () => {
    const { service } = makeHarness({
      notifications: [
        notification({ id: 'open' }),
        notification({ id: 'read', status: 'READ', readAt: TODAY }),
        notification({ id: 'hidden', permission: 'inventory.cost.read' }),
      ],
    });

    expect(await service.unreadCount(user() as never)).toEqual({ unread: 1 });
  });

  it('marks one alert read and keeps the first time it was read', async () => {
    const firstRead = days(-1);
    const { service, state } = makeHarness({
      notifications: [notification({ status: 'READ', readAt: firstRead })],
    });

    const answer = await service.markRead(user() as never, 'notification-1');

    expect(answer.status).toBe('READ');
    expect(answer.isRead).toBe(true);
    expect(state.notifications[0].readAt).toEqual(firstRead);
  });

  it('does not resurrect an archived alert when it is marked read', async () => {
    const { service, state } = makeHarness({
      notifications: [notification({ status: 'ARCHIVED', archivedAt: TODAY })],
    });

    const answer = await service.markRead(user() as never, 'notification-1');

    expect(answer.status).toBe('ARCHIVED');
    expect(state.notifications[0].status).toBe('ARCHIVED');
  });

  it('archives an alert and stamps it', async () => {
    const { service, state } = makeHarness({ notifications: [notification()] });

    const answer = await service.archive(user() as never, 'notification-1');

    expect(answer.status).toBe('ARCHIVED');
    expect(answer.archivedAt).toBeInstanceOf(Date);
    expect(state.notifications[0].archivedAt).toBeInstanceOf(Date);
  });

  it('marks everything visible read, and nothing else', async () => {
    const { service, state } = makeHarness({
      notifications: [
        notification({ id: 'one' }),
        notification({ id: 'two', dedupeKey: 'other' }),
        notification({ id: 'hidden', permission: 'inventory.cost.read' }),
        notification({ id: 'archived', status: 'ARCHIVED' }),
      ],
    });

    const answer = await service.markAllRead(user() as never);

    expect(answer).toEqual({ updated: 2 });
    expect(state.notifications.find((row) => row.id === 'hidden')?.status).toBe('OPEN');
    expect(state.notifications.find((row) => row.id === 'archived')?.status).toBe('ARCHIVED');
  });

  it('reports somebody else’s alert as missing, not as forbidden', async () => {
    // Saying "forbidden" would confirm the alert exists, which is the leak.
    const { service } = makeHarness({
      notifications: [notification({ permission: 'inventory.cost.read' })],
    });

    await expect(service.markRead(user() as never, 'notification-1')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.markRead(user() as never, 'nope')).rejects.toThrow(NotFoundException);
  });

  // ─────────────────────────────────────────────────────────── settings

  it('renders every kind of alert with the default it ships with', async () => {
    const { service } = makeHarness();

    const answer = await service.settings(COMPANY);

    expect(answer.items).toHaveLength(6);
    const expired = answer.items.find((row) => row.type === STOCK_EXPIRED);
    expect(expired).toMatchObject({
      module: 'inventory',
      severity: 'CRITICAL',
      defaultSeverity: 'CRITICAL',
      isEnabled: true,
      repeatAfterHours: 24,
      expiryDays: [90, 60, 30, 7, 0],
    });
    const above = answer.items.find((row) => row.type === STOCK_ABOVE_MAXIMUM);
    expect(above?.repeatAfterHours).toBe(72);
    expect(above?.expiryDays).toEqual([]);
  });

  it('shows a saved setting instead of the default', async () => {
    const { service } = makeHarness({
      settings: [
        {
          companyId: COMPANY,
          type: STOCK_EXPIRY_SOON,
          isEnabled: false,
          severity: 'critical',
          expiryDays: [30, 7],
          repeatAfterHours: 6,
          roles: ['MANAGER'],
          warehouseIds: [WAREHOUSE],
        },
      ],
    });

    const item = (await service.settings(COMPANY)).items.find(
      (row) => row.type === STOCK_EXPIRY_SOON,
    );

    expect(item).toMatchObject({
      isEnabled: false,
      severity: 'critical',
      expiryDays: [30, 7],
      repeatAfterHours: 6,
      roles: ['MANAGER'],
      warehouseIds: [WAREHOUSE],
    });
  });

  it('saves the ranges, the audience and the repeat interval', async () => {
    const { service, prisma } = makeHarness();

    const saved = await service.updateSetting(COMPANY, 'user-1', STOCK_EXPIRY_SOON, {
      isEnabled: true,
      severity: 'warning',
      expiryDays: [7, 30, 30, -4, 4000],
      repeatAfterHours: 12,
      roles: ['MANAGER', '', 'CASHIER'],
      warehouseIds: [WAREHOUSE],
    });

    expect(saved).toMatchObject({
      type: STOCK_EXPIRY_SOON,
      severity: 'WARNING',
      expiryDays: [30, 7],
      repeatAfterHours: 12,
      roles: ['MANAGER', 'CASHIER'],
      warehouseIds: [WAREHOUSE],
    });
    const written = prisma.notificationSetting.upsert.mock.calls[0][0];
    expect(written.where).toEqual({
      companyId_type: { companyId: COMPANY, type: STOCK_EXPIRY_SOON },
    });
    expect(written.create.updatedBy).toBe('user-1');
  });

  it('keeps the repeat interval inside a sensible range', async () => {
    const { service } = makeHarness();

    const tooSoon = await service.updateSetting(COMPANY, 'user-1', STOCK_BELOW_MINIMUM, {
      repeatAfterHours: 0,
    });
    const tooLate = await service.updateSetting(COMPANY, 'user-1', STOCK_BELOW_MINIMUM, {
      repeatAfterHours: 100_000,
    });

    expect(tooSoon?.repeatAfterHours).toBe(1);
    expect(tooLate?.repeatAfterHours).toBe(720);
  });

  it('refuses an unknown alert type or severity', async () => {
    const { service, prisma } = makeHarness();

    await expect(
      service.updateSetting(COMPANY, 'user-1', 'STOCK_IMAGINARY', { isEnabled: true }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateSetting(COMPANY, 'user-1', STOCK_EXPIRED, { severity: 'SHOUTING' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.notificationSetting.upsert).not.toHaveBeenCalled();
  });

  it('does not pretend a non-expiry alert has expiry ranges', async () => {
    const { service } = makeHarness();

    const saved = await service.updateSetting(COMPANY, 'user-1', STOCK_OUT_OF_STOCK, {
      expiryDays: [30],
    });

    expect(saved?.expiryDays).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────── raising

  it('writes one fact once, with the kind’s own permission and loudness', async () => {
    const { service, state } = makeHarness();

    const answer = await service.raise({
      companyId: COMPANY,
      type: STOCK_EXPIRED_WRITE_OFF_PENDING,
      titleEn: 'Write-off needed',
      titleAr: 'إعدام مطلوب',
      branchId: BRANCH,
      warehouseId: WAREHOUSE,
      entityId: LOT,
      dedupe: `STOCK_EXPIRED_WRITE_OFF_PENDING:${LOT}`,
    });

    expect(answer).toEqual({ id: expect.any(String) });
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]).toMatchObject({
      type: STOCK_EXPIRED_WRITE_OFF_PENDING,
      severity: 'CRITICAL',
      severityRank: 3,
      permission: 'inventory.batches.writeoff',
      status: 'OPEN',
      raisedCount: 1,
      entityType: 'ItemBatch',
    });
  });

  it('says nothing when the company switched the kind off', async () => {
    const { service, state } = makeHarness({
      settings: [
        { companyId: COMPANY, type: STOCK_EXPIRED, isEnabled: false, warehouseIds: [], roles: [] },
      ],
    });

    const answer = await service.raise({
      companyId: COMPANY,
      type: STOCK_EXPIRED,
      titleEn: 'Expired',
      titleAr: 'منتهية',
      dedupe: 'STOCK_EXPIRED:x',
    });

    expect(answer).toBeNull();
    expect(state.notifications).toHaveLength(0);
  });

  it('says nothing about a warehouse the setting excludes', async () => {
    const other = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const { service, state } = makeHarness({
      settings: [
        { companyId: COMPANY, type: STOCK_EXPIRED, isEnabled: true, warehouseIds: [other], roles: [] },
      ],
    });

    const answer = await service.raise({
      companyId: COMPANY,
      type: STOCK_EXPIRED,
      titleEn: 'Expired',
      titleAr: 'منتهية',
      warehouseId: WAREHOUSE,
      dedupe: 'STOCK_EXPIRED:x',
    });

    expect(answer).toBeNull();
    expect(state.notifications).toHaveLength(0);
  });

  it('keeps a still-true alert quiet until its repeat interval passes', async () => {
    // Ten minutes later, the same lot: the wording may improve, the row must
    // not look new, and the person must not be woken again.
    const { service, state } = makeHarness({
      notifications: [
        notification({
          status: 'READ',
          readAt: new Date(Date.now() - 600_000),
          lastRaisedAt: new Date(Date.now() - 600_000),
          raisedCount: 1,
        }),
      ],
    });

    await service.raise({
      companyId: COMPANY,
      type: STOCK_EXPIRED,
      titleEn: 'Expired lot (better wording)',
      titleAr: 'دفعة منتهية',
      dedupe: 'STOCK_EXPIRED:lot-1',
    });

    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0].status).toBe('READ');
    expect(state.notifications[0].raisedCount).toBe(1);
    expect(state.notifications[0].titleEn).toBe('Expired lot (better wording)');
  });

  it('re-opens an alert nobody acted on once the interval has passed', async () => {
    const { service, state } = makeHarness({
      notifications: [
        notification({
          status: 'READ',
          readAt: new Date(Date.now() - 30 * 3_600_000),
          lastRaisedAt: new Date(Date.now() - 30 * 3_600_000),
          raisedCount: 2,
        }),
      ],
    });

    await service.raise({
      companyId: COMPANY,
      type: STOCK_EXPIRED,
      titleEn: 'Expired lot again',
      titleAr: 'دفعة منتهية',
      dedupe: 'STOCK_EXPIRED:lot-1',
    });

    expect(state.notifications[0].status).toBe('OPEN');
    expect(state.notifications[0].readAt).toBeNull();
    expect(state.notifications[0].raisedCount).toBe(3);
  });

  it('does not re-open an archived alert', async () => {
    const { service, state } = makeHarness({
      notifications: [
        notification({
          status: 'ARCHIVED',
          archivedAt: days(-5),
          lastRaisedAt: days(-5),
          raisedCount: 4,
        }),
      ],
    });

    await service.raise({
      companyId: COMPANY,
      type: STOCK_EXPIRED,
      titleEn: 'Expired lot',
      titleAr: 'دفعة منتهية',
      dedupe: 'STOCK_EXPIRED:lot-1',
    });

    expect(state.notifications[0].status).toBe('ARCHIVED');
    expect(state.notifications[0].raisedCount).toBe(4);
  });

  it('treats a lost race with another scanner as nothing to do', async () => {
    const { service, prisma } = makeHarness();
    prisma.notification.upsert.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
        meta: {},
      }),
    );

    const answer = await service.raise({
      companyId: COMPANY,
      type: STOCK_EXPIRED,
      titleEn: 'Expired',
      titleAr: 'منتهية',
      dedupe: 'STOCK_EXPIRED:x',
    });

    expect(answer).toBeNull();
  });

  // ──────────────────────────────────────────────────────────── scanning

  const lot = (overrides: Row = {}): Row => ({
    id: LOT,
    companyId: COMPANY,
    batchNumber: 'LOT-1',
    expiryDate: days(5),
    remainingQuantity: D('10'),
    unitCost: D('2'),
    status: 'OPEN',
    branchId: BRANCH,
    warehouseId: WAREHOUSE,
    item: { id: ITEM, code: 'MILK', nameEn: 'Milk', nameAr: 'حليب' },
    ...overrides,
  });

  it('warns about a lot that is close to expiry, once per band', async () => {
    const { service, state } = makeHarness();
    state.lots = [lot({ expiryDate: days(5) })];

    const first = await service.scanStock(COMPANY, TODAY);
    const second = await service.scanStock(COMPANY, TODAY);

    expect(first.raised).toBe(1);
    expect(second.raised).toBe(1);
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0].type).toBe(STOCK_EXPIRY_SOON);
    expect(state.notifications[0].dedupeKey).toBe(`STOCK_EXPIRY_SOON:${LOT}:IN_7`);
    expect(state.notifications[0].dueAt).toEqual(days(5));
  });

  it('tells both the storekeeper and the accountant that a lot has expired', async () => {
    const { service, state } = makeHarness();
    state.lots = [lot({ expiryDate: days(-2) })];

    const answer = await service.scanStock(COMPANY, TODAY);

    expect(answer.raised).toBe(2);
    expect(state.notifications.map((row) => row.type).sort()).toEqual([
      STOCK_EXPIRED,
      STOCK_EXPIRED_WRITE_OFF_PENDING,
    ]);
    // The two rows are addressed to different permissions on purpose.
    expect(state.notifications.map((row) => row.permission).sort()).toEqual([
      'inventory.batches.writeoff',
      'inventory.stock.read',
    ]);
  });

  it('closes the expiry warning once the lot has expired', async () => {
    const { service, state } = makeHarness({
      notifications: [
        notification({
          id: 'warning',
          type: STOCK_EXPIRY_SOON,
          severity: 'WARNING',
          severityRank: 2,
          permission: 'inventory.stock.read',
          dedupeKey: `STOCK_EXPIRY_SOON:${LOT}:IN_7`,
        }),
      ],
    });
    state.lots = [lot({ expiryDate: days(-2) })];

    const answer = await service.scanStock(COMPANY, TODAY);

    expect(answer.closed).toBe(1);
    expect(state.notifications.find((row) => row.id === 'warning')?.status).toBe('CLOSED');
  });

  it('raises an out-of-stock alert and does not also call it below minimum', async () => {
    const { service, state } = makeHarness();
    state.lots = [];
    state.thresholds = [
      {
        companyId: COMPANY,
        warehouseId: WAREHOUSE,
        minQuantity: D('5'),
        reorderQuantity: D('8'),
        maxQuantity: D('20'),
        item: { id: ITEM, code: 'MILK', nameEn: 'Milk', nameAr: 'حليب', isActive: true, deletedAt: null },
        warehouse: { branchId: BRANCH, isActive: true, deletedAt: null },
      },
    ];
    state.onHand = [{ warehouseId: WAREHOUSE, itemId: ITEM, quantity: '0' }];

    const answer = await service.scanStock(COMPANY, TODAY);

    expect(answer.raised).toBe(1);
    expect(state.notifications[0].type).toBe(STOCK_OUT_OF_STOCK);
    expect(state.notifications[0].entityRef).toBe('MILK');
  });

  it('raises below-minimum and above-maximum against the shelf’s own figures', async () => {
    const { service, state } = makeHarness();
    state.lots = [];
    state.thresholds = [
      {
        companyId: COMPANY,
        warehouseId: WAREHOUSE,
        minQuantity: D('5'),
        reorderQuantity: D('8'),
        maxQuantity: D('20'),
        item: { id: ITEM, code: 'MILK', nameEn: 'Milk', nameAr: 'حليب', isActive: true, deletedAt: null },
        warehouse: { branchId: BRANCH, isActive: true, deletedAt: null },
      },
      {
        companyId: COMPANY,
        warehouseId: WAREHOUSE,
        minQuantity: D('5'),
        reorderQuantity: D('8'),
        maxQuantity: D('20'),
        item: { id: 'item-2', code: 'TEA', nameEn: 'Tea', nameAr: 'شاي', isActive: true, deletedAt: null },
        warehouse: { branchId: BRANCH, isActive: true, deletedAt: null },
      },
    ];
    state.onHand = [
      { warehouseId: WAREHOUSE, itemId: ITEM, quantity: '3' },
      { warehouseId: WAREHOUSE, itemId: 'item-2', quantity: '40' },
    ];

    const answer = await service.scanStock(COMPANY, TODAY);

    expect(answer.raised).toBe(2);
    expect(state.notifications.map((row) => row.type).sort()).toEqual([
      STOCK_ABOVE_MAXIMUM,
      STOCK_BELOW_MINIMUM,
    ]);
  });

  it('leaves a discontinued item and a closed warehouse alone', async () => {
    const { service, state } = makeHarness();
    state.lots = [];
    state.thresholds = [
      {
        companyId: COMPANY,
        warehouseId: WAREHOUSE,
        minQuantity: D('5'),
        reorderQuantity: D('0'),
        maxQuantity: D('0'),
        item: { id: ITEM, code: 'OLD', nameEn: 'Old', nameAr: 'قديم', isActive: false, deletedAt: null },
        warehouse: { branchId: BRANCH, isActive: true, deletedAt: null },
      },
      {
        companyId: COMPANY,
        warehouseId: WAREHOUSE,
        minQuantity: D('5'),
        reorderQuantity: D('0'),
        maxQuantity: D('0'),
        item: { id: 'item-3', code: 'X', nameEn: 'X', nameAr: 'س', isActive: true, deletedAt: null },
        warehouse: { branchId: BRANCH, isActive: false, deletedAt: null },
      },
    ];
    state.onHand = [];

    const answer = await service.scanStock(COMPANY, TODAY);

    expect(answer.raised).toBe(0);
    expect(state.notifications).toHaveLength(0);
  });

  it('respects a switched-off kind while still closing what it used to say', async () => {
    const { service, state } = makeHarness({
      settings: [
        {
          companyId: COMPANY,
          type: STOCK_EXPIRY_SOON,
          isEnabled: false,
          warehouseIds: [],
          roles: [],
          expiryDays: [30],
        },
      ],
      notifications: [
        notification({
          id: 'old-warning',
          type: STOCK_EXPIRY_SOON,
          dedupeKey: `STOCK_EXPIRY_SOON:${LOT}:IN_30`,
          severity: 'WARNING',
          severityRank: 2,
        }),
      ],
    });
    state.lots = [lot({ expiryDate: days(5) })];

    const answer = await service.scanStock(COMPANY, TODAY);

    expect(answer.raised).toBe(0);
    expect(state.notifications.find((row) => row.id === 'old-warning')?.status).toBe('CLOSED');
  });

  it('reads the expiry horizons from the saved setting', async () => {
    const { service, state } = makeHarness({
      settings: [
        {
          companyId: COMPANY,
          type: STOCK_EXPIRY_SOON,
          isEnabled: true,
          warehouseIds: [],
          roles: [],
          expiryDays: [365],
        },
      ],
    });
    state.lots = [lot({ expiryDate: days(200) })];

    const answer = await service.scanStock(COMPANY, TODAY);

    expect(answer.raised).toBe(1);
    expect(state.notifications[0].dedupeKey).toBe(`STOCK_EXPIRY_SOON:${LOT}:LATER`);
  });

  it('reports how many kinds of alert the program knows', async () => {
    const { service } = makeHarness();

    const answer = await service.scanStock(COMPANY, TODAY);

    expect(answer).toEqual({ raised: 0, closed: 0, types: 6 });
  });
});
