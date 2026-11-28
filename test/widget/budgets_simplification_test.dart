import 'package:erp_kayan/core/config/app_config.dart';
import 'package:erp_kayan/core/network/api_client.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account_type.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/chart_of_accounts_providers.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/cost_center_providers.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/budgets_screen.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_harness.dart';

class _BudgetApi extends ApiClient {
  _BudgetApi()
    : super(
        AppConfig.forLocalServer('http://127.0.0.1:3210/api/v1'),
        FakeTokenStore(),
      );

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async => {
    'items': [
      {
        'id': 'budget',
        'costCenterId': 'center',
        'accountId': 'account',
        'costCenter': {'code': 'CC-1', 'nameEn': 'Head office'},
        'account': {'code': '5100', 'nameEn': 'Rent'},
        'periodStart': '2026-01-01',
        'periodEnd': '2026-12-31',
        'amount': '1234.5',
        'notes': '',
        'isActive': true,
      },
    ],
  };
}

class _BudgetAccounts extends ChartOfAccountsController {
  @override
  Future<List<Account>> build() async => const [
    Account(
      id: 'account',
      companyId: 'company',
      code: '5100',
      name: 'Rent',
      type: AccountType.expense,
    ),
  ];
}

const _user = AppUser(
  id: 'user',
  username: 'user',
  fullName: 'User',
  companyId: 'company',
  isSuperAdmin: true,
);

Future<void> _pump(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1700, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(_BudgetApi()),
        currentUserProvider.overrideWithValue(_user),
        chartOfAccountsProvider.overrideWith(_BudgetAccounts.new),
        costCentersProvider.overrideWith(
          (ref) async => [
            {'id': 'center', 'code': 'CC-1', 'nameEn': 'Head office', 'isActive': true},
          ],
        ),
      ],
      child: const MaterialApp(
        locale: Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: BudgetsScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the budget list reads in words, not raw values', (tester) async {
    await _pump(tester);

    // A date with its year, and an amount with a fixed two decimals.
    expect(find.textContaining('January 1, 2026'), findsOneWidget);
    expect(find.textContaining('December 31, 2026'), findsOneWidget);
    expect(find.textContaining('1,234.50'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the budget form groups its fields under short headings', (
    tester,
  ) async {
    await _pump(tester);

    final edit = find.byTooltip('Edit');
    await tester.ensureVisible(edit);
    await tester.pumpAndSettle();
    await tester.tap(edit);
    await tester.pumpAndSettle();

    expect(find.text('Budget details'), findsOneWidget);
    expect(find.text('Period and amount'), findsOneWidget);
    expect(find.text('Notes'), findsOneWidget);
    // One helper line on the field whose unit is not obvious.
    expect(
      find.text('In the company currency, with no conversion.'),
      findsOneWidget,
    );
    // The label the existing draft test types into is unchanged.
    expect(find.widgetWithText(TextFormField, 'Description'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
