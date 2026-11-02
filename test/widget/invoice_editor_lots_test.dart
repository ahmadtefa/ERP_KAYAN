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

/// A receipt can bring the same product twice, as two lots.
///
/// The server turns each line into its own lot; this proves the screen asks for
/// what that needs - the receiving warehouse, and per line the supplier's lot
/// number, the two printed dates and the shelf - and that a half-typed date is
/// refused in the form instead of being invented into the records.
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

  Map<String, dynamic>? postBody;
  String? postPath;

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path == '/inventory/warehouses') {
      return const [
        {
          'id': 'wh-1',
          'code': 'MAIN',
          'nameEn': 'Main store',
          'nameAr': 'المخزن الرئيسي',
        },
        {
          'id': 'wh-2',
          'code': 'BR2',
          'nameEn': 'Second store',
          'nameAr': 'المخزن الثاني',
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
    if (path.startsWith('/inventory/locations/tree/')) {
      final warehouseId = path.split('/').last;
      return {
        'items': [
          {
            'id': 'bin-$warehouseId',
            'code': 'BIN-A1',
            'kind': 'BIN',
            'children': const [],
          },
        ],
      };
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
    postBody = Map<String, dynamic>.from(body! as Map);
    return {'id': 'draft-id'};
  }
}

const _item = {
  'id': 'item-1',
  'code': 'MED-1',
  'nameEn': 'Medicine',
  'nameAr': 'دواء',
  'unit': 'piece',
  'isActive': true,
  'isStockTracked': true,
  'taxRate': '0.0000',
  'purchasePrice': '10.0000',
  'requiresBatch': true,
};

Future<_FakeApiClient> _openEditor(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1600, 1100);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final api = _FakeApiClient();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        activeItemsProvider.overrideWith((ref) async => List.of([_item])),
        activeSuppliersProvider.overrideWith(
          (ref) async => const [
            {
              'id': 'supplier-1',
              'code': 'SUP-1',
              'nameEn': 'Test supplier',
              'nameAr': 'مورد تجريبي',
              'isActive': true,
            },
          ],
        ),
        costCentersProvider.overrideWith((ref) async => const []),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Builder(
          builder: (context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) =>
                        const InvoiceEditorScreen(kind: InvoiceKind.purchase),
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

  await tester.tap(find.byKey(const ValueKey('invoice-party')));
  await tester.pumpAndSettle();
  await tester.tap(find.text('SUP-1 — Test supplier').last);
  await tester.pumpAndSettle();
  return api;
}

/// The empty item drop-down of the newest line carries the `null` key until
/// a product is chosen; the first line's is renamed to the chosen item.
Future<void> _chooseItem(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('item-choice-null')).last);
  await tester.pumpAndSettle();
  await tester.tap(find.text('MED-1 — Medicine').last);
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('two lines of one product travel as two lots on one receipt', (
    tester,
  ) async {
    final api = await _openEditor(tester);

    // The receipt names the warehouse the goods arrived at.
    await tester.tap(find.byKey(const ValueKey('invoice-warehouse')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('BR2 — Second store').last);
    await tester.pumpAndSettle();

    await _chooseItem(tester);
    await tester.tap(find.byKey(const ValueKey('line-location-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('BIN-A1').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('line-batch-0')), 'LOT-A');
    await tester.enterText(
      find.byKey(const ValueKey('line-production-date-0')),
      '2052-01-01',
    );
    await tester.enterText(
      find.byKey(const ValueKey('line-expiry-date-0')),
      '2053-01-01',
    );
    await tester.enterText(find.byKey(const ValueKey('line-quantity-0')), '4');
    await tester.enterText(find.byKey(const ValueKey('line-price-0')), '10');
    await tester.pump();

    await tester.tap(find.text('Add line'));
    await tester.pumpAndSettle();
    await _chooseItem(tester);
    await tester.enterText(find.byKey(const ValueKey('line-batch-1')), 'LOT-B');
    await tester.enterText(
      find.byKey(const ValueKey('line-expiry-date-1')),
      '2053-06-01',
    );
    await tester.enterText(find.byKey(const ValueKey('line-quantity-1')), '6');
    await tester.enterText(find.byKey(const ValueKey('line-price-1')), '12');
    await tester.pump();

    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(api.postPath, '/purchases/invoices');
    expect(api.postBody?['warehouseId'], 'wh-2');
    final lines = (api.postBody?['lines'] as List).cast<Map<String, dynamic>>();
    expect(lines.length, 2);
    expect(lines[0]['itemId'], 'item-1');
    expect(lines[0]['batchNumber'], 'LOT-A');
    expect(lines[0]['batchProductionDate'], '2052-01-01');
    expect(lines[0]['batchExpiryDate'], '2053-01-01');
    // The shelf belongs to the chosen warehouse: it was reloaded when the
    // warehouse changed, not left pointing at the first store's bin.
    expect(lines[0]['storageLocationId'], 'bin-wh-2');
    expect(lines[1]['batchNumber'], 'LOT-B');
    expect(lines[1]['batchExpiryDate'], '2053-06-01');
  });

  testWidgets('a half-typed date is refused before anything is sent', (
    tester,
  ) async {
    final api = await _openEditor(tester);

    await _chooseItem(tester);
    await tester.enterText(find.byKey(const ValueKey('line-batch-0')), 'LOT-A');
    await tester.enterText(
      find.byKey(const ValueKey('line-expiry-date-0')),
      '01/01/2053',
    );
    await tester.enterText(find.byKey(const ValueKey('line-quantity-0')), '4');
    await tester.enterText(find.byKey(const ValueKey('line-price-0')), '10');
    await tester.pump();

    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(find.text('Use YYYY-MM-DD for the lot dates'), findsOneWidget);
    expect(api.postPath, isNull);
  });
}
