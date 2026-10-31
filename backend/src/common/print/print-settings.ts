import { canReadCost, type CostVisibilityCaller } from '../auth/cost-visibility';

/// What a printed copy is allowed to carry, per kind of print.
///
/// The choice used to exist only per request: a dialog in front of every PDF
/// button. That is right for "this copy" but wrong for a company policy - the
/// warehouse clerk should not have to remember to untick a box, and a print
/// that leaves the building must not depend on somebody's memory. These are
/// the saved settings behind that dialog, and the dialog remains as a one-off
/// override on top of them.
///
/// Three things decide the answer, in this order:
///
///   1. the caller's permission - `inventory.cost.read` is a floor, never a
///      preference: a caller without it receives no cost whatever is asked;
///   2. the choice made on this one print, when the operator made one;
///   3. the saved setting for this print type, then the saved default, then
///      the built-in default (visible), so an installation that never opened
///      the settings screen prints exactly what it printed yesterday.
export type PrintCategory = 'DOCUMENT' | 'LIST' | 'REPORT' | 'STOCK' | 'LABEL';

export interface PrintType {
  /// The key the API and the screen agree on. It is also the slug of the
  /// route that prints it, so a setting and a route can never drift apart
  /// without the architecture test noticing.
  key: string;
  category: PrintCategory;
  labelEn: string;
  labelAr: string;
  /// Whether this print can carry a selling price at all. A journal entry
  /// cannot, so offering "hide the sale price" for it would be a knob that
  /// changes nothing.
  carriesSalePrice: boolean;
  /// Whether this print can carry a cost/purchase price.
  carriesCost: boolean;
}

/// The company-wide fallback, used for anything the screen has not configured.
export const DEFAULT_PRINT_TYPE = 'default';

const document = (key: string, labelEn: string, labelAr: string): PrintType => ({
  key,
  category: 'DOCUMENT',
  labelEn,
  labelAr,
  carriesSalePrice: key.startsWith('sales-') || key === 'sales-quotation',
  carriesCost: key.startsWith('purchase-') || key === 'sales-invoice',
});

const list = (
  key: string,
  labelEn: string,
  labelAr: string,
  carries: { sale?: boolean; cost?: boolean } = {},
): PrintType => ({
  key,
  category: 'LIST',
  labelEn,
  labelAr,
  carriesSalePrice: carries.sale ?? false,
  carriesCost: carries.cost ?? false,
});

const report = (
  key: string,
  labelEn: string,
  labelAr: string,
  carries: { sale?: boolean; cost?: boolean } = {},
): PrintType => ({
  key,
  category: 'REPORT',
  labelEn,
  labelAr,
  carriesSalePrice: carries.sale ?? false,
  carriesCost: carries.cost ?? false,
});

/// Every print the program can actually produce.
///
/// Each entry corresponds to a route that exists today: the seven saved
/// documents, the stock documents (count/transfer/adjustment/opening), the
/// lists, the reports, the inventory reports with their own print routes, and
/// the barcode label sheet. Nothing is listed speculatively; a type that
/// cannot be printed would be a setting that never applies.
export const PRINT_TYPES: readonly PrintType[] = [
  // Saved documents (exports/documents/:kind/:id)
  document('sales-invoice', 'Sales invoice', 'فاتورة بيع'),
  document('purchase-invoice', 'Purchase invoice', 'فاتورة شراء'),
  document('sales-order', 'Sales order', 'أمر بيع'),
  document('purchase-order', 'Purchase order', 'أمر شراء'),
  document('sales-quotation', 'Quotation', 'عرض سعر'),
  document('cash-voucher', 'Cash voucher', 'سند نقدي'),
  document('journal-entry', 'Journal entry', 'قيد يومية'),
  {
    key: 'stock-document',
    category: 'STOCK',
    labelEn: 'Stock document (count, transfer, adjustment)',
    labelAr: 'مستند مخزني (جرد، تحويل، تسوية)',
    carriesSalePrice: false,
    carriesCost: true,
  },

  // Lists
  list('items', 'Items', 'الأصناف', { sale: true, cost: true }),
  list('stock', 'Stock balances', 'أرصدة المخزون', { cost: true }),
  list('stock-ledger', 'Stock movement', 'حركة المخزون', { cost: true }),
  list('sales-invoices', 'Sales invoices', 'فواتير البيع', { sale: true }),
  list('purchase-invoices', 'Purchase invoices', 'فواتير الشراء', { cost: true }),
  list('customers', 'Customers', 'العملاء'),
  list('suppliers', 'Suppliers', 'الموردون'),
  list('cash-accounts', 'Cash accounts', 'الحسابات النقدية'),
  list('cash-vouchers', 'Cash vouchers', 'السندات النقدية'),
  list('cash-transfers', 'Cash transfers', 'التحويلات النقدية'),
  list('chart-of-accounts', 'Chart of accounts', 'دليل الحسابات'),
  list('journal-entries', 'Journal entries', 'قيود اليومية'),
  list('fiscal-periods', 'Fiscal periods', 'الفترات المالية'),
  list('users', 'Users', 'المستخدمون'),
  list('roles', 'Roles', 'الأدوار'),
  list('audit-trail', 'Audit trail', 'سجل التغييرات'),

  // Financial and operational reports
  report('sales', 'Sales report', 'تقرير المبيعات', { sale: true, cost: true }),
  report('purchases', 'Purchases report', 'تقرير المشتريات', { cost: true }),
  report('expenses', 'Expenses report', 'تقرير المصروفات'),
  report('income', 'Income report', 'تقرير الإيرادات', { sale: true }),
  report('payments', 'Payments report', 'تقرير المدفوعات'),
  report('cash', 'Cash report', 'تقرير النقدية'),
  report('outstanding-invoices', 'Outstanding invoices', 'الفواتير المستحقة', { sale: true }),
  report('party-statement', 'Party statement', 'كشف حساب طرف', { sale: true, cost: true }),
  report('trial-balance', 'Trial balance', 'ميزان المراجعة'),
  report('general-journal', 'General journal', 'دفتر اليومية'),
  report('profit-and-loss', 'Profit and loss', 'الأرباح والخسائر', { sale: true, cost: true }),
  report('balance-sheet', 'Balance sheet', 'الميزانية العمومية'),
  report('cash-flow', 'Cash flow', 'التدفق النقدي'),
  report('customer-balances', 'Customer balances', 'أرصدة العملاء', { sale: true }),
  report('supplier-balances', 'Supplier balances', 'أرصدة الموردين', { cost: true }),
  report('account-ledger', 'Account ledger', 'دفتر الأستاذ'),
  report('equity-changes', 'Equity changes', 'تغيرات حقوق الملكية'),
  report('fixed-assets', 'Fixed assets', 'الأصول الثابتة'),
  report('depreciation', 'Depreciation', 'الإهلاك'),
  report('receivables-aging', 'Receivables aging', 'أعمار المدينين', { sale: true }),
  report('payables-aging', 'Payables aging', 'أعمار الدائنين', { cost: true }),
  report('receivables-reconciliation', 'Receivables reconciliation', 'مطابقة المدينين', { sale: true }),
  report('payables-reconciliation', 'Payables reconciliation', 'مطابقة الدائنين', { cost: true }),

  // Inventory reports with their own print routes
  report('inventory-valuation', 'Inventory valuation', 'تقييم المخزون', { cost: true }),
  report('slow-moving', 'Slow-moving stock', 'المخزون الراكد', { cost: true }),
  report('reorder', 'Reorder levels', 'حدود إعادة الطلب', { cost: true }),

  // Labels
  {
    key: 'barcode-labels',
    category: 'LABEL',
    labelEn: 'Barcode labels',
    labelAr: 'ملصقات الباركود',
    carriesSalePrice: true,
    carriesCost: false,
  },
];

const BY_KEY = new Map(PRINT_TYPES.map((type) => [type.key, type]));

export function printType(key: string): PrintType | null {
  return BY_KEY.get(key) ?? null;
}

export function isPrintType(key: string): boolean {
  return BY_KEY.has(key);
}

/// A saved choice: what the company decided for one print type.
export interface PrintPriceSetting {
  documentType: string;
  showSalePrice: boolean;
  showCost: boolean;
}

export interface ResolvedPrintVisibility {
  showSalePrice: boolean;
  showCost: boolean;
  /// Which rule produced the answer, so the screen can say why a cost checkbox
  /// is locked instead of silently ignoring the click.
  source: 'request' | 'type' | 'default' | 'builtin';
  /// True when the caller may not read costs at all: the answer is forced,
  /// whatever the request or the settings say.
  costLocked: boolean;
}

/// The requested choice as it arrives on a query string.
export interface RequestedVisibility {
  showSalePrice?: string | boolean;
  showCost?: string | boolean;
}

function flag(value: string | boolean | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/// The one place that answers "may this copy show this figure?".
///
/// Every PDF and print route goes through it, so the four combinations the
/// operator asked for (show/show, hide sale, hide cost, hide both) mean the
/// same thing in a list, a report, a saved invoice, a stock document and a
/// quotation - and so does the permission floor.
export function resolvePrintVisibility(
  caller: CostVisibilityCaller,
  requested: RequestedVisibility,
  saved: readonly PrintPriceSetting[],
  typeKey?: string | null,
): ResolvedPrintVisibility {
  const mayReadCost = canReadCost(caller);
  const byType = new Map(saved.map((row) => [row.documentType, row]));
  const forType = typeKey ? byType.get(typeKey) : undefined;
  const forDefault = byType.get(DEFAULT_PRINT_TYPE);

  const requestedSale = flag(requested.showSalePrice);
  const requestedCost = flag(requested.showCost);

  let showSalePrice: boolean;
  let showCost: boolean;
  let source: ResolvedPrintVisibility['source'];

  if (requestedSale !== undefined || requestedCost !== undefined) {
    showSalePrice = requestedSale ?? forType?.showSalePrice ?? forDefault?.showSalePrice ?? true;
    showCost = requestedCost ?? forType?.showCost ?? forDefault?.showCost ?? true;
    source = 'request';
  } else if (forType) {
    showSalePrice = forType.showSalePrice;
    showCost = forType.showCost;
    source = 'type';
  } else if (forDefault) {
    showSalePrice = forDefault.showSalePrice;
    showCost = forDefault.showCost;
    source = 'default';
  } else {
    showSalePrice = true;
    showCost = true;
    source = 'builtin';
  }

  return {
    showSalePrice,
    // The floor: a caller without `inventory.cost.read` never receives a cost,
    // even when the saved setting says "show" and the request says "true".
    showCost: showCost && mayReadCost,
    source,
    costLocked: !mayReadCost,
  };
}
