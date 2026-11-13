import 'draft_exit_guard.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/accounting/presentation/screens/budgets_screen.dart';
import '../../features/accounting/presentation/screens/chart_of_accounts_screen.dart';
import '../../features/accounting/presentation/screens/cost_centers_screen.dart';
import '../../features/accounting/presentation/screens/fiscal_periods_screen.dart';
import '../../features/fixed_assets/presentation/fixed_assets_screen.dart';
import '../../features/admin/presentation/screens/admin_screen.dart';
import '../../features/accounting/presentation/screens/journal_entries_screen.dart';
import '../../features/accounting/presentation/screens/opening_balances_screen.dart';
import '../../features/auth/presentation/providers/auth_providers.dart';
import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/cash/presentation/screens/cash_screen.dart';
import '../../features/dashboard/presentation/screens/dashboard_screen.dart';
import '../../features/data/presentation/screens/backup_screen.dart';
import '../../features/data/presentation/screens/import_screen.dart';
import '../../features/inventory/presentation/screens/items_screen.dart';
import '../../features/inventory/presentation/screens/stock_screen.dart';
import '../../features/inventory/presentation/screens/warehouses_screen.dart';
import '../../features/inventory/presentation/screens/batches_screen.dart';
import '../../features/inventory/presentation/screens/expiry_alerts_screen.dart';
import '../../features/notifications/presentation/screens/notification_center_screen.dart';
import '../../features/inventory/presentation/screens/storage_locations_screen.dart';
import '../../features/inventory/presentation/screens/item_thresholds_screen.dart';
import '../../features/inventory/presentation/screens/stock_takes_screen.dart';
import '../../features/inventory/presentation/screens/write_offs_screen.dart';
import '../../features/inventory/presentation/screens/stock_documents_screen.dart';
import '../../features/inventory/presentation/screens/inventory_reports_screen.dart';
import '../../features/inventory/presentation/screens/warehouse_access_screen.dart';
import '../../features/invoicing/presentation/providers/invoice_providers.dart';
import '../../features/licensing/presentation/screens/licence_screen.dart';
import '../../features/invoicing/presentation/screens/invoice_list_screen.dart';
import '../../features/invoicing/presentation/screens/return_editor_screen.dart';
import '../../features/invoicing/presentation/screens/returns_screen.dart';
import '../../features/parties/presentation/screens/parties_screen.dart';
import '../../features/orders/presentation/orders_screen.dart';
import '../../features/quotations/presentation/screens/quotation_editor_screen.dart';
import '../../features/quotations/presentation/screens/quotation_list_screen.dart';
import '../../features/reports/presentation/reports_screen.dart';
import '../../features/settings/presentation/screens/company_settings_screen.dart';
import '../../features/settings/presentation/screens/settings_screen.dart';
import '../shell/erp_shell.dart';

/// Bridges Riverpod session state to a [Listenable] that `GoRouter` can watch.
class AuthRouterNotifier extends ChangeNotifier {
  AuthRouterNotifier(Ref ref) {
    ref.listen(authControllerProvider, (_, _) => notifyListeners());
  }
}

final _routerNotifierProvider = Provider<AuthRouterNotifier>(
  AuthRouterNotifier.new,
);

class AppRoutes {
  AppRoutes._();

  static const login = '/login';
  static const dashboard = '/dashboard';
  static const chartOfAccounts = '/accounting/chart-of-accounts';
  static const costCenters = '/accounting/cost-centers';
  static const budgets = '/accounting/budgets';
  static const journalEntries = '/accounting/journal-entries';
  static const fiscalPeriods = '/accounting/fiscal-periods';
  static const fixedAssets = '/accounting/fixed-assets';
  static const openingBalances = '/accounting/opening-balances';
  static const cash = '/cash';
  static const customers = '/parties/customers';
  static const suppliers = '/parties/suppliers';
  static const items = '/inventory/items';
  static const stock = '/inventory/stock';
  static const salesOrders = '/sales/orders';
  static const purchaseOrders = '/purchases/orders';
  static const salesInvoices = '/sales/invoices';
  static const purchaseInvoices = '/purchases/invoices';
  static const quotations = '/sales/quotations';
  static const quotationNew = '/sales/quotations/new';
  static const salesReturns = '/sales/returns';
  static const purchaseReturns = '/purchases/returns';
  static const salesReturnNew = '/sales/returns/new';
  static const purchaseReturnNew = '/purchases/returns/new';
  static const reports = '/reports';
  static const importData = '/data/import';
  static const backup = '/data/backup';
  static const administration = '/administration';
  static const companySettings = '/settings/company';
  static const settings = '/settings';
  static const licence = '/settings/licence';

  // Inventory sub-screens. The routes are declared here so the navigation and
  // the screens can be added one at a time; a path is only registered in the
  // router once its screen exists, so none of these is reachable yet.
  static const warehouses = '/inventory/warehouses';
  static const batches = '/inventory/batches';
  static const expiryAlerts = '/inventory/expiry-alerts';
  static const notifications = '/notifications';
  static const storageLocations = '/inventory/locations';
  static const itemThresholds = '/inventory/thresholds';
  static const stockTakes = '/inventory/stock-takes';
  static const writeOffs = '/inventory/write-offs';
  static const warehouseAccess = '/inventory/warehouse-access';
  static const inventoryReports = '/inventory/reports';
  static const stockDocuments = '/inventory/documents';
}

final routerProvider = Provider<GoRouter>((ref) {
  final notifier = ref.watch(_routerNotifierProvider);

  return GoRouter(
    initialLocation: AppRoutes.login,
    refreshListenable: notifier,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final location = state.matchedLocation;

      // While the persisted session is still being restored, do not redirect:
      // bouncing to /login first would flash the login screen on every start.
      if (auth.isLoading && auth.value == null) return null;

      final isSignedIn = auth.value != null;
      final onLogin = location == AppRoutes.login;

      if (!isSignedIn) return onLogin ? null : AppRoutes.login;
      if (onLogin) return AppRoutes.dashboard;
      return null;
    },
    routes: [
      GoRoute(
        path: AppRoutes.login,
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: AppRoutes.salesReturnNew,
        onExit: (context, state) => ref.read(currentUserProvider) == null
            ? true : ref.read(draftExitGuardProvider).canLeave(state.pageKey),
        builder: (context, state) => ErpShell(
          currentPath: AppRoutes.salesReturns,
          guardKey: state.pageKey,
          child: ReturnEditorScreen(kind: InvoiceKind.sales, navigationKey: state.pageKey),
        ),
      ),
      GoRoute(
        path: AppRoutes.purchaseReturnNew,
        onExit: (context, state) => ref.read(currentUserProvider) == null
            ? true : ref.read(draftExitGuardProvider).canLeave(state.pageKey),
        builder: (context, state) => ErpShell(
          currentPath: AppRoutes.purchaseReturns,
          guardKey: state.pageKey,
          child: ReturnEditorScreen(kind: InvoiceKind.purchase, navigationKey: state.pageKey),
        ),
      ),
      GoRoute(
        path: AppRoutes.quotationNew,
        onExit: (context, state) => ref.read(currentUserProvider) == null
            ? true : ref.read(draftExitGuardProvider).canLeave(state.pageKey),
        builder: (context, state) => ErpShell(
          currentPath: AppRoutes.quotations,
          guardKey: state.pageKey,
          child: QuotationEditorScreen(navigationKey: state.pageKey),
        ),
      ),
      GoRoute(
        path: '${AppRoutes.quotations}/:id/edit',
        onExit: (context, state) => ref.read(currentUserProvider) == null
            ? true : ref.read(draftExitGuardProvider).canLeave(state.pageKey),
        builder: (context, state) => ErpShell(
          currentPath: AppRoutes.quotations,
          guardKey: state.pageKey,
          child: QuotationEditorScreen(
            key: ValueKey('quotation-edit-${state.pathParameters['id']}'),
            navigationKey: state.pageKey,
            quotationId: state.pathParameters['id'],
          ),
        ),
      ),
      GoRoute(
        path: '${AppRoutes.openingBalances}/:id',
        onExit: (_, state) => ref.read(currentUserProvider) == null
            ? true : ref.read(draftExitGuardProvider).canLeave(state.pageKey),
        builder: (context, state) => ErpShell(
          currentPath: AppRoutes.openingBalances,
          guardKey: state.pageKey,
          child: OpeningBalancesScreen(
            documentId: state.pathParameters['id'],
            navigationKey: state.pageKey,
          ),
        ),
      ),
      for (final route in _shellRoutes)
        GoRoute(
          path: route.path,
          onExit: _guardedShellPaths.contains(route.path)
            ? (context,state) => ref.read(currentUserProvider) == null
                ? true : ref.read(draftExitGuardProvider).canLeave(state.pageKey)
            : null,
          builder: (context, state) => ErpShell(currentPath: route.path,
            guardKey: _guardedShellPaths.contains(route.path) ? state.pageKey : null,
            child:route.path == AppRoutes.administration
              ? AdminScreen(navigationKey:state.pageKey)
              : route.path == AppRoutes.chartOfAccounts
              ? ChartOfAccountsScreen(navigationKey:state.pageKey)
              : route.path == AppRoutes.budgets
              ? BudgetsScreen(navigationKey:state.pageKey)
              : route.path == AppRoutes.fiscalPeriods
              ? FiscalPeriodsScreen(navigationKey:state.pageKey)
              : route.path == AppRoutes.fixedAssets
              ? FixedAssetsScreen(navigationKey:state.pageKey)
              : route.path == AppRoutes.costCenters
              ? CostCentersScreen(navigationKey:state.pageKey)
              : route.path == AppRoutes.items
              ? ItemsScreen(navigationKey:state.pageKey)
              : route.path == AppRoutes.customers
                ? PartiesScreen(kind:PartyKind.customer,navigationKey:state.pageKey)
                : route.path == AppRoutes.suppliers
                  ? PartiesScreen(kind:PartyKind.supplier,navigationKey:state.pageKey)
                  : route.path == AppRoutes.cash
              ? CashScreen(navigationKey:state.pageKey)
              : route.path == AppRoutes.journalEntries
              ? JournalEntriesScreen(navigationKey:state.pageKey)
              : route.path == AppRoutes.companySettings
                ? CompanySettingsScreen(navigationKey:state.pageKey)
              : route.path == AppRoutes.salesInvoices
                ? InvoiceListScreen(kind:InvoiceKind.sales,navigationKey:state.pageKey)
                : route.path == AppRoutes.purchaseInvoices
                  ? InvoiceListScreen(kind:InvoiceKind.purchase,navigationKey:state.pageKey)
                  : route.path == AppRoutes.salesOrders
                    ? OrdersScreen(kind:InvoiceKind.sales,navigationKey:state.pageKey)
                    : route.path == AppRoutes.purchaseOrders
                      ? OrdersScreen(kind:InvoiceKind.purchase,navigationKey:state.pageKey)
                      : route.path == AppRoutes.stock
                        ? StockScreen(navigationKey:state.pageKey)
                        : route.path == AppRoutes.warehouses
                          ? WarehousesScreen(navigationKey: state.pageKey)
                          : route.path == AppRoutes.openingBalances
                            ? OpeningBalancesScreen(navigationKey: state.pageKey)
                          : route.path == AppRoutes.batches
                            ? BatchesScreen()
                            : route.path == AppRoutes.storageLocations
                              ? StorageLocationsScreen()
                              : route.path == AppRoutes.itemThresholds
                                ? ItemThresholdsScreen()
                                : route.path == AppRoutes.stockTakes
                                  ? StockTakesScreen()
                                  : route.path == AppRoutes.writeOffs
                                    ? WriteOffsScreen()
                                    : route.path == AppRoutes.stockDocuments
                                      ? StockDocumentsScreen()
                                      : route.path == AppRoutes.inventoryReports
                                        ? InventoryReportsScreen()
                                        : route.path == AppRoutes.warehouseAccess
                                          ? WarehouseAccessScreen()
                                          : route.child),
        ),
    ],
  );
});

const _guardedShellPaths = <String>{
  AppRoutes.administration, AppRoutes.chartOfAccounts, AppRoutes.budgets, AppRoutes.fiscalPeriods, AppRoutes.fixedAssets, AppRoutes.costCenters, AppRoutes.items, AppRoutes.customers, AppRoutes.suppliers, AppRoutes.cash, AppRoutes.companySettings, AppRoutes.journalEntries, AppRoutes.salesInvoices, AppRoutes.purchaseInvoices,
  AppRoutes.salesOrders, AppRoutes.purchaseOrders, AppRoutes.stock,
  AppRoutes.warehouses, AppRoutes.openingBalances,
  AppRoutes.batches,
  AppRoutes.expiryAlerts,
  AppRoutes.storageLocations,
  AppRoutes.itemThresholds,
  AppRoutes.stockTakes,
  AppRoutes.writeOffs,
  AppRoutes.stockDocuments,
  AppRoutes.inventoryReports,
  AppRoutes.warehouseAccess,
  AppRoutes.notifications,
};

/// Every authenticated screen, in the order the navigation shows them.
const _shellRoutes = <({String path, Widget child})>[
  (path: AppRoutes.dashboard, child: DashboardScreen()),
  (path: AppRoutes.notifications, child: NotificationCenterScreen()),
  (path: AppRoutes.cash, child: CashScreen()),
  (path: AppRoutes.journalEntries, child: JournalEntriesScreen()),
  (path: AppRoutes.fiscalPeriods, child: FiscalPeriodsScreen()),
  (path: AppRoutes.fixedAssets, child: FixedAssetsScreen()),
  (path: AppRoutes.openingBalances, child: OpeningBalancesScreen()),
  (
    path: AppRoutes.customers,
    child: PartiesScreen(kind: PartyKind.customer),
  ),
  (
    path: AppRoutes.suppliers,
    child: PartiesScreen(kind: PartyKind.supplier),
  ),
  (path: AppRoutes.items, child: ItemsScreen()),
  (path: AppRoutes.stock, child: StockScreen()),
  (path: AppRoutes.warehouses, child: WarehousesScreen()),
  (path: AppRoutes.batches, child: BatchesScreen()),
  (path: AppRoutes.expiryAlerts, child: ExpiryAlertsScreen()),
  (path: AppRoutes.storageLocations, child: StorageLocationsScreen()),
  (path: AppRoutes.itemThresholds, child: ItemThresholdsScreen()),
  (path: AppRoutes.stockTakes, child: StockTakesScreen()),
  (path: AppRoutes.writeOffs, child: WriteOffsScreen()),
  (path: AppRoutes.stockDocuments, child: StockDocumentsScreen()),
  (path: AppRoutes.inventoryReports, child: InventoryReportsScreen()),
  (path: AppRoutes.warehouseAccess, child: WarehouseAccessScreen()),
  (path: AppRoutes.salesOrders, child: OrdersScreen(kind: InvoiceKind.sales)),
  (path: AppRoutes.purchaseOrders, child: OrdersScreen(kind: InvoiceKind.purchase)),
  (
    path: AppRoutes.salesInvoices,
    child: InvoiceListScreen(kind: InvoiceKind.sales),
  ),
  (
    path: AppRoutes.purchaseInvoices,
    child: InvoiceListScreen(kind: InvoiceKind.purchase),
  ),
  (path: AppRoutes.quotations, child: QuotationListScreen()),
  (
    path: AppRoutes.salesReturns,
    child: ReturnsScreen(kind: InvoiceKind.sales),
  ),
  (
    path: AppRoutes.purchaseReturns,
    child: ReturnsScreen(kind: InvoiceKind.purchase),
  ),
  (path: AppRoutes.chartOfAccounts, child: ChartOfAccountsScreen()),
  (path: AppRoutes.costCenters, child: CostCentersScreen()),
  (path: AppRoutes.budgets, child: BudgetsScreen()),
  (path: AppRoutes.reports, child: ReportsScreen()),
  (path: AppRoutes.importData, child: ImportScreen()),
  (path: AppRoutes.backup, child: BackupScreen()),
  (path: AppRoutes.administration, child: AdminScreen()),
  (path: AppRoutes.companySettings, child: CompanySettingsScreen()),
  (path: AppRoutes.settings, child: SettingsScreen()),
  (path: AppRoutes.licence, child: LicenceScreen()),
];
