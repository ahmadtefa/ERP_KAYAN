import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/dashboard/presentation/providers/dashboard_providers.dart';
import 'package:erp_kayan/features/dashboard/presentation/screens/dashboard_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

const _dashboardUser = AppUser(
  id: 'dashboard-test',
  username: 'manager',
  fullName: 'Dashboard test',
  companyId: 'company-1',
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
}) async {
  await tester.pumpWidget(
    ProviderScope(
      key: UniqueKey(),
      overrides: [
        currentUserProvider.overrideWithValue(_dashboardUser),
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
