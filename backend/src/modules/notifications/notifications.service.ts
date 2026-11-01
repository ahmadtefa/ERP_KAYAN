import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import {
  DEFAULT_EXPIRY_DAYS,
  batchPolicyOf,
  dayOnly,
  daysUntil,
  expiryBand,
  normalizeExpiryDays,
} from '../../common/warehouse/batch-policy';
import {
  NOTIFICATION_KINDS,
  STOCK_ABOVE_MAXIMUM,
  STOCK_BELOW_MINIMUM,
  STOCK_EXPIRED,
  STOCK_EXPIRED_WRITE_OFF_PENDING,
  STOCK_EXPIRY_SOON,
  STOCK_OUT_OF_STOCK,
  assertKnownKind,
  dedupeKey,
  notificationKind,
} from './notification-kinds';

/// Who is asking. The centre shows a person what their permissions allow and
/// nothing else: an alert that names a value is as sensitive as the value.
export interface NotificationUser {
  userId: string;
  companyId: string;
  permissions: string[];
  branchIds?: string[] | null;
  branchId?: string | null;
  isSuperAdmin?: boolean;
  /// Role codes the person holds. A setting that names roles addresses only
  /// those people; an alert raised yesterday keeps the audience it was raised
  /// for, because the row stores the list it was addressed to.
  roles?: string[] | null;
  warehouseAccess?: Array<{ warehouseId: string; canView: boolean }> | null;
}

/// 1, 2, 3. Sorting the word alphabetically puts WARNING behind INFO.
const RANK: Record<string, number> = { INFO: 1, WARNING: 2, CRITICAL: 3 };

export interface RaiseInput {
  companyId: string;
  type: string;
  titleEn: string;
  titleAr: string;
  bodyEn?: string | null;
  bodyAr?: string | null;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL' | null;
  branchId?: string | null;
  warehouseId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  entityRef?: string | null;
  actionPath?: string | null;
  dedupe: string;
  dueAt?: Date | null;
}

interface SettingRow {
  isEnabled?: boolean | null;
  severity?: string | null;
  roles?: unknown;
  warehouseIds?: unknown;
  expiryDays?: unknown;
  repeatAfterHours?: number | null;
}

/// The program's one notification centre.
///
/// Stock is the first module to write here, and the design assumes it will not
/// be the last: a row says what happened, how loud it is, which document it
/// belongs to and which permission is needed to see it. The screens never ask
/// "is this a stock alert?" - they ask for the list.
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────── reading

  /// The list, newest and loudest first, filtered by what the user may see.
  async list(
    user: NotificationUser,
    query: {
      status?: string;
      type?: string;
      severity?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
    const where: Prisma.NotificationWhereInput = { companyId: user.companyId };

    const status = (query.status ?? 'OPEN').toUpperCase();
    if (status !== 'ALL') {
      if (status === 'OPEN') {
        where.status = { in: ['OPEN', 'READ'] };
        where.archivedAt = null;
      } else {
        where.status = status;
      }
    }
    if (query.type) where.type = query.type.toUpperCase();
    if (query.severity) where.severity = query.severity.toUpperCase();

    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { ...where, ...this.visibleTo(user) },
        // CRITICAL before WARNING before INFO, then the newest. The rank is a
        // number because sorting the word alphabetically puts WARNING last.
        orderBy: [{ severityRank: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where: { ...where, ...this.visibleTo(user) } }),
    ]);

    return {
      items: rows.map((row) => this.toResponse(row)),
      total,
      page,
      pageSize,
    };
  }

  /// How many are waiting. This is the badge in the top bar, so it is one
  /// query and it counts only what this person could open.
  async unreadCount(user: NotificationUser) {
    const count = await this.prisma.notification.count({
      where: {
        companyId: user.companyId,
        status: 'OPEN',
        archivedAt: null,
        ...this.visibleTo(user),
      },
    });
    return { unread: count };
  }

  async markRead(user: NotificationUser, id: string) {
    const row = await this.require(user, id);
    if (row.status === 'ARCHIVED') {
      return this.toResponse(row);
    }
    const updated = await this.prisma.notification.update({
      where: { id: row.id },
      data: { status: 'READ', readAt: row.readAt ?? new Date() },
    });
    return this.toResponse(updated);
  }

  async archive(user: NotificationUser, id: string) {
    const row = await this.require(user, id);
    const updated = await this.prisma.notification.update({
      where: { id: row.id },
      data: { status: 'ARCHIVED', archivedAt: new Date(), readAt: row.readAt ?? new Date() },
    });
    return this.toResponse(updated);
  }

  async markAllRead(user: NotificationUser) {
    const result = await this.prisma.notification.updateMany({
      where: {
        companyId: user.companyId,
        status: 'OPEN',
        archivedAt: null,
        ...this.visibleTo(user),
      },
      data: { status: 'READ', readAt: new Date() },
    });
    return { updated: result.count };
  }

  /// Only rows this person could open, and only those whose permission they
  /// hold. A user with no `inventory.cost.read` still sees that a lot expired;
  /// they do not see a row that was written for a permission they lack.
  private visibleTo(user: NotificationUser): Prisma.NotificationWhereInput {
    if (user.isSuperAdmin) return {};
    const scopes = (user.branchIds ?? []).filter(Boolean);
    // Two filters, and both matter: the branch the row belongs to, and the
    // permission it was written for. An alert about a costed lot is as
    // sensitive as the cost, so a person without `inventory.stock.read` must
    // not learn it exists by counting badges.
    const branch =
      scopes.length > 0
        ? { OR: [{ branchId: null }, { branchId: { in: scopes } }] }
        : user.branchId
          ? { OR: [{ branchId: null }, { branchId: user.branchId }] }
          : {};
    const permission = user.permissions.length
      ? { OR: [{ permission: null }, { permission: { in: user.permissions } }] }
      : { permission: null };
    // A row addressed to roles is invisible to everybody else; a row with no
    // audience list is for whoever holds the permission.
    const roles = (user.roles ?? []).filter(Boolean);
    const audience: Prisma.NotificationWhereInput =
      roles.length > 0
        ? { OR: [{ audienceRoles: { isEmpty: true } }, { audienceRoles: { hasSome: roles } }] }
        : { audienceRoles: { isEmpty: true } };
    // A person restricted to certain shelves is not told about the others.
    const grants = (user.warehouseAccess ?? []).filter((row) => row && row.canView);
    const warehouse: Prisma.NotificationWhereInput =
      grants.length > 0
        ? {
            OR: [
              { warehouseId: null },
              { warehouseId: { in: grants.map((row) => row.warehouseId) } },
            ],
          }
        : {};
    return { AND: [branch, permission, audience, warehouse] };
  }

  private maySee(user: NotificationUser, permission: string | null): boolean {
    if (!permission) return true;
    if (user.isSuperAdmin) return true;
    return user.permissions.includes(permission);
  }

  private async require(user: NotificationUser, id: string) {
    const row = await this.prisma.notification.findFirst({
      where: { id, companyId: user.companyId },
    });
    if (!row) throw new NotFoundException('Notification not found');
    if (!this.maySee(user, row.permission)) {
      // Not theirs to know about: reported as missing rather than forbidden.
      throw new NotFoundException('Notification not found');
    }
    return row;
  }

  private toResponse(row: {
    id: string;
    type: string;
    severity: string;
    status: string;
    titleEn: string;
    titleAr: string;
    bodyEn: string | null;
    bodyAr: string | null;
    entityType: string | null;
    entityId: string | null;
    entityRef: string | null;
    actionPath: string | null;
    permission: string | null;
    dueAt: Date | null;
    createdAt: Date;
    readAt: Date | null;
    archivedAt: Date | null;
    branchId: string | null;
    warehouseId: string | null;
  }) {
    return {
      id: row.id,
      type: row.type,
      severity: row.severity,
      status: row.status,
      titleEn: row.titleEn,
      titleAr: row.titleAr,
      bodyEn: row.bodyEn,
      bodyAr: row.bodyAr,
      entityType: row.entityType,
      entityId: row.entityId,
      entityRef: row.entityRef,
      actionPath: row.actionPath,
      dueAt: row.dueAt,
      createdAt: row.createdAt,
      readAt: row.readAt,
      archivedAt: row.archivedAt,
      branchId: row.branchId,
      warehouseId: row.warehouseId,
      isRead: row.status !== 'OPEN' || row.readAt !== null,
    };
  }

  // ────────────────────────────────────────────────────────────── settings

  async settings(companyId: string) {
    const rows = await this.prisma.notificationSetting.findMany({ where: { companyId } });
    const byType = new Map(rows.map((row) => [row.type, row]));
    return {
      items: NOTIFICATION_KINDS.map((kind) => {
        const setting = byType.get(kind.type) as SettingRow | undefined;
        return {
          type: kind.type,
          module: kind.module,
          defaultSeverity: kind.severity,
          severity: setting?.severity ?? kind.severity,
          isEnabled: setting?.isEnabled ?? true,
          warehouseIds: Array.isArray(setting?.warehouseIds) ? setting?.warehouseIds : [],
          roles: Array.isArray(setting?.roles) ? setting?.roles : [],
          expiryDays:
            kind.type === STOCK_EXPIRY_SOON || kind.type === STOCK_EXPIRED
              ? normalizeExpiryDays(setting?.expiryDays)
              : [],
          repeatAfterHours:
            setting?.repeatAfterHours ?? kind.repeatAfterHours ?? 24,
        };
      }),
    };
  }

  async updateSetting(
    companyId: string,
    userId: string,
    type: string,
    dto: {
      isEnabled?: boolean;
      severity?: string | null;
      warehouseIds?: string[];
      expiryDays?: number[];
      repeatAfterHours?: number;
      roles?: string[];
    },
  ) {
    const kind = assertKnownKind(type);
    const severity = dto.severity ? String(dto.severity).toUpperCase() : undefined;
    if (severity && !['INFO', 'WARNING', 'CRITICAL'].includes(severity)) {
      throw new NotFoundException(`Unknown severity: ${dto.severity}`);
    }
    const data = {
      isEnabled: dto.isEnabled ?? true,
      severity: severity ?? null,
      warehouseIds: dto.warehouseIds ?? [],
      expiryDays:
        kind.type === STOCK_EXPIRY_SOON || kind.type === STOCK_EXPIRED
          ? normalizeExpiryDays(dto.expiryDays)
          : [],
      repeatAfterHours: Math.min(Math.max(dto.repeatAfterHours ?? 24, 1), 24 * 30),
      roles: Array.isArray(dto.roles)
        ? dto.roles.filter((role) => typeof role === 'string' && role.length > 0)
        : [],
      updatedBy: userId,
    };
    await this.prisma.notificationSetting.upsert({
      where: { companyId_type: { companyId, type: kind.type } },
      create: { companyId, type: kind.type, ...data },
      update: data,
    });
    return this.settings(companyId).then((result) =>
      result.items.find((row) => row.type === kind.type),
    );
  }

  // ─────────────────────────────────────────────────────────────── raising

  /// Records one fact, once.
  ///
  /// The unique index on `(companyId, dedupeKey)` is the duplicate policy: the
  /// scanner may decide the same thing every hour, and the second, third and
  /// hundredth decisions update the existing row instead of adding a wall of
  /// identical alarms. Returns null when the company switched the kind off or
  /// restricted it to a warehouse this fact is not in.
  async raise(input: RaiseInput): Promise<{ id: string } | null> {
    const kind = notificationKind(input.type);
    const setting = (await this.prisma.notificationSetting.findUnique({
      where: { companyId_type: { companyId: input.companyId, type: input.type } },
      select: {
        isEnabled: true,
        severity: true,
        warehouseIds: true,
        repeatAfterHours: true,
        roles: true,
      } as never,
    })) as SettingRow | null;

    if (setting && setting.isEnabled === false) return null;
    const allowed = Array.isArray(setting?.warehouseIds)
      ? (setting?.warehouseIds as string[])
      : [];
    if (allowed.length > 0 && input.warehouseId && !allowed.includes(input.warehouseId)) {
      return null;
    }

    const severity = (setting?.severity ?? kind?.severity ?? input.severity ?? 'INFO') as
      | 'INFO'
      | 'WARNING'
      | 'CRITICAL';
    const audienceRoles = Array.isArray(setting?.roles)
      ? (setting?.roles as unknown[]).filter((role): role is string => typeof role === 'string')
      : [];
    const repeatAfterHours = Math.max(Number(setting?.repeatAfterHours ?? 24), 1);

    // How long a still-true fact stays quiet. The row is not duplicated; it is
    // re-opened once the setting's interval has passed, so a warning nobody
    // acted on comes back instead of disappearing under newer news.
    const existing = await this.prisma.notification.findUnique({
      where: { companyId_dedupeKey: { companyId: input.companyId, dedupeKey: input.dedupe } },
      select: { id: true, status: true, lastRaisedAt: true, raisedCount: true },
    });
    const dueForRepeat =
      existing !== null &&
      existing.status !== 'ARCHIVED' &&
      (existing.lastRaisedAt === null ||
        Date.now() - existing.lastRaisedAt.getTime() >= repeatAfterHours * 3_600_000);

    try {
      const row = await this.prisma.notification.upsert({
        where: {
          companyId_dedupeKey: { companyId: input.companyId, dedupeKey: input.dedupe },
        },
        create: {
          companyId: input.companyId,
          branchId: input.branchId ?? null,
          warehouseId: input.warehouseId ?? null,
          type: input.type,
          severity,
          severityRank: RANK[severity] ?? 1,
          audienceRoles,
          lastRaisedAt: new Date(),
          raisedCount: 1,
          status: 'OPEN',
          titleEn: input.titleEn,
          titleAr: input.titleAr,
          bodyEn: input.bodyEn ?? null,
          bodyAr: input.bodyAr ?? null,
          entityType: input.entityType ?? kind?.entityType ?? null,
          entityId: input.entityId ?? null,
          entityRef: input.entityRef ?? null,
          actionPath: input.actionPath ?? null,
          permission: kind?.permission ?? null,
          dedupeKey: input.dedupe,
          dueAt: input.dueAt ?? null,
        },
        // The fact is unchanged; its wording may not be. Re-opening a row a
        // person already read would be a lie about "new" - unless the setting
        // says this alert repeats, in which case it is a fresh prompt on
        // purpose and the count says how many times it has been asked.
        update: dueForRepeat
          ? {
              titleEn: input.titleEn,
              titleAr: input.titleAr,
              bodyEn: input.bodyEn ?? null,
              bodyAr: input.bodyAr ?? null,
              severity,
              severityRank: RANK[severity] ?? 1,
              lastRaisedAt: new Date(),
              raisedCount: (existing?.raisedCount ?? 0) + 1,
              status: 'OPEN',
              readAt: null,
            }
          : {
              titleEn: input.titleEn,
              titleAr: input.titleAr,
              severity,
              severityRank: RANK[severity] ?? 1,
              lastRaisedAt: new Date(),
            },
      });
      return { id: row.id };
    } catch (error) {
      // A race between two scanners is the one case the upsert cannot settle
      // by itself: the loser has nothing to do.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }
      throw error;
    }
  }

  // ───────────────────────────────────────────────────────────── the scanner

  /// Walks today's stock and raises what a person needs to know.
  ///
  /// Pure decision, database-shaped input: the lots, their dates, and the
  /// thresholds per warehouse. Everything it decides is a row in the centre;
  /// nothing it decides changes stock, which is why it is safe to run it as
  /// often as the settings allow.
  async scanStock(companyId: string, today: Date = new Date()) {
    const settingRows = await this.prisma.notificationSetting.findMany({
      where: { companyId },
    });
    const settings = new Map<string, SettingRow>(
      settingRows.map((row) => [String(row.type), row as unknown as SettingRow]),
    );
    const enabled = (type: string) => settings.get(type)?.isEnabled !== false;
    const expiryDays = normalizeExpiryDays(
      settings.get(STOCK_EXPIRY_SOON)?.expiryDays ?? DEFAULT_EXPIRY_DAYS,
    );
    const widest = Math.max(...expiryDays, 0);

    let raised = 0;
    // Every key this pass decided is still true. Anything of the same kind that
    // is open and not in these lists describes a fact that has stopped being
    // true - a lot that expired yesterday, an item that has been replenished -
    // and is closed below instead of staying in the centre next to the news
    // that replaced it.
    const keep = new Map<string, Set<string>>();
    const stillTrue = (type: string, dedupe: string) => {
      const set = keep.get(type) ?? new Set<string>();
      set.add(dedupe);
      keep.set(type, set);
    };

    // ── lots: expiring, expired, and expired-but-still-on-the-shelf ──
    if (enabled(STOCK_EXPIRY_SOON) || enabled(STOCK_EXPIRED)) {
      const horizon = new Date(dayOnly(today).getTime() + (widest + 1) * 86_400_000);
      const lots = await this.prisma.itemBatch.findMany({
        where: {
          companyId,
          deletedAt: null,
          expiryDate: { not: null, lte: horizon },
          remainingQuantity: { gt: 0 },
          status: { in: ['OPEN', 'QUARANTINE', 'EXPIRED'] },
        },
        select: {
          id: true,
          batchNumber: true,
          expiryDate: true,
          remainingQuantity: true,
          unitCost: true,
          status: true,
          branchId: true,
          warehouseId: true,
          item: { select: { code: true, nameEn: true, nameAr: true, id: true } },
        },
        orderBy: { expiryDate: 'asc' },
        take: 5000,
      });

      for (const lot of lots) {
        const days = daysUntil(lot.expiryDate!, today);
        const band = expiryBand(lot.expiryDate!, today);
        const value = Number(lot.remainingQuantity) * Number(lot.unitCost);
        const base = {
          companyId,
          branchId: lot.branchId,
          warehouseId: lot.warehouseId,
          entityId: lot.id,
          entityRef: lot.batchNumber,
          actionPath: `/inventory/batches?batch=${lot.id}`,
          dueAt: lot.expiryDate,
        };

        if (days < 0) {
          stillTrue(STOCK_EXPIRED, dedupeKey({ type: STOCK_EXPIRED, entityId: lot.id }));
        }
        if (days < 0 && enabled(STOCK_EXPIRED)) {
          await this.raise({
            ...base,
            type: STOCK_EXPIRED,
            titleEn: `Expired lot ${lot.batchNumber} of ${lot.item.nameEn}`,
            titleAr: `دفعة منتهية ${lot.batchNumber} من ${lot.item.nameAr}`,
            bodyEn:
              `${lot.remainingQuantity} still on the shelf, worth ${value.toFixed(2)}. ` +
              'It may not be sold until it is written off.',
            bodyAr:
              `المتبقي ${lot.remainingQuantity} بقيمة ${value.toFixed(2)}. ` +
              'لا يجوز بيعه حتى يتم إعدامه.',
            dedupe: dedupeKey({ type: STOCK_EXPIRED, entityId: lot.id }),
          });
          raised += 1;

          // The same fact, but for the person who can do something about it.
          stillTrue(
            STOCK_EXPIRED_WRITE_OFF_PENDING,
            dedupeKey({ type: STOCK_EXPIRED_WRITE_OFF_PENDING, entityId: lot.id }),
          );
          if (enabled(STOCK_EXPIRED_WRITE_OFF_PENDING)) {
            await this.raise({
              ...base,
              type: STOCK_EXPIRED_WRITE_OFF_PENDING,
              titleEn: `Write-off needed: ${lot.batchNumber}`,
              titleAr: `إعدام مطلوب: ${lot.batchNumber}`,
              bodyEn: `${lot.remainingQuantity} of ${lot.item.nameEn} expired and is still in stock.`,
              bodyAr: `${lot.remainingQuantity} من ${lot.item.nameAr} منتهية ولا تزال في المخزن.`,
              dedupe: dedupeKey({ type: STOCK_EXPIRED_WRITE_OFF_PENDING, entityId: lot.id }),
            });
            raised += 1;
          }
          continue;
        }

        if (days >= 0 && days <= widest) {
          stillTrue(
            STOCK_EXPIRY_SOON,
            dedupeKey({ type: STOCK_EXPIRY_SOON, entityId: lot.id, suffix: band }),
          );
        }
        if (days >= 0 && days <= widest && enabled(STOCK_EXPIRY_SOON)) {
          await this.raise({
            ...base,
            type: STOCK_EXPIRY_SOON,
            titleEn: `Lot ${lot.batchNumber} of ${lot.item.nameEn} expires in ${days} day(s)`,
            titleAr: `دفعة ${lot.batchNumber} من ${lot.item.nameAr} تنتهي خلال ${days} يوم`,
            bodyEn: `${lot.remainingQuantity} at ${lot.expiryDate!.toISOString().slice(0, 10)}.`,
            bodyAr: `${lot.remainingQuantity} بتاريخ ${lot.expiryDate!.toISOString().slice(0, 10)}.`,
            // The band, not the count: the same warning is not raised again
            // every day until it moves into the next band.
            dedupe: dedupeKey({
              type: STOCK_EXPIRY_SOON,
              entityId: lot.id,
              suffix: band,
            }),
          });
          raised += 1;
        }
      }
    }

    // ── thresholds, per warehouse, for items that have a policy ──
    if (enabled(STOCK_BELOW_MINIMUM) || enabled(STOCK_OUT_OF_STOCK) || enabled(STOCK_ABOVE_MAXIMUM)) {
      const thresholds = await this.prisma.itemWarehouseSetting.findMany({
        where: {
          companyId,
          OR: [
            { minQuantity: { gt: 0 } },
            { reorderQuantity: { gt: 0 } },
            { maxQuantity: { gt: 0 } },
          ],
        },
        select: {
          warehouseId: true,
          minQuantity: true,
          reorderQuantity: true,
          maxQuantity: true,
          item: {
            select: {
              id: true,
              code: true,
              nameEn: true,
              nameAr: true,
              isActive: true,
              deletedAt: true,
            },
          },
          warehouse: { select: { branchId: true, isActive: true, deletedAt: true } },
        },
        take: 5000,
      });

      // One grouped read rather than a query per item: a shop with four
      // thousand items and three stores must not cost twelve thousand round
      // trips to answer "is anything low?".
      const onHand = await this.prisma.$queryRaw<
        Array<{ warehouseId: string; itemId: string; quantity: Prisma.Decimal }>
      >(Prisma.sql`
        SELECT "warehouseId", "itemId", SUM(
          CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END
        ) AS "quantity"
          FROM "stock_movements"
         WHERE "companyId" = ${companyId}::uuid
           AND "warehouseId" IS NOT NULL
         GROUP BY "warehouseId", "itemId"
      `);
      const quantityAt = new Map(
        onHand.map((row) => [`${row.warehouseId}:${row.itemId}`, new Prisma.Decimal(row.quantity)]),
      );

      for (const row of thresholds) {
        if (!row.item.isActive || row.item.deletedAt) continue;
        if (!row.warehouse || row.warehouse.deletedAt || !row.warehouse.isActive) continue;
        const onHandNow =
          quantityAt.get(`${row.warehouseId}:${row.item.id}`) ?? new Prisma.Decimal(0);
        const base = {
          companyId,
          branchId: row.warehouse.branchId,
          warehouseId: row.warehouseId,
          entityId: row.item.id,
          entityRef: row.item.code,
          actionPath: `/inventory/items?item=${row.item.id}`,
        };

        if (onHandNow.isZero()) {
          stillTrue(
            STOCK_OUT_OF_STOCK,
            dedupeKey({ type: STOCK_OUT_OF_STOCK, entityId: `${row.warehouseId}:${row.item.id}` }),
          );
        }
        if (onHandNow.isZero() && enabled(STOCK_OUT_OF_STOCK)) {
          await this.raise({
            ...base,
            type: STOCK_OUT_OF_STOCK,
            titleEn: `${row.item.nameEn} is out of stock`,
            titleAr: `${row.item.nameAr} رصيده صفر`,
            bodyEn: `Nothing left in this warehouse. Minimum is ${row.minQuantity}.`,
            bodyAr: `لا يوجد رصيد في هذا المخزن. الحد الأدنى ${row.minQuantity}.`,
            dedupe: dedupeKey({
              type: STOCK_OUT_OF_STOCK,
              entityId: `${row.warehouseId}:${row.item.id}`,
            }),
          });
          raised += 1;
          continue;
        }

        const belowMinimum =
          !onHandNow.isZero() &&
          row.minQuantity.greaterThan(0) &&
          onHandNow.lessThanOrEqualTo(row.minQuantity);
        if (belowMinimum) {
          stillTrue(
            STOCK_BELOW_MINIMUM,
            dedupeKey({
              type: STOCK_BELOW_MINIMUM,
              entityId: `${row.warehouseId}:${row.item.id}`,
            }),
          );
        }
        if (belowMinimum) {
          if (enabled(STOCK_BELOW_MINIMUM)) {
            await this.raise({
              ...base,
              type: STOCK_BELOW_MINIMUM,
              titleEn: `${row.item.nameEn} is below its minimum`,
              titleAr: `${row.item.nameAr} أقل من الحد الأدنى`,
              bodyEn: `${onHandNow} on hand, minimum ${row.minQuantity}.`,
              bodyAr: `الرصيد ${onHandNow} والحد الأدنى ${row.minQuantity}.`,
              dedupe: dedupeKey({
                type: STOCK_BELOW_MINIMUM,
                entityId: `${row.warehouseId}:${row.item.id}`,
              }),
            });
            raised += 1;
          }
        }

        const aboveMaximum =
          row.maxQuantity.greaterThan(0) && onHandNow.greaterThan(row.maxQuantity);
        if (aboveMaximum) {
          stillTrue(
            STOCK_ABOVE_MAXIMUM,
            dedupeKey({
              type: STOCK_ABOVE_MAXIMUM,
              entityId: `${row.warehouseId}:${row.item.id}`,
            }),
          );
        }
        if (aboveMaximum && enabled(STOCK_ABOVE_MAXIMUM)) {
          await this.raise({
            ...base,
            type: STOCK_ABOVE_MAXIMUM,
            titleEn: `${row.item.nameEn} is above its maximum`,
            titleAr: `${row.item.nameAr} أعلى من الحد الأقصى`,
            bodyEn: `${onHandNow} on hand, maximum ${row.maxQuantity}.`,
            bodyAr: `الرصيد ${onHandNow} والحد الأقصى ${row.maxQuantity}.`,
            dedupe: dedupeKey({
              type: STOCK_ABOVE_MAXIMUM,
              entityId: `${row.warehouseId}:${row.item.id}`,
            }),
          });
          raised += 1;
        }
      }
    }

    // Close what has stopped being true.
    let closed = 0;
    for (const [type, keys] of keep) {
      const stale = await this.prisma.notification.findMany({
        where: {
          companyId,
          type,
          status: { in: ['OPEN', 'READ'] },
          dedupeKey: { notIn: [...keys] },
        },
        select: { id: true },
        take: 2000,
      });
      if (stale.length === 0) continue;
      const result = await this.prisma.notification.updateMany({
        where: { id: { in: stale.map((row) => row.id) } },
        data: { status: 'CLOSED', archivedAt: new Date() },
      });
      closed += result.count;
    }

    return { raised, closed, types: NOTIFICATION_KINDS.length };
  }

  /// The policy a lot's item carries, for callers that show a shelf.
  static policyFor(item: Parameters<typeof batchPolicyOf>[0]) {
    return batchPolicyOf(item);
  }
}
