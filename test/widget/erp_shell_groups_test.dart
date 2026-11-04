import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

class _Api extends ApiClient {
  _Api() : super(AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),FakeTokenStore());
  @override
  Future<Map<String,dynamic>> get(String path,{Map<String,dynamic>? query}) async => {'blocked':false};
  @override
  Future<Map<String,dynamic>> getObject(String path,{Map<String,dynamic>? query}) async => {};
}

void main() {
  for (final mobile in [false,true]) {
    testWidgets('${mobile ? 'drawer' : 'sidebar'} groups collapse and retain navigation permission', (tester) async {
      tester.view.physicalSize = Size(mobile ? 800 : 1500,900); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final router = GoRouter(initialLocation:AppRoutes.dashboard,routes:[
        for (final path in [AppRoutes.dashboard,AppRoutes.salesInvoices])
          GoRoute(path:path,builder:(context,state) => ErpShell(currentPath:path,child:Text('Screen $path'))),
      ]);
      addTearDown(router.dispose);
      await tester.pumpWidget(ProviderScope(overrides:[apiClientProvider.overrideWithValue(_Api()),
        currentUserProvider.overrideWithValue(const AppUser(id:'u',username:'u',fullName:'u',companyId:'c',
          permissions:['sales.invoices.read']))],
        child:MaterialApp.router(locale:const Locale('en'),localizationsDelegates:AppLocalizations.localizationsDelegates,
          supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
      await tester.pumpAndSettle();
      if (mobile) {
        await tester.tap(find.byIcon(Icons.menu_rounded)); await tester.pumpAndSettle();
      }
      final group = find.byKey(const ValueKey('nav-group-sales'));
      final invoice = find.widgetWithText(ListTile,'Sales invoices');
      await tester.ensureVisible(group);
      expect(invoice,findsOneWidget);
      await tester.tap(group); await tester.pumpAndSettle();
      expect(invoice,findsNothing);
      await tester.tap(group); await tester.pumpAndSettle();
      expect(invoice,findsOneWidget);
      await tester.tap(invoice); await tester.pumpAndSettle();
      expect(find.text('Screen ${AppRoutes.salesInvoices}'),findsOneWidget);
      if (mobile) {
        // Opening the drawer again also proves the same group state is used.
        await tester.tap(find.byIcon(Icons.menu_rounded)); await tester.pumpAndSettle();
      }
      await tester.ensureVisible(group);
      await tester.tap(group); await tester.pumpAndSettle();
      expect(invoice,findsNothing);
      router.go(AppRoutes.dashboard); await tester.pumpAndSettle();
      if (mobile) { await tester.tap(find.byIcon(Icons.menu_rounded)); await tester.pumpAndSettle(); }
      expect(invoice,findsNothing);
      await tester.ensureVisible(group); await tester.tap(group); await tester.pumpAndSettle();
      expect(invoice,findsOneWidget);
    });
  }
}
