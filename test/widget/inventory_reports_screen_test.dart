import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/inventory_reports_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// Serves the catalogue the backend keeps in `catalogue()`, and one report per
/// slug in the `{slug, rows, totals?}` envelope every report returns.
class _ReportsApi extends ApiClient {
  _ReportsApi({this.failCatalogue = false, this.failReport = false})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  bool failCatalogue;
  bool failReport;
  final reportCalls = <String>[];

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/reports') {
      if (failCatalogue) throw StateError('CATALOGUE_FAILED');
      return {
        'reports': [
          {
            'slug': 'balance-by-warehouse',
            'titleEn': 'Balance by warehouse',
            'titleAr': 'الرصيد حسب المخزن',
            'filters': ['warehouseId', 'itemId', 'categoryId'],
          },
          {
            'slug': 'expiring',
            'titleEn': 'Expiring soon',
            'titleAr': 'قرب انتهاء الصلاحية',
            'filters': ['days', 'warehouseId'],
          },
        ],
      };
    }
    reportCalls.add(path);
    if (failReport) throw StateError('REPORT_FAILED');
    if (path.endsWith('/expiring')) {
      return {
        'slug': 'expiring',
        'rows': [
          {
            'batchNumber': 'LOT-A',
            'itemCode': 'I-1',
            'quantity': '40.0000',
            'expiryDate': '2026-12-01',
          },
        ],
        'totals': {'lots': 1},
      };
    }
    return {
      'slug': 'balance-by-warehouse',
      'rows': [
        {
          'warehouseCode': 'MAIN',
          'warehouseNameEn': 'Main store',
          'itemCode': 'I-1',
          'quantity': '125.5000',
        },
        {
          'warehouseCode': 'BR2',
          'warehouseNameEn': 'Second store',
          'itemCode': 'I-2',
          'quantity': '7.0000',
        },
      ],
      'totals': {'quantity': '132.5000'},
    };
  }
}

void main() {
  Future<void> pump(
    WidgetTester tester,
    _ReportsApi api, {
    Locale locale = const Locale('en'),
    List<String> permissions = const [
      'inventory.stock.read',
      'inventory.export',
    ],
  }) async {
    tester.view.physicalSize = const Size(1700, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(
            AppUser(
              id: 'u',
              username: 'u',
              fullName: 'User',
              companyId: 'c',
              permissions: permissions,
            ),
          ),
        ],
        child: MaterialApp(
          locale: locale,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: InventoryReportsScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('builds its list from the server catalogue, not a local table', (
    tester,
  ) async {
    await pump(tester, _ReportsApi());
    expect(find.text('Balance by warehouse'), findsWidgets);
    expect(find.text('Expiring soon'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('opens the first report without being asked to choose', (
    tester,
  ) async {
    final api = _ReportsApi();
    await pump(tester, api);
    expect(api.reportCalls, contains('/inventory/reports/balance-by-warehouse'));
    expect(find.text('MAIN'), findsOneWidget);
    expect(find.text('BR2'), findsOneWidget);
  });

  testWidgets('the columns are the keys the server sent', (tester) async {
    await pump(tester, _ReportsApi());
    expect(find.text('warehouseCode'), findsOneWidget);
    expect(find.text('itemCode'), findsOneWidget);
    expect(find.text('quantity'), findsOneWidget);
  });

  testWidgets('the totals the report returns are shown', (tester) async {
    await pump(tester, _ReportsApi());
    expect(find.textContaining('quantity: 132.5'), findsOneWidget);
    expect(find.text('2 rows'), findsOneWidget);
  });

  testWidgets('choosing another report asks for that one', (tester) async {
    final api = _ReportsApi();
    await pump(tester, api);
    await tester.tap(find.text('Expiring soon'));
    await tester.pumpAndSettle();
    expect(api.reportCalls, contains('/inventory/reports/expiring'));
    expect(find.text('LOT-A'), findsOneWidget);
    expect(find.text('MAIN'), findsNothing);
  });

  testWidgets('the export button appears only with the export grant', (
    tester,
  ) async {
    await pump(tester, _ReportsApi());
    expect(find.text('Export CSV'), findsOneWidget);
  });

  testWidgets('without the export grant the button is absent', (tester) async {
    await pump(
      tester,
      _ReportsApi(),
      permissions: const ['inventory.stock.read'],
    );
    expect(find.text('Balance by warehouse'), findsWidgets);
    expect(find.text('Export CSV'), findsNothing);
  });

  testWidgets('a failed catalogue offers a retry instead of a blank pane', (
    tester,
  ) async {
    await pump(tester, _ReportsApi(failCatalogue: true));
    expect(find.textContaining('CATALOGUE_FAILED'), findsNothing);
    expect(find.text('Retry'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed report offers a retry without losing the catalogue', (
    tester,
  ) async {
    await pump(tester, _ReportsApi(failReport: true));
    expect(find.text('Balance by warehouse'), findsWidgets);
    expect(find.text('Retry'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Arabic reads the Arabic titles and mirrors', (tester) async {
    await pump(tester, _ReportsApi(), locale: const Locale('ar'));
    expect(find.text('الرصيد حسب المخزن'), findsWidgets);
    expect(find.text('Balance by warehouse'), findsNothing);
    expect(
      Directionality.of(tester.element(find.text('تقارير المخزون'))),
      TextDirection.rtl,
    );
  });

  testWidgets('the header names the module and offers a way back', (
    tester,
  ) async {
    await pump(tester, _ReportsApi());
    expect(find.text('Inventory reports'), findsOneWidget);
    expect(find.text('INVENTORY'), findsOneWidget);
    expect(find.byIcon(Icons.arrow_back_rounded), findsOneWidget);
  });
}
