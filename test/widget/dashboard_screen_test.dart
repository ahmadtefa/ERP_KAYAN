import 'package:erp_kayan/features/accounting/domain/entities/account.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/chart_of_accounts_providers.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:erp_kayan/features/dashboard/presentation/providers/dashboard_providers.dart';
import 'package:erp_kayan/features/dashboard/presentation/screens/dashboard_screen.dart';
import 'package:erp_kayan/features/settings/presentation/providers/company_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // A 1x1 transparent PNG in base64:
  const sampleLogoBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  final Map<String, dynamic> testCompany = <String, dynamic>{
    'id': 'company-1',
    'code': 'KAYAN-01',
    'nameAr': 'شركة الكيان للتجارة',
    'nameEn': 'Kayan Trading Co',
    'taxId': '300123456',
    'phone': '+20100000000',
    'email': 'info@kayan.test',
    'address': 'Cairo, Egypt',
    'hasLogo': true,
    'logoBase64': sampleLogoBase64,
  };

  final List<Map<String, dynamic>> testBranches = <Map<String, dynamic>>[
    <String, dynamic>{
      'id': 'branch-1',
      'code': 'HQ',
      'nameAr': 'المقر الرئيسي',
      'nameEn': 'Headquarters',
      'kind': 'HEADQUARTERS',
      'isActive': true,
    },
    <String, dynamic>{
      'id': 'branch-2',
      'code': 'ALX',
      'nameAr': 'فرع الإسكندرية',
      'nameEn': 'Alexandria Branch',
      'kind': 'BRANCH',
      'isActive': true,
    },
  ];

  final Json testSummary = <String, dynamic>{
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
        'id': 'ca-1',
        'code': 'CASH-1',
        'nameAr': 'الخزينة الرئيسية',
        'nameEn': 'Main cash box',
        'kind': 'CASH',
        'balance': '55000.0000',
      },
    ],
    'receivables': '30000.0000',
    'payables': '20000.0000',
    'overdue': <String, dynamic>{'total': '5000.0000', 'invoices': 1},
    'outstanding': <String, dynamic>{'total': '30000.0000', 'invoices': 3},
    'parties': <String, dynamic>{
      'customers': <String, dynamic>{'count': 12, 'active': 10},
      'suppliers': <String, dynamic>{'count': 5, 'active': 5},
    },
    'stock': <String, dynamic>{
      'value': '80000.0000',
      'itemsInStock': 40,
      'negativeBalances': 0,
      'needsReorder': 2,
    },
    'topCustomers': <Map<String, dynamic>>[
      <String, dynamic>{
        'id': 'c-1',
        'nameAr': 'شركة النور',
        'nameEn': 'Noor Co',
        'total': '60000.0000',
        'invoices': 3,
      },
    ],
    'topItems': <Map<String, dynamic>>[
      <String, dynamic>{
        'id': 'i-1',
        'nameAr': 'منتج ألف',
        'nameEn': 'Product Alpha',
        'quantity': '120.0000',
        'total': '40000.0000',
      },
    ],
    'recentDocuments': <Map<String, dynamic>>[
      <String, dynamic>{
        'kind': 'SALES_INVOICE',
        'id': 'inv-1',
        'number': 'S-100',
        'date': '2026-10-01',
        'partyNameAr': 'شركة النور',
        'partyNameEn': 'Noor Co',
        'amount': '10000.0000',
        'status': 'POSTED',
        'documentType': 'INVOICE',
      },
    ],
    'quickActions': <String, dynamic>{
      'draftDocuments': 3,
      'draftSales': 2,
      'draftPurchases': 1,
      'draftVouchers': 0,
      'draftJournals': 0,
      'overdueInvoices': 1,
      'itemsToReorder': 2,
    },
    'previousPeriod': <String, dynamic>{
      'from': '2025-01-01',
      'to': '2025-12-31',
      'revenue': '100000.0000',
      'expenses': '30000.0000',
      'result': '70000.0000',
      'revenueChange': '60.00',
    },
    'drillDown': <String, dynamic>{},
  };

  final Json testMonthly = <String, dynamic>{
    'from': '2025-11-01',
    'months': <Map<String, dynamic>>[
      for (var index = 0; index < 12; index += 1)
        <String, dynamic>{
          'month':
              '2026-${((index % 12) + 1).toString().padLeft(2, '0')}',
          'sales': '${(index + 1) * 1000}.0000',
          'salesCount': index + 1,
          'purchases': '${(index + 1) * 400}.0000',
          'purchasesCount': index,
          'receipts': '0.0000',
          'payments': '0.0000',
          'revenue': '${(index + 1) * 1100}.0000',
          'expenses': '${(index + 1) * 300}.0000',
          'result': '${(index + 1) * 800}.0000',
        },
    ],
  };

  Future<void> pumpDashboard(
    WidgetTester tester, {
    Locale locale = const Locale('ar'),
    Map<String, dynamic>? company,
    List<Map<String, dynamic>>? branches,
  }) async {
    final effectiveCompany = company ?? testCompany;
    final effectiveBranches = branches ?? testBranches;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          currentUserProvider.overrideWithValue(testUser),
          chartOfAccountsProvider.overrideWith(
            FakeChartOfAccountsController.new,
          ),
          companyProfileProvider.overrideWith(
            () => FakeCompanyProfileController(initialData: effectiveCompany),
          ),
          branchesProvider.overrideWith(
            () => FakeBranchesController(initialData: effectiveBranches),
          ),
          dashboardSummaryProvider.overrideWith((ref) async => testSummary),
          dashboardMonthlyProvider.overrideWith((ref) async => testMonthly),
        ],
        child: wrapWithApp(child: const DashboardScreen(), locale: locale),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'Dashboard displays company name, logo, tax ID and branch in Arabic',
    (tester) async {
      await pumpDashboard(tester, locale: const Locale('ar'));

      // Company name in Arabic should be displayed
      expect(find.text('شركة الكيان للتجارة'), findsWidgets);
      // Secondary English name displayed
      expect(find.text('Kayan Trading Co'), findsOneWidget);
      // Tax ID displayed
      expect(find.textContaining('300123456'), findsOneWidget);
      // Company code displayed
      expect(find.textContaining('KAYAN-01'), findsOneWidget);
      // Branch name displayed
      expect(find.textContaining('المقر الرئيسي'), findsWidgets);
      // Logo image rendered
      expect(find.byType(Image), findsOneWidget);
    },
  );

  testWidgets(
    'Dashboard displays English company name and branch in English locale',
    (tester) async {
      await pumpDashboard(tester, locale: const Locale('en'));

      // Primary name is English
      expect(find.text('Kayan Trading Co'), findsWidgets);
      // Secondary name is Arabic
      expect(find.text('شركة الكيان للتجارة'), findsOneWidget);
      // Branch name in English
      expect(find.textContaining('Headquarters'), findsWidgets);
    },
  );

  testWidgets(
    'Dashboard shows server figures: totals, cash, top parties and activity',
    (tester) async {
      await pumpDashboard(tester, locale: const Locale('en'));

      // KPI cards come from the server summary.
      expect(find.text('Total sales'), findsOneWidget);
      expect(find.text('Total purchases'), findsOneWidget);
      expect(find.text('Receipts'), findsOneWidget);
      expect(find.text('Payments'), findsOneWidget);
      expect(find.text('Cash position'), findsOneWidget);
      expect(find.text('Receivables'), findsOneWidget);
      expect(find.text('Overdue invoices'), findsOneWidget);

      // Formatted money values from the summary.
      expect(find.textContaining('150,000'), findsWidgets);

      // Top customer and best-selling product panels.
      expect(find.text('Top customers'), findsOneWidget);
      expect(find.text('Noor Co'), findsWidgets);
      expect(find.text('Best-selling products'), findsOneWidget);
      expect(find.text('Product Alpha'), findsWidgets);

      // Recent activity shows the latest document.
      expect(find.text('S-100'), findsOneWidget);
    },
  );

  testWidgets('Dashboard shows the previous-period comparison', (tester) async {
    await pumpDashboard(tester, locale: const Locale('en'));

    expect(find.textContaining('Revenue this period'), findsOneWidget);
    expect(find.textContaining('Revenue previous period'), findsOneWidget);
    expect(find.textContaining('+60.0%'), findsOneWidget);
  });
}

class FakeChartOfAccountsController extends ChartOfAccountsController {
  @override
  Future<List<Account>> build() async => const [];
}

class FakeCompanyProfileController extends CompanyProfileController {
  FakeCompanyProfileController({required this.initialData});

  final Map<String, dynamic> initialData;

  @override
  Future<Map<String, dynamic>> build() async => initialData;
}

class FakeBranchesController extends BranchesController {
  FakeBranchesController({required this.initialData});

  final List<Map<String, dynamic>> initialData;

  @override
  Future<List<Map<String, dynamic>>> build() async => initialData;
}
