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
}
