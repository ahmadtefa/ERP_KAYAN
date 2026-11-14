import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/licensing/data/licence_data_source.dart';
import 'package:erp_kayan/features/licensing/presentation/providers/licence_providers.dart';
import 'package:erp_kayan/features/licensing/presentation/screens/licence_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../widget/test_harness.dart';

class _FailureApi extends ApiClient {
  _FailureApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) async =>
      throw StateError('INTERNAL_LICENCE_DIAGNOSTIC');
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async =>
      throw StateError('INTERNAL_LICENCE_DIAGNOSTIC');
}
final _status=LicenceStatus.fromJson({'state':'ACTIVE','blocked':false,'configured':true,'enforcement':'enforce'});

void main() {
  testWidgets('licence action error is acknowledged without exposing details or clearing input', (tester) async {
    tester.view.physicalSize=const Size(1400,1400); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(ProviderScope(overrides:[apiClientProvider.overrideWithValue(_FailureApi()),
      licenceStatusProvider.overrideWith((ref) async => _status)],child:MaterialApp(
      locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
      supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:LicenceScreen()))));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byType(TextField));
    await tester.enterText(find.byType(TextField),'synthetic-input-not-a-key');
    await tester.ensureVisible(find.text('Apply key'));
    await tester.tap(find.text('Apply key')); await tester.pumpAndSettle();
    expect(find.text('حسنًا'),findsOneWidget);
    expect(find.textContaining('INTERNAL_LICENCE_DIAGNOSTIC'),findsNothing);
    await tester.tapAt(const Offset(5,5)); await tester.pumpAndSettle();
    expect(find.text('حسنًا'),findsOneWidget);
    await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text,'synthetic-input-not-a-key');
    expect(tester.takeException(),isNull);
  });
  testWidgets('licence status error is safe and acknowledged before retry', (tester) async {
    tester.view.physicalSize=const Size(1400,1000); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(ProviderScope(overrides:[licenceStatusProvider.overrideWith((ref) async =>
      throw StateError('INTERNAL_LICENCE_DIAGNOSTIC'))],child:MaterialApp(
      locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
      supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:LicenceScreen()))));
    await tester.pumpAndSettle();
    expect(find.text('حسنًا'),findsOneWidget);
    expect(find.textContaining('INTERNAL_LICENCE_DIAGNOSTIC'),findsNothing);
    await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
    expect(find.byTooltip('Retry'),findsOneWidget);
    expect(tester.takeException(),isNull);
  });
}
