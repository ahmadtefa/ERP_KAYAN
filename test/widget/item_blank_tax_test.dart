import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart' show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/features/inventory/presentation/screens/items_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _ItemTaxApi extends ApiClient {
  _ItemTaxApi({required this.existing}) : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  final bool existing;
  Map<String,dynamic>? submitted;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => existing ? [
    {'id':'item','code':'I-1','nameEn':'Item','nameAr':'صنف','unit':'piece',
      'salePrice':'1','taxRate':'14','isStockTracked':true,'isActive':true}
  ] : [];
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) async {
    submitted=Map<String,dynamic>.from(body! as Map); return {'id':'item'};
  }
  @override
  Future<Map<String,dynamic>> patch(String path,{Object? body}) async {
    submitted=Map<String,dynamic>.from(body! as Map); return {'id':'item'};
  }
}

void main() {
  for (final editing in [false,true]) {
    testWidgets('blank item tax sends zero when ${editing ? 'editing' : 'creating'}', (tester) async {
      tester.view.physicalSize=const Size(1600,1200); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api=_ItemTaxApi(existing:editing);
      await tester.pumpWidget(ProviderScope(overrides:[apiClientProvider.overrideWithValue(api),
        appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1')),
        exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)],
        child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
          supportedLocales:AppLocalizations.supportedLocales,home:const ItemsScreen())));
      await tester.pumpAndSettle();
      if (editing) {
        await tester.tap(find.byTooltip('Edit').first);
      } else {
        await tester.tap(find.text('New item').first);
      }
      await tester.pumpAndSettle();
      if (!editing) {
        await tester.enterText(find.widgetWithText(TextFormField,'Code'),'I-1');
        await tester.enterText(find.widgetWithText(TextFormField,'Name (English)'),'Item');
        await tester.enterText(find.widgetWithText(TextFormField,'الاسم (عربي)'),'صنف');
      }
      final tax=find.widgetWithText(TextFormField,'Tax %');
      await tester.ensureVisible(tax);
      await tester.enterText(tax,'');
      await tester.tap(find.text('Save').last); await tester.pumpAndSettle();
      expect(api.submitted,containsPair('taxRate','0'));
    });
  }
}
