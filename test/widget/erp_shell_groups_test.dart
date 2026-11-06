import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/router/draft_exit_guard.dart';
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
      expect(find.byKey(const ValueKey('erp-home-shortcut')), findsOneWidget);
      final sidebarHome = find.byKey(
        const ValueKey('erp-home-sidebar-shortcut'),
      );
      await tester.tap(sidebarHome);
      await tester.pumpAndSettle();
      expect(find.text('Screen ${AppRoutes.salesInvoices}'), findsOneWidget);
      allowLeave = true;
      await tester.tap(sidebarHome);
      await tester.pumpAndSettle();
      expect(find.text('Screen ${AppRoutes.dashboard}'), findsOneWidget);
      expect(router.routerDelegate.currentConfiguration.matches.length, 1);
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
              for (final path in [
                AppRoutes.dashboard,
                AppRoutes.salesInvoices,
                AppRoutes.cash,
              ])
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
                    permissions: ['sales.invoices.read', 'cash.vouchers.read'],
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
          final accountingGroup = find.byKey(
            const ValueKey('nav-group-accounting'),
          );
          final invoice = find.widgetWithText(
            ListTile,
            arabic ? 'فواتير البيع' : 'Sales invoices',
          );
          expect(
            Directionality.of(tester.element(group)),
            arabic ? TextDirection.rtl : TextDirection.ltr,
          );
          expect(accountingGroup, findsOneWidget);
          await tester.ensureVisible(group);
          expect(invoice, findsOneWidget);
          final arrow = find.descendant(
            of: group,
            matching: find.byType(AnimatedRotation),
          );
          expect(
            tester.widget<AnimatedRotation>(arrow).turns,
            arabic ? -0.25 : 0.25,
          );
          final routeBeforeToggle =
              router.routerDelegate.currentConfiguration.uri.path;
          await tester.tap(accountingGroup);
          await tester.pumpAndSettle();
          expect(invoice, findsOneWidget);
          expect(
            router.routerDelegate.currentConfiguration.uri.path,
            routeBeforeToggle,
          );
          await tester.tap(accountingGroup);
          await tester.pumpAndSettle();
          expect(invoice, findsOneWidget);
          await tester.tap(group);
          await tester.pumpAndSettle();
          expect(invoice, findsNothing);
          expect(tester.widget<AnimatedRotation>(arrow).turns, 0);
          await tester.tap(group);
          await tester.pumpAndSettle();
          expect(invoice, findsOneWidget);
          await tester.tap(invoice);
          await tester.pumpAndSettle();
          expect(
            find.text('Screen ${AppRoutes.salesInvoices}'),
            findsOneWidget,
          );
          if (mobile) expect(find.byType(Drawer), findsNothing);
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

  testWidgets(
    'a directly opened nested sales route selects its parent item and section',
    (tester) async {
      tester.view.physicalSize = const Size(1500, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      const deepLink = '/sales/invoices/invoice-1/edit';
      final router = GoRouter(
        initialLocation: deepLink,
        routes: [
          GoRoute(
            path: deepLink,
            builder: (context, state) => ErpShell(
              currentPath: state.matchedLocation,
              child: const Text('Direct invoice editor'),
            ),
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
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            routerConfig: router,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Direct invoice editor'), findsOneWidget);
      expect(find.widgetWithText(ListTile, 'Sales invoices'), findsOneWidget);
      expect(find.byKey(const ValueKey('nav-group-sales')), findsOneWidget);
      expect(
        tester
            .widget<ListTile>(find.widgetWithText(ListTile, 'Sales invoices'))
            .selected,
        isTrue,
      );
    },
  );
}
