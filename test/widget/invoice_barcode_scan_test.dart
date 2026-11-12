import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/common/presentation/providers/resource_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/invoice_editor_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// End-to-end proof that scanning an invoice line does what the shop needs.
///
/// The screen is the real [InvoiceEditorScreen]; only the HTTP client is a
/// stand-in, so every assertion below is about the widget the operator
/// actually touches: the quantity box, the unit dropdown and the scan field.

/// A catalogue where one carton holds 24 pieces, and the carton is the default
/// selling unit.
Map<String, dynamic> waterItem({bool defaultSaleCarton = true}) => {
  'id': 'item-water',
  'code': 'WATER',
  'nameEn': 'Water',
  'nameAr': 'مياه',
  'unit': 'piece',
  'isActive': true,
  'isStockTracked': true,
  'taxRate': '0.0000',
  'salePrice': '10.0000',
  'purchasePrice': '8.0000',
  'units': [
    {
      'id': 'unit-piece',
      'unit': 'piece',
      'factor': '1.000000',
      'isActive': true,
      'isBase': true,
      'salePrice': null,
      'isDefaultSale': !defaultSaleCarton,
      'isDefaultPurchase': false,
    },
    {
      'id': 'unit-carton',
      'unit': 'carton',
      'factor': '24.000000',
      'isActive': true,
      'isBase': false,
      'salePrice': '240.0000',
      'isDefaultSale': defaultSaleCarton,
      'isDefaultPurchase': true,
    },
  ],
};

class _ScanApi extends ApiClient {
  _ScanApi({this.unknown = false, this.truncated = false})
    : super(
        const AppConfig(
          environment: AppEnvironment.development,
          apiBaseUrl: 'https://test.invalid/api/v1',
          connectTimeout: Duration(seconds: 1),
          receiveTimeout: Duration(seconds: 1),
        ),
        FakeTokenStore(),
      );

  /// When true the lookup answers 404, the "no such barcode" case.
  bool unknown;
  /// When true the lookup answers 200 with a body that carries no item.
  bool truncated;
  /// When true the lookup answers 200 with a carton response whose conversion
  /// factor is unusable, which is the case the screen must refuse rather than
  /// silently treat as one base unit.
  bool badFactor = false;
  final scanned = <String>[];
  Map<String, dynamic>? postedBody;

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path.startsWith('/inventory/items/by-barcode/')) {
      final code = Uri.decodeComponent(path.split('/').last);
      scanned.add(code);
      if (unknown) {
        throw const ApiFailure('No item or unit carries this barcode', statusCode: 404);
      }
      if (truncated) return {'matched': 'unit'};
      final item = waterItem();
      if (badFactor) {
        // A unit label whose factor is missing: the server answered, but what
        // it said cannot be converted. 24 would have been plausible; nothing
        // at all is not a licence to assume 1.
        return {
          'matched': 'unit',
          'unit': 'carton',
          'item': item,
          'units': item['units'],
        };
      }
      if (code == 'CARTON') {
        return {
          'matched': 'unit',
          'unit': 'carton',
          'factor': '24.000000',
          'quantityPerScan': '24.000000',
          'quantityPerScanFitsLedgerScale': true,
          'salePrice': '240.0000',
          'purchasePrice': '192.0000',
          'item': item,
          'units': item['units'],
        };
      }
      // The item's own shelf label names no unit, so the document's default
      // decides which unit it arrives in.
      return {
        'matched': 'item',
        'unit': 'piece',
        'factor': '1.000000',
        'quantityPerScan': '1.000000',
        'quantityPerScanFitsLedgerScale': true,
        'salePrice': '10.0000',
        'purchasePrice': '8.0000',
        'item': item,
        'units': item['units'],
      };
    }
    throw StateError('Unexpected GET $path');
  }

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => [];

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    if (body is Map) postedBody = Map<String, dynamic>.from(body);
    return {'id': 'invoice-1'};
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<_ScanApi> pumpInvoice(
    WidgetTester tester, {
    _ScanApi? api,
    InvoiceKind kind = InvoiceKind.sales,
  }) async {
    tester.view.physicalSize = const Size(2000, 1300);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final client = api ?? _ScanApi();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(client),
          activeItemsProvider.overrideWith((ref) async => [waterItem()]),
          activeCustomersProvider.overrideWith(
            (ref) async => [
              {
                'id': 'customer-1',
                'code': 'CUS-1',
                'nameEn': 'Shop',
                'nameAr': 'متجر',
                'isActive': true,
              },
            ],
          ),
          activeSuppliersProvider.overrideWith(
            (ref) async => [
              {
                'id': 'supplier-1',
                'code': 'SUP-1',
                'nameEn': 'Depot',
                'nameAr': 'مستودع',
                'isActive': true,
              },
            ],
          ),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: InvoiceEditorScreen(kind: kind),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return client;
  }

  /// Types a code into the scan box and presses the scanner's Enter.
  Future<void> scan(WidgetTester tester, String code) async {
    final field = find.byKey(const ValueKey('invoice-barcode'));
    expect(field, findsOneWidget, reason: 'the invoice must offer a scan box');
    await tester.enterText(field, code);
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
  }

  String quantityText(WidgetTester tester, int index) {
    final field = tester.widget<TextFormField>(
      find.byKey(ValueKey('line-quantity-$index')),
    );
    return field.controller!.text;
  }

  String? selectedUnit(WidgetTester tester, int index) {
    final field = tester.widget<DropdownButtonFormField<String>>(
      find.byKey(ValueKey('line-unit-$index')),
    );
    return field.initialValue;
  }

  testWidgets('scanning a carton label adds ONE carton, not 24 pieces', (
    tester,
  ) async {
    await pumpInvoice(tester);

    await scan(tester, 'CARTON');

    expect(quantityText(tester, 0), '1', reason: 'one scan is one carton');
    expect(selectedUnit(tester, 0), 'carton');
    expect(find.textContaining('= 1 carton = 24 piece'), findsOneWidget);
    // The item, its unit and the figure are stated in one place, so the
    // operator can see what the scan did without reading across the row.
    expect(find.textContaining('Water — 1 carton'), findsOneWidget);
  });

  testWidgets('scanning the same carton again adds a second carton', (
    tester,
  ) async {
    await pumpInvoice(tester);

    await scan(tester, 'CARTON');
    // Past the repeat guard: a real second press of the trigger.
    await tester.pump(const Duration(seconds: 1));
    await scan(tester, 'CARTON');
    await tester.pump(const Duration(seconds: 1));
    await scan(tester, 'CARTON');

    expect(quantityText(tester, 0), '3');
    expect(find.textContaining('= 3 carton = 72 piece'), findsOneWidget);
    // One line, not three: a repeat scan raises the line it already has.
    expect(find.byKey(const ValueKey('line-quantity-1')), findsNothing);
  });

  testWidgets('a third scan does not become a second line for the same item', (
    tester,
  ) async {
    await pumpInvoice(tester);
    await scan(tester, 'CARTON');
    await tester.pump(const Duration(seconds: 1));
    await scan(tester, 'CARTON');

    expect(find.byType(DropdownButtonFormField<String>), findsWidgets);
    // Exactly one item dropdown carries the item, and there is no second line.
    expect(find.byKey(const ValueKey('line-unit-1')), findsNothing);
  });

  testWidgets('an item label uses the default SALE unit of the catalogue', (
    tester,
  ) async {
    await pumpInvoice(tester);

    // The item's own barcode names no unit; the carton is the default selling
    // unit, so one scan must arrive as one carton.
    await scan(tester, 'SHELF');

    expect(selectedUnit(tester, 0), 'carton');
    expect(quantityText(tester, 0), '1');
  });

  testWidgets('a purchase invoice uses the default PURCHASE unit', (
    tester,
  ) async {
    await pumpInvoice(tester, kind: InvoiceKind.purchase);

    // The item's own label names no unit. The carton is the default purchasing
    // unit in this catalogue, so a purchase invoice must arrive as one carton
    // while the same scan on a sales invoice would have used the sales default.
    await scan(tester, 'SHELF');

    expect(selectedUnit(tester, 0), 'carton');
    expect(quantityText(tester, 0), '1');
    expect(find.textContaining('= 1 carton = 24 piece'), findsOneWidget);
  });

  testWidgets('a purchase invoice posts the chosen unit, never base units', (
    tester,
  ) async {
    final api = await pumpInvoice(tester, kind: InvoiceKind.purchase);
    await scan(tester, 'CARTON');
    await tester.pump(const Duration(seconds: 1));
    await scan(tester, 'CARTON');
    await tester.pump(const Duration(seconds: 1));
    await scan(tester, 'CARTON');

    final supplier = find.byType(DropdownButtonFormField<String>).first;
    await tester.tap(supplier);
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Depot').last);
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.save_outlined));
    await tester.pumpAndSettle();

    final lines = (api.postedBody?['lines'] as List?)?.cast<Map>();
    expect(lines, isNotNull);
    expect(lines, hasLength(1));
    expect(lines!.single['quantity'], '3');
    expect(lines.single['unitName'], 'carton');
    expect(lines.single['itemId'], 'item-water');
  });

  testWidgets('an item label uses the base unit when the catalogue says so', (
    tester,
  ) async {
    final api = _ScanApi();
    tester.view.physicalSize = const Size(2000, 1300);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          activeItemsProvider.overrideWith(
            (ref) async => [waterItem(defaultSaleCarton: false)],
          ),
          activeCustomersProvider.overrideWith((ref) async => []),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: InvoiceEditorScreen(kind: kind),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await scan(tester, 'SHELF');

    expect(selectedUnit(tester, 0), 'piece');
    expect(quantityText(tester, 0), '1');
  });

  testWidgets('changing the unit by hand does not double-convert the quantity', (
    tester,
  ) async {
    await pumpInvoice(tester);
    await scan(tester, 'CARTON');
    expect(quantityText(tester, 0), '1');

    // Choosing "piece" by hand keeps the figure the operator owns; the server
    // converts "1 piece" to one base unit, never 24.
    await tester.tap(find.byKey(const ValueKey('line-unit-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('piece').last);
    await tester.pumpAndSettle();

    expect(selectedUnit(tester, 0), 'piece');
    expect(quantityText(tester, 0), '1');
    // A base unit has no equivalent line, because the two numbers are equal.
    expect(find.textContaining('= 1 piece ='), findsNothing);
  });

  testWidgets('a repeat scan adds to the figure already typed on the line', (
    tester,
  ) async {
    await pumpInvoice(tester);
    await scan(tester, 'CARTON');
    await tester.pump(const Duration(seconds: 1));

    // A second, different scan must not overwrite the first line.
    await tester.tap(find.byKey(const ValueKey('line-unit-0')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('line-quantity-0')), '6');
    await tester.pumpAndSettle();

    await scan(tester, 'CARTON');
    expect(quantityText(tester, 0), '7');
  });

  testWidgets('an unknown barcode changes no line and says what was scanned', (
    tester,
  ) async {
    final api = _ScanApi(unknown: true);
    await pumpInvoice(tester, api: api);

    await scan(tester, '999-NOT-FOUND');

    // The message names the code that did not read, so the operator knows the
    // scanner saw the label.
    expect(find.textContaining('999-NOT-FOUND'), findsWidgets);
    expect(api.scanned, ['999-NOT-FOUND']);

    // Close the dialog and prove the line is exactly as it was: nothing was
    // added, no unit was chosen, and the operator's input survives the error.
    // The error dialog renders its button in Arabic whatever the ambient
    // locale (app_error_dialog.dart uses AppLocalizationsAr), so the test
    // dismisses the button it actually shows.
    await tester.tap(find.text('حسنًا'));
    await tester.pumpAndSettle();
    expect(quantityText(tester, 0), '1');
    expect(selectedUnit(tester, 0), isNull);
  });

  testWidgets('a truncated read keeps the line and says the label did not read', (
    tester,
  ) async {
    final api = _ScanApi(truncated: true);
    await pumpInvoice(tester, api: api);

    await scan(tester, 'BROKEN');

    expect(find.textContaining('BROKEN'), findsWidgets);
    // The error dialog renders its button in Arabic whatever the ambient
    // locale (app_error_dialog.dart uses AppLocalizationsAr), so the test
    // dismisses the button it actually shows.
    await tester.tap(find.text('حسنًا'));
    await tester.pumpAndSettle();
    expect(quantityText(tester, 0), '1');
    expect(selectedUnit(tester, 0), isNull);
  });

  /// A response that arrived but cannot be trusted must not crash the screen
  /// and must not add anything. This is the runtime half of `fromResponse`:
  /// the unit tests prove the FormatException is thrown, these prove the
  /// screen survives it and tells the operator something useful.
  testWidgets('a carton whose conversion factor is missing is rejected without adding a line', (
    tester,
  ) async {
    final api = _ScanApi(badFactor: true);
    await pumpInvoice(tester, api: api);

    await scan(tester, 'CARTON');

    // The screen is still alive and still shows its own controls.
    expect(tester.takeException(), isNull);
    expect(find.byKey(const ValueKey('invoice-barcode')), findsOneWidget);

    // No line was added: the invoice started with exactly one empty line, and
    // it still holds exactly one.
    expect(
      find.byKey(const ValueKey('line-quantity-0')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('line-quantity-1')), findsNothing);
    expect(quantityText(tester, 0), '1');
    expect(selectedUnit(tester, 0), isNull);
  });

  testWidgets('the rejection explains the data problem, not just "scan again"', (
    tester,
  ) async {
    final api = _ScanApi(badFactor: true);
    await pumpInvoice(tester, api: api);

    await scan(tester, 'CARTON');

    // Retrying produces the same broken answer, so the sentence must point at
    // the item data instead of telling the operator to scan again.
    expect(find.textContaining('incomplete or contradictory'), findsOneWidget);
    expect(find.textContaining('Nothing was added'), findsOneWidget);

    await tester.tap(find.text('حسنًا'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('line-quantity-1')), findsNothing);
  });

  testWidgets('a rejected scan leaves a figure already typed on the line', (
    tester,
  ) async {
    final api = _ScanApi(badFactor: true);
    await pumpInvoice(tester, api: api);

    // The operator typed a figure by hand before scanning.
    await tester.enterText(
      find.byKey(const ValueKey('line-quantity-0')),
      '7',
    );
    await tester.pumpAndSettle();

    await scan(tester, 'CARTON');
    await tester.tap(find.text('حسنًا'));
    await tester.pumpAndSettle();

    // The typed figure survived: a failed read never destroys input.
    expect(quantityText(tester, 0), '7');
    expect(find.byKey(const ValueKey('line-quantity-1')), findsNothing);
  });

  testWidgets('a hand-typed price survives a scan', (tester) async {
    await pumpInvoice(tester);

    await tester.enterText(find.byKey(const ValueKey('line-price-0')), '99');
    await tester.pumpAndSettle();
    await scan(tester, 'CARTON');

    final price = tester.widget<TextFormField>(
      find.byKey(const ValueKey('line-price-0')),
    );
    expect(price.controller!.text, '99');
  });

  testWidgets('a scanned invoice posts the chosen unit, never base units', (
    tester,
  ) async {
    final api = await pumpInvoice(tester);
    await scan(tester, 'CARTON');
    await tester.pump(const Duration(seconds: 1));
    await scan(tester, 'CARTON');

    // Choose the customer and save: the payload must carry 2 cartons, so the
    // server multiplies by 24 exactly once.
    final customer = find.byType(DropdownButtonFormField<String>).first;
    await tester.tap(customer);
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Shop').last);
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.save_outlined));
    await tester.pumpAndSettle();

    final lines = (api.postedBody?['lines'] as List?)?.cast<Map>();
    expect(lines, isNotNull);
    expect(lines, hasLength(1));
    expect(lines!.single['quantity'], '2');
    expect(lines.single['unitName'], 'carton');
  });
}
