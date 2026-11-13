import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
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
  bool noWarehouses = false;
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

  /// Every POST body the screen sent, so a test can prove what was created
  /// rather than only that a button existed.
  final posts = <Map<String, dynamic>>[];

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    // Answered before `queries` is recorded on purpose: `queries` is the list
    // of stock-document reads, and the existing test asserts queries.first is
    // the documents query. A warehouse lookup is not a document read.
    if (path == '/inventory/warehouses') {
      if (noWarehouses) return const [];
      return [
        {
          'id': 'wh-main',
          'code': 'MAIN',
          'nameEn': 'Main store',
          'nameAr': 'المخزن الرئيسي',
          'isDefault': true,
        },
        {
          'id': 'wh-b2',
          'code': 'BR2',
          'nameEn': 'Second store',
          'nameAr': 'المخزن الثاني',
          'isDefault': false,
        },
      ];
    }
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

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path != '/inventory/items/by-barcode/CARTON') return {};
    return {
      'matched': 'unit',
      'unit': 'carton',
      'factor': '24',
      'item': {
        'id': 'item-1',
        'code': 'I-1',
        'nameAr': 'صنف عربي',
        'unit': 'piece',
        'units': [{'unit': 'carton', 'factor': '24'}],
      },
    };
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    posts.add({
      'path': path,
      if (body is Map) ...Map<String, dynamic>.from(body),
    });
    return {'id': 'new-document'};
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
    AppUser? user,
  }) async {
    tester.view.physicalSize = const Size(1800, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          if (user != null) currentUserProvider.overrideWithValue(user),
        ],
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
  // The document flow the reference build has and this branch had lost:
  // counting, transferring and adjusting stock from the program itself.
  // One screen per test. Pumping three times into the same tester kept the
  // first ProviderScope's overrides alive, so the second and third user never
  // took effect and the last expectation could not see the button.
  testWidgets('hides new-document from a signed-out account', (tester) async {
    await pump(tester, _DocumentsApi());
    expect(find.text('New document'), findsNothing);
  });

  testWidgets('hides new-document from a read-only account', (tester) async {
    await pump(
      tester,
      _DocumentsApi(),
      user: const AppUser(
        id: 'u1',
        username: 'u1',
        fullName: 'Store clerk',
        companyId: 'c1',
        permissions: ['inventory.stock.read'],
      ),
    );
    expect(find.text('New document'), findsNothing);
  });

  testWidgets('offers new-document to an account that may adjust stock', (
    tester,
  ) async {
    await pump(
      tester,
      _DocumentsApi(),
      user: const AppUser(
        id: 'u2',
        username: 'u2',
        fullName: 'Store manager',
        companyId: 'c1',
        permissions: ['inventory.stock.read', 'inventory.stock.adjust'],
      ),
    );
    expect(find.text('New document'), findsOneWidget);
  });

  testWidgets('creates a stock document with the kind and warehouse chosen', (
    tester,
  ) async {
    final api = _DocumentsApi();
    await pump(
      tester,
      api,
      user: const AppUser(
        id: 'u2',
        username: 'u2',
        fullName: 'Store manager',
        companyId: 'c1',
        permissions: ['inventory.stock.adjust'],
      ),
    );

    await tester.tap(find.text('New document'));
    await tester.pumpAndSettle();

    expect(find.text('New stock document'), findsOneWidget);
    // Nothing is posted until a line exists, so the dialog must say so rather
    // than sending an empty document the server would reject.
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();
    expect(find.text('Add at least one line.'), findsOneWidget);
    expect(api.posts, isEmpty);
  });

  testWidgets('refresh issues a fresh list request', (tester) async {
    final api = _DocumentsApi();
    await pump(tester, api);
    final before = api.queries.length;
    await tester.tap(find.byTooltip('Refresh'));
    await tester.pumpAndSettle();
    expect(api.queries.length, before + 1);
  });

  testWidgets('posts two carton scans as two cartons and keeps the available name', (tester) async {
    final api = _DocumentsApi();
    await pump(tester, api, user: const AppUser(
      id: 'u2', username: 'u2', fullName: 'Store manager', companyId: 'c1',
      permissions: ['inventory.stock.adjust'],
    ));
    await tester.tap(find.text('New document'));
    await tester.pumpAndSettle();
    final input = find.byKey(const ValueKey('stock-document-barcode'));
    for (var scan = 0; scan < 2; scan++) {
      await tester.enterText(input, 'CARTON');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
    }
    expect(find.text('I-1 — صنف عربي'), findsOneWidget);
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();
    expect(api.posts.single['lines'], [
      {'itemId': 'item-1', 'quantity': '2', 'unitName': 'carton', 'countedQuantity': '2'},
    ]);
  });

  testWidgets('says why it cannot create when the branch has no warehouse', (
    tester,
  ) async {
    final api = _DocumentsApi()..noWarehouses = true;
    await pump(
      tester,
      api,
      user: const AppUser(
        id: 'u2',
        username: 'u2',
        fullName: 'Store manager',
        companyId: 'c1',
        permissions: ['inventory.stock.adjust'],
      ),
    );

    await tester.tap(find.text('New document'));
    await tester.pumpAndSettle();
    expect(find.text('New stock document'), findsNothing);
    expect(find.text('This branch has no warehouse defined.'), findsOneWidget);
    expect(api.posts, isEmpty);
    // The error dialog is Arabic-first like every other error surface: its
    // button reads 'حسنًا' whatever the screen locale is. It never dismisses
    // itself, so acknowledge it before the next pump.
    await tester.tap(find.text('حسنًا'));
    await tester.pumpAndSettle();
  });
}
