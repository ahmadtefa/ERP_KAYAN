import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/accounting/presentation/screens/chart_of_accounts_screen.dart';
import '../../features/auth/presentation/providers/auth_providers.dart';
import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/dashboard/presentation/screens/dashboard_screen.dart';
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
      GoRoute(
        path: AppRoutes.dashboard,
        builder: (context, state) => const ErpShell(
          currentPath: AppRoutes.dashboard,
          child: DashboardScreen(),
        ),
      ),
      GoRoute(
        path: AppRoutes.chartOfAccounts,
        builder: (context, state) => const ErpShell(
          currentPath: AppRoutes.chartOfAccounts,
          child: ChartOfAccountsScreen(),
        ),
      ),
      GoRoute(
        path: AppRoutes.settings,
        builder: (context, state) => const ErpShell(
          currentPath: AppRoutes.settings,
          child: SettingsScreen(),
        ),
      ),
    ],
  );
});
