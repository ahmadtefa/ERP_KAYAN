import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/cost_center_providers.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/cost_centers_screen.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _StatusApi extends ApiClient {
  _StatusApi(this.active) : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  bool active;
  int calls=0;
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async => {'items':[
    {'id':'center','code':'CC','nameEn':'Synthetic','nameAr':'تجريبي','type':'DEPARTMENT','isActive':active}]};
  @override
  Future<Map<String,dynamic>> patch(String path,{Object? body}) async {
    calls++; active=!active;
    throw StateError('PRIVATE_CENTER_STATUS');
  }
}
void main() {
  for (final initialActive in [false,true]) {
    testWidgets('cost center ${initialActive ? 'deactivation' : 'activation'} refreshes after uncertain response', (tester) async {
      tester.view.physicalSize=const Size(1700,1000); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final api=_StatusApi(initialActive);
      const user=AppUser(id:'user',username:'user',fullName:'User',companyId:'company',isSuperAdmin:true);
      final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(api),currentUserProvider.overrideWithValue(user)]);
      addTearDown(container.dispose);
      expect((await container.read(activeCostCentersProvider.future)).length,initialActive ? 1 : 0);
      await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp(locale:const Locale('en'),
        localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,
        home:const Scaffold(body:CostCentersScreen()))));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip(initialActive ? 'Deactivate' : 'Activate')); await tester.pumpAndSettle();
      if (initialActive) {
        await tester.tap(find.widgetWithText(FilledButton,'Deactivate')); await tester.pumpAndSettle();
      }
      expect(find.text('حسنًا'),findsOneWidget);
      expect(find.textContaining('PRIVATE_CENTER_STATUS'),findsNothing);
      await tester.tap(find.text('حسنًا')); await tester.pumpAndSettle();
      expect(api.calls,1);
      expect(find.byTooltip(initialActive ? 'Activate' : 'Deactivate'),findsOneWidget);
      expect((await container.read(activeCostCentersProvider.future)).length,initialActive ? 0 : 1);
      expect(tester.takeException(),isNull);
    });
  }
}
