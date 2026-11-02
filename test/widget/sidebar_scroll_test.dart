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
/// scroll down again after every click. The cause was structural — every route
/// built its own shell, so every navigation made a new State with a new
/// `ScrollController` starting at zero — and the fix is structural too: one
/// shell whose State, controller and stored offset outlive the navigation.
///
/// These tests would fail against the old shape: they check the offset *after*
/// the click, not merely that the clicked page opened.
void main() {
  // Every route the menu can open, so the shell is the same widget across all
  // of them and only the child changes.
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

  Widget app(GoRouter router, {Locale locale = const Locale('en')}) {
    return ProviderScope(
      overrides: [
        tokenStoreProvider.overrideWithValue(FakeTokenStore()),
        authRepositoryProvider.overrideWithValue(FakeAuthRepository()),
      ],
      child: MaterialApp.router(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        routerConfig: router,
      ),
    );
  }

  // The same key *type* the shell puts on the list: `find.byKey` compares
  // runtime types, so a plain `Key` here would never match a
  // `PageStorageKey`.
  Finder navList() =>
      find.byKey(const PageStorageKey<String>('erp-shell-nav-list'));

  Finder navScrollable() => find.descendant(
    of: navList(),
    matching: find.byType(Scrollable),
  );

  double offsetOf(WidgetTester tester) {
    expect(navList(), findsOneWidget, reason: 'one menu');
    return tester.state<ScrollableState>(navScrollable()).position.pixels;
  }

  Future<void> openTallWindow(WidgetTester tester) async {
    // Tall enough for several modules, short enough that the menu must scroll:
    // 1366 x 380 leaves roughly five rows of the sixteen visible.
    tester.view.physicalSize = const Size(1366, 380);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
  }

  /// Brings a menu entry into view, whichever way it is from where the list is
  /// now.
  ///
  /// `scrollUntilVisible` only ever drags in one direction, and it ends by
  /// taking `.single` of a finder that may still be empty - which is how an
  /// upward move (back to «الأصناف» after «الإعدادات» at the very bottom) used
  /// to die with `Bad state: No element`. An entry that is not built yet can
  /// only be found by walking the list from the top, so that is what this does;
  /// once it is built, `ensureVisible` moves in whichever direction it is.
  Future<void> scrollTo(WidgetTester tester, String label) async {
    final target = find.widgetWithText(ListTile, label);
    final position = tester.state<ScrollableState>(navScrollable()).position;

    if (target.evaluate().isEmpty) {
      position.jumpTo(0);
      await tester.pumpAndSettle();
      while (target.evaluate().isEmpty &&
          position.pixels < position.maxScrollExtent) {
        final next = position.pixels + 150;
        position.jumpTo(
          next > position.maxScrollExtent ? position.maxScrollExtent : next,
        );
        await tester.pumpAndSettle();
      }
    }

    expect(
      target,
      findsWidgets,
      reason: 'the menu must offer «$label»',
    );
    await tester.ensureVisible(target);
    await tester.pumpAndSettle();
  }

  testWidgets('a lower item is reachable, and opening it does not jump to the '
      'top', (tester) async {
    await openTallWindow(tester);
    await tester.pumpWidget(app(buildRouter()));
    await tester.pumpAndSettle();

    expect(navList(), findsOneWidget);
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

  testWidgets('moving between three lower sections keeps the place each time', (
    tester,
  ) async {
    await openTallWindow(tester);
    await tester.pumpWidget(app(buildRouter()));
    await tester.pumpAndSettle();

    await scrollTo(tester, 'Sales invoices');
    final atSales = offsetOf(tester);
    await tester.tap(find.widgetWithText(ListTile, 'Sales invoices'));
    await tester.pumpAndSettle();
    expect(currentRoute, AppRoutes.salesInvoices);
    expect(offsetOf(tester), closeTo(atSales, 1));

    // Further down, then back up: neither move resets the list, and going
    // back up is the direction a downwards-only search cannot follow.
    await scrollTo(tester, 'Settings');
    final atSettings = offsetOf(tester);
    expect(atSettings, greaterThan(atSales));
    await tester.tap(find.widgetWithText(ListTile, 'Settings'));
    await tester.pumpAndSettle();
    expect(currentRoute, AppRoutes.settings);
    expect(offsetOf(tester), closeTo(atSettings, 1));

    await scrollTo(tester, 'Items');
    final atItems = offsetOf(tester);
    expect(atItems, lessThan(atSettings));
    await tester.tap(find.widgetWithText(ListTile, 'Items'));
    await tester.pumpAndSettle();
    expect(currentRoute, AppRoutes.items);
    expect(offsetOf(tester), closeTo(atItems, 1));
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
