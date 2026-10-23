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

  @override
  Future<String> suggestCode({String? parentId}) async => '';

  @override
  Future<Account> createAccount(AccountInput input) =>
      throw UnsupportedError('stub');

  @override
  Future<Account> updateAccount(String id, AccountInput input) =>
      throw UnsupportedError('stub');

  /// Records what a status change asked for, so the test can prove it is a
  /// status change and not a full update.
  bool? lastIsActive;
  String? lastStatusId;

  /// When set, the next status change fails with this failure instead of
  /// succeeding — the shape the API answers with when it refuses.
  Failure? statusFailure;

  @override
  Future<Account> setActive(String id, {required bool isActive}) async {
    final failure = statusFailure;
    if (failure != null) throw failure;
    lastStatusId = id;
    lastIsActive = isActive;
    return account('1104');
  }

  @override
  Future<void> deleteAccount(String id) => throw UnsupportedError('stub');
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

    test('a status change is forwarded as a status change, nothing more',
        () async {
      final source = _StubSource(() async => []);
      final repo = ChartOfAccountsRepositoryImpl(source);

      final result = await repo.setAccountActive('id-1104', isActive: false);

      expect(result.isSuccess, isTrue);
      expect(source.lastStatusId, 'id-1104');
      expect(source.lastIsActive, isFalse);
    });

    test('a refused status change comes back as a Failure, not a throw',
        () async {
      final source = _StubSource(() async => []);
      source.statusFailure = const ApiFailure(
        'Deactivate active subaccounts before deactivating their parent',
        statusCode: 400,
      );
      final repo = ChartOfAccountsRepositoryImpl(source);

      final result = await repo.setAccountActive('p-1', isActive: false);

      expect(result.isSuccess, isFalse);
      // The server's reason survives: the screen can explain why.
      expect(
        result.failureOrNull!.message,
        contains('Deactivate active subaccounts'),
      );
      expect(source.lastStatusId, isNull);
    });
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
