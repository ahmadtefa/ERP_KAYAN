import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart' show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/features/invoicing/presentation/providers/invoice_providers.dart';
import 'package:erp_kayan/features/dashboard/presentation/providers/dashboard_providers.dart';
import 'package:erp_kayan/features/reports/presentation/report_providers.dart';
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
  bool responseLost=true;
  bool serverFailure=false;
  bool stockShortfall=false;
  String? postingCode;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async {
    loads++;
    return [{'id':'invoice','invoiceNumber':'SYN-1','invoiceDate':'2026-11-04','status':status,'totalAmount':'5'}];
  }
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async => {'status':status};
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) async {
    posts++;
    if (postingCode != null) throw ApiFailure('synthetic-private-do-not-display', statusCode:400, code:postingCode);
    if (stockShortfall) throw const ApiFailure('الرصيد غير كافٍ في الدفعات المتاحة: ينقص 2.0000. / Not enough stock in the available lots: 2.0000 short.', statusCode: 400);
    status = path.endsWith('/reverse') ? 'reversed' : 'posted';
    if (responseLost && serverFailure) throw const ApiFailure('بيانات مصطنعة خاصة لا تعرض', statusCode: 503);
    if (responseLost) throw StateError('INTERNAL_INVOICE_ACTION_DIAGNOSTIC');
    return {'status':status};
  }
}
void main() {
  for (final locale in const [Locale('ar'), Locale('en')]) {
    testWidgets('sales posting explains stock shortfall in ${locale.languageCode}', (tester) async {
      tester.view.physicalSize=const Size(1700,1000); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api=_CommittedThenFailedApi('draft')..stockShortfall=true;
      await tester.pumpWidget(ProviderScope(overrides:[currentUserProvider.overrideWithValue(const AppUser(id:'operator',username:'operator',fullName:'Operator',companyId:'c',isSuperAdmin:true)),apiClientProvider.overrideWithValue(api),
        exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)],
        child:MaterialApp(locale:locale,localizationsDelegates:AppLocalizations.localizationsDelegates,
          supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:InvoiceListScreen(kind:InvoiceKind.sales)))));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip(locale.languageCode == 'ar' ? 'ترحيل' : 'Post'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, locale.languageCode == 'ar' ? 'ترحيل' : 'Post'));
      await tester.pumpAndSettle();
      expect(find.textContaining('2.0000'), findsOneWidget);
      expect(find.textContaining('البيانات المرسلة غير صالحة'), findsNothing);
      expect(api.status, 'draft');
    });
  }
  testWidgets('structured sales refusal is actionable Arabic with support code and keeps draft', (tester) async {
    tester.view.physicalSize=const Size(1700,1000); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    await tester.runAsync(() async {
      final font=FontLoader('IBMPlexSansArabic');
      font.addFont(Future.value(ByteData.sublistView(File('assets/fonts/IBMPlexSansArabic-Regular.ttf').readAsBytesSync())));await font.load();
      final icon=FontLoader('MaterialIcons');var dir=File(Platform.resolvedExecutable).parent;
      while(dir.path!=dir.parent.path) { final file=File('${dir.path}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
        if(file.existsSync()) {icon.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));await icon.load();break;} dir=dir.parent; }
    });
    final shot=GlobalKey();
    final api=_CommittedThenFailedApi('draft')..postingCode='SALES_POST_BRANCH_STOCK';
    await tester.pumpWidget(RepaintBoundary(key:shot,child:ProviderScope(overrides:[currentUserProvider.overrideWithValue(const AppUser(id:'operator',username:'operator',fullName:'Operator',companyId:'c',isSuperAdmin:true)),apiClientProvider.overrideWithValue(api),exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)],child:MaterialApp(theme:AppTheme.light(),locale:const Locale('ar'),localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:InvoiceListScreen(kind:InvoiceKind.sales))))));
    await tester.pumpAndSettle();await tester.tap(find.byTooltip('ترحيل'));await tester.pumpAndSettle();await tester.tap(find.widgetWithText(FilledButton,'ترحيل'));await tester.pumpAndSettle();
    expect(find.textContaining('مخزون الفرع غير كافٍ'),findsOneWidget);expect(find.textContaining('SALES_POST_BRANCH_STOCK'),findsOneWidget);
    expect(find.textContaining('synthetic-private'),findsNothing);expect(api.status,'draft');expect(api.posts,1);
    final output=Platform.environment['KAYAN_SCREENSHOT_DIR'];
    if(output!=null) { await tester.runAsync(() async {
      final boundary=shot.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      final image=await boundary.toImage();final bytes=await image.toByteData(format:ui.ImageByteFormat.png);
      Directory(output).createSync(recursive:true);File('$output/sales-post-safe-reason-ar.png').writeAsBytesSync(bytes!.buffer.asUint8List());
    }); }
  });
  testWidgets('successful invoice posting refreshes previously cached reports', (tester) async {
    tester.view.physicalSize=const Size(1700,1000); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api=_CommittedThenFailedApi('draft')..responseLost=false;
    final container=ProviderContainer(overrides:[currentUserProvider.overrideWithValue(const AppUser(id:'operator',username:'operator',fullName:'Operator',companyId:'c',isSuperAdmin:true)),apiClientProvider.overrideWithValue(api),
      exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)]);
    addTearDown(container.dispose);
    expect((await container.read(reportProvider('/reports/trial-balance').future))['status'],'draft');
    await tester.pumpWidget(UncontrolledProviderScope(container:container,
      child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
        supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:InvoiceListScreen(kind:InvoiceKind.sales)))));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Post')); await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton,'Post')); await tester.pumpAndSettle();
    expect(api.posts,1);
    expect((await container.read(reportProvider('/reports/trial-balance').future))['status'],'posted');
    expect(tester.takeException(),isNull);
  });
  testWidgets('invoice action keeps a server failure status and hides its Arabic body', (tester) async {
    tester.view.physicalSize=const Size(1700,1000); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api=_CommittedThenFailedApi('draft')..serverFailure=true;
    await tester.pumpWidget(ProviderScope(overrides:[currentUserProvider.overrideWithValue(const AppUser(id:'operator',username:'operator',fullName:'Operator',companyId:'c',isSuperAdmin:true)),apiClientProvider.overrideWithValue(api),
      exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)],
      child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
        supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:InvoiceListScreen(kind:InvoiceKind.sales)))));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Post')); await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton,'Post')); await tester.pumpAndSettle();
    expect(find.textContaining('بيانات مصطنعة خاصة'), findsNothing);
    expect(find.textContaining('result could not be confirmed'), findsOneWidget);
    await tester.tap(find.text('OK')); await tester.pumpAndSettle();
    expect(find.text('Posted'), findsOneWidget);
    expect(api.posts,1);
  });
  for (final kind in InvoiceKind.values) {
    for (final reverse in [false,true]) {
      testWidgets('${kind.name} ${reverse ? 'reverse' : 'post'} refreshes after unexpected action failure', (tester) async {
        tester.view.physicalSize=const Size(1700,1000); tester.view.devicePixelRatio=1;
        addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
        final api=_CommittedThenFailedApi(reverse ? 'posted' : 'draft');
        final container=ProviderContainer(overrides:[currentUserProvider.overrideWithValue(const AppUser(id:'operator',username:'operator',fullName:'Operator',companyId:'c',isSuperAdmin:true)),apiClientProvider.overrideWithValue(api),
          exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)]);
        addTearDown(container.dispose);
        expect((await container.read(dashboardSummaryProvider.future))['status'],reverse ? 'posted' : 'draft');
        expect((await container.read(dashboardMonthlyProvider.future))['status'],reverse ? 'posted' : 'draft');
        expect((await container.read(reportProvider('/reports/trial-balance').future))['status'],reverse ? 'posted' : 'draft');
        await tester.pumpWidget(UncontrolledProviderScope(container:container,
          child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
            supportedLocales:AppLocalizations.supportedLocales,home:Scaffold(body:InvoiceListScreen(kind:kind)))));
        await tester.pumpAndSettle();
        final action=reverse ? 'Reverse' : 'Post';
        await tester.tap(find.byTooltip(action)); await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(FilledButton,action)); await tester.pumpAndSettle();
        expect(find.text('OK'),findsOneWidget);
        expect(find.textContaining('INTERNAL_INVOICE_ACTION_DIAGNOSTIC'),findsNothing);
        await tester.tap(find.text('OK')); await tester.pumpAndSettle();
        expect(api.posts,1); expect(api.loads,greaterThanOrEqualTo(2));
        expect((await container.read(dashboardSummaryProvider.future))['status'],reverse ? 'reversed' : 'posted');
        expect((await container.read(dashboardMonthlyProvider.future))['status'],reverse ? 'reversed' : 'posted');
        expect((await container.read(reportProvider('/reports/trial-balance').future))['status'],reverse ? 'reversed' : 'posted');
        expect(find.text(reverse ? 'Reversed' : 'Posted'),findsOneWidget);
      });
    }
  }
}
