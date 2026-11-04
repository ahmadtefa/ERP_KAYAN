import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/common/presentation/providers/resource_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart' show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/features/inventory/presentation/screens/items_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _ItemStatusApi extends ApiClient {
  _ItemStatusApi(this.active) : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  bool active;
  int attempts=0;
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => [
    {'id':'item','code':'I','nameEn':'Synthetic item','nameAr':'صنف','unit':'piece','isActive':active}
  ];
  @override
  Future<Map<String,dynamic>> post(String path,{Object? body,String? idempotencyKey}) async {
    attempts++; active=false;
    throw StateError('PRIVATE_ITEM_STATUS');
  }
  @override
  Future<Map<String,dynamic>> patch(String path,{Object? body}) async {
    attempts++; active=true;
    throw StateError('PRIVATE_ITEM_STATUS');
  }
}
void main() {
  for (final initialActive in [false,true]) {
    testWidgets('item ${initialActive ? 'deactivation' : 'activation'} refreshes after uncertain response', (tester) async {
      tester.view.physicalSize=const Size(1700,1000); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api=_ItemStatusApi(initialActive);
      final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),
        exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)]);
      addTearDown(container.dispose);
      expect((await container.read(activeItemsProvider.future)).length,initialActive ? 1 : 0);
      await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp(locale:const Locale('en'),
        localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,
        home:const Scaffold(body:ItemsScreen()))));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip(initialActive ? 'Deactivate' : 'Reactivate')); await tester.pumpAndSettle();
      if (initialActive) {
        await tester.tap(find.widgetWithText(FilledButton,'Deactivate')); await tester.pumpAndSettle();
      }
      expect(find.text('حسنًا'),findsOneWidget);
      expect(find.textContaining('PRIVATE_ITEM_STATUS'),findsNothing);
      await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
      expect(api.attempts,1);
      expect(find.byTooltip(initialActive ? 'Reactivate' : 'Deactivate'),findsOneWidget);
      expect((await container.read(activeItemsProvider.future)).length,initialActive ? 0 : 1);
      expect(tester.takeException(),isNull);
    });
  }
}
