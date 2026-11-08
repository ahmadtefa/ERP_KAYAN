import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_documents_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// One row per kind, in the shape `StockDocumentsService.findAll` returns:
/// lowercase kind and status, warehouse objects rather than ids.
class _DocumentsApi extends ApiClient {
  _DocumentsApi({this.failList = false})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  bool failList;
  final queries = <Map<String, dynamic>?>[];

  Map<String, dynamic> _row({
    required String id,
    required String number,
    required String kind,
    required String status,
    String? from,
    String? to,
    String quantity = '10.0000',
  }) {
    return {
      'id': id,
      'documentNumber': number,
      'kind': kind,
      'documentDate': '2026-11-05',
      'status': status,
      'reason': null,
      'notes': null,
      'voucherKind': null,
      'editVersion': 0,
      'counterpartyName': null,
      'reviewedAt': null,
      'reviewedBy': null,
      'fromWarehouseId': from == null ? null : 'wh-$from',
      'toWarehouseId': to == null ? null : 'wh-$to',
      'fromWarehouse': from == null
          ? null
          : {'id': 'wh-$from', 'code': from, 'nameEn': '$from store', 'nameAr': 'مخزن $from'},
      'toWarehouse': to == null
          ? null
          : {'id': 'wh-$to', 'code': to, 'nameEn': '$to store', 'nameAr': 'مخزن $to'},
      'createdById': 'someone',
      'createdByName': 'sara',
      'postedById': null,
      'postedByName': null,
      'branch': {'code': 'HQ', 'nameEn': 'Head office', 'nameAr': 'المركز الرئيسي'},
      'costCenterId': null,
      'costCenter': null,
      'journalEntryId': null,
      'postedAt': null,
      'approvedAt': null,
      'approvedById': null,
      'approvedByName': null,
      'createdAt': '2026-11-05T09:00:00.000Z',
      'lineCount': 2,
      'totalQuantity': quantity,
    };
  }

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    queries.add(query);
    if (failList) throw StateError('DOCUMENT_LIST_FAILED');
    return [
      _row(id: 'd-1', number: 'ADJ-001', kind: 'adjustment', status: 'posted'),
      _row(
        id: 'd-2',
        number: 'TRF-001',
        kind: 'transfer',
        status: 'draft',
        from: 'MAIN',
        to: 'BR2',
      ),
      _row(id: 'd-3', number: 'OPN-001', kind: 'opening', status: 'posted'),
      _row(id: 'd-4', number: 'WO-001', kind: 'write_off', status: 'draft'),
    ];
  }
}

Finder tableText(String value) => find.byWidgetPredicate(
  (widget) => widget is Text && widget.data == value,
);

void main() {
  Future<void> pump(
    WidgetTester tester,
    _DocumentsApi api, {
    Locale locale = const Locale('en'),
  }) async {
    tester.view.physicalSize = const Size(1800, 1000);
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
          home: const Scaffold(body: StockDocumentsScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('asks for non-voucher documents, so it cannot overlap vouchers', (
    tester,
  ) async {
    final api = _DocumentsApi();
    await pump(tester, api);
    expect(api.queries, isNotEmpty);
    // `false`, not missing: the vouchers screen asks for the complement, and
    // leaving the key out would let the two lists overlap.
    expect(api.queries.first?['voucherOnly'], 'false');
  });

  testWidgets('lists every non-voucher kind by name, not by enum', (
    tester,
  ) async {
    await pump(tester, _DocumentsApi());
    expect(find.text('ADJ-001'), findsOneWidget);
    expect(find.text('TRF-001'), findsOneWidget);
    expect(find.text('OPN-001'), findsOneWidget);
    expect(find.text('WO-001'), findsOneWidget);
    expect(find.text('Adjustment'), findsWidgets);
    expect(find.text('Transfer'), findsWidgets);
    expect(find.text('ADJUSTMENT'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a transfer shows where goods left and where they arrived', (
    tester,
  ) async {
    await pump(tester, _DocumentsApi());
    expect(find.text('MAIN store → BR2 store'), findsOneWidget);
  });

  testWidgets('a document with no destination shows only where it left', (
    tester,
  ) async {
    await pump(tester, _DocumentsApi());
    expect(find.text('MAIN store'), findsNothing);
    // The adjustment has neither side named, so the cell is a dash.
    expect(find.text('—'), findsWidgets);
  });

  testWidgets('statuses read as words', (tester) async {
    await pump(tester, _DocumentsApi());
    expect(find.text('Posted'), findsNWidgets(2));
    expect(find.text('Draft'), findsNWidgets(2));
  });

  testWidgets('the kind filter keeps only the chosen kind', (tester) async {
    await pump(tester, _DocumentsApi());
    await tester.tap(find.byType(DropdownButton<String?>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Transfer').last);
    await tester.pumpAndSettle();
    expect(find.text('TRF-001'), findsOneWidget);
    expect(find.text('ADJ-001'), findsNothing);
    expect(find.text('WO-001'), findsNothing);
  });

  testWidgets('clearing the kind filter brings everything back', (tester) async {
    await pump(tester, _DocumentsApi());
    await tester.tap(find.byType(DropdownButton<String?>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Transfer').last);
    await tester.pumpAndSettle();
    expect(find.text('ADJ-001'), findsNothing);

    await tester.tap(find.byType(DropdownButton<String?>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('All kinds').last);
    await tester.pumpAndSettle();
    expect(find.text('ADJ-001'), findsOneWidget);
  });

  testWidgets('search narrows by number and by raiser', (tester) async {
    await pump(tester, _DocumentsApi());
    await tester.enterText(find.byType(TextField).first, 'OPN-001');
    await tester.pumpAndSettle();
    expect(tableText('OPN-001'), findsOneWidget);
    expect(tableText('ADJ-001'), findsNothing);

    await tester.enterText(find.byType(TextField).first, 'sara');
    await tester.pumpAndSettle();
    expect(tableText('ADJ-001'), findsOneWidget);
  });

  testWidgets('a failed list shows the error view with a retry', (tester) async {
    await pump(tester, _DocumentsApi(failList: true));
    expect(find.textContaining('DOCUMENT_LIST_FAILED'), findsNothing);
    expect(find.text('Retry'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Arabic names the kinds and mirrors', (tester) async {
    await pump(tester, _DocumentsApi(), locale: const Locale('ar'));
    expect(find.text('مستندات المخزون'), findsOneWidget);
    expect(find.text('تسوية'), findsWidgets);
    expect(
      Directionality.of(tester.element(find.text('تسوية').first)),
      TextDirection.rtl,
    );
  });
}
