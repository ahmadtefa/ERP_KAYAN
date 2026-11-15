import 'dart:async';
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

class _YearEndApi extends ApiClient {
  _YearEndApi({this.reconciliationFails=false}) : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  final response=Completer<Map<String,dynamic>>();
  bool closed=false;
  final bool reconciliationFails;
  int posts=0;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => [
    {'id':'period','code':'2026','nameEn':'Period','nameAr':'فترة',
      'startDate':'2026-01-01','endDate':'2026-12-31','isClosed':closed}];
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async {
    if (path.endsWith('closing-preview')) return {'blockers':[], 'warnings':[], 'totals':<String,dynamic>{}};
    if (reconciliationFails) throw StateError('PRIVATE_RECONCILIATION');
    return {'sections':[]};
  }
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) { posts++; return response.future; }
}

void main() {
  for (final pending in [false,true]) {
    testWidgets('year end dialog protects ${pending ? 'pending and uncertain close' : 'reason on routed navigation'}', (tester) async {
      tester.view.physicalSize=const Size(1700,1000); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api=_YearEndApi(reconciliationFails:!pending);
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
      final open=find.byTooltip('Year-end close'); await tester.ensureVisible(open); await tester.pumpAndSettle();
      await tester.tap(open); await tester.pumpAndSettle();
      if (!pending) {
        expect(find.textContaining('Reconciliation center could not be loaded'),findsOneWidget);
        expect(find.textContaining('PRIVATE_RECONCILIATION'),findsNothing);
      }
      final reason=find.widgetWithText(TextField,'Reason (optional)');
      await tester.enterText(reason,'Synthetic reason');
      if (pending) {
        await tester.tap(find.widgetWithText(FilledButton,'Close the year')); await tester.pump();
        expect(api.posts,1);
        router.go('/home'); await tester.pumpAndSettle();
        expect(find.text('Home destination'),findsNothing);
        expect(tester.widget<TextField>(reason).enabled,isFalse);
        api.closed=true; api.response.completeError(StateError('PRIVATE_CLOSE_DIAGNOSTIC'));
        await tester.pumpAndSettle();
        expect(find.text('حسنًا'),findsOneWidget);
        expect(find.textContaining('PRIVATE_CLOSE_DIAGNOSTIC'),findsNothing);
        await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
        expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Close the year')).onPressed,isNull);
        expect(tester.widget<TextField>(reason).controller!.text,'Synthetic reason');
        expect((await container.read(fiscalPeriodsListProvider.future)).single['isClosed'],isTrue);
        router.go('/home'); await tester.pumpAndSettle();
        expect(find.text('Unsaved changes'),findsOneWidget);
        await tester.tap(find.text('Cancel').last); await tester.pumpAndSettle();
        expect(api.posts,1);
      } else {
        router.go('/home'); await tester.pumpAndSettle();
        expect(find.text('Unsaved changes'),findsOneWidget);
        await tester.tap(find.text('Cancel').last); await tester.pumpAndSettle();
        expect(tester.widget<TextField>(reason).controller!.text,'Synthetic reason');
        router.go('/home'); await tester.pumpAndSettle();
        await tester.tap(find.text('Discard changes')); await tester.pumpAndSettle();
        expect(find.text('Home destination'),findsOneWidget);
      }
      expect(tester.takeException(),isNull);
    });
  }
}
