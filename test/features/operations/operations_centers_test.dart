import 'package:erp_kayan/app/router/app_router.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/operations/operations_center_screen.dart';
import 'package:erp_kayan/features/operations/operations_registry.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _fullUser = AppUser(
  id: 'u-full',
  username: 'boss',
  fullName: 'Boss',
  companyId: 'company-1',
  isSuperAdmin: true,
  permissions: [
    'sales.invoices.read', 'sales.invoices.create',
    'sales.orders.read', 'sales.orders.create',
    'sales.returns.manage',
    'purchases.invoices.read', 'purchases.invoices.create',
    'purchases.orders.read', 'purchases.orders.create',
    'purchases.returns.manage',
    'parties.customers.read', 'parties.customers.create',
    'parties.suppliers.read', 'parties.suppliers.create',
    'inventory.items.read', 'inventory.items.create',
    'inventory.warehouses.read', 'inventory.warehouses.manage',
    'inventory.stocktake.read', 'inventory.stocktake.create',
    'inventory.stock.read', 'inventory.stock.adjust',
    'inventory.cost.read', 'accounting.costcenters.read',
    'accounting.journal.read', 'accounting.journal.create',
    'accounting.openingbalances.read', 'accounting.openingbalances.manage',
    'accounting.accounts.read', 'accounting.accounts.create',
    'accounting.costcenters.manage', 'cash.vouchers.create', 'cash.accounts.manage',
    'reports.read', 'inventory.export', 'notifications.read',
  ],
);

const _limitedUser = AppUser(
  id: 'u-limited',
  username: 'clerk',
  fullName: 'Clerk',
  companyId: 'company-1',
  permissions: ['sales.invoices.read', 'sales.invoices.create'],
);

  Future<GoRouter> _pump(
  WidgetTester tester, {
  required AppUser user,
  required OpsKind kind,
  Locale locale = const Locale('en'),
  ThemeData? theme,
}) async {
  final router = GoRouter(
    initialLocation: kind == OpsKind.entry
        ? AppRoutes.operationsInputs
        : AppRoutes.operationsOutputs,
    routes: [
      GoRoute(
        path: AppRoutes.operationsInputs,
        builder: (context, _) => Scaffold(
          body: OperationsCenterScreen(kind: OpsKind.entry, user: user),
        ),
      ),
      GoRoute(
        path: AppRoutes.operationsOutputs,
        builder: (context, _) => Scaffold(
          body: OperationsCenterScreen(kind: OpsKind.output, user: user),
        ),
      ),
      GoRoute(
        path: '/sales/invoices',
        builder: (context, state) => Scaffold(
          body: Text('invoices:${state.uri.queryParameters['new'] ?? ''}'),
        ),
      ),
      GoRoute(
        path: '/parties/customers',
        builder: (context, state) => Scaffold(
          body: Text('customers:${state.uri.queryParameters['new'] ?? ''}'),
        ),
      ),
      GoRoute(
        path: '/reports',
        builder: (context, state) => Scaffold(
          body: Text('report:${state.uri.queryParameters['tab'] ?? 'default'}'),
        ),
      ),
      GoRoute(
        path: AppRoutes.inventoryReports,
        builder: (context, state) => Scaffold(
          body: Text('inventory-report:${state.uri.queryParameters['report'] ?? 'default'}'),
        ),
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    ProviderScope(
      child: MaterialApp.router(
        locale: locale,
        theme: theme,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        routerConfig: router,
      ),
    ),
  );
  await tester.pumpAndSettle();
  return router;
}

Future<void> _scrollTo(
  WidgetTester tester,
  String label, {
  double delta = 300,
}) async {
  await tester.scrollUntilVisible(
    find.text(label),
    delta,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('Inputs Centre shows only the entry operations the user may open',
      (tester) async {
    await _pump(tester, user: _limitedUser, kind: OpsKind.entry);

    // The sales invoice entry is allowed.
    expect(find.text('New sales invoice'), findsWidgets);
    // Everything the clerk cannot open is hidden entirely.
    expect(find.text('New purchase invoice'), findsNothing);
    expect(find.text('New supplier'), findsNothing);
    expect(find.text('New customer'), findsNothing);
  });

  testWidgets('Outputs Centre lists only permitted reports and lists',
      (tester) async {
    await _pump(tester, user: _limitedUser, kind: OpsKind.output);

    // No reports.read → the general reports card is gone; the invoices list
    // (sales.invoices.read) stays.
    expect(find.text('General reports'), findsNothing);
    expect(find.text('Sales invoices'), findsWidgets);
  });

  testWidgets('two clicks open the blank new form directly, not the list',
      (tester) async {
    await _pump(tester, user: _fullUser, kind: OpsKind.entry);

    await tester.tap(find.text('New sales invoice'));
    await tester.pumpAndSettle();

    // The invoice screen was opened with its auto-create flag, i.e. straight
    // into the blank new form rather than the list.
    expect(find.text('invoices:1'), findsOneWidget);
  });

  testWidgets('output cards open the selected real report directly', (tester) async {
    final router = await _pump(tester, user: _fullUser, kind: OpsKind.output);

    // The registry is populated without entering a search term.
    expect(find.text('Income statement'), findsWidgets);
    expect(find.text('General ledger'), findsWidgets);
    await tester.tap(find.text('Income statement').first);
    await tester.pumpAndSettle();
    expect(find.text('report:profit-and-loss'), findsOneWidget);

    router.pop();
    await tester.pumpAndSettle();
    await _scrollTo(tester, 'Warehouse cost');
    expect(find.text('Warehouse cost'), findsWidgets);
    await tester.tap(find.text('Warehouse cost').first);
    await tester.pumpAndSettle();
    expect(find.text('inventory-report:cost-by-warehouse'), findsOneWidget);
  });

  testWidgets('quick search filters instantly in English and Arabic',
      (tester) async {
    await _pump(tester, user: _fullUser, kind: OpsKind.entry);

    await tester.enterText(find.byType(TextField), 'invoice');
    await tester.pumpAndSettle();
    expect(find.text('New sales invoice'), findsWidgets);
    expect(find.text('New customer'), findsNothing);

    await tester.enterText(find.byType(TextField), 'غير موجود');
    await tester.pumpAndSettle();
    expect(find.text('New sales invoice'), findsNothing);

    await tester.enterText(find.byType(TextField), '');
    await tester.pumpAndSettle();
    expect(find.text('New sales invoice'), findsWidgets);
  });

  testWidgets('favourites pin and survive a new session', (tester) async {
    await _pump(tester, user: _fullUser, kind: OpsKind.entry);
    await _scrollTo(tester, 'New customer');

    final card = find.ancestor(
      of: find.text('New customer'),
      matching: find.byType(InkWell),
    );
    await tester.tap(find
        .descendant(of: card, matching: find.byIcon(Icons.push_pin_outlined))
        .first);
    await tester.pumpAndSettle();
    await _scrollTo(tester, 'Favourites', delta: -300);
    expect(find.text('Favourites'), findsOneWidget);

    // A brand-new session (fresh widget tree) still shows the pin.
    await _pump(tester, user: _fullUser, kind: OpsKind.entry);
    expect(find.text('Favourites'), findsOneWidget);
  });

  testWidgets('most-used rises after being opened', (tester) async {
    final router = await _pump(tester, user: _fullUser, kind: OpsKind.entry);

    // Use one operation twice (push → back each time).
    await _scrollTo(tester, 'New customer');
    await tester.tap(find.text('New customer').first);
    await tester.pumpAndSettle();
    router.pop();
    await tester.pumpAndSettle();
    await _scrollTo(tester, 'New customer');
    await tester.tap(find.text('New customer').first);
    await tester.pumpAndSettle();
    router.pop();
    await tester.pumpAndSettle();
    await _scrollTo(tester, 'Most used', delta: -300);

    expect(find.text('Most used'), findsOneWidget);
  });

  testWidgets('the Arabic RTL centre renders its Arabic labels in dark mode',
      (tester) async {
    await _pump(
      tester,
      user: _fullUser,
      kind: OpsKind.entry,
      locale: const Locale('ar'),
      theme: ThemeData.dark(),
    );

    expect(find.text('فاتورة مبيعات جديدة'), findsWidgets);
    await _scrollTo(tester, 'عميل جديد');
    expect(find.text('عميل جديد'), findsWidgets);
  });
}
