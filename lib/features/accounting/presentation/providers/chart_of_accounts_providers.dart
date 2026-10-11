import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../auth/presentation/providers/auth_providers.dart';
import '../../data/datasources/chart_of_accounts_data_source.dart';
import '../../data/repositories/chart_of_accounts_repository_impl.dart';
import '../../domain/entities/account.dart';
import '../../domain/entities/account_type.dart';
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
}));

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

  /// Creates, then reloads so the tree shows the server's answer.
  Future<String?> create(AccountInput input) async {
    final result = await ref
        .read(chartOfAccountsRepositoryProvider)
        .createAccount(input);
    return result.when(
      success: (_) {
        ref.invalidateSelf();
        return null;
      },
      failure: (failure) => failure.message,
    );
  }

  Future<String?> update(String id, AccountInput input) async {
    final result = await ref
        .read(chartOfAccountsRepositoryProvider)
        .updateAccount(id, input);
    return result.when(
      success: (_) {
        ref.invalidateSelf();
        return null;
      },
      failure: (failure) => failure.message,
    );
  }

  Future<String?> remove(String id) async {
    final result = await ref
        .read(chartOfAccountsRepositoryProvider)
        .deleteAccount(id);
    return result.when(
      success: (_) {
        ref.invalidateSelf();
        return null;
      },
      failure: (failure) => failure.message,
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

/// The type filter above the tree: null shows every type.
class AccountTypeFilterController extends Notifier<AccountType?> {
  @override
  AccountType? build() => null;

  void setType(AccountType? type) => state = type;
}

final accountTypeFilterProvider =
    NotifierProvider<AccountTypeFilterController, AccountType?>(
      AccountTypeFilterController.new,
    );

/// Whether the tree also shows deactivated accounts.
class AccountInactiveFilterController extends Notifier<bool> {
  @override
  bool build() => true;

  void setIncludeInactive(bool value) => state = value;
}

final accountInactiveFilterProvider =
    NotifierProvider<AccountInactiveFilterController, bool>(
      AccountInactiveFilterController.new,
    );

/// Accounts matching the search and the filters, in code order.
final filteredAccountsProvider = Provider<List<Account>>((ref) {
  final accounts =
      ref.watch(chartOfAccountsProvider).value ?? const <Account>[];
  final query = ref.watch(accountSearchProvider).trim().toLowerCase();
  final type = ref.watch(accountTypeFilterProvider);
  final includeInactive = ref.watch(accountInactiveFilterProvider);

  return accounts.where((a) {
    if (type != null && a.type != type) return false;
    if (!includeInactive && !a.isActive) return false;
    if (query.isEmpty) return true;
    // The search reads both names and the code, whichever language the
    // person at the keyboard is typing in.
    return a.code.toLowerCase().contains(query) ||
        (a.nameEn ?? '').toLowerCase().contains(query) ||
        (a.nameAr ?? '').contains(query) ||
        a.name.toLowerCase().contains(query);
  }).toList(growable: false);
});

/// One row of the tree: an account plus the depth it sits at.
class AccountNode {
  const AccountNode({required this.account, required this.depth});

  final Account account;
  final int depth;
}

/// Lays the accounts out parents-first, exactly as the tree shows them.
///
/// A child whose parent was filtered out still appears — promoted to the top
/// level — so a search never hides a row the person asked for.
final accountTreeProvider = Provider<List<AccountNode>>((ref) {
  final accounts = ref.watch(filteredAccountsProvider);
  final byId = {for (final a in accounts) a.id: a};
  final childrenOf = <String?, List<Account>>{};

  for (final account in accounts) {
    final parentKey =
        account.parentId != null && byId.containsKey(account.parentId)
        ? account.parentId
        : null;
    childrenOf.putIfAbsent(parentKey, () => []).add(account);
  }

  final ordered = <AccountNode>[];
  void walk(String? parentId, int depth) {
    for (final account in childrenOf[parentId] ?? const <Account>[]) {
      ordered.add(AccountNode(account: account, depth: depth));
      walk(account.id, depth + 1);
    }
  }

  walk(null, 0);
  return ordered;
});
