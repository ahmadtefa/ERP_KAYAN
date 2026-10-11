import '../../../../core/result/result.dart';
import '../entities/account.dart';
import '../../data/datasources/chart_of_accounts_data_source.dart'
    show AccountInput;

/// Contract for the chart of accounts.
///
/// The server owns every rule — unique codes, parent validity, what may be
/// deleted — so the client simply forwards intent and reports what came back.
abstract class ChartOfAccountsRepository {
  Future<Result<List<Account>>> fetchAccounts();

  /// The next free code under a parent, following the chart's own numbering.
  Future<Result<String>> suggestCode({String? parentId});

  Future<Result<Account>> createAccount(AccountInput input);
  Future<Result<Account>> updateAccount(String id, AccountInput input);

  /// Soft-deletes. The server refuses when the account has movements or
  /// children and says so in the failure message.
  Future<Result<void>> deleteAccount(String id);
}
