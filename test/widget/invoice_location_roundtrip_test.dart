import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/json/json_utils.dart';
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

class _Api extends ApiClient {
  _Api()
    : super(
        AppConfig.forLocalServer('http://localhost:3210/api/v1'),
        FakeTokenStore(),
      );
  Json? saved;
  @override
  Future<Json> getObject(String path, {Map<String, dynamic>? query}) async => {
    'status': 'DRAFT',
    'customerId': 'p',
    'customer': {'id':'p'},
    'warehouseId': 'w',
    'invoiceDate': '2026-11-25',
    'lines': [
      {
        'itemId': 'i',
        'unitName': 'carton',
        'unitQuantity': '2',
        'unitPrice': '10',
        'quantity': '20',
        'taxRate': '0',
        'locationAllocations': [
          {'storageLocationId': 'a', 'quantity': '0.5'},
          {'storageLocationId': 'b', 'quantity': '1.5'},
        ],
      },
    ],
  };
  @override
  Future<Json> get(String path, {Map<String, dynamic>? query}) async => {
    'blocked': false,
  };
  @override
  Future<List<Json>> getList(
    String path, {
    Map<String, dynamic>? query,
  }) async => [];
  @override
  Future<Json> put(String path, {Object? body}) async {
    saved = Map<String, dynamic>.from(body as Map);
    return {};
  }
}

void main() {
  testWidgets(
    'reopened carton draft preserves typed location units and warehouse when saved',
    (tester) async {
      tester.view.physicalSize = const Size(1600, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = _Api();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(api),
            activeItemsProvider.overrideWith(
              (ref) async => [
                {
                  'id': 'i',
                  'code': 'I',
                  'nameEn': 'Item',
                  'unit': 'piece',
                  'units': [
                    {'unit': 'piece', 'factor': '1', 'isBase': true},
                    {'unit': 'carton', 'factor': '10'},
                  ],
                  'isActive': true,
                },
              ],
            ),
            activeCustomersProvider.overrideWith(
              (ref) async => [
                {
                  'id': 'p',
                  'code': 'P',
                  'nameEn': 'Customer',
                  'isActive': true,
                },
              ],
            ),
          ],
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const InvoiceEditorScreen(
              kind: InvoiceKind.sales,
              invoiceId: 'inv',
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Source locations (2)'), findsOneWidget);
      expect(
        tester
            .widget<TextFormField>(
              find.byKey(const ValueKey('line-quantity-0')),
            )
            .controller!
            .text,
        '2',
      );
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();
      expect(api.saved!['warehouseId'], 'w');
      final line = listOf(api.saved!['lines']).single;
      expect(line['quantity'], '2');
      expect(line['unitName'], 'carton');
      expect(
        listOf(line['locationAllocations']).map((r) => r['quantity']).toList(),
        ['0.5', '1.5'],
      );
    },
  );
}
