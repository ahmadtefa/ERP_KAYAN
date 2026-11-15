import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account_type.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/chart_of_accounts_providers.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/cost_center_providers.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/budgets_screen.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'test_harness.dart';

class _BudgetApi extends ApiClient {
  _BudgetApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  int attempts=0;
  Object? body;
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async => {'items':[
    {'id':'budget','costCenterId':'old-center','accountId':'old-account',
      'costCenter':{'code':'OLD','nameEn':'Old center'},'account':{'code':'OLD','nameEn':'Old account'},
      'periodStart':'2026-01-01','periodEnd':'2026-12-31','amount':'12','notes':'original', 'isActive':true}]};
  @override
  Future<Map<String,dynamic>> patch(String path,{Object? body}) async {
    attempts++; this.body=body; throw StateError('PRIVATE_BUDGET_DIAGNOSTIC');
  }
}

class _BudgetAccounts extends ChartOfAccountsController {
  @override
  Future<List<Account>> build() async => const [
    Account(id:'old-account',companyId:'company',code:'OLD',name:'Old account',type:AccountType.expense,isActive:false),
    Account(id:'new-account',companyId:'company',code:'NEW',name:'New account',type:AccountType.expense),
  ];
}
const _user=AppUser(id:'user',username:'user',fullName:'User',companyId:'company',isSuperAdmin:true);

void main() {
  for (final failure in [false,true]) {
    testWidgets('budget editor protects ${failure ? 'uncertain save with unavailable selections' : 'routed draft'}', (tester) async {
      tester.view.physicalSize=const Size(1700,1000); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api=_BudgetApi();
      final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),currentUserProvider.overrideWithValue(_user),
        chartOfAccountsProvider.overrideWith(_BudgetAccounts.new),
        costCentersProvider.overrideWith((ref) async => [
          {'id':'old-center','code':'OLD','nameEn':'Old center','isActive':false},
          {'id':'new-center','code':'NEW','nameEn':'New center','isActive':true},
          {'id':'other-inactive','code':'OTHER','nameEn':'Other center','isActive':false}])]);
      addTearDown(container.dispose);
      final router=GoRouter(initialLocation:'/budgets',routes:[
        GoRoute(path:'/budgets',onExit:(_,state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
          builder:(_,state) => Scaffold(body:BudgetsScreen(navigationKey:state.pageKey))),
        GoRoute(path:'/home',builder:(_,_) => const Scaffold(body:Text('Home destination'))),
      ]);
      addTearDown(router.dispose);
      await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp.router(locale:const Locale('en'),
        localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
      await tester.pumpAndSettle();
      final edit=find.byTooltip('Edit'); await tester.ensureVisible(edit); await tester.pumpAndSettle();
      await tester.tap(edit); await tester.pumpAndSettle();
      expect(find.textContaining('Unavailable'),findsNWidgets(2));
      expect(find.textContaining('Other center'),findsNothing);
      final notes=find.widgetWithText(TextFormField,'Description');
      await tester.ensureVisible(notes); await tester.pumpAndSettle();
      await tester.enterText(notes,failure ? '' : 'Draft budget');
      if (failure) {
        await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pumpAndSettle();
        expect(find.text('حسنًا'),findsOneWidget);
        expect(find.textContaining('PRIVATE_BUDGET_DIAGNOSTIC'),findsNothing);
        await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
        expect(api.attempts,1);
        final body=api.body as Map;
        expect(body.containsKey('accountId'),isFalse);
        expect(body.containsKey('costCenterId'),isFalse);
        expect(body['notes'],'');
        expect(tester.widget<TextFormField>(notes).controller!.text,'');
        expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNull);
      } else {
        router.go('/home'); await tester.pumpAndSettle();
        expect(find.text('Unsaved changes'),findsOneWidget);
        await tester.tap(find.text('Cancel').last); await tester.pumpAndSettle();
        expect(tester.widget<TextFormField>(notes).controller!.text,'Draft budget');
        router.go('/home'); await tester.pumpAndSettle();
        await tester.tap(find.text('Discard changes')); await tester.pumpAndSettle();
        expect(find.text('Home destination'),findsOneWidget);
      }
      expect(tester.takeException(),isNull);
    });
  }
}
