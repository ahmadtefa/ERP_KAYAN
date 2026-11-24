import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
  ADMIN_ALERT,
  INVOICE_OVERDUE,
  JOURNAL_PENDING_APPROVAL,
  NOTIFICATION_KINDS,
  PAYABLE_DUE,
  PAYABLE_OVERDUE,
  STOCK_ABNORMAL,
  DOCUMENT_APPROVED,
  DOCUMENT_REJECTED,
  STOCK_ABOVE_MAXIMUM,
  STOCK_BELOW_MINIMUM,
  STOCK_EXPIRED,
  STOCK_EXPIRED_WRITE_OFF_PENDING,
  STOCK_EXPIRY_SOON,
  STOCK_OUT_OF_STOCK,
  STOCK_TRANSFER_RECEIPT_REQUIRED,
  STOCK_VOUCHER_PENDING_APPROVAL,
  SALES_ORDER_PENDING_APPROVAL,
  PURCHASE_ORDER_PENDING_APPROVAL,
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
  warehouseAccess?: Array<{
    warehouseId: string;
    canView: boolean;
    canReceive?: boolean;
  }> | null;
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
  /// Overrides the catalogue's permission for this row. Used where the
  /// permission that may act depends on configuration rather than on the kind
  /// — an approval level carries its own permission, and an alert about that
  /// level must be visible to exactly the people who can close it.
  permission?: string | null;
  /// Addresses the row to one person. Nobody else sees it, super admins
  /// included: a decision about somebody's request is theirs to read.
  recipientUserId?: string | null;
  /// Overrides the setting's role list, for a stage that belongs to a role.
  audienceRoles?: string[] | null;
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

    const rows = await this.prisma.notification.findMany({
      where: { ...where, ...this.visibleTo(user) },
      // CRITICAL before WARNING before INFO, then the newest. The rank is a
      // number because sorting the word alphabetically puts WARNING last.
      orderBy: [{ severityRank: 'desc' }, { createdAt: 'desc' }],
    });

    // Reading and dismissal are personal, so the read filter and the page are
    // cut from this person's own state — one colleague reading an alert never
    // removes it from another's list.
    const mine = await this.myStates(user.userId, rows.map((row) => row.id));
    const filtered = rows.filter((row) => {
      const state = mine.get(row.id);
      if (state?.dismissedAt) return false;
      if (status === 'OPEN') return !this.isRead(row, state);
      if (status === 'READ') return this.isRead(row, state);
      return true;
    });
    const start = (page - 1) * pageSize;

    return {
      items: filtered
        .slice(start, start + pageSize)
        .map((row) => this.toResponse(row, mine.get(row.id))),
      total: filtered.length,
      page,
      pageSize,
    };
  }

  /// How many are waiting *for this person*. This is the badge in the top bar:
  /// it counts only what they could open and have not read, and it never
  /// counts what they deleted — reading one must take the badge from 10 to 9.
  async unreadCount(user: NotificationUser) {
    const rows = await this.prisma.notification.findMany({
      where: {
        companyId: user.companyId,
        status: { in: ['OPEN', 'READ'] },
        archivedAt: null,
        ...this.visibleTo(user),
      },
      select: { id: true, status: true, readAt: true },
    });
    const mine = await this.myStates(user.userId, rows.map((row) => row.id));
    const unread = rows.filter(
      (row) => !this.isRead(row, mine.get(row.id)) && !mine.get(row.id)?.dismissedAt,
    ).length;
    return { unread };
  }

  async markRead(user: NotificationUser, id: string) {
    const row = await this.require(user, id);
    if (row.status === 'ARCHIVED') {
      return this.toResponse(row);
    }
    const state = await this.upsertState(user.userId, row.id, {
      readAt: new Date(),
    });
    return this.toResponse(row, state);
  }

  /// Marks a row as unread again.
  ///
  /// "I read it, I will deal with it later" is the most common thing a person
  /// wants from an alert list, and it must not require a second alert. Only a
  /// closed row is left alone: resurrecting an alert whose fact has stopped
  /// being true would be inventing news.
  async markUnread(user: NotificationUser, id: string) {
    const row = await this.require(user, id);
    if (row.status === 'CLOSED' || row.status === 'ARCHIVED') {
      return this.toResponse(row);
    }
    const state = await this.upsertState(user.userId, row.id, { readAt: null });
    return this.toResponse(row, state);
  }

  async archive(user: NotificationUser, id: string) {
    const row = await this.require(user, id);
    const updated = await this.prisma.notification.update({
      where: { id: row.id },
      data: { status: 'ARCHIVED', archivedAt: new Date(), readAt: row.readAt ?? new Date() },
    });
    return this.toResponse(updated);
  }

  /// Marks everything this person can see and has not read as read. Personal:
  /// the colleague's badge is not touched.
  async markAllRead(user: NotificationUser) {
    const rows = await this.prisma.notification.findMany({
      where: {
        companyId: user.companyId,
        status: { in: ['OPEN', 'READ'] },
        archivedAt: null,
        ...this.visibleTo(user),
      },
      select: { id: true },
    });
    const ids = rows.map((row) => row.id);
    const mine = await this.myStates(user.userId, ids);
    const now = new Date();
    await this.prisma.notificationUserState.updateMany({
      where: { userId: user.userId, notificationId: { in: ids }, readAt: null },
      data: { readAt: now },
    });
    const missing = ids.filter((id) => !mine.has(id));
    if (missing.length > 0) {
      await this.prisma.notificationUserState.createMany({
        data: missing.map((notificationId) => ({
          notificationId,
          userId: user.userId,
          readAt: now,
        })),
        skipDuplicates: true,
      });
    }
    return { updated: ids.length };
  }

  // ────────────────────────────────────────────────────────────── dismissing

  /// Deleting in the centre is personal and non-destructive: the row in
  /// `notifications` — the fact, its audit trail, its dedupe key — is left
  /// exactly where it was. Only this person stops seeing it.
  async dismiss(user: NotificationUser, id: string) {
    const row = await this.require(user, id);
    await this.upsertState(user.userId, row.id, {
      dismissedAt: new Date(),
      readAt: new Date(),
    });
    return { deleted: 1 };
  }

  /// Clears what this person has read. Unread alerts are untouched: a blanket
  /// "tidy up" must never swallow the warning nobody has seen yet.
  async dismissRead(user: NotificationUser) {
    const result = await this.prisma.notificationUserState.updateMany({
      where: { userId: user.userId, readAt: { not: null }, dismissedAt: null },
      data: { dismissedAt: new Date() },
    });
    return { deleted: result.count };
  }

  /// Clears everything this person can see. The caller is expected to have
  /// asked for confirmation first — this deletes unread alerts too.
  async dismissAll(user: NotificationUser) {
    const rows = await this.prisma.notification.findMany({
      where: { companyId: user.companyId, ...this.visibleTo(user) },
      select: { id: true },
    });
    const ids = rows.map((row) => row.id);
    const mine = await this.myStates(user.userId, ids);
    const now = new Date();
    await this.prisma.notificationUserState.updateMany({
      where: { userId: user.userId, notificationId: { in: ids }, dismissedAt: null },
      data: { dismissedAt: now, readAt: now },
    });
    const missing = ids.filter((id) => !mine.has(id));
    if (missing.length > 0) {
      await this.prisma.notificationUserState.createMany({
        data: missing.map((notificationId) => ({
          notificationId,
          userId: user.userId,
          readAt: now,
          dismissedAt: now,
        })),
        skipDuplicates: true,
      });
    }
    return { deleted: ids.length };
  }

  /// What a cleanup of alerts older than `days` would remove, without doing
  /// it. The screen shows this number before the person confirms.
  async cleanupPreview(
    user: NotificationUser,
    days: number,
    includeUnread: boolean,
  ) {
    const targets = await this.olderThanTargets(user, days, includeUnread);
    return { count: targets.length, days, includeUnread };
  }

  /// Clears this person's alerts older than `days`. Unread ones are protected
  /// unless the person explicitly asked for them.
  async dismissOlderThan(
    user: NotificationUser,
    days: number,
    includeUnread: boolean,
  ) {
    const targets = await this.olderThanTargets(user, days, includeUnread);
    if (targets.length > 0) {
      const mine = await this.myStates(
        user.userId,
        targets.map((row) => row.id),
      );
      const now = new Date();
      const ids = targets.map((row) => row.id);
      await this.prisma.notificationUserState.updateMany({
        where: { userId: user.userId, notificationId: { in: ids }, dismissedAt: null },
        data: { dismissedAt: now, readAt: now },
      });
      const missing = ids.filter((id) => !mine.has(id));
      if (missing.length > 0) {
        await this.prisma.notificationUserState.createMany({
          data: missing.map((notificationId) => ({
            notificationId,
            userId: user.userId,
            readAt: now,
            dismissedAt: now,
          })),
          skipDuplicates: true,
        });
      }
    }
    return { deleted: targets.length, days, includeUnread };
  }

  private async olderThanTargets(
    user: NotificationUser,
    days: number,
    includeUnread: boolean,
  ) {
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new BadRequestException('days must be an integer between 1 and 3650');
    }
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.notification.findMany({
      where: {
        companyId: user.companyId,
        createdAt: { lt: cutoff },
        ...this.visibleTo(user),
      },
      select: { id: true, status: true, readAt: true },
    });
    const mine = await this.myStates(user.userId, rows.map((row) => row.id));
    return rows.filter((row) => {
      const state = mine.get(row.id);
      if (state?.dismissedAt) return false;
      return includeUnread ? true : this.isRead(row, state);
    });
  }

  /// This person's personal state for the given alerts.
  private async myStates(userId: string, notificationIds: string[]) {
    const map = new Map<
      string,
      { readAt: Date | null; dismissedAt: Date | null }
    >();
    if (notificationIds.length === 0) return map;
    const rows: Array<{
      notificationId: string;
      readAt: Date | null;
      dismissedAt: Date | null;
    }> = await this.prisma.notificationUserState.findMany({
      where: { userId, notificationId: { in: notificationIds } },
    });
    for (const row of rows) map.set(row.notificationId, row);
    return map;
  }

  private async upsertState(
    userId: string,
    notificationId: string,
    patch: { readAt?: Date | null; dismissedAt?: Date | null },
  ) {
    return this.prisma.notificationUserState.upsert({
      where: { notificationId_userId: { notificationId, userId } },
      create: {
        notificationId,
        userId,
        readAt: patch.readAt ?? null,
        dismissedAt: patch.dismissedAt ?? null,
      },
      update: patch,
    }) as Promise<{ readAt: Date | null; dismissedAt: Date | null }>;
  }

  /// Read is personal; rows written before this table existed carry their
  /// answer in the legacy shared columns, and the migration copied those into
  /// every person's state — the fallback only matters for rows a state row
  /// has never been written for.
  private isRead(
    row: { status: string; readAt: Date | null },
    state?: { readAt: Date | null } | null,
  ): boolean {
    if (state) return state.readAt != null;
    return row.status !== 'OPEN' || row.readAt != null;
  }

  /// Only rows this person could open, and only those whose permission they
  /// hold. A user with no `inventory.cost.read` still sees that a lot expired;
  /// they do not see a row that was written for a permission they lack.
  private visibleTo(user: NotificationUser): Prisma.NotificationWhereInput {
    // A personal row is addressed to one person and to nobody else.
    const personal: Prisma.NotificationWhereInput = {
      OR: [{ recipientUserId: null }, { recipientUserId: user.userId }],
    };
    if (user.isSuperAdmin) return personal;
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
    // Receipt work is addressed more narrowly still: seeing a warehouse does
    // not imply permission to receive goods there.
    const configuredWarehouseAccess = user.warehouseAccess;
    let warehouse: Prisma.NotificationWhereInput = {};
    if (configuredWarehouseAccess && configuredWarehouseAccess.length > 0) {
      const visibleIds = configuredWarehouseAccess
        .filter((row) => row && row.canView)
        .map((row) => row.warehouseId);
      const receivingIds = configuredWarehouseAccess
        .filter((row) => row && row.canView && row.canReceive === true)
        .map((row) => row.warehouseId);
      const addressed: Prisma.NotificationWhereInput[] = [{ warehouseId: null }];
      if (visibleIds.length > 0) {
        addressed.push({
          AND: [
            { type: { not: STOCK_TRANSFER_RECEIPT_REQUIRED } },
            { warehouseId: { in: visibleIds } },
          ],
        });
      }
      if (receivingIds.length > 0) {
        addressed.push({
          type: STOCK_TRANSFER_RECEIPT_REQUIRED,
          warehouseId: { in: receivingIds },
        });
      }
      warehouse = { OR: addressed };
    }
    return { AND: [personal, branch, permission, audience, warehouse] };
  }

  private maySee(user: NotificationUser, permission: string | null): boolean {
    if (!permission) return true;
    if (user.isSuperAdmin) return true;
    return user.permissions.includes(permission);
  }

  private async require(user: NotificationUser, id: string) {
    const row = await this.prisma.notification.findFirst({
      where: { id, companyId: user.companyId, ...this.visibleTo(user) },
    });
    if (!row) throw new NotFoundException('Notification not found');
    if (!this.maySee(user, row.permission)) {
      // Not theirs to know about: reported as missing rather than forbidden.
      throw new NotFoundException('Notification not found');
    }
    return row;
  }

  private toResponse(
    row: {
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
    },
    state?: { readAt: Date | null; dismissedAt: Date | null } | null,
  ) {
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
      readAt: state ? state.readAt : row.readAt,
      archivedAt: row.archivedAt,
      branchId: row.branchId,
      warehouseId: row.warehouseId,
      isRead: this.isRead(row, state),
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

  /// Closes tasks for this business record when its workflow advances.
  /// Active stage types remain open; obsolete stages leave the unread centre
  /// but remain in history for audit and personal read state.
  async resolveEntity(
    companyId: string,
    entityType: string,
    entityId: string,
    activeTypes: readonly string[],
    keepTypes: readonly string[] = [DOCUMENT_APPROVED, DOCUMENT_REJECTED],
  ): Promise<{ closed: number }> {
    const result = await this.prisma.notification.updateMany({
      where: {
        companyId,
        entityType,
        entityId,
        status: { in: ['OPEN', 'READ'] },
        // The requester's own outcome notices are theirs to read; the
        // workflow moving on does not take them away.
        type: { notIn: [...keepTypes] },
        ...(activeTypes.length
          ? {
              OR: [
                { type: { notIn: [...activeTypes] } },
                {
                  type: { in: [...activeTypes] },
                  dedupeKey: {
                    notIn: activeTypes.map((type) => dedupeKey({ type, entityId })),
                  },
                },
              ],
            }
          : {}),
      },
      data: { status: 'CLOSED', readAt: new Date() },
    });
    return { closed: result.count };
  }


  /// A document's pending-approval task is over (approved, cancelled, sent
  /// back). Closes it now instead of waiting for the next 30-minute scan, and
  /// never lets a notification failure undo the business action.
  async clearPending(companyId: string, entityType: string, entityId: string): Promise<void> {
    try {
      await this.resolveEntity(companyId, entityType, entityId, []);
    } catch {
      // The scan closes it on its next pass.
    }
  }

  /// Raises a document's pending-approval task at once (journals have a real
  /// submit step, so there is no reason to make the approver wait for a scan).
  async raiseSafely(input: RaiseInput): Promise<void> {
    try {
      await this.raise(input);
    } catch {
      // The scan raises it on its next pass.
    }
  }

  /// Tells the requester what was decided about their document. Addressed to
  /// that person alone. Nothing is sent when they decided it themselves.
  async tellRequester(input: {
    companyId: string;
    branchId?: string | null;
    requesterId: string | null | undefined;
    decidedBy: string;
    outcome: 'APPROVED' | 'REJECTED';
    entityType: string;
    entityId: string;
    entityRef: string;
    nameAr: string;
    nameEn: string;
    actionPath: string;
    reason?: string | null;
  }): Promise<void> {
    if (!input.requesterId || input.requesterId === input.decidedBy) return;
    const ok = input.outcome === 'APPROVED';
    const type = ok ? DOCUMENT_APPROVED : DOCUMENT_REJECTED;
    const reason = (input.reason ?? '').trim();
    await this.raiseSafely({
      companyId: input.companyId,
      branchId: input.branchId ?? null,
      type,
      recipientUserId: input.requesterId,
      titleAr: ok ? `تم اعتماد ${input.nameAr}` : `تم رفض ${input.nameAr}`,
      titleEn: ok ? `${input.nameEn} approved` : `${input.nameEn} rejected`,
      bodyAr: `${input.nameAr} ${input.entityRef} ${ok ? 'تم اعتماده' : 'تم رفضه'}${reason ? `: ${reason}` : ''}.`,
      bodyEn: `${input.nameEn} ${input.entityRef} was ${ok ? 'approved' : 'rejected'}${reason ? `: ${reason}` : ''}.`,
      entityType: input.entityType,
      entityId: input.entityId,
      entityRef: input.entityRef,
      actionPath: input.actionPath,
      dedupe: dedupeKey({ type, entityId: input.entityId, suffix: String(Date.now()) }),
    });
  }

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
    const audienceRoles = input.audienceRoles
      ? input.audienceRoles.filter(Boolean)
      : Array.isArray(setting?.roles)
        ? (setting?.roles as unknown[]).filter((role): role is string => typeof role === 'string')
        : [];
    const permission = kind?.personal
      ? null
      : (input.permission ?? kind?.permission ?? null);
    const recipientUserId = input.recipientUserId ?? null;
    const repeatAfterHours = Math.max(Number(setting?.repeatAfterHours ?? 24), 1);

    // How long a still-true fact stays quiet. The row is not duplicated; it is
    // re-opened once the setting's interval has passed, so a warning nobody
    // acted on comes back instead of disappearing under newer news.
    const existing = await this.prisma.notification.findUnique({
      where: { companyId_dedupeKey: { companyId: input.companyId, dedupeKey: input.dedupe } },
      select: { id: true, status: true, lastRaisedAt: true, raisedCount: true, permission: true, audienceRoles: true },
    });
    // A stage handed to somebody else (the next approval level) is a new task
    // for them, not a repeat of the old one for the people who just finished.
    const audienceChanged =
      existing !== null &&
      ((existing.permission ?? null) !== permission ||
        [...(existing.audienceRoles ?? [])].sort().join('|') !== [...audienceRoles].sort().join('|'));
    const dueForRepeat =
      existing !== null &&
      existing.status !== 'ARCHIVED' &&
      (audienceChanged ||
        existing.status === 'CLOSED' || existing.lastRaisedAt === null ||
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
          permission,
          recipientUserId,
          dedupeKey: input.dedupe,
          dueAt: input.dueAt ?? null,
        },
        // The fact is unchanged; its wording may not be. Re-opening a row a
        // person already read would be a lie about "new" - unless the setting
        // says this alert repeats, in which case it is a fresh prompt on
        // purpose and the count says how many times it has been asked. The
        // re-prompt is personal too: it clears read state but never brings a
        // dismissed alert back to anybody.
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
              // Closing stamps readAt; a reopened task is unread again.
              readAt: null,
              archivedAt: null,
              permission,
              audienceRoles,
              recipientUserId,
              branchId: input.branchId ?? null,
              warehouseId: input.warehouseId ?? null,
            }
          : {
              titleEn: input.titleEn,
              titleAr: input.titleAr,
              severity,
              severityRank: RANK[severity] ?? 1,
              lastRaisedAt: new Date(),
            },
      });
      if (dueForRepeat) {
        await this.prisma.notificationUserState.updateMany({
          where: { notificationId: row.id, dismissedAt: null },
          data: { readAt: null },
        });
        // The task moved to a different audience: anyone who dismissed the
        // earlier stage must still see this one.
        if (audienceChanged) {
          await this.prisma.notificationUserState.updateMany({
            where: { notificationId: row.id },
            data: { dismissedAt: null, readAt: null },
          });
        }
      }
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
    /// A kind this pass looked at, whether or not it found anything.
    ///
    /// The close loop at the end only visits the kinds it is given, so a kind
    /// that matched nothing at all has to be registered before the walk, not
    /// during it. Without this, yesterday's "expires in 5 days" warning stood
    /// in the centre for ever once the lot expired, because the day it went
    /// stale was exactly the day nothing of that kind was found.
    const evaluated = (...types: string[]) => {
      for (const type of types) if (!keep.has(type)) keep.set(type, new Set<string>());
    };

    // ── lots: expiring, expired, and expired-but-still-on-the-shelf ──
    if (enabled(STOCK_EXPIRY_SOON) || enabled(STOCK_EXPIRED)) {
      evaluated(STOCK_EXPIRY_SOON, STOCK_EXPIRED, STOCK_EXPIRED_WRITE_OFF_PENDING);
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
      evaluated(STOCK_BELOW_MINIMUM, STOCK_OUT_OF_STOCK, STOCK_ABOVE_MAXIMUM);
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

  // ────────────────────────────────────── the rest of the business, scanned

  /// Walks the documents and the money every company has, and raises what a
  /// person needs to act on: orders waiting for approval, invoices overdue,
  /// supplier bills falling due, a shelf gone negative, and a change to who may
  /// do what.
  ///
  /// Read-only, exactly like `scanStock`: it writes nothing except the
  /// notification rows themselves, and every row it writes is deduped by
  /// `(companyId, dedupeKey)`. Running it twice in a minute is a second reading
  /// of the same facts, not a second alarm.
  async scanBusiness(companyId: string, today: Date = new Date()) {
    const settingRows = await this.prisma.notificationSetting.findMany({ where: { companyId } });
    const settings = new Map<string, SettingRow>(
      settingRows.map((row) => [String(row.type), row as unknown as SettingRow]),
    );
    const enabled = (type: string) => settings.get(type)?.isEnabled !== false;
    const startOfDay = dayOnly(today);

    let raised = 0;
    const keep = new Map<string, Set<string>>();
    const stillTrue = (type: string, dedupe: string) => {
      const set = keep.get(type) ?? new Set<string>();
      set.add(dedupe);
      keep.set(type, set);
    };
    const evaluated = (...types: string[]) => {
      for (const type of types) if (!keep.has(type)) keep.set(type, new Set<string>());
    };

    // ── orders waiting for approval ──────────────────────────────────────
    evaluated(
      STOCK_VOUCHER_PENDING_APPROVAL,
      SALES_ORDER_PENDING_APPROVAL,
      PURCHASE_ORDER_PENDING_APPROVAL,
      JOURNAL_PENDING_APPROVAL,
      INVOICE_OVERDUE,
      PAYABLE_DUE,
      PAYABLE_OVERDUE,
      STOCK_ABNORMAL,
      ADMIN_ALERT,
    );

    if (enabled(SALES_ORDER_PENDING_APPROVAL) || enabled(PURCHASE_ORDER_PENDING_APPROVAL)) {
      const [salesOrders, purchaseOrders] = await Promise.all([
        this.prisma.salesOrder.findMany({
          where: { companyId, status: 'DRAFT', deletedAt: null, approvedAt: null },
          select: {
            id: true,
            branchId: true,
            orderNumber: true,
            orderDate: true,
            totalAmount: true,
            customer: { select: { nameEn: true, nameAr: true } },
          },
          orderBy: { orderDate: 'asc' },
          take: 200,
        }),
        this.prisma.purchaseOrder.findMany({
          where: { companyId, status: 'DRAFT', deletedAt: null, approvedAt: null },
          select: {
            id: true,
            branchId: true,
            orderNumber: true,
            orderDate: true,
            totalAmount: true,
            supplier: { select: { nameEn: true, nameAr: true } },
          },
          orderBy: { orderDate: 'asc' },
          take: 200,
        }),
      ]);
      for (const order of enabled(SALES_ORDER_PENDING_APPROVAL) ? salesOrders : []) {
        const dedupe = dedupeKey({ type: SALES_ORDER_PENDING_APPROVAL, entityId: order.id });
        stillTrue(SALES_ORDER_PENDING_APPROVAL, dedupe);
        const days = Math.max(0, Math.round((startOfDay.getTime() - dayOnly(order.orderDate).getTime()) / 86_400_000));
        await this.raise({
          companyId,
          type: SALES_ORDER_PENDING_APPROVAL,
          branchId: order.branchId,
          entityType: 'SalesOrder',
          entityId: order.id,
          entityRef: order.orderNumber,
          actionPath: `/sales/orders?order=${order.id}`,
          dueAt: order.orderDate,
          titleEn: `Sales order ${order.orderNumber} is waiting for approval`,
          titleAr: `أمر البيع ${order.orderNumber} في انتظار الاعتماد`,
          bodyEn: `${order.customer?.nameEn ?? 'The customer'} — ${order.totalAmount} — waiting ${days} day(s).`,
          bodyAr: `${order.customer?.nameAr ?? 'العميل'} — ${order.totalAmount} — منذ ${days} يوم.`,
          dedupe,
        });
        raised += 1;
      }
      for (const order of enabled(PURCHASE_ORDER_PENDING_APPROVAL) ? purchaseOrders : []) {
        const dedupe = dedupeKey({ type: PURCHASE_ORDER_PENDING_APPROVAL, entityId: order.id });
        stillTrue(PURCHASE_ORDER_PENDING_APPROVAL, dedupe);
        await this.raise({
          companyId,
          type: PURCHASE_ORDER_PENDING_APPROVAL,
          branchId: order.branchId,
          entityType: 'PurchaseOrder',
          entityId: order.id,
          entityRef: order.orderNumber,
          actionPath: `/purchases/orders?order=${order.id}`,
          dueAt: order.orderDate,
          titleEn: `Purchase order ${order.orderNumber} is waiting for approval`,
          titleAr: `أمر الشراء ${order.orderNumber} في انتظار الاعتماد`,
          bodyEn: `${order.supplier?.nameEn ?? 'The supplier'} — ${order.totalAmount}.`,
          bodyAr: `${order.supplier?.nameAr ?? 'المورد'} — ${order.totalAmount}.`,
          dedupe,
        });
        raised += 1;
      }
    }

    // ── journal entries waiting for approval ─────────────────────────────
    if (enabled(JOURNAL_PENDING_APPROVAL)) {
      const entries = await this.prisma.journalEntry.findMany({
        where: { companyId, status: 'PENDING_APPROVAL' },
        select: {
          id: true,
          branchId: true,
          entryNumber: true,
          entryDate: true,
          description: true,
          totalDebit: true,
        },
        orderBy: { entryDate: 'asc' },
        take: 200,
      });
      for (const entry of entries) {
        const dedupe = dedupeKey({ type: JOURNAL_PENDING_APPROVAL, entityId: entry.id });
        stillTrue(JOURNAL_PENDING_APPROVAL, dedupe);
        await this.raise({
          companyId,
          type: JOURNAL_PENDING_APPROVAL,
          branchId: entry.branchId,
          entityId: entry.id,
          entityRef: entry.entryNumber,
          actionPath: `/accounting/journal-entries?entry=${entry.id}`,
          dueAt: entry.entryDate,
          titleEn: `Journal entry ${entry.entryNumber} is waiting for approval`,
          titleAr: `القيد ${entry.entryNumber} في انتظار الاعتماد`,
          bodyEn: entry.description ?? `${entry.totalDebit} waiting to be approved.`,
          bodyAr: entry.description ?? `${entry.totalDebit} في انتظار الاعتماد.`,
          dedupe,
        });
        raised += 1;
      }
    }

    // ── money owed to us ─────────────────────────────────────────────────
    if (enabled(INVOICE_OVERDUE)) {
      const invoices = await this.prisma.salesInvoice.findMany({
        where: {
          companyId,
          status: 'POSTED',
          documentType: 'INVOICE',
          dueDate: { lt: startOfDay },
        },
        select: {
          id: true,
          branchId: true,
          invoiceNumber: true,
          dueDate: true,
          totalAmount: true,
          paidAmount: true,
          customer: { select: { nameEn: true, nameAr: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 200,
      });
      for (const invoice of invoices) {
        // A fully paid invoice that kept an old due date is not overdue, and
        // telling a collection clerk it is would teach them to ignore the list.
        const outstanding = Number(invoice.totalAmount) - Number(invoice.paidAmount);
        if (outstanding <= 0) continue;
        // The band, not the exact day, is in the key: an invoice that is three
        // days late stays one row as it ages, and becomes a louder one when it
        // crosses into another bucket instead of shouting daily.
        const days = Math.max(0, Math.round((startOfDay.getTime() - dayOnly(invoice.dueDate!).getTime()) / 86_400_000));
        const dedupe = dedupeKey({
          type: INVOICE_OVERDUE,
          entityId: invoice.id,
          suffix: days > 30 ? '30+' : `${Math.ceil(days / 7)}w`,
        });
        stillTrue(INVOICE_OVERDUE, dedupe);
        await this.raise({
          companyId,
          type: INVOICE_OVERDUE,
          branchId: invoice.branchId,
          entityId: invoice.id,
          entityRef: invoice.invoiceNumber,
          actionPath: `/sales/invoices?invoice=${invoice.id}`,
          dueAt: invoice.dueDate,
          titleEn: `Invoice ${invoice.invoiceNumber} is ${days} day(s) overdue`,
          titleAr: `الفاتورة ${invoice.invoiceNumber} متأخرة ${days} يوم`,
          bodyEn: `${invoice.customer?.nameEn ?? 'The customer'} still owes ${outstanding}.`,
          bodyAr: `${invoice.customer?.nameAr ?? 'العميل'} مدين بمبلغ ${outstanding}.`,
          dedupe,
        });
        raised += 1;
      }
    }

    // ── money we owe ─────────────────────────────────────────────────────
    if (enabled(PAYABLE_DUE) || enabled(PAYABLE_OVERDUE)) {
      const horizon = new Date(startOfDay.getTime() + 7 * 86_400_000);
      const bills = await this.prisma.purchaseInvoice.findMany({
        where: {
          companyId,
          status: 'POSTED',
          documentType: 'INVOICE',
          dueDate: { not: null, lte: horizon },
        },
        select: {
          id: true,
          branchId: true,
          invoiceNumber: true,
          dueDate: true,
          totalAmount: true,
          paidAmount: true,
          supplier: { select: { nameEn: true, nameAr: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 200,
      });
      for (const bill of bills) {
        const outstanding = Number(bill.totalAmount) - Number(bill.paidAmount);
        if (outstanding <= 0) continue;
        const days = Math.round((dayOnly(bill.dueDate!).getTime() - startOfDay.getTime()) / 86_400_000);
        const type = days < 0 ? PAYABLE_OVERDUE : PAYABLE_DUE;
        if (!enabled(type)) continue;
        const dedupe = dedupeKey({ type, entityId: bill.id });
        stillTrue(type, dedupe);
        await this.raise({
          companyId,
          type,
          branchId: bill.branchId,
          entityId: bill.id,
          entityRef: bill.invoiceNumber,
          actionPath: `/purchases/invoices?invoice=${bill.id}`,
          dueAt: bill.dueDate,
          titleEn:
            days < 0
              ? `Supplier bill ${bill.invoiceNumber} is ${Math.abs(days)} day(s) overdue`
              : `Supplier bill ${bill.invoiceNumber} is due in ${days} day(s)`,
          titleAr:
            days < 0
              ? `فاتورة المورد ${bill.invoiceNumber} متأخرة ${Math.abs(days)} يوم`
              : `فاتورة المورد ${bill.invoiceNumber} تستحق خلال ${days} يوم`,
          bodyEn: `${bill.supplier?.nameEn ?? 'The supplier'} — ${outstanding} outstanding.`,
          bodyAr: `${bill.supplier?.nameAr ?? 'المورد'} — ${outstanding} مستحق.`,
          dedupe,
        });
        raised += 1;
      }
    }

    // ── a shelf in a state nobody meant to create ────────────────────────
    if (enabled(STOCK_ABNORMAL)) {
      const balances = await this.prisma.warehouseStockBalance.findMany({
        where: {
          companyId,
          OR: [{ quantity: { lt: 0 } }, { value: { lt: 0 } }],
        },
        select: {
          branchId: true,
          warehouseId: true,
          itemId: true,
          quantity: true,
          value: true,
          item: { select: { code: true, nameEn: true, nameAr: true } },
          warehouse: { select: { code: true, nameEn: true, nameAr: true } },
        },
        take: 500,
      });
      for (const balance of balances) {
        const entityId = `${balance.warehouseId}:${balance.itemId}`;
        const dedupe = dedupeKey({ type: STOCK_ABNORMAL, entityId });
        stillTrue(STOCK_ABNORMAL, dedupe);
        await this.raise({
          companyId,
          type: STOCK_ABNORMAL,
          branchId: balance.branchId,
          warehouseId: balance.warehouseId,
          entityId: balance.warehouseId,
          entityRef: balance.item.code,
          actionPath: `/inventory/stock?warehouse=${balance.warehouseId}&item=${balance.itemId}`,
          titleEn: `${balance.item.nameEn} has an impossible balance`,
          titleAr: `${balance.item.nameAr} له رصيد غير منطقي`,
          bodyEn: `Warehouse ${balance.warehouse.code}: quantity ${balance.quantity}, value ${balance.value}.`,
          bodyAr: `المخزن ${balance.warehouse.code}: الكمية ${balance.quantity} والقيمة ${balance.value}.`,
          dedupe,
        });
        raised += 1;
      }
    }

    // ── who may do what, and what changed underneath ─────────────────────
    if (enabled(ADMIN_ALERT)) {
      const since = new Date(today.getTime() - 24 * 3_600_000);
      const changes = await this.prisma.auditLog.findMany({
        where: {
          companyId,
          createdAt: { gte: since },
          action: {
            in: [
              'role.create',
              'role.update',
              'role.remove',
              'role.permissions_set',
              'user.create',
              'user.update',
              'user.password',
              'admin.backup.restore',
              'admin.reset',
            ],
          },
        },
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          createdAt: true,
          user: { select: { username: true, fullNameEn: true, fullNameAr: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      for (const change of changes) {
        const dedupe = dedupeKey({ type: ADMIN_ALERT, entityId: change.id });
        stillTrue(ADMIN_ALERT, dedupe);
        await this.raise({
          companyId,
          type: ADMIN_ALERT,
          entityType: 'AuditLog',
          entityId: change.id,
          entityRef: change.action,
          actionPath: '/administration',
          dueAt: change.createdAt,
          titleEn: `Access change: ${change.action}`,
          titleAr: `تغيير في الصلاحيات: ${change.action}`,
          bodyEn: `${change.user?.fullNameEn ?? change.user?.username ?? 'The system'} on ${change.entity}.`,
          bodyAr: `${change.user?.fullNameAr ?? change.user?.username ?? 'النظام'} على ${change.entity}.`,
          dedupe,
        });
        raised += 1;
      }
    }

    // The same closing rule as the stock pass: a kind this pass evaluated and
    // did not find is a fact that has stopped being true.
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

    return { raised, closed, types: keep.size };
  }

  /// The policy a lot's item carries, for callers that show a shelf.
  static policyFor(item: Parameters<typeof batchPolicyOf>[0]) {
    return batchPolicyOf(item);
  }
}
