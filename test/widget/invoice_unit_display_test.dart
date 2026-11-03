import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/common/presentation/providers/resource_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/invoice_editor_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// Selling water by the carton, seen from the invoice screen.
///
/// Two things have to be true for the stock ledger to be right afterwards: the
/// line must leave the screen in the unit the person picked (10 cartons, not a
/// silently converted 120 bottles), and the screen must say what that becomes
/// in stock before the invoice is saved. The price has to follow the unit too,
/// or ten cartons would be invoiced at the price of ten bottles.
///
/// This drives the real `InvoiceEditorScreen`.
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

  String? postPath;
  Map<String, dynamic>? postBody;

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => const [];

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => const {};

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    postPath = path;
    postBody = body == null ? null : Map<String, dynamic>.from(body as Map);
    return {'id': 'draft-id'};
  }
}

/// Mineral water: sold by the bottle, bought and sold by the carton of twelve.
Map<String, dynamic> waterItem({bool cartonTakesFractions = true, String taxRate = '0.0000'}) => {
  'id': 'item-water',
  'code': 'WATER-1',
  'nameEn': 'Mineral water',
  'nameAr': 'مياه معدنية',
  'unit': 'عبوة',
  'isActive': true,
  'isStockTracked': true,
  'taxRate': taxRate,
  'salePrice': '5.0000',
  'purchasePrice': '4.0000',
  'units': <Map<String, dynamic>>[
    {
      'id': 'unit-bottle',
      'unit': 'عبوة',
      'factor': '1.000000',
      'isBase': true,
      'isActive': true,
      'allowFraction': true,
      'usedInSales': true,
      'usedInPurchases': true,
      'sortOrder': 0,
      'salePrice': null,
      'purchasePrice': null,
    },
    {
      'id': 'unit-carton',
      'unit': 'كرتونة',
      'factor': '12.000000',
      'isBase': false,
      'isActive': true,
      'allowFraction': cartonTakesFractions,
      'usedInSales': true,
      'usedInPurchases': true,
      'sortOrder': 1,
      'salePrice': null,
      'purchasePrice': null,
    },
  ],
};

const _customer = <String, dynamic>{
  'id': 'customer-1',
  'code': 'CUS-1',
  'nameEn': 'Test customer',
  'nameAr': 'عميل تجريبي',
  'isActive': true,
};

const _supplier = <String, dynamic>{
  'id': 'supplier-1',
  'code': 'SUP-1',
  'nameEn': 'Test supplier',
  'nameAr': 'مورد تجريبي',
  'isActive': true,
};

Future<_FakeApiClient> _openEditor(
  WidgetTester tester,
  Map<String, dynamic> item, {
  bool isSales = true,
}) async {
  tester.view.physicalSize = const Size(1600, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final api = _FakeApiClient();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWithValue(testUser),
        activeItemsProvider.overrideWith((ref) async => [item]),
        activeCustomersProvider.overrideWith((ref) async => [_customer]),
        activeSuppliersProvider.overrideWith((ref) async => [_supplier]),
      ],
      child: MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => InvoiceEditorScreen(
                      kind: isSales ? InvoiceKind.sales : InvoiceKind.purchase,
                    ),
                  ),
                ),
                child: const Text('Open editor'),
              ),
            ),
          ),
        ),
      ),
    ),
  );

  await tester.tap(find.text('Open editor'));
  await tester.pumpAndSettle();
  return api;
}

/// Picks the party, then the water item, through the real drop-downs.
Future<void> _chooseCustomerAndItem(
  WidgetTester tester, {
  bool isSales = true,
}) async {
  await tester.tap(find.byType(DropdownButtonFormField<String>).at(0));
  await tester.pumpAndSettle();
  await tester.tap(
    find
        .text(
          isSales
              ? 'CUS-1 — Test customer'
              : 'SUP-1 — Test supplier',
        )
        .last,
  );
  await tester.pumpAndSettle();

  await tester.tap(find.byKey(const ValueKey('item-choice-null')));
  await tester.pumpAndSettle();
  await tester.tap(find.text('WATER-1 — Mineral water').last);
  await tester.pumpAndSettle();
}

/// The price field of invoice line [index], optionally narrowed to a value.
Finder _priceOf(int index, {String? value}) => find.descendant(
  of: find.byKey(ValueKey('line-price-$index')),
  matching: value == null ? find.byType(EditableText) : find.text(value),
);

/// Switches the line to the carton of twelve.
Future<void> _chooseCarton(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('line-unit-0')));
  await tester.pumpAndSettle();
  await tester.tap(find.text('كرتونة ×12').last);
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('ten cartons are shown as 120 bottles and sent as cartons', (
    tester,
  ) async {
    final api = await _openEditor(tester, waterItem());
    await _chooseCustomerAndItem(tester);

    // The unit list the person chooses from carries the factor with it.
    await tester.tap(find.byKey(const ValueKey('line-unit-0')));
    await tester.pumpAndSettle();
    expect(find.text('كرتونة ×12'), findsWidgets);
    await tester.tap(find.text('كرتونة ×12').last);
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const ValueKey('line-quantity-0')), '10');
    await tester.pumpAndSettle();

    // This is the sentence the person reads before saving.
    expect(find.text('10 كرتونة = 120 عبوة'), findsOneWidget);

    // The price follows the unit: five a bottle is sixty a carton, without
    // anyone typing it twice.
    expect(_priceOf(0), findsOneWidget);
    expect(_priceOf(0, value: '60'), findsOneWidget);

    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(api.postPath, '/sales/invoices');
    final lines = (api.postBody?['lines'] as List).cast<Map>();
    expect(lines.single['quantity'], '10');
    expect(lines.single['unitName'], 'كرتونة');
    expect(lines.single['unitPrice'], '60');
  });

  testWidgets('half a carton is shown as six bottles', (tester) async {
    await _openEditor(tester, waterItem());
    await _chooseCustomerAndItem(tester);
    await _chooseCarton(tester);

    await tester.enterText(find.byKey(const ValueKey('line-quantity-0')), '0.5');
    await tester.pumpAndSettle();

    expect(find.text('0.5 كرتونة = 6 عبوة'), findsOneWidget);
  });

  testWidgets('a sealed carton refuses a fraction on the field itself', (
    tester,
  ) async {
    final api = await _openEditor(
      tester,
      waterItem(cartonTakesFractions: false),
    );
    await _chooseCustomerAndItem(tester);
    await _chooseCarton(tester);

    await tester.enterText(find.byKey(const ValueKey('line-quantity-0')), '0.5');
    await tester.pumpAndSettle();

    expect(
      find.text('كرتونة does not accept fractions; enter a whole number.'),
      findsOneWidget,
    );
    expect(find.text('0.5 كرتونة = 6 عبوة'), findsNothing);

    // Saving is refused here, not after the round trip: nothing is posted.
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(api.postPath, isNull);
  });

  testWidgets('buying ten cartons is sent as ten cartons at the carton price', (
    tester,
  ) async {
    final api = await _openEditor(tester, waterItem(), isSales: false);
    await _chooseCustomerAndItem(tester, isSales: false);
    await _chooseCarton(tester);

    await tester.enterText(find.byKey(const ValueKey('line-quantity-0')), '10');
    await tester.pumpAndSettle();

    // Buying is the same sentence as selling: the warehouse will receive a
    // hundred and twenty bottles against a document of ten cartons.
    expect(find.text('10 كرتونة = 120 عبوة'), findsOneWidget);
    // Four a bottle is forty-eight a carton for the purchase side.
    expect(_priceOf(0, value: '48'), findsOneWidget);

    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(api.postPath, '/purchases/invoices');
    final lines = (api.postBody?['lines'] as List).cast<Map>();
    expect(lines.single['quantity'], '10');
    expect(lines.single['unitName'], 'كرتونة');
    expect(lines.single['unitPrice'], '48');
  });

  testWidgets('an item tax rate is not silently applied to a new invoice line', (tester) async {
    final api = await _openEditor(tester, waterItem(taxRate: '14.0000'));
    await _chooseCustomerAndItem(tester);
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(api.postPath, '/sales/invoices');
    final lines = (api.postBody?['lines'] as List).cast<Map>();
    expect(lines.single['taxRate'], '0');
  });

  testWidgets('a price typed on purpose survives a unit switch', (
    tester,
  ) async {
    await _openEditor(tester, waterItem());
    await _chooseCustomerAndItem(tester);

    await tester.enterText(find.byKey(const ValueKey('line-price-0')), '55');
    await tester.pumpAndSettle();
    await _chooseCarton(tester);

    expect(_priceOf(0, value: '55'), findsOneWidget);
  });
}
