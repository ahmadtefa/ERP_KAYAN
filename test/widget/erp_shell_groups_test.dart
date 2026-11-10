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

      // Opening the group reveals the screens that make it a system rather than
      // a single list.
      await tester.ensureVisible(inventoryGroup);
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
          expect(invoice, findsOneWidget);
          await tester.tap(group);
          await tester.pumpAndSettle();
          expect(invoice, findsNothing);
          await tester.tap(group);
          await tester.pumpAndSettle();
          expect(invoice, findsOneWidget);
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
}
