import 'package:erp_kayan/features/accounting/data/datasources/chart_of_accounts_data_source.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account_type.dart';
import 'package:erp_kayan/features/accounting/presentation/providers/chart_of_accounts_providers.dart';
import 'package:erp_kayan/features/accounting/presentation/screens/chart_of_accounts_screen.dart';
import 'package:erp_kayan/features/data/presentation/providers/data_providers.dart';
import 'package:erp_kayan/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _ChartSource implements ChartOfAccountsDataSource {
  final List<Account> accounts = [
    const Account(id: 'root', companyId: 'c', code: '1', name: 'Assets',
        nameEn: 'Assets', nameAr: 'أصول', type: AccountType.asset, isPostable: false),
    const Account(id: 'child', companyId: 'c', code: '11', name: 'Current',
        nameEn: 'Current', nameAr: 'متداولة', type: AccountType.asset,
        parentId: 'root', isPostable: false),
    const Account(id: 'leaf', companyId: 'c', code: '1101', name: 'Cash',
        nameEn: 'Cash', nameAr: 'نقدية', type: AccountType.asset, parentId: 'child'),
    const Account(id: 'other', companyId: 'c', code: '2', name: 'Liabilities',
        nameEn: 'Liabilities', nameAr: 'التزامات', type: AccountType.liability),
  ];
  int loads = 0;
  AccountInput? createdInput;
  bool failCreate = false;
  bool commitBeforeFailure = false;
  int createAttempts = 0;

  @override
  Future<List<Account>> fetchAccounts() async { loads++; return [...accounts]; }
  @override
  Future<String> suggestCode({String? parentId}) async => '3';
  @override
  Future<Account> createAccount(AccountInput input) async {
    createAttempts++;
    createdInput = input;
    if (failCreate && !commitBeforeFailure) throw StateError('Synthetic save failure');
    final account = Account(id: 'new', companyId: 'c', code: input.code ?? '3',
        name: input.nameEn, nameEn: input.nameEn, nameAr: input.nameAr, type: input.type);
    accounts.add(account);
    if (failCreate) throw StateError('Synthetic response lost after commit');
    return account;
  }
  @override
  Future<Account> updateAccount(String id, AccountInput input) => throw UnimplementedError();
  @override
  Future<Account> setActive(String id, {required bool isActive}) => throw UnimplementedError();
  @override
  Future<void> deleteAccount(String id) => throw UnimplementedError();
}

Future<void> _open(WidgetTester tester, _ChartSource source) async {
  tester.view.physicalSize = const Size(1400, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      chartOfAccountsDataSourceProvider.overrideWithValue(source),
      exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown),
    ],
    child: MaterialApp(
      locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: const Scaffold(body: ChartOfAccountsScreen()),
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('collapse hides all descendants, expand restores them', (tester) async {
    final source = _ChartSource();
    await _open(tester, source);
    expect(find.textContaining('1101  Cash'), findsOneWidget);
    await tester.tap(find.byTooltip('Collapse subaccounts').first);
    await tester.pumpAndSettle();
    expect(find.textContaining('11  Current'), findsNothing);
    expect(find.textContaining('1101  Cash'), findsNothing);
    expect(find.textContaining('2  Liabilities'), findsOneWidget);
    await tester.tap(find.byTooltip('Expand subaccounts'));
    await tester.pumpAndSettle();
    expect(find.textContaining('1101  Cash'), findsOneWidget);
  });

  testWidgets('refresh actually reloads the chart', (tester) async {
    final source = _ChartSource();
    await _open(tester, source);
    final before = source.loads;
    source.accounts.add(const Account(id: 'later', companyId: 'c', code: '3',
      name: 'Capital', nameEn: 'Capital', nameAr: 'رأس المال', type: AccountType.equity));
    await tester.tap(find.byTooltip('Refresh'));
    await tester.pumpAndSettle();
    expect(source.loads, greaterThan(before));
    expect(find.textContaining('3  Capital'), findsOneWidget);
  });

  testWidgets('new account form creates and reloads the chart', (tester) async {
    final source = _ChartSource();
    await _open(tester, source);
    await tester.tap(find.text('New account'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Name in Arabic *'), 'أصل جديد');
    await tester.enterText(find.widgetWithText(TextField, 'Name in English *'), 'New asset');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(source.createdInput, isNotNull);
    expect(source.createdInput!.toCreateJson().containsKey('isActive'), isFalse);
    expect(find.textContaining('3  New asset'), findsOneWidget);
  });
  testWidgets('an uncertain save preserves the draft and refuses blind retry', (tester) async {
    final source = _ChartSource()..failCreate = true..commitBeforeFailure = true;
    await _open(tester, source);
    await tester.tap(find.text('New account'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Name in Arabic *'), 'أصل جديد');
    await tester.enterText(find.widgetWithText(TextField, 'Name in English *'), 'New asset');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNWidgets(2));
    await tester.tap(find.text('حسنًا'));
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(find.widgetWithText(TextField, 'Name in English *')).controller!.text,
        'New asset');
    expect(find.textContaining('The save result is uncertain'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Save')).onPressed, isNull);
    expect(source.createAttempts, 1);
    expect(source.loads, greaterThan(1));
    expect(source.accounts.where((account) => account.nameEn == 'New asset'), hasLength(1));
  });

  testWidgets('cancel and system back ask before discarding edited fields', (tester) async {
    final source = _ChartSource();
    await _open(tester, source);
    await tester.tap(find.text('New account'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Name in English *'), 'Unsaved asset');
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.text('Unsaved changes'), findsOneWidget);
    await tester.tap(find.text('Keep editing'));
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(find.widgetWithText(TextField, 'Name in English *')).controller!.text,
        'Unsaved asset');
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Unsaved changes'), findsOneWidget);
    await tester.tap(find.text('Discard changes'));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(TextField, 'Name in English *'), findsNothing);
    expect(source.createdInput, isNull);
  });

}
