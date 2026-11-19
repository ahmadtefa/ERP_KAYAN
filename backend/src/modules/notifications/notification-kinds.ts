import { BadRequestException } from '@nestjs/common';

/// The kinds of alert the program knows about today.
///
/// The centre itself is generic: a notification is a row with a type, a
/// severity, a title in both languages and something to open when clicked.
/// This catalogue is what stops a typo from becoming a new kind of alarm in
/// production, and it is the list the settings screen renders. Adding sales or
/// licensing alerts later means adding entries here, not another centre.
export interface NotificationKind {
  type: string;
  module: 'inventory' | 'sales' | 'purchases' | 'accounting' | 'parties' | 'admin';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  /// The permission a person needs for this row to be shown to them at all.
  permission: string;
  /// Where clicking it should take them, and what row it points at.
  entityType?: string;
  /// How often the scanner may raise the same fact again.
  repeatAfterHours?: number;
}

export const STOCK_EXPIRY_SOON = 'STOCK_EXPIRY_SOON';
export const STOCK_EXPIRED = 'STOCK_EXPIRED';
export const STOCK_BELOW_MINIMUM = 'STOCK_BELOW_MINIMUM';
export const STOCK_OUT_OF_STOCK = 'STOCK_OUT_OF_STOCK';
export const STOCK_ABOVE_MAXIMUM = 'STOCK_ABOVE_MAXIMUM';
export const STOCK_EXPIRED_WRITE_OFF_PENDING = 'STOCK_EXPIRED_WRITE_OFF_PENDING';

export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  {
    type: STOCK_EXPIRY_SOON,
    module: 'inventory',
    severity: 'WARNING',
    permission: 'inventory.stock.read',
    entityType: 'ItemBatch',
    repeatAfterHours: 24,
  },
  {
    type: STOCK_EXPIRED,
    module: 'inventory',
    severity: 'CRITICAL',
    permission: 'inventory.stock.read',
    entityType: 'ItemBatch',
    repeatAfterHours: 24,
  },
  {
    type: STOCK_BELOW_MINIMUM,
    module: 'inventory',
    severity: 'WARNING',
    permission: 'inventory.stock.read',
    entityType: 'Item',
    repeatAfterHours: 24,
  },
  {
    type: STOCK_OUT_OF_STOCK,
    module: 'inventory',
    severity: 'WARNING',
    permission: 'inventory.stock.read',
    entityType: 'Item',
    repeatAfterHours: 24,
  },
  {
    type: STOCK_ABOVE_MAXIMUM,
    module: 'inventory',
    severity: 'INFO',
    permission: 'inventory.stock.read',
    entityType: 'Item',
    repeatAfterHours: 72,
  },
  {
    type: STOCK_EXPIRED_WRITE_OFF_PENDING,
    module: 'inventory',
    severity: 'CRITICAL',
    permission: 'inventory.batches.writeoff',
    entityType: 'ItemBatch',
    repeatAfterHours: 24,
  },
];

const BY_TYPE = new Map(NOTIFICATION_KINDS.map((kind) => [kind.type, kind]));

export function notificationKind(type: string): NotificationKind | null {
  return BY_TYPE.get(String(type)) ?? null;
}

export function assertKnownKind(type: string): NotificationKind {
  const kind = notificationKind(type);
  if (!kind) throw new BadRequestException(`Unknown notification type: ${type}`);
  return kind;
}

/// The key that makes the same fact one row.
///
/// Every part that would make a different fact is in the key, and nothing that
/// would make the same fact a second row is. A lot that is 12 days from
/// expiry is the same warning tomorrow as it was today (the band, not the
/// count, is in the key) until it crosses into the next band - which is a
/// different, louder thing to say.
export function dedupeKey(parts: {
  type: string;
  entityId?: string | null;
  suffix?: string | null;
}): string {
  const entity = parts.entityId ?? 'none';
  const suffix = parts.suffix ? `:${parts.suffix}` : '';
  return `${parts.type}:${entity}${suffix}`.slice(0, 200);
}
