import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/cash/presentation/screens/cash_screen.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart' show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _BalanceApi extends ApiClient {
  _BalanceApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  int balanceLoads=0;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => path == '/cash/accounts' ? [
    {'id':'a','code':'A','nameEn':'Box A','isActive':true},
    {'id':'b','code':'B','nameEn':'Box B','isActive':true},
    {'id':'c','code':'C','nameEn':'Box C','isActive':true},
  ] : [];
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async {
    if (path == '/cash/accounts/balances') {
      balanceLoads++;
      if (balanceLoads==1) throw const NetworkFailure('PRIVATE_BALANCE_DIAGNOSTIC');
      return {'rows':[{'cashAccountId':'a','code':'A','balance':'12.5000'},{'cashAccountId':'c','code':'C','balance':'0.0000'}]};
    }
    return {};
  }
}
void main() {
  testWidgets('cash balance failure and missing rows never display a false zero', (tester) async {
    tester.view.physicalSize=const Size(1700,1000); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api=_BalanceApi();
    await tester.pumpWidget(ProviderScope(overrides:[apiClientProvider.overrideWithValue(api),
      exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)],
      child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
        supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:CashScreen()))));
    await tester.pumpAndSettle();
    expect(find.text('0.00'),findsNothing);
    expect(find.text('—'),findsNWidgets(3));
    expect(find.textContaining('PRIVATE_BALANCE_DIAGNOSTIC'),findsNothing);
    await tester.tap(find.text('Retry')); await tester.pumpAndSettle();
    expect(api.balanceLoads,2);
    expect(find.text('12.50'),findsOneWidget);
    expect(find.text('0.00'),findsOneWidget);
    expect(find.text('—'),findsOneWidget);
    expect(tester.takeException(),isNull);
  });
}
