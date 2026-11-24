import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:erp_kayan/app/theme/app_theme.dart';
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
  CreditSummary? summary;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => [
    {'id':'invoice','createdBy':'author','invoiceNumber':'SYN-1','invoiceDate':'2026-11-04','status':'draft','totalAmount':'5'},
  ];
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async => {};
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) async {
    sent.add(path); this.body = body;
    if (blockPost) throw ApiFailure('Private balance 123456789', statusCode:409,code:'CUSTOMER_CREDIT_LIMIT_EXCEEDED',creditSummary:summary); return {'approved':true};
  }
}
void main() {
  final shot=GlobalKey();
  Future<void> pump(WidgetTester tester, _Api api, AppUser user, {bool arabic=false}) async {
    tester.view.physicalSize = const Size(1700,1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(RepaintBoundary(key:shot,child:ProviderScope(overrides:[
      apiClientProvider.overrideWithValue(api), currentUserProvider.overrideWithValue(user),
      exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown),
    ],child: MaterialApp(theme:AppTheme.dark(),debugShowCheckedModeBanner:false,locale:Locale(arabic?'ar':'en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
      supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:InvoiceListScreen(kind:InvoiceKind.sales))))));
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
  testWidgets('authorized structured credit figures are shown without server prose', (tester) async {
    final api=_Api()..blockPost=true..summary=const CreditSummary(creditLimit:'1000.0000',currentBalance:'800.0000',invoiceAmount:'400.0000',projectedBalance:'1200.0000');
    await pump(tester,api,const AppUser(id:'finance',username:'f',fullName:'Finance',companyId:'c',permissions:['sales.invoices.post']));
    await tester.tap(find.byTooltip('Post')); await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton,'Post')); await tester.pumpAndSettle();
    expect(find.textContaining('Credit limit: 1000.0000'),findsOneWidget);
    expect(find.textContaining('Balance after posting: 1200.0000'),findsOneWidget);
    expect(find.textContaining('123456789'),findsNothing);
  });
  testWidgets('Arabic authorized credit figures render proof', (tester) async {
    await tester.runAsync(() async {
      final font=FontLoader('IBMPlexSansArabic');
      font.addFont(Future.value(ByteData.sublistView(File('assets/fonts/IBMPlexSansArabic-Regular.ttf').readAsBytesSync())));
      await font.load();
      final icon=FontLoader('MaterialIcons');
      var dir=File(Platform.resolvedExecutable).parent;
      while(dir.path!=dir.parent.path) {
        final file=File('${dir.path}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
        if(file.existsSync()) {icon.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));await icon.load();break;}
        dir=dir.parent;
      }
    });
    final api=_Api()..blockPost=true..summary=const CreditSummary(creditLimit:'1000.0000',currentBalance:'800.0000',invoiceAmount:'400.0000',projectedBalance:'1200.0000');
    await pump(tester,api,const AppUser(id:'finance',username:'f',fullName:'Finance',companyId:'c',permissions:['sales.invoices.post']),arabic:true);
    final label=AppLocalizations.of(tester.element(find.byType(InvoiceListScreen))).post;
    await tester.tap(find.byTooltip(label));await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton,label));await tester.pumpAndSettle();
    expect(find.textContaining('حد الائتمان: 1000.0000'),findsOneWidget);
    expect(find.textContaining('الرصيد بعد الترحيل: 1200.0000'),findsOneWidget);
    expect(tester.takeException(),isNull);
    await tester.runAsync(() async {
      final boundary=shot.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      final image=await boundary.toImage();final data=await image.toByteData(format:ui.ImageByteFormat.png);
      final out=Directory(Platform.environment['KAYAN_SHOT_DIR'] ?? '${Directory.systemTemp.path}/kayan-shots')..createSync(recursive:true);
      File('${out.path}/credit-summary-ar.png').writeAsBytesSync(data!.buffer.asUint8List());
    });
  });
  testWidgets('author cannot see selfapproval and unpermitted user has no approval action', (tester) async {
    final api=_Api();
    await pump(tester,api,const AppUser(id:'author',username:'a',fullName:'Author',companyId:'c',permissions:['sales.credit.approve']));
    expect(find.byTooltip('Approve credit-limit exception'),findsNothing);
  });
}
