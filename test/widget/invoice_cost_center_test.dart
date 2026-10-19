import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/cost_center_providers.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/common/presentation/providers/resource_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/invoice_editor_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

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
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    postPath = path;
    postBody = Map<String, dynamic>.from(body! as Map);
    return {'id': 'draft-id'};
  }

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => [];
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'an invoice line carries the chosen cost center to the API',
    (tester) async {
      tester.view.physicalSize = const Size(1600, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final api = _FakeApiClient();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(api),
            costCentersProvider.overrideWith(
              (ref) async => <Json>[
                {
                  'id': 'cc-1',
                  'code': 'CC-1',
                  'nameEn': 'Project one',
                  'nameAr': 'المشروع الأول',
                  'type': 'PROJECT',
                  'isActive': true,
                  'parentId': null,
                },
              ],
            ),
            activeItemsProvider.overrideWith(
              (ref) async => [
                {
                  'id': 'item-1',
                  'code': 'ITEM-1',
                  'nameEn': 'Tracked item',
                  'nameAr': 'صنف مخزني',
                  'unit': 'piece',
                  'isActive': true,
                  'isStockTracked': true,
                  'taxRate': '0.0000',
                  'purchasePrice': '10.0000',
                },
              ],
            ),
            activeSuppliersProvider.overrideWith(
              (ref) async => [
                {
                  'id': 'supplier-1',
                  'code': 'SUP-1',
                  'nameEn': 'Test supplier',
                  'nameAr': 'مورد تجريبي',
                  'isActive': true,
                },
              ],
            ),
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
                        builder: (_) => const InvoiceEditorScreen(
                          kind: InvoiceKind.purchase,
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

      // Supplier, item, and the cost center the line belongs to.
      final dropdowns = find.byType(DropdownButtonFormField<String>);
      expect(dropdowns, findsNWidgets(4));

      await tester.tap(dropdowns.at(0));
      await tester.pumpAndSettle();
      await tester.tap(find.text('SUP-1 — Test supplier').last);
      await tester.pumpAndSettle();

      await tester.tap(find.byType(DropdownButtonFormField<String>).at(2));
      await tester.pumpAndSettle();
      await tester.tap(find.text('ITEM-1 — Tracked item').last);
      await tester.pumpAndSettle();

      await tester.tap(find.byType(DropdownButtonFormField<String>).at(3));
      await tester.pumpAndSettle();
      await tester.tap(find.text('CC-1 — Project one').last);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      expect(api.postPath, '/purchases/invoices');
      final lines = api.postBody?['lines'] as List<dynamic>?;
      expect(lines, isNotNull);
      expect((lines!.first as Map)['costCenterId'], 'cc-1');
    },
  );

  testWidgets('without cost centers the line form stays as it was', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1600, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(_FakeApiClient()),
          costCentersProvider.overrideWith((ref) async => const []),
          activeItemsProvider.overrideWith((ref) async => const []),
          activeSuppliersProvider.overrideWith((ref) async => const []),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const InvoiceEditorScreen(kind: InvoiceKind.purchase),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Party and item only: a company that does not use the dimension is not
    // asked about it.
    expect(find.byType(DropdownButtonFormField<String>), findsNWidgets(3));
    expect(find.text('No allocation'), findsNothing);
  });
}
