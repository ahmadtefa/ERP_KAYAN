import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/features/accounting/data/datasources/chart_of_accounts_data_source.dart';
import 'package:erp_kayan/features/accounting/data/repositories/chart_of_accounts_repository_impl.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account_type.dart';
import 'package:flutter_test/flutter_test.dart';

class _StubSource implements ChartOfAccountsDataSource {
  _StubSource(this._result);

  final Future<List<Account>> Function() _result;

  @override
  Future<List<Account>> fetchAccounts() => _result();
}

Account account(String code, {AccountType type = AccountType.asset}) => Account(
  id: 'id-$code',
  companyId: 'c1',
  code: code,
  name: 'Account $code',
  type: type,
);

void main() {
  group('ChartOfAccountsRepositoryImpl', () {
    test('returns accounts sorted by code', () async {
      final repo = ChartOfAccountsRepositoryImpl(
        _StubSource(
          () async => [account('5102'), account('1101'), account('2101')],
        ),
      );

      final result = await repo.fetchAccounts();

      expect(result.isSuccess, isTrue);
      expect(result.valueOrNull!.map((a) => a.code).toList(), [
        '1101',
        '2101',
        '5102',
      ]);
    });

    test('maps a transport failure onto a Failure result', () async {
      final repo = ChartOfAccountsRepositoryImpl(
        _StubSource(() async => throw const NetworkFailure()),
      );

      final result = await repo.fetchAccounts();

      expect(result.isFailure, isTrue);
      expect(result.failureOrNull, isA<NetworkFailure>());
    });

    test('wraps an unexpected error as a ServerFailure', () async {
      final repo = ChartOfAccountsRepositoryImpl(
        _StubSource(() async => throw const FormatException('bad payload')),
      );

      final result = await repo.fetchAccounts();

      expect(result.failureOrNull, isA<ServerFailure>());
      expect(result.failureOrNull!.cause, isA<FormatException>());
    });

    test(
      'returns an empty list rather than null when there are no accounts',
      () async {
        final repo = ChartOfAccountsRepositoryImpl(_StubSource(() async => []));
        final result = await repo.fetchAccounts();
        expect(result.valueOrNull, isEmpty);
      },
    );
  });

  group('SeedChartOfAccountsDataSource', () {
    test('produces a balanced-looking chart with postable leaves', () async {
      const source = SeedChartOfAccountsDataSource();
      final accounts = await source.fetchAccounts();

      expect(accounts, isNotEmpty);
      expect(accounts.any((a) => a.isPostable), isTrue);
      expect(accounts.any((a) => !a.isPostable), isTrue);
      // Every non-root account must point at an existing parent.
      final ids = accounts.map((a) => a.id).toSet();
      for (final a in accounts.where((a) => a.parentId != null)) {
        expect(ids.contains(a.parentId), isTrue, reason: '${a.code} parent');
      }
    });

    test('every account type is represented', () async {
      const source = SeedChartOfAccountsDataSource();
      final types = (await source.fetchAccounts()).map((a) => a.type).toSet();
      expect(types.length, AccountType.values.length);
    });
  });
}
