import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/accounting/presentation/screens/chart_of_accounts_screen.dart';
import '../../features/accounting/presentation/screens/fiscal_periods_screen.dart';
import '../../features/admin/presentation/screens/admin_screen.dart';
import '../../features/accounting/presentation/screens/journal_entries_screen.dart';
import '../../features/auth/presentation/providers/auth_providers.dart';
import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/dashboard/presentation/screens/dashboard_screen.dart';
import '../../features/inventory/presentation/screens/items_screen.dart';
import '../../features/inventory/presentation/screens/stock_screen.dart';
import '../../features/invoicing/presentation/providers/invoice_providers.dart';
import '../../features/invoicing/presentation/screens/invoice_list_screen.dart';
import '../../features/parties/presentation/screens/parties_screen.dart';
import '../../features/reports/presentation/reports_screen.dart';
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
  static const journalEntries = '/accounting/journal-entries';
  static const fiscalPeriods = '/accounting/fiscal-periods';
  static const customers = '/parties/customers';
  static const suppliers = '/parties/suppliers';
  static const items = '/inventory/items';
  static const stock = '/inventory/stock';
  static const salesInvoices = '/sales/invoices';
  static const purchaseInvoices = '/purchases/invoices';
  static const reports = '/reports';
  static const administration = '/administration';
  static const settings = '/settings';
}

final routerProvider = Provider<GoRouter>((ref) {
  final notifier = ref.watch(_routerNotifierProvider);

  return GoRouter(
    initialLocation: AppRoutes.dashboard,
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
      for (final route in _shellRoutes)
        GoRoute(
          path: route.path,
          builder: (context, state) =>
              ErpShell(currentPath: route.path, child: route.child),
        ),
    ],
  );
});

/// Every authenticated screen, in the order the navigation shows them.
const _shellRoutes = <({String path, Widget child})>[
  (path: AppRoutes.dashboard, child: DashboardScreen()),
  (path: AppRoutes.journalEntries, child: JournalEntriesScreen()),
  (path: AppRoutes.fiscalPeriods, child: FiscalPeriodsScreen()),
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
  (
    path: AppRoutes.salesInvoices,
    child: InvoiceListScreen(kind: InvoiceKind.sales),
  ),
  (
    path: AppRoutes.purchaseInvoices,
    child: InvoiceListScreen(kind: InvoiceKind.purchase),
  ),
  (path: AppRoutes.chartOfAccounts, child: ChartOfAccountsScreen()),
  (path: AppRoutes.reports, child: ReportsScreen()),
  (path: AppRoutes.administration, child: AdminScreen()),
  (path: AppRoutes.settings, child: SettingsScreen()),
];
