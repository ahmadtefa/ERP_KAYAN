import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account_type.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/chart_of_accounts_providers.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/reports/presentation/reports_screen.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

/// The reports screen against a scripted API: one trial-balance row and the
/// ledger behind it. Proves the ledger shows the entry date as a date.
class _FakeApiClient extends ApiClient {
  _FakeApiClient()
    : super(
        const AppConfig(
          environment: AppEnvironment.development,
          apiBaseUrl: 'https://test.invalid/api/v1',
          connectTimeout: Duration(seconds: 1),
          receiveTimeout: Duration(seconds: 1),
        ),
        FakeTokenStore(),
      );

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    if (path.startsWith('/reports/trial-balance')) {
      return {
        'rows': [
          {
            'accountId': 'acc-cash',
            'code': '1101.REC',
            'nameEn': 'Lifecycle cash',
            'opening': '0.0000',
            'debit': '270763.0000',
            'credit': '122412.0000',
            'closing': '148351.0000',
          },
        ],
        'totals': {
          'debit': '270763.0000',
          'credit': '272412.0000',
          'closingDebit': '148351.0000',
          'closingCredit': '150000.0000',
          'difference': '0.0000',
        },
      };
    }
    if (path.startsWith('/reports/account-ledger/')) {
      return {
        'opening': '0.0000',
        'closing': '148351.0000',
        'movements': [
          {
            'entryDate': '2024-01-02',
            'entryNumber': 'JV-000001',
            'description': 'Capital',
            'debit': '150000.0000',
            'credit': '0.0000',
            'runningBalance': '150000.0000',
          },
        ],
      };
    }
    return {};
  }
}

class _FakeChart extends ChartOfAccountsController {
  @override
  Future<List<Account>> build() async => const [
    Account(
      id: 'acc-cash',
      companyId: 'company-1',
      code: '1101.REC',
      name: 'Lifecycle cash',
      nameEn: 'Lifecycle cash',
      type: AccountType.asset,
    ),
  ];
}

const _user = AppUser(
  id: 'user-1',
  username: 'accountant',
  fullName: 'Accountant',
  companyId: 'company-1',
  branchId: 'branch-1',
  permissions: [
    'reports.trial-balance.read',
    'reports.account-ledger.read',
  ],
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the ledger shows the entry date as a date, not as a stored '
      'string', (tester) async {
    tester.view.physicalSize = const Size(1500, 950);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(_FakeApiClient()),
          currentUserProvider.overrideWithValue(_user),
          chartOfAccountsProvider.overrideWith(() => _FakeChart()),
        ],
        child: const MaterialApp(
          locale: Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(body: ReportsScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('1101.REC'));
    await tester.pumpAndSettle();

    expect(find.text('JV-000001'), findsOneWidget);
    expect(find.textContaining('January 2, 2024'), findsWidgets);
    expect(tester.takeException(), isNull);
  });
}
