import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

void main() {
  testWidgets(
    'Arabic RTL side navigation is on the right, scrollable up/down, and reaches the last item',
    (tester) async {
      // Short viewport (height 380, wide 1366) so the 16 navigation items
      // overflow vertically and require scrolling to reach the last item.
      tester.view.physicalSize = const Size(1366, 380);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      String currentRoute = AppRoutes.dashboard;
      final router = GoRouter(
        initialLocation: AppRoutes.dashboard,
        routes: [
          for (final route in [
            AppRoutes.dashboard,
            AppRoutes.journalEntries,
            AppRoutes.fiscalPeriods,
            AppRoutes.customers,
            AppRoutes.suppliers,
            AppRoutes.items,
            AppRoutes.stock,
            AppRoutes.salesInvoices,
            AppRoutes.purchaseInvoices,
            AppRoutes.chartOfAccounts,
            AppRoutes.reports,
            AppRoutes.importData,
            AppRoutes.backup,
            AppRoutes.administration,
            AppRoutes.companySettings,
            AppRoutes.settings,
          ])
            GoRoute(
              path: route,
              builder: (context, state) {
                currentRoute = state.matchedLocation;
                return ErpShell(
                  currentPath: state.matchedLocation,
                  child: ListView(
                    children: [
                      Text('Active: ${state.matchedLocation}'),
                    ],
                  ),
                );
              },
            ),
        ],
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            tokenStoreProvider.overrideWithValue(FakeTokenStore()),
            authRepositoryProvider.overrideWithValue(FakeAuthRepository()),
          ],
          child: MaterialApp.router(
            locale: const Locale('ar'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            routerConfig: router,
          ),
        ),
      );
      await tester.pumpAndSettle();

      final navListFinder = find.byKey(const Key('erp-shell-nav-list'));
      expect(navListFinder, findsOneWidget);

      // In Arabic RTL, the navigation sidebar sits on the right side of the screen.
      final navRect = tester.getRect(navListFinder);
      expect(navRect.right, closeTo(1366.0, 1.0));

      // Scroll down to the very last item (الإعدادات / Settings) and tap it.
      final lastItemFinder = find.widgetWithText(ListTile, 'الإعدادات');
      await tester.scrollUntilVisible(
        lastItemFinder,
        150.0,
        scrollable: find.descendant(
          of: navListFinder,
          matching: find.byType(Scrollable),
        ),
      );
      await tester.pumpAndSettle();

      expect(lastItemFinder, findsOneWidget);
      await tester.tap(lastItemFinder);
      await tester.pumpAndSettle();
      expect(currentRoute, AppRoutes.settings);

      // Scroll back up to the first item (لوحة التحكم / Dashboard).
      final firstItemFinder = find.widgetWithText(ListTile, 'لوحة التحكم');
      await tester.scrollUntilVisible(
        firstItemFinder,
        -150.0,
        scrollable: find.descendant(
          of: navListFinder,
          matching: find.byType(Scrollable),
        ),
      );
      await tester.pumpAndSettle();
      expect(firstItemFinder, findsOneWidget);
    },
  );

  testWidgets(
    'navigation shows pages when the user has the same read permissions as their API routes',
    (tester) async {
      tester.view.physicalSize = const Size(1366, 768);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      final router = GoRouter(
        initialLocation: AppRoutes.dashboard,
        routes: [
          for (final route in [
            AppRoutes.dashboard,
            AppRoutes.cash,
            AppRoutes.openingBalances,
            AppRoutes.salesReturns,
            AppRoutes.purchaseReturns,
            AppRoutes.quotations,
          ])
            GoRoute(
              path: route,
              builder: (context, state) => ErpShell(
                currentPath: state.matchedLocation,
                child: const SizedBox.expand(),
              ),
            ),
        ],
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authControllerProvider.overrideWith(
              _PermissionTestAuthController.new,
            ),
            tokenStoreProvider.overrideWithValue(FakeTokenStore()),
          ],
          child: MaterialApp.router(
            locale: const Locale('ar'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            routerConfig: router,
          ),
        ),
      );
      await tester.pumpAndSettle();

      // These permissions match the GET endpoints. The user intentionally
      // does not hold the separate returns.read or opening-balances.manage
      // codes; a view-only grant must still reveal the screen whose API GET is
      // allowed, and manage must not be required just to look.
      for (final label in [
        'الخزائن والبنوك',
        'الأرصدة الافتتاحية',
        'مرتجعات المبيعات',
        'مرتجعات المشتريات',
        'عروض الأسعار',
      ]) {
        expect(find.widgetWithText(ListTile, label), findsOneWidget, reason: label);
      }
    },
  );

  testWidgets(
    'a user without a screen permission does not see its menu entry',
    (tester) async {
      tester.view.physicalSize = const Size(1366, 768);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      final router = GoRouter(
        initialLocation: AppRoutes.dashboard,
        routes: [
          for (final route in [
            AppRoutes.dashboard,
            AppRoutes.cash,
            AppRoutes.quotations,
          ])
            GoRoute(
              path: route,
              builder: (context, state) => ErpShell(
                currentPath: state.matchedLocation,
                child: const SizedBox.expand(),
              ),
            ),
        ],
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            authControllerProvider.overrideWith(
              _UnpermittedAuthController.new,
            ),
            tokenStoreProvider.overrideWithValue(FakeTokenStore()),
          ],
          child: MaterialApp.router(
            locale: const Locale('ar'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            routerConfig: router,
          ),
        ),
      );
      await tester.pumpAndSettle();

      // The screen is still guarded on the server; this only keeps a menu
      // entry from offering something the API would refuse.
      expect(find.widgetWithText(ListTile, 'الخزائن والبنوك'), findsNothing);
      expect(find.widgetWithText(ListTile, 'عروض الأسعار'), findsNothing);
      expect(find.widgetWithText(ListTile, 'لوحة التحكم'), findsOneWidget);
    },
  );
}

class _PermissionTestAuthController extends AuthController {
  @override
  Future<AppUser?> build() async => const AppUser(
        id: 'user-read-only',
        username: 'accountant',
        fullName: 'Test Accountant',
        companyId: 'company-1',
        branchId: 'branch-1',
        permissions: [
          'cash.accounts.read',
          'accounting.journal.read',
          'accounting.openingbalances.read',
          'sales.invoices.read',
          'purchases.invoices.read',
          'sales.quotations.read',
        ],
      );
}

class _UnpermittedAuthController extends AuthController {
  @override
  Future<AppUser?> build() async => const AppUser(
        id: 'user-no-permissions',
        username: 'clerk',
        fullName: 'Test Clerk',
        companyId: 'company-1',
        branchId: 'branch-1',
      );
}
