import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/items_screen.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/warehouses_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

/// Walking the warehouse menu used to freeze the app: a warehouse screen could
/// be opened, but choosing another entry did nothing. Nine inventory routes were
/// listed in `_guardedShellPaths` while their screens were built without the
/// `navigationKey` they need to register an exit guard, and
/// `DraftExitGuard.canLeave` answers **false** for a key nobody registered.
///
/// These tests drive the real `WarehousesScreen` and the real `ItemsScreen`
/// through a real go_router and assert behaviour a user can see: leaving an
/// ordinary screen arrives, and leaving a screen with unsaved edits stops and
/// asks before anything is lost.
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

  Widget app({required GoRouter router, required DraftExitGuard guard}) {
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
    tester.view.physicalSize = const Size(1600, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }

  testWidgets(
      'an ordinary warehouse screen can be left and returned to repeatedly',
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
            // Built exactly as app_router built it during the defect: with no
            // navigationKey, so nothing registers on the screen's behalf.
            child: const WarehousesScreen(),
          ),
        ),
        GoRoute(
          path: '/inventory/stock-takes',
          onExit: (_, state) => guard.canLeave(state.pageKey),
          builder: (_, state) => ErpShell(
            currentPath: '/inventory/stock-takes',
            guardKey: state.pageKey,
            child: const Scaffold(body: Text('Stock takes destination')),
          ),
        ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(app(router: router, guard: guard));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    for (var round = 0; round < 5; round++) {
      router.go('/inventory/stock-takes');
      await tester.pumpAndSettle();
      expect(
        find.text('Stock takes destination'),
        findsOneWidget,
        reason: 'round $round could not leave the warehouses screen, which is '
            'the freeze the operator reported',
      );

      router.go('/inventory/warehouses');
      await tester.pumpAndSettle();
      expect(
        find.text('Warehouses'),
        findsWidgets,
        reason: 'round $round could not return to the warehouses screen',
      );
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets(
      'a screen with unsaved edits blocks the exit and asks what to discard',
      (tester) async {
    sizeView(tester);

    final guard = DraftExitGuard();
    final router = GoRouter(
      initialLocation: '/inventory/items',
      routes: [
        GoRoute(
          path: '/inventory/items',
          onExit: (_, state) => guard.canLeave(state.pageKey),
          builder: (_, state) => ErpShell(
            currentPath: '/inventory/items',
            guardKey: state.pageKey,
            child: ItemsScreen(navigationKey: state.pageKey),
          ),
        ),
        GoRoute(
          path: '/inventory/warehouses',
          onExit: (_, state) => guard.canLeave(state.pageKey),
          builder: (_, state) => ErpShell(
            currentPath: '/inventory/warehouses',
            guardKey: state.pageKey,
            child: const Scaffold(body: Text('Warehouses destination')),
          ),
        ),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(app(router: router, guard: guard));
    await tester.pumpAndSettle();

    // Open the new-item form and type into it. This is the real editor, the
    // real relay and the real confirmation dialog.
    await tester.tap(find.text('New item').first);
    await tester.pumpAndSettle();
    await tester.enterText(
        find.widgetWithText(TextFormField, 'Code'), 'SYN-1');
    await tester.pumpAndSettle();

    router.go('/inventory/warehouses');
    await tester.pumpAndSettle();

    expect(
      find.text('Unsaved changes'),
      findsOneWidget,
      reason: 'the operator must be asked before edits are thrown away',
    );
    expect(
      find.text('Warehouses destination'),
      findsNothing,
      reason: 'the exit must be refused while the confirmation is open',
    );

    // Cancel: the edits survive and the operator stays where they were.
    await tester.tap(find.text('Cancel').last);
    await tester.pumpAndSettle();
    expect(find.text('Warehouses destination'), findsNothing);
    expect(
      tester
          .widget<TextFormField>(find.widgetWithText(TextFormField, 'Code'))
          .controller!
          .text,
      'SYN-1',
      reason: 'choosing to stay must not lose what was typed',
    );

    // Discard: only an explicit confirmation may drop the work.
    router.go('/inventory/warehouses');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Discard changes'));
    await tester.pumpAndSettle();
    expect(find.text('Warehouses destination'), findsOneWidget);
    expect(find.widgetWithText(TextFormField, 'Code'), findsNothing);
    expect(tester.takeException(), isNull);
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
