import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/return_editor_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

class _ReturnApi extends ApiClient {
  _ReturnApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  bool failSource = false;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => [
    {'id':'invoice','invoiceNumber':'INV-1','invoiceDate':'2026-01-01','status':'posted','branchId':'branch'},
  ];
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async {
    if (failSource) throw StateError('internal source diagnostic');
    return {'id':'invoice','invoiceNumber':'INV-1','invoiceDate':'2026-01-01',
      'lines':[{'id':'line','description':'Synthetic item','quantity':'5','returnedQuantity':'0','unit':'unit'}]};
  }
}

void main() {
  test('an unregistered route fails closed and unregistering an old callback keeps the new one', () async {
    final guard = DraftExitGuard();
    const key = ValueKey('route');
    Future<bool> first() async => false;
    Future<bool> second() async => true;
    expect(await guard.canLeave(key),isFalse);
    guard.register(key,first); guard.register(key,second); guard.unregister(key,first);
    expect(await guard.canLeave(key),isTrue);
    guard.unregister(key,second);
    expect(await guard.canLeave(key),isFalse);
  });
  testWidgets('unexpected return source failure is acknowledged safely', (tester) async {
    tester.view.physicalSize = const Size(1500,1000); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api = _ReturnApi()..failSource = true;
    final container = ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),
      currentUserProvider.overrideWithValue(const AppUser(id:'u',username:'u',fullName:'u',companyId:'c',branchId:'branch',
        permissions:['sales.invoices.create']))]);
    addTearDown(container.dispose);
    final router = GoRouter(initialLocation:'/return',routes:[
      GoRoute(path:'/return',onExit:(_,state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
        builder:(context,state) => Scaffold(body:ReturnEditorScreen(kind:InvoiceKind.sales,navigationKey:state.pageKey))),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp.router(
      locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
      supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>)); await tester.pumpAndSettle();
    await tester.tap(find.textContaining('INV-1').last); await tester.pumpAndSettle();
    expect(find.text('حسنًا'),findsOneWidget);
    expect(find.textContaining('internal source diagnostic'),findsNothing);
    await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
    expect(find.byType(ReturnEditorScreen),findsOneWidget);
    expect(find.text('Synthetic item'),findsNothing);
  });
  testWidgets('both Home buttons preserve a return draft when navigation is cancelled', (tester) async {
    tester.view.physicalSize=const Size(1500,1000); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(_ReturnApi()),
      currentUserProvider.overrideWithValue(const AppUser(id:'user',username:'user',fullName:'User',companyId:'company',branchId:'branch',isSuperAdmin:true))]);
    addTearDown(container.dispose);
    final router=GoRouter(initialLocation:AppRoutes.salesReturnNew,routes:[
      GoRoute(path:AppRoutes.dashboard,builder:(_,_) => const Scaffold(body:Text('Dashboard destination'))),
      GoRoute(path:AppRoutes.salesReturnNew,onExit:(_,state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
        builder:(context,state) => ErpShell(currentPath:AppRoutes.salesReturns,
          child:ReturnEditorScreen(kind:InvoiceKind.sales,navigationKey:state.pageKey))),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp.router(locale:const Locale('en'),
      localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('erp-home-shortcut'))); await tester.pumpAndSettle();
    expect(find.text('Dashboard destination'),findsOneWidget);
    router.go(AppRoutes.salesReturnNew); await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>)); await tester.pumpAndSettle();
    await tester.tap(find.textContaining('INV-1').last); await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first,'keep this reason');
    await tester.tap(find.byKey(const ValueKey('erp-home-shortcut'))); await tester.pumpAndSettle();
    expect(find.text('Unsaved changes'),findsOneWidget);
    await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
    expect(tester.widget<TextField>(find.byType(TextField).first).controller!.text,'keep this reason');
    await tester.tap(find.widgetWithText(ListTile,'Dashboard')); await tester.pumpAndSettle();
    expect(find.text('Unsaved changes'),findsOneWidget);
    await tester.tap(find.text('Discard')); await tester.pumpAndSettle();
    expect(find.text('Dashboard destination'),findsOneWidget);
  });
  for (final kind in InvoiceKind.values) {
    testWidgets('${kind.name} return protects shell navigation and back, preserving cancelled input', (tester) async {
      tester.view.physicalSize = const Size(1500,1000); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final container = ProviderContainer(overrides:[
        currentUserProvider.overrideWithValue(AppUser(id:'user',username:'user',fullName:'User',companyId:'company',branchId:'branch',
          permissions:const ['sales.invoices.create','purchases.invoices.create'])),
        apiClientProvider.overrideWithValue(_ReturnApi()),
      ]);
      addTearDown(container.dispose);
      final router = GoRouter(initialLocation:'/',routes:[
        GoRoute(path:'/',builder:(context,state) => Scaffold(body:TextButton(
          onPressed:() => context.push('/return'),child:const Text('Open return')))),
        GoRoute(path:'/return',onExit:(_,state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
          builder:(context,state) => Scaffold(body:Column(children:[
            TextButton(key:const Key('navigate-home'),onPressed:() => context.go('/'),child:const Text('Home')),
            Expanded(child:ReturnEditorScreen(kind:kind,navigationKey:state.pageKey)),
          ]))),
      ]);
      addTearDown(router.dispose);
      await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp.router(
        locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
        supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
      await tester.tap(find.text('Open return')); await tester.pumpAndSettle();
      // A clean editor is allowed to leave.
      await tester.tap(find.byKey(const Key('return-editor-back'))); await tester.pumpAndSettle();
      expect(find.text('Open return'),findsOneWidget);
      await tester.tap(find.text('Open return')); await tester.pumpAndSettle();
      await tester.tap(find.byType(DropdownButtonFormField<String>)); await tester.pumpAndSettle();
      await tester.tap(find.textContaining('INV-1').last); await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first,'keep this reason');
      await tester.tap(find.byKey(const Key('navigate-home'))); await tester.pumpAndSettle();
      expect(find.text('Unsaved changes'),findsOneWidget);
      await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
      expect(tester.widget<TextField>(find.byType(TextField).first).controller!.text,'keep this reason');
      await tester.binding.handlePopRoute(); await tester.pumpAndSettle();
      expect(find.text('Unsaved changes'),findsOneWidget);
      await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
      expect(tester.widget<TextField>(find.byType(TextField).first).controller!.text,'keep this reason');
      await tester.tap(find.byKey(const Key('return-editor-back'))); await tester.pumpAndSettle();
      expect(find.text('Unsaved changes'),findsOneWidget);
      await tester.tap(find.text('Discard')); await tester.pumpAndSettle();
      expect(find.text('Open return'),findsOneWidget);
    });
  }
}
