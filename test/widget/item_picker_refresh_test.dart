import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/common/presentation/providers/resource_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:erp_kayan/shared/widgets/item_picker_dialog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'test_harness.dart';

class _MutableItemApi extends ApiClient {
  _MutableItemApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  List<Map<String,dynamic>> rows=[{'id':'old','code':'OLD-1','nameEn':'Old item','unit':'piece','isActive':true}];
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => rows;
}

void main() {
  testWidgets('item picker displays fresh active source after invalidation', (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize=const Size(1400,900); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final api=_MutableItemApi();
    final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),currentUserProvider.overrideWithValue(null)]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp(
      locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
      supportedLocales:AppLocalizations.supportedLocales,home:const Scaffold(body:ItemPickerDialog()))));
    await tester.pumpAndSettle();
    expect(find.text('OLD-1'),findsOneWidget);
    api.rows=[{'id':'old','code':'OLD-1','nameEn':'Old item','unit':'piece','isActive':false},
      {'id':'new','code':'NEW-2','nameEn':'New item','unit':'piece','isActive':true}];
    container.invalidate(itemsProvider); await tester.pumpAndSettle();
    expect(find.text('OLD-1'),findsNothing);
    expect(find.text('NEW-2'),findsOneWidget);
  });
}
