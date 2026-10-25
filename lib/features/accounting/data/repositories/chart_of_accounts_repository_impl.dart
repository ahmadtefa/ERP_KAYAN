import '../../../../core/error/failure.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/account.dart';
import '../../domain/repositories/chart_of_accounts_repository.dart';
import '../datasources/chart_of_accounts_data_source.dart';

class ChartOfAccountsRepositoryImpl implements ChartOfAccountsRepository {
  const ChartOfAccountsRepositoryImpl(this._source);

  final ChartOfAccountsDataSource _source;

  @override
  Future<Result<List<Account>>> fetchAccounts() async {
    try {
      final accounts = await _source.fetchAccounts();
      // Server order is not guaranteed; codes sort naturally as strings
      // because the chart uses zero-padded segments.
      final sorted = [...accounts]..sort((a, b) => a.code.compareTo(b.code));
      return Success(sorted);
    } on Failure catch (failure) {
      return ResultFailure(failure);
    } catch (e) {
      return ResultFailure(
        ServerFailure('Could not load chart of accounts', e),
      );
    }
  }

  @override
  Future<Result<String>> suggestCode({String? parentId}) async {
    try {
      return Success(await _source.suggestCode(parentId: parentId));
    } on Failure catch (failure) {
      return ResultFailure(failure);
    } catch (e) {
      return ResultFailure(ServerFailure('Could not suggest a code', e));
    }
  }

  @override
  Future<Result<Account>> createAccount(AccountInput input) async {
    try {
      return Success(await _source.createAccount(input));
    } on Failure catch (failure) {
      return ResultFailure(failure);
    } catch (e) {
      return ResultFailure(ServerFailure('Could not create the account', e));
    }
  }

  @override
  Future<Result<Account>> updateAccount(String id, AccountInput input) async {
    try {
      return Success(await _source.updateAccount(id, input));
    } on Failure catch (failure) {
      return ResultFailure(failure);
    } catch (e) {
      return ResultFailure(ServerFailure('Could not update the account', e));
    }
  }

  @override
  Future<Result<Account>> setAccountActive(
    String id, {
    required bool isActive,
  }) async {
    try {
      return Success(await _source.setActive(id, isActive: isActive));
    } on Failure catch (failure) {
      return ResultFailure(failure);
    } catch (e) {
      return ResultFailure(
        ServerFailure('Could not change the account status', e),
      );
    }
  }

  @override
  Future<Result<void>> deleteAccount(String id) async {
    try {
      await _source.deleteAccount(id);
      return Success<void>(null);
    } on Failure catch (failure) {
      return ResultFailure(failure);
    } catch (e) {
      return ResultFailure(ServerFailure('Could not delete the account', e));
    }
  }
}
