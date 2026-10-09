import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../shared/extensions/account_type_labels.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../domain/entities/account.dart';
import '../../domain/entities/account_type.dart';
import '../providers/chart_of_accounts_providers.dart';
import '../../../data/presentation/widgets/list_export_actions.dart';

/// Read-only view of the chart of accounts, grouped by account type.
///
/// Accounts are created and edited on the server; this screen intentionally
/// offers no local mutation so the ledger can never diverge from the API.
class ChartOfAccountsScreen extends ConsumerWidget {
  const ChartOfAccountsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final accounts = ref.watch(chartOfAccountsProvider);
    final showSampleNotice = ref.watch(appConfigProvider).useSeedData;

    return Column(
      children: [
        if (showSampleNotice) const _SampleDataBanner(),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  decoration: InputDecoration(
                    hintText: context.l10n.searchAccounts,
                    prefixIcon: const Icon(Icons.search),
                  ),
                  onChanged: (value) =>
                      ref.read(accountSearchProvider.notifier).setQuery(value),
                ),
              ),
              const SizedBox(width: 12),
              const ListExportActions(list: 'chart-of-accounts'),
            ],
          ),
        ),
        Expanded(
          child: AsyncStateView<List<Account>>(
            value: accounts,
            onRetry: () => ref.read(chartOfAccountsProvider.notifier).refresh(),
            emptyMessage: context.l10n.noAccounts,
            isEmpty: (list) => list.isEmpty,
            data: (list) => _AccountList(accounts: list),
          ),
        ),
      ],
    );
  }
}

class _AccountList extends ConsumerWidget {
  const _AccountList({required this.accounts});

  final List<Account> accounts;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final all = ref.watch(filteredAccountsProvider);
    if (all.isEmpty) {
      return EmptyView(
        message: context.l10n.noAccounts,
        icon: Icons.search_off,
      );
    }

    // Group by account type; the enum order is the canonical report order.
    final grouped = <AccountType, List<Account>>{};
    for (final account in all) {
      grouped.putIfAbsent(account.type, () => []).add(account);
    }

    final types = AccountType.values
        .where((type) => grouped.containsKey(type))
        .toList(growable: false);

    return ListView.builder(
      padding: const EdgeInsets.only(bottom: 24),
      itemCount: types.length,
      itemBuilder: (context, index) {
        final type = types[index];
        final items = grouped[type]!;
        return ExpansionTile(
          initiallyExpanded: true,
          leading: Icon(_iconFor(type)),
          title: Text(context.l10n.accountTypeLabel(type)),
          subtitle: Text('${items.length}'),
          children: [
            for (final account in items) _AccountTile(account: account),
          ],
        );
      },
    );
  }

  IconData _iconFor(AccountType type) => switch (type) {
    AccountType.asset => Icons.account_balance_wallet_outlined,
    AccountType.liability => Icons.trending_down,
    AccountType.equity => Icons.pie_chart_outline,
    AccountType.revenue => Icons.trending_up,
    AccountType.expense => Icons.receipt_long_outlined,
  };
}

class _AccountTile extends StatelessWidget {
  const _AccountTile({required this.account});

  final Account account;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return ListTile(
      dense: true,
      // Leading indent encodes hierarchy without a heavy tree widget.
      contentPadding: EdgeInsetsDirectional.only(
        start: 24 + (account.parentId == null ? 0 : 16),
        end: 16,
      ),
      title: Text(
        '${account.code}  ${account.name}',
        style: TextStyle(
          fontWeight: account.isPostable ? FontWeight.w400 : FontWeight.w600,
        ),
      ),
      subtitle: Text(
        account.isPostable ? l10n.postable : l10n.grouping,
        style: Theme.of(context).textTheme.bodySmall,
      ),
      trailing: account.isActive
          ? null
          : Icon(
              Icons.block,
              size: 18,
              color: Theme.of(context).colorScheme.error,
            ),
    );
  }
}

class _SampleDataBanner extends StatelessWidget {
  const _SampleDataBanner();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final l10n = context.l10n;
    return Material(
      color: scheme.tertiaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Icon(Icons.info_outline, color: scheme.onTertiaryContainer),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.sampleDataNotice,
                    style: TextStyle(
                      color: scheme.onTertiaryContainer,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    l10n.sampleDataDetail,
                    style: TextStyle(
                      color: scheme.onTertiaryContainer,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
