import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/journal_entries_screen.dart';
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
  @override
  Future<Map<String,dynamic>> get(String path,{Map<String,dynamic>? query}) async => {'items':<Object>[]};
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async => {'status':status,'items':<Object>[]};
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => path == '/accounting/journal-entries'
    ? [{'id':'entry','entryNumber':'JE-1','status':status,'totalDebit':'1','totalCredit':'1'}] : [];
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) async {
    posts++; status=path.endsWith('/reverse') ? 'reversed' : 'posted';
    throw StateError('INTERNAL_JOURNAL_DIAGNOSTIC');
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

  for (final action in ['Post','Reverse']) {
    testWidgets('journal ${action.toLowerCase()} refreshes after uncertain response', (tester) async {
      tester.view.physicalSize=const Size(1600,1000); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api=_JournalApi()..status=action == 'Post' ? 'draft' : 'posted';
      final initial=api.status;
      final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api)]);
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
