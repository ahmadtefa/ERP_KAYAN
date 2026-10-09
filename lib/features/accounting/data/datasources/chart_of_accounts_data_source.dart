import '../../../../core/network/api_client.dart';
import '../../domain/entities/account.dart';
import '../../domain/entities/account_type.dart';
import '../models/account_dto.dart';

abstract class ChartOfAccountsDataSource {
  Future<List<Account>> fetchAccounts();
}

/// Reads the chart of accounts from the ERP API.
class RemoteChartOfAccountsDataSource implements ChartOfAccountsDataSource {
  const RemoteChartOfAccountsDataSource(this._client);

  final ApiClient _client;

  static const _path = '/accounting/chart-of-accounts';

  @override
  Future<List<Account>> fetchAccounts() async {
    final json = await _client.get(_path);
    final items = json['items'] ?? json['data'];
    if (items is! List) {
      throw const FormatException('Unexpected chart-of-accounts payload');
    }
    return AccountDto.listFrom(items);
  }
}

/// Development-only sample chart of accounts.
///
/// REQUIRES BUSINESS DECISION: the production backend has not been selected
/// yet. This source exists so the interface can be exercised without one.
/// It keeps nothing in memory between calls and is never a system of record.
class SeedChartOfAccountsDataSource implements ChartOfAccountsDataSource {
  const SeedChartOfAccountsDataSource();

  @override
  Future<List<Account>> fetchAccounts() async => [
    // 1 — Assets
    _group('1', 'Assets', AccountType.asset),
    _group('11', 'Current assets', AccountType.asset, parent: '1'),
    _leaf('1101', 'Cash on hand', AccountType.asset, parent: '11'),
    _leaf('1102', 'Bank — current account', AccountType.asset, parent: '11'),
    _leaf('1103', 'Accounts receivable', AccountType.asset, parent: '11'),
    _leaf('1104', 'Inventory', AccountType.asset, parent: '11'),
    _leaf('1105', 'VAT receivable', AccountType.asset, parent: '11'),
    _group('12', 'Non-current assets', AccountType.asset, parent: '1'),
    _leaf('1201', 'Furniture and fixtures', AccountType.asset, parent: '12'),
    _leaf('1202', 'Vehicles', AccountType.asset, parent: '12'),
    // 2 — Liabilities
    _group('2', 'Liabilities', AccountType.liability),
    _leaf('2101', 'Accounts payable', AccountType.liability, parent: '2'),
    _leaf('2102', 'Accrued expenses', AccountType.liability, parent: '2'),
    _leaf('2103', 'VAT payable', AccountType.liability, parent: '2'),
    // 3 — Equity
    _group('3', 'Equity', AccountType.equity),
    _leaf('3101', 'Capital', AccountType.equity, parent: '3'),
    _leaf('3102', 'Retained earnings', AccountType.equity, parent: '3'),
    // 4 — Revenue
    _group('4', 'Revenue', AccountType.revenue),
    _leaf('4101', 'Sales revenue', AccountType.revenue, parent: '4'),
    _leaf('4102', 'Sales returns', AccountType.revenue, parent: '4'),
    // 5 — Expenses
    _group('5', 'Expenses', AccountType.expense),
    _leaf('5101', 'Cost of goods sold', AccountType.expense, parent: '5'),
    _leaf('5102', 'Salaries and wages', AccountType.expense, parent: '5'),
    _leaf('5103', 'Rent', AccountType.expense, parent: '5'),
    _leaf('5104', 'Utilities', AccountType.expense, parent: '5'),
  ];
}

Account _group(String code, String name, AccountType type, {String? parent}) =>
    Account(
      id: 'seed-$code',
      companyId: 'seed-company',
      code: code,
      name: name,
      type: type,
      parentId: parent == null ? null : 'seed-$parent',
      isPostable: false,
    );

Account _leaf(
  String code,
  String name,
  AccountType type, {
  required String parent,
}) => Account(
  id: 'seed-$code',
  companyId: 'seed-company',
  code: code,
  name: name,
  type: type,
  parentId: 'seed-$parent',
  isPostable: true,
);
