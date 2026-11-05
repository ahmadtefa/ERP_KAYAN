import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart' show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/features/inventory/presentation/screens/items_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _UnitAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(RequestOptions options,Stream<Uint8List>? requestStream,Future<void>? cancelFuture) async =>
    ResponseBody.fromString(jsonEncode({'items':[{'id':'unit','unit':'Carton','factor':'2','isBase':false,'isActive':true}]}),200,
      headers:const {Headers.contentTypeHeader:[Headers.jsonContentType]});
  @override
  void close({bool force=false}) {}
}

class _UnitApi extends ApiClient {
  _UnitApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore(),
    dio:Dio(BaseOptions(baseUrl:'http://127.0.0.1:3210/api/v1'))..httpClientAdapter=_UnitAdapter());
  int attempts=0;
  Object? submitted;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => [
    {'id':'item','code':'I','nameEn':'Synthetic item','nameAr':'صنف','unit':'piece','isActive':true}
  ];
  Future<Map<String,dynamic>> failure(Object? body) async {
    attempts++; submitted=body;
    throw StateError('PRIVATE_UNIT_DIAGNOSTIC');
  }
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) => failure(body);
  @override
  Future<Map<String,dynamic>> patch(String path,{Object? body}) => failure(body);
}

void main() {
  for (final editing in [false,true]) {
    testWidgets('item unit ${editing ? 'edit' : 'create'} retains draft and blocks uncertain retry', (tester) async {
      tester.view.physicalSize=const Size(1700,1200); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api=_UnitApi();
      await tester.pumpWidget(ProviderScope(overrides:[apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWithValue(const AppUser(id:'user',username:'user',fullName:'User',companyId:'company',isSuperAdmin:true)),
        exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)],
        child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
          supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:ItemsScreen()))));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Units & barcodes')); await tester.pumpAndSettle();
      if (editing) {
        await tester.tap(find.byTooltip('Edit unit'));
      } else {
        await tester.tap(find.widgetWithText(FilledButton,'Add unit / barcode'));
      }
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextFormField,'Unit name'),'Crate');
      await tester.enterText(find.widgetWithText(TextFormField,'Base units per unit'),'5');
      await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pumpAndSettle();
      expect(find.text('حسنًا'),findsOneWidget);
      expect(find.textContaining('PRIVATE_UNIT_DIAGNOSTIC'),findsNothing);
      await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
      expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField,'Unit name')).controller!.text,'Crate');
      expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField,'Base units per unit')).controller!.text,'5');
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNull);
      expect(find.textContaining('operation may have completed'),findsOneWidget);
      expect(api.attempts,1);
      expect((api.submitted as Map)['factor'],'5');
      expect(tester.takeException(),isNull);
    });
  }
  for (final canManageBarcode in [false,true]) {
    for (final editing in [false,true]) {
      testWidgets('unit ${editing ? 'edit' : 'create'} shows and submits barcode only for a barcode manager', (tester) async {
        tester.view.physicalSize=const Size(1700,1200); tester.view.devicePixelRatio=1;
        addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
        final api=_UnitApi();
        await tester.pumpWidget(ProviderScope(overrides:[apiClientProvider.overrideWithValue(api),
          currentUserProvider.overrideWithValue(AppUser(id:'user',username:'user',fullName:'User',companyId:'company',
            permissions:['inventory.items.read','inventory.items.update',if (canManageBarcode) 'inventory.barcodes.manage'])),
          exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)],
          child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
            supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:ItemsScreen()))));
        await tester.pumpAndSettle();
        await tester.tap(find.byTooltip('Units & barcodes')); await tester.pumpAndSettle();
        if (editing) {
          await tester.tap(find.byTooltip('Edit unit'));
        } else {
          await tester.tap(find.widgetWithText(FilledButton,'Add unit / barcode'));
        }
        await tester.pumpAndSettle();
        final barcode=find.widgetWithText(TextFormField,'Barcode');
        expect(barcode,canManageBarcode ? findsOneWidget : findsNothing);
        await tester.enterText(find.widgetWithText(TextFormField,'Unit name'),'Crate');
        await tester.enterText(find.widgetWithText(TextFormField,'Base units per unit'),'5');
        if (canManageBarcode) await tester.enterText(barcode,'SYN-CODE-123');
        await tester.tap(find.widgetWithText(FilledButton,'Save')); await tester.pumpAndSettle();
        expect(api.attempts,1);
        final body=api.submitted as Map;
        expect(body.containsKey('barcode'),canManageBarcode);
        if (canManageBarcode) expect(body['barcode'],'SYN-CODE-123');
        expect(tester.takeException(),isNull);
      });
    }
  }

}
