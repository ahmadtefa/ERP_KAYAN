import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../auth/presentation/providers/auth_providers.dart';
import '../../data/datasources/chart_of_accounts_data_source.dart';
import '../../data/repositories/chart_of_accounts_repository_impl.dart';
import '../../domain/entities/account.dart';
import '../../domain/repositories/chart_of_accounts_repository.dart';

/// Chooses the data source for the chart of accounts.
///
/// In every non-development environment this is the real API. The sample
/// source is selected only when [AppConfig.useSeedData] is true, and the UI
/// surfaces that fact to the user rather than hiding it.
final chartOfAccountsDataSourceProvider = Provider<ChartOfAccountsDataSource>((
  ref,
) {
  final config = ref.watch(appConfigProvider);
  if (config.useSeedData) return const SeedChartOfAccountsDataSource();
  return RemoteChartOfAccountsDataSource(ref.watch(apiClientProvider));
});

final chartOfAccountsRepositoryProvider = Provider<ChartOfAccountsRepository>(
  (ref) => ChartOfAccountsRepositoryImpl(
    ref.watch(chartOfAccountsDataSourceProvider),
  ),
);

/// Loads the chart of accounts and exposes the standard async states.
class ChartOfAccountsController extends AsyncNotifier<List<Account>> {
  @override
  Future<List<Account>> build() {
    return _load();
  }

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(_load);
  }

  Future<List<Account>> _load() async {
    final result = await ref
        .read(chartOfAccountsRepositoryProvider)
        .fetchAccounts();
    return result.when(
      success: (accounts) => accounts,
      failure: (failure) => throw failure,
    );
  }
}

final chartOfAccountsProvider =
    AsyncNotifierProvider<ChartOfAccountsController, List<Account>>(
      ChartOfAccountsController.new,
    );

/// Free-text filter applied to the loaded accounts.
class AccountSearchController extends Notifier<String> {
  @override
  String build() => '';

  void setQuery(String query) => state = query;
}

final accountSearchProvider = NotifierProvider<AccountSearchController, String>(
  AccountSearchController.new,
);

/// Accounts matching [accountSearchProvider], in code order.
final filteredAccountsProvider = Provider<List<Account>>((ref) {
  final accounts =
      ref.watch(chartOfAccountsProvider).value ?? const <Account>[];
  final query = ref.watch(accountSearchProvider).trim().toLowerCase();
  if (query.isEmpty) return accounts;
  final matching = accounts
      .where(
        (a) =>
            a.code.toLowerCase().contains(query) ||
            a.name.toLowerCase().contains(query) ||
            (a.nameAr?.toLowerCase().contains(query) ?? false),
      )
      .toList(growable: false);
  // Keep parent groups visible while searching for a nested subaccount.
  final visibleIds = matching.map((account) => account.id).toSet();
  final byId = {for (final account in accounts) account.id: account};
  for (final account in matching) {
    var parentId = account.parentId;
    while (parentId != null && visibleIds.add(parentId)) {
      parentId = byId[parentId]?.parentId;
    }
  }
  return accounts
      .where((account) => visibleIds.contains(account.id))
      .toList(growable: false);
});
