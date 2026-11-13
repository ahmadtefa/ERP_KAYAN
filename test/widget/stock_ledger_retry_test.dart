import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'test_harness.dart';

class _StockRetryApi extends ApiClient {
  _StockRetryApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  int ledgerLoads = 0;
  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async => [
    {'itemId':'item-1', 'itemCode':'SYN-1', 'itemNameEn':'Synthetic item',
      'itemNameAr':'صنف تجريبي', 'unit':'piece', 'quantity':'2', 'averageCost':'1', 'value':'2'}
  ];
  @override
  Future<Map<String, dynamic>> getObject(String path, {Map<String, dynamic>? query}) async {
    if (path.contains('/ledger')) {
      if (++ledgerLoads == 1) throw StateError('Synthetic temporary error');
      return {'movements': <Object>[]};
    }
    return {};
  }
}

void main() {
  testWidgets('stock ledger retry reloads after a transient error', (tester) async {
    tester.view.physicalSize = const Size(1400, 1000); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api = _StockRetryApi();
    await tester.pumpWidget(ProviderScope(overrides: [
      apiClientProvider.overrideWithValue(api), currentUserProvider.overrideWithValue(testUser),
    ], child: MaterialApp(locale: const Locale('en'), localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales, home: const Scaffold(body: StockScreen()))));
    for (var i = 0; i < 8; i++) { await tester.pump(const Duration(milliseconds: 100)); }
    await tester.tap(find.text('SYN-1').first);
    for (var i = 0; i < 8; i++) { await tester.pump(const Duration(milliseconds: 100)); }
    await tester.tap(find.text('Retry'));
    for (var i = 0; i < 8; i++) { await tester.pump(const Duration(milliseconds: 100)); }
    expect(api.ledgerLoads, 2);
    expect(tester.takeException(), isNull);
  });
}
