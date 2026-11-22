import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/orders/presentation/order_create_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../widget/test_harness.dart';

class _CreateApi extends ApiClient {
  _CreateApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  final requests = <Map<String, dynamic>>[];
  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async {
    if (path == '/inventory/items') return [{'id': 'item-1', 'code': 'I', 'nameEn': 'Synthetic item', 'unit': 'piece', 'isActive': true}];
    return [{'id': 'party-1', 'code': 'P', 'nameEn': 'Synthetic party', 'isActive': true}];
  }
  @override
  Future<Map<String, dynamic>> post(String path, {Object? body, String? idempotencyKey}) async {
    requests.add(Map<String, dynamic>.from(body! as Map));
    if (requests.length == 1) throw const NetworkFailure();
    return {'id': 'order-1'};
  }
}

void main() {
  for (final kind in InvoiceKind.values) {
    testWidgets('${kind.name}: order creation preserves an uncertain request across reopening', (tester) async {
      SharedPreferences.setMockInitialValues({});
      tester.view.physicalSize = const Size(1400, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = _CreateApi();
      const user = AppUser(id: 'user', username: 'tester', fullName: 'Tester', companyId: 'company', branchId: 'branch', isSuperAdmin: true);
      await tester.pumpWidget(ProviderScope(overrides: [
        apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWith((ref) => user),
        appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1')),
      ], child: MaterialApp(locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Builder(builder: (context) => Scaffold(body: TextButton(
          onPressed: () => Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => OrderCreateScreen(kind: kind))),
          child: const Text('Open order'),
        ))))));
      await tester.tap(find.text('Open order'));
      await tester.pumpAndSettle();
      await tester.tap(find.byType(DropdownButtonFormField<String>).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('P — Synthetic party').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byType(DropdownButtonFormField<String>).last);
      await tester.pumpAndSettle();
      await tester.tap(find.text('I — Synthetic item').last);
      await tester.pumpAndSettle();
      final quantity = find.widgetWithText(TextFormField, 'Quantity');
      await tester.ensureVisible(quantity);
      await tester.enterText(quantity, '2');
      await tester.ensureVisible(find.text('Save draft order'));
      await tester.tap(find.text('Save draft order'));
      await tester.pumpAndSettle();
      expect(api.requests, hasLength(1));
      expect(api.requests.single[kind.isSales ? 'customerId' : 'supplierId'], 'party-1');
      expect((api.requests.single['lines'] as List).single['taxRate'], '');
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Open order'));
      await tester.pumpAndSettle();
      expect(find.text('Order creation is unresolved; retry the same request.'), findsOneWidget);
      await tester.ensureVisible(find.widgetWithText(TextFormField, 'Quantity'));
      expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField, 'Quantity')).controller!.text, '2');
      await tester.ensureVisible(find.text('Retry'));
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();
      expect(api.requests, hasLength(2));
      expect(api.requests.last, api.requests.first);
      expect(api.requests.first['idempotencyKey'], isA<String>());
      expect(find.text('Open order'), findsOneWidget);
    });
  }
}
