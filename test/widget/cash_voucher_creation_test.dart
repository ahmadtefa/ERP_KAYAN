import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/cash/presentation/screens/cash_screen.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart' show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _VoucherApi extends ApiClient {
  _VoucherApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  int invoiceLoads=0, posts=0;
  Object? submitted;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async {
    if (path == '/cash/accounts') return [{'id':'box','code':'A','nameEn':'Box A','isActive':true}];
    if (path == '/parties/customers' || path == '/parties/suppliers') {
      return [{'id':'party','code':'P','nameEn':'Partner','isActive':true}];
    }
    return [];
  }
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async {
    if (path.startsWith('/cash/open-invoices/')) {
      invoiceLoads++;
      if (invoiceLoads == 1) throw StateError('PRIVATE_LOOKUP_ERROR');
      return {'items':[{'id':'invoice','balance':'20.0000'}]};
    }
    return {'items':<Object>[],'rows':<Object>[]};
  }
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) async {
    expect(path,'/cash/vouchers'); posts++; submitted=body;
    throw StateError('PRIVATE_POST_ERROR');
  }
}
void main() {
  for (final receipt in [true,false]) {
    testWidgets('cash ${receipt ? 'receipt' : 'payment'} retains fields across lookup and uncertain create', (tester) async {
      tester.view.physicalSize=const Size(1700,1000); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api=_VoucherApi();
      await tester.pumpWidget(ProviderScope(overrides:[apiClientProvider.overrideWithValue(api),
        exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)],
        child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
          supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:CashScreen()))));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Receipts & payments')); await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton,'New receipt or payment')); await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pumpAndSettle();
      expect(find.byType(DropdownButtonFormField<String>),findsOneWidget);
      await tester.tap(find.byType(DropdownButtonFormField<String>)); await tester.pumpAndSettle();
      await tester.tap(find.text(receipt ? 'Receipt' : 'Payment').last); await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pumpAndSettle();
      await tester.tap(find.byType(DropdownButtonFormField<String>).first); await tester.pumpAndSettle();
      await tester.tap(find.text('A — Box A').last); await tester.pumpAndSettle();
      await tester.tap(find.byType(DropdownButtonFormField<String>).last); await tester.pumpAndSettle();
      await tester.tap(find.text('P — Partner').last); await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextFormField,'Amount'),'12.5');
      await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pumpAndSettle();
      expect(find.text('حسنًا'),findsOneWidget);
      expect(find.textContaining('PRIVATE_LOOKUP_ERROR'),findsNothing);
      await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
      expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField,'Amount')).controller!.text,'12.5');
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNotNull);
      expect(api.posts,0);
      await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pumpAndSettle();
      expect(find.text('حسنًا'),findsOneWidget);
      expect(find.textContaining('PRIVATE_POST_ERROR'),findsNothing);
      await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNull);
      expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField,'Amount')).controller!.text,'12.5');
      expect(api.invoiceLoads,2); expect(api.posts,1);
      final body=api.submitted as Map;
      expect(body['kind'],receipt ? 'RECEIPT' : 'PAYMENT');
      expect((body['allocations'] as List).single,{
        (receipt ? 'salesInvoiceId' : 'purchaseInvoiceId'):'invoice', 'amount':'12.5000'});
      expect(tester.takeException(),isNull);
    });
  }
}
