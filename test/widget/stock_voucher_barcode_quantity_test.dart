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

/// Scanning a carton barcode.
///
/// The server answers `GET /inventory/items/by-barcode/:code` with both
/// `factor` and `quantityPerScan`, and for a carton of 24 both are `24.000000`.
/// They are not "the number to type into the quantity box": the quantity box is
/// in the unit the operator picked, and document creation multiplies it by that
/// unit's factor to get base units. Putting 24 in the box while the unit says
/// carton would post 24 x 24 = 576 pieces.
///
/// The correct arithmetic is therefore:
///
///   one scan  ->  quantity (in the scanned unit) += 1
///   base units posted = quantity x factor
///
/// These tests assert the body that would be sent to the server, because that
/// is the number the database ends up holding. Checking that the unit dropdown
/// says "carton" - which is all the existing scan test checked - proves nothing
/// about the quantity.
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
    ],
  );

  /// A warehouse whose carton unit holds 24 base pieces.
  Widget harness(_ScanApi api) {
    return ProviderScope(
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
        home: const StockVoucherCreateScreen(kind: 'ISSUE'),
      ),
    );
  }

  Future<void> sizeView(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1600, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  }

  Finder scanField() =>
      find.widgetWithText(TextFormField, 'Scan item or unit barcode');

  Finder quantityField() =>
      find.widgetWithText(TextFormField, 'Quantity in selected unit');

  /// Scans a code and waits for the lookup to settle.
  Future<void> scan(WidgetTester tester, String code) async {
    await tester.enterText(scanField(), code);
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
  }

  /// The line body the screen would post to the server.
  Map<String, dynamic> firstLine(_ScanApi api) {
    expect(api.postedBodies, isNotEmpty,
        reason: 'the document was never submitted');
    final body = api.postedBodies.last;
    final lines = body['lines'];
    expect(lines, isA<List>());
    return Map<String, dynamic>.from((lines as List).first as Map);
  }

  /// Base units the server would store: quantity x the scanned unit's factor.
  num baseUnits(Map<String, dynamic> line) {
    final quantity = num.parse('${line['quantity']}');
    final unit = line['unitName'];
    final factor = unit == null ? 1 : _factorOf(unit as String);
    return quantity * factor;
  }

  group('scanning a carton barcode', () {
    testWidgets('one scan adds one carton, which posts 24 base units',
        (tester) async {
      await sizeView(tester);
      SharedPreferences.setMockInitialValues({});
      final api = _ScanApi();
      await tester.pumpWidget(harness(api));
      await tester.pumpAndSettle();

      await scan(tester, 'CARTON-24');

      // The looked-up unit is a carton of 24.
      expect(find.text('carton'), findsWidgets,
          reason: 'the scan must select the unit the label belongs to');

      await tester.tap(find.text('Save draft').last);
      await tester.pumpAndSettle();

      final line = firstLine(api);
      expect(line['unitName'], 'carton');
      expect(
        num.parse('${line['quantity']}'),
        1,
        reason: 'one scan is one carton. Typing 24 here would be multiplied by '
            'the factor again and post 576 pieces.',
      );
      expect(baseUnits(line), 24,
          reason: '24 pieces is what the shelf and the ledger must show');
    });

    testWidgets('two scans add two cartons, which post 48 base units',
        (tester) async {
      await sizeView(tester);
      SharedPreferences.setMockInitialValues({});
      final api = _ScanApi();
      await tester.pumpWidget(harness(api));
      await tester.pumpAndSettle();

      await scan(tester, 'CARTON-24');
      // A repeat scan of the same label is only collapsed inside a short
      // window; this one is a deliberate second carton.
      await tester.pump(const Duration(milliseconds: 900));
      await scan(tester, 'CARTON-24');

      await tester.tap(find.text('Save draft').last);
      await tester.pumpAndSettle();

      final line = firstLine(api);
      expect(line['unitName'], 'carton');
      expect(num.parse('${line['quantity']}'), 2);
      expect(baseUnits(line), 48);
    });

    testWidgets('three cartons typed by hand post 72 base units',
        (tester) async {
      await sizeView(tester);
      SharedPreferences.setMockInitialValues({});
      final api = _ScanApi();
      await tester.pumpWidget(harness(api));
      await tester.pumpAndSettle();

      await scan(tester, 'CARTON-24');
      await tester.enterText(quantityField(), '3');
      await tester.pumpAndSettle();

      await tester.tap(find.text('Save draft').last);
      await tester.pumpAndSettle();

      final line = firstLine(api);
      expect(line['unitName'], 'carton');
      expect(num.parse('${line['quantity']}'), 3);
      expect(baseUnits(line), 72);
    });

    testWidgets('a base-unit barcode adds exactly one piece', (tester) async {
      await sizeView(tester);
      SharedPreferences.setMockInitialValues({});
      final api = _ScanApi();
      await tester.pumpWidget(harness(api));
      await tester.pumpAndSettle();

      await scan(tester, 'PIECE-1');

      await tester.tap(find.text('Save draft').last);
      await tester.pumpAndSettle();

      final line = firstLine(api);
      expect(num.parse('${line['quantity']}'), 1);
      expect(baseUnits(line), 1);
    });

    testWidgets('an unknown barcode changes neither the item nor the quantity',
        (tester) async {
      await sizeView(tester);
      SharedPreferences.setMockInitialValues({});
      final api = _ScanApi();
      await tester.pumpWidget(harness(api));
      await tester.pumpAndSettle();

      await scan(tester, 'CARTON-24');
      await tester.enterText(quantityField(), '2');
      await tester.pumpAndSettle();

      await scan(tester, 'NO-SUCH-CODE');

      // The failed lookup must leave the line exactly as it was.
      expect(find.text('carton'), findsWidgets);
      final field = tester.widget<TextFormField>(quantityField());
      expect(field.controller?.text, '2',
          reason: 'a barcode nobody knows must not change the quantity');

      await tester.tap(find.text('Save draft').last);
      await tester.pumpAndSettle();

      final line = firstLine(api);
      expect(line['unitName'], 'carton');
      expect(num.parse('${line['quantity']}'), 2);
      expect(baseUnits(line), 48);
    });

    testWidgets('switching the unit by hand does not convert twice',
        (tester) async {
      await sizeView(tester);
      SharedPreferences.setMockInitialValues({});
      final api = _ScanApi();
      await tester.pumpWidget(harness(api));
      await tester.pumpAndSettle();

      await scan(tester, 'CARTON-24');
      await tester.enterText(quantityField(), '2');
      await tester.pumpAndSettle();

      // Change the unit to the base one. The number the operator typed is in
      // the unit they picked, so the stored base quantity must follow the new
      // unit without the UI pre-multiplying anything.
      await tester.tap(find.byType(DropdownButtonFormField<String>).last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('piece').last);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Save draft').last);
      await tester.pumpAndSettle();

      final line = firstLine(api);
      expect(line['unitName'], 'piece');
      expect(num.parse('${line['quantity']}'), 2);
      expect(
        baseUnits(line),
        2,
        reason: 'two pieces is two base units. A screen that had already '
            'multiplied by 24 would send 48 here.',
      );
    });
  });
}

/// The factor of a unit in the fixture below.
num _factorOf(String unit) => unit == 'carton' ? 24 : 1;

class _ScanApi extends ApiClient {
  _ScanApi()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  final postedBodies = <Map<String, dynamic>>[];

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
      {'unit': 'carton', 'factor': '24', 'barcode': 'CARTON-24', 'isActive': true},
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
    if (path == '/accounting/cost-centers') return [];
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
      postedBodies.add(Map<String, dynamic>.from(body! as Map));
      return {'id': 'document-1'};
    }
    return {'id': 'document-1'};
  }
}
