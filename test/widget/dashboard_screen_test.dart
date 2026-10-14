import 'package:erp_kayan/features/accounting/domain/entities/account.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/chart_of_accounts_providers.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
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
