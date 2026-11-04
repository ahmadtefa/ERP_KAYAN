import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/invoice_list_screen.dart';
import 'package:go_router/go_router.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
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

class _InvoiceApi extends ApiClient {
  _InvoiceApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  bool failLoad = false;
  @override
  Future<Map<String, dynamic>> get(String path, {Map<String,dynamic>? query}) async => {'blocked':false};
  String status = 'draft';
  @override
  Future<Map<String, dynamic>> getObject(String path, {Map<String, dynamic>? query}) async {
    if (failLoad) throw const NetworkFailure();
    return {'status':status,'lines':<Object>[],'invoiceDate':'2026-11-04'};
  }
  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async => [];
}

void main() {
  for (final kind in InvoiceKind.values) {
    testWidgets('${kind.name} invoice remains guarded when its routed list leaves', (tester) async {
      tester.view.physicalSize = const Size(1600,1000); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final container = ProviderContainer(overrides:[apiClientProvider.overrideWithValue(_InvoiceApi()),
        currentUserProvider.overrideWithValue(const AppUser(id:'user',username:'user',fullName:'User',companyId:'company',branchId:'branch',isSuperAdmin:true)),
        activeItemsProvider.overrideWith((ref) async => []),activeCustomersProvider.overrideWith((ref) async => []),
        activeSuppliersProvider.overrideWith((ref) async => [])]);
      addTearDown(container.dispose);
      final path = kind == InvoiceKind.sales ? AppRoutes.salesInvoices : AppRoutes.purchaseInvoices;
      final router = GoRouter(initialLocation:path,routes:[
        GoRoute(path:AppRoutes.dashboard,builder:(_,_) => const Scaffold(body:Text('Dashboard destination'))),
        GoRoute(path:path,onExit:(_,state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
          builder:(context,state) => ErpShell(currentPath:path,child:InvoiceListScreen(kind:kind,navigationKey:state.pageKey))),
      ]);
      addTearDown(router.dispose);
      await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp.router(locale:const Locale('en'),
        localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
      await tester.pumpAndSettle();
      await tester.tap(find.text(kind == InvoiceKind.sales ? 'New sales invoice' : 'New purchase invoice'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('line-quantity-0')),'2');
      router.go(AppRoutes.dashboard); await tester.pumpAndSettle();
      expect(find.text('Unsaved changes'),findsOneWidget);
      await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
      expect(tester.widget<TextFormField>(find.byKey(const ValueKey('line-quantity-0'))).controller!.text,'2');
      router.go(AppRoutes.dashboard); await tester.pumpAndSettle();
      await tester.tap(find.text('Discard')); await tester.pumpAndSettle();
      expect(find.text('Dashboard destination'),findsOneWidget);
    });
  }
  for (final kind in InvoiceKind.values) {
    testWidgets('${kind.name} invoice back protects changed fields and preserves cancel', (tester) async {
      tester.view.physicalSize = const Size(1600, 1000); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api = _InvoiceApi();
      await tester.pumpWidget(ProviderScope(overrides:[apiClientProvider.overrideWithValue(api),
        activeItemsProvider.overrideWith((ref) async => []),
        activeCustomersProvider.overrideWith((ref) async => []),
        activeSuppliersProvider.overrideWith((ref) async => [])],
        child: MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
          supportedLocales:AppLocalizations.supportedLocales,home:Builder(builder:(context) => Scaffold(body:TextButton(
            onPressed:() => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => InvoiceEditorScreen(kind:kind))),
            child:const Text('Open invoice')))))));
      await tester.tap(find.text('Open invoice')); await tester.pumpAndSettle();
      await tester.pageBack(); await tester.pumpAndSettle();
      expect(find.text('Open invoice'),findsOneWidget);
      await tester.tap(find.text('Open invoice')); await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('line-quantity-0')), '2');
      await tester.pageBack(); await tester.pumpAndSettle();
      expect(find.text('Unsaved changes'),findsOneWidget);
      await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
      expect(tester.widget<TextFormField>(find.byKey(const ValueKey('line-quantity-0'))).controller!.text, '2');
      await tester.pageBack(); await tester.pumpAndSettle();
      await tester.tap(find.text('Discard')); await tester.pumpAndSettle();
      expect(find.text('Open invoice'),findsOneWidget);
    });
  }
  testWidgets('posted invoice closes the editor after acknowledging the error', (tester) async {
    tester.view.physicalSize = const Size(1600, 1000); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api = _InvoiceApi()..status = 'posted';
    await tester.pumpWidget(ProviderScope(overrides:[apiClientProvider.overrideWithValue(api),
      activeItemsProvider.overrideWith((ref) async => []),activeCustomersProvider.overrideWith((ref) async => [])],
      child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
        supportedLocales:AppLocalizations.supportedLocales,home:Builder(builder:(context) => Scaffold(body:TextButton(
          onPressed:() => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) =>
            const InvoiceEditorScreen(kind:InvoiceKind.sales,invoiceId:'invoice-1'))),child:const Text('Open invoice')))))));
    await tester.tap(find.text('Open invoice')); await tester.pumpAndSettle();
    expect(find.text('حسنًا'),findsOneWidget);
    await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
    expect(find.text('Open invoice'),findsOneWidget);
    expect(find.byType(InvoiceEditorScreen),findsNothing);
  });
  testWidgets('failed draft load cannot be overwritten and can be retried', (tester) async {
    tester.view.physicalSize = const Size(1600, 1000); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api = _InvoiceApi()..failLoad = true;
    await tester.pumpWidget(ProviderScope(overrides:[apiClientProvider.overrideWithValue(api),
      activeItemsProvider.overrideWith((ref) async => []),activeCustomersProvider.overrideWith((ref) async => []),
      activeSuppliersProvider.overrideWith((ref) async => [])],
      child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
        supportedLocales:AppLocalizations.supportedLocales,home:const InvoiceEditorScreen(kind:InvoiceKind.sales,invoiceId:'invoice-1'))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNull);
    expect(find.byKey(const ValueKey('line-quantity-0')),findsNothing);
    api.failLoad = false;
    await tester.tap(find.text('Retry')); await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('line-quantity-0')),findsOneWidget);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNotNull);
  });
}
