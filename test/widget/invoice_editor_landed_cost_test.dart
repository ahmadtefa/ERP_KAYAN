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

  testWidgets('purchase editor sends multiple named landed-cost charges and their total', (tester) async {
    tester.view.physicalSize = const Size(1600, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = _FakeApiClient();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          activeItemsProvider.overrideWith((ref) async => [
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
          ]),
          activeSuppliersProvider.overrideWith((ref) async => [
            {
              'id': 'supplier-1',
              'code': 'SUP-1',
              'nameEn': 'Test supplier',
              'nameAr': 'مورد تجريبي',
              'isActive': true,
            },
          ]),
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
                      builder: (_) => const InvoiceEditorScreen(kind: InvoiceKind.purchase),
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

    final dropdowns = find.byType(DropdownButtonFormField<String>);
    expect(dropdowns, findsNWidgets(2));
    await tester.tap(dropdowns.at(0));
    await tester.pumpAndSettle();
    await tester.tap(find.text('SUP-1 — Test supplier').last);
    await tester.pumpAndSettle();

    await tester.tap(find.byType(DropdownButtonFormField<String>).at(1));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ITEM-1 — Tracked item').last);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Add charge'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('landed-cost-description-0')), 'Freight');
    await tester.enterText(find.byKey(const ValueKey('landed-cost-amount-0')), '7.00');
    await tester.pump();

    await tester.tap(find.text('Add charge'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('landed-cost-description-1')), 'Insurance');
    await tester.enterText(find.byKey(const ValueKey('landed-cost-amount-1')), '3.00');
    await tester.pump();

    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(api.postPath, '/purchases/invoices');
    expect(api.postBody?['landedCostAmount'], '10');
    expect(api.postBody?['landedCostCharges'], [
      {'description': 'Freight', 'amount': '7'},
      {'description': 'Insurance', 'amount': '3'},
    ]);
  });
}
