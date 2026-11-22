import 'package:erp_kayan/features/accounting/domain/entities/account.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/chart_of_accounts_providers.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/settings/presentation/providers/company_providers.dart';

/// The fixtures the reviewed screenshots are drawn from.
///
/// They live here rather than in one test file so a second screenshot test can
/// build the same frame. The first attempt at a menu picture declared its own
/// user with an explicit permission list; the shell hides a section when the
/// user cannot open anything in it, so the menu came out incomplete and every
/// assertion in that file failed. Sharing the super-administrator below is what
/// makes "the eight sections" true in a screenshot.

class FakeChartOfAccountsController extends ChartOfAccountsController {
  @override
  Future<List<Account>> build() async => const [];
}

class FakeCompanyProfileController extends CompanyProfileController {
  @override
  Future<Map<String, dynamic>> build() async => const {
    'id': 'company-1',
    'code': 'KAYAN-01',
    'nameAr': 'شركة الكيان للتجارة',
    'nameEn': 'Kayan Trading Co',
    'taxId': '300123456',
    'phone': '+20100000000',
    'email': 'info@kayan.test',
    'address': 'Cairo, Egypt',
    'hasLogo': false,
  };
}

class FakeBranchesController extends BranchesController {
  @override
  Future<List<Map<String, dynamic>>> build() async => const [
    {
      'id': 'branch-1',
      'code': 'HQ',
      'nameAr': 'المقر الرئيسي',
      'nameEn': 'Headquarters',
      'kind': 'HEADQUARTERS',
      'isActive': true,
    },
  ];
}

/// A super administrator: every section of the menu is visible to this user.
const screenshotAdmin = AppUser(
  id: 'admin-1',
  username: 'admin',
  fullName: 'مدير النظام',
  companyId: 'company-1',
  branchId: 'branch-1',
  roles: ['ADMIN'],
  isSuperAdmin: true,
);
