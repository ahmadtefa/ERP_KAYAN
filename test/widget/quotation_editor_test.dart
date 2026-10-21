import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/common/presentation/providers/resource_providers.dart';
import 'package:erp_kayan/features/quotations/presentation/screens/quotation_editor_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

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
  Map<String, dynamic>? objectResponse;

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => objectResponse ?? const {};

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    String? idempotencyKey,
  }) async {
    postPath = path;
    postBody = Map<String, dynamic>.from(body! as Map);
    return {'id': 'quotation-id'};
  }

  @override
  Future<List<Map<String, dynamic>>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => [];
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('a quotation sends its subject, tax flag, tables and discounts', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1600, 1100);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = _FakeApiClient();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(api),
          itemsProvider.overrideWith((ref) async => [
            {
              'id': 'item-1',
              'code': 'ITEM-1',
              'nameEn': 'Widget',
              'nameAr': 'صنف',
              'unit': 'piece',
              'isActive': true,
              'isStockTracked': true,
              'taxRate': '0.0000',
              'salePrice': '100.0000',
            },
          ]),
          customersProvider.overrideWith((ref) async => [
            {
              'id': 'customer-1',
              'code': 'CUS-1',
              'nameEn': 'Test customer',
              'nameAr': 'عميل تجريبي',
              'isActive': true,
            },
          ]),
        ],
        child: MaterialApp.router(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: GoRouter(
            initialLocation: '/new',
            routes: [
              GoRoute(
                path: '/new',
                builder: (context, state) => const QuotationEditorScreen(),
              ),
              GoRoute(
                path: AppRoutes.quotations,
                builder: (context, state) =>
                    const Scaffold(body: Text('quotation list')),
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Customer.
    await tester.tap(find.byType(DropdownButtonFormField<String>).first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('CUS-1 — Test customer').last);
    await tester.pumpAndSettle();

    // Subject: the offer's own headline, independent of the customer name.
    await tester.enterText(
      find.byKey(const ValueKey('quotation-subject')),
      'Renewal offer',
    );
    await tester.pump();

    // Per-offer tax flag: this quotation prints no tax number even though the
    // company profile has one. The API field is showTaxId.
    await tester.tap(find.byKey(const ValueKey('quotation-show-tax-number')));
    await tester.pumpAndSettle();

    // The offer's own column layout: rename the description header, hide the
    // origin column and move the total above the unit price.
    await tester.tap(find.byKey(const ValueKey('edit-columns-0')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('column-label-en-description')),
      'Scope',
    );
    await tester.tap(find.byKey(const ValueKey('column-visible-countryOfOrigin')));
    await tester.pumpAndSettle();
    await tester.ensureVisible(
      find.byKey(const ValueKey('column-up-lineTotal')),
    );
    await tester.tap(find.byKey(const ValueKey('column-up-lineTotal')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('save-columns')));
    await tester.pumpAndSettle();

    // Table title and its own fixed discount.
    await tester.enterText(
      find.byKey(const ValueKey('quotation-table-title-0')),
      'Main table',
    );
    await tester.tap(find.byKey(const ValueKey('quotation-table-discount-0')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Fixed amount').last);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('quotation-table-discount-value-0')),
      '10',
    );
    await tester.pump();

    // Line: item, quantity and a line discount.
    await tester.tap(find.byKey(const ValueKey('quotation-item-null')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ITEM-1 — Widget').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('quotation-qty-0-0')), '3');
    await tester.enterText(
      find.byKey(const ValueKey('quotation-price-0-0')),
      '100',
    );
    await tester.pump();

    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(api.postPath, '/sales/quotations');
    final body = api.postBody!;
    expect(body['subject'], 'Renewal offer');
    expect(body['showTaxId'], isFalse);
    expect(body['customerId'], 'customer-1');

    final columns = (body['columns'] as List).cast<Map>();
    expect(columns, hasLength(6));
    final byKey = {for (final column in columns) column['key']: column};
    expect(byKey['description']!['labelEn'], 'Scope');
    expect(byKey['countryOfOrigin']!['visible'], isFalse);
    expect(
      columns.map((column) => column['key']).toList(),
      ['description', 'countryOfOrigin', 'unit', 'quantity', 'lineTotal', 'unitPrice'],
    );

    final tables = (body['tables'] as List).cast<Map>();
    expect(tables, hasLength(1));
    expect(tables.single['title'], 'Main table');
    // The layout travels with its table as well as at the top level.
    final tableColumns = (tables.single['columns'] as List).cast<Map>();
    expect(
      tableColumns.map((column) => column['key']).toList(),
      ['description', 'countryOfOrigin', 'unit', 'quantity', 'lineTotal', 'unitPrice'],
    );
    expect(tables.single['discountType'], 'AMOUNT');
    expect(tables.single['discountAmount'], '10');

    final lines = (tables.single['lines'] as List).cast<Map>();
    expect(lines, hasLength(1));
    expect(lines.single['itemId'], 'item-1');
    expect(lines.single['quantity'], '3');
    expect(lines.single['unitPrice'], '100');
  });
}
