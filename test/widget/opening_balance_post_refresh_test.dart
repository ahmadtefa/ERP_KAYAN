import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/journal_entries_screen.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/opening_balances_screen.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/dashboard/presentation/providers/dashboard_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/providers/stock_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _OpeningApi extends ApiClient {
  _OpeningApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  String status='draft';
  int posts=0;
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async => {
    'id':'opening','documentNumber':'OPEN-1','status':status,'lines':<Object>[]};
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => [
    {'status':status}
  ];
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) async {
    posts++;
    status='posted';
    throw StateError('INTERNAL_OPENING_DIAGNOSTIC');
  }
}

void main() {
  testWidgets('opening post reloads document and dependent views after uncertain response', (tester) async {
    tester.view.physicalSize=const Size(1500,1000); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api=_OpeningApi();
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api)]);
    addTearDown(container.dispose);
    final stockSubscription=container.listen(stockListProvider,(_,_) {});
    final journalSubscription=container.listen(journalEntriesProvider,(_,_) {});
    addTearDown(stockSubscription.close);
    addTearDown(journalSubscription.close);
    expect((await container.read(stockListProvider.future)).single['status'],'draft');
    expect((await container.read(journalEntriesProvider.future)).single['status'],'draft');
    expect((await container.read(dashboardSummaryProvider.future))['status'],'draft');
    expect((await container.read(dashboardMonthlyProvider.future))['status'],'draft');
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp(
      locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
      supportedLocales:AppLocalizations.supportedLocales,
      home:const Scaffold(body:OpeningBalancesScreen(documentId:'opening')))));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton,'Post')); await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton,'Post').last); await tester.pumpAndSettle();
    expect(find.text('حسنًا'),findsOneWidget);
    expect(find.textContaining('INTERNAL_OPENING_DIAGNOSTIC'),findsNothing);
    await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
    expect(api.posts,1);
    expect(find.text('Posted'),findsOneWidget);
    expect((await container.read(stockListProvider.future)).single['status'],'posted');
    expect((await container.read(journalEntriesProvider.future)).single['status'],'posted');
    expect((await container.read(dashboardSummaryProvider.future))['status'],'posted');
    expect((await container.read(dashboardMonthlyProvider.future))['status'],'posted');
  });
}
