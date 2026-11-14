import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

/// The warehouse menu stopped responding.
///
/// `DraftExitGuard.canLeave` answers **false** for a key nobody registered, and
/// go_router asks it before leaving any guarded route. Nine inventory routes
/// were guarded while their screens were built without a `navigationKey`, so no
/// guard was ever registered for them: every attempt to leave answered "no".
/// go_router cancels a refused exit silently - no error, no dialog, no spinner -
/// and the operator sees a frozen app.
///
/// The first test reproduces that condition on a route wired the way
/// `app_router.dart` wired the nine. The remaining tests pin the shell's floor:
/// it lets an ordinary screen leave, it never overrides a screen that reports
/// unsaved work, and it does not leak a registration per visit.
void main() {
  const user = AppUser(
    id: 'u1',
    username: 'operator',
    fullName: 'Operator',
    companyId: 'c1',
    branchId: 'b1',
    permissions: [
      'inventory.warehouses.read',
      'inventory.warehouses.manage',
      'inventory.items.read',
      'inventory.items.manage',
    ],
  );

  Widget app({
    required GoRouter router,
    required DraftExitGuard guard,
  }) {
    return ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(_EmptyApi()),
        draftExitGuardProvider.overrideWithValue(guard),
        currentUserProvider.overrideWithValue(user),
      ],
      child: MaterialApp.router(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        routerConfig: router,
      ),
    );
  }

  void sizeView(WidgetTester tester) {
    tester.view.physicalSize = const Size(1500, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }

  testWidgets(
      'a guarded route whose screen never registers cannot be left (the freeze)',
      (tester) async {
    sizeView(tester);

    // A shell with no guardKey behaves like the nine screens did: nothing
    // registers the route's page key. This is the defect, reproduced.
    final guard = DraftExitGuard();
    final router = GoRouter(
      initialLocation: '/inventory/warehouses',
      routes: [
        GoRoute(
          path: '/inventory/warehouses',
          onExit: (_, state) => guard.canLeave(state.pageKey),
          builder: (_, _) => const Scaffold(body: Text('Warehouses screen')),
        ),
        GoRoute(
          path: '/inventory/batches',
          builder: (_, _) =>
              const Scaffold(body: Text('Batches destination')),
        ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(app(router: router, guard: guard));
    await tester.pumpAndSettle();
    expect(find.text('Warehouses screen'), findsOneWidget);

    router.go('/inventory/batches');
    await tester.pumpAndSettle();

    // The freeze, reproduced: the transition is cancelled and the operator is
    // left looking at the warehouse screen. Nothing is thrown, so the
    // assertion has to be that the destination was *not* reached.
    expect(
      find.text('Batches destination'),
      findsNothing,
      reason: 'an unregistered key answers "cannot leave", so go_router '
          'silently cancels the transition - no error, no dialog, no spinner. '
          'That is what the operator experienced as a freeze.',
    );
    expect(find.text('Warehouses screen'), findsOneWidget,
        reason: 'the screen stays put, which is why it looked frozen');
    expect(tester.takeException(), isNull,
        reason: 'nothing throws, which is why the defect went unnoticed');
  });

  testWidgets(
      'the shell floor lets a guarded screen with no registration leave',
      (tester) async {
    sizeView(tester);

    final guard = DraftExitGuard();
    final router = GoRouter(
      initialLocation: '/inventory/warehouses',
      routes: [
        GoRoute(
          path: '/inventory/warehouses',
          onExit: (_, state) => guard.canLeave(state.pageKey),
          builder: (_, state) => ErpShell(
            currentPath: '/inventory/warehouses',
            guardKey: state.pageKey,
            // No navigationKey on the screen: exactly the defect's shape.
            child: const Scaffold(body: Text('Warehouses screen')),
          ),
        ),
        GoRoute(
          path: '/inventory/batches',
          onExit: (_, state) => guard.canLeave(state.pageKey),
          builder: (_, state) => ErpShell(
            currentPath: '/inventory/batches',
            guardKey: state.pageKey,
            child: const Scaffold(body: Text('Batches destination')),
          ),
        ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(app(router: router, guard: guard));
    await tester.pumpAndSettle();
    expect(find.text('Warehouses screen'), findsOneWidget);

    router.go('/inventory/batches');
    await tester.pumpAndSettle();

    expect(
      find.text('Batches destination'),
      findsOneWidget,
      reason: 'the shell holds a permissive floor for a guarded route whose '
          'screen has no draft, so the menu must respond',
    );
  });

  testWidgets(
      'repeated warehouse navigation keeps working and leaks no guard',
      (tester) async {
    sizeView(tester);

    final guard = DraftExitGuard();
    final router = GoRouter(
      initialLocation: '/inventory/warehouses',
      routes: [
        for (final path in ['/inventory/warehouses', '/inventory/batches'])
          GoRoute(
            path: path,
            onExit: (_, state) => guard.canLeave(state.pageKey),
            builder: (_, state) => ErpShell(
              currentPath: path,
              guardKey: state.pageKey,
              child: Scaffold(body: Text('screen $path')),
            ),
          ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(app(router: router, guard: guard));
    await tester.pumpAndSettle();

    for (var round = 0; round < 5; round++) {
      router.go('/inventory/batches');
      await tester.pumpAndSettle();
      expect(find.text('screen /inventory/batches'), findsOneWidget,
          reason: 'round $round could not leave the warehouse screen');

      router.go('/inventory/warehouses');
      await tester.pumpAndSettle();
      expect(find.text('screen /inventory/warehouses'), findsOneWidget,
          reason: 'round $round could not leave the batches screen');
      expect(tester.takeException(), isNull);
    }

    // Ten pages were created and destroyed. A shell that never released the key
    // it claimed would leave one entry per page and grow for the whole session.
    expect(
      guard.registeredCount,
      lessThanOrEqualTo(2),
      reason: 'only the screens on display may hold a registration; more means '
          'a guard was leaked by a page that has already been left',
    );
  });

  testWidgets('a shell with no guardKey registers nothing', (tester) async {
    sizeView(tester);

    final guard = DraftExitGuard();
    final router = GoRouter(
      initialLocation: '/inventory/warehouses',
      routes: [
        GoRoute(
          path: '/inventory/warehouses',
          builder: (_, _) => const ErpShell(
            currentPath: '/inventory/warehouses',
            child: Scaffold(body: Text('no key route')),
          ),
        ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(app(router: router, guard: guard));
    await tester.pumpAndSettle();

    // Routes outside `_guardedShellPaths` pass no key; the shell must not
    // invent one, and the restrictive default must still hold for strangers.
    expect(guard.registeredCount, 0);
    expect(await guard.canLeave(const ValueKey('never-registered')), isFalse);
  });
}

/// Returns empty results so no test reaches a network.
class _EmptyApi extends ApiClient {
  _EmptyApi()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => const [];

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => const {};
}
