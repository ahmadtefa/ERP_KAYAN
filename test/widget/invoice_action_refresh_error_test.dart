import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/invoice_list_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'test_harness.dart';

class _CommittedThenFailedApi extends ApiClient {
  _CommittedThenFailedApi(this.status) : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  String status;
  int loads=0, posts=0;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async {
    loads++;
    return [{'id':'invoice','invoiceNumber':'SYN-1','invoiceDate':'2026-11-04','status':status,'totalAmount':'5'}];
  }
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) async {
    posts++;
    status = path.endsWith('/reverse') ? 'reversed' : 'posted';
    throw StateError('INTERNAL_INVOICE_ACTION_DIAGNOSTIC');
  }
}
void main() {
  for (final kind in InvoiceKind.values) {
    for (final reverse in [false,true]) {
      testWidgets('${kind.name} ${reverse ? 'reverse' : 'post'} refreshes after unexpected action failure', (tester) async {
        tester.view.physicalSize=const Size(1700,1000); tester.view.devicePixelRatio=1;
        addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
        final api=_CommittedThenFailedApi(reverse ? 'posted' : 'draft');
        await tester.pumpWidget(ProviderScope(overrides:[apiClientProvider.overrideWithValue(api)],
          child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
            supportedLocales:AppLocalizations.supportedLocales,home:Scaffold(body:InvoiceListScreen(kind:kind)))));
        await tester.pumpAndSettle();
        final action=reverse ? 'Reverse' : 'Post';
        await tester.tap(find.byTooltip(action)); await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(FilledButton,action)); await tester.pumpAndSettle();
        expect(find.text('حسنًا'),findsOneWidget);
        expect(find.textContaining('INTERNAL_INVOICE_ACTION_DIAGNOSTIC'),findsNothing);
        await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
        expect(api.posts,1); expect(api.loads,greaterThanOrEqualTo(2));
        expect(find.text(reverse ? 'Reversed' : 'Posted'),findsOneWidget);
      });
    }
  }
}
