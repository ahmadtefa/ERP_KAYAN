import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/journal_entries_screen.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/chart_of_accounts_providers.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/dashboard/presentation/providers/dashboard_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

class _JournalApi extends ApiClient {
  _JournalApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  String status='draft';
  int posts=0;
  bool failAfterCommit=true;
  String? lastPath;
  List<Map<String,dynamic>> accounts=[];
  @override
  Future<Map<String,dynamic>> get(String path,{Map<String,dynamic>? query}) async => {'items':accounts};
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async => {'status':status,'items':<Object>[]};
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => path == '/accounting/journal-entries'
    ? [{'id':'entry','entryNumber':'JE-1','status':status,'totalDebit':'1','totalCredit':'1'}] : [];
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) async {
    posts++; lastPath=path;
    status = switch (path.split('/').last) {
      'reverse' => 'reversed', 'submit' => 'pending_approval',
      'approve' => 'approved', 'cancel' => 'cancelled', _ => 'posted',
    };
    if (failAfterCommit) throw StateError('INTERNAL_JOURNAL_DIAGNOSTIC');
    return {'status':status};
  }
}

void main() {
  testWidgets('journal draft guards back and routed navigation', (tester) async {
    tester.view.physicalSize=const Size(1600,1000); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(_JournalApi()),
      appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1')),
      currentUserProvider.overrideWithValue(const AppUser(id:'u',username:'u',fullName:'User',companyId:'c',branchId:'b',isSuperAdmin:true))]);
    addTearDown(container.dispose);
    final router=GoRouter(initialLocation:AppRoutes.journalEntries,routes:[
      GoRoute(path:AppRoutes.dashboard,builder:(_,_) => const Scaffold(body:Text('Destination'))),
      GoRoute(path:AppRoutes.journalEntries,onExit:(_,state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
        builder:(_,state) => Scaffold(body:JournalEntriesScreen(navigationKey:state.pageKey)))]);
    addTearDown(router.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp.router(
      locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
      supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
    await tester.pumpAndSettle();
    await tester.tap(find.text('New journal entry')); await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first,'draft description');
    await tester.pageBack(); await tester.pumpAndSettle();
    expect(find.text('Unsaved changes'),findsOneWidget);
    await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
    expect(find.text('draft description'),findsOneWidget);
    router.go(AppRoutes.dashboard); await tester.pumpAndSettle();
    expect(find.text('Unsaved changes'),findsOneWidget);
    await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
    expect(find.text('draft description'),findsOneWidget);
    router.go(AppRoutes.dashboard); await tester.pumpAndSettle();
    await tester.tap(find.text('Discard')); await tester.pumpAndSettle();
    expect(find.text('Destination'),findsOneWidget);
  });

  testWidgets('journal retains unavailable account on refresh and permits replacement', (tester) async {
    tester.view.physicalSize=const Size(1600,1000); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api=_JournalApi()..accounts=[
      {'id':'a','code':'1','name':'Old','nameEn':'Old','type':'asset','isActive':true,'isPostable':true},
      {'id':'b','code':'2','name':'New','nameEn':'New','type':'asset','isActive':true,'isPostable':true},
    ];
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),
      appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1')),
      currentUserProvider.overrideWithValue(const AppUser(id:'u',username:'u',fullName:'User',companyId:'c',branchId:'b',isSuperAdmin:true))]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp(
      locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
      supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:JournalEntriesScreen()))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('New journal entry')); await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>).first); await tester.pumpAndSettle();
    await tester.tap(find.text('1 — Old').last); await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first,'draft description');
    api.accounts[0]['isActive']=false;
    container.invalidate(chartOfAccountsProvider); await tester.pumpAndSettle();
    expect(find.text('Selected account unavailable'),findsOneWidget);
    expect(find.text('draft description'),findsOneWidget);
    await tester.tap(find.byType(DropdownButtonFormField<String>).first); await tester.pumpAndSettle();
    await tester.tap(find.text('2 — New').last); await tester.pumpAndSettle();
    expect(find.text('Selected account unavailable'),findsNothing);
    expect(tester.takeException(),isNull);
  });

  final cases = [
    ('draft', 'Submit for approval', 'submit', 'pending_approval', 'accounting.journal.create'),
    ('pending_approval', 'Approve entry', 'approve', 'approved', 'accounting.journal.approve'),
    ('approved', 'Post', 'post', 'posted', 'accounting.journal.post'),
    ('approved', 'Cancel entry', 'cancel', 'cancelled', 'accounting.journal.create'),
  ];
  for (final (initial, label, action, expected, permission) in cases) {
    testWidgets('journal $action offers the permitted state transition', (tester) async {
      tester.view.physicalSize=const Size(1600,1000); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api=_JournalApi()..status=initial..failAfterCommit=false;
      final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWithValue(AppUser(id:'u',username:'u',fullName:'User',companyId:'c',branchId:'b',permissions:[permission]))]);
      addTearDown(container.dispose);
      await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp(
        locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
        supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:JournalEntriesScreen()))));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip(label)); await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton,label)); await tester.pumpAndSettle();
      expect(api.lastPath,'/accounting/journal-entries/entry/$action');
      expect(api.posts,1);
      expect((await container.read(journalEntriesProvider.future)).single['status'],expected);
      expect(find.byTooltip(label),findsNothing);
    });
  }

  testWidgets('journal hides mutation actions without permissions', (tester) async {
    tester.view.physicalSize=const Size(1600,1000); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api=_JournalApi();
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),
      currentUserProvider.overrideWithValue(const AppUser(id:'u',username:'u',fullName:'User',companyId:'c',branchId:'b',permissions:['accounting.journal.read']))]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp(
      locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
      supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:JournalEntriesScreen()))));
    await tester.pumpAndSettle();
    expect(find.text('New journal entry'),findsNothing);
    expect(find.byTooltip('Post'),findsNothing);
    expect(find.byTooltip('Submit for approval'),findsNothing);
    expect(find.byTooltip('Cancel entry'),findsNothing);
    expect(api.posts,0);
  });

  testWidgets('journal approval controls and status are Arabic in RTL', (tester) async {
    tester.view.physicalSize=const Size(1600,1000); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api=_JournalApi()..failAfterCommit=false;
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),
      currentUserProvider.overrideWithValue(const AppUser(id:'u',username:'u',fullName:'User',companyId:'c',branchId:'b',permissions:['accounting.journal.create']))]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp(
      locale:const Locale('ar'),localizationsDelegates:AppLocalizations.localizationsDelegates,
      supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:JournalEntriesScreen()))));
    await tester.pumpAndSettle();
    final button=find.byTooltip('إرسال للاعتماد');
    expect(Directionality.of(tester.element(button)),TextDirection.rtl);
    await tester.tap(button); await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton,'إرسال للاعتماد')); await tester.pumpAndSettle();
    expect(find.text('بانتظار الاعتماد'),findsOneWidget);
    expect(api.lastPath,'/accounting/journal-entries/entry/submit');
  });

  for (final action in ['Post','Reverse']) {
    testWidgets('journal ${action.toLowerCase()} refreshes after uncertain response', (tester) async {
      tester.view.physicalSize=const Size(1600,1000); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api=_JournalApi()..status=action == 'Post' ? 'draft' : 'posted';
      final initial=api.status;
      final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWithValue(const AppUser(id:'u',username:'u',fullName:'User',companyId:'c',branchId:'b',isSuperAdmin:true))]);
      addTearDown(container.dispose);
      expect((await container.read(dashboardSummaryProvider.future))['status'],initial);
      expect((await container.read(dashboardMonthlyProvider.future))['status'],initial);
      await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp(
        locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
        supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:JournalEntriesScreen()))));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip(action)); await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton,action)); await tester.pumpAndSettle();
      expect(find.text('حسنًا'),findsOneWidget);
      expect(find.textContaining('INTERNAL_JOURNAL_DIAGNOSTIC'),findsNothing);
      await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
      final status=action == 'Post' ? 'posted' : 'reversed';
      expect(api.posts,1);
      expect((await container.read(journalEntriesProvider.future)).single['status'],status);
      expect((await container.read(dashboardSummaryProvider.future))['status'],status);
      expect((await container.read(dashboardMonthlyProvider.future))['status'],status);
    });
  }
}
