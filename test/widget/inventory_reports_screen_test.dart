import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/inventory_reports_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// The twenty analytical reports the warehouse can answer.
///
/// The API publishes the catalogue and runs any slug in it; this screen proves
/// it is not a list somebody keeps by hand: it draws whatever the catalogue
/// says, runs the chosen report with the filters that report declares, and
/// shows the rows the server returned, under bilingual headings.
class _FakeApiClient extends ApiClient {
  _FakeApiClient()
    : super(
        const AppConfig(
          environment: AppEnvironment.development,
          apiBaseUrl: 'https://test.invalid/api/v1',
          connectTimeout: Duration(seconds: 1),
          receiveTimeout: Duration(seconds: 1),
        ),
        FakeTokenStore(),
      );

  final List<String> reads = [];
  Map<String, dynamic>? lastQuery;

  /// The catalogue the real API returns today: twenty reports.
  static const _slugs = [
    'item-card',
    'item-movement',
    'balance-by-warehouse',
    'balance-by-branch',
    'valuation-by-warehouse',
    'below-minimum',
    'above-maximum',
    'slow-moving',
    'dead-stock',
    'zero-stock',
    'lots',
    'expiring',
    'expired',
    'value-at-risk',
    'write-offs',
    'transfers',
    'count-variances',
    'cost-by-warehouse',
    'reconciliation',
    'audit-trail',
  ];

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    reads.add(path);
    if (path == '/inventory/warehouses') {
      return const [
        {
          'id': 'wh-1',
          'code': 'MAIN',
          'nameEn': 'Main store',
          'nameAr': 'المخزن الرئيسي',
        },
      ];
    }
    if (path == '/inventory/items') {
      return const [
        {'id': 'item-1', 'code': 'MILK', 'nameEn': 'Milk', 'nameAr': 'لبن'},
      ];
    }
    return const [];
  }

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    reads.add(path);
    lastQuery = query;
    if (path == '/inventory/reports') {
      return {
        'reports': [
          for (final slug in _slugs)
            {
              'slug': slug,
              'titleEn': slug,
              'titleAr': slug,
              'filters': const ['from', 'to', 'warehouseId'],
            },
        ],
      };
    }
    return const {
      'rows': [
        {
          'itemCode': 'MILK',
          'quantity': '12.0000',
          'unitCost': '11.0000',
          'value': '132.0000',
        },
      ],
      'totals': {'value': '132.0000'},
    };
  }
}

/// The catalogue is a long list; a 600-pixel test window would put the last
/// report under the fold, where a tap cannot reach it.
Future<void> _pump(WidgetTester tester, _FakeApiClient api) async {
  tester.view.physicalSize = const Size(1400, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWithValue(testUser),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(body: InventoryReportsScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}


/// Taps a catalogue entry, scrolling it into view first: the list is taller
/// than any window and the last report must still be reachable by hand.
Future<void> _openReport(WidgetTester tester, String slug) async {
  final chip = find.byKey(ValueKey('inventory-report-$slug'));
  await tester.ensureVisible(chip);
  await tester.pumpAndSettle();
  await tester.tap(chip);
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the twenty reports come from the API catalogue, not from a list '
      'in the app', (tester) async {
    final api = _FakeApiClient();
    await _pump(tester, api);

    expect(find.text('Reports available: 20'), findsOneWidget);
    expect(
      find.byKey(const ValueKey('inventory-report-valuation-by-warehouse')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('inventory-report-audit-trail')),
        findsOneWidget);
  });

  testWidgets('running a report sends its filters and shows its rows', (
    tester,
  ) async {
    final api = _FakeApiClient();
    await _pump(tester, api);

    await _openReport(tester, 'item-card');

    // The filters the catalogue declared are the filters offered.
    expect(find.byKey(const ValueKey('inventory-report-from')), findsOneWidget);
    expect(
      find.byKey(const ValueKey('inventory-report-warehouse')),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const ValueKey('inventory-report-run')));
    await tester.pumpAndSettle();

    expect(api.reads, contains('/inventory/reports/item-card'));
    expect(api.lastQuery?['from'], isNotNull);
    // Bilingual headings over the server's own rows.
    expect(find.text('MILK'), findsOneWidget);
    expect(find.text('Quantity'), findsOneWidget);
    expect(find.text('12.0000'), findsOneWidget);
  });

  testWidgets('a report with a printed sheet offers paper and PDF; one without '
      'does not pretend to', (tester) async {
    final api = _FakeApiClient();
    await _pump(tester, api);

    await _openReport(tester, 'slow-moving');
    expect(find.byKey(const ValueKey('inventory-report-print')), findsOneWidget);
    expect(find.byKey(const ValueKey('inventory-report-pdf')), findsOneWidget);

    await tester.ensureVisible(find.text('All reports'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('All reports'));
    await tester.pumpAndSettle();
    await _openReport(tester, 'audit-trail');
    expect(find.byKey(const ValueKey('inventory-report-print')), findsNothing);
    // CSV is offered for every report, because one export route serves them.
    expect(find.byKey(const ValueKey('inventory-report-csv')), findsOneWidget);
  });
}
