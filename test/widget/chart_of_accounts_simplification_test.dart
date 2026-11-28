import 'package:erp_kayan/features/accounting/data/datasources/chart_of_accounts_data_source.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account_type.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/chart_of_accounts_providers.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/chart_of_accounts_screen.dart';
import 'package:erp_kayan/features/auth/domain/entities/app_user.dart';
import 'package:erp_kayan/features/auth/presentation/providers/auth_providers.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _ChartSource implements ChartOfAccountsDataSource {
  _ChartSource({this.accounts = const []});

  final List<Account> accounts;

  @override
  Future<List<Account>> fetchAccounts() async => [...accounts];

  @override
  Future<String> suggestCode({String? parentId}) async => '3';

  @override
  Future<Account> createAccount(AccountInput input) async => Account(
    id: 'new',
    companyId: 'c',
    code: input.code ?? '3',
    name: input.nameEn,
    nameEn: input.nameEn,
    nameAr: input.nameAr,
    type: input.type,
  );

  @override
  Future<Account> updateAccount(String id, AccountInput input) async =>
      accounts.firstWhere((account) => account.id == id);

  @override
  Future<Account> setActive(String id, {required bool isActive}) async =>
      accounts.firstWhere((account) => account.id == id);

  @override
  Future<void> deleteAccount(String id) async {}
}

const _assets = [
  Account(
    id: 'root',
    companyId: 'c',
    code: '1',
    name: 'Assets',
    nameEn: 'Assets',
    nameAr: 'أصول',
    type: AccountType.asset,
    isPostable: false,
  ),
  Account(
    id: 'leaf',
    companyId: 'c',
    code: '1101',
    name: 'Cash',
    nameEn: 'Cash',
    nameAr: 'نقدية',
    type: AccountType.asset,
    parentId: 'root',
  ),
];

Future<void> _pump(WidgetTester tester, List<Account> accounts) async {
  tester.view.physicalSize = const Size(1400, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        chartOfAccountsDataSourceProvider.overrideWithValue(
          _ChartSource(accounts: accounts),
        ),
        currentUserProvider.overrideWithValue(
          const AppUser(
            id: 'u',
            username: 'u',
            fullName: 'User',
            companyId: 'c',
            isSuperAdmin: true,
          ),
        ),
        exportCapabilitiesProvider.overrideWith(
          (ref) async => ExportCapabilities.unknown,
        ),
      ],
      child: const MaterialApp(
        locale: Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: ChartOfAccountsScreen()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the chart explains its own rule in one line', (tester) async {
    await _pump(tester, _assets);

    expect(
      find.textContaining('Every account sits under its parent'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('the account editor groups its fields under short headings', (
    tester,
  ) async {
    await _pump(tester, _assets);

    await tester.tap(find.text('New account'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty chart says what happened and the next step', (
    tester,
  ) async {
    await _pump(tester, const []);

    expect(find.textContaining('No accounts yet'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
