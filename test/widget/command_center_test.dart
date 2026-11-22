import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/dashboard/presentation/widgets/command_center.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

void main() {
  testWidgets('command center exposes only allowed destinations and navigates in Arabic RTL', (tester) async {
    tester.view.physicalSize = const Size(320, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    const user = AppUser(id: 'one', username: 'one', fullName: 'One', companyId: 'company',
      permissions: ['sales.invoices.read']);
    final router = GoRouter(initialLocation: AppRoutes.dashboard, routes: [
      GoRoute(path: AppRoutes.dashboard, builder: (context, _) => Scaffold(body: SingleChildScrollView(
        child: CommandCenter(user: user, arabic: true, l10n: AppLocalizations.of(context)),
      ))),
      GoRoute(path: AppRoutes.salesInvoices, builder: (_, _) => const Scaffold(body: Text('Sales destination'))),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(MaterialApp.router(locale: const Locale('ar'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales, routerConfig: router));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('command-sales')), findsOneWidget);
    expect(find.byKey(const ValueKey('command-purchases')), findsNothing);
    expect(find.byKey(const ValueKey('command-link-/sales/orders')), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.tap(find.byKey(const ValueKey('command-sales')));
    await tester.pumpAndSettle();
    expect(find.text('Sales destination'), findsOneWidget);
  });

  testWidgets('a fully authorized user sees all six module tiles in English', (tester) async {
    tester.view.physicalSize = const Size(1200, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    const user = AppUser(id: 'admin', username: 'admin', fullName: 'Admin', companyId: 'company', isSuperAdmin: true);
    await tester.pumpWidget(MaterialApp(locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: Builder(builder: (context) => CommandCenter(
        user: user, arabic: false, l10n: AppLocalizations.of(context),
      )))));
    await tester.pumpAndSettle();
    for (final key in ['sales', 'purchases', 'inventory', 'accounting', 'customers', 'suppliers']) {
      expect(find.byKey(ValueKey('command-$key')), findsOneWidget);
    }
    for (final entry in <String, Color>{
      'sales': const Color(0xFF2259CF),
      'purchases': const Color(0xFFCC6417),
      'inventory': const Color(0xFF218653),
      'accounting': const Color(0xFF7052B7),
      'customers': const Color(0xFFA34593),
      'suppliers': const Color(0xFFBB3F48),
    }.entries) {
      final tile = find.byKey(ValueKey('command-${entry.key}'));
      expect(tester.widget<Material>(find.ancestor(of: tile, matching: find.byType(Material)).first).color,
        entry.value);
    }
    expect(tester.takeException(), isNull);
  });
}
