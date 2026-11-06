import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/fiscal_periods_screen.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart' show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'test_harness.dart';

class _FiscalApi extends ApiClient {
  _FiscalApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  int attempts=0;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => [
    {'id':'period','code':'2026','nameEn':'Period','nameAr':'فترة',
      'startDate':'2026-01-01','endDate':'2026-12-31','isClosed':false}];
  @override
  Future<Map<String,dynamic>> patch(String path,{Object? body}) async {
    attempts++; throw StateError('PRIVATE_PERIOD_DIAGNOSTIC');
  }
}

void main() {
  for (final failure in [false,true]) {
    testWidgets('fiscal period editor protects ${failure ? 'uncertain save' : 'routed draft'}', (tester) async {
      tester.view.physicalSize=const Size(1700,1000); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api=_FiscalApi();
      final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),
        exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)]);
      addTearDown(container.dispose);
      final router=GoRouter(initialLocation:'/periods',routes:[
        GoRoute(path:'/periods',onExit:(_,state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
          builder:(_,state) => Scaffold(body:FiscalPeriodsScreen(navigationKey:state.pageKey))),
        GoRoute(path:'/home',builder:(_,_) => const Scaffold(body:Text('Home destination'))),
      ]);
      addTearDown(router.dispose);
      await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp.router(locale:const Locale('en'),
        localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
      await tester.pumpAndSettle();
      final edit=find.byTooltip('Edit');
      await tester.ensureVisible(edit); await tester.pumpAndSettle();
      await tester.tap(edit); await tester.pumpAndSettle();
      final name=find.widgetWithText(TextFormField,'Name in English');
      await tester.enterText(name,'Draft period');
      if (failure) {
        await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pumpAndSettle();
        expect(find.text('حسنًا'),findsOneWidget);
        expect(find.textContaining('PRIVATE_PERIOD_DIAGNOSTIC'),findsNothing);
        await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
        expect(api.attempts,1);
        expect(tester.widget<TextFormField>(name).controller!.text,'Draft period');
        expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNull);
      } else {
        router.go('/home'); await tester.pumpAndSettle();
        expect(find.text('Unsaved changes'),findsOneWidget);
        await tester.tap(find.text('Cancel').last); await tester.pumpAndSettle();
        expect(tester.widget<TextFormField>(name).controller!.text,'Draft period');
        router.go('/home'); await tester.pumpAndSettle();
        await tester.tap(find.text('Discard changes')); await tester.pumpAndSettle();
        expect(find.text('Home destination'),findsOneWidget);
      }
      expect(tester.takeException(),isNull);
    });
  }
}
