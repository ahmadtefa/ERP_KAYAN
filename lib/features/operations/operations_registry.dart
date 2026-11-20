import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../app/router/app_router.dart';

/// Which operations centre an item belongs to: the entry forms (المدخلات) or
/// the reports and lists (المخرجات).
enum OpsKind { entry, output }

/// One real operation in an operations centre.
///
/// [path] is the existing screen route; `?new=1` deep-links straight into the
/// new-record form so the centre is two clicks to a blank form, never list →
/// add. [permission] uses the same `a|b|c` any-of syntax as the sidebar.
class OpsItem {
  const OpsItem({
    required this.id,
    required this.ar,
    required this.en,
    required this.icon,
    required this.color,
    required this.path,
    required this.permission,
    required this.groupAr,
    required this.groupEn,
    this.opensForm = false,
  });

  final String id;
  final String ar;
  final String en;
  final IconData icon;
  final Color color;
  final String path;
  final String permission;
  final String groupAr;
  final String groupEn;

  /// True when [path] lands on a blank new-record form (entry operations).
  final bool opensForm;

  String label(bool arabic) => arabic ? ar : en;
  String group(bool arabic) => arabic ? groupAr : groupEn;

  bool allowed(bool Function(String permission) can) =>
      permission.split('|').any(can);

  String get newFormPath => opensForm && !path.contains('?')
      ? '$path?new=1'
      : path;
}

class OperationsRegistry {
  static const _sales = ('المبيعات', 'Sales');
  static const _purchases = ('المشتريات', 'Purchases');
  static const _finance = ('الحسابات والمالية', 'Accounts & finance');
  static const _inventory = ('المخازن', 'Inventory');
  static const _parties = ('العملاء والموردون', 'Customers & suppliers');
  static const _admin = ('الإدارة', 'Administration');
  static const _audit = ('الإدارة والتدقيق', 'Administration & audit');

  static const salesColor = Color(0xFF2259CF);
  static const purchasesColor = Color(0xFFCC6417);
  static const inventoryColor = Color(0xFF218653);
  static const financeColor = Color(0xFF7052B7);
  static const partiesColor = Color(0xFFA34593);
  static const suppliersColor = Color(0xFFBB3F48);
  static const adminColor = Color(0xFF475569);

  static const returnsPipe =
      'sales.returns.read|sales.invoices.read|sales.invoices.create';
  static const purchaseReturnsPipe =
      'purchases.returns.read|purchases.invoices.read|purchases.invoices.create';
  static const cashPipe = 'cash.accounts.read|cash.vouchers.read|cash.reports.read';

  /// Every real entry operation: new records plus the two entry workflows
  /// (opening balances, company data) whose screen is the form itself.
  static List<OpsItem> entries() => [
        OpsItem(
          id: 'sales-invoice-new', ar: 'فاتورة مبيعات جديدة', en: 'New sales invoice',
          icon: Icons.point_of_sale_rounded, color: salesColor,
          path: AppRoutes.salesInvoices, permission: 'sales.invoices.read',
          groupAr: _sales.$1, groupEn: _sales.$2, opensForm: true),
        OpsItem(
          id: 'sales-order-new', ar: 'أمر بيع جديد', en: 'New sales order',
          icon: Icons.playlist_add_check_rounded, color: salesColor,
          path: AppRoutes.salesOrders, permission: 'sales.orders.read',
          groupAr: _sales.$1, groupEn: _sales.$2, opensForm: true),
        OpsItem(
          id: 'sales-return-new', ar: 'مرتجع مبيعات جديد', en: 'New sales return',
          icon: Icons.assignment_return_rounded, color: salesColor,
          path: AppRoutes.salesReturnNew, permission: returnsPipe,
          groupAr: _sales.$1, groupEn: _sales.$2, opensForm: true),
        OpsItem(
          id: 'purchase-invoice-new', ar: 'فاتورة شراء جديدة', en: 'New purchase invoice',
          icon: Icons.shopping_cart_rounded, color: purchasesColor,
          path: AppRoutes.purchaseInvoices, permission: 'purchases.invoices.read',
          groupAr: _purchases.$1, groupEn: _purchases.$2, opensForm: true),
        OpsItem(
          id: 'purchase-order-new', ar: 'أمر شراء جديد', en: 'New purchase order',
          icon: Icons.playlist_add_check_rounded, color: purchasesColor,
          path: AppRoutes.purchaseOrders, permission: 'purchases.orders.read',
          groupAr: _purchases.$1, groupEn: _purchases.$2, opensForm: true),
        OpsItem(
          id: 'purchase-return-new', ar: 'مرتجع شراء جديد', en: 'New purchase return',
          icon: Icons.keyboard_return_rounded, color: purchasesColor,
          path: AppRoutes.purchaseReturnNew, permission: purchaseReturnsPipe,
          groupAr: _purchases.$1, groupEn: _purchases.$2, opensForm: true),
        OpsItem(
          id: 'journal-new', ar: 'قيد يومية جديد', en: 'New journal entry',
          icon: Icons.post_add_rounded, color: financeColor,
          path: AppRoutes.journalEntries, permission: 'accounting.journal.read',
          groupAr: _finance.$1, groupEn: _finance.$2, opensForm: true),
        OpsItem(
          id: 'opening-balances', ar: 'إدخال الأرصدة الأولية', en: 'Opening balances entry',
          icon: Icons.account_balance_wallet_rounded, color: financeColor,
          path: AppRoutes.openingBalances,
          permission: 'accounting.openingbalances.read|accounting.openingbalances.manage',
          groupAr: _finance.$1, groupEn: _finance.$2),
        OpsItem(
          id: 'voucher-new', ar: 'سند قبض أو صرف أو مصروفات', en: 'Cash voucher (receipt/payment/expense)',
          icon: Icons.payments_rounded, color: financeColor,
          path: AppRoutes.cash, permission: cashPipe,
          groupAr: _finance.$1, groupEn: _finance.$2, opensForm: true),
        OpsItem(
          id: 'customer-new', ar: 'عميل جديد', en: 'New customer',
          icon: Icons.person_add_rounded, color: partiesColor,
          path: AppRoutes.customers, permission: 'parties.customers.read',
          groupAr: _parties.$1, groupEn: _parties.$2, opensForm: true),
        OpsItem(
          id: 'supplier-new', ar: 'مورد جديد', en: 'New supplier',
          icon: Icons.local_shipping_rounded, color: suppliersColor,
          path: AppRoutes.suppliers, permission: 'parties.suppliers.read',
          groupAr: _parties.$1, groupEn: _parties.$2, opensForm: true),
        OpsItem(
          id: 'item-new', ar: 'صنف جديد', en: 'New item',
          icon: Icons.inventory_2_rounded, color: inventoryColor,
          path: AppRoutes.items, permission: 'inventory.items.read',
          groupAr: _inventory.$1, groupEn: _inventory.$2, opensForm: true),
        OpsItem(
          id: 'warehouse-new', ar: 'مستودع جديد', en: 'New warehouse',
          icon: Icons.warehouse_rounded, color: inventoryColor,
          path: AppRoutes.warehouses, permission: 'inventory.warehouses.read',
          groupAr: _inventory.$1, groupEn: _inventory.$2, opensForm: true),
        OpsItem(
          id: 'stocktake-new', ar: 'جلسة جرد جديدة', en: 'New stock take',
          icon: Icons.playlist_add_check_circle_rounded, color: inventoryColor,
          path: AppRoutes.stockTakes, permission: 'inventory.stocktake.read',
          groupAr: _inventory.$1, groupEn: _inventory.$2, opensForm: true),
        OpsItem(
          id: 'writeoff-new', ar: 'تسوية أو إتلاف مخزون', en: 'New write-off / stock adjustment',
          icon: Icons.remove_shopping_cart_rounded, color: inventoryColor,
          path: AppRoutes.writeOffs, permission: 'inventory.stock.read',
          groupAr: _inventory.$1, groupEn: _inventory.$2, opensForm: true),
        OpsItem(
          id: 'user-new', ar: 'مستخدم جديد', en: 'New user',
          icon: Icons.person_add_alt_rounded, color: adminColor,
          path: AppRoutes.administration, permission: 'admin.users.manage',
          groupAr: _admin.$1, groupEn: _admin.$2, opensForm: true),
        OpsItem(
          id: 'company-data', ar: 'بيانات الشركة', en: 'Company data',
          icon: Icons.business_rounded, color: adminColor,
          path: AppRoutes.companySettings, permission: 'admin.company.manage',
          groupAr: _admin.$1, groupEn: _admin.$2),
      ];

  /// Every real report, list, statement and query screen.
  static List<OpsItem> outputs() => [
        OpsItem(
          id: 'journal-list', ar: 'دفتر اليومية', en: 'Journal ledger',
          icon: Icons.menu_book_rounded, color: financeColor,
          path: AppRoutes.journalEntries, permission: 'accounting.journal.read',
          groupAr: _finance.$1, groupEn: _finance.$2),
        OpsItem(
          id: 'trial-balance', ar: 'ميزان المراجعة', en: 'Trial balance',
          icon: Icons.balance_rounded, color: financeColor,
          path: AppRoutes.reports, permission: 'reports.read',
          groupAr: _finance.$1, groupEn: _finance.$2),
        OpsItem(
          id: 'account-balances', ar: 'أرصدة الحسابات', en: 'Account balances',
          icon: Icons.savings_rounded, color: financeColor,
          path: AppRoutes.reports, permission: 'reports.read',
          groupAr: _finance.$1, groupEn: _finance.$2),
        OpsItem(
          id: 'cost-centers', ar: 'تقارير مراكز التكلفة', en: 'Cost centre reports',
          icon: Icons.pie_chart_rounded, color: financeColor,
          path: AppRoutes.costCenters, permission: 'accounting.costcenters.read',
          groupAr: _finance.$1, groupEn: _finance.$2),
        OpsItem(
          id: 'budgets', ar: 'الميزانيات', en: 'Budgets',
          icon: Icons.trending_up_rounded, color: financeColor,
          path: AppRoutes.budgets, permission: 'accounting.budgets.read',
          groupAr: _finance.$1, groupEn: _finance.$2),
        OpsItem(
          id: 'fixed-assets', ar: 'الأصول الثابتة', en: 'Fixed assets',
          icon: Icons.domain_rounded, color: financeColor,
          path: AppRoutes.fixedAssets, permission: 'accounting.fixedassets.read',
          groupAr: _finance.$1, groupEn: _finance.$2),
        OpsItem(
          id: 'fiscal-periods', ar: 'الفترات المالية', en: 'Fiscal periods',
          icon: Icons.date_range_rounded, color: financeColor,
          path: AppRoutes.fiscalPeriods, permission: 'accounting.periods.read',
          groupAr: _finance.$1, groupEn: _finance.$2),
        OpsItem(
          id: 'sales-invoices', ar: 'فواتير المبيعات', en: 'Sales invoices',
          icon: Icons.receipt_long_rounded, color: salesColor,
          path: AppRoutes.salesInvoices, permission: 'sales.invoices.read',
          groupAr: _sales.$1, groupEn: _sales.$2),
        OpsItem(
          id: 'sales-returns', ar: 'مرتجعات المبيعات', en: 'Sales returns',
          icon: Icons.assignment_return_rounded, color: salesColor,
          path: AppRoutes.salesReturns, permission: returnsPipe,
          groupAr: _sales.$1, groupEn: _sales.$2),
        OpsItem(
          id: 'sales-orders', ar: 'أوامر البيع', en: 'Sales orders',
          icon: Icons.playlist_add_check_rounded, color: salesColor,
          path: AppRoutes.salesOrders, permission: 'sales.orders.read',
          groupAr: _sales.$1, groupEn: _sales.$2),
        OpsItem(
          id: 'purchase-invoices', ar: 'فواتير الشراء', en: 'Purchase invoices',
          icon: Icons.shopping_cart_rounded, color: purchasesColor,
          path: AppRoutes.purchaseInvoices, permission: 'purchases.invoices.read',
          groupAr: _purchases.$1, groupEn: _purchases.$2),
        OpsItem(
          id: 'purchase-returns', ar: 'مرتجعات الشراء', en: 'Purchase returns',
          icon: Icons.keyboard_return_rounded, color: purchasesColor,
          path: AppRoutes.purchaseReturns, permission: purchaseReturnsPipe,
          groupAr: _purchases.$1, groupEn: _purchases.$2),
        OpsItem(
          id: 'purchase-orders', ar: 'أوامر الشراء', en: 'Purchase orders',
          icon: Icons.playlist_add_check_rounded, color: purchasesColor,
          path: AppRoutes.purchaseOrders, permission: 'purchases.orders.read',
          groupAr: _purchases.$1, groupEn: _purchases.$2),
        OpsItem(
          id: 'customers', ar: 'العملاء وكشوف الحسابات', en: 'Customers & statements',
          icon: Icons.groups_rounded, color: partiesColor,
          path: AppRoutes.customers, permission: 'parties.customers.read',
          groupAr: _parties.$1, groupEn: _parties.$2),
        OpsItem(
          id: 'suppliers', ar: 'الموردون وكشوف الحسابات', en: 'Suppliers & statements',
          icon: Icons.local_shipping_rounded, color: suppliersColor,
          path: AppRoutes.suppliers, permission: 'parties.suppliers.read',
          groupAr: _parties.$1, groupEn: _parties.$2),
        OpsItem(
          id: 'stock', ar: 'الرصيد الحالي', en: 'Current stock',
          icon: Icons.inventory_2_rounded, color: inventoryColor,
          path: AppRoutes.stock, permission: 'inventory.stock.read',
          groupAr: _inventory.$1, groupEn: _inventory.$2),
        OpsItem(
          id: 'stock-documents', ar: 'مستندات المخزون وحركتها', en: 'Stock documents & movement',
          icon: Icons.description_rounded, color: inventoryColor,
          path: AppRoutes.stockDocuments, permission: 'inventory.stock.read',
          groupAr: _inventory.$1, groupEn: _inventory.$2),
        OpsItem(
          id: 'batches', ar: 'الدفعات', en: 'Batches',
          icon: Icons.layers_rounded, color: inventoryColor,
          path: AppRoutes.batches, permission: 'inventory.batches.read',
          groupAr: _inventory.$1, groupEn: _inventory.$2),
        OpsItem(
          id: 'expiry', ar: 'تنبيهات الصلاحية', en: 'Expiry alerts',
          icon: Icons.timer_rounded, color: inventoryColor,
          path: AppRoutes.expiryAlerts, permission: 'inventory.batches.read',
          groupAr: _inventory.$1, groupEn: _inventory.$2),
        OpsItem(
          id: 'inventory-reports', ar: 'تقارير المخزون', en: 'Inventory reports',
          icon: Icons.assessment_rounded, color: inventoryColor,
          path: AppRoutes.inventoryReports, permission: 'inventory.stock.read',
          groupAr: _inventory.$1, groupEn: _inventory.$2),
        OpsItem(
          id: 'stock-takes', ar: 'جلسات الجرد', en: 'Stock takes',
          icon: Icons.playlist_add_check_circle_rounded, color: inventoryColor,
          path: AppRoutes.stockTakes, permission: 'inventory.stocktake.read',
          groupAr: _inventory.$1, groupEn: _inventory.$2),
        OpsItem(
          id: 'write-offs', ar: 'التسويات والإتلافات', en: 'Write-offs & adjustments',
          icon: Icons.remove_shopping_cart_rounded, color: inventoryColor,
          path: AppRoutes.writeOffs, permission: 'inventory.stock.read',
          groupAr: _inventory.$1, groupEn: _inventory.$2),
        OpsItem(
          id: 'cash', ar: 'النقدية والبنوك', en: 'Cash & banks',
          icon: Icons.account_balance_rounded, color: financeColor,
          path: AppRoutes.cash, permission: cashPipe,
          groupAr: _finance.$1, groupEn: _finance.$2),
        OpsItem(
          id: 'reports', ar: 'التقارير العامة', en: 'General reports',
          icon: Icons.bar_chart_rounded, color: financeColor,
          path: AppRoutes.reports, permission: 'reports.read',
          groupAr: _finance.$1, groupEn: _finance.$2),
        OpsItem(
          id: 'import', ar: 'استيراد البيانات', en: 'Import data',
          icon: Icons.upload_file_rounded, color: adminColor,
          path: AppRoutes.importData, permission: 'admin.backup',
          groupAr: _audit.$1, groupEn: _audit.$2),
        OpsItem(
          id: 'backup', ar: 'النسخ الاحتياطي', en: 'Backup',
          icon: Icons.verified_user_rounded, color: adminColor,
          path: AppRoutes.backup, permission: 'admin.backup',
          groupAr: _audit.$1, groupEn: _audit.$2),
        OpsItem(
          id: 'notifications', ar: 'سجل التنبيهات', en: 'Notification log',
          icon: Icons.notifications_rounded, color: adminColor,
          path: AppRoutes.notifications, permission: 'notifications.read',
          groupAr: _audit.$1, groupEn: _audit.$2),
        OpsItem(
          id: 'administration', ar: 'إدارة المستخدمين والصلاحيات', en: 'Users & permissions',
          icon: Icons.admin_panel_settings_rounded, color: adminColor,
          path: AppRoutes.administration, permission: 'admin.users.manage',
          groupAr: _audit.$1, groupEn: _audit.$2),
      ];

  static List<OpsItem> forKind(OpsKind kind) =>
      kind == OpsKind.entry ? entries() : outputs();
}

/// Per-user favourites and usage counts for the operations centres, kept in
/// local preferences so they survive logout and restart. Keys are scoped by
/// user id and company id so no profile leaks into another.
class OpsPrefs {
  OpsPrefs(this._userId, this._companyId);

  final String _userId;
  final String _companyId;

  String _favKey(OpsKind kind) =>
      'ops_favs_v1_${_companyId}_${_userId}_${kind.name}';
  String _useKey(OpsKind kind) =>
      'ops_usage_v1_${_companyId}_${_userId}_${kind.name}';

  Future<Set<String>> favorites(OpsKind kind) async {
    final store = await SharedPreferences.getInstance();
    final raw = store.getString(_favKey(kind));
    if (raw == null || raw.isEmpty) return const {};
    try {
      return (jsonDecode(raw) as List<dynamic>).cast<String>().toSet();
    } catch (_) {
      return const {};
    }
  }

  Future<void> setFavorite(OpsKind kind, String id, bool pinned) async {
    final store = await SharedPreferences.getInstance();
    final current = Set<String>.of(await favorites(kind));
    if (pinned) {
      current.add(id);
    } else {
      current.remove(id);
    }
    await store.setString(_favKey(kind), jsonEncode(current.toList()));
  }

  Future<Map<String, int>> usage(OpsKind kind) async {
    final store = await SharedPreferences.getInstance();
    final raw = store.getString(_useKey(kind));
    if (raw == null || raw.isEmpty) return const {};
    try {
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      return decoded.map((key, value) => MapEntry(key, value as int));
    } catch (_) {
      return const {};
    }
  }

  Future<void> recordUse(OpsKind kind, String id) async {
    final store = await SharedPreferences.getInstance();
    final current = Map<String, int>.of(await usage(kind));
    current[id] = (current[id] ?? 0) + 1;
    await store.setString(_useKey(kind), jsonEncode(current));
  }
}
