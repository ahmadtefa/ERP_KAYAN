import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart' show exportCapabilitiesProvider, ExportCapabilities;
import 'package:erp_kayan/features/inventory/presentation/screens/items_screen.dart';
import 'package:erp_kayan/features/inventory/presentation/screens/warehouses_screen.dart';
import 'package:erp_kayan/features/parties/presentation/screens/parties_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

class _MasterDataApi extends ApiClient {
  _MasterDataApi() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  @override
  Future<List<Map<String,dynamic>>> getList(String path,{Map<String,dynamic>? query}) async => [];
}

void main() {
  for (final kind in ['item','customer','supplier','warehouse']) {
    testWidgets('$kind form preserves a draft on routed navigation', (tester) async {
      tester.view.physicalSize=const Size(1700,1200); tester.view.devicePixelRatio=1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final container=ProviderContainer(overrides:[apiClientProvider.overrideWithValue(_MasterDataApi()),
        currentUserProvider.overrideWithValue(const AppUser(id:'test',username:'test',fullName:'Test',
          companyId:'synthetic',permissions:['inventory.warehouses.manage'])),
        exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown)]);
      addTearDown(container.dispose);
      final router=GoRouter(initialLocation:'/data',routes:[
        GoRoute(path:'/data',onExit:(_,state) => container.read(draftExitGuardProvider).canLeave(state.pageKey),
          builder:(_,state) => Scaffold(body:kind == 'item'
            ? ItemsScreen(navigationKey:state.pageKey)
            : kind == 'warehouse' ? WarehousesScreen(navigationKey:state.pageKey)
            : PartiesScreen(kind:kind == 'customer' ? PartyKind.customer : PartyKind.supplier,navigationKey:state.pageKey))),
        GoRoute(path:'/home',builder:(_,_) => const Scaffold(body:Text('Home destination'))),
      ]);
      addTearDown(router.dispose);
      await tester.pumpWidget(UncontrolledProviderScope(container:container,child:MaterialApp.router(locale:const Locale('en'),
        localizationsDelegates:AppLocalizations.localizationsDelegates,supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
      await tester.pumpAndSettle();
      final newTitle=kind == 'item' ? 'New item' : kind == 'customer' ? 'New customer' : kind == 'warehouse' ? 'New warehouse' : 'New supplier';
      await tester.tap(find.text(newTitle).first); await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextFormField,'Code'),'SYN');
      router.go('/home'); await tester.pumpAndSettle();
      expect(find.text('Unsaved changes'),findsOneWidget);
      await tester.tap(find.text('Cancel').last); await tester.pumpAndSettle();
      expect(find.text('Home destination'),findsNothing);
      expect(tester.widget<TextFormField>(find.widgetWithText(TextFormField,'Code')).controller!.text,'SYN');
      router.go('/home'); await tester.pumpAndSettle();
      await tester.tap(find.text('Discard changes')); await tester.pumpAndSettle();
      expect(find.text('Home destination'),findsOneWidget);
      expect(find.widgetWithText(TextFormField,'Code'),findsNothing);
      expect(tester.takeException(),isNull);
    });
  }
}
