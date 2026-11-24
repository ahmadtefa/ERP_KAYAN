import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart' show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/invoicing/presentation/screens/invoice_list_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'test_harness.dart';

class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'), FakeTokenStore());
  final sent = <String>[];
  Object? body;
  bool blockPost = false;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => [
    {'id':'invoice','createdBy':'author','invoiceNumber':'SYN-1','invoiceDate':'2026-11-04','status':'draft','totalAmount':'5'},
  ];
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async => {};
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) async {
    sent.add(path); this.body = body;
    if (blockPost) throw const ApiFailure('Private balance 123456789', statusCode:409,code:'CUSTOMER_CREDIT_LIMIT_EXCEEDED'); return {'approved':true};
  }
}
void main() {
  Future<void> pump(WidgetTester tester, _Api api, AppUser user) async {
    tester.view.physicalSize = const Size(1700,1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(ProviderScope(overrides:[
      apiClientProvider.overrideWithValue(api), currentUserProvider.overrideWithValue(user),
      exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown),
    ],child: MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
      supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:InvoiceListScreen(kind:InvoiceKind.sales)))));
    await tester.pumpAndSettle();
  }
  testWidgets('approver without posting permission approves with reason and never posts', (tester) async {
    final api=_Api();
    await pump(tester,api,const AppUser(id:'reviewer',username:'reviewer',fullName:'Reviewer',companyId:'c',permissions:['sales.invoices.read','sales.credit.approve']));
    expect(find.byTooltip('Post'),findsNothing);
    await tester.tap(find.byTooltip('Approve credit-limit exception'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton,'Save'));
    await tester.pumpAndSettle();
    expect(api.sent,isEmpty);
    await tester.enterText(find.byType(TextFormField),'x');
    await tester.tap(find.widgetWithText(FilledButton,'Save'));
    await tester.pumpAndSettle();
    expect(api.sent,isEmpty);
    expect(find.text('At least 3 characters'),findsOneWidget);
    await tester.enterText(find.byType(TextFormField),'Reviewed this invoice');
    await tester.tap(find.widgetWithText(FilledButton,'Save'));
    await tester.pumpAndSettle();
    expect(api.sent,['/sales/invoices/invoice/credit-approval']);
    expect(api.body,{'reason':'Reviewed this invoice'});
    expect(find.textContaining('The invoice was not posted.'),findsOneWidget);
  });
  testWidgets('credit block displays a safe explanation, not the server balance sentence', (tester) async {
    final api=_Api()..blockPost=true;
    await pump(tester,api,const AppUser(id:'seller',username:'s',fullName:'Seller',companyId:'c',permissions:['sales.invoices.post']));
    await tester.tap(find.byTooltip('Post'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton,'Post'));
    await tester.pumpAndSettle();
    expect(find.textContaining('The invoice is still a draft.'),findsOneWidget);
    expect(find.textContaining('123456789'),findsNothing);
    expect(api.sent,['/sales/invoices/invoice/post']);
  });
  testWidgets('author cannot see selfapproval and unpermitted user has no approval action', (tester) async {
    final api=_Api();
    await pump(tester,api,const AppUser(id:'author',username:'a',fullName:'Author',companyId:'c',permissions:['sales.credit.approve']));
    expect(find.byTooltip('Approve credit-limit exception'),findsNothing);
  });
}
