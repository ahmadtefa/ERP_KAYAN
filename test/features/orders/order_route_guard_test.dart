import 'dart:async';

import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
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
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../widget/test_harness.dart';

const order = <String,dynamic>{'id':'order-1','orderNumber':'SO-1','status':'DRAFT',
  'orderDate':'2026-11-04','updatedAt':'2026-11-04T12:00:00.000Z',
  'lines':[{'id':'line-1','itemNameEn':'Synthetic item','unit':'piece','unitQuantity':'3',
    'baseQuantity':'3','remainingQuantity':'3','unitPrice':'10','discountPercent':'0','taxRate':'0'}],
  'invoices':<Object>[]};
class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  Completer<Map<String,dynamic>>? pendingAction;
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) async =>
      pendingAction == null ? {} : await pendingAction!.future;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async =>
      path.endsWith('/orders') ? [order] : [];
  @override
  Future<Map<String,dynamic>> get(String path,{Map<String,dynamic>? query}) async =>
      path.endsWith('/order-1') ? order : {'blocked':false};
}
void main() {
  testWidgets('order action blocks routed and system back until its response', (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(1600,1100); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api=_Api()..pendingAction=Completer<Map<String,dynamic>>();
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),
      currentUserProvider.overrideWithValue(const AppUser(id:'u',username:'u',fullName:'User',companyId:'company',branchId:'branch',isSuperAdmin:true)),
      appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'))]);
    addTearDown(container.dispose);
    final router=GoRouter(initialLocation:AppRoutes.salesOrders,routes:[
      GoRoute(path:AppRoutes.dashboard,builder:(_,_) => const Scaffold(body:Text('Dashboard destination'))),
      GoRoute(path:AppRoutes.salesOrders,onExit:(_,state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
        builder:(context,state) => ErpShell(currentPath:AppRoutes.salesOrders,child:OrdersScreen(kind:InvoiceKind.sales,navigationKey:state.pageKey))),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp.router(locale:const Locale('en'),
      localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
    await tester.pumpAndSettle();
    await tester.tap(find.text('SO-1')); await tester.pumpAndSettle();
    await tester.tap(find.text('Approve')); await tester.pumpAndSettle();
    await tester.tap(find.text('Confirm')); await tester.pump();
    router.go(AppRoutes.dashboard); await tester.pump();
    expect(find.text('Dashboard destination'),findsNothing);
    await tester.binding.handlePopRoute(); await tester.pump();
    expect(find.text('Order details'),findsOneWidget);
    api.pendingAction!.complete({}); await tester.pumpAndSettle();
    router.go(AppRoutes.dashboard); await tester.pumpAndSettle();
    expect(find.text('Dashboard destination'),findsOneWidget);
  });
  for (final kind in InvoiceKind.values) {
    for (final editing in [false,true]) {
      testWidgets('${kind.name} ${editing ? 'edit' : 'create'} order protects the routed list exit', (tester) async {
        SharedPreferences.setMockInitialValues({});
        tester.view.physicalSize = const Size(1600,1100); tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
        final container = ProviderContainer(overrides:[apiClientProvider.overrideWithValue(_Api()),
          currentUserProvider.overrideWithValue(const AppUser(id:'u',username:'u',fullName:'User',companyId:'company',branchId:'branch',isSuperAdmin:true)),
          appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'))]);
        addTearDown(container.dispose);
        final path=kind == InvoiceKind.sales ? AppRoutes.salesOrders : AppRoutes.purchaseOrders;
        final router=GoRouter(initialLocation:path,routes:[
          GoRoute(path:AppRoutes.dashboard,builder:(_,_) => const Scaffold(body:Text('Dashboard destination'))),
          GoRoute(path:path,onExit:(_,state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
            builder:(context,state) => ErpShell(currentPath:path,child:OrdersScreen(kind:kind,navigationKey:state.pageKey))),
        ]);
        addTearDown(router.dispose);
        await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp.router(locale:const Locale('en'),
          localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
        await tester.pumpAndSettle();
        if (editing) {
          await tester.tap(find.text('SO-1')); await tester.pumpAndSettle();
          await tester.tap(find.text('Edit draft')); await tester.pumpAndSettle();
        } else {
          await tester.tap(find.byTooltip('New order')); await tester.pumpAndSettle();
        }
        final field=find.widgetWithText(TextFormField,editing ? 'Quantity' : 'Notes');
        await tester.enterText(field,editing ? '2' : 'Local note');
        router.go(AppRoutes.dashboard); await tester.pumpAndSettle();
        expect(find.text('Unsaved changes'),findsOneWidget);
        await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
        expect(tester.widget<TextFormField>(field).controller!.text,editing ? '2' : 'Local note');
        router.go(AppRoutes.dashboard); await tester.pumpAndSettle();
        await tester.tap(find.text('Discard changes')); await tester.pumpAndSettle();
        expect(find.text('Dashboard destination'),findsOneWidget);
      });
    }
  }
}
