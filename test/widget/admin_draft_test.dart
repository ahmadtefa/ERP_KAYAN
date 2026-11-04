import 'dart:async';

import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/admin/presentation/screens/admin_screen.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

class _AdminApi extends ApiClient {
  _AdminApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  bool failPatch = false;
  bool failRoleCreate = false;
  bool failRolesLoad = false;
  bool malformedRoles = false;
  bool malformedPermissions = false;
  bool malformedCatalogue = false;
  bool memberActive = true;
  bool roleDeleted = false;
  bool loseDeactivateResponse = false;
  bool loseDeleteResponse = false;
  Completer<void>? pendingDeactivate;
  int deletes = 0;
  int patches = 0;
  int posts = 0;
  int userReads = 0;
  Map<String,dynamic>? submitted;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async {
    if (path == '/admin/roles') {
      if (failRolesLoad) throw StateError('PRIVATE_ROLE_LOOKUP');
      if (roleDeleted) return [];
      return [{'id':'role-a','code':'ACTIVE','nameEn':'Available role','nameAr':'متاح', 'isSystem':false, 'permissions':['sales.invoices.read']}];
    }
    if (path == '/admin/users') {
      userReads++;
      return [{'id':'u2','username':'member','fullNameEn':'Original','fullNameAr':'أصلي','isActive':memberActive,
        'extraPermissions':malformedPermissions ? null : ['sales.invoices.read'], 'roles':malformedRoles ? null : [{'id':'role-a','code':'ACTIVE','nameEn':'Available role'},
          {'id':'role-b','code':'LEGACY','nameEn':'Unavailable role'}]}];
    }
    return [];
  }
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async => {
    if (!malformedCatalogue) 'items':[{'code':'sales.invoices.read','module':'sales','nameEn':'Read invoices','nameAr':'قراءة الفواتير'},
      {'code':'sales.invoices.write','module':'sales','nameEn':'Edit invoices','nameAr':'تعديل الفواتير'}],
  };
  @override
  Future<Map<String,dynamic>> get(String path,{Map<String,dynamic>? query}) async => {'items':[]};
  @override
  Future<Map<String,dynamic>> patch(String path,{Object? body}) async {
    patches++;
    submitted = Map<String,dynamic>.from(body! as Map);
    if (failPatch) throw StateError('PRIVATE_ADMIN_RESPONSE');
    return {};
  }
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) async {
    posts++;
    if (path.endsWith('/deactivate')) {
      if (pendingDeactivate != null) await pendingDeactivate!.future;
      memberActive = false;
      if (loseDeactivateResponse) throw StateError('PRIVATE_DEACTIVATE_RESPONSE');
      return {};
    }
    submitted = Map<String,dynamic>.from(body! as Map);
    if (failRoleCreate) throw StateError('PRIVATE_ROLE_RESPONSE');
    return {};
  }
  @override
  Future<Map<String,dynamic>> delete(String path) async {
    deletes++;
    roleDeleted = true;
    if (loseDeleteResponse) throw StateError('PRIVATE_DELETE_RESPONSE');
    return {};
  }
}

const _user=AppUser(id:'u1',username:'u1',fullName:'User',companyId:'company',isSuperAdmin:true);

Future<void> _screen(WidgetTester tester,_AdminApi api) async {
  tester.view.physicalSize=const Size(1700,1200); tester.view.devicePixelRatio=1;
  addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(ProviderScope(overrides:[apiClientProvider.overrideWithValue(api),currentUserProvider.overrideWithValue(_user)],
    child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
      supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:AdminScreen()))));
  await tester.pumpAndSettle();
}

Future<void> _openEdit(WidgetTester tester) async {
  final edit=find.byTooltip('Edit');
  await tester.ensureVisible(edit); await tester.pumpAndSettle();
  await tester.tap(edit); await tester.pumpAndSettle();
}

void main() {
  testWidgets('user edits preserve assigned and unavailable roles', (tester) async {
    final api=_AdminApi(); await _screen(tester,api); await _openEdit(tester);
    final available=find.widgetWithText(FilterChip,'ACTIVE — Available role');
    final unavailable=find.widgetWithText(FilterChip,'LEGACY — Unavailable role (unavailable)');
    expect(tester.widget<FilterChip>(available).selected,isTrue);
    expect(tester.widget<FilterChip>(unavailable).selected,isTrue);
    await tester.enterText(find.widgetWithText(TextFormField,'Name in English'),'Edited');
    await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pumpAndSettle();
    expect(api.patches,1);
    expect(api.submitted!.containsKey('roleIds'),isFalse);
    expect(api.submitted!.containsKey('isActive'),isFalse);
    expect(tester.takeException(),isNull);
  });

  testWidgets('user can explicitly remove an unavailable assigned role', (tester) async {
    final api=_AdminApi(); await _screen(tester,api); await _openEdit(tester);
    final unavailable=find.widgetWithText(FilterChip,'LEGACY — Unavailable role (unavailable)');
    await tester.ensureVisible(unavailable); await tester.pumpAndSettle();
    await tester.tap(unavailable); await tester.pumpAndSettle();
    expect(tester.widget<FilterChip>(unavailable).selected,isFalse);
    expect(tester.widget<FilterChip>(unavailable).onSelected,isNull);
    await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pumpAndSettle();
    expect(api.submitted!['roleIds'],['role-a']);
  });

  testWidgets('uncertain user edit retains draft and refreshes list', (tester) async {
    final api=_AdminApi()..failPatch=true; await _screen(tester,api); await _openEdit(tester);
    final field=find.widgetWithText(TextFormField,'Name in English');
    await tester.enterText(field,'Edited');
    await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pumpAndSettle();
    expect(find.text('حسنًا'),findsOneWidget);
    expect(find.textContaining('PRIVATE_ADMIN_RESPONSE'),findsNothing);
    await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
    expect(tester.widget<TextFormField>(field).controller!.text,'Edited');
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNull);
    expect(api.patches,1); expect(api.userReads,greaterThanOrEqualTo(2));
    expect(api.submitted!.containsKey('roleIds'),isFalse);
  });

  for (final malformed in [false,true]) {
    testWidgets('user editor fails safely for ${malformed ? 'incomplete user roles' : 'unavailable roles catalogue'}', (tester) async {
      final api=_AdminApi()..malformedRoles=malformed..failRolesLoad=!malformed;
      await _screen(tester,api); await _openEdit(tester);
      expect(find.text('حسنًا'),findsOneWidget);
      expect(find.textContaining('PRIVATE_ROLE_LOOKUP'),findsNothing);
      expect(find.text('Edit user'),findsNothing);
      expect(api.patches,0);
    });
  }

  testWidgets('user creation and password change inputs obscure sensitive text', (tester) async {
    final api=_AdminApi(); await _screen(tester,api);
    await tester.tap(find.widgetWithText(FilledButton,'New user')); await tester.pumpAndSettle();
    expect(tester.widget<TextField>(find.descendant(of:find.widgetWithText(TextFormField,'Password'),matching:find.byType(TextField))).obscureText,isTrue);
    await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
    final button=find.byTooltip('Change password');
    await tester.ensureVisible(button); await tester.pumpAndSettle();
    await tester.tap(button); await tester.pumpAndSettle();
    expect(tester.widget<TextField>(find.descendant(of:find.widgetWithText(TextFormField,'Password'),matching:find.byType(TextField))).obscureText,isTrue);
    expect(api.posts,0);
  });

  testWidgets('uncertain role creation retains fields without blind retry', (tester) async {
    final api=_AdminApi()..failRoleCreate=true; await _screen(tester,api);
    await tester.tap(find.widgetWithText(Tab,'Roles')); await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton,'New role')); await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextFormField,'Code'),'NEWROLE');
    final name=find.widgetWithText(TextFormField,'Name in English');
    await tester.enterText(name,'New role');
    await tester.enterText(find.widgetWithText(TextFormField,'Name in Arabic'),'دور');
    await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pumpAndSettle();
    expect(find.text('حسنًا'),findsOneWidget);
    expect(find.textContaining('PRIVATE_ROLE_RESPONSE'),findsNothing);
    await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
    expect(tester.widget<TextFormField>(name).controller!.text,'New role');
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNull);
    expect(api.posts,1);
  });

  for (final role in [false,true]) {
    testWidgets('${role ? 'role' : 'extra user'} permission editing preserves checked grants', (tester) async {
      final api=_AdminApi(); await _screen(tester,api);
      if (role) { await tester.tap(find.widgetWithText(Tab,'Roles')); await tester.pumpAndSettle(); }
      final action=find.byTooltip(role ? 'Edit permissions' : 'Extra permissions');
      await tester.ensureVisible(action); await tester.pumpAndSettle();
      await tester.tap(action); await tester.pumpAndSettle();
      final read=find.widgetWithText(CheckboxListTile,'Read invoices');
      expect(tester.widget<CheckboxListTile>(read).value,isTrue);
      if (!role) api.failPatch=true;
      await tester.tap(find.widgetWithText(CheckboxListTile,'Edit invoices')); await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pumpAndSettle();
      if (role) {
        expect(api.posts,1);
        expect(api.submitted!['permissions'],containsAll(['sales.invoices.read','sales.invoices.write']));
        expect(api.submitted!['expectedPermissions'],['sales.invoices.read']);
      } else {
        expect(find.text('حسنًا'),findsOneWidget);
        await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
        expect(tester.widget<CheckboxListTile>(read).value,isTrue);
        expect(tester.widget<CheckboxListTile>(find.widgetWithText(CheckboxListTile,'Edit invoices')).value,isTrue);
        expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNull);
        expect(api.submitted!['extraPermissions'],containsAll(['sales.invoices.read','sales.invoices.write']));
      }
    });
  }

  testWidgets('unchanged permissions are not sent over newer server grants', (tester) async {
    final api=_AdminApi(); await _screen(tester,api);
    final action=find.byTooltip('Extra permissions');
    await tester.ensureVisible(action); await tester.pumpAndSettle();
    await tester.tap(action); await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pumpAndSettle();
    expect(api.patches,0);
  });

  testWidgets('malformed permission sources never save an empty grant list', (tester) async {
    final api=_AdminApi()..malformedPermissions=true;
    await _screen(tester,api);
    final action=find.byTooltip('Extra permissions');
    await tester.ensureVisible(action); await tester.pumpAndSettle();
    await tester.tap(action); await tester.pumpAndSettle();
    expect(find.text('حسنًا'),findsOneWidget);
    expect(api.patches,0);
  });

  testWidgets('malformed permission catalogue disables save', (tester) async {
    final api=_AdminApi()..malformedCatalogue=true; await _screen(tester,api);
    final action=find.byTooltip('Extra permissions');
    await tester.ensureVisible(action); await tester.pumpAndSettle();
    await tester.tap(action); await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNull);
    expect(api.patches,0);
  });

  testWidgets('permissions draft guards route navigation', (tester) async {
    tester.view.physicalSize=const Size(1700,1200); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api=_AdminApi();
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),currentUserProvider.overrideWithValue(_user)]);
    addTearDown(container.dispose);
    final router=GoRouter(initialLocation:'/admin',routes:[
      GoRoute(path:'/admin',onExit:(_,state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
        builder:(_,state) => Scaffold(body:AdminScreen(navigationKey:state.pageKey))),
      GoRoute(path:'/home',builder:(_,_) => const Scaffold(body:Text('Home destination'))),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp.router(locale:const Locale('en'),
      localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
    await tester.pumpAndSettle();
    final action=find.byTooltip('Extra permissions');
    await tester.ensureVisible(action); await tester.pumpAndSettle();
    await tester.tap(action); await tester.pumpAndSettle();
    final grant=find.widgetWithText(CheckboxListTile,'Edit invoices');
    await tester.tap(grant); await tester.pumpAndSettle();
    router.go('/home'); await tester.pumpAndSettle();
    expect(find.text('Unsaved changes'),findsOneWidget);
    await tester.tap(find.text('Cancel').last); await tester.pumpAndSettle();
    expect(tester.widget<CheckboxListTile>(grant).value,isTrue);
    router.go('/home'); await tester.pumpAndSettle();
    await tester.tap(find.text('Discard changes')); await tester.pumpAndSettle();
    expect(find.text('Home destination'),findsOneWidget);
    expect(api.patches,0);
  });

  testWidgets('admin status refreshes after a lost deactivation response', (tester) async {
    final api=_AdminApi()..loseDeactivateResponse=true; await _screen(tester,api);
    final deactivate=find.byTooltip('Deactivate');
    await tester.ensureVisible(deactivate); await tester.pumpAndSettle();
    await tester.tap(deactivate); await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton,'Deactivate')); await tester.pumpAndSettle();
    expect(find.text('حسنًا'),findsOneWidget);
    expect(find.textContaining('PRIVATE_DEACTIVATE_RESPONSE'),findsNothing);
    await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
    expect(find.byTooltip('Reactivate'),findsOneWidget);
    expect(api.userReads,greaterThanOrEqualTo(2));
    expect(api.posts,1);
  });

  testWidgets('role deletion refreshes after a lost response', (tester) async {
    final api=_AdminApi()..loseDeleteResponse=true; await _screen(tester,api);
    await tester.tap(find.widgetWithText(Tab,'Roles')); await tester.pumpAndSettle();
    final remove=find.byTooltip('Delete role');
    await tester.ensureVisible(remove); await tester.pumpAndSettle();
    await tester.tap(remove); await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton,'Delete role')); await tester.pumpAndSettle();
    expect(find.text('حسنًا'),findsOneWidget);
    expect(find.textContaining('PRIVATE_DELETE_RESPONSE'),findsNothing);
    await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
    expect(find.text('Available role'),findsNothing);
    expect(api.deletes,1);
  });

  testWidgets('admin action blocks routed exit until it finishes', (tester) async {
    tester.view.physicalSize=const Size(1700,1200); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api=_AdminApi()..pendingDeactivate=Completer<void>();
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),currentUserProvider.overrideWithValue(_user)]);
    addTearDown(container.dispose);
    final router=GoRouter(initialLocation:'/admin',routes:[
      GoRoute(path:'/admin',onExit:(_,state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
        builder:(_,state) => Scaffold(body:AdminScreen(navigationKey:state.pageKey))),
      GoRoute(path:'/home',builder:(_,_) => const Scaffold(body:Text('Home destination'))),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp.router(locale:const Locale('en'),
      localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
    await tester.pumpAndSettle();
    final deactivate=find.byTooltip('Deactivate');
    await tester.ensureVisible(deactivate); await tester.pumpAndSettle();
    await tester.tap(deactivate); await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton,'Deactivate')); await tester.pumpAndSettle();
    expect(api.posts,1);
    router.go('/home'); await tester.pumpAndSettle();
    expect(find.text('Home destination'),findsNothing);
    api.pendingDeactivate!.complete(); await tester.pumpAndSettle();
    router.go('/home'); await tester.pumpAndSettle();
    expect(find.text('Home destination'),findsOneWidget);
  });

  testWidgets('user draft guards route navigation', (tester) async {
    tester.view.physicalSize=const Size(1700,1200); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api=_AdminApi();
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),currentUserProvider.overrideWithValue(_user)]);
    addTearDown(container.dispose);
    final router=GoRouter(initialLocation:'/admin',routes:[
      GoRoute(path:'/admin',onExit:(_,state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
        builder:(_,state) => Scaffold(body:AdminScreen(navigationKey:state.pageKey))),
      GoRoute(path:'/home',builder:(_,_) => const Scaffold(body:Text('Home destination'))),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp.router(locale:const Locale('en'),
      localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
    await tester.pumpAndSettle(); await _openEdit(tester);
    final field=find.widgetWithText(TextFormField,'Name in English');
    await tester.enterText(field,'Draft');
    router.go('/home'); await tester.pumpAndSettle();
    expect(find.text('Unsaved changes'),findsOneWidget);
    await tester.tap(find.text('Cancel').last); await tester.pumpAndSettle();
    expect(tester.widget<TextFormField>(field).controller!.text,'Draft');
    router.go('/home'); await tester.pumpAndSettle();
    await tester.tap(find.text('Discard changes')); await tester.pumpAndSettle();
    expect(find.text('Home destination'),findsOneWidget);
    expect(api.patches,0);
  });
}
