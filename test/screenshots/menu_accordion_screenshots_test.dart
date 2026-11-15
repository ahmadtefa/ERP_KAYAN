import 'dart:io';

import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../widget/test_harness.dart';

/// Pictures of the main menu, so the accordion is looked at and not only
/// asserted.
///
/// `erp_shell_groups_test.dart` already proves that eight headings exist and
/// that one opens at a time, but a passing assertion cannot show a reviewer
/// what the menu looks like. These goldens render the real [ErpShell] in the
/// two states the requirement names - everything closed, and one group open -
/// at the real 1440x900 desktop size, and the figures are committed so the
/// next change to them is visible in a diff.
///
/// They are rendered from the same widget tree the application builds, not a
/// mock-up: the shell is the one `app_router.dart` mounts for every screen.
class _ShellApi extends ApiClient {
  _ShellApi()
    : super(
        AppConfig.forLocalServer('http://screenshot.invalid/api/v1'),
        FakeTokenStore(),
      );

  @override
  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? query,
  }) async => {'blocked': false};

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => {'blocked': false};
}

/// Every permission the menu can act on, so no heading is hidden by the access
/// filter. This golden is about the menu's shape, not about permissions -
/// `erp_shell_groups_test.dart` covers the filtered case.
const _admin = AppUser(
  id: 'u',
  username: 'admin',
  fullName: 'مدير النظام',
  companyId: 'c',
  permissions: [
    'accounting.chart.manage',
    'accounting.journal.post',
    'accounting.reports.read',
    'parties.customers.read',
    'parties.suppliers.read',
    'inventory.items.read',
    'inventory.warehouses.read',
    'inventory.stock.read',
    'inventory.reports.read',
    'sales.invoices.read',
    'sales.orders.read',
    'purchases.invoices.read',
    'purchases.orders.read',
    'reports.read',
    'settings.company.manage',
    'settings.users.manage',
    'notifications.manage',
  ],
);

Future<void> _loadFonts() async {
  final loader = FontLoader('IBMPlexSansArabic');
  for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
    final bytes = await File(
      'assets/fonts/IBMPlexSansArabic-$weight.ttf',
    ).readAsBytes();
    loader.addFont(Future.value(ByteData.sublistView(bytes)));
  }
  await loader.load();

  final roots = <String>{
    ?Platform.environment['FLUTTER_ROOT'],
    for (final part in (Platform.environment['PATH'] ?? '').split(
      Platform.isWindows ? ';' : ':',
    ))
      if (part.isNotEmpty) File(part).parent.path,
  };
  File? icons;
  for (final root in roots) {
    final candidate = File(
      '$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
    );
    if (candidate.existsSync()) {
      icons = candidate;
      break;
    }
  }
  if (icons != null) {
    final iconLoader = FontLoader('MaterialIcons')
      ..addFont(
        Future.value(ByteData.sublistView(await icons.readAsBytes())),
      );
    await iconLoader.load();
  }
}

Future<void> _pumpShell(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1440, 900);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final router = GoRouter(
    initialLocation: AppRoutes.dashboard,
    routes: [
      GoRoute(
        path: AppRoutes.dashboard,
        builder: (context, state) => ErpShell(
          currentPath: AppRoutes.dashboard,
          child: const Text('Dashboard'),
        ),
      ),
    ],
  );
  addTearDown(router.dispose);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        tokenStoreProvider.overrideWithValue(FakeTokenStore()),
        apiClientProvider.overrideWithValue(_ShellApi()),
        currentUserProvider.overrideWithValue(_admin),
      ],
      child: MaterialApp.router(
        debugShowCheckedModeBanner: false,
        locale: const Locale('ar'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        theme: AppTheme.light(),
        routerConfig: router,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(_loadFonts);

  testWidgets('screenshot: the eight sections, all closed (Arabic RTL)', (
    tester,
  ) async {
    await _pumpShell(tester);

    // The requirement, restated where the picture is taken: eight headings and
    // no section's items on screen until one is opened.
    for (final label in const [
      'نظرة عامة',
      'المحاسبة',
      'العملاء والموردون',
      'المخزون',
      'المبيعات',
      'المشتريات',
      'التحليل',
      'الإدارة والبيانات',
    ]) {
      expect(find.text(label), findsOneWidget, reason: 'missing heading $label');
    }

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/menu_closed_ar.png'),
    );
  });

  testWidgets('screenshot: one section opened, the rest closed (Arabic RTL)', (
    tester,
  ) async {
    await _pumpShell(tester);

    await tester.tap(find.text('المخزون'));
    await tester.pumpAndSettle();

    // Opening shows that group's items, and only that group's.
    expect(find.text('المستودعات'), findsOneWidget);
    expect(find.text('الدفعات'), findsOneWidget);
    // A neighbouring section stays closed, so the menu is an accordion and not
    // a list that grows without bound.
    for (final other in const [
      'نظرة عامة',
      'المحاسبة',
      'العملاء والموردون',
      'المبيعات',
      'المشتريات',
      'التحليل',
      'الإدارة والبيانات',
    ]) {
      expect(find.text(other), findsOneWidget, reason: '$other vanished');
    }

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/menu_inventory_open_ar.png'),
    );
  });

  testWidgets('opening a second section closes the first (Arabic RTL)', (
    tester,
  ) async {
    await _pumpShell(tester);

    await tester.tap(find.text('المخزون'));
    await tester.pumpAndSettle();
    expect(find.text('المستودعات'), findsOneWidget);

    await tester.tap(find.text('المبيعات'));
    await tester.pumpAndSettle();

    // The inventory items are gone: only one section is ever open.
    expect(
      find.text('المستودعات'),
      findsNothing,
      reason: 'opening sales must close inventory, or the menu is not an '
          'accordion',
    );
    expect(
      find.text('فواتير البيع'),
      findsOneWidget,
      reason: 'the section that was just tapped must open',
    );

    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('goldens/menu_sales_open_ar.png'),
    );
  });
}
