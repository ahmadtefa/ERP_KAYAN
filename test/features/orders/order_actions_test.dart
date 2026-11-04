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

class _ActionApi extends ApiClient {
  _ActionApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  String orderStatus = 'DRAFT';
  String? invoiceStatus;
  final paths = <String>[];
  int loads = 0;
  @override
  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async {
    loads++;
    return {'id':'order-1', 'orderNumber':'ORD-1', 'orderDate':'2026-11-04', 'status':orderStatus,
      'customerNameEn':'Customer', 'supplierNameEn':'Supplier', 'lines': <Object>[],
      'invoices': invoiceStatus == null ? <Object>[] : [{'id':'invoice-1', 'invoiceNumber':'INV-1', 'status':invoiceStatus, 'totalAmount':'10'}]};
  }
  @override
  Future<Map<String, dynamic>> post(String path, {Object? body, String? idempotencyKey}) async {
    paths.add(path);
    if (path.endsWith('/approve')) orderStatus = 'APPROVED';
    if (path.endsWith('/cancel')) orderStatus = 'CANCELLED';
    if (path.endsWith('/post')) { invoiceStatus = 'POSTED'; throw const NetworkFailure(); }
    if (path.endsWith('/reverse')) invoiceStatus = 'REVERSED';
    return {};
  }
}

void main() {
  for (final kind in InvoiceKind.values) {
    testWidgets('${kind.name}: approval and cancellation refresh the order', (tester) async {
      SharedPreferences.setMockInitialValues({});
      tester.view.physicalSize = const Size(1400, 1000); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api = _ActionApi();
      const user = AppUser(id:'user',username:'tester',fullName:'Tester',companyId:'company',branchId:'branch',isSuperAdmin:true);
      await tester.pumpWidget(ProviderScope(overrides: [
        apiClientProvider.overrideWithValue(api), currentUserProvider.overrideWith((ref) => user),
        appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1')),
      ], child: MaterialApp(locale: const Locale('en'), localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales, home: OrderDetailScreen(kind: kind, orderId: 'order-1'))));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Approve')); await tester.pumpAndSettle();
      await tester.tap(find.text('Confirm').last); await tester.pumpAndSettle();
      expect(find.textContaining('APPROVED'), findsOneWidget);
      await tester.tap(find.text('Cancel order')); await tester.pumpAndSettle();
      await tester.tap(find.text('Confirm').last); await tester.pumpAndSettle();
      expect(find.textContaining('CANCELLED'), findsOneWidget);
      final base = kind.isSales ? '/sales/orders' : '/purchases/orders';
      expect(api.paths, ['$base/order-1/approve', '$base/order-1/cancel']);
      expect(api.loads, greaterThanOrEqualTo(3));
    });

    testWidgets('${kind.name}: uncertain post refreshes before reversal', (tester) async {
      SharedPreferences.setMockInitialValues({});
      tester.view.physicalSize = const Size(1400, 1000); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api = _ActionApi()..orderStatus = 'PARTIALLY_FULFILLED'..invoiceStatus = 'DRAFT';
      const user = AppUser(id:'user',username:'tester',fullName:'Tester',companyId:'company',branchId:'branch',isSuperAdmin:true);
      await tester.pumpWidget(ProviderScope(overrides: [
        apiClientProvider.overrideWithValue(api), currentUserProvider.overrideWith((ref) => user),
        appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1')),
      ], child: MaterialApp(locale: const Locale('en'), localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales, home: OrderDetailScreen(kind: kind, orderId: 'order-1'))));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Post')); await tester.pumpAndSettle();
      await tester.tap(find.text('Confirm').last); await tester.pumpAndSettle();
      await tester.tap(find.text('OK')); await tester.pumpAndSettle();
      expect(find.textContaining('POSTED'), findsOneWidget);
      expect(find.byTooltip('Post'), findsNothing);
      await tester.tap(find.byTooltip('Reverse')); await tester.pumpAndSettle();
      await tester.tap(find.text('Confirm').last); await tester.pumpAndSettle();
      expect(find.textContaining('REVERSED'), findsOneWidget);
      expect(api.paths, ['${kind.basePath}/invoice-1/post', '${kind.basePath}/invoice-1/reverse']);
      expect(api.loads, greaterThanOrEqualTo(3));
    });
  }
}
