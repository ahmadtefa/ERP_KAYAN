import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/batches_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// A user who may do everything on this screen, so a test that fails does so
/// because of the operation and not because a button was hidden.
const _allPowers = AppUser(
  id: 'u1',
  username: 'storekeeper',
  fullName: 'Storekeeper',
  companyId: 'company-1',
  branchId: 'branch-1',
  permissions: [
    'inventory.batches.read',
    'inventory.batches.receive',
    'inventory.batches.issue',
    'inventory.batches.transfer',
    'inventory.batches.writeoff',
    'inventory.batches.expired.issue',
    'inventory.items.read',
    'inventory.warehouses.read',
  ],
);

/// A user who may read the screen and nothing else.
const _reader = AppUser(
  id: 'u2',
  username: 'viewer',
  fullName: 'Viewer',
  companyId: 'company-1',
  branchId: 'branch-1',
  permissions: ['inventory.batches.read', 'inventory.items.read'],
);

Json _lot({
  String id = 'lot-1',
  String batchNumber = 'LOT-A',
  String remaining = '40.0000',
  String? expiry = '2026-12-01T00:00:00.000Z',
  String? production = '2026-01-15T00:00:00.000Z',
  int? days = 24,
  String status = 'OPEN',
  Json? location = const {
    'id': 'loc-1',
    'code': 'A-01',
    'nameEn': 'Aisle A shelf 1',
    'nameAr': 'ممر أ رف ١',
    'kind': 'SHELF',
  },
}) => {
  'id': id,
  'batchNumber': batchNumber,
  'itemId': 'item-1',
  'warehouseId': 'wh-1',
  'storageLocationId': location?['id'],
  'storageLocation': location,
  'productionDate': production,
  'expiryDate': expiry,
  'receivedQuantity': '100.0000',
  'remainingQuantity': remaining,
  'unitCost': '12.5000',
  'value': '500.0000',
  'daysToExpiry': days,
  'status': status,
  'item': {'code': 'I-1', 'nameEn': 'Cable', 'nameAr': 'كابل', 'unit': 'm'},
  'warehouse': {'code': 'MAIN', 'nameEn': 'Main store', 'nameAr': 'الرئيسي'},
};

class _BatchApi extends ApiClient {
  _BatchApi({this.lots, this.failPost})
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  bool locationsAvailable = true;
  bool requiresBatch = false;
  bool secondLocation = false;
  final List<Json>? lots;
  final Object? failPost;

  /// Every post this run performed, in order, so a test can assert the body
  /// the server would have received rather than only that a dialog closed.
  final posted = <(String, Map<String, dynamic>)>[];
  int listCalls = 0;

  /// The query each shelf lookup carried, so a test can pin that the dialog
  /// asks for one warehouse's shelves rather than every shelf in the company.
  final shelfQueries = <Map<String, dynamic>?>[];

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/batches') {
      listCalls++;
      return lots ?? [_lot()];
    }
    if (path == '/inventory/items') {
      return [
        {
          'id': 'item-1',
          'code': 'I-1',
          'requiresBatch': requiresBatch,
          'nameEn': 'Cable',
          'nameAr': 'كابل',
          'unit': 'm',
        },
      ];
    }
    if (path == '/inventory/warehouses') {
      return [
        {
          'id': 'wh-1',
          'code': 'MAIN',
          'nameEn': 'Main store',
          'nameAr': 'الرئيسي',
        },
        {'id': 'wh-2', 'code': 'SEC', 'nameEn': 'Second', 'nameAr': 'الثاني'},
      ];
    }
    if (path == '/inventory/locations') {
      shelfQueries.add(query);
      if (!locationsAvailable) return [];
      if (query?['warehouseId'] == 'wh-2') return [{'id':'loc-target','code':'T-01','nameEn':'Target shelf','nameAr':'رف الاستلام','warehouseId':'wh-2','isActive':true}];
      return [
        if (secondLocation) {'id': 'loc-2', 'code': 'B-02', 'nameEn': 'Shelf B', 'warehouseId': 'wh-1', 'isActive': false},
        {
          'id': 'loc-1',
          'code': 'A-01',
          'nameEn': 'Aisle A shelf 1',
          'nameAr': 'ممر أ رف ١',
          'kind': 'SHELF',
          'warehouseId': 'wh-1',
        },
      ];
    }
    return [];
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    if (failPost != null) throw failPost!;
    posted.add((path, Map<String, dynamic>.from(body! as Map)));
    return {'ok': true};
  }
}

void main() {
  final visualKey = GlobalKey();
  Future<void> pump(
    WidgetTester tester,
    _BatchApi api, {
    AppUser user = _allPowers,
    Locale locale = const Locale('en'),
  }) async {
    tester.view.physicalSize = const Size(1900, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(user),
        ],
        child: RepaintBoundary(key: visualKey, child: MaterialApp(
          theme: ThemeData(fontFamily: 'IBMPlexSansArabic'),
          locale: locale,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: BatchesScreen()),
        )),
      ),
    );
    await tester.pumpAndSettle();
  }

  /// Taps a button by its label, preferring the open dialog over the row
  /// behind it, then waits for the result to settle.
  ///
  /// The row action and the dialog's own submit button carry the same word
  /// ("Issue", "Transfer", "Write off"…). A plain `find.text(label).first`
  /// therefore resolves to the row button once the dialog is up, and that
  /// button sits under the modal barrier: the tap is swallowed at an
  /// off-screen offset, `_submit` never runs and nothing is posted. Scoping
  /// the finder to the open `AlertDialog` makes the second tap hit what the
  /// operator actually presses.
  Future<void> tapText(WidgetTester tester, String label) async {
    final inDialog = find.descendant(
      of: find.byType(AlertDialog),
      matching: find.text(label),
    );
    final finder = inDialog.evaluate().isEmpty ? find.text(label) : inDialog;
    await tester.ensureVisible(finder.first);
    await tester.pumpAndSettle();
    await tester.tap(finder.first);
    await tester.pumpAndSettle();
  }

  /// Opens a dialog dropdown by the label of the field it belongs to.
  ///
  /// Tapping the label text does not work: the label is a `Text` painted by
  /// the `InputDecorator` and the hit test at its centre lands on the
  /// decoration itself, which has no gesture recogniser, so the menu never
  /// opens. The field's `InputDecorator` is the box the operator actually
  /// presses, so the tap goes there.
  Future<void> tapField(WidgetTester tester, String label) async {
    final field = find
        .ancestor(
          of: find.descendant(
            of: find.byType(AlertDialog),
            matching: find.text(label),
          ),
          matching: find.byType(InputDecorator),
        )
        .first;
    await tester.ensureVisible(field);
    await tester.pumpAndSettle();
    await tester.tap(field);
    await tester.pumpAndSettle();
  }

  /// Picks an entry out of a dialog dropdown.
  ///
  /// A closed `DropdownButtonFormField` builds only the selected item, so the
  /// entry to pick is not in the tree at all until the menu is opened. The
  /// menu is also taller than the 460px dialog and scrolls inside itself, so
  /// the wanted row can sit below the visible area: it is scrolled into view
  /// before the tap. Capping the settle means a broken menu surfaces as the
  /// test's own assertion rather than as a bare pumpAndSettle timeout.
  Future<void> pickDropdownItem(
    WidgetTester tester,
    String fieldLabel,
    String itemLabel,
  ) async {
    await tapField(tester, fieldLabel);
    final item = find.text(itemLabel).last;
    await tester.ensureVisible(item);
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    await tester.tap(item);
    await tester.pumpAndSettle(const Duration(milliseconds: 100));

    // A missed tap leaves the field on its previous value, and a later
    // assertion about what was posted would then pass for the wrong reason.
    expect(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.text(itemLabel),
      ),
      findsOneWidget,
      reason: 'the dropdown did not take the selection',
    );
  }

  group('list controls', () {
    testWidgets('expiry segments filter rows and All restores them', (
      tester,
    ) async {
      await pump(
        tester,
        _BatchApi(
          lots: [
            _lot(id: 'expired', batchNumber: 'OLD', days: -2),
            _lot(id: 'soon', batchNumber: 'SOON', days: 5),
            _lot(id: 'later', batchNumber: 'LATER', days: 120),
          ],
        ),
      );
      await tester.tap(find.text('Expired'));
      await tester.pumpAndSettle();
      expect(find.text('OLD'), findsOneWidget);
      expect(find.text('SOON'), findsNothing);
      expect(find.text('LATER'), findsNothing);
      await tester.tap(find.text('Expiring'));
      await tester.pumpAndSettle();
      expect(find.text('SOON'), findsOneWidget);
      expect(find.text('OLD'), findsNothing);
      expect(find.text('LATER'), findsNothing);
      await tester.tap(find.text('All'));
      await tester.pumpAndSettle();
      expect(find.text('OLD'), findsOneWidget);
      expect(find.text('SOON'), findsOneWidget);
      expect(find.text('LATER'), findsOneWidget);
    });
    testWidgets('search trims text and clearing restores all lots', (
      tester,
    ) async {
      await pump(
        tester,
        _BatchApi(
          lots: [
            _lot(batchNumber: 'FINDME'),
            _lot(id: 'other', batchNumber: 'OTHER'),
          ],
        ),
      );
      final search = find.byType(TextField).first;
      await tester.enterText(search, '  findme  ');
      await tester.pumpAndSettle();
      expect(find.text('FINDME'), findsOneWidget);
      expect(find.text('OTHER'), findsNothing);
      await tester.enterText(search, '');
      await tester.pumpAndSettle();
      expect(find.text('OTHER'), findsOneWidget);
    });
    testWidgets('refresh reloads lots without submitting a stock operation', (
      tester,
    ) async {
      final api = _BatchApi();
      await pump(tester, api);
      final before = api.listCalls;
      await tester.tap(find.byTooltip('Refresh'));
      await tester.pumpAndSettle();
      expect(api.listCalls, greaterThan(before));
      expect(api.posted, isEmpty);
    });
  });

  group('the lot row', () {
    testWidgets('shows production date, expiry and the storage location', (
      tester,
    ) async {
      await pump(tester, _BatchApi());

      expect(find.text('2026-01-15'), findsOneWidget);
      expect(find.text('2026-12-01'), findsOneWidget);
      expect(find.text('Aisle A shelf 1'), findsOneWidget);
      expect(find.text('Production'), findsOneWidget);
      expect(find.text('Location'), findsOneWidget);
    });

    testWidgets('a lot without dates or a shelf shows dashes, not null', (
      tester,
    ) async {
      await pump(
        tester,
        _BatchApi(
          lots: [
            _lot(production: null, expiry: null, days: null, location: null),
          ],
        ),
      );

      // Exactly three dashes in the cells: production, expiry and location.
      // The Days column also renders a dash for this lot, so counting every
      // dash on the screen would pin the table's column count rather than
      // the three cells this test is about.
      final dashes = tester.widgetList<Text>(find.text('—')).toList();
      expect(dashes, hasLength(4));
      expect(
        dashes.where((widget) => widget.style?.fontSize != 10.5),
        hasLength(3),
        reason:
            'production, expiry and location are body cells; the fourth '
            'dash is the small caption in the Days column',
      );
      expect(find.textContaining('null'), findsNothing);
    });

    testWidgets('Arabic reads the Arabic location name', (tester) async {
      await pump(tester, _BatchApi(), locale: const Locale('ar'));
      expect(find.text('ممر أ رف ١'), findsOneWidget);
    });
  });

  group('permissions', () {
    testWidgets('a reader gets no operation buttons at all', (tester) async {
      await pump(tester, _BatchApi(), user: _reader);

      expect(find.text('Receive'), findsNothing);
      expect(find.text('Issue'), findsNothing);
      expect(find.text('Transfer'), findsNothing);
      expect(find.text('Write off'), findsNothing);
      // The list itself still renders: hiding the controls must not hide the
      // lots the user is allowed to read.
      expect(find.text('LOT-A'), findsOneWidget);
    });

    testWidgets('a user who may receive but not issue gets only Receive', (
      tester,
    ) async {
      const receiver = AppUser(
        id: 'u3',
        username: 'receiver',
        fullName: 'Receiver',
        companyId: 'company-1',
        branchId: 'branch-1',
        permissions: [
          'inventory.batches.read',
          'inventory.batches.receive',
          'inventory.items.read',
        ],
      );
      await pump(tester, _BatchApi(), user: receiver);

      expect(find.text('Receive'), findsOneWidget);
      expect(find.text('Issue'), findsNothing);
      expect(find.text('Transfer'), findsNothing);
      expect(find.text('Write off'), findsNothing);
    });
  });

  group('operations post the right body', () {
    testWidgets('issue from a lot sends the lot, item and quantity', (
      tester,
    ) async {
      final api = _BatchApi();
      await pump(tester, api);

      await tapText(tester, 'Issue');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Quantity'),
        '5',
      );
      await tapText(tester, 'Issue');

      expect(api.posted, hasLength(1));
      final (path, body) = api.posted.single;
      expect(path, '/inventory/batches/issue');
      expect(body['batchId'], 'lot-1');
      expect(body['itemId'], 'item-1');
      expect(body['warehouseId'], 'wh-1');
      expect(body['branchId'], 'branch-1');
      // A number, not the text the field held: the endpoint validates with
      // @IsNumber and rejects a numeric string.
      expect(body['quantity'], isA<num>());
      expect(body['quantity'], 5);
    });

    testWidgets('the quantity field is prefilled with what is left', (
      tester,
    ) async {
      await pump(tester, _BatchApi(lots: [_lot(remaining: '12.5000')]));
      await tapText(tester, 'Issue');

      final field = find.widgetWithText(TextFormField, 'Quantity');
      final controllers = tester
          .widgetList<TextFormField>(field)
          .map((w) => w.controller?.text)
          .toList();
      expect(controllers, contains('12.5'));
    });

    testWidgets('transfer sends both warehouses and selected destination shelf', (tester) async {
      final api = _BatchApi();
      await pump(tester, api);

      await tapText(tester, 'Transfer');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Quantity'),
        '3',
      );
      await pickDropdownItem(tester, 'To warehouse', 'SEC • Second');
      await pickDropdownItem(tester, 'Destination location (optional)', 'T-01 • Target shelf');
      await tapText(tester, 'Transfer');

      final (path, body) = api.posted.single;
      expect(path, '/inventory/batches/transfer');
      expect(body['fromWarehouseId'], 'wh-1');
      expect(body['fromStorageLocationId'], 'loc-1');
      expect(body['toStorageLocationId'], 'loc-target');
      expect(body['toWarehouseId'], 'wh-2');
      expect(body['batchId'], 'lot-1');
      expect(body['quantity'], 3);
    });

    testWidgets('transfer sources stay explicit for a split lot and render with actual fonts', (tester) async {
      await tester.runAsync(() async {
        await (FontLoader('IBMPlexSansArabic')..addFont(Future.value(ByteData.sublistView(File('assets/fonts/IBMPlexSansArabic-Regular.ttf').readAsBytesSync())))).load();
        await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(File(materialIconsFontPath).readAsBytesSync())))).load();
      });
      final ar = Platform.environment['KAYAN_ARABIC_COMPACT'] == '1';
      final row=_lot(location:null)..['locations']=[{'locationId':'loc-1','quantity':'40.0000'}];
      final api=_BatchApi(lots:[row]);
      await pump(tester,api,locale:Locale(ar?'ar':'en'));
      if(ar){tester.view.physicalSize=const Size(700,1100);await tester.pumpAndSettle();}
      await tapText(tester,ar?'تحويل':'Transfer');
      await pickDropdownItem(tester,ar?'إلى مستودع':'To warehouse',ar?'SEC • الثاني':'SEC • Second');
      await tester.enterText(find.widgetWithText(TextFormField,ar?'الكمية':'Quantity'),'3');
      await tapText(tester,ar?'تحويل':'Transfer');
      expect(api.posted,isEmpty);
      await pickDropdownItem(tester,ar?'موقع الصرف':'Source location',ar?'A-01 • ممر أ رف ١':'A-01 • Aisle A shelf 1');
      await pickDropdownItem(tester,ar?'موقع الاستلام (اختياري)':'Destination location (optional)',ar?'T-01 • رف الاستلام':'T-01 • Target shelf');
      final boundary=visualKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      await tester.runAsync(() async {final image=await boundary.toImage();final data=await image.toByteData(format:ui.ImageByteFormat.png);await screenshotFile('batch-transfer-${ar?'ar':'desktop'}.png').writeAsBytes(data!.buffer.asUint8List());image.dispose();});
      expect(tester.takeException(),isNull);
      await tapText(tester,ar?'تحويل':'Transfer');
      expect(api.posted.single.$2['fromStorageLocationId'],'loc-1');
      expect(api.posted.single.$2['toStorageLocationId'],'loc-target');
    });

    testWidgets('transfer can clear a destination back to unlocated and retains input after refusal', (tester) async {
      final api=_BatchApi(failPost:const ApiFailure('Source location is short. Reduce quantity.',statusCode:400));
      await pump(tester,api);await tapText(tester,'Transfer');
      await pickDropdownItem(tester,'To warehouse','SEC • Second');
      await pickDropdownItem(tester,'Destination location (optional)','T-01 • Target shelf');
      await tapText(tester,'Clear destination location');
      await tester.enterText(find.widgetWithText(TextFormField,'Quantity'),'3');
      await tester.enterText(find.widgetWithText(TextFormField,'Reason (optional)'),'physical move');
      await tapText(tester,'Transfer');await tapText(tester,'OK');
      expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField,'Quantity')).controller!.text,'3');
      expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField,'Reason (optional)')).controller!.text,'physical move');
      expect(find.text('A-01 • Aisle A shelf 1'),findsWidgets);
      expect(find.text('Clear destination location'),findsNothing);
    });

    testWidgets('uncertain transfer blocks duplicate stock movement', (tester) async {
      final api=_BatchApi(failPost:const NetworkFailure());await pump(tester,api);await tapText(tester,'Transfer');
      await pickDropdownItem(tester,'To warehouse','SEC • Second');await tapText(tester,'Transfer');
      expect(find.textContaining('Could not confirm whether the stock movement completed.'),findsOneWidget);await tapText(tester,'OK');
      expect(tester.widget<FilledButton>(find.descendant(of:find.byType(AlertDialog),matching:find.widgetWithText(FilledButton,'Transfer'))).onPressed,isNull);
    });

    testWidgets('a transfer to the same warehouse is refused before posting', (
      tester,
    ) async {
      final api = _BatchApi();
      await pump(tester, api);

      await tapText(tester, 'Transfer');
      // Choosing the source again must not reach the server, which would
      // answer with a validation error the operator can do nothing about.
      final source = tester.widget<DropdownButtonFormField<String>>(find.widgetWithText(DropdownButtonFormField<String>, 'From warehouse'));
      expect(source.onChanged, isNull);
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Quantity'),
        '3',
      );
      await tapText(tester, 'Transfer');

      expect(api.posted, isEmpty);
    });

    testWidgets('write-off requires a reason and sends it', (tester) async {
      final api = _BatchApi();
      await pump(tester, api);

      await tapText(tester, 'Write off');
      // Empty reason: the form stops here rather than sending a request the
      // endpoint would reject.
      await tapText(tester, 'Write off');
      expect(api.posted, isEmpty);

      await tester.enterText(
        find.widgetWithText(TextFormField, 'Reason'),
        'Broken in the yard',
      );
      await tapText(tester, 'Write off');

      final (path, body) = api.posted.single;
      expect(path, '/inventory/batches/write-off');
      expect(body['reason'], 'Broken in the yard');
      expect(body['batchId'], 'lot-1');
    });

    testWidgets(
      'split located lot requires a physical source before direct issue',
      (tester) async {
        final row = _lot(location: null)
          ..['locations'] = [
            {'locationId': 'loc-1', 'quantity': '40.0000'},
          ];
        final api = _BatchApi(lots: [row]);
        await pump(tester, api);
        await tapText(tester, 'Issue');
        await tapText(tester, 'Issue');
        expect(api.posted, isEmpty);
        expect(
          find.textContaining('Choose the physical source location.'),
          findsOneWidget,
        );
        expect(
          tester
              .widget<TextFormField>(
                find.widgetWithText(TextFormField, 'Quantity'),
              )
              .controller!
              .text,
          '40',
        );
        await pickDropdownItem(
          tester,
          'Source location',
          'A-01 • Aisle A shelf 1',
        );
        await tapText(tester, 'Issue');
        expect(api.posted.single.$2['storageLocationId'], 'loc-1');
      },
    );

    testWidgets('writeoff sends its one explicitly chosen physical source', (tester) async {
      final api = _BatchApi();
      await pump(tester, api);
      await tapText(tester, 'Write off');
      await tester.enterText(find.widgetWithText(TextFormField, 'Quantity'), '2');
      await tester.enterText(find.widgetWithText(TextFormField, 'Reason'), 'damaged');
      await tapText(tester, 'Write off');
      expect(api.posted.single.$2['storageLocationId'], 'loc-1');
    });

    testWidgets('split source visual proof with actual fonts', (tester) async {
      await tester.runAsync(() async {
        await (FontLoader('IBMPlexSansArabic')..addFont(Future.value(ByteData.sublistView(File('assets/fonts/IBMPlexSansArabic-Regular.ttf').readAsBytesSync())))).load();
        await (FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(File(materialIconsFontPath).readAsBytesSync())))).load();
      });
      final ar = Platform.environment['KAYAN_ARABIC_COMPACT'] == '1';
      final api = _BatchApi()..secondLocation = true;
      await pump(tester, api, locale: Locale(ar ? 'ar' : 'en'));
      if (ar) { tester.view.physicalSize = const Size(700, 1100); await tester.pumpAndSettle(); }
      await tapText(tester, ar ? 'صرف' : 'Issue');
      await tester.enterText(find.widgetWithText(TextFormField, ar ? 'الكمية' : 'Quantity'), '5');
      await tester.tap(find.byType(SwitchListTile));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('issue-source-loc-1')), '2');
      await tester.enterText(find.byKey(const ValueKey('issue-source-loc-2')), '3');
      await tester.pumpAndSettle();
      final boundary = visualKey.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage();
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        await screenshotFile('batch-split-${ar ? 'ar' : 'desktop'}.png').writeAsBytes(data!.buffer.asUint8List());
        image.dispose();
      });
      expect(tester.takeException(), isNull);
    });

    testWidgets('atomic issue split must sum exactly and sends one multi-source call', (tester) async {
      final api = _BatchApi()..secondLocation = true;
      await pump(tester, api);
      await tapText(tester, 'Issue');
      await tester.enterText(find.widgetWithText(TextFormField, 'Quantity'), '5');
      await tester.tap(find.byType(SwitchListTile));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('issue-source-loc-1')), '2');
      await tester.enterText(find.byKey(const ValueKey('issue-source-loc-2')), '2');
      await tapText(tester, 'Issue');
      expect(api.posted, isEmpty);
      expect(find.textContaining('Source quantities must add up'), findsOneWidget);
      await tester.enterText(find.byKey(const ValueKey('issue-source-loc-2')), '3');
      await tapText(tester, 'Issue');
      expect(api.posted, hasLength(1));
      final body = api.posted.single.$2;
      expect(body.containsKey('storageLocationId'), isFalse);
      expect(body['locationAllocations'], [
        {'storageLocationId': 'loc-2', 'quantity': 3},
        {'storageLocationId': 'loc-1', 'quantity': 2},
      ]);
    });

    testWidgets('uncertain issue blocks duplicate submission and retains quantity', (tester) async {
      final api = _BatchApi(failPost: const NetworkFailure());
      await pump(tester, api);
      await tapText(tester, 'Issue');
      await tester.enterText(find.widgetWithText(TextFormField, 'Quantity'), '2');
      await tapText(tester, 'Issue');
      expect(find.textContaining('Could not confirm whether the stock movement completed.'), findsOneWidget);
      await tapText(tester, 'OK');
      final submit = find.descendant(of: find.byType(AlertDialog), matching: find.widgetWithText(FilledButton, 'Issue'));
      expect(tester.widget<FilledButton>(submit).onPressed, isNull);
      expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField, 'Quantity')).controller!.text, '2');
    });

    testWidgets('split refusal retains all source quantities and reason for correction', (tester) async {
      final api = _BatchApi(failPost: const ApiFailure('Source B-02 has only 1. Refresh balances and reduce B-02 or choose another source.', statusCode: 400))..secondLocation = true;
      await pump(tester, api);
      await tapText(tester, 'Issue');
      await tester.enterText(find.widgetWithText(TextFormField, 'Quantity'), '5');
      await tester.enterText(find.widgetWithText(TextFormField, 'Reason (optional)'), 'manual pick');
      await tester.tap(find.byType(SwitchListTile));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('issue-source-loc-1')), '2');
      await tester.enterText(find.byKey(const ValueKey('issue-source-loc-2')), '3');
      await tapText(tester, 'Issue');
      expect(find.textContaining('Refresh balances and reduce'), findsOneWidget);
      await tapText(tester, 'OK');
      for (final entry in {'loc-1': '2', 'loc-2': '3'}.entries) {
        expect(tester.widget<TextFormField>(find.byKey(ValueKey('issue-source-${entry.key}'))).controller!.text, entry.value);
      }
      expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField, 'Reason (optional)')).controller!.text, 'manual pick');
    });

    testWidgets(
      'receive refreshes locations created after an earlier empty dialog',
      (tester) async {
        final api = _BatchApi()..locationsAvailable = false;
        await pump(tester, api);
        await tapText(tester, 'Receive');
        await tapText(tester, 'Cancel');
        // Another screen creates the first location while this session stays open.
        api.locationsAvailable = true;
        await tapText(tester, 'Receive');
        await pickDropdownItem(
          tester,
          'Storage location (optional)',
          'A-01 • Aisle A shelf 1',
        );
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Quantity'),
          '1',
        );
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Unit cost'),
          '4.25',
        );
        await tapText(tester, 'Receive');
        expect(api.posted.single.$2['storageLocationId'], 'loc-1');
      },
    );

    testWidgets(
      'required batch number is collected rather than supplied outside the form',
      (tester) async {
        final api = _BatchApi()..requiresBatch = true;
        await pump(tester, api);
        await tapText(tester, 'Receive');
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Quantity'),
          '1',
        );
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Unit cost'),
          '4.25',
        );
        await tapText(tester, 'Receive');
        expect(api.posted, isEmpty);
        await tester.enterText(
          find.widgetWithText(TextFormField, 'Batch number'),
          'MANUAL-LOT-1',
        );
        await tapText(tester, 'Receive');
        expect(api.posted.single.$2['batchNumber'], 'MANUAL-LOT-1');
      },
    );

    testWidgets('receive collects cost, dates and the shelf', (tester) async {
      final api = _BatchApi();
      await pump(tester, api);

      await tapText(tester, 'Receive');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Quantity'),
        '10',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Unit cost'),
        '4.25',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Production date (optional)'),
        '2026-02-01',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Expiry date (optional)'),
        '2027-02-01',
      );
      await pickDropdownItem(
        tester,
        'Storage location (optional)',
        'A-01 • Aisle A shelf 1',
      );
      await tapText(tester, 'Receive');

      final (path, body) = api.posted.single;
      expect(path, '/inventory/batches/receive');
      expect(body['quantity'], 10);
      expect(body['unitCost'], 4.25);
      expect(body['productionDate'], '2026-02-01');
      expect(body['expiryDate'], '2027-02-01');
      expect(body['storageLocationId'], 'loc-1');
      expect(body['itemId'], 'item-1');
      // Every shelf lookup was narrowed to the warehouse receiving the goods.
      // The dialog also prefetches the full list for the lots that already
      // name a shelf, and that call carries no warehouse, so requiring every
      // query to be scoped would fail on a correct dialog. What matters is
      // that a scoped lookup happened and that no lookup asked for another
      // warehouse's shelves.
      final shelfWarehouses = api.shelfQueries
          .map((query) => query?['warehouseId'])
          .toList();
      expect(
        shelfWarehouses,
        contains('wh-1'),
        reason:
            'the dialog never asked the server for this warehouse\'s '
            'shelves, so the list could only have come from the prefetch',
      );
      expect(
        shelfWarehouses.whereType<String>().toSet(),
        {'wh-1'},
        reason:
            'offering another warehouse\'s shelf would let the operator '
            'pick one the server rejects',
      );
    });

    testWidgets('an empty quantity never reaches the server', (tester) async {
      final api = _BatchApi();
      await pump(tester, api);

      await tapText(tester, 'Issue');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Quantity'),
        '',
      );
      await tapText(tester, 'Issue');

      expect(api.posted, isEmpty);
    });

    testWidgets('a malformed date is caught in the form', (tester) async {
      final api = _BatchApi();
      await pump(tester, api);

      await tapText(tester, 'Receive');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Quantity'),
        '10',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Unit cost'),
        '1',
      );
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Expiry date (optional)'),
        '01/02/2027',
      );
      await tapText(tester, 'Receive');

      expect(api.posted, isEmpty);
      expect(find.text('Format YYYY-MM-DD'), findsOneWidget);
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Expiry date (optional)'),
        '2027-02-30',
      );
      await tapText(tester, 'Receive');
      expect(api.posted, isEmpty);
      expect(find.text('Invalid date'), findsOneWidget);
    });
  });

  group('after an operation', () {
    testWidgets('the list is refetched, so the new quantity shows', (
      tester,
    ) async {
      final api = _BatchApi();
      await pump(tester, api);
      final before = api.listCalls;
      expect(before, greaterThan(0));

      await tapText(tester, 'Issue');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Quantity'),
        '5',
      );
      await tapText(tester, 'Issue');

      expect(
        api.listCalls,
        greaterThan(before),
        reason: 'a stale table would show stock the server no longer holds',
      );
    });

    testWidgets('a server refusal is shown as the server worded it', (
      tester,
    ) async {
      final api = _BatchApi(
        failPost: const ApiFailure(
          'Not enough of lot LOT-A: 2.0000 left',
          statusCode: 400,
        ),
      );
      await pump(tester, api);

      await tapText(tester, 'Issue');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Quantity'),
        '99',
      );
      await tapText(tester, 'Issue');

      expect(
        find.textContaining('Not enough of lot LOT-A'),
        findsOneWidget,
        reason:
            'the refusal names the lot and the balance; a generic '
            '"something went wrong" would not',
      );
      expect(api.listCalls, isNot(0));
    });

    testWidgets(
      'server quantity error stays under quantity and clears on edit',
      (tester) async {
        final api = _BatchApi(
          failPost: const ApiFailure(
            'Validation failed',
            statusCode: 422,
            fieldErrors: {'quantity': 'Quantity exceeds the lot balance'},
          ),
        );
        await pump(tester, api);
        await tapText(tester, 'Issue');
        final qty = find.widgetWithText(TextFormField, 'Quantity');
        await tester.enterText(qty, '99');
        await tapText(tester, 'Issue');
        expect(find.text('Quantity exceeds the lot balance'), findsOneWidget);
        expect(
          tester.widget<TextFormField>(qty).forceErrorText,
          'Quantity exceeds the lot balance',
        );
        expect(find.byType(AlertDialog), findsOneWidget);
        await tester.enterText(qty, '2');
        await tester.pump();
        expect(find.text('Quantity exceeds the lot balance'), findsNothing);
      },
    );

    testWidgets('the dialog stays open while the call is in flight', (
      tester,
    ) async {
      final api = _BatchApi();
      await pump(tester, api);

      await tapText(tester, 'Issue');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Quantity'),
        '5',
      );
      await tester.tap(find.text('Issue').last);
      await tester.pump();

      // The form is still there between the tap and the answer; closing it
      // early is how a retry loses what the operator typed.
      expect(find.widgetWithText(TextFormField, 'Quantity'), findsOneWidget);
      await tester.pumpAndSettle();
    });
  });

  group('an emptied lot', () {
    testWidgets('offers no issue, transfer or write-off', (tester) async {
      await pump(tester, _BatchApi(lots: [_lot(remaining: '0.0000', days: 5)]));

      expect(find.text('Issue'), findsNothing);
      expect(find.text('Transfer'), findsNothing);
      expect(find.text('Write off'), findsNothing);
      // Receiving is still offered: it is the only operation that can put
      // stock back into the screen.
      expect(find.text('Receive'), findsOneWidget);
    });
  });
}
