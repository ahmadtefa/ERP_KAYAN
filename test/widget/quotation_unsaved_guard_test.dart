import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/common/presentation/providers/resource_providers.dart';
import 'package:erp_kayan/features/quotations/presentation/screens/quotation_editor_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async => {
    'quotationDate':'2026-01-01','subject':'stored subject','tables':<Object>[],
  };
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => [];
}

void main() {
  for (final editing in [false,true]) {
    testWidgets('${editing ? 'existing' : 'new'} quotation preserves dirty values across navigation cancellation', (tester) async {
      tester.view.physicalSize = const Size(1500,1000); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final container = ProviderContainer(overrides:[apiClientProvider.overrideWithValue(_Api()),
        itemsProvider.overrideWith((ref) async => []),customersProvider.overrideWith((ref) async => [])]);
      addTearDown(container.dispose);
      final router = GoRouter(initialLocation:'/',routes:[
        GoRoute(path:'/',builder:(context,state) => Scaffold(body:TextButton(
          onPressed:() => context.push('/quote'),child:const Text('Open quotation')))),
        GoRoute(path:'/quote',onExit:(_,state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
          builder:(context,state) => Scaffold(body:Column(children:[
            TextButton(key:const Key('navigate-home'),onPressed:() => context.go('/'),child:const Text('Home')),
            Expanded(child:QuotationEditorScreen(navigationKey:state.pageKey,quotationId:editing ? 'offer' : null)),
          ]))),
      ]);
      addTearDown(router.dispose);
      await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp.router(
        locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
        supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
      await tester.tap(find.text('Open quotation')); await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('quotation-editor-back'))); await tester.pumpAndSettle();
      expect(find.text('Open quotation'),findsOneWidget);
      await tester.tap(find.text('Open quotation')); await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('quotation-subject')),'keep this subject');
      await tester.tap(find.byKey(const Key('navigate-home'))); await tester.pumpAndSettle();
      expect(find.text('Unsaved changes'),findsOneWidget);
      await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
      expect(tester.widget<TextField>(find.byKey(const ValueKey('quotation-subject'))).controller!.text,'keep this subject');
      await tester.binding.handlePopRoute(); await tester.pumpAndSettle();
      expect(find.text('Unsaved changes'),findsOneWidget);
      await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('quotation-editor-back'))); await tester.pumpAndSettle();
      expect(find.text('Unsaved changes'),findsOneWidget);
      await tester.tap(find.text('Discard')); await tester.pumpAndSettle();
      expect(find.text('Open quotation'),findsOneWidget);
    });
  }
}
