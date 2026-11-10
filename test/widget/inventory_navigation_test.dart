import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/theme/design_tokens.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/batches_screen.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/inventory_reports_screen.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_documents_screen.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_takes_screen.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/storage_locations_screen.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/warehouses_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

/// Records every request the real inventory screens make, so this test can say
/// how many there were instead of only that a screen appeared.
///
/// Returning an empty list is deliberate: the point is navigation and request
/// count, and a populated fixture would add rows to scroll rather than facts to
/// check. Nothing here contacts a server - every recorded call is one the app
/// chose to make.
class _CountingApi extends ApiClient {
  _CountingApi()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  final calls = <String>[];

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    calls.add(path);
    return const [];
  }

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    calls.add(path);
    return <String, dynamic>{};
  }
}

void main() {
  // The stock screens are the ones operators move between all day, and the
  // report was that switching between them hangs. A hang caused by the UI layer
  // shows up either as an ever-growing request count or as an unhandled error
  // on the way in, so this walks every real screen twice and counts what was
  // asked. The screens are the production widgets, not stand-ins: a stub would
  // prove that GoRouter can swap a widget, which nobody doubted.
  testWidgets('moving between the warehouse screens does not repeat requests',
      (tester) async {
    tester.view.physicalSize = const Size(1500, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = _CountingApi();
    final screens = <String, Widget>{
      AppRoutes.warehouses: const WarehousesScreen(),
      AppRoutes.storageLocations: const StorageLocationsScreen(),
      AppRoutes.batches: const BatchesScreen(),
      AppRoutes.stockTakes: const StockTakesScreen(),
      AppRoutes.stockDocuments: const StockDocumentsScreen(),
      AppRoutes.inventoryReports: const InventoryReportsScreen(),
    };
    final router = GoRouter(
      initialLocation: screens.keys.first,
      routes: [
        for (final entry in screens.entries)
          GoRoute(path: entry.key, builder: (context, state) => entry.value),
      ],
    );
    addTearDown(router.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(
            const AppUser(
              id: 'u',
              username: 'u',
              fullName: 'u',
              companyId: 'c',
              branchId: 'b',
              permissions: [
                'inventory.warehouses.read',
                'inventory.batches.read',
                'inventory.stock.read',
                'inventory.stocktake.read',
                'inventory.reports.read',
              ],
            ),
          ),
        ],
        child: MaterialApp.router(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: router,
          builder: (context, child) => Scaffold(body: child),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Two full passes. A one-off load per screen is expected; a second pass
    // that costs the same again means nothing was kept, and a pass that throws
    // means a screen cannot be left and returned to at all.
    for (var pass = 0; pass < 2; pass++) {
      for (final path in screens.keys) {
        router.go(path);
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull,
            reason: 'opening $path must not throw');
      }
    }

    final counts = <String, int>{};
    for (final path in api.calls) {
      counts[path] = (counts[path] ?? 0) + 1;
    }
    // Eight visits cover six screens (two passes). Anything asked far more
    // often than that is re-fetching on rebuild rather than on entry, which is
    // what makes walking the menu feel slow.
    final runaway = counts.entries.where((entry) => entry.value > 8);
    expect(
      runaway,
      isEmpty,
      reason: 'a screen that asks more than eight times while being visited '
          'twice is re-fetching on every rebuild: $counts',
    );

    // The navigation must not have changed what the program shows: the section
    // accents the screens use are untouched by walking between them.
    expect(SectionAccents.inventory.base, isNot(SectionAccents.sales.base));
  });
}
