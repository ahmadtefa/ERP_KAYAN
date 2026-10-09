import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/json/amount_format.dart';
import '../../../core/json/json_utils.dart';
import '../../../shared/extensions/l10n_extension.dart';
import '../../../shared/widgets/records_table.dart';
import '../../../shared/widgets/state_views.dart';
import '../../accounting/presentation/providers/chart_of_accounts_providers.dart';
import '../../auth/presentation/providers/auth_providers.dart';
import '../../common/presentation/screens/module_scaffold.dart';
import '../../data/presentation/widgets/export_actions.dart';

/// The reporting period every tab shares.
class Period {
  const Period(this.from, this.to);

  final String from;
  final String to;

  static Period thisYear() {
    final now = DateTime.now();
    String padded(int value) => value.toString().padLeft(2, '0');
    return Period(
      '${now.year}-01-01',
      '${now.year}-${padded(now.month)}-${padded(now.day)}',
    );
  }
}

class _PeriodController extends Notifier<Period> {
  @override
  Period build() => Period.thisYear();

  void set(Period period) => state = period;
}

final periodProvider = NotifierProvider<_PeriodController, Period>(
  _PeriodController.new,
);

/// The account the ledger tab is showing.
///
/// Held above the tab so the download and print buttons can see it: a ledger
/// without an account is not a report, and exporting the wrong account's
/// ledger would be worse than not exporting at all.
class _LedgerAccountController extends Notifier<String?> {
  @override
  String? build() => null;

  void choose(String? accountId) => state = accountId;
}

final ledgerAccountProvider = NotifierProvider<_LedgerAccountController, String?>(
  _LedgerAccountController.new,
);

/// Reads an endpoint that answers with a `{ rows: [...], totals: {...} }`
/// object.
final reportProvider = FutureProvider.family<Json, String>((ref, path) async {
  return ref.read(apiClientProvider).getObject(path);
});

/// Trial balance, profit and loss, party balances and the account ledger.
class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({super.key});

  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends ConsumerState<ReportsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 5, vsync: this)
    ..addListener(() => setState(() {}));

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final period = ref.watch(periodProvider);

    return ModuleScaffold(
      title: l10n.reports,
      trailing: Wrap(
        spacing: 12,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text('${l10n.from}: ${period.from}'),
          Text('${l10n.to}: ${period.to}'),
          OutlinedButton.icon(
            onPressed: _pickPeriod,
            icon: const Icon(Icons.date_range_outlined),
            label: Text(l10n.period),
          ),
          IconButton(
            tooltip: l10n.retry,
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(reportProvider),
          ),
        ],
      ),
      body: Column(
        children: [
          TabBar(
            controller: _tabs,
            isScrollable: true,
            tabs: [
              Tab(text: l10n.trialBalance),
              Tab(text: l10n.profitAndLoss),
              Tab(text: l10n.customerBalances),
              Tab(text: l10n.supplierBalances),
              Tab(text: l10n.accountLedger),
            ],
          ),
          // Download and print always reflect the tab that is open and the
          // period on screen, because they are built from the same values.
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Align(
              alignment: AlignmentDirectional.centerEnd,
              child: ReportExportActions(
                report: _reportSlug,
                from: period.from,
                to: period.to,
                accountId: _tabs.index == 4 ? ref.watch(ledgerAccountProvider) : null,
              ),
            ),
          ),
          Expanded(
            child: switch (_tabs.index) {
              0 => const _TrialBalanceTab(),
              1 => const _ProfitAndLossTab(),
              2 => const _BalancesTab(path: '/reports/customer-balances', isCustomer: true),
              3 => const _BalancesTab(path: '/reports/supplier-balances', isCustomer: false),
              _ => const _AccountLedgerTab(),
            },
          ),
        ],
      ),
    );
  }

  /// The report the open tab shows, in the name the API uses.
  String get _reportSlug => switch (_tabs.index) {
        0 => 'trial-balance',
        1 => 'profit-and-loss',
        2 => 'customer-balances',
        3 => 'supplier-balances',
        _ => 'account-ledger',
      };

  Future<void> _pickPeriod() async {
    final period = ref.read(periodProvider);
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(2000),
      lastDate: DateTime(DateTime.now().year + 5),
      initialDateRange: DateTimeRange(
        start: DateTime.tryParse(period.from) ?? DateTime.now(),
        end: DateTime.tryParse(period.to) ?? DateTime.now(),
      ),
    );
    if (picked == null) return;
    String format(DateTime value) =>
        '${value.year.toString().padLeft(4, '0')}-'
        '${value.month.toString().padLeft(2, '0')}-'
        '${value.day.toString().padLeft(2, '0')}';
    ref
        .read(periodProvider.notifier)
        .set(Period(format(picked.start), format(picked.end)));
  }
}

class _TrialBalanceTab extends ConsumerWidget {
  const _TrialBalanceTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final period = ref.watch(periodProvider);
    final async = ref.watch(
      reportProvider(
        '/reports/trial-balance?from=${period.from}&to=${period.to}',
      ),
    );

    return AsyncStateView<Json>(
      value: async,
      onRetry: () => ref.invalidate(reportProvider),
      data: (data) {
        final rows = listOf(data['rows']);
        final totals = data['totals'] is Map
            ? Map<String, dynamic>.from(data['totals'] as Map)
            : <String, dynamic>{};
        final balanced = amount(totals, 'difference') == '0.0000';
        return Column(
          children: [
            _TotalsBar(totals: totals, balanced: balanced),
            Expanded(
              child: RecordsTable(
                rows: rows,
                columns: [
                  ColumnSpec(l10n.accountCode, value: (r) => text(r, 'code'), emphasise: true),
                  ColumnSpec(l10n.accountName, value: (r) => ('    ' * ((r['depth'] as num?)?.toInt() ?? 0)) + text(r, 'nameEn')),
                  ColumnSpec(l10n.opening, numeric: true, value: (r) => formatAmount(asString(r['opening']))),
                  ColumnSpec(l10n.debit, numeric: true, value: (r) => formatAmount(asString(r['debit']))),
                  ColumnSpec(l10n.credit, numeric: true, value: (r) => formatAmount(asString(r['credit']))),
                  ColumnSpec(l10n.closing, numeric: true, value: (r) => formatAmount(asString(r['closing'])), emphasise: true),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

class _TotalsBar extends StatelessWidget {
  const _TotalsBar({required this.totals, required this.balanced});

  final Json totals;
  final bool balanced;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final scheme = Theme.of(context).colorScheme;
    return Card(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      color: balanced ? scheme.surfaceContainerHighest : scheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Icon(
              balanced ? Icons.verified_outlined : Icons.error_outline,
              color: balanced ? scheme.primary : scheme.error,
            ),
            const SizedBox(width: 8),
            Text(balanced ? l10n.balanced : l10n.outOfBalance),
            const Spacer(),
            Text('${l10n.debit}: ${formatAmount(asString(totals['closingDebit']))}'),
            const SizedBox(width: 20),
            Text('${l10n.credit}: ${formatAmount(asString(totals['closingCredit']))}'),
            const SizedBox(width: 20),
            Text('${l10n.difference}: ${formatAmount(asString(totals['difference']))}'),
          ],
        ),
      ),
    );
  }
}

class _ProfitAndLossTab extends ConsumerWidget {
  const _ProfitAndLossTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final period = ref.watch(periodProvider);
    final async = ref.watch(
      reportProvider(
        '/reports/profit-and-loss?from=${period.from}&to=${period.to}',
      ),
    );

    return AsyncStateView<Json>(
      value: async,
      onRetry: () => ref.invalidate(reportProvider),
      data: (data) {
        final totals = data['totals'] is Map
            ? Map<String, dynamic>.from(data['totals'] as Map)
            : <String, dynamic>{};
        final revenue = listOf(data['revenue']);
        final expenses = listOf(data['expenses']);

        return SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _SheetSection(title: l10n.revenue, rows: revenue, total: asString(totals['revenue'])),
                const SizedBox(height: 16),
                _SheetSection(title: l10n.expenses, rows: expenses, total: asString(totals['expenses'])),
                const Divider(height: 32),
                Row(
                  children: [
                    Text(l10n.netProfit, style: Theme.of(context).textTheme.titleMedium),
                    const Spacer(),
                    Text(
                      formatAmount(asString(totals['netProfit'])),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _SheetSection extends StatelessWidget {
  const _SheetSection({required this.title, required this.rows, this.total});

  final String title;
  final List<Json> rows;
  final String? total;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            if (rows.isEmpty)
              Text(context.l10n.noData, style: theme.textTheme.bodySmall),
            for (final row in rows)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    SizedBox(width: 70, child: Text(text(row, 'code'))),
                    Expanded(child: Text(('    ' * ((row['depth'] as num?)?.toInt() ?? 0)) + text(row, 'nameEn'), style: TextStyle(fontWeight: (row['isPostable'] == false) ? FontWeight.w600 : null))),
                    Text(formatAmount(asString(row['amount']))),
                  ],
                ),
              ),
            if (total != null) ...[
              const Divider(),
              Row(
                children: [
                  const Spacer(),
                  Text(
                    formatAmount(total),
                    style: theme.textTheme.titleSmall,
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _BalancesTab extends ConsumerWidget {
  const _BalancesTab({required this.path, required this.isCustomer});

  final String path;
  final bool isCustomer;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final period = ref.watch(periodProvider);
    final async = ref.watch(
      reportProvider('$path?from=${period.from}&to=${period.to}'),
    );

    return AsyncStateView<Json>(
      value: async,
      onRetry: () => ref.invalidate(reportProvider),
      data: (data) {
        final rows = listOf(data['rows']);
        if (rows.isEmpty) return EmptyView(message: l10n.noBalances);
        return RecordsTable(
          rows: rows,
          columns: [
            ColumnSpec(l10n.accountCode, value: (r) => text(r, 'code'), emphasise: true),
            ColumnSpec('Name', value: (r) => text(r, 'nameEn')),
            ColumnSpec(
              isCustomer ? l10n.customer : l10n.supplier,
              value: (r) => text(r, 'nameAr'),
            ),
            ColumnSpec(l10n.balance, numeric: true, value: (r) => formatAmount(asString(r['balance'])), emphasise: true),
          ],
        );
      },
    );
  }
}

class _AccountLedgerTab extends ConsumerStatefulWidget {
  const _AccountLedgerTab();

  @override
  ConsumerState<_AccountLedgerTab> createState() => _AccountLedgerTabState();
}

class _AccountLedgerTabState extends ConsumerState<_AccountLedgerTab> {
  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final accountId = ref.watch(ledgerAccountProvider);
    final accounts = ref.watch(chartOfAccountsProvider);
    final period = ref.watch(periodProvider);
    // Only postable accounts appear in the ledger; a heading has nothing in it.
    final postable = (accounts.value ?? const [])
        .where((account) => account.isPostable)
        .toList(growable: false);

    if (accountId == null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: Text(l10n.accountRequired),
        ),
      );
    }

    final async = ref.watch(
      reportProvider(
        '/reports/account-ledger/$accountId?from=${period.from}&to=${period.to}',
      ),
    );

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: DropdownButtonFormField<String>(
            initialValue: accountId,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: l10n.account,
              border: const OutlineInputBorder(),
            ),
            items: [
              for (final account in postable)
                DropdownMenuItem(
                  value: account.id,
                  child: Text('${account.code} — ${account.name}'),
                ),
            ],
            onChanged: (value) =>
                ref.read(ledgerAccountProvider.notifier).choose(value),
          ),
        ),
        Expanded(
          child: AsyncStateView<Json>(
            value: async,
            onRetry: () => ref.invalidate(reportProvider),
            data: (data) {
              final movements = listOf(data['movements']);
              return Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Row(
                      children: [
                        Text('${l10n.opening}: ${formatAmount(asString(data['opening']))}'),
                        const Spacer(),
                        Text('${l10n.closing}: ${formatAmount(asString(data['closing']))}'),
                      ],
                    ),
                  ),
                  Expanded(
                    child: movements.isEmpty
                        ? EmptyView(message: l10n.noMovements)
                        : RecordsTable(
                            rows: movements,
                            columns: [
                              ColumnSpec(l10n.invoiceNumber, value: (r) => text(r, 'entryNumber'), emphasise: true),
                              ColumnSpec(l10n.invoiceDate, value: (r) => text(r, 'entryDate')),
                              ColumnSpec(l10n.description, value: (r) => text(r, 'description')),
                              ColumnSpec(l10n.debit, numeric: true, value: (r) => formatAmount(asString(r['debit']))),
                              ColumnSpec(l10n.credit, numeric: true, value: (r) => formatAmount(asString(r['credit']))),
                              ColumnSpec(l10n.runningBalance, numeric: true, value: (r) => formatAmount(asString(r['runningBalance']))),
                            ],
                          ),
                  ),
                ],
              );
            },
          ),
        ),
      ],
    );
  }
}
