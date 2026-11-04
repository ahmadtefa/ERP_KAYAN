import 'package:erp_kayan/core/config/app_config.dart';
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
  _OrderApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  @override
  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async => {
    'id':'order-1', 'orderNumber':'ORD-1', 'orderDate':'2026-11-04', 'status':'DRAFT',
    'updatedAt':'2026-11-04T12:00:00.000Z', 'customerNameEn':'Synthetic customer',
    'supplierNameEn':'Synthetic supplier', 'invoices':<Object>[],
    'lines':[{'id':'line-1','itemNameEn':'Synthetic item','unit':'piece','unitQuantity':'3',
      'baseQuantity':'3','remainingQuantity':'3','unitPrice':'10','discountPercent':'0','taxRate':'0'}],
  };
}

void main() {
  for (final kind in InvoiceKind.values) {
    testWidgets('${kind.name}: draft edit is shown only to a user with manage permission', (tester) async {
      SharedPreferences.setMockInitialValues({});
      tester.view.physicalSize = const Size(1400, 1000); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api = _OrderApi();
      final scope = kind.isSales ? 'sales' : 'purchases';
      Widget app(bool canManage) => ProviderScope(key: ValueKey(canManage), overrides:[
        apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWith((ref) => AppUser(id:'user',username:'tester',fullName:'Tester',
          companyId:'company',branchId:'branch',permissions:['$scope.orders.read', if (canManage) '$scope.orders.manage'])),
        appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1')),
      ], child: MaterialApp(locale: const Locale('en'), localizationsDelegates:AppLocalizations.localizationsDelegates,
        supportedLocales:AppLocalizations.supportedLocales, home:OrderDetailScreen(kind:kind,orderId:'order-1')));
      await tester.pumpWidget(app(false)); await tester.pumpAndSettle();
      expect(find.text('Edit draft'), findsNothing);
      await tester.pumpWidget(app(true)); await tester.pumpAndSettle();
      expect(find.text('Edit draft'), findsOneWidget);
      await tester.tap(find.text('Edit draft')); await tester.pumpAndSettle();
      expect(find.text('Edit draft order'), findsOneWidget);
      expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField, 'Quantity')).controller!.text, '3');
    });
  }
}
