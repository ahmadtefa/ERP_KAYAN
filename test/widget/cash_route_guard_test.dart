import 'dart:async';

import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/cash/presentation/screens/cash_screen.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart' show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

class _CashGuardApi extends ApiClient {
  _CashGuardApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  final response=Completer<Map<String,dynamic>>();
  int posts=0;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async {
    if (path == '/accounting/chart-of-accounts') {
      return [{'id':'ledger','code':'111','nameEn':'Ledger','isPostable':true}];
    }
    return [];
  }
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async => {'rows':<Object>[]};
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) {
    posts++;
    return response.future;
  }
}

void main() {
  for (final pending in [false,true]) {
    testWidgets('cash account form guards routed exit ${pending ? 'during submit' : 'with a draft'}', (tester) async {
      tester.view.physicalSize=const Size(1700,1000); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api=_CashGuardApi();
      final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),
        exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)]);
      addTearDown(container.dispose);
      final router=GoRouter(initialLocation:'/cash',routes:[
        GoRoute(path:'/cash',onExit:(_,state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
          builder:(_,state) => Scaffold(body:CashScreen(navigationKey:state.pageKey))),
        GoRoute(path:'/home',builder:(_,_) => const Scaffold(body:Text('Home destination'))),
      ]);
      addTearDown(router.dispose);
      await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp.router(locale:const Locale('en'),
        localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton,'New box or bank')); await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextFormField,'Code'),'SYN');
      if (pending) {
        await tester.enterText(find.widgetWithText(TextFormField,'Name in English'),'Synthetic');
        await tester.enterText(find.widgetWithText(TextFormField,'Name in Arabic'),'تجريبي');
        await tester.tap(find.byType(DropdownButtonFormField<String>).last); await tester.pumpAndSettle();
        await tester.tap(find.text('111 — Ledger').last); await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pump();
        expect(api.posts,1);
        router.go('/home'); await tester.pumpAndSettle();
        expect(find.text('Home destination'),findsNothing);
        expect(find.widgetWithText(TextFormField,'Code'),findsOneWidget);
        api.response.complete({'id':'account'}); await tester.pumpAndSettle();
        router.go('/home'); await tester.pumpAndSettle();
        expect(find.text('Home destination'),findsOneWidget);
      } else {
        router.go('/home'); await tester.pumpAndSettle();
        expect(find.text('Unsaved changes'),findsOneWidget);
        await tester.tap(find.text('Cancel').last); await tester.pumpAndSettle();
        expect(find.text('Home destination'),findsNothing);
        expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField,'Code')).controller!.text,'SYN');
        router.go('/home'); await tester.pumpAndSettle();
        expect(find.text('Unsaved changes'),findsOneWidget);
        await tester.tap(find.text('Discard changes')); await tester.pumpAndSettle();
        expect(find.text('Home destination'),findsOneWidget);
        expect(find.widgetWithText(TextFormField,'Code'),findsNothing);
      }
      expect(tester.takeException(),isNull);
    });
  }
}
