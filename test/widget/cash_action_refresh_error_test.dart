import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/journal_entries_screen.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/cash/presentation/providers/cash_providers.dart';
import 'package:erp_kayan/features/cash/presentation/screens/cash_screen.dart';
import 'package:erp_kayan/features/dashboard/presentation/providers/dashboard_providers.dart';
import 'package:erp_kayan/features/reports/presentation/report_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart' show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _CashApi extends ApiClient {
  _CashApi(this.status) : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  String status;
  int posts=0;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async {
    if (path == '/cash/vouchers') return [{'id':'voucher','voucherNumber':'C-1','status':status,'amount':'5','kind':'RECEIPT'}];
    if (path == '/cash/transfers') return [{'id':'transfer','transferNumber':'T-1','status':status,'amount':'5'}];
    if (path == '/accounting/journal-entries') return [{'id':'entry','status':status}];
    return [];
  }
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async => {'status':status,'rows':<Object>[]};
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) async {
    posts++; status=path.endsWith('/reverse') ? 'REVERSED' : 'POSTED';
    throw StateError('PRIVATE_CASH_DIAGNOSTIC');
  }
}
void main() {
  for (final entry in [
    (tab:'Receipts & payments', action:'Post', initial:'DRAFT', expected:'POSTED'),
    (tab:'Receipts & payments', action:'Reverse', initial:'POSTED', expected:'REVERSED'),
    (tab:'Transfers', action:'Post', initial:'DRAFT', expected:'POSTED'),
  ]) {
    testWidgets('cash ${entry.tab} ${entry.action} refreshes after uncertain response', (tester) async {
      tester.view.physicalSize=const Size(1700,1000); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api=_CashApi(entry.initial);
      final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),
        exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)]);
      addTearDown(container.dispose);
      expect((await container.read(dashboardSummaryProvider.future))['status'],entry.initial);
      expect((await container.read(dashboardMonthlyProvider.future))['status'],entry.initial);
      expect((await container.read(reportProvider('/reports/cash-flow').future))['status'],entry.initial);
      expect((await container.read(journalEntriesProvider.future)).single['status'],entry.initial);
      await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp(
        locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
        supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:CashScreen()))));
      await tester.pumpAndSettle();
      await tester.tap(find.text(entry.tab)); await tester.pumpAndSettle();
      await tester.tap(find.byTooltip(entry.action)); await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton,entry.action)); await tester.pumpAndSettle();
      expect(find.text('حسنًا'),findsOneWidget);
      expect(find.textContaining('PRIVATE_CASH_DIAGNOSTIC'),findsNothing);
      await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
      expect(api.posts,1);
      final list=entry.tab == 'Transfers' ? cashTransfersProvider : cashVouchersProvider;
      expect((await container.read(list.future)).single['status'],entry.expected);
      expect((await container.read(journalEntriesProvider.future)).single['status'],entry.expected);
      expect((await container.read(dashboardSummaryProvider.future))['status'],entry.expected);
      expect((await container.read(dashboardMonthlyProvider.future))['status'],entry.expected);
      expect((await container.read(reportProvider('/reports/cash-flow').future))['status'],entry.expected);
      expect(tester.takeException(),isNull);
    });
  }
}
