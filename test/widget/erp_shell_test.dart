import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
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
}
