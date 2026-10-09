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

/// Company chart with expense-account hierarchy management through the API.
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
              if (!showSampleNotice &&
                  ref
                          .watch(currentUserProvider)
                          ?.can('accounting.accounts.create') ==
                      true)
                IconButton.filledTonal(
                  tooltip: context.l10n.newExpenseAccount,
                  onPressed: () => _editExpenseAccount(
                    context,
                    ref,
                    ref.read(chartOfAccountsProvider).value ?? const [],
                    null,
                  ),
                  icon: const Icon(Icons.add),
                ),
              if (!showSampleNotice &&
                  ref
                          .watch(currentUserProvider)
                          ?.can('accounting.accounts.create') ==
                      true)
                const SizedBox(width: 8),
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
          children: _accountTree(context, ref, items, null, 0),
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

List<Widget> _accountTree(
  BuildContext context,
  WidgetRef ref,
  List<Account> accounts,
  String? parentId,
  int depth,
) {
  final children =
      accounts.where((account) => account.parentId == parentId).toList()
        ..sort((a, b) => a.code.compareTo(b.code));
  return [
    for (final account in children)
      if (!account.isPostable &&
          accounts.any((item) => item.parentId == account.id))
        ExpansionTile(
          key: ValueKey('account-${account.id}'),
          initiallyExpanded: depth == 0,
          tilePadding: EdgeInsetsDirectional.only(
            start: 24 + depth * 16,
            end: 16,
          ),
          leading: const Icon(Icons.account_tree_outlined, size: 20),
          title: Text(
            '${account.code}  ${_accountName(context, account)}',
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
          subtitle: Text(context.l10n.grouping),
          trailing: _AccountActions(account: account, accounts: accounts),
          children: _accountTree(context, ref, accounts, account.id, depth + 1),
        )
      else
        _AccountTile(account: account, depth: depth, accounts: accounts),
  ];
}

class _AccountTile extends StatelessWidget {
  const _AccountTile({
    required this.account,
    required this.depth,
    required this.accounts,
  });

  final Account account;
  final int depth;
  final List<Account> accounts;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return ListTile(
      dense: true,
      // Leading indent encodes hierarchy without a heavy tree widget.
      contentPadding: EdgeInsetsDirectional.only(
        start: 24 + depth * 16,
        end: 16,
      ),
      title: Text(
        '${account.code}  ${_accountName(context, account)}',
        style: TextStyle(
          fontWeight: account.isPostable ? FontWeight.w400 : FontWeight.w600,
        ),
      ),
      subtitle: Text(
        account.isPostable ? l10n.postable : l10n.grouping,
        style: Theme.of(context).textTheme.bodySmall,
      ),
      trailing: _AccountActions(account: account, accounts: accounts),
    );
  }
}

class _AccountActions extends ConsumerWidget {
  const _AccountActions({required this.account, required this.accounts});
  final Account account;
  final List<Account> accounts;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    final canEdit =
        !ref.watch(appConfigProvider).useSeedData &&
        user?.can('accounting.accounts.update') == true;
    if (account.type != AccountType.expense) return const SizedBox.shrink();
    if (!canEdit && account.isActive) return const SizedBox.shrink();
    return Wrap(
      children: [
        if (canEdit)
          IconButton(
            tooltip: context.l10n.editExpenseAccount,
            visualDensity: VisualDensity.compact,
            onPressed: () =>
                _editExpenseAccount(context, ref, accounts, account),
            icon: const Icon(Icons.edit_outlined, size: 18),
          ),
        if (canEdit)
          IconButton(
            tooltip: account.isActive
                ? context.l10n.deactivateAccount
                : context.l10n.activateAccount,
            visualDensity: VisualDensity.compact,
            onPressed: () async {
              final client = ref.read(apiClientProvider);
              await client.post(
                '/accounting/chart-of-accounts/${account.id}/${account.isActive ? 'deactivate' : 'activate'}',
              );
              await ref.read(chartOfAccountsProvider.notifier).refresh();
            },
            icon: Icon(
              account.isActive
                  ? Icons.pause_circle_outline
                  : Icons.play_circle_outline,
              size: 18,
            ),
          ),
        if (!account.isActive)
          Icon(
            Icons.block,
            size: 18,
            color: Theme.of(context).colorScheme.error,
          ),
      ],
    );
  }
}

Future<void> _editExpenseAccount(
  BuildContext context,
  WidgetRef ref,
  List<Account> accounts,
  Account? account,
) async {
  final code = TextEditingController(text: account?.code ?? '');
  final nameEn = TextEditingController(text: account?.name ?? '');
  final nameAr = TextEditingController(text: account?.nameAr ?? '');
  final description = TextEditingController(text: account?.description ?? '');
  String? parentId = account?.parentId;
  bool isPostable = account?.isPostable ?? true;
  final result = await showDialog<Map<String, dynamic>>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: Text(
          account == null
              ? context.l10n.newExpenseAccount
              : context.l10n.editExpenseAccount,
        ),
        content: SizedBox(
          width: 460,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final pair in [
                  (code, context.l10n.accountCode),
                  (nameEn, context.l10n.fullNameEn),
                  (nameAr, context.l10n.fullNameAr),
                  (description, context.l10n.description),
                ])
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: TextField(
                      controller: pair.$1,
                      decoration: InputDecoration(
                        labelText: pair.$2,
                        border: const OutlineInputBorder(),
                      ),
                    ),
                  ),
                DropdownButtonFormField<String?>(
                  initialValue: parentId,
                  decoration: InputDecoration(
                    labelText: context.l10n.parentAccount,
                    border: const OutlineInputBorder(),
                  ),
                  items: [
                    DropdownMenuItem<String?>(
                      value: null,
                      child: Text(context.l10n.noParentAccount),
                    ),
                    for (final parent in accounts.where(
                      (a) =>
                          a.type == AccountType.expense &&
                          !a.isPostable &&
                          a.id != account?.id,
                    ))
                      DropdownMenuItem(
                        value: parent.id,
                        child: Text(
                          '${parent.code} ${Localizations.localeOf(context).languageCode == 'ar' ? parent.nameAr ?? parent.name : parent.name}',
                        ),
                      ),
                  ],
                  onChanged: (value) => setState(() => parentId = value),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(context.l10n.accountCanPost),
                  value: isPostable,
                  onChanged: (value) => setState(() => isPostable = value),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: Text(context.l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, {
              'code': code.text.trim(),
              'nameEn': nameEn.text.trim(),
              'nameAr': nameAr.text.trim(),
              'description': description.text.trim(),
              'parentId': parentId,
              'isPostable': isPostable,
            }),
            child: Text(context.l10n.save),
          ),
        ],
      ),
    ),
  );
  code.dispose();
  nameEn.dispose();
  nameAr.dispose();
  description.dispose();
  if (result == null || !context.mounted) return;
  try {
    final client = ref.read(apiClientProvider);
    if (account == null) {
      await client.post('/accounting/chart-of-accounts', body: result);
    } else {
      await client.patch(
        '/accounting/chart-of-accounts/${account.id}',
        body: result,
      );
    }
    await ref.read(chartOfAccountsProvider.notifier).refresh();
  } catch (error) {
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('$error')));
    }
  }
}

String _accountName(BuildContext context, Account account) =>
    Localizations.localeOf(context).languageCode == 'ar'
    ? account.nameAr ?? account.name
    : account.name;

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
