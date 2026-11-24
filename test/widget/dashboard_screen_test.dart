import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:erp_kayan/app/theme/app_theme.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/dashboard/presentation/providers/dashboard_providers.dart';
import 'package:erp_kayan/features/dashboard/presentation/screens/dashboard_screen.dart';
import 'package:erp_kayan/features/notifications/presentation/screens/notification_center_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';


const _dashboardUser = AppUser(
  id: 'dashboard-test',
  username: 'manager',
  fullName: 'Dashboard test',
  companyId: 'company-1',
  roles: ['FINANCE_MANAGER'],
  permissions: [
    'dashboard.view',
    'dashboard.sales', 'dashboard.purchases', 'dashboard.revenue',
    'dashboard.profit', 'dashboard.cash', 'dashboard.movements',
    'dashboard.receivables', 'dashboard.payables', 'dashboard.stock',
    'dashboard.charts', 'dashboard.top', 'dashboard.recent',
    'inventory.cost.read',
    'purchases.price.read',
    'sales.price.read',
  ],
);

const _allSections = <String>[
  'sales', 'purchases', 'revenue', 'profit', 'cash', 'movements',
  'receivables', 'payables', 'stock', 'charts', 'top', 'recent',
];

final Json _summary = <String, dynamic>{
  'allowedSections': _allSections,
  'from': '2026-01-01',
  'to': '2026-10-15',
  'hasData': true,
  'documentsInPeriod': 12,
  'sales': <String, dynamic>{'total': '150000.0000', 'invoices': 8},
  'purchases': <String, dynamic>{'total': '90000.0000', 'invoices': 4},
  'receipts': <String, dynamic>{'total': '120000.0000', 'vouchers': 6},
  'payments': <String, dynamic>{'total': '70000.0000', 'vouchers': 3},
  'revenue': '160000.0000',
  'expenses': '40000.0000',
  'grossResult': '120000.0000',
  'cashPosition': '55000.0000',
  'cashAccounts': <Map<String, dynamic>>[
    <String, dynamic>{
      'id': 'ca-1', 'code': 'CASH-1', 'nameAr': 'الخزينة الرئيسية',
      'nameEn': 'Main cash box', 'kind': 'CASH', 'balance': '55000.0000',
    },
  ],
  'receivables': '30000.0000',
  'payables': '20000.0000',
  'overdue': <String, dynamic>{'total': '5000.0000', 'invoices': 1},
  'stock': <String, dynamic>{'value': '80000.0000', 'itemsInStock': 40},
  'topCustomers': <Map<String, dynamic>>[
    <String, dynamic>{'id': 'c-1', 'nameAr': 'شركة النور', 'nameEn': 'Noor Co', 'total': '60000.0000', 'invoices': 3},
  ],
  'topItems': <Map<String, dynamic>>[
    <String, dynamic>{'id': 'i-1', 'nameAr': 'منتج ألف', 'nameEn': 'Product Alpha', 'quantity': '120.0000', 'total': '40000.0000'},
  ],
  'recentDocuments': <Map<String, dynamic>>[
    <String, dynamic>{
      'kind': 'SALES_INVOICE', 'id': 'inv-1', 'number': 'S-100',
      'date': '2026-10-01', 'partyNameAr': 'شركة النور', 'partyNameEn': 'Noor Co',
      'amount': '10000.0000', 'status': 'POSTED', 'documentType': 'INVOICE',
    },
  ],
  'previousPeriod': <String, dynamic>{
    'from': '2025-01-01', 'to': '2025-12-31', 'revenue': '100000.0000',
    'expenses': '30000.0000', 'result': '70000.0000', 'revenueChange': '60.00',
  },
  'drillDown': <String, dynamic>{},
};

final Json _monthly = <String, dynamic>{
  'from': '2025-11-01',
  'months': <Map<String, dynamic>>[
    for (var index = 0; index < 12; index += 1)
      <String, dynamic>{
        'month': '2026-${((index % 12) + 1).toString().padLeft(2, '0')}',
        'sales': '${(index + 1) * 1000}.0000',
        'salesCount': index + 1,
        'purchases': '${(index + 1) * 400}.0000',
        'purchasesCount': index,
        'revenue': '${(index + 1) * 1100}.0000',
        'expenses': '${(index + 1) * 300}.0000',
        'result': '${(index + 1) * 800}.0000',
      },
  ],
};

Future<void> _pump(
  WidgetTester tester, {
  required Json summary,
  Json? monthly,
  Locale locale = const Locale('en'),
  AppUser user = _dashboardUser,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      key: UniqueKey(),
      overrides: [
        currentUserProvider.overrideWithValue(user),
        notificationFeedProvider.overrideWith((ref) async => <Json>[]),
        dashboardSummaryProvider.overrideWith((ref) async => summary),
        dashboardMonthlyProvider.overrideWith((ref) async => monthly ?? _monthly),
      ],
      child: wrapWithApp(child: const DashboardScreen(), locale: locale),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('only ADMIN and FINANCE_MANAGER can render statistics even if API mistakenly sends all fields', (tester) async {
    for (final role in ['ADMIN', 'FINANCE_MANAGER', 'GENERAL_MANAGER', 'ACCOUNTANT', 'SALES_MANAGER']) {
      final user = AppUser(id: 'role-test', username: 'fixture', fullName: 'Fixture', companyId: 'company-1',
        roles: [role], permissions: _dashboardUser.permissions);
      await _pump(tester, summary: _summary, user: user);
      expect(find.text('Total sales'), ['ADMIN', 'FINANCE_MANAGER'].contains(role) ? findsOneWidget : findsNothing);
      expect(find.text('Inventory value'), ['ADMIN', 'FINANCE_MANAGER'].contains(role) ? findsOneWidget : findsNothing);
    }
    const technicalOnly = AppUser(id: 'super', username: 'fixture', fullName: 'Fixture', companyId: 'company-1', isSuperAdmin: true);
    await _pump(tester, summary: _summary, user: technicalOnly);
    expect(find.text('Total sales'), findsNothing);
  });

  testWidgets('Arabic ADMIN dashboard renders existing metrics above recent operations', (tester) async {
    await tester.runAsync(() async {
      final loader = FontLoader('IBMPlexSansArabic');
      for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
        loader.addFont(Future.value(ByteData.sublistView(File('assets/fonts/IBMPlexSansArabic-$weight.ttf').readAsBytesSync())));
      }
      await loader.load();
      var directory = File(Platform.resolvedExecutable).parent;
      File? iconFile;
      while (directory.path != directory.parent.path) {
        final candidate = File('${directory.path}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
        if (candidate.existsSync()) { iconFile = candidate; break; }
        directory = directory.parent;
      }
      if (iconFile == null) throw StateError('Flutter icon font unavailable');
      final icons = FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(iconFile.readAsBytesSync())));
      await icons.load();
    });
    tester.view.physicalSize = const Size(1366, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final key = GlobalKey();
    const admin = AppUser(id: 'admin-fixture', username: 'fixture', fullName: 'Synthetic', companyId: 'company-1', roles: ['ADMIN'], isSuperAdmin: true);
    await tester.pumpWidget(RepaintBoundary(key: key, child: ProviderScope(overrides: [
      currentUserProvider.overrideWithValue(admin),
      dashboardSummaryProvider.overrideWith((ref) async => _summary),
      dashboardMonthlyProvider.overrideWith((ref) async => _monthly),
      notificationFeedProvider.overrideWith((ref) async => <Json>[]),
    ], child: MaterialApp(debugShowCheckedModeBanner: false, theme: AppTheme.dark(), locale: const Locale('ar'), localizationsDelegates: AppLocalizations.localizationsDelegates, supportedLocales: AppLocalizations.supportedLocales, home: const Scaffold(body: DashboardScreen())))));
    await tester.pumpAndSettle();
    expect(find.text('إجمالي المبيعات'), findsOneWidget);
    expect(tester.getTopLeft(find.text('إجمالي المبيعات')).dy, lessThan(tester.getTopLeft(find.text('S-100')).dy));
    await tester.runAsync(() async {
      final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      final image = await boundary.toImage();
      final data = await image.toByteData(format: ui.ImageByteFormat.png);
      final dir = Directory(Platform.environment['KAYAN_SHOT_DIR'] ?? Directory.systemTemp.path)..createSync(recursive: true);
      File('${dir.path}/dashboard-admin-existing-ar.png').writeAsBytesSync(data!.buffer.asUint8List());
    });
  });

  testWidgets('reuses the existing dashboard at the top and removes navigation/company/quick-action cards', (tester) async {
    tester.view.physicalSize = const Size(1366, 768);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await _pump(tester, summary: _summary, locale: const Locale('ar'));

    expect(find.text('إجمالي المبيعات'), findsOneWidget);
    expect(find.text('إجمالي المشتريات'), findsOneWidget);
    expect(find.text('قيمة المخزون'), findsOneWidget);
    expect(find.text('شركة الكيان للتجارة'), findsNothing);
    expect(find.text('إجراءات سريعة'), findsNothing);
    expect(find.text('S-100'), findsOneWidget);
  });

  testWidgets('reflows and completely hides KPIs, charts, lists, and derived values not returned by API', (tester) async {
    final limited = <String, dynamic>{
      'allowedSections': <String>['sales'],
      'sales': <String, dynamic>{'total': '150000.0000', 'invoices': 8},
      'hasData': true,
      'documentsInPeriod': 8,
    };
    await _pump(tester, summary: limited, monthly: <String, dynamic>{'months': []});

    expect(find.text('Total sales'), findsOneWidget);
    expect(find.text('Total purchases'), findsNothing);
    expect(find.text('Net result'), findsNothing);
    expect(find.text('Cash position'), findsNothing);
    expect(find.text('Receivables'), findsNothing);
    expect(find.text('Inventory value'), findsNothing);
    expect(find.text('Top customers'), findsNothing);
    expect(find.text('Monthly performance'), findsNothing);
  });

  testWidgets('shows a simple localized home when no dashboard indicator is allowed', (tester) async {
    await _pump(tester, summary: <String, dynamic>{'allowedSections': <String>[]});
    expect(find.textContaining('No dashboard indicators are available'), findsOneWidget);
    expect(find.text('Total sales'), findsNothing);
    expect(find.text('Total purchases'), findsNothing);
  });

  testWidgets('shows previous-period comparison only when the permitted financial sections exist', (tester) async {
    await _pump(tester, summary: _summary);
    expect(find.textContaining('Revenue this period'), findsOneWidget);
    expect(find.textContaining('+60.0%'), findsOneWidget);

    final salesOnly = <String, dynamic>{
      'allowedSections': <String>['charts', 'sales'],
      'sales': <String, dynamic>{'total': '1', 'invoices': 1},
      'previousPeriod': <String, dynamic>{'revenueChange': '90.00'},
    };
    await _pump(tester, summary: salesOnly, monthly: <String, dynamic>{'months': []});
    expect(find.textContaining('Revenue this period'), findsNothing);
    expect(find.textContaining('+90.0%'), findsNothing);
  });
}
