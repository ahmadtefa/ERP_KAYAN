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
/// what the menu looks like. These render the real [ErpShell] in the states the
/// requirement names - everything closed, one section open, then a second
/// section opened - at the real 1440x900 desktop size.
///
/// The picture is written only when `MENU_SCREENSHOTS=1`, which the screenshot
/// job sets. The assertions below run in every job, so the behaviour is
/// enforced by the ordinary test suite; only the pixel comparison is limited to
/// the job that renders and uploads the images. A golden committed from a
/// machine that has never drawn the frame would be a guess, so the images are
/// produced on the runner and reviewed, not invented here.
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
/// filter. This picture is about the menu's shape; the filtered case is covered
/// by `erp_shell_groups_test.dart`.
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
      ..addFont(Future.value(ByteData.sublistView(await icons.readAsBytes())));
    await iconLoader.load();
  }
}

/// The menu itself. Every finder below is scoped to this, because the page
/// header repeats the current section's name - "نظرة عامة" is both a heading in
/// the menu and the eyebrow above the dashboard, and an unscoped `find.text`
/// matches both.
final _menu = find.byKey(const Key('erp-shell-nav-list'));

Finder _inMenu(String label) =>
    find.descendant(of: _menu, matching: find.text(label));

/// The eight headings, by the key the shell gives each one.
const _groupKeys = [
  'nav-group-overview',
  'nav-group-accounting',
  'nav-group-parties',
  'nav-group-inventory',
  'nav-group-sales',
  'nav-group-purchases',
  'nav-group-insights',
  'nav-group-administration',
];

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

/// Captures the frame when the picture job asked for it, and does nothing
/// otherwise, so the ordinary suite enforces the behaviour without needing a
/// committed image it could not have rendered.
Future<void> _shoot(WidgetTester tester, String name) async {
  if (Platform.environment['MENU_SCREENSHOTS'] != '1') return;
  await expectLater(
    find.byType(MaterialApp),
    matchesGoldenFile('goldens/$name.png'),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(_loadFonts);

  testWidgets('the menu shows eight sections and none of their items', (
    tester,
  ) async {
    await _pumpShell(tester);

    for (final key in _groupKeys) {
      expect(
        find.byKey(ValueKey(key)),
        findsOneWidget,
        reason: 'the main menu must show exactly these eight groups; $key is '
            'missing',
      );
    }
    // Nothing is open yet, so no section's items are on screen.
    for (final item in const [
      'المستودعات',
      'الدفعات',
      'فواتير البيع',
      'دليل الحسابات',
    ]) {
      expect(
        _inMenu(item),
        findsNothing,
        reason: '"$item" must stay hidden while its section is closed',
      );
    }

    await _shoot(tester, 'menu_closed_ar');
  });

  testWidgets('opening a section reveals its items', (tester) async {
    await _pumpShell(tester);

    await tester.tap(_inMenu('المخزون'));
    await tester.pumpAndSettle();

    expect(_inMenu('المستودعات'), findsOneWidget);
    expect(_inMenu('الدفعات'), findsOneWidget);

    await _shoot(tester, 'menu_inventory_open_ar');
  });

  testWidgets('opening a second section closes the first', (tester) async {
    await _pumpShell(tester);

    await tester.tap(_inMenu('المخزون'));
    await tester.pumpAndSettle();
    expect(_inMenu('المستودعات'), findsOneWidget);

    await tester.tap(_inMenu('المبيعات'));
    await tester.pumpAndSettle();

    expect(
      _inMenu('المستودعات'),
      findsNothing,
      reason: 'opening sales must close inventory, or the menu is not an '
          'accordion and grows without bound as sections are visited',
    );
    expect(
      _inMenu('فواتير البيع'),
      findsOneWidget,
      reason: 'the section that was just tapped must open',
    );
    // And the other seven headings are still there.
    for (final key in _groupKeys) {
      expect(find.byKey(ValueKey(key)), findsOneWidget);
    }

    await _shoot(tester, 'menu_sales_open_ar');
  });

  testWidgets('tapping the open section closes it again', (tester) async {
    await _pumpShell(tester);

    await tester.tap(_inMenu('المخزون'));
    await tester.pumpAndSettle();
    expect(_inMenu('المستودعات'), findsOneWidget);

    await tester.tap(_inMenu('المخزون'));
    await tester.pumpAndSettle();

    expect(
      _inMenu('المستودعات'),
      findsNothing,
      reason: 'a section must close when its own heading is tapped again',
    );
  });
}
