import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/cost_centers_screen.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

class _CostCenterApi extends ApiClient {
  _CostCenterApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  int attempts=0;
  Object? submitted;
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async => {'items':[
    {'id':'center','code':'CC','nameEn':'Synthetic','nameAr':'تجريبي','type':'DEPARTMENT',
      'isActive':true,'startDate':'2026-01-01','endDate':'2026-12-31','responsiblePerson':'Person','description':'Description'}]};
  @override
  Future<Map<String,dynamic>> patch(String path,{Object? body}) async {
    attempts++; submitted=body;
    throw StateError('PRIVATE_CENTER_DIAGNOSTIC');
  }
}

const _user=AppUser(id:'user',username:'user',fullName:'User',companyId:'company',isSuperAdmin:true);

void main() {
  testWidgets('cost center date clear is explicit and uncertain edit retains its draft', (tester) async {
    tester.view.physicalSize=const Size(1700,1200); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api=_CostCenterApi();
    await tester.pumpWidget(ProviderScope(overrides:[apiClientProvider.overrideWithValue(api),currentUserProvider.overrideWithValue(_user)],
      child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
        supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:CostCentersScreen()))));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Edit').first); await tester.pumpAndSettle();
    final end=find.widgetWithText(TextFormField,'End date');
    await tester.ensureVisible(end); await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Clear date').last); await tester.pumpAndSettle();
    final person=find.widgetWithText(TextFormField,'Responsible person');
    final description=find.byWidgetPredicate((widget) =>
        widget is TextFormField && widget.decoration?.labelText == 'Description');
    await tester.ensureVisible(person); await tester.pumpAndSettle();
    await tester.enterText(person,'');
    await tester.ensureVisible(description); await tester.pumpAndSettle();
    await tester.enterText(description,'');
    expect(tester.widget<TextFormField>(end).controller!.text,'');
    await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pumpAndSettle();
    expect(find.text('حسنًا'),findsOneWidget);
    expect(find.textContaining('PRIVATE_CENTER_DIAGNOSTIC'),findsNothing);
    await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
    expect((api.submitted as Map)['startDate'],'2026-01-01');
    expect((api.submitted as Map).containsKey('endDate'),isTrue);
    expect((api.submitted as Map)['endDate'],isNull);
    expect((api.submitted as Map)['responsiblePerson'],'');
    expect((api.submitted as Map)['description'],'');
    expect(tester.widget<TextFormField>(end).controller!.text,'');
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNull);
    expect(api.attempts,1);
    expect(tester.takeException(),isNull);
  });

  testWidgets('cost center draft guards routed navigation', (tester) async {
    tester.view.physicalSize=const Size(1700,1200); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(_CostCenterApi()),currentUserProvider.overrideWithValue(_user)]);
    addTearDown(container.dispose);
    final router=GoRouter(initialLocation:'/centers',routes:[
      GoRoute(path:'/centers',onExit:(_,state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
        builder:(_,state) => Scaffold(body:CostCentersScreen(navigationKey:state.pageKey))),
      GoRoute(path:'/home',builder:(_,_) => const Scaffold(body:Text('Home destination'))),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp.router(locale:const Locale('en'),
      localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Edit').first); await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextFormField,'Name in English'),'Draft name');
    router.go('/home'); await tester.pumpAndSettle();
    expect(find.text('Unsaved changes'),findsOneWidget);
    await tester.tap(find.text('Cancel').last); await tester.pumpAndSettle();
    expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField,'Name in English')).controller!.text,'Draft name');
    router.go('/home'); await tester.pumpAndSettle();
    await tester.tap(find.text('Discard changes')); await tester.pumpAndSettle();
    expect(find.text('Home destination'),findsOneWidget);
    expect(tester.takeException(),isNull);
  });
}
