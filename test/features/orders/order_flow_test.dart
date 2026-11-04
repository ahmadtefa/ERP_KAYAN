import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/orders/presentation/orders_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../widget/test_harness.dart';

class _OrderApi extends ApiClient {
  _OrderApi(this.kind) : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  final InvoiceKind kind;
  final requests = <Map<String, dynamic>>[];
  int loads = 0;
  bool converted = false;

  @override
  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async {
    loads++;
    return {
      'id': 'order-1', 'orderNumber': 'ORD-1', 'orderDate': '2026-11-04',
      'status': converted ? 'PARTIALLY_FULFILLED' : 'APPROVED',
      'customerNameEn': 'Customer', 'supplierNameEn': 'Supplier',
      'lines': [{'id': 'line-1', 'itemNameEn': 'Item', 'baseQuantity': '5',
        'remainingQuantity': converted ? '3' : '5', 'unitPrice': '10'}],
      'invoices': converted ? [{'id': 'invoice-1', 'invoiceNumber': 'INV-1', 'status': 'DRAFT', 'totalAmount': '20'}] : [],
    };
  }

  @override
  Future<Map<String, dynamic>> post(String path, {Object? body, String? idempotencyKey}) async {
    requests.add(Map<String, dynamic>.from(body! as Map));
    if (requests.length == 1) throw const NetworkFailure();
    converted = true;
    return {'invoice': {'id': 'invoice-1'}};
  }
}

void main() {
  for (final kind in InvoiceKind.values) {
    testWidgets('${kind.name}: uncertain conversion reuses the key and refreshes', (tester) async {
      SharedPreferences.setMockInitialValues({});
      tester.view.physicalSize = const Size(1400, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = _OrderApi(kind);
      const user = AppUser(id: 'user', username: 'tester', fullName: 'Tester', companyId: 'company',
        branchId: 'branch', isSuperAdmin: true);
      await tester.pumpWidget(ProviderScope(overrides: [
        apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWith((ref) => user),
        appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1')),
      ], child: MaterialApp(locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: OrderDetailScreen(kind: kind, orderId: 'order-1'))));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Convert to invoice'));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(Checkbox));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), '2');
      await tester.tap(find.text('Continue'));
      await tester.pumpAndSettle();
      expect(api.requests.length, 1);
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      expect(find.text('An earlier request is unresolved; retry the same request.'), findsOneWidget);
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();
      expect(api.requests.length, 2);
      expect(api.requests[1], api.requests[0]);
      expect(api.requests[0]['idempotencyKey'], isA<String>());
      expect(find.textContaining('INV-1'), findsOneWidget);
      expect(find.textContaining('Remaining: 3'), findsOneWidget);
      expect(api.loads, greaterThan(1));
    });
  }
}
