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
          'nameEn': 'Cable',
          'nameAr': 'كابل',
          'unit': 'm',
        },
      ];
    }
    if (path == '/inventory/warehouses') {
      return [
        {'id': 'wh-1', 'code': 'MAIN', 'nameEn': 'Main store', 'nameAr': 'الرئيسي'},
        {'id': 'wh-2', 'code': 'SEC', 'nameEn': 'Second', 'nameAr': 'الثاني'},
      ];
    }
    if (path == '/inventory/locations') {
      shelfQueries.add(query);
      return [
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

  /// Taps a form field by its label to open its dropdown.
  ///
  /// The label is rendered inside the field's `InputDecorator`, so scoping the
  /// finder to the dialog keeps it away from the table header or any other
  /// text with the same word.
  Future<void> tapField(WidgetTester tester, String label) async {
    final finder = find
        .descendant(of: find.byType(AlertDialog), matching: find.text(label))
        .first;
    await tester.ensureVisible(finder);
    await tester.pumpAndSettle();
    await tester.tap(finder);
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
  }

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
            _lot(
              production: null,
              expiry: null,
              days: null,
              location: null,
            ),
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
        reason: 'production, expiry and location are body cells; the fourth '
            'dash is the small caption in the Days column',
      );
      expect(find.textContaining('null'), findsNothing);
    });

    testWidgets('Arabic reads the Arabic location name', (tester) async {
      await pump(
        tester,
        _BatchApi(),
        locale: const Locale('ar'),
      );
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

    testWidgets('transfer sends both warehouses', (tester) async {
      final api = _BatchApi();
      await pump(tester, api);

      await tapText(tester, 'Transfer');
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Quantity'),
        '3',
      );
      await pickDropdownItem(tester, 'To warehouse', 'SEC • Second');
      await tapText(tester, 'Transfer');

      final (path, body) = api.posted.single;
      expect(path, '/inventory/batches/transfer');
      expect(body['fromWarehouseId'], 'wh-1');
      expect(body['toWarehouseId'], 'wh-2');
      expect(body['batchId'], 'lot-1');
      expect(body['quantity'], 3);
    });

    testWidgets('a transfer to the same warehouse is refused before posting', (
      tester,
    ) async {
      final api = _BatchApi();
      await pump(tester, api);

      await tapText(tester, 'Transfer');
      // Choosing the source again must not reach the server, which would
      // answer with a validation error the operator can do nothing about.
      await pickDropdownItem(tester, 'From warehouse', 'MAIN • Main store');
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
      // The shelf list was narrowed to the warehouse receiving the goods: a
      // shelf from elsewhere would be refused by the server.
      expect(api.shelfQueries, isNotEmpty);
      expect(
        api.shelfQueries.every((query) => query?['warehouseId'] == 'wh-1'),
        isTrue,
        reason: 'offering another warehouse shelf would let the operator pick '
            'one the server rejects',
      );
    });

    testWidgets('an empty quantity never reaches the server', (tester) async {
      final api = _BatchApi();
      await pump(tester, api);

      await tapText(tester, 'Issue');
      await tester.enterText(find.widgetWithText(TextFormField, 'Quantity'), '');
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
        reason: 'the refusal names the lot and the balance; a generic '
            '"something went wrong" would not',
      );
      expect(api.listCalls, isNot(0));
    });

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
