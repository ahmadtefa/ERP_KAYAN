import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/batches_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// Rows shaped exactly like `BatchesService.list`, which spreads the Prisma
/// row and adds the derived money and expiry fields as fixed-scale strings.
class _BatchesApi extends ApiClient {
  _BatchesApi({this.failList = false})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  bool failList;
  int calls = 0;

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    calls++;
    if (failList) throw StateError('BATCH_LIST_FAILED');
    return [
      {
        'id': 'lot-1',
        'batchNumber': 'LOT-A',
        'expiryDate': '2026-12-01T00:00:00.000Z',
        'receivedQuantity': '100.0000',
        'remainingQuantity': '40.0000',
        'unitCost': '12.5000',
        'value': '500.0000',
        'daysToExpiry': 24,
        'status': 'OPEN',
        'item': {
          'code': 'I-1',
          'nameEn': 'Cable',
          'nameAr': 'كابل',
          'unit': 'm',
        },
        'warehouse': {
          'code': 'MAIN',
          'nameEn': 'Main store',
          'nameAr': 'المخزن الرئيسي',
        },
      },
      {
        'id': 'lot-2',
        'batchNumber': 'LOT-B',
        'expiryDate': '2026-10-01T00:00:00.000Z',
        'receivedQuantity': '50.0000',
        'remainingQuantity': '5.0000',
        'unitCost': '3.0000',
        'value': '15.0000',
        'daysToExpiry': -37,
        'status': 'EXPIRED',
        'item': {
          'code': 'I-2',
          'nameEn': 'Glue',
          'nameAr': 'صمغ',
          'unit': 'kg',
        },
        'warehouse': {
          'code': 'MAIN',
          'nameEn': 'Main store',
          'nameAr': 'المخزن الرئيسي',
        },
      },
      {
        'id': 'lot-3',
        'batchNumber': 'LOT-C',
        'expiryDate': null,
        'receivedQuantity': '10.0000',
        'remainingQuantity': '10.0000',
        'unitCost': '1.0000',
        'value': '10.0000',
        'daysToExpiry': null,
        'status': 'OPEN',
        'item': {
          'code': 'I-3',
          'nameEn': 'Screws',
          'nameAr': 'مسامير',
          'unit': 'box',
        },
        'warehouse': {
          'code': 'BR2',
          'nameEn': 'Second store',
          'nameAr': 'المخزن الثاني',
        },
      },
    ];
  }
}

void main() {
  Future<void> pump(
    WidgetTester tester,
    _BatchesApi api, {
    Locale locale = const Locale('en'),
  }) async {
    tester.view.physicalSize = const Size(1700, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [apiClientProvider.overrideWithValue(api)],
        child: MaterialApp(
          locale: locale,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: BatchesScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('lists lots with remaining quantity, cost and value', (
    tester,
  ) async {
    await pump(tester, _BatchesApi());
    expect(find.text('LOT-A'), findsOneWidget);
    expect(find.text('LOT-B'), findsOneWidget);
    expect(find.text('LOT-C'), findsOneWidget);
    // The item and warehouse names come from the nested objects, not from the
    // lot row itself.
    expect(find.text('Cable'), findsOneWidget);
    expect(find.text('Main store'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('English reads nameEn, Arabic reads nameAr and mirrors', (
    tester,
  ) async {
    await pump(tester, _BatchesApi());
    expect(find.text('Cable'), findsOneWidget);
    expect(find.text('كابل'), findsNothing);

    await pump(tester, _BatchesApi(), locale: const Locale('ar'));
    expect(find.text('كابل'), findsOneWidget);
    expect(find.text('Cable'), findsNothing);
    expect(
      Directionality.of(tester.element(find.text('كابل'))),
      TextDirection.rtl,
    );
  });

  testWidgets('the expiring filter keeps only lots inside 30 days', (
    tester,
  ) async {
    await pump(tester, _BatchesApi());
    await tester.tap(find.text('Expiring'));
    await tester.pumpAndSettle();
    expect(find.text('LOT-A'), findsOneWidget);
    expect(find.text('LOT-B'), findsNothing);
    // A lot with no expiry date is not expiring and not expired.
    expect(find.text('LOT-C'), findsNothing);
  });

  testWidgets('the expired filter keeps only lots past their date', (
    tester,
  ) async {
    await pump(tester, _BatchesApi());
    await tester.tap(find.text('Expired'));
    await tester.pumpAndSettle();
    expect(find.text('LOT-B'), findsOneWidget);
    expect(find.text('LOT-A'), findsNothing);
    expect(find.text('LOT-C'), findsNothing);
  });

  testWidgets('choosing All again brings every lot back', (tester) async {
    await pump(tester, _BatchesApi());
    await tester.tap(find.text('Expired'));
    await tester.pumpAndSettle();
    expect(find.text('LOT-A'), findsNothing);
    await tester.tap(find.text('All'));
    await tester.pumpAndSettle();
    expect(find.text('LOT-A'), findsOneWidget);
    expect(find.text('LOT-B'), findsOneWidget);
    expect(find.text('LOT-C'), findsOneWidget);
  });

  testWidgets('search narrows by batch number and by item name', (
    tester,
  ) async {
    await pump(tester, _BatchesApi());
    await tester.enterText(find.byType(TextField).first, 'LOT-B');
    await tester.pumpAndSettle();
    expect(find.text('LOT-B'), findsOneWidget);
    expect(find.text('LOT-A'), findsNothing);

    await tester.enterText(find.byType(TextField).first, 'Screws');
    await tester.pumpAndSettle();
    expect(find.text('LOT-C'), findsOneWidget);
    expect(find.text('LOT-B'), findsNothing);
  });

  testWidgets('a lot with no expiry date shows a dash, not a crash', (
    tester,
  ) async {
    await pump(tester, _BatchesApi());
    expect(find.text('LOT-C'), findsOneWidget);
    expect(find.text('—'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed list shows the error view and offers a retry', (
    tester,
  ) async {
    final api = _BatchesApi(failList: true);
    await pump(tester, api);
    expect(find.textContaining('BATCH_LIST_FAILED'), findsNothing);
    expect(find.text('Retry'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('filtering to nothing shows the empty message', (tester) async {
    await pump(tester, _BatchesApi());
    await tester.enterText(
      find.byType(TextField).first,
      'no batch matches this',
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('No batches'), findsOneWidget);
  });

  testWidgets('the request asks the server for non-empty lots only', (
    tester,
  ) async {
    final api = _BatchesApi();
    await pump(tester, api);
    expect(api.calls, greaterThanOrEqualTo(1));
    expect(tester.takeException(), isNull);
  });

  testWidgets('the header names the module and offers a way back', (
    tester,
  ) async {
    await pump(tester, _BatchesApi());
    expect(find.text('Batches'), findsOneWidget);
    expect(find.text('Inventory'), findsOneWidget);
    expect(find.byIcon(Icons.arrow_back_rounded), findsOneWidget);
  });
}
