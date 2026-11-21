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
/// A sales or purchase order that is waiting for somebody to approve it.
export const STOCK_VOUCHER_PENDING_APPROVAL = 'STOCK_VOUCHER_PENDING_APPROVAL';
export const STOCK_TRANSFER_REVIEW_REQUIRED = 'STOCK_TRANSFER_REVIEW_REQUIRED';
export const STOCK_TRANSFER_APPROVAL_REQUIRED = 'STOCK_TRANSFER_APPROVAL_REQUIRED';
export const STOCK_TRANSFER_DISPATCH_REQUIRED = 'STOCK_TRANSFER_DISPATCH_REQUIRED';
export const STOCK_TRANSFER_RECEIPT_REQUIRED = 'STOCK_TRANSFER_RECEIPT_REQUIRED';
export const STOCK_TRANSFER_SETTLEMENT_APPROVAL_REQUIRED = 'STOCK_TRANSFER_SETTLEMENT_APPROVAL_REQUIRED';
export const STOCK_TRANSFER_CLOSE_REQUIRED = 'STOCK_TRANSFER_CLOSE_REQUIRED';
/// A journal entry waiting for approval.
export const JOURNAL_PENDING_APPROVAL = 'JOURNAL_PENDING_APPROVAL';
/// A posted customer invoice whose due date has passed and is not fully paid.
export const INVOICE_OVERDUE = 'INVOICE_OVERDUE';
/// A supplier invoice falling due soon, and one that has fallen due.
export const PAYABLE_DUE = 'PAYABLE_DUE';
export const PAYABLE_OVERDUE = 'PAYABLE_OVERDUE';
/// A shelf whose quantity or value has gone negative, or a movement the ledger
/// cannot explain: the state a person should look at before it compounds.
export const STOCK_ABNORMAL = 'STOCK_ABNORMAL';
/// A change to who may do what, and operations that alter the company itself.
export const ADMIN_ALERT = 'ADMIN_ALERT';

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
  // ── documents waiting for a person, not a shelf ────────────────────────
  {
    type: STOCK_VOUCHER_PENDING_APPROVAL,
    module: 'inventory',
    severity: 'WARNING',
    permission: 'inventory.stock.approve',
    entityType: 'Order',
    repeatAfterHours: 24,
  },
  {
    type: STOCK_TRANSFER_REVIEW_REQUIRED,
    module: 'inventory',
    severity: 'WARNING',
    permission: 'inventory.transfer.review',
    entityType: 'StockTransfer',
  },
  {
    type: STOCK_TRANSFER_APPROVAL_REQUIRED,
    module: 'inventory',
    severity: 'WARNING',
    permission: 'inventory.transfer.approve',
    entityType: 'StockTransfer',
  },
  {
    type: STOCK_TRANSFER_DISPATCH_REQUIRED,
    module: 'inventory',
    severity: 'INFO',
    permission: 'inventory.transfer.dispatch',
    entityType: 'StockTransfer',
  },
  {
    type: STOCK_TRANSFER_RECEIPT_REQUIRED,
    module: 'inventory',
    severity: 'CRITICAL',
    permission: 'inventory.transfer.receive',
    entityType: 'StockTransfer',
  },
  {
    type: STOCK_TRANSFER_SETTLEMENT_APPROVAL_REQUIRED,
    module: 'inventory',
    severity: 'CRITICAL',
    permission: 'inventory.transfer.settle.approve',
    entityType: 'StockTransfer',
  },
  {
    type: STOCK_TRANSFER_CLOSE_REQUIRED,
    module: 'inventory',
    severity: 'INFO',
    permission: 'inventory.transfer.close',
    entityType: 'StockTransfer',
  },
  {
    type: JOURNAL_PENDING_APPROVAL,
    module: 'accounting',
    severity: 'WARNING',
    permission: 'accounting.journal.approve',
    entityType: 'JournalEntry',
    repeatAfterHours: 24,
  },
  // ── money owed to us, and money we owe ─────────────────────────────────
  {
    type: INVOICE_OVERDUE,
    module: 'sales',
    severity: 'WARNING',
    permission: 'sales.invoices.read',
    entityType: 'SalesInvoice',
    repeatAfterHours: 48,
  },
  {
    type: PAYABLE_DUE,
    module: 'purchases',
    severity: 'INFO',
    permission: 'purchases.invoices.read',
    entityType: 'PurchaseInvoice',
    repeatAfterHours: 72,
  },
  {
    type: PAYABLE_OVERDUE,
    module: 'purchases',
    severity: 'WARNING',
    permission: 'purchases.invoices.read',
    entityType: 'PurchaseInvoice',
    repeatAfterHours: 24,
  },
  // ── a state nobody meant to create ─────────────────────────────────────
  {
    type: STOCK_ABNORMAL,
    module: 'inventory',
    severity: 'CRITICAL',
    permission: 'inventory.stock.read',
    entityType: 'WarehouseStockBalance',
    repeatAfterHours: 12,
  },
  // ── who may do what, and what changed underneath ───────────────────────
  {
    type: ADMIN_ALERT,
    module: 'admin',
    severity: 'WARNING',
    permission: 'admin.audit.read',
    entityType: 'AuditLog',
    repeatAfterHours: 24,
  },
];

/// The kinds a company can switch off one by one on the settings screen.
export const STOCK_KINDS = [
  STOCK_EXPIRY_SOON,
  STOCK_EXPIRED,
  STOCK_BELOW_MINIMUM,
  STOCK_OUT_OF_STOCK,
  STOCK_ABOVE_MAXIMUM,
  STOCK_EXPIRED_WRITE_OFF_PENDING,
  STOCK_ABNORMAL,
] as const;

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
