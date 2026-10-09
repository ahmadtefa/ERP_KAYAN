import '../../../../core/result/result.dart';
import '../entities/account.dart';

/// Contract for reading the chart of accounts.
///
/// Accounts are owned by the server; this client only ever reads them here.
abstract class ChartOfAccountsRepository {
  Future<Result<List<Account>>> fetchAccounts();
}
