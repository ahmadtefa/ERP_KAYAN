import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_screen.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_vouchers_screen.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/item_locations_screen.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart'
    show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );
  final reads = <String>[];
  int stockLoads = 0;
  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/stock') {
      stockLoads++;
      return [
        {
          'itemId': 'item-selected',
          'itemCode': 'SYN',
          'itemNameEn': 'Selected item',
          'quantity': '2',
          'unit': 'piece',
        },
      ];
    }
    return [];
  }

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    reads.add(path);
    if (path.contains('stock-documents')) return {'items': [], 'total': 0};
    if (path.contains('/locations/item/')) return {'warehouses': []};
    return {'movements': [], 'items': [], 'totals': []};
  }
}

void main() {
  Future<void> pump(WidgetTester tester, _Api api) async {
    tester.view.physicalSize = const Size(1800, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
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
              isSuperAdmin: true,
            ),
          ),
          exportCapabilitiesProvider.overrideWith(
            (ref) async => ExportCapabilities.unknown,
          ),
        ],
        child: MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: StockScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'stock vouchers destination returns and reloads original balance',
    (tester) async {
      final api = _Api();
      await pump(tester, api);
      expect(api.stockLoads, 1);
      await tester.tap(find.text('Stock vouchers'));
      await tester.pumpAndSettle();
      expect(find.byType(StockVouchersScreen), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(api.stockLoads, 2);
      expect(find.text('SYN'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('stock cost center route refresh rereads the same source', (
    tester,
  ) async {
    final api = _Api();
    await pump(tester, api);
    await tester.tap(find.text('Stock by cost center'));
    await tester.pumpAndSettle();
    expect(find.byType(StockCostCenterReportScreen), findsOneWidget);
    expect(
      api.reads
          .where((p) => p == '/inventory/reports/cost-center-movements')
          .length,
      1,
    );
    await tester.tap(find.byTooltip('Refresh').last);
    await tester.pumpAndSettle();
    expect(
      api.reads
          .where((p) => p == '/inventory/reports/cost-center-movements')
          .length,
      2,
    );
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('SYN'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('stock location destination uses selected balance item', (
    tester,
  ) async {
    final api = _Api();
    await pump(tester, api);
    await tester.tap(find.byTooltip('Item locations and quantities'));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<ItemLocationsScreen>(find.byType(ItemLocationsScreen))
          .itemId,
      'item-selected',
    );
    expect(api.reads, contains('/inventory/locations/item/item-selected'));
    expect(tester.takeException(), isNull);
  });
  testWidgets('stock ledger Close dismisses without changing balances', (
    tester,
  ) async {
    final api = _Api();
    await pump(tester, api);
    await tester.tap(find.text('SYN'));
    await tester.pumpAndSettle();
    expect(api.reads, contains('/inventory/stock/item-selected/ledger'));
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    expect(find.text('Close'), findsNothing);
    expect(find.text('SYN'), findsOneWidget);
    expect(api.stockLoads, 1);
    expect(tester.takeException(), isNull);
  });
}
