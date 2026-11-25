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

Account _a(String id, String code, String name, {String? parent, bool postable = false, String scheme = 'eight_digit'}) => Account(
      id: id, companyId: 'c', code: code, name: name, nameEn: name, nameAr: name,
      type: AccountType.asset, parentId: parent, isPostable: postable, codeScheme: scheme);

class _Source implements ChartOfAccountsDataSource {
  _Source(this.accounts, this.suggestion);
  final List<Account> accounts;
  final String suggestion;
  @override
  Future<List<Account>> fetchAccounts() async => [...accounts];
  @override
  Future<String> suggestCode({String? parentId}) async => suggestion;
  @override
  Future<Account> createAccount(AccountInput input) => throw UnimplementedError();
  @override
  Future<Account> updateAccount(String id, AccountInput input) => throw UnimplementedError();
  @override
  Future<Account> setActive(String id, {required bool isActive}) => throw UnimplementedError();
  @override
  Future<void> deleteAccount(String id) => throw UnimplementedError();
}

Future<void> _open(WidgetTester tester, _Source source, [Locale locale = const Locale('en')]) async {
  tester.view.physicalSize = const Size(1400, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      chartOfAccountsDataSourceProvider.overrideWithValue(source),
      currentUserProvider.overrideWithValue(const AppUser(id: 'u', username: 'u', fullName: 'User', companyId: 'c', isSuperAdmin: true)),
      exportCapabilitiesProvider.overrideWith((ref) async => ExportCapabilities.unknown),
    ],
    child: MaterialApp(
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: const Scaffold(body: ChartOfAccountsScreen()),
    ),
  ));
  await tester.pumpAndSettle();
}

final _eight = [
  _a('1', '01', 'Assets'),
  _a('2', '0101', 'Current assets', parent: '1'),
  _a('3', '010101', 'Cash and banks', parent: '2'),
  _a('4', '01010101', 'Cash on hand', parent: '3', postable: true),
];

void main() {
  testWidgets('eight digit chart: digits only, 8 max, postable follows the code, 8-digit accounts are not parents', (tester) async {
    await _open(tester, _Source(_eight, '010102'));
    await tester.tap(find.text('New account'));
    await tester.pumpAndSettle();
    final codeField = find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField)).first;
    // suggestion is a 6-digit total, so the switch is off and disabled
    expect(find.textContaining('Code of 2, 4, 6 or 8 digits'), findsOneWidget);
    SwitchListTile sw() => tester.widget<SwitchListTile>(find.byType(SwitchListTile).first);
    expect(sw().value, isFalse);
    expect(sw().onChanged, isNull);
    // letters are dropped, length stops at 8, 8 digits turn posting on
    await tester.enterText(codeField, '0101ab0199999');
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(codeField).controller!.text, '01010199');
    expect(sw().value, isTrue);
    await tester.enterText(codeField, '0101');
    await tester.pumpAndSettle();
    expect(sw().value, isFalse);
    // a screenshot for the record
    await tester.enterText(codeField, '01010199');
    await tester.pumpAndSettle();
    await expectLater(find.byType(AlertDialog), matchesGoldenFile('goldens/chart_eight_digit_dialog.png'));
    // the parent picker does not offer the 8-digit account
    await tester.tap(find.byType(DropdownButtonFormField<String?>).first);
    await tester.pumpAndSettle();
    final items = find.byType(DropdownMenuItem<String?>);
    expect(find.descendant(of: items, matching: find.textContaining('01010101')), findsNothing);
    expect(find.descendant(of: items, matching: find.textContaining('010101')), findsWidgets);
  });

  testWidgets('Arabic (RTL): 8-digit leaf is postable-on and locked, 2-digit parent is off and locked', (tester) async {
    await _open(tester, _Source(_eight, '010102'), const Locale('ar'));
    await tester.tap(find.byIcon(Icons.add).first);
    await tester.pumpAndSettle();
    final codeField = find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField)).first;
    SwitchListTile sw() => tester.widget<SwitchListTile>(find.byType(SwitchListTile).first);
    await tester.enterText(codeField, '01');
    await tester.pumpAndSettle();
    expect(sw().value, isFalse);
    expect(sw().onChanged, isNull);
    await tester.enterText(codeField, '01010199');
    await tester.pumpAndSettle();
    expect(sw().value, isTrue);
    expect(sw().onChanged, isNull);
    expect(Directionality.of(tester.element(find.byType(AlertDialog))), TextDirection.rtl);
  });

  testWidgets('legacy chart keeps the free postable switch and the old code field', (tester) async {
    await _open(tester, _Source([
      _a('1', '1', 'Assets', scheme: 'legacy'),
      _a('2', '1101', 'Cash', parent: '1', postable: true, scheme: 'legacy'),
    ], '12'));
    await tester.tap(find.text('New account'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Code of 2, 4, 6 or 8 digits'), findsNothing);
    expect(tester.widget<SwitchListTile>(find.byType(SwitchListTile).first).onChanged, isNotNull);
  });
}
