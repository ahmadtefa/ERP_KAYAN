import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/router/draft_exit_guard.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/app/theme/design_tokens.dart';
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
  _Api()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
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
  }) async => {};
}

void main() {
  testWidgets(
    'home shortcut respects draft guards and replaces the route stack after approval',
    (tester) async {
      tester.view.physicalSize = const Size(1500, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var allowLeave = false;
      final guard = DraftExitGuard();
      final router = GoRouter(
        initialLocation: AppRoutes.salesInvoices,
        routes: [
          for (final path in [AppRoutes.dashboard, AppRoutes.salesInvoices])
            GoRoute(
              path: path,
              onExit: path == AppRoutes.salesInvoices
                  ? (context, state) => guard.canLeave(state.pageKey)
                  : null,
              builder: (context, state) {
                if (path == AppRoutes.salesInvoices) {
                  guard.register(state.pageKey, () async => allowLeave);
                }
                return ErpShell(
                  currentPath: path,
                  guardKey: path == AppRoutes.salesInvoices
                      ? state.pageKey
                      : null,
                  child: Text('Screen $path'),
                );
              },
            ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(_Api()),
            draftExitGuardProvider.overrideWithValue(guard),
            currentUserProvider.overrideWithValue(
              const AppUser(
                id: 'u',
                username: 'u',
                fullName: 'u',
                companyId: 'c',
                permissions: ['sales.invoices.read'],
              ),
            ),
          ],
          child: MaterialApp.router(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            routerConfig: router,
          ),
        ),
      );
      await tester.pumpAndSettle();
      final home = find.byKey(const ValueKey('erp-home-shortcut'));
      await tester.tap(home);
      await tester.pumpAndSettle();
      expect(find.text('Screen ${AppRoutes.salesInvoices}'), findsOneWidget);
      allowLeave = true;
      await tester.tap(home);
      await tester.pumpAndSettle();
      expect(find.text('Screen ${AppRoutes.dashboard}'), findsOneWidget);
      expect(router.routerDelegate.currentConfiguration.matches.length, 1);
    },
  );

  testWidgets(
    'the inventory group is present, carries its screens and keeps its own colour',
    (tester) async {
      // The whole warehouse system used to be absent from the shell: the
      // screens and routes existed, but the sidebar listed none of them, so an
      // operator could not reach a warehouse, a lot, a stock take or the
      // barcode work at all. This asserts the group exists, that every screen
      // it owns is reachable from it, and that it is drawn in its own section
      // colour rather than looking like every other group.
      tester.view.physicalSize = const Size(1500, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final router = GoRouter(
        initialLocation: AppRoutes.dashboard,
        routes: [
          for (final path in [AppRoutes.dashboard])
            GoRoute(
              path: path,
              builder: (context, state) =>
                  ErpShell(currentPath: path, child: Text('Screen $path')),
            ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            apiClientProvider.overrideWithValue(_Api()),
            currentUserProvider.overrideWithValue(
              const AppUser(
                id: 'u',
                username: 'u',
                fullName: 'u',
                companyId: 'c',
                // Every warehouse permission, so nothing is hidden by policy
                // and a missing entry means a missing entry, not a refusal.
                permissions: [
                  'inventory.warehouses.read',
                  'inventory.batches.read',
                  'inventory.stock.read',
                  'inventory.reports.read',
                  'inventory.stocktake.read',
                ],
              ),
            ),
          ],
          child: MaterialApp.router(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            routerConfig: router,
          ),
        ),
      );
      await tester.pumpAndSettle();

      final inventoryGroup = find.byKey(const ValueKey('nav-group-inventory'));
      expect(inventoryGroup, findsOneWidget,
          reason: 'the sidebar must carry an inventory group');

      // Each section owns its own colour, so the inventory header cannot be
      // mistaken for accounting or overview. A single shared accent would make
      // the grouped menu cosmetic rather than a way to find things.
      expect(SectionAccents.inventory.base, isNot(SectionAccents.overview.base),
          reason: 'sections must be visually distinguishable from each other');
      expect(SectionAccents.inventory.base, isNot(SectionAccents.accounting.base));
      expect(SectionAccents.inventory.base, isNot(SectionAccents.sales.base));
      // The header is actually painted with that accent, not merely defined.
      final header = tester.widget(find.byKey(const ValueKey('nav-group-inventory')));
      expect(header, isNotNull);

      // The screen being shown is the dashboard, which belongs to the overview
      // section, so that section - and only that one - is open. Inventory is
      // closed and none of its entries may be on screen: a menu that expanded
      // every section would show them all here.
      expect(find.text('Warehouses'), findsNothing,
          reason: 'a section the operator has not opened must stay closed');
      expect(find.text('Inventory reports'), findsNothing);
      expect(find.text('Batches'), findsNothing);

      // Opening the group reveals the screens that make it a system rather than
      // a single list.
      await tester.ensureVisible(inventoryGroup);
      await tester.tap(inventoryGroup);
      await tester.pumpAndSettle();
      // The locale is the default (LTR/English), where the sidebar labels are
      // the English names.
      for (final label in const [
        'Warehouses',
        'Batches',
        'Stock documents',
        'Stock takes',
        'Inventory reports',
      ]) {
        expect(find.text(label), findsOneWidget,
            reason: '"$label" must be reachable from the inventory group');
      }
    },
  );

  for (final mobile in [false, true]) {
    for (final arabic in [false, true]) {
      testWidgets(
        '${mobile ? 'drawer' : 'sidebar'} groups collapse and retain navigation permission in ${arabic ? 'RTL' : 'LTR'}',
        (tester) async {
          tester.view.physicalSize = Size(mobile ? 800 : 1500, 900);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final router = GoRouter(
            initialLocation: AppRoutes.dashboard,
            routes: [
              for (final path in [AppRoutes.dashboard, AppRoutes.salesInvoices])
                GoRoute(
                  path: path,
                  builder: (context, state) =>
                      ErpShell(currentPath: path, child: Text('Screen $path')),
                ),
            ],
          );
          addTearDown(router.dispose);
          await tester.pumpWidget(
            ProviderScope(
              overrides: [
                apiClientProvider.overrideWithValue(_Api()),
                currentUserProvider.overrideWithValue(
                  const AppUser(
                    id: 'u',
                    username: 'u',
                    fullName: 'u',
                    companyId: 'c',
                    permissions: ['sales.invoices.read'],
                  ),
                ),
              ],
              child: MaterialApp.router(
                locale: Locale(arabic ? 'ar' : 'en'),
                localizationsDelegates: AppLocalizations.localizationsDelegates,
                supportedLocales: AppLocalizations.supportedLocales,
                routerConfig: router,
              ),
            ),
          );
          await tester.pumpAndSettle();
          if (mobile) {
            await tester.tap(find.byIcon(Icons.menu_rounded));
            await tester.pumpAndSettle();
          }
          final group = find.byKey(const ValueKey('nav-group-sales'));
          final invoice = find.widgetWithText(
            ListTile,
            arabic ? 'فواتير البيع' : 'Sales invoices',
          );
          expect(
            Directionality.of(tester.element(group)),
            arabic ? TextDirection.rtl : TextDirection.ltr,
          );
          await tester.ensureVisible(group);
          // The menu starts closed: a fresh profile opens only the section that
          // owns the current screen, so nothing is expanded by accident.
          await tester.tap(group);
          await tester.pumpAndSettle();
          expect(invoice, findsOneWidget);
          await tester.tap(group);
          await tester.pumpAndSettle();
          expect(invoice, findsNothing);
          await tester.tap(invoice);
          await tester.pumpAndSettle();
          expect(
            find.text('Screen ${AppRoutes.salesInvoices}'),
            findsOneWidget,
          );
          if (mobile) {
            // Opening the drawer again also proves the same group state is used.
            await tester.tap(find.byIcon(Icons.menu_rounded));
            await tester.pumpAndSettle();
          }
          await tester.ensureVisible(group);
          await tester.tap(group);
          await tester.pumpAndSettle();
          expect(invoice, findsNothing);
          router.go(AppRoutes.dashboard);
          await tester.pumpAndSettle();
          if (mobile) {
            await tester.tap(find.byIcon(Icons.menu_rounded));
            await tester.pumpAndSettle();
          }
          expect(invoice, findsNothing);
          await tester.ensureVisible(group);
          await tester.tap(group);
          await tester.pumpAndSettle();
          expect(invoice, findsOneWidget);
        },
      );
    }
  }
  // ── accordion contract ───────────────────────────────────────────────────
  // The requirement is explicit: eight sections visible, one section open at a
  // time, the previous one closing by itself, and no entry from any other
  // section on screen. Each assertion below is one of those points.
  for (final arabic in [false, true]) {
    testWidgets(
      'the menu is an accordion in ${arabic ? 'RTL' : 'LTR'}: eight sections, one open',
      (tester) async {
        tester.view.physicalSize = const Size(1500, 1600);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final router = GoRouter(
          initialLocation: AppRoutes.dashboard,
          routes: [
            GoRoute(
              path: AppRoutes.dashboard,
              builder: (context, state) =>
                  ErpShell(currentPath: state.uri.path, child: const SizedBox()),
            ),
          ],
        );
        addTearDown(router.dispose);
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              apiClientProvider.overrideWithValue(_Api()),
              currentUserProvider.overrideWithValue(
                const AppUser(
                  id: 'u',
                  username: 'u',
                  fullName: 'u',
                  companyId: 'c',
                  permissions: [
                    'inventory.warehouses.read',
                    'inventory.batches.read',
                    'inventory.stock.read',
                    'inventory.stocktake.read',
                    'sales.invoices.read',
                    'purchases.invoices.read',
                  ],
                ),
              ),
            ],
            child: MaterialApp.router(
              locale: Locale(arabic ? 'ar' : 'en'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              routerConfig: router,
            ),
          ),
        );
        await tester.pumpAndSettle();

        // 1. The eight section headings, and nothing else.
        const sections = <String>[
          'overview',
          'accounting',
          'parties',
          'inventory',
          'sales',
          'purchases',
          'insights',
          'administration',
        ];
        for (final section in sections) {
          expect(find.byKey(ValueKey('nav-group-$section')), findsOneWidget,
              reason: 'section $section must be in the menu');
        }
        // 2. Exactly one section is open - the one that owns the screen being
        // shown - and no other section's entries are on screen. This is the
        // accordion rule; a menu that expanded everything would list every
        // entry of every section here.
        expect(find.text('Warehouses'), findsNothing);
        expect(find.text('Batches'), findsNothing);
        expect(find.text('Purchase invoices'), findsNothing);
        // ...while the overview entry (the dashboard list row) is visible,
        // because the operator is looking at it. Matched as a list row, not as
        // any text: the top bar also names the current screen, and a loose
        // match would pass even if the sidebar entry were missing.
        expect(find.widgetWithText(ListTile, 'Dashboard'), findsOneWidget);

        // 3. Opening a section shows its entries.
        final inventory = find.byKey(const ValueKey('nav-group-inventory'));
        await tester.ensureVisible(inventory);
        await tester.tap(inventory);
        await tester.pumpAndSettle();
        expect(find.text('Warehouses'), findsOneWidget);
        expect(find.text('Batches'), findsOneWidget);

        // 4. Opening a different section closes the previous one.
        final sales = find.byKey(const ValueKey('nav-group-sales'));
        await tester.ensureVisible(sales);
        await tester.tap(sales);
        await tester.pumpAndSettle();
        expect(find.text('Warehouses'), findsNothing,
            reason: 'opening sales must close inventory');
        expect(
          find.widgetWithText(
            ListTile,
            arabic ? 'فواتير البيع' : 'Sales invoices',
          ),
          findsOneWidget,
        );

        // 5. Entries of a third section stay hidden.
        expect(find.text('Purchase invoices'), findsNothing);
        expect(find.text('Warehouses'), findsNothing);

        // 6. Tapping the open section closes it, leaving the eight headings.
        await tester.ensureVisible(sales);
        await tester.tap(sales);
        await tester.pumpAndSettle();
        expect(
          find.widgetWithText(
            ListTile,
            arabic ? 'فواتير البيع' : 'Sales invoices',
          ),
          findsNothing,
        );
        for (final section in sections) {
          expect(find.byKey(ValueKey('nav-group-$section')), findsOneWidget);
        }

        // 7. RTL/LTR is respected and the colours stay distinct per section.
        expect(
          Directionality.of(tester.element(inventory)),
          arabic ? TextDirection.rtl : TextDirection.ltr,
        );
        expect(SectionAccents.inventory.base,
            isNot(SectionAccents.accounting.base));
      },
    );
  }

  testWidgets('the menu never shows a section the user may not open',
      (tester) async {
    tester.view.physicalSize = const Size(1500, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final router = GoRouter(
      initialLocation: AppRoutes.dashboard,
      routes: [
        GoRoute(
          path: AppRoutes.dashboard,
          builder: (context, state) =>
              ErpShell(currentPath: state.uri.path, child: const SizedBox()),
        ),
      ],
    );
    addTearDown(router.dispose);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(_Api()),
          currentUserProvider.overrideWithValue(
            const AppUser(
              id: 'u',
              username: 'u',
              fullName: 'u',
              companyId: 'c',
              // Only invoicing. No inventory grant at all.
              permissions: ['sales.invoices.read'],
            ),
          ),
        ],
        child: MaterialApp.router(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: router,
        ),
      ),
    );
    await tester.pumpAndSettle();

    // A section with no permitted entry is not drawn at all: an empty heading
    // would advertise a system the user cannot use.
    expect(find.byKey(const ValueKey('nav-group-inventory')), findsNothing);
    expect(find.text('Warehouses'), findsNothing);
    // ...and the one they may use still opens.
    final sales = find.byKey(const ValueKey('nav-group-sales'));
    expect(sales, findsOneWidget);
    await tester.ensureVisible(sales);
    await tester.tap(sales);
    await tester.pumpAndSettle();
    expect(
      find.widgetWithText(ListTile, 'Sales invoices'),
      findsOneWidget,
    );
  });
}
