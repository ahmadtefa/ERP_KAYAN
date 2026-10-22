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

/// The reports screen, driven the way a user drives it, against a
/// scripted API serving the lifecycle scenario's own figures:
/// cash 148,351 with sections 4,951 / −6,600 / 150,000, a receivable
/// held at −250 by an advance. Proves the numbers reach the screen
/// through the real tabs and that a trial-balance row opens its
/// ledger. The server-side truth of the figures belongs to the
/// PostgreSQL integration scenario.
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

  final List<String> requested = [];

  @override
  Future<Map<String, dynamic>> getObject(
    String path, {
    Map<String, dynamic>? query,
  }) async {
    requested.add(path);
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
          {
            'accountId': 'acc-capital',
            'code': '3101',
            'nameEn': 'Capital',
            'opening': '0.0000',
            'debit': '0.0000',
            'credit': '150000.0000',
            'closing': '-150000.0000',
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
    if (path.startsWith('/reports/cash-flow')) {
      return {
        'inflows': const [],
        'outflows': const [],
        'sections': [
          {'cashFlowClass': 'operating', 'inflow': '6163.0000', 'outflow': '1212.0000', 'net': '4951.0000'},
          {'cashFlowClass': 'investing', 'inflow': '120000.0000', 'outflow': '126600.0000', 'net': '-6600.0000'},
          {'cashFlowClass': 'financing', 'inflow': '150000.0000', 'outflow': '0.0000', 'net': '150000.0000'},
          {'cashFlowClass': 'unclassified', 'inflow': '0.0000', 'outflow': '0.0000', 'net': '0.0000'},
        ],
        'totals': {
          'opening': '0.0000',
          'inflow': '276163.0000',
          'outflow': '127812.0000',
          'net': '148351.0000',
          'closing': '148351.0000',
        },
      };
    }
    if (path.startsWith('/reports/reconciliation-center')) {
      return {
        'asOf': '2026-10-22',
        'sections': [
          {
            'key': 'receivables',
            'status': 'difference',
            'fullyExplained': true,
            'subledger': '0.0000',
            'control': '-250.0000',
            'difference': '-250.0000',
            'reason': null,
            'details': {'advances': '250.0000', 'unexplained': '0.0000'},
          },
          {
            'key': 'payables',
            'status': 'matched',
            'fullyExplained': true,
            'subledger': '0.0000',
            'control': '0.0000',
            'difference': '0.0000',
            'reason': null,
            'details': {'unexplained': '0.0000'},
          },
          {
            'key': 'inventory',
            'status': 'difference',
            'fullyExplained': false,
            'subledger': '300.0000',
            'control': '325.0000',
            'difference': '-25.0000',
            'reason': null,
            'details': {'controlCode': '1104'},
          },
          {
            'key': 'fixedAssets',
            'status': 'matched',
            'fullyExplained': true,
            'subledger': '1300.0000',
            'control': '1300.0000',
            'difference': '0.0000',
            'reason': null,
            'details': {},
          },
        ],
      };
    }
    if (path.startsWith('/reports/receivables-reconciliation')) {
      return {
        'controlBalance': '-250.0000',
        'subledger': {
          'invoiced': '684.0000',
          'notes': '171.0000',
          'paidApplied': '513.0000',
          'total': '0.0000',
        },
        'advances': '250.0000',
        'otherPostings': const [],
        'difference': '-250.0000',
        'unexplained': '0.0000',
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
    Account(
      id: 'acc-capital',
      companyId: 'company-1',
      code: '3101',
      name: 'Capital',
      nameEn: 'Capital',
      type: AccountType.equity,
    ),
  ];
}

const _user = AppUser(
  id: 'user-1',
  username: 'accountant',
  fullName: 'Accountant',
  companyId: 'company-1',
  branchId: 'branch-1',
  permissions: ['reports.read', 'accounting.fixedassets.read'],
);

Future<_FakeApiClient> _pump(
  WidgetTester tester, {
  Size size = const Size(1500, 950),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final api = _FakeApiClient();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        currentUserProvider.overrideWithValue(_user),
        chartOfAccountsProvider.overrideWith(() => _FakeChart()),
      ],
      child: const MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: ReportsScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return api;
}

/// The tab bar holds 21 reports; walk it sideways until the tab shows.
Future<void> _openTab(WidgetTester tester, String label) async {
  // Tab labels are the Tab widgets' own texts. The report strip texts
  // could collide, so look inside the TabBar only.
  final tab = find.descendant(of: find.byType(TabBar), matching: find.text(label));
  await tester.scrollUntilVisible(
    tab,
    200,
    scrollable: find.descendant(
      of: find.byType(TabBar),
      matching: find.byType(Scrollable),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(tab);
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('a trial-balance row opens that account in the ledger', (
    tester,
  ) async {
    final api = await _pump(tester);

    expect(find.text('1101.REC'), findsOneWidget);
    expect(find.textContaining('148,351'), findsWidgets);

    await tester.tap(find.text('1101.REC'));
    await tester.pumpAndSettle();

    expect(
      api.requested.any((p) => p.startsWith('/reports/account-ledger/acc-cash')),
      isTrue,
      reason: 'the ledger tab must load the tapped account',
    );
    expect(find.text('JV-000001'), findsOneWidget);
  });

  testWidgets('the cash-flow tab shows balances and IAS 7 sections', (
    tester,
  ) async {
    await _pump(tester);
    await _openTab(tester, 'Cash flow');

    expect(find.textContaining('Opening cash: 0.00'), findsOneWidget);
    expect(find.textContaining('Closing cash: 148,351'), findsOneWidget);
    expect(find.textContaining('Operating: 4,951'), findsOneWidget);
    expect(find.textContaining('Investing: -6,600'), findsOneWidget);
    expect(find.textContaining('Financing: 150,000'), findsOneWidget);
  });

  testWidgets('the receivables reconciliation tab explains its difference', (
    tester,
  ) async {
    await _pump(tester);
    await _openTab(tester, 'Receivables reconciliation');

    expect(find.textContaining('Subledger: 0.00'), findsOneWidget);
    expect(find.textContaining('Control account: -250'), findsOneWidget);
    expect(find.textContaining('Advances held: 250'), findsOneWidget);
    expect(find.textContaining('Unexplained: 0.00'), findsOneWidget);
  });

  testWidgets('the reconciliation centre shows every subledger at once', (
    tester,
  ) async {
    await _pump(tester);
    await _openTab(tester, 'Reconciliation center');

    // Matched, explained and unexplained differences read differently.
    expect(find.text('Matched'), findsNWidgets(2));
    expect(find.text('Explained difference'), findsOneWidget);
    expect(find.text('Difference'), findsWidgets);
    expect(find.text('Receivables reconciliation'), findsWidgets);
    expect(find.text('Inventory reconciliation'), findsOneWidget);
    expect(find.textContaining('-25.00'), findsOneWidget);
  });

  testWidgets('the trial balance is readable on a 390px phone', (tester) async {
    await _pump(tester, size: const Size(390, 844));

    expect(tester.takeException(), isNull,
        reason: 'no overflow in the phone-width trial balance');
    expect(find.text('1101.REC'), findsWidgets);
    expect(find.textContaining('148,351'), findsWidgets);
  });

  testWidgets('the reconciliation centre is readable on a 320px phone', (
    tester,
  ) async {
    await _pump(tester, size: const Size(320, 700));
    await _openTab(tester, 'Reconciliation center');

    final error = tester.takeException();
    if (error is FlutterError) {
      // Print the full diagnostics (which widget, which row) — the
      // one-line summary alone cannot be diagnosed from CI output.
      debugPrint(error.toStringDeep());
    }
    expect(error, isNull, reason: 'no overflow in the phone-width centre');
    expect(find.text('Matched'), findsWidgets);
    expect(find.textContaining('-25.00'), findsWidgets);
  });
}
