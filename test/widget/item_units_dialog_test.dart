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
  String? patchPath;
  Map<String, dynamic>? patchBody;
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
  Future<Map<String, dynamic>> patch(String path, {Object? body}) async {
    patchPath = path;
    patchBody = body == null ? null : Map<String, dynamic>.from(body as Map);
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
///
/// A TextFormField renders a TextField, so matching on TextField finds both
/// the declarative forms and the packing table's own rows.
Finder _field(String label) => find.ancestor(
  of: find.text(label),
  matching: find.byType(TextField),
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the units button opens the item units and a carton of 12 is saved', (
    tester,
  ) async {
    // The items table is wider than a laptop: the row actions sit at the far
    // end of a horizontally scrollable list, so the view has to be wide enough
    // for the button to be on it (or the tap lands outside the render tree).
    tester.view.physicalSize = const Size(2200, 1000);
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
    final unitsButton = find.byIcon(Icons.qr_code_2_outlined).first;
    await tester.ensureVisible(unitsButton);
    await tester.pumpAndSettle();
    await tester.tap(unitsButton);
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

  testWidgets(
    'a new item is saved with its base unit and its cartons in one request',
    (tester) async {
      // The items table is wider than a laptop: the row actions sit at the far
      // end of a horizontally scrollable list, so the view has to be wide
      // enough for the button to be on it (or the tap lands outside the
      // render tree).
      tester.view.physicalSize = const Size(2200, 1400);
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

      // The item's own fields first: a name in both languages is what makes
      // the item findable, and the code is what documents quote.
      await tester.enterText(_field('Code'), 'WATER-9');
      await tester.enterText(_field('Name (English)'), 'Sparkling water');
      await tester.enterText(_field('الاسم (عربي)'), 'مياه فوارة');
      await tester.pump();

      // The item form no longer asks for a "unit" of its own: the base unit
      // is the first row of the packing table, so the two can never disagree.
      // It is asked for by name in the editor that follows.
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();

      // The packing table, titled for what it holds.
      expect(find.text('Units, packing and conversion'), findsOneWidget);
      expect(_field('Base unit'), findsOneWidget);
      // And it says what a base unit is, rather than leaving the person to
      // guess whether it is the carton or the bottle.
      expect(
        find.textContaining('The unit stock is counted in'),
        findsOneWidget,
      );

      await tester.enterText(
        find.byKey(const ValueKey('item-units-base-unit')),
        'عبوة',
      );
      await tester.pump();

      // "+ Add unit" adds a row for the carton. Row 0 is the base unit, so the
      // carton is row 1.
      await tester.tap(find.byKey(const ValueKey('item-units-add-row')));
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byKey(const ValueKey('item-unit-1-name')),
        'كرتونة',
      );
      await tester.enterText(
        find.byKey(const ValueKey('item-unit-1-factor')),
        '12',
      );
      await tester.pump();

      // The arithmetic is shown while it is typed: five cartons of twelve.
      expect(find.text('5 كرتونة × 12 = 60 عبوة'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('item-units-apply')));
      await tester.pumpAndSettle();

      // One request carried the item and its whole catalogue.
      expect(api.postPath, '/inventory/items');
      expect(api.postBody?['code'], 'WATER-9');
      expect(api.postBody?['unit'], 'عبوة');

      final units = (api.postBody?['units'] as List<dynamic>? ?? const []);
      expect(units, hasLength(2));

      final base = Map<String, dynamic>.from(units[0] as Map);
      expect(base['unit'], 'عبوة');
      // The base unit is what stock is counted in, so its factor is 1 - the
      // server refuses anything else and this is the number it is sent.
      expect(base['factor'], '1');

      final carton = Map<String, dynamic>.from(units[1] as Map);
      expect(carton['unit'], 'كرتونة');
      expect(carton['factor'], '12');
    },
  );

  testWidgets(
    'editing an item shows its units, keeps them, and explains the base unit',
    (tester) async {
      tester.view.physicalSize = const Size(2200, 1400);
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

      // The pencil on the item's row - the same edit a person uses every day.
      final editButton = find.byIcon(Icons.edit_outlined).first;
      await tester.ensureVisible(editButton);
      await tester.pumpAndSettle();
      await tester.tap(editButton);
      await tester.pumpAndSettle();

      // The form comes up filled in from the row: editing does not start from
      // a blank page that would look like a new item.
      expect(find.widgetWithText(FilledButton, 'Save'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();

      // Its existing units were read from the API and are on screen: the base
      // unit is row 0, named, and cannot be removed.
      expect(api.unitsRead, contains('/inventory/items/item-water/units'));
      expect(find.text('Units, packing and conversion'), findsOneWidget);

      final baseField = tester.widget<TextField>(
        find.byKey(const ValueKey('item-units-base-unit')),
      );
      expect(baseField.controller?.text, 'عبوة');

      // Changing the base unit of an item that already has stock would
      // reinterpret every balance already recorded, so the screen says what
      // the server will answer instead of pretending it is a free edit.
      expect(
        find.textContaining(
          'The base unit cannot be changed once stock is recorded',
        ),
        findsOneWidget,
      );
      expect(
        find.textContaining('add another unit instead'),
        findsOneWidget,
      );

      await tester.tap(find.byKey(const ValueKey('item-units-apply')));
      await tester.pumpAndSettle();

      // Saving the edit resends the units it was shown - it does not drop the
      // item's existing unit, and the base unit keeps factor 1.
      expect(api.patchPath, '/inventory/items/item-water');
      expect(api.patchBody?['unit'], 'عبوة');
      final units = (api.patchBody?['units'] as List<dynamic>? ?? const []);
      expect(units, hasLength(1));
      final base = Map<String, dynamic>.from(units[0] as Map);
      expect(base['unit'], 'عبوة');
      expect(base['factor'], '1');
      // A unit that was already saved keeps its id, so the server updates it
      // instead of deleting it and making a new one.
      expect(base['id'], 'unit-bottle');
    },
  );

  testWidgets('cancelling the packing table saves nothing', (tester) async {
    tester.view.physicalSize = const Size(2200, 1400);
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
    await tester.enterText(_field('Code'), 'WATER-9');
    await tester.enterText(_field('Name (English)'), 'Sparkling water');
    await tester.enterText(_field('الاسم (عربي)'), 'مياه فوارة');
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();

    expect(find.text('Units, packing and conversion'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();

    // Abandoning the units abandons the item with it: an item without the
    // base unit it was to be counted in is not a thing to keep.
    expect(api.postPath, isNull);
  });
}
