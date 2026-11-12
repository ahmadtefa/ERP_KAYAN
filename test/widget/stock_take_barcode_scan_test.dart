import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_takes_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// Counting a shelf with a scanner.
///
/// A stock take is the one screen where a scan must NOT add a line: the lines
/// were frozen when the session opened, one per item and lot. So the tests here
/// are about the opposite of the invoice's - the scan must find the line that
/// already exists, raise its figure, and leave the number of lines alone.

class _CountApi extends ApiClient {
  _CountApi({this.unknown = false})
    : super(
        const AppConfig(
          environment: AppEnvironment.development,
          apiBaseUrl: 'https://test.invalid/api/v1',
          connectTimeout: Duration(seconds: 1),
          receiveTimeout: Duration(seconds: 1),
        ),
        FakeTokenStore(),
      );

  bool unknown;
  /// The scanned item is stocked in two lots, which is the case the screen used
  /// to resolve by silently taking the first one.
  bool multipleLots = false;
  final scanned = <String>[];
  Map<String, dynamic>? countBody;

  /// Two frozen lines: the water cartons and an unrelated item, so a scan can
  /// be shown to touch one line and leave the other alone.
  Map<String, dynamic> get detail => {
    'id': 'st-1',
    'code': 'ST-001',
    'warehouseId': 'wh-1',
    'warehouseNameEn': 'Main store',
    'warehouseNameAr': 'المخزن الرئيسي',
    'status': 'COUNTING',
    'createdBy': 'someone-else',
    'varianceCount': 0,
    'lines': [
      {
        'id': 'line-water',
        'itemId': 'item-water',
        'itemCode': 'WATER',
        'itemNameEn': 'Water',
        'itemNameAr': 'مياه',
        // The frozen system figure is in BASE units: 48 pieces.
        'unit': 'piece',
        'systemQuantity': '48.0000',
        'countedQuantity': null,
        'varianceQuantity': '0.0000',
        'varianceValue': '0.0000',
        'batchNumber': 'LOT-A',
      },
      ...(multipleLots
          ? [
              {
                'id': 'line-water-lot-b',
                'itemId': 'item-water',
                'itemCode': 'WATER',
                'itemNameEn': 'Water',
                'itemNameAr': 'مياه',
                'unit': 'piece',
                'systemQuantity': '24.0000',
                'countedQuantity': null,
                'varianceQuantity': '0.0000',
                'varianceValue': '0.0000',
                'batchNumber': 'LOT-B',
              },
            ]
          : <Map<String, dynamic>>[]),
      {
        'id': 'line-plug',
        'itemId': 'item-plug',
        'itemCode': 'PLUG',
        'itemNameEn': 'Plug',
        'itemNameAr': 'قابس',
        'unit': 'piece',
        'systemQuantity': '10.0000',
        'countedQuantity': null,
        'varianceQuantity': '0.0000',
        'varianceValue': '0.0000',
        'batchNumber': null,
      },
    ],
  };

  Map<String, dynamic> get _water => {
    'id': 'item-water',
    'code': 'WATER',
    'nameEn': 'Water',
    'nameAr': 'مياه',
    'unit': 'piece',
    'units': [
      {'id': 'u1', 'unit': 'piece', 'factor': '1.000000', 'isActive': true},
      {'id': 'u2', 'unit': 'carton', 'factor': '24.000000', 'isActive': true},
    ],
  };

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/warehouses') {
      return [
        {'id': 'wh-1', 'code': 'MAIN', 'nameEn': 'Main store', 'nameAr': 'المخزن الرئيسي'},
      ];
    }
    if (path == '/inventory/items') {
      return [_water, {'id': 'item-plug', 'code': 'PLUG', 'nameEn': 'Plug', 'nameAr': 'قابس', 'unit': 'piece'}];
    }
    if (path == '/inventory/stock-takes') {
      return [
        {
          'id': 'st-1',
          'code': 'ST-001',
          'warehouseId': 'wh-1',
          'warehouseCode': 'MAIN',
          'warehouseNameEn': 'Main store',
          'warehouseNameAr': 'المخزن الرئيسي',
          'scope': 'FULL',
          'status': 'COUNTING',
          'createdBy': 'someone-else',
          'approvedAt': null,
          'approvedBy': null,
          'postedAt': null,
          'documentId': null,
          'journalEntryId': null,
          'lineCount': 2,
          'notes': null,
          'createdAt': '2026-11-05T09:00:00.000Z',
        },
      ];
    }
    return [];
  }

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
      if (code == 'PLUG') {
        return {
          'matched': 'item',
          'unit': 'piece',
          'factor': '1.000000',
          'item': {'id': 'item-plug', 'code': 'PLUG', 'nameEn': 'Plug', 'unit': 'piece'},
        };
      }
      return {
        'matched': 'unit',
        'unit': 'carton',
        'factor': '24.000000',
        'quantityPerScan': '24.000000',
        'quantityPerScanFitsLedgerScale': true,
        'item': _water,
      };
    }
    if (path == '/inventory/stock-takes/st-1') return Map.from(detail);
    throw StateError('Unexpected GET $path');
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    if (path.endsWith('/count')) {
      countBody = body is Map ? Map<String, dynamic>.from(body) : null;
      return Map.from(detail);
    }
    return const {};
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<_CountApi> openCount(WidgetTester tester, {_CountApi? api}) async {
    tester.view.physicalSize = const Size(1700, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final client = api ?? _CountApi();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(client),
          currentUserProvider.overrideWithValue(
            AppUser(
              id: 'u',
              username: 'u',
              fullName: 'User',
              companyId: 'c',
              permissions: const [
                'inventory.stocktake.read',
                'inventory.stocktake.count',
                'inventory.stocktake.approve',
                'inventory.stocktake.post',
              ],
            ),
          ),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: StockTakesScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();
    // Open the only session.
    await tester.tap(find.text('ST-001').first);
    await tester.pumpAndSettle();
    return client;
  }

  Future<void> scan(WidgetTester tester, String code) async {
    final field = find.byKey(const ValueKey('stock-take-barcode'));
    expect(field, findsOneWidget, reason: 'the count must offer a scan box');
    await tester.enterText(field, code);
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();
  }

  /// The figure in the counted box of [lineId].
  ///
  /// The field is keyed by the figure it shows, so the value is read from the
  /// one field whose key names that line - and a stale box is impossible,
  /// because a changed figure produces a different key.
  String countedValue(WidgetTester tester, String lineId) {
    final prefix = 'count-$lineId-';
    final keys = tester
        .widgetList<TextFormField>(find.byType(TextFormField))
        .map((field) => field.key)
        .whereType<ValueKey<String>>()
        .map((key) => key.value)
        .where((value) => value.startsWith(prefix))
        .toList();
    expect(keys, hasLength(1), reason: 'exactly one counted box for $lineId');
    return keys.single.substring(prefix.length);
  }

  /// How many counted boxes the dialog shows: the number of frozen lines, which
  /// a scan must never change.
  int lineCount(WidgetTester tester) => tester
      .widgetList<TextFormField>(find.byType(TextFormField))
      .map((field) => field.key)
      .whereType<ValueKey<String>>()
      .where((key) => key.value.startsWith('count-line-'))
      .length;

  testWidgets('a scan finds the frozen line and counts one carton', (
    tester,
  ) async {
    final api = await openCount(tester);
    expect(lineCount(tester), 2);

    await scan(tester, 'WATER');

    // ONE carton, not 24 pieces: the server multiplies by 24 when the count is
    // recorded.
    expect(countedValue(tester, 'line-water'), '1');
    // The other frozen line is untouched.
    expect(countedValue(tester, 'line-plug'), '');
    // No line was added or duplicated.
    expect(lineCount(tester), 2);
    expect(api.scanned, ['WATER']);
    // What one carton means on the shelf is visible next to the figure.
    expect(find.textContaining('= 24 piece'), findsOneWidget);
  });

  testWidgets('a second scan of the same label counts two cartons', (
    tester,
  ) async {
    await openCount(tester);

    await scan(tester, 'WATER');
    await tester.pump(const Duration(seconds: 1));
    await scan(tester, 'WATER');
    await tester.pump(const Duration(seconds: 1));
    await scan(tester, 'WATER');

    expect(countedValue(tester, 'line-water'), '3');
    expect(find.textContaining('= 72 piece'), findsOneWidget);
    expect(lineCount(tester), 2);
  });

  testWidgets('scanning a different item counts its own line', (
    tester,
  ) async {
    await openCount(tester);

    await scan(tester, 'WATER');
    await tester.pump(const Duration(seconds: 1));
    await scan(tester, 'PLUG');

    expect(countedValue(tester, 'line-water'), '1');
    expect(countedValue(tester, 'line-plug'), '1');
    expect(lineCount(tester), 2);
  });

  testWidgets('counting the same item twice never duplicates its line', (
    tester,
  ) async {
    await openCount(tester);

    // The invoice screen adds a line per item; a count must not, because its
    // lines were frozen when the session opened and the adjustment is booked
    // per line.
    await scan(tester, 'WATER');
    await tester.pump(const Duration(seconds: 1));
    await scan(tester, 'WATER');
    await tester.pump(const Duration(seconds: 1));
    await scan(tester, 'WATER');

    expect(lineCount(tester), 2, reason: 'still the two frozen lines');
    expect(countedValue(tester, 'line-water'), '3');
  });

  testWidgets('a scan cannot happen while the count is not open for counting', (
    tester,
  ) async {
    final api = _CountApi();
    // The field is disabled, so a scanner typing into it cannot submit.
    tester.view.physicalSize = const Size(1700, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(
            AppUser(
              id: 'u',
              username: 'u',
              fullName: 'User',
              companyId: 'c',
              permissions: const ['inventory.stocktake.read'],
            ),
          ),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(body: StockTakesScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('ST-001').first);
    await tester.pumpAndSettle();

    final field = tester.widget<TextFormField>(
      find.byKey(const ValueKey('stock-take-barcode')),
    );
    expect(field.enabled, isFalse);
    expect(api.scanned, isEmpty);
  });

  testWidgets('the count is saved with the unit, so the server converts once', (
    tester,
  ) async {
    final api = await openCount(tester);

    await scan(tester, 'WATER');
    await tester.tap(find.text('Save count').first);
    await tester.pumpAndSettle();

    final lines = (api.countBody?['lines'] as List?)?.cast<Map>();
    expect(lines, isNotNull);
    final water = lines!.firstWhere((line) => line['lineId'] == 'line-water');
    // Two numbers that only make sense together: the figure in cartons and the
    // unit it is expressed in.
    expect(water['countedQuantity'], 1);
    expect(water['unitName'], 'carton');
  });

  testWidgets('an unknown barcode changes no count and names the code', (
    tester,
  ) async {
    final api = _CountApi(unknown: true);
    await openCount(tester, api: api);

    await scan(tester, '404-XYZ');

    expect(find.textContaining('404-XYZ'), findsWidgets);
    // The error dialog renders its button in Arabic whatever the ambient
    // locale (app_error_dialog.dart uses AppLocalizationsAr), so the test
    // dismisses the button it actually shows.
    await tester.tap(find.text('حسنًا'));
    await tester.pumpAndSettle();

    expect(countedValue(tester, 'line-water'), '');
    expect(countedValue(tester, 'line-plug'), '');
    expect(lineCount(tester), 2);
  });

  /// The item is stocked in two lots and the label cannot say which.
  ///
  /// Taking the first lot would put a real figure on a batch nobody looked at,
  /// and nothing afterwards shows the mistake: the count is plausible and the
  /// other lot stays uncounted. So the screen must ask.
  group('an item with more than one lot', () {
    testWidgets('a scan asks which batch before changing any figure', (
      tester,
    ) async {
      final api = _CountApi()..multipleLots = true;
      await openCount(tester, api: api);

      await scan(tester, '6221');
      await tester.pumpAndSettle();

      // The question is on screen and names both lots.
      expect(
        find.textContaining('Which batch are you counting?'),
        findsOneWidget,
      );
      expect(find.textContaining('LOT-A'), findsWidgets);
      expect(find.textContaining('LOT-B'), findsWidgets);

      // Nothing has been counted yet, on EITHER line.
      expect(countedValue(tester, 'line-water'), '');
      expect(countedValue(tester, 'line-water-lot-b'), '');
    });

    testWidgets('choosing a batch counts that batch and leaves the other', (
      tester,
    ) async {
      final api = _CountApi()..multipleLots = true;
      await openCount(tester, api: api);

      await scan(tester, '6221');
      await tester.pumpAndSettle();

      // Pick the SECOND lot on purpose: taking the first makes the bug and the
      // fix indistinguishable.
      await tester.tap(find.textContaining('LOT-B').last);
      await tester.pumpAndSettle();

      expect(countedValue(tester, 'line-water-lot-b'), '1');
      expect(countedValue(tester, 'line-water'), '');
      // Still two water lines plus the plug: a scan never adds one.
      expect(lineCount(tester), 3);
    });

    testWidgets('cancelling the question leaves the count untouched', (
      tester,
    ) async {
      final api = _CountApi()..multipleLots = true;
      await openCount(tester, api: api);

      await scan(tester, '6221');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(countedValue(tester, 'line-water'), '');
      expect(countedValue(tester, 'line-water-lot-b'), '');
      // Backing out is not an answer, so nothing was sent to the server.
      expect(api.countBody, isNull);
    });

    testWidgets('a single-lot item is still counted without a question', (
      tester,
    ) async {
      final api = _CountApi();
      await openCount(tester, api: api);

      await scan(tester, '6221');
      await tester.pumpAndSettle();

      expect(
        find.textContaining('Which batch are you counting?'),
        findsNothing,
      );
      expect(countedValue(tester, 'line-water'), '1');
    });
  });
}
