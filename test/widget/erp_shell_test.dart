import 'dart:convert';
import 'dart:typed_data';

import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/app/shell/erp_shell.dart';
import 'package:erp_kayan/app/theme/design_tokens.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'test_harness.dart';

class _ShellPhotoClient extends ApiClient {
  _ShellPhotoClient(this.photos) : super(const AppConfig(environment: AppEnvironment.development,
    apiBaseUrl: 'https://test.invalid/api/v1', connectTimeout: Duration(seconds: 1),
    receiveTimeout: Duration(seconds: 1)), FakeTokenStore());
  final Map<String, Uint8List> photos;

  @override
  Future<Map<String, dynamic>> getObject(String path, {Map<String, dynamic>? query}) async {
    expect(path, '/profile/photo');
    final bytes = photos[query?['expectedUserId']];
    return {'mime': bytes == null ? null : 'image/webp', 'data': bytes == null ? null : base64Encode(bytes)};
  }
}

class _ActiveShellUser extends Notifier<AppUser?> {
  @override
  AppUser? build() => null;
  void setUser(AppUser? user) => state = user;
}
final _activeShellUser = NotifierProvider<_ActiveShellUser, AppUser?>(_ActiveShellUser.new);

void main() {
  testWidgets('top bar replaces the previous user photo and name after account switch', (tester) async {
    tester.view.physicalSize = const Size(1366, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final bytes = base64Decode('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAN0lEQVRIie3WuQkAQAwDQZW+pV8VhgsGnAuMnt3q9kYgLxoXJWhTFWnTDE4mM1Qx4BV03M90/QB30QA96QETDgAAAABJRU5ErkJggg==');
    final client = _ShellPhotoClient({'one': bytes});
    AppUser account(String id) => AppUser(id: id, username: id, fullName: 'Account $id', companyId: 'company');
    final container = ProviderContainer(overrides: [
      currentUserProvider.overrideWith((ref) => ref.watch(_activeShellUser)),
      apiClientProvider.overrideWithValue(client),
    ]);
    container.read(_activeShellUser.notifier).setUser(account('one'));
    addTearDown(container.dispose);
    final screen = UncontrolledProviderScope(container: container,
      child: wrapWithApp(child: const ErpShell(currentPath: AppRoutes.dashboard, child: SizedBox.expand())));

    await tester.pumpWidget(screen);
    await tester.pumpAndSettle();
    final first = tester.widget<CircleAvatar>(find.byKey(const ValueKey('topbar-photo-one')));
    expect(first.foregroundImage, isA<MemoryImage>());
    expect(find.text('Account one'), findsWidgets);
    container.read(_activeShellUser.notifier).setUser(null);
    await tester.pump();
    expect(find.byKey(const ValueKey('topbar-photo-one')), findsNothing);
    container.read(_activeShellUser.notifier).setUser(account('two'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('topbar-photo-one')), findsNothing);
    final second = tester.widget<CircleAvatar>(find.byKey(const ValueKey('topbar-photo-two')));
    expect(second.foregroundImage, isNull);
    expect(find.text('Account one'), findsNothing);
    expect(find.text('Account two'), findsWidgets);
    tester.view.physicalSize = const Size(320, 700);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 3));
  });
  test('selected navigation glyphs meet contrast on every section accent', () {
    const accents = [SectionAccents.overview, SectionAccents.accounting,
      SectionAccents.cash, SectionAccents.parties, SectionAccents.inventory,
      SectionAccents.sales, SectionAccents.purchases, SectionAccents.insights,
      SectionAccents.administration];
    final foreground = AppColors.navyDeep.computeLuminance();
    for (final accent in accents) {
      final background = accent.darkBase.computeLuminance();
      final ratio = (background + 0.05) / (foreground + 0.05);
      expect(ratio, greaterThanOrEqualTo(4.5));
    }
  });
  testWidgets('Home shortcut fits a narrow shell and navigates to the dashboard', (tester) async {
    tester.view.physicalSize=const Size(320,700); tester.view.devicePixelRatio=1;
    addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
    final router=GoRouter(initialLocation:AppRoutes.customers,routes:[
      GoRoute(path:AppRoutes.dashboard,builder:(_,_) => const Scaffold(body:Text('Dashboard destination'))),
      GoRoute(path:AppRoutes.customers,builder:(_,_) => const ErpShell(currentPath:AppRoutes.customers,child:SizedBox.expand())),
    ]);
    addTearDown(router.dispose);
    await tester.pumpWidget(ProviderScope(overrides:[tokenStoreProvider.overrideWithValue(FakeTokenStore()),
      authRepositoryProvider.overrideWithValue(FakeAuthRepository())],child:MaterialApp.router(
        locale:const Locale('ar'),localizationsDelegates:AppLocalizations.localizationsDelegates,
        supportedLocales:AppLocalizations.supportedLocales,routerConfig:router)));
    await tester.pumpAndSettle();
    expect(tester.takeException(),isNull);
    await tester.tap(find.byKey(const ValueKey('erp-home-shortcut'))); await tester.pumpAndSettle();
    expect(find.text('Dashboard destination'),findsOneWidget);
  });
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
      // The menu is an accordion: the administration section has to be opened
      // before its entry exists, so this opens it the way an operator would
      // rather than assuming the whole tree is laid out at once.
      final settingsGroup = find.byKey(const ValueKey('nav-group-administration'));
      await tester.scrollUntilVisible(
        settingsGroup,
        150.0,
        scrollable: find.descendant(
          of: navListFinder,
          matching: find.byType(Scrollable),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(settingsGroup);
      await tester.pumpAndSettle();
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

      // Scroll back up to the first item (لوحة التحكم / Dashboard), which
      // lives in the overview section; opening it closes administration.
      final overviewGroup = find.byKey(const ValueKey('nav-group-overview'));
      // The list is scrolled to the bottom, so the first heading is off screen
      // and a tap on it would miss. Scroll back up to it first.
      await tester.scrollUntilVisible(
        overviewGroup,
        -150.0,
        scrollable: find.descendant(
          of: navListFinder,
          matching: find.byType(Scrollable),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(overviewGroup);
      await tester.pumpAndSettle();
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
      //
      // The menu is an accordion, so each label is looked for inside its own
      // section: the entries of five different sections cannot be on screen at
      // once by design. Opening each one is what an operator does to find it.
      // Grouped by section: the two accounting entries and the two sales ones
      // share a heading, and tapping a heading twice would close it again.
      const entries = <String, List<String>>{
        'nav-group-accounting': ['الخزائن والبنوك', 'الأرصدة الافتتاحية'],
        'nav-group-sales': ['مرتجعات المبيعات', 'عروض الأسعار'],
        'nav-group-purchases': ['مرتجعات المشتريات'],
      };
      for (final MapEntry(key: group, value: labels) in entries.entries) {
        final header = find.byKey(ValueKey(group));
        expect(header, findsOneWidget, reason: 'section $group must exist');
        await tester.ensureVisible(header);
        await tester.tap(header);
        await tester.pumpAndSettle();
        for (final label in labels) {
          expect(
            find.widgetWithText(ListTile, label),
            findsOneWidget,
            reason: label,
          );
        }
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
      expect(find.widgetWithText(ListTile, 'لوحة التحكم'), findsNothing);
    },
  );
  testWidgets(
    'each section lights up in its own colour when it is the active one',
    (tester) async {
      tester.view.physicalSize = const Size(1440, 900);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      final router = GoRouter(
        initialLocation: AppRoutes.salesInvoices,
        routes: [
          for (final route in [
            AppRoutes.dashboard,
            AppRoutes.customers,
            AppRoutes.salesInvoices,
            AppRoutes.settings,
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

      Color? titleColorOf(String label) {
        final tile = tester.widget<ListTile>(
          find.widgetWithText(ListTile, label, skipOffstage: false),
        );
        return (tile.title! as Text).style?.color;
      }

      // Sales is active: its sidebar label carries the sales green in the
      // step mixed for the navy sidebar, and the (light) top bar names
      // the section in the base step of the same hue.
      await tester.tap(find.byKey(const ValueKey('nav-group-sales')));
      await tester.pumpAndSettle();
      expect(titleColorOf('فواتير البيع'), SectionAccents.sales.darkBase);
      final salesIcon = find.descendant(
        of: find.widgetWithText(ListTile, 'فواتير البيع', skipOffstage: false),
        matching: find.byIcon(Icons.point_of_sale_outlined, skipOffstage: false),
      );
      expect(tester.widget<Icon>(salesIcon).color, AppColors.navyDeep);
      expect(
        find.byWidgetPredicate(
          (w) =>
              w is Text &&
              w.data == 'المبيعات' &&
              w.style?.color == SectionAccents.sales.base,
        ),
        findsOneWidget,
      );
      // Customers is not active yet, and its section is closed, so its row is
      // not on screen at all - an accordion does not list another section's
      // entries. That is stronger than checking the rose is absent from a
      // visible row, which is what this asserted when every section was open.
      expect(
        find.widgetWithText(ListTile, 'العملاء', skipOffstage: false),
        findsNothing,
      );

      // Move to customers & suppliers: the rose section identity takes
      // over the label and the top bar, and sales goes back to neutral.
      router.go(AppRoutes.customers);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('nav-group-parties')));
      await tester.pumpAndSettle();
      expect(titleColorOf('العملاء'), SectionAccents.parties.darkBase);
      expect(
        find.byWidgetPredicate(
          (w) =>
              w is Text &&
              w.data == 'العملاء والموردون' &&
              w.style?.color == SectionAccents.parties.base,
        ),
        findsOneWidget,
      );
      // Moving to another section closed sales, so its rows are gone rather
      // than merely repainted - the strongest form of "sales is no longer the
      // active section".
      expect(
        find.widgetWithText(ListTile, 'فواتير البيع', skipOffstage: false),
        findsNothing,
      );
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
