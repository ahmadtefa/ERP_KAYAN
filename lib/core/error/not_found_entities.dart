/// Names of the records the server can report as missing, keyed by the
/// allowlisted `<NAME>_NOT_FOUND` code. Each entry is `[Arabic, English]` and
/// is the whole of what the app adds: the server sentence is never shown for
/// these codes, and a code that is not listed here falls back to the generic
/// "not found" sentence.
const Map<String, List<String>> notFoundEntities = {
  'ACCOUNT_NOT_FOUND': ['الحساب', 'account'],
  'APPROVAL_HISTORY_NOT_FOUND': ['سجل الاعتماد', 'approval history'],
  'APPROVAL_POLICY_NOT_FOUND': ['سياسة الاعتماد', 'approval policy'],
  'BACKGROUND_NOT_FOUND': ['الخلفية', 'background'],
  'BATCH_NOT_FOUND': ['الدفعة', 'batch'],
  'BRANCH_NOT_FOUND': ['الفرع', 'branch'],
  'BUDGET_NOT_FOUND': ['الموازنة', 'budget'],
  'CASH_ACCOUNT_NOT_FOUND': ['حساب الخزينة أو البنك', 'cash or bank account'],
  'CASH_VOUCHER_NOT_FOUND': ['سند الخزينة', 'cash voucher'],
  'CHEQUE_NOT_FOUND': ['الشيك', 'cheque'],
  'COMPANY_LOGO_NOT_FOUND': ['شعار الشركة', 'company logo'],
  'COMPANY_NOT_FOUND': ['الشركة', 'company'],
  'CUSTOMER_NOT_FOUND': ['العميل', 'customer'],
  'COST_CENTER_NOT_FOUND': ['مركز التكلفة', 'cost center'],
  'DRAFT_SALES_INVOICE_NOT_FOUND': ['مسودة فاتورة البيع', 'draft sales invoice'],
  'FISCAL_PERIOD_NOT_FOUND': ['الفترة المالية', 'fiscal period'],
  'FIXED_ASSET_NOT_FOUND': ['الأصل الثابت', 'fixed asset'],
  'ITEM_NOT_FOUND': ['الصنف', 'item'],
  'JOURNAL_ENTRY_NOT_FOUND': ['قيد اليومية', 'journal entry'],
  'NOTIFICATION_NOT_FOUND': ['الإشعار', 'notification'],
  'OPENING_BALANCE_DOCUMENT_NOT_FOUND': ['مستند الرصيد الافتتاحي', 'opening balance document'],
  'PRICE_LIST_NOT_FOUND': ['قائمة الأسعار', 'price list'],
  'PURCHASE_INVOICE_NOT_FOUND': ['فاتورة الشراء', 'purchase invoice'],
  'PURCHASE_ORDER_NOT_FOUND': ['أمر الشراء', 'purchase order'],
  'QUOTATION_COLUMN_TEMPLATE_NOT_FOUND': ['قالب أعمدة عرض السعر', 'quotation column template'],
  'QUOTATION_DESIGN_TEMPLATE_NOT_FOUND': ['قالب تصميم عرض السعر', 'quotation design template'],
  'QUOTATION_NOT_FOUND': ['عرض السعر', 'quotation'],
  'QUOTATION_TERM_NOT_FOUND': ['بند الشروط', 'quotation term'],
  'RECONCILIATION_NOT_FOUND': ['التسوية البنكية', 'reconciliation'],
  'REPORT_NOT_FOUND': ['التقرير', 'report'],
  'RETURN_DOCUMENT_NOT_FOUND': ['مستند المرتجع', 'return document'],
  'ROLE_NOT_FOUND': ['الدور', 'role'],
  'SALES_INVOICE_NOT_FOUND': ['فاتورة البيع', 'sales invoice'],
  'SALES_ORDER_NOT_FOUND': ['أمر البيع', 'sales order'],
  'SUPPLIER_NOT_FOUND': ['المورّد', 'supplier'],
  'SERIAL_NUMBER_NOT_FOUND': ['الرقم التسلسلي', 'serial number'],
  'STOCK_DOCUMENT_NOT_FOUND': ['مستند المخزون', 'stock document'],
  'STOCK_TAKE_SESSION_NOT_FOUND': ['جلسة الجرد', 'stock-take session'],
  'STOCK_TRANSFER_NOT_FOUND': ['تحويل المخزون', 'stock transfer'],
  'STOCK_VOUCHER_NOT_FOUND': ['سند المخزون', 'stock voucher'],
  'STORAGE_LOCATION_NOT_FOUND': ['موقع التخزين', 'storage location'],
  'TRANSFER_NOT_FOUND': ['التحويل', 'transfer'],
  'UNIT_NOT_FOUND': ['وحدة القياس', 'unit of measure'],
  'USER_NOT_FOUND': ['المستخدم', 'user'],
  'USER_PHOTO_NOT_FOUND': ['صورة المستخدم', 'user photo'],
  'VOUCHER_NOT_FOUND': ['السند', 'voucher'],
  'WAREHOUSE_NOT_FOUND': ['المخزن', 'warehouse'],
  'WITHHOLDING_RATE_NOT_FOUND': ['نسبة ضريبة الخصم والإضافة', 'withholding rate'],
};

/// The reviewed sentence for a missing record, or null when the code is not on the list.
String? notFoundSentence(String? code, {required bool isArabic}) {
  final entry = code == null ? null : notFoundEntities[code];
  if (entry == null) return null;
  return isArabic
      ? 'تعذر العثور على ${entry[0]}. ربما حُذف أو غيّره مستخدم آخر. حدّث الشاشة ثم اختره من القائمة مرة أخرى. لم تُنفَّذ العملية.'
      : 'The ${entry[1]} could not be found. It may have been deleted or changed by someone else. Reload the screen and choose it from the list again. The action was not carried out.';
}
