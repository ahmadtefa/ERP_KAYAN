import 'dart:async';

import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/settings/presentation/providers/company_providers.dart';
import 'package:erp_kayan/features/settings/presentation/screens/company_settings_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

Map<String,dynamic> _profile(String name) => {'id':'company','code':'C','nameAr':'شركة',
  'nameEn':name,'taxId':'','phone':'','email':'','address':'','hasLogo':false};
class _Profile extends CompanyProfileController {
  Completer<Map<String,dynamic>>? pending;
  Completer<String?>? pendingSave;
  @override
  Future<String?> updateProfile(Map<String,dynamic> patch) async => await pendingSave?.future;
  @override
  Future<Map<String,dynamic>> build() async => _profile('Original');
  @override
  Future<void> refresh() async {
    pending = Completer<Map<String,dynamic>>();
    state = const AsyncValue.loading();
    state = AsyncValue.data(await pending!.future);
  }
}
class _Branches extends BranchesController {
  @override
  Future<List<Map<String,dynamic>>> build() async => [];
}

void main() {
  testWidgets('saving a profile disables simultaneous logo actions', (tester) async {
    tester.view.physicalSize = const Size(1500,1200); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final container = ProviderContainer(overrides:[
      currentUserProvider.overrideWithValue(const AppUser(id:'u',username:'u',fullName:'u',companyId:'company',isSuperAdmin:true)),
      companyProfileProvider.overrideWith(_Profile.new),branchesProvider.overrideWith(_Branches.new),
    ]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp(locale:const Locale('en'),
      localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,
      home:const Scaffold(body:CompanySettingsScreen()))));
    await tester.pumpAndSettle();
    final controller = container.read(companyProfileProvider.notifier) as _Profile;
    controller.pendingSave = Completer<String?>();
    await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pump();
    expect(tester.widget<TextButton>(find.widgetWithText(TextButton,'Upload logo')).onPressed,isNull);
    controller.pendingSave!.complete(null); await tester.pumpAndSettle();
    expect(tester.widget<TextButton>(find.widgetWithText(TextButton,'Upload logo')).onPressed,isNotNull);
  });
  testWidgets('company draft survives refresh, blocks remote conflict and protects route exits', (tester) async {
    tester.view.physicalSize = const Size(1500,1200); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final container = ProviderContainer(overrides:[
      currentUserProvider.overrideWithValue(const AppUser(id:'u',username:'u',fullName:'u',companyId:'company',isSuperAdmin:true)),
      companyProfileProvider.overrideWith(_Profile.new),branchesProvider.overrideWith(_Branches.new),
    ]);
    addTearDown(container.dispose);
    final router = GoRouter(initialLocation:'/company',routes:[
      GoRoute(path:'/company',onExit:(_,state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
        builder:(context,state) => Scaffold(body:CompanySettingsScreen(navigationKey:state.pageKey))),
      GoRoute(path:'/home',builder:(_,_) => const Scaffold(body:Text('Home destination'))),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp.router(locale:const Locale('en'),
      localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
    await tester.pumpAndSettle();
    final englishName = find.byType(TextField).at(3);
    await tester.enterText(englishName,'Local changes');
    router.go('/home'); await tester.pumpAndSettle();
    expect(find.text('Unsaved changes'),findsOneWidget);
    await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
    expect(tester.widget<TextField>(englishName).controller!.text,'Local changes');
    final controller = container.read(companyProfileProvider.notifier) as _Profile;
    final refreshing = controller.refresh(); await tester.pump();
    expect(tester.widget<TextField>(englishName).controller!.text,'Local changes');
    controller.pending!.complete(_profile('Original')); await refreshing; await tester.pumpAndSettle();
    expect(tester.widget<TextField>(englishName).controller!.text,'Local changes');
    final conflicting = controller.refresh(); await tester.pump();
    controller.pending!.complete(_profile('Remote changes')); await conflicting; await tester.pumpAndSettle();
    expect(tester.widget<TextField>(englishName).controller!.text,'Local changes');
    expect(find.byKey(const Key('company-profile-reload-conflict')),findsOneWidget);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNull);
    await tester.tap(find.byKey(const Key('company-profile-reload-conflict'))); await tester.pumpAndSettle();
    await tester.tap(find.text('Discard')); await tester.pumpAndSettle();
    expect(tester.widget<TextField>(englishName).controller!.text,'Remote changes');
    router.go('/home'); await tester.pumpAndSettle();
    expect(find.text('Home destination'),findsOneWidget);
  });
}
