import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/common/presentation/providers/resource_providers.dart';
import 'package:erp_kayan/features/quotations/presentation/screens/quotation_editor_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  bool fail = true;
  bool unexpected = false;
  int updates = 0;
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async {
    if (fail) {
      if (unexpected) throw StateError('internal diagnostic should not be shown');
      throw const NetworkFailure();
    }
    return {'quotationDate':'2026-01-01','subject':'existing offer','tables':<Object>[]};
  }
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => [];
  @override
  Future<Map<String,dynamic>> put(String path,{Object? body}) async { updates++; return {}; }
}

void main() {
  for (final unexpected in [false,true]) {
    testWidgets('failed quotation load is not editable and can retry (unexpected=$unexpected)', (tester) async {
      tester.view.physicalSize = const Size(1500,1000); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api = _Api()..unexpected=unexpected;
      await tester.pumpWidget(ProviderScope(overrides:[apiClientProvider.overrideWithValue(api),
        itemsProvider.overrideWith((ref) async => []),customersProvider.overrideWith((ref) async => [])],
        child:MaterialApp(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
          supportedLocales:AppLocalizations.supportedLocales,home:const QuotationEditorScreen(quotationId:'offer'))));
      await tester.pumpAndSettle();
      expect(find.text('حسنًا'),findsOneWidget);
      expect(find.textContaining('internal diagnostic'),findsNothing);
      await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNull);
      expect(find.byKey(const ValueKey('quotation-subject')),findsNothing);
      expect(api.updates,0);
      api.fail=false;
      await tester.tap(find.byKey(const Key('quotation-retry-load'))); await tester.pumpAndSettle();
      expect(tester.widget<TextField>(find.byKey(const ValueKey('quotation-subject'))).controller!.text,'existing offer');
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Save')).onPressed,isNotNull);
    });
  }
}
