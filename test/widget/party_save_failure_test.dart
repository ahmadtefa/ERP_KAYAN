import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart' show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/features/parties/presentation/screens/parties_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _PartyApi extends ApiClient {
  _PartyApi({required this.existing}) : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  final bool existing;
  int attempts = 0;
  bool failActivationAfterCommit = false;
  bool activated = false;
  Map<String,dynamic>? submitted;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => existing
    ? [{'id':'party','code':'P-1','nameEn':'Original','nameAr':'أصل','isActive':!failActivationAfterCommit || activated}]
    : [];
  Future<Map<String,dynamic>> save(Object? body) async {
    attempts++;
    submitted=Map<String,dynamic>.from(body! as Map);
    if (attempts == 1) throw StateError('INTERNAL_PARTY_DIAGNOSTIC');
    return {'id':'party'};
  }
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) => save(body);
  @override
  Future<Map<String,dynamic>> patch(String path,{Object? body}) async {
    if (failActivationAfterCommit) {
      activated = true;
      throw StateError('INTERNAL_PARTY_DIAGNOSTIC');
    }
    return save(body);
  }
}

void main() {
  for (final kind in PartyKind.values) {
    testWidgets('${kind.name} activation failure reloads committed source', (tester) async {
      tester.view.physicalSize=const Size(1600,1200); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api=_PartyApi(existing:true)..failActivationAfterCommit=true;
      await tester.pumpWidget(ProviderScope(overrides:[apiClientProvider.overrideWithValue(api),
        appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1')),
        exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)],
        child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
          supportedLocales:AppLocalizations.supportedLocales,home:Scaffold(body:PartiesScreen(kind:kind)))));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Reactivate')); await tester.pumpAndSettle();
      expect(find.textContaining('INTERNAL_PARTY_DIAGNOSTIC'),findsNothing);
      expect(find.text('حسنًا'),findsOneWidget);
      await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
      expect(find.byTooltip('Deactivate'),findsOneWidget);
    });
  }
  for (final kind in PartyKind.values) {
    for (final editing in [false,true]) {
      testWidgets('${kind.name} ${editing ? 'edit' : 'create'} keeps input on save failure', (tester) async {
        tester.view.physicalSize=const Size(1600,1200); tester.view.devicePixelRatio=1;
        addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
        final api=_PartyApi(existing:editing);
        await tester.pumpWidget(ProviderScope(overrides:[apiClientProvider.overrideWithValue(api),
          appConfigProvider.overrideWithValue(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1')),
          exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)],
          child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
            supportedLocales:AppLocalizations.supportedLocales,home:Scaffold(body:PartiesScreen(kind:kind)))));
        await tester.pumpAndSettle();
        if (editing) {
          await tester.tap(find.byTooltip('Edit').first);
        } else {
          await tester.tap(find.text(kind == PartyKind.customer ? 'New customer' : 'New supplier').first);
        }
        await tester.pumpAndSettle();
        if (!editing) {
          await tester.enterText(find.widgetWithText(TextFormField,'Code'),'P-1');
          await tester.enterText(find.widgetWithText(TextFormField,'الاسم (عربي)'),'جهة');
        }
        await tester.enterText(find.widgetWithText(TextFormField,'Name (English)'),'Kept name');
        await tester.tap(find.text('Save').last); await tester.pumpAndSettle();
        expect(find.textContaining('INTERNAL_PARTY_DIAGNOSTIC'),findsNothing);
        await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
        expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField,'Name (English)')).controller!.text,'Kept name');
        await tester.tap(find.text('Save').last); await tester.pumpAndSettle();
        expect(api.attempts,2);
        expect(api.submitted,containsPair('nameEn','Kept name'));
      });
    }
  }
}
