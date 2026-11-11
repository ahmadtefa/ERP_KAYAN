import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_vouchers_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_harness.dart';

/// Scanning a carton barcode - what the screen sends to the server.
///
/// The server answers `GET /inventory/items/by-barcode/:code` with `factor` and
/// `quantityPerScan`, and for a carton of 24 both read `24.000000`. Neither is
/// "the number to type into the quantity box". The box is in the unit the
/// operator picked, and document creation multiplies it by that unit's factor
/// to reach base units. Putting 24 in the box while the unit says carton posts
/// 24 x 24 = 576 pieces.
///
/// So: one scan adds **one of the scanned unit**, and the base quantity is
/// quantity x factor. These tests assert the body that would be posted, because
/// that is the number the database ends up holding. Asserting only that the unit
/// dropdown says "carton" - all the existing scan test checked - says nothing
/// about the quantity.
///
/// This file covers the screen. The arithmetic that survives into the database
/// is proven separately, against a real PostgreSQL engine, in
/// `backend/src/modules/inventory/stock-documents.barcode-posting.spec.ts`.
void main() {
  const user = AppUser(
    id: 'u1',
    username: 'operator',
    fullName: 'Operator',
    companyId: 'c1',
    branchId: 'b1',
    permissions: [
      'inventory.stock.read',
      'inventory.stock.manage',
      'inventory.warehouses.read',
      // An ISSUE voucher refuses to save without a cost centre, and the screen
      // only loads them for a user who may read them. Without this the form
      // stops at the validator and never reaches the quantity.
      'accounting.costcenters.read',
    ],
  );

  Widget harness(_ScanApi api) => ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(api),
      currentUserProvider.overrideWithValue(user),
      appConfigProvider.overrideWithValue(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
      ),
    ],
    child: MaterialApp(
      locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      // The screen is pushed, not used as `home`. A successful save pops it,
      // and popping the only route leaves the navigator with nothing to show -
      // a failure that has nothing to do with quantities. This is also the
      // shape the existing passing voucher test uses for its save path.
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.of(context).push<String>(
              MaterialPageRoute(
                builder: (_) => const StockVoucherCreateScreen(kind: 'ISSUE'),
              ),
            ),
            child: const Text('Open voucher'),
          ),
        ),
      ),
    ),
  );

  Future<void> open(WidgetTester tester) async {
    await tester.tap(find.text('Open voucher'));
    await tester.pumpAndSettle();
  }

  Future<void> sizeView(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1600, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }

  Finder scanField() =>
      find.widgetWithText(TextFormField, 'Scan item or unit barcode');

  Finder quantityField() =>
      find.widgetWithText(TextFormField, 'Quantity in selected unit');

  /// The unit dropdown's currently selected value, read from the widget rather
  /// than from loose text on the screen. `find.text('carton')` also matches the
  /// closed dropdown's menu items, so it can pass while nothing is selected.
  String? selectedUnit(WidgetTester tester) {
    final field = tester.widget<DropdownButtonFormField<String>>(
      find.byType(DropdownButtonFormField<String>).last,
    );
    return field.initialValue;
  }

  /// Fills the header the form refuses to save without: a warehouse, a
  /// counterparty and a reason. These have nothing to do with barcodes, but
  /// leaving them empty stops `_save` at the validator, so a test that skipped
  /// them would fail before it ever looked at a quantity.
  Future<void> fillHeader(WidgetTester tester, {bool needsCenter = true}) async {
    await tester.ensureVisible(find.text('Warehouse').first);
    await tester.tap(find.text('Warehouse').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('WH • Main').last);
    await tester.pumpAndSettle();
    if (needsCenter) {
      await tester.ensureVisible(find.text('Cost center (required)'));
      await tester.tap(find.text('Cost center (required)'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('CC • Cost center').last);
      await tester.pumpAndSettle();
    }
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Counterparty'),
      'Warehouse floor',
    );
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Reason'),
      'Carton scan',
    );
    await tester.pumpAndSettle();
  }

  Future<void> scan(WidgetTester tester, String code) async {
    await tester.enterText(scanField(), code);
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
    // A rejected barcode answers with a modal that never dismisses itself; it
    // would swallow every later tap instead of letting the test continue.
    if (find.text('OK').evaluate().isNotEmpty) {
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
    }
  }

  /// Presses Save draft. The button sits at the bottom of a scrollable form, so
  /// it has to be brought into view first - tapping it blind is what made the
  /// first version of this file fail for reasons that had nothing to do with
  /// quantities.
  Future<void> save(WidgetTester tester) async {
    await tester.ensureVisible(find.text('Save draft'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Save draft'));
    await tester.pumpAndSettle();
  }

  Map<String, dynamic> singleLine(_ScanApi api) {
    expect(api.posted, isNotEmpty, reason: 'the document was never submitted');
    final lines = api.posted.last['lines'];
    expect(lines, isA<List>());
    expect((lines as List), hasLength(1));
    return Map<String, dynamic>.from(lines.first as Map);
  }

  /// The number currently in the quantity box.
  ///
  /// A scan that selects the unit but leaves this empty is stopped by the form
  /// validator, so nothing is ever posted and the failure would surface as
  /// "the document was never submitted" - true, but it hides the cause.
  String? quantityText(WidgetTester tester) =>
      tester.widget<TextFormField>(quantityField()).controller?.text;

  /// What the server stores: the quantity in the chosen unit, times its factor.
  ///
  /// An issue voucher negates the quantity on the way out, because the screen
  /// sends one signed number for both directions. The conversion is about
  /// magnitude, so the sign is stripped here and asserted once, separately.
  num unitQuantity(Map<String, dynamic> line) =>
      num.parse('${line['quantity']}').abs();

  num baseUnits(Map<String, dynamic> line) =>
      unitQuantity(line) * _factorOf('${line['unitName']}');

  group('scanning a carton barcode', () {
    testWidgets('one scan adds one carton, which posts 24 base units',
        (tester) async {
      await sizeView(tester);
      SharedPreferences.setMockInitialValues({});
      final api = _ScanApi();
      await tester.pumpWidget(harness(api));
      await tester.pumpAndSettle();
      await open(tester);
      await fillHeader(tester);

      await scan(tester, 'CARTON-24');

      expect(selectedUnit(tester), 'carton',
          reason: 'the scan must select the unit the label belongs to');
      expect(quantityText(tester), '1',
          reason: 'one scan is one carton, so the box must read 1. Reading 24 '
              'here is the defect: the server multiplies by the factor again '
              'and stores 576 pieces.');
      expect(find.text('1 carton = 24 piece'), findsOneWidget,
          reason: 'the operator must be able to read the base equivalent '
              'without leaving the line');

      await save(tester);

      final line = singleLine(api);
      expect(line['unitName'], 'carton');
      expect(unitQuantity(line), 1,
          reason: 'one scan is one carton. Typing 24 here would be multiplied '
              'by the factor a second time and post 576 pieces.');
      expect(baseUnits(line), 24);
    });

    testWidgets('two scans add two cartons, which post 48 base units',
        (tester) async {
      await sizeView(tester);
      SharedPreferences.setMockInitialValues({});
      final api = _ScanApi();
      await tester.pumpWidget(harness(api));
      await tester.pumpAndSettle();
      await open(tester);
      await fillHeader(tester);

      await scan(tester, 'CARTON-24');
      // A repeat inside the guard window is collapsed on purpose; this one is a
      // deliberate second carton and must accumulate.
      //
      // The guard compares DateTime.now(), which runs on the wall clock. A
      // `pump(Duration)` advances only the test's fake clock, so the screen
      // would still see the two scans as milliseconds apart and swallow the
      // second one - the test would then fail for a reason that does not exist
      // in a warehouse. runAsync is the part that lets real time pass.
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 850)),
      );
      await tester.pumpAndSettle();
      await scan(tester, 'CARTON-24');

      expect(quantityText(tester), '2',
          reason: 'a second deliberate scan adds a second carton');
      expect(find.text('2 carton = 48 piece'), findsOneWidget,
          reason: 'the equivalent must follow the quantity, not stay at 24');

      await save(tester);

      final line = singleLine(api);
      expect(line['unitName'], 'carton');
      expect(unitQuantity(line), 2);
      expect(baseUnits(line), 48);
    });

    testWidgets('three cartons typed by hand post 72 base units',
        (tester) async {
      await sizeView(tester);
      SharedPreferences.setMockInitialValues({});
      final api = _ScanApi();
      await tester.pumpWidget(harness(api));
      await tester.pumpAndSettle();
      await open(tester);
      await fillHeader(tester);

      await scan(tester, 'CARTON-24');
      await tester.enterText(quantityField(), '3');
      await tester.pumpAndSettle();

      await save(tester);

      final line = singleLine(api);
      expect(line['unitName'], 'carton');
      expect(unitQuantity(line), 3);
      expect(baseUnits(line), 72);
    });

    testWidgets('a base-unit barcode adds exactly one piece', (tester) async {
      await sizeView(tester);
      SharedPreferences.setMockInitialValues({});
      final api = _ScanApi();
      await tester.pumpWidget(harness(api));
      await tester.pumpAndSettle();
      await open(tester);
      await fillHeader(tester);

      await scan(tester, 'PIECE-1');

      expect(quantityText(tester), '1',
          reason: 'a factor-1 barcode adds one piece, not its factor');

      await save(tester);

      final line = singleLine(api);
      expect(unitQuantity(line), 1);
      expect(baseUnits(line), 1);
    });

    testWidgets('an unknown barcode changes neither the item nor the quantity',
        (tester) async {
      await sizeView(tester);
      SharedPreferences.setMockInitialValues({});
      final api = _ScanApi();
      await tester.pumpWidget(harness(api));
      await tester.pumpAndSettle();
      await open(tester);
      await fillHeader(tester);

      await scan(tester, 'CARTON-24');
      await tester.enterText(quantityField(), '2');
      await tester.pumpAndSettle();

      await scan(tester, 'NO-SUCH-CODE');

      expect(selectedUnit(tester), 'carton');
      expect(tester.widget<TextFormField>(quantityField()).controller?.text, '2',
          reason: 'a barcode nobody knows must not change the quantity');

      await save(tester);

      final line = singleLine(api);
      expect(line['unitName'], 'carton');
      expect(unitQuantity(line), 2);
      expect(baseUnits(line), 48);
    });

    testWidgets('switching the unit by hand does not convert twice',
        (tester) async {
      await sizeView(tester);
      SharedPreferences.setMockInitialValues({});
      final api = _ScanApi();
      await tester.pumpWidget(harness(api));
      await tester.pumpAndSettle();
      await open(tester);
      await fillHeader(tester);

      await scan(tester, 'CARTON-24');
      await tester.enterText(quantityField(), '2');
      await tester.pumpAndSettle();

      // The dropdown opens from its own label, which is how the existing
      // passing voucher test drives it. Tapping the byType widget lands on its
      // centre and does not reliably hit the clickable area.
      await tester.ensureVisible(find.text('Unit (base by default)'));
      await tester.tap(find.text('Unit (base by default)'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('piece').last);
      await tester.pumpAndSettle();

      expect(selectedUnit(tester), 'piece');
      expect(find.textContaining('carton ='), findsNothing,
          reason: 'the line is no longer in cartons, so a carton equivalent '
              'would be describing something the operator did not choose');

      await save(tester);

      final line = singleLine(api);
      expect(line['unitName'], 'piece');
      expect(unitQuantity(line), 2);
      expect(baseUnits(line), 2,
          reason: 'two pieces is two base units. A screen that had already '
              'multiplied by 24 would send 48 here.');
    });
  });
}

/// The factor each fixture unit carries.
num _factorOf(String unit) => unit == 'carton' ? 24 : 1;

class _ScanApi extends ApiClient {
  _ScanApi()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  final posted = <Map<String, dynamic>>[];

  static final _item = {
    'id': 'item-1',
    'code': 'IT-1',
    'nameEn': 'Widget',
    'nameAr': 'قطعة',
    'unit': 'piece',
    'salePrice': '10',
    'purchasePrice': '5',
    'units': [
      {'unit': 'piece', 'factor': '1', 'barcode': 'PIECE-1', 'isActive': true},
      {
        'unit': 'carton',
        'factor': '24',
        'barcode': 'CARTON-24',
        'isActive': true,
      },
    ],
  };

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/warehouses') {
      return [
        {'id': 'wh-1', 'code': 'WH', 'nameEn': 'Main', 'nameAr': 'رئيسي'},
      ];
    }
    if (path == '/accounting/cost-centers') {
      return [{'id': 'cc-1', 'code': 'CC', 'nameEn': 'Cost center'}];
    }
    if (path == '/inventory/items') return [_item];
    return [];
  }

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path.startsWith('/inventory/items/by-barcode/')) {
      final code = path.split('/').last;
      if (code == 'CARTON-24') {
        return {
          'matched': 'unit',
          'unit': 'carton',
          'factor': '24.000000',
          'quantityPerScan': '24.000000',
          'item': _item,
        };
      }
      if (code == 'PIECE-1') {
        return {
          'matched': 'item',
          'unit': 'piece',
          'factor': '1.000000',
          'quantityPerScan': '1.000000',
          'item': _item,
        };
      }
      throw const ApiFailure(
        'No item or unit carries that barcode',
        statusCode: 404,
      );
    }
    return {};
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    if (path == '/inventory/stock-documents') {
      posted.add(Map<String, dynamic>.from(body! as Map));
      return {'id': 'document-1'};
    }
    return {'id': 'document-1'};
  }
}
