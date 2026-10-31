import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/items_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// The screen a person actually uses to say "one carton holds twelve bottles".
///
/// The API test proves the server stores factor 12. This test proves the UI is
/// a way to type it: it renders the real Items screen, taps the real units
/// button on a real row, fills the real form and checks the request the screen
/// sends. Nothing here re-implements the dialog - if the button moved, the
/// test stops finding it.
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
  final List<String> unitsRead = [];

  Map<String, dynamic> _units = {
    'item': {'id': 'item-water', 'code': 'WATER-1', 'unit': 'عبوة'},
    'items': [
      {
        'id': 'unit-bottle',
        'unit': 'عبوة',
        'factor': '1.000000',
        'barcode': null,
        'salePrice': null,
        'purchasePrice': null,
        'isBase': true,
        'isActive': true,
        'allowFraction': true,
        'usedInSales': true,
        'usedInPurchases': true,
        'sortOrder': 0,
        'abbreviation': null,
        'perBaseSalePrice': null,
        'salePriceAgrees': null,
      },
    ],
  };

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/items') {
      return [
        {
          'id': 'item-water',
          'code': 'WATER-1',
          'nameEn': 'Mineral water',
          'nameAr': 'مياه معدنية',
          'unit': 'عبوة',
          'salePrice': '5.0000',
          'purchasePrice': '4.0000',
          'taxRate': '0.0000',
          'isActive': true,
          'isStockTracked': true,
          'units': (_units['items'] as List).cast<Map<String, dynamic>>(),
        },
      ];
    }
    return const [];
  }

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/items/item-water/units') {
      unitsRead.add(path);
      return _units;
    }
    return const {};
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    postPath = path;
    postBody = body == null ? null : Map<String, dynamic>.from(body as Map);
    if (path == '/inventory/items/item-water/units') {
      // The server answers with the refreshed list; the dialog re-reads it.
      _units = {
        ..._units,
        'items': [
          ...(_units['items'] as List),
          {
            'id': 'unit-carton',
            'unit': postBody?['unit'] ?? 'كرتونة',
            'factor': '${postBody?['factor'] ?? '12'}.000000',
            'barcode': null,
            'salePrice': null,
            'purchasePrice': null,
            'isBase': false,
            'isActive': true,
            'allowFraction': postBody?['allowFraction'] ?? true,
            'usedInSales': postBody?['usedInSales'] ?? true,
            'usedInPurchases': postBody?['usedInPurchases'] ?? true,
            'sortOrder': 0,
            'abbreviation': null,
            'perBaseSalePrice': '60.0000',
            'salePriceAgrees': true,
          },
        ],
        'priceWarnings': const <Map<String, dynamic>>[],
      };
    }
    return const {};
  }
}

/// The input carrying [label], found where Flutter actually renders it: the
/// label lives inside the field, so its ancestor is the field.
Finder _field(String label) => find.ancestor(
  of: find.text(label),
  matching: find.byType(TextFormField),
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the units button opens the item units and a carton of 12 is saved', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = _FakeApiClient();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(testUser),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: ItemsScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // The item is on the screen, with the packing units it already carries.
    expect(find.text('WATER-1'), findsOneWidget);
    expect(find.text('عبوة'), findsWidgets);

    // The per-row button that opens the units of this item, by its own icon.
    await tester.tap(find.byIcon(Icons.qr_code_2_outlined).first);
    await tester.pumpAndSettle();

    // The dialog is this item's, by its own name.
    expect(find.text('Units & barcodes — Mineral water'), findsOneWidget);
    expect(api.unitsRead, isNotEmpty);

    // "Add unit / barcode" inside the dialog.
    await tester.tap(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.byIcon(Icons.add),
      ),
    );
    await tester.pumpAndSettle();

    // The form a person fills: the unit's name and how many base units it
    // holds. This is the field where "12" is typed.
    expect(_field('Unit name'), findsOneWidget);
    expect(_field('Base units per unit'), findsOneWidget);

    await tester.enterText(_field('Unit name'), 'كرتونة');
    await tester.enterText(_field('Base units per unit'), '12');
    await tester.pump();

    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(api.postPath, '/inventory/items/item-water/units');
    expect(api.postBody?['unit'], 'كرتونة');
    expect(api.postBody?['factor'], '12');
    // A new unit is created usable: fractions allowed, both sides on.
    expect(api.postBody?['allowFraction'], true);
    expect(api.postBody?['usedInSales'], true);
    expect(api.postBody?['usedInPurchases'], true);

    // And the dialog comes back showing the carton it now has, with the
    // price per base unit worked out from the factor.
    await tester.pumpAndSettle();
    expect(find.textContaining('كرتونة'), findsWidgets);
  });

  testWidgets('the item form asks for the base unit by name', (tester) async {
    tester.view.physicalSize = const Size(1440, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = _FakeApiClient();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(testUser),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: ItemsScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('New item'));
    await tester.pumpAndSettle();

    // The first question after the item's names is the unit stock is counted
    // in - not a generic "Unit" that could be anything.
    expect(_field('Base unit'), findsOneWidget);
    expect(
      find.textContaining('The unit stock is counted in'),
      findsOneWidget,
    );
  });
}
