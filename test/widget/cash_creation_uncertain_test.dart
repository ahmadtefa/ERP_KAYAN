import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/cash/presentation/providers/cash_providers.dart';
import 'package:erp_kayan/features/cash/presentation/screens/cash_screen.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart' show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _CommittedTransferApi extends ApiClient {
  _CommittedTransferApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  int posts = 0;
  bool committed = false;
  Object? submitted;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async {
    if (path == '/cash/accounts') return [
      {'id':'a','code':'A','nameEn':'Box A','isActive':true},
      {'id':'b','code':'B','nameEn':'Box B','isActive':true},
    ];
    if (path == '/cash/transfers' && committed) return [
      {'id':'transfer','transferNumber':'T-1','status':'DRAFT','amount':'12.5'}
    ];
    return [];
  }
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async => {'rows':<Object>[]};
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) async {
    expect(path,'/cash/transfers');
    posts++; submitted=body; committed=true;
    throw StateError('PRIVATE_TRANSFER_ERROR');
  }
}
void main() {
  testWidgets('cash transfer retains values and disables retry when POST outcome is unknown', (tester) async {
    tester.view.physicalSize=const Size(1700,1000); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api=_CommittedTransferApi();
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),
      exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp(
      locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
      supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:CashScreen()))));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Transfers')); await tester.pumpAndSettle();
    expect(await container.read(cashTransfersProvider.future),isEmpty);
    await tester.tap(find.widgetWithText(FilledButton,'New transfer')); await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>).first); await tester.pumpAndSettle();
    await tester.tap(find.text('A — Box A').last); await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>).last); await tester.pumpAndSettle();
    await tester.tap(find.text('B — Box B').last); await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextFormField,'Amount'),'12.5');
    await tester.enterText(find.widgetWithText(TextFormField,'Description'),'Draft retained');
    await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pumpAndSettle();
    expect(find.text('حسنًا'),findsOneWidget);
    expect(find.textContaining('PRIVATE_TRANSFER_ERROR'),findsNothing);
    await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
    expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField,'Amount')).controller!.text,'12.5');
    expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField,'Description')).controller!.text,'Draft retained');
    expect(find.textContaining('operation may have completed'),findsOneWidget);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNull);
    expect(api.posts,1);
    expect((api.submitted as Map)['fromCashAccountId'],'a');
    expect((api.submitted as Map)['toCashAccountId'],'b');
    expect((await container.read(cashTransfersProvider.future)).single['transferNumber'],'T-1');
    expect(tester.takeException(),isNull);
  });
}
