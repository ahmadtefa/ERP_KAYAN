import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/stock_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'test_harness.dart';

class _StockApi extends ApiClient {
  _StockApi(this.value) : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  final String? value;
  String code = 'SYN-1';
  int loads = 0;
  @override
  Future<List<Map<String, dynamic>>> getList(String path, {Map<String, dynamic>? query}) async {
    loads++;
    return [{'itemId':'item-1','itemCode':code,'itemNameEn':'Synthetic item','itemNameAr':'صنف',
      'unit':'piece','quantity':'2','averageCost':value,'value':value}];
  }
  @override
  Future<Map<String, dynamic>> getObject(String path, {Map<String, dynamic>? query}) async => {
    'movements':[{'date':'2026-11-04','referenceNumber':'SYN','direction':'in',
      'quantity':'2','unitCost':'7','totalCost':'14','runningQuantity':'2','runningValue':'14'}],
  };
}

void main() {
  testWidgets('stock refresh reads the source again and retains the search', (tester) async {
    tester.view.physicalSize = const Size(1400, 1000); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    const user = AppUser(id:'user',username:'tester',fullName:'Tester',companyId:'company',permissions:['inventory.stock.read']);
    final api = _StockApi('14');
    await tester.pumpWidget(ProviderScope(overrides:[apiClientProvider.overrideWithValue(api),currentUserProvider.overrideWithValue(user)],
      child: MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
        supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:StockScreen()))));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'SYN');
    expect(find.text('SYN-1'), findsOneWidget);
    api.code = 'SYN-2';
    await tester.tap(find.byTooltip('Refresh')); await tester.pumpAndSettle();
    expect(api.loads, 2);
    expect(find.text('SYN-2'), findsOneWidget);
    expect(find.text('SYN-1'), findsNothing);
    expect(tester.widget<TextField>(find.byType(TextField).first).controller!.text, 'SYN');
  });
  testWidgets('without cost permission neither stock values nor cost columns are shown', (tester) async {
    tester.view.physicalSize = const Size(1400, 1000); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    const user = AppUser(id:'user',username:'tester',fullName:'Tester',companyId:'company',permissions:['inventory.stock.read']);
    await tester.pumpWidget(ProviderScope(overrides:[
      apiClientProvider.overrideWithValue(_StockApi('14')), currentUserProvider.overrideWithValue(user),
    ], child: MaterialApp(locale: const Locale('en'), localizationsDelegates:AppLocalizations.localizationsDelegates,
      supportedLocales:AppLocalizations.supportedLocales, home:const Scaffold(body:StockScreen()))));
    await tester.pumpAndSettle();
    expect(find.textContaining('Total value'), findsNothing);
    expect(find.text('Average cost'), findsNothing);
    await tester.tap(find.text('SYN-1').first); await tester.pumpAndSettle();
    expect(find.text('Unit price'), findsNothing);
    expect(find.text('Line total'), findsNothing);
  });
  testWidgets('a missing cost is not silently summed as zero', (tester) async {
    tester.view.physicalSize = const Size(1400, 1000); tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    const user = AppUser(id:'user',username:'tester',fullName:'Tester',companyId:'company',
      permissions:['inventory.stock.read','inventory.cost.read']);
    await tester.pumpWidget(ProviderScope(overrides:[
      apiClientProvider.overrideWithValue(_StockApi(null)), currentUserProvider.overrideWithValue(user),
    ], child: MaterialApp(locale: const Locale('en'), localizationsDelegates:AppLocalizations.localizationsDelegates,
      supportedLocales:AppLocalizations.supportedLocales, home:const Scaffold(body:StockScreen()))));
    await tester.pumpAndSettle();
    expect(find.text('Total value: —'), findsOneWidget);
  });
}
