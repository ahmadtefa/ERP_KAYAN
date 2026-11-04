import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/orders/presentation/order_edit_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../widget/test_harness.dart';

class _EditApi extends ApiClient {
  _EditApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  final requests = <Map<String, dynamic>>[];
  final paths = <String>[];
  @override
  Future<Map<String, dynamic>> put(String path, {Object? body}) async {
    paths.add(path); requests.add(Map<String, dynamic>.from(body! as Map));
    if (requests.length == 1) throw const NetworkFailure();
    return {'id':'order-1'};
  }
}

void main() {
  for (final kind in InvoiceKind.values) {
    testWidgets('${kind.name}: draft edit retains its exact retry after reopening', (tester) async {
      SharedPreferences.setMockInitialValues({});
      tester.view.physicalSize = const Size(1400, 1000); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api = _EditApi();
      const user = AppUser(id:'user',username:'tester',fullName:'Tester',companyId:'company',branchId:'branch',isSuperAdmin:true);
      final order = <String, dynamic>{'id':'order-1', 'updatedAt':'2026-11-04T12:00:00.000Z',
        'lines':[{'id':'line-1','itemNameEn':'Synthetic item','unit':'carton', 'unitQuantity':'3.0000',
          'unitPrice':'100.0000','discountPercent':'5.0000','taxRate':'14.0000'}]};
      await tester.pumpWidget(ProviderScope(overrides: [
        apiClientProvider.overrideWithValue(api), currentUserProvider.overrideWith((ref) => user),
        appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1')),
      ], child: MaterialApp(locale: const Locale('en'), localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales, home: Builder(builder: (context) => Scaffold(body: TextButton(
          onPressed: () => Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => OrderEditScreen(kind: kind, order: order))),
          child: const Text('Open editor')))))));
      await tester.tap(find.text('Open editor')); await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextFormField, 'Quantity'), '2');
      await tester.tap(find.text('Save changes')); await tester.pumpAndSettle();
      expect(api.requests, hasLength(1));
      expect((api.requests.single['lines'] as List).single['quantity'], '2');
      await tester.tap(find.text('OK')); await tester.pumpAndSettle();
      await tester.pageBack(); await tester.pumpAndSettle();
      await tester.tap(find.text('Open editor')); await tester.pumpAndSettle();
      expect(find.text('Order edit is unresolved; retry the same request.'), findsOneWidget);
      expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField, 'Quantity')).controller!.text, '2');
      await tester.tap(find.text('Retry')); await tester.pumpAndSettle();
      expect(api.requests, hasLength(2));
      expect(api.requests.last, api.requests.first);
      expect(api.requests.first['expectedUpdatedAt'], '2026-11-04T12:00:00.000Z');
      expect(api.requests.first['idempotencyKey'], isA<String>());
      expect(api.paths, [kind.isSales ? '/sales/orders/order-1' : '/purchases/orders/order-1',
        kind.isSales ? '/sales/orders/order-1' : '/purchases/orders/order-1']);
      expect(find.text('Open editor'), findsOneWidget);
    });
  }
}
