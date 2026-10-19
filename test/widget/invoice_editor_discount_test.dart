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

  testWidgets('a sales draft sends the line and document discounts it shows', (
    tester,
  ) async {
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
              'salePrice': '100.0000',
            },
          ]),
          activeCustomersProvider.overrideWith((ref) async => [
            {
              'id': 'customer-1',
              'code': 'CUS-1',
              'nameEn': 'Test customer',
              'nameAr': 'عميل تجريبي',
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
                      builder: (_) =>
                          const InvoiceEditorScreen(kind: InvoiceKind.sales),
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
    await tester.tap(dropdowns.at(0));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CUS-1 — Test customer').last);
    await tester.pumpAndSettle();

    // The item picker carries the blank-state key, because the line has no
    // item until this moment. The document-discount picker comes before it in
    // the tree, so counting dropdowns is not a reliable way to find it.
    await tester.tap(find.byKey(const ValueKey('item-choice-null')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ITEM-1 — Tracked item').last);
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const ValueKey('line-quantity-0')), '2');
    await tester.enterText(find.byKey(const ValueKey('line-price-0')), '100');
    await tester.pump();

    // Line discount: 10 %.
    await tester.tap(find.byKey(const ValueKey('line-discount-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Percentage').last);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('line-discount-value-0')),
      '10',
    );
    await tester.pump();

    // Document discount: a fixed 20.00.
    await tester.tap(find.byKey(const ValueKey('document-discount')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Fixed amount').last);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('document-discount-value')),
      '20',
    );
    await tester.pump();

    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(api.postPath, '/sales/invoices');
    final lines = (api.postBody?['lines'] as List).cast<Map>();
    expect(lines.single['discountType'], 'PERCENT');
    expect(lines.single['discountPercent'], '10');
    expect(api.postBody?['discountType'], 'AMOUNT');
    expect(api.postBody?['discountAmount'], '20');
  });
}
