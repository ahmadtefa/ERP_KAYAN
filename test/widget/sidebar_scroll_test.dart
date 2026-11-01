import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

/// The menu keeps its place.
///
/// The bug this pins: choosing an item near the bottom of the menu threw the
/// list back to the top, so a person browsing «المخازن» or «الإعدادات» had to
/// scroll down again after every click. The cause was structural - every route
/// built its own shell, so every navigation made a new State with a new
/// `ScrollController` starting at zero - and the fix is structural too: one
/// shell (`StatefulShellRoute` in the real app, `ShellRoute` here) whose State,
/// controller and stored offset outlive the navigation.
///
/// These tests would fail against the old shape: they check the offset *after*
/// the click, not merely that the clicked page opened.
void main() {
  final routes = <String>[
    AppRoutes.dashboard,
    AppRoutes.journalEntries,
    AppRoutes.fiscalPeriods,
    AppRoutes.customers,
    AppRoutes.suppliers,
    AppRoutes.items,
    AppRoutes.stock,
    AppRoutes.salesInvoices,
    AppRoutes.quotations,
    AppRoutes.salesReturns,
    AppRoutes.purchaseInvoices,
    AppRoutes.reports,
    AppRoutes.importData,
    AppRoutes.administration,
    AppRoutes.settings,
  ];

  // The route that is actually open, recorded where it is built: the page body
  // is behind the licence gate, so the check must not depend on the body's
  // text rendering in a test that has no licence.
  late String currentRoute;

  GoRouter buildRouter() => GoRouter(
    initialLocation: AppRoutes.dashboard,
    routes: [
      // A shell route, not one shell per route: the frame is built once and
      // only the child changes, exactly like the product's root
      // `StatefulShellRoute`.
      ShellRoute(
        builder: (context, state, child) =>
            ErpShell(currentPath: state.uri.path, child: child),
        routes: [
          for (final route in routes)
            GoRoute(
              path: route,
              builder: (context, state) {
                currentRoute = state.matchedLocation;
                return Text('page ${state.matchedLocation}');
              },
            ),
        ],
      ),
    ],
  );

  final overrides = [
    tokenStoreProvider.overrideWithValue(FakeTokenStore()),
    authRepositoryProvider.overrideWithValue(FakeAuthRepository()),
  ];

  Widget app(GoRouter router, {Locale locale = const Locale('en')}) {
    return ProviderScope(
      overrides: overrides,
      child: MaterialApp.router(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        routerConfig: router,
      ),
    );
  }

  Finder navList() => find.byKey(const Key('erp-shell-nav-list'));

  double offsetOf(WidgetTester tester) {
    final scrollable = find.descendant(
      of: navList(),
      matching: find.byType(Scrollable),
    );
    return tester.state<ScrollableState>(scrollable).position.pixels;
  }

  Future<void> openTallWindow(WidgetTester tester) async {
    // Tall enough for every module, short enough that the menu must scroll:
    // 1366 x 420 leaves roughly seven rows of the sixteen visible.
    tester.view.physicalSize = const Size(1366, 420);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
  }

  Future<void> scrollTo(WidgetTester tester, String label) async {
    final target = find.widgetWithText(ListTile, label);
    await tester.scrollUntilVisible(
      target,
      150.0,
      scrollable: find.descendant(
        of: navList(),
        matching: find.byType(Scrollable),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('a lower item is reachable, and opening it does not jump to the top', (
    tester,
  ) async {
    await openTallWindow(tester);
    final router = buildRouter();
    await tester.pumpWidget(app(router));
    await tester.pumpAndSettle();

    expect(offsetOf(tester), 0);

    // Browse down to an item near the bottom. Opening it must leave the menu
    // where the person left it.
    await scrollTo(tester, 'Reports');
    final beforeClick = offsetOf(tester);
    expect(
      beforeClick,
      greaterThan(0),
      reason: 'the menu had to scroll to reach Reports',
    );

    await tester.tap(find.widgetWithText(ListTile, 'Reports'));
    await tester.pumpAndSettle();

    expect(currentRoute, AppRoutes.reports);
    expect(
      offsetOf(tester),
      closeTo(beforeClick, 1),
      reason: 'the menu must not jump back to the top on selection',
    );
  });

  testWidgets('moving between two lower sections keeps the place each time', (
    tester,
  ) async {
    await openTallWindow(tester);
    final router = buildRouter();
    await tester.pumpWidget(app(router));
    await tester.pumpAndSettle();

    await scrollTo(tester, 'Sales invoices');
    final atSales = offsetOf(tester);
    await tester.tap(find.widgetWithText(ListTile, 'Sales invoices'));
    await tester.pumpAndSettle();
    expect(currentRoute, AppRoutes.salesInvoices);
    expect(offsetOf(tester), closeTo(atSales, 1));

    // Further down, then back to the middle: neither move resets the list.
    await scrollTo(tester, 'Settings');
    final atSettings = offsetOf(tester);
    expect(atSettings, greaterThan(atSales));
    await tester.tap(find.widgetWithText(ListTile, 'Settings'));
    await tester.pumpAndSettle();
    expect(currentRoute, AppRoutes.settings);
    expect(offsetOf(tester), closeTo(atSettings, 1));

    await scrollTo(tester, 'Items');
    final atItems = offsetOf(tester);
    await tester.tap(find.widgetWithText(ListTile, 'Items'));
    await tester.pumpAndSettle();
    expect(offsetOf(tester), closeTo(atItems, 1));
    expect(currentRoute, AppRoutes.items);
  });

  testWidgets('a rebuild of the whole shell keeps the place', (tester) async {
    await openTallWindow(tester);
    final router = buildRouter();
    await tester.pumpWidget(app(router));
    await tester.pumpAndSettle();

    await scrollTo(tester, 'Quotations');
    final before = offsetOf(tester);
    expect(before, greaterThan(0));

    // Same tree, pumped again: a rebuild (a theme change, a licence message, a
    // provider refresh) must not silently move the menu.
    await tester.pumpWidget(app(router));
    await tester.pumpAndSettle();
    expect(offsetOf(tester), closeTo(before, 1));
  });

  testWidgets('switching to Arabic keeps the place and flips the side', (
    tester,
  ) async {
    await openTallWindow(tester);
    final router = buildRouter();
    await tester.pumpWidget(app(router));
    await tester.pumpAndSettle();

    await scrollTo(tester, 'Quotations');
    final before = offsetOf(tester);
    expect(before, greaterThan(0));

    await tester.pumpWidget(app(router, locale: const Locale('ar')));
    await tester.pumpAndSettle();

    // The direction changed: the menu now sits on the right.
    expect(tester.getRect(navList()).right, closeTo(1366.0, 1.0));
    // And it is still where it was scrolled to.
    expect(
      offsetOf(tester),
      closeTo(before, 1),
      reason: 'a language switch must not throw the menu to the top',
    );
  });
}
