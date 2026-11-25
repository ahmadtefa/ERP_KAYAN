import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_documents_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:erp_kayan/core/error/failure.dart';
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
    if (path == '/inventory/locations') { final wh=query?['warehouseId'];return [{'id':wh=='wh-main'?'source-shelf':'target-shelf','warehouseId':wh,'code':wh=='wh-main'?'A-01':'Z-01','nameEn':'Shelf','nameAr':'رف','isActive':true}]; }
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
      ...extraRows,
    ];
  }

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if(path=='/inventory/batches') {
      return {'items':[
      {'id':'lot-1','itemId':'item-1','warehouseId':'wh-main','batchNumber':'LOT-A','remainingQuantity':'48','unplacedQuantity':'0','expiryDate':'2027-03-01','locations':[{'locationId':'source-shelf','quantity':'48'}]},
      {'id':'written','itemId':'item-1','warehouseId':'wh-main','batchNumber':'WRITTEN','status':'WRITTEN_OFF','remainingQuantity':'5','locations':[{'locationId':'source-shelf','quantity':'5'}]},
      {'id':'wrong','itemId':'item-1','warehouseId':'wh-b2','batchNumber':'WRONG','remainingQuantity':'99','locations':[{'locationId':'source-shelf','quantity':'99'}]},
    ],'total':2};
    }
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
    final failure = refusePost;
    if (failure != null) throw failure;
    return {'id': 'new-document'};
  }

  Object? refusePost;

  /// Extra rows a test wants listed after the standard four.
  final extraRows = <Map<String, dynamic>>[];
}

Finder tableText(String value) => find.byWidgetPredicate(
  (widget) => widget is Text && widget.data == value,
);

void main() {
  final visualKey=GlobalKey();
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
        child: RepaintBoundary(key:visualKey,child: MaterialApp(
          theme: ThemeData(fontFamily: 'IBMPlexSansArabic'),
          locale: locale,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: StockDocumentsScreen()),
        )),
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

  testWidgets('transfer draft selects source and target shelves in their own stores', (tester) async {
    await tester.runAsync(() async {await (FontLoader('IBMPlexSansArabic')..addFont(Future.value(ByteData.sublistView(File('assets/fonts/IBMPlexSansArabic-Regular.ttf').readAsBytesSync())))).load();});
    await tester.runAsync(() async {await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(File(materialIconsFontPath).readAsBytesSync())))).load();});
    final api=_DocumentsApi();await pump(tester,api,user:const AppUser(id:'u2',username:'u2',fullName:'Manager',companyId:'c1',permissions:['inventory.stock.adjust']));
    await tester.tap(find.text('New document'));await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(DropdownButtonFormField<String>,'Kind'));await tester.pumpAndSettle();await tester.tap(find.text('Transfer').last);await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(DropdownButtonFormField<String>,'To store'));await tester.pumpAndSettle();await tester.tap(find.text('Second store').last);await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('stock-document-barcode')),'CARTON');await tester.testTextInput.receiveAction(TextInputAction.done);await tester.pumpAndSettle();
    Future<void> pick(String button,String option) async {await tester.tap(find.text(button));await tester.pumpAndSettle();await tester.tap(find.widgetWithText(DropdownButtonFormField<String>,'Location'));await tester.pumpAndSettle();await tester.tap(find.text(option).last);await tester.pumpAndSettle();await tester.tap(find.text('Apply'));await tester.pumpAndSettle();}
    await pick('Source location: not selected','A-01 • Shelf');await pick('Destination location: unlocated','Z-01 • Shelf');
    await tester.tap(find.text('Lot: not selected'));await tester.pumpAndSettle();await tester.tap(find.widgetWithText(DropdownButtonFormField<String>,'Lot'));await tester.pumpAndSettle();expect(find.textContaining('WRONG'),findsNothing);expect(find.textContaining('WRITTEN'),findsNothing);await tester.tap(find.textContaining('LOT-A').last);await tester.pumpAndSettle();await tester.tap(find.text('Apply'));await tester.pumpAndSettle();
    final boundary=visualKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;await tester.runAsync(() async {final image=await boundary.toImage();final bytes=await image.toByteData(format:ui.ImageByteFormat.png);await screenshotFile('stock-document-transfer.png').writeAsBytes(bytes!.buffer.asUint8List());image.dispose();});
    await tester.tap(find.text('Create'));await tester.pumpAndSettle();final line=(api.posts.single['lines'] as List).single as Map;expect(line['storageLocationId'],'source-shelf');expect(line['toStorageLocationId'],'target-shelf');expect(line['quantity'],'1');expect(line['unitName'],'carton');expect(line['batchId'],'lot-1');expect(tester.takeException(),isNull);
  });

  testWidgets('Arabic transfer lot picker retains selected lot and source', (tester) async {
    await tester.runAsync(() async {await (FontLoader('IBMPlexSansArabic')..addFont(Future.value(ByteData.sublistView(File('assets/fonts/IBMPlexSansArabic-Regular.ttf').readAsBytesSync())))).load();});
    await tester.runAsync(() async {await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(File(materialIconsFontPath).readAsBytesSync())))).load();});
    final api=_DocumentsApi();await pump(tester,api,locale:const Locale('ar'),user:const AppUser(id:'u2',username:'u2',fullName:'Manager',companyId:'c1',permissions:['inventory.stock.adjust']));
    await tester.tap(find.text('مستند جديد'));await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(DropdownButtonFormField<String>,'نوع المستند'));await tester.pumpAndSettle();await tester.tap(find.text('تحويل').last);await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(DropdownButtonFormField<String>,'إلى مخزن'));await tester.pumpAndSettle();await tester.tap(find.text('المخزن الثاني').last);await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('stock-document-barcode')),'CARTON');await tester.testTextInput.receiveAction(TextInputAction.done);await tester.pumpAndSettle();
    Future<void> pick(String button,String option) async {await tester.tap(find.text(button));await tester.pumpAndSettle();await tester.tap(find.widgetWithText(DropdownButtonFormField<String>,'الموقع'));await tester.pumpAndSettle();await tester.tap(find.text(option).last);await tester.pumpAndSettle();await tester.tap(find.text('تطبيق'));await tester.pumpAndSettle();}
    await pick('موقع المصدر: غير محدد','A-01 • رف');await pick('موقع الاستلام: بدون موقع','Z-01 • رف');
    await tester.tap(find.text('الدفعة: غير محددة'));await tester.pumpAndSettle();await tester.tap(find.widgetWithText(DropdownButtonFormField<String>,'الدفعة'));await tester.pumpAndSettle();expect(find.textContaining('WRONG'),findsNothing);expect(find.textContaining('WRITTEN'),findsNothing);await tester.tap(find.textContaining('LOT-A').last);await tester.pumpAndSettle();await tester.tap(find.text('تطبيق'));await tester.pumpAndSettle();
    final boundary=visualKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;await tester.runAsync(() async {final image=await boundary.toImage();final bytes=await image.toByteData(format:ui.ImageByteFormat.png);await screenshotFile('stock-document-transfer-ar.png').writeAsBytes(bytes!.buffer.asUint8List());image.dispose();});
    await tester.tap(find.text('إنشاء'));await tester.pumpAndSettle();final line=(api.posts.single['lines'] as List).single as Map;expect(line['storageLocationId'],'source-shelf');expect(line['toStorageLocationId'],'target-shelf');expect(line['quantity'],'1');expect(line['unitName'],'carton');expect(line['batchId'],'lot-1');expect(tester.takeException(),isNull);
  });

  testWidgets('a bad quantity is named on its own line, cleared on edit, and a server refusal lands there too', (tester) async {
    final api = _DocumentsApi();
    await pump(tester, api, user: const AppUser(
      id: 'u2', username: 'u2', fullName: 'Store manager', companyId: 'c1',
      permissions: ['inventory.stock.adjust'],
    ));
    await tester.tap(find.text('New document'));
    await tester.pumpAndSettle();
    final input = find.byKey(const ValueKey('stock-document-barcode'));
    await tester.enterText(input, 'CARTON');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    final qty = find.widgetWithText(TextField, 'Quantity');
    await tester.enterText(qty, 'abc');
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();
    expect(api.posts, isEmpty);
    expect(find.text('Enter a numeric quantity.'), findsOneWidget);
    await tester.enterText(qty, '-1');
    await tester.pump();
    expect(find.text('Enter a numeric quantity.'), findsNothing);
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();
    expect(find.text('A counted quantity cannot be negative.'), findsOneWidget);
    expect(api.posts, isEmpty);
    await tester.enterText(qty, '3');
    api.refusePost = const ApiFailure(
      'Validation failed',
      statusCode: 422,
      fieldErrors: {'lines.0.quantity': 'Not enough stock in this store'},
    );
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();
    expect(api.posts.length, 1);
    expect(find.text('Not enough stock in this store'), findsOneWidget);
    expect(find.text('New stock document'), findsOneWidget);
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

  for(final arabic in [false,true]) {
  testWidgets('no lot posting refusal keeps the original draft and requires acknowledgement Arabic=$arabic', (tester) async {
    await tester.runAsync(() async {
      await (FontLoader('IBMPlexSansArabic')..addFont(Future.value(ByteData.sublistView(File('assets/fonts/IBMPlexSansArabic-Regular.ttf').readAsBytesSync())))).load();
      await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(File(materialIconsFontPath).readAsBytesSync())))).load();
    });
    final api = _DocumentsApi()..refusePost = const ApiFailure(
      'Choose the lot to move on line 1 or split the quantity over lots, then post again; no balance changed and your data is kept.',
      statusCode: 400, code: 'STOCK_DOC_TRANSFER_LOT_REQUIRED',
    );
    await pump(tester, api, locale:Locale(arabic?'ar':'en'), user: const AppUser(
      id: 'u2', username: 'u2', fullName: 'Store manager', companyId: 'c1',
      permissions: ['inventory.stock.adjust'],
    ));
    await tester.tap(find.byTooltip(arabic?'ترحيل':'Post'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, arabic?'ترحيل':'Post'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsOneWidget);
    expect(find.textContaining(arabic?'اختر دفعة':'source lot is not selected'), findsOneWidget);
    final boundary = visualKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    await tester.runAsync(() async {
      final image=await boundary.toImage();final bytes=await image.toByteData(format:ui.ImageByteFormat.png);
      await screenshotFile(arabic?'stockdoc-no-lot-guidance-ar.png':'stockdoc-no-lot-guidance.png').writeAsBytes(bytes!.buffer.asUint8List());image.dispose();
    });
    expect(api.posts.single['path'], '/inventory/stock-documents/d-2/post');
    expect(find.text('Document updated.'), findsNothing);
    await tester.tap(find.text(arabic?'حسنًا':'OK'));
    await tester.pumpAndSettle();
    expect(find.byTooltip(arabic?'ترحيل':'Post'), findsOneWidget);
    expect(find.text('TRF-001'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  }

  const storeAdjuster = AppUser(
    id: 'u2', username: 'u2', fullName: 'Store manager', companyId: 'c1',
    permissions: ['inventory.stock.adjust'],
  );

  testWidgets('post confirmation: a transfer names the document and says no journal entry is made, and cancelling posts nothing', (tester) async {
    final api = _DocumentsApi();
    await pump(tester, api, user: storeAdjuster);
    await tester.tap(find.byTooltip('Post').first);
    await tester.pumpAndSettle();
    expect(find.textContaining('Post TRF-001'), findsOneWidget);
    expect(find.textContaining('no journal entry is made'), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();
    expect(api.posts, isEmpty);
    // Write-off drafts offer no Post action on this screen (they have their own approval screen).
  });

  testWidgets('post confirmation for a count and an adjustment says a journal entry is made when the value changes', (tester) async {
    final api = _DocumentsApi();
    api.extraRows.addAll([
      api._row(id: 'd-5', number: 'CNT-001', kind: 'count', status: 'draft'),
      api._row(id: 'd-6', number: 'ADJ-002', kind: 'adjustment', status: 'draft'),
    ]);
    await pump(tester, api, user: storeAdjuster);
    // Post buttons in list order: TRF-001, CNT-001, ADJ-002.
    await tester.tap(find.byTooltip('Post').at(1));
    await tester.pumpAndSettle();
    expect(find.textContaining('Post CNT-001'), findsOneWidget);
    expect(find.textContaining('set to the counted quantity'), findsOneWidget);
    expect(find.textContaining('a journal entry is made when the value changes'), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Post').at(2));
    await tester.pumpAndSettle();
    expect(find.textContaining('Post ADJ-002'), findsOneWidget);
    expect(find.textContaining('added to or removed from the balance'), findsOneWidget);
    expect(find.textContaining('a journal entry is made when the value changes'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Post'));
    await tester.pumpAndSettle();
    expect(api.posts.single['path'], '/inventory/stock-documents/d-6/post');
    expect(find.text('Document posted.'), findsOneWidget);
  });

  testWidgets('a refused post keeps the list and the draft, and says why', (tester) async {
    final api = _DocumentsApi()..refusePost = const ApiFailure(
      'Choose the lot to move on line 1 or split the quantity over lots, then post again; no balance changed and your data is kept.',
      statusCode: 400, code: 'STOCK_DOC_TRANSFER_LOT_REQUIRED',
    );
    await pump(tester, api, user: storeAdjuster);
    await tester.tap(find.byTooltip('Post').first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Post'));
    await tester.pumpAndSettle();
    expect(api.posts.single['path'], '/inventory/stock-documents/d-2/post');
    expect(find.text('TRF-001'), findsOneWidget);
    expect(find.text('Document posted.'), findsNothing);
  });

  testWidgets('reversing asks first, names the effect, then reverses', (tester) async {
    final api = _DocumentsApi();
    await pump(tester, api, user: storeAdjuster);
    await tester.tap(find.byTooltip('Reverse').first);
    await tester.pumpAndSettle();
    expect(find.textContaining('Reversing ADJ-001 cancels its effect'), findsOneWidget);
    expect(api.posts, isEmpty);
    await tester.tap(find.widgetWithText(FilledButton, 'Reverse'));
    await tester.pumpAndSettle();
    expect(api.posts.single['path'], '/inventory/stock-documents/d-1/reverse');
    expect(find.text('Document reversed.'), findsOneWidget);
  });

  testWidgets('posts a draft and reloads the stock documents', (tester) async {
    final api = _DocumentsApi();
    await pump(tester, api, user: const AppUser(
      id: 'u2', username: 'u2', fullName: 'Store manager', companyId: 'c1',
      permissions: ['inventory.stock.adjust'],
    ));
    final before = api.queries.length;
    await tester.tap(find.byTooltip('Post'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Post'));
    await tester.pumpAndSettle();
    expect(api.posts.single['path'], '/inventory/stock-documents/d-2/post');
    expect(api.queries.length, before + 1);
  });

  testWidgets('stock document cancel retains the draft until discard is confirmed', (tester) async {
    final api = _DocumentsApi();
    await pump(tester, api, user: const AppUser(
      id: 'u2', username: 'u2', fullName: 'Store manager', companyId: 'c1',
      permissions: ['inventory.stock.adjust'],
    ));
    await tester.tap(find.text('New document'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Notes'), 'Draft notes');
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.text('Discard this draft?'), findsOneWidget);
    await tester.tap(find.text('Cancel').last);
    await tester.pumpAndSettle();
    expect(find.text('Draft notes'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Discard changes'));
    await tester.pumpAndSettle();
    expect(find.text('New stock document'), findsNothing);
    expect(api.posts, isEmpty);
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
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
  });

  // Pictures for the usability pilot review. They are written to the folder
  // named by KAYAN_VISUAL_OUTPUT (the CI step uploads it) and assert nothing
  // new about behaviour, so the same test runs before and after a change.
  for (final arabic in [false, true]) {
    testWidgets('pilot pictures: new count document and post confirmation (${arabic ? 'ar' : 'en'})', (tester) async {
      await tester.runAsync(() async {await (FontLoader('IBMPlexSansArabic')..addFont(Future.value(ByteData.sublistView(File('assets/fonts/IBMPlexSansArabic-Regular.ttf').readAsBytesSync())))).load();});
      await tester.runAsync(() async {await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(File(materialIconsFontPath).readAsBytesSync())))).load();});
      final api = _DocumentsApi();
      await pump(tester, api, locale: Locale(arabic ? 'ar' : 'en'), user: const AppUser(id: 'u2', username: 'u2', fullName: 'Manager', companyId: 'c1', permissions: ['inventory.stock.adjust']));
      Future<void> shoot(String name) async {
        final boundary = visualKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
        await tester.runAsync(() async {
          final image = await boundary.toImage();
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          await screenshotFile('$name-${arabic ? 'ar' : 'en'}.png').writeAsBytes(bytes!.buffer.asUint8List());
          image.dispose();
        });
      }
      await tester.tap(find.text(arabic ? 'مستند جديد' : 'New document'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('stock-document-barcode')), 'CARTON');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      await shoot('pilot-new-document-count');
      await tester.tap(find.text(arabic ? 'إلغاء' : 'Cancel'));
      await tester.pumpAndSettle();
      await tester.tap(find.text(arabic ? 'تجاهل التغييرات' : 'Discard changes'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip(arabic ? 'ترحيل' : 'Post').first);
      await tester.pumpAndSettle();
      await shoot('pilot-post-confirmation');
      expect(tester.takeException(), isNull);
    });
  }
}
