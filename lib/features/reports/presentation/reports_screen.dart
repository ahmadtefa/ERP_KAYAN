import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme/design_tokens.dart';
import '../../../core/error/failure.dart';
import '../../../core/json/amount_format.dart';
import '../../../core/json/json_utils.dart';
import '../../../shared/extensions/l10n_extension.dart';
import '../../../shared/utils/account_name.dart';
import '../../../shared/widgets/data_dialog.dart';
import '../../../shared/widgets/records_table.dart';
import '../../../shared/widgets/status_pill.dart';
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

final ledgerAccountProvider =
    NotifierProvider<_LedgerAccountController, String?>(
      _LedgerAccountController.new,
    );

/// The filters the operational reports keep while the user moves between
/// tabs - a status chosen for sales stays chosen for sales.
class _FilterController extends Notifier<String> {
  _FilterController(this.initial);
  final String initial;

  @override
  String build() => initial;

  void choose(String value) => state = value;
}

final salesStatusProvider = NotifierProvider<_FilterController, String>(
  () => _FilterController('ALL'),
);
final purchaseStatusProvider = NotifierProvider<_FilterController, String>(
  () => _FilterController('ALL'),
);
final paymentsKindProvider = NotifierProvider<_FilterController, String>(
  () => _FilterController('ALL'),
);
final outstandingKindProvider = NotifierProvider<_FilterController, String>(
  () => _FilterController('ALL'),
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
  late final TabController _tabs = TabController(length: 22, vsync: this)
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
              Tab(text: _t(context, 'الميزانية العمومية', 'Balance sheet')),
              Tab(text: _t(context, 'التدفقات النقدية', 'Cash flow')),
              Tab(
                text: _t(
                  context,
                  'التغيرات في حقوق الملكية',
                  'Changes in equity',
                ),
              ),
              Tab(text: l10n.customerBalances),
              Tab(text: l10n.supplierBalances),
              Tab(text: l10n.accountLedger),
              Tab(text: _t(context, 'اليومية العامة', 'General journal')),
              Tab(text: l10n.sales),
              Tab(text: l10n.purchases),
              Tab(text: _t(context, 'المقبوضات والمدفوعات', 'Payments')),
              Tab(text: _t(context, 'النقدية', 'Cash')),
              Tab(
                text: _t(
                  context,
                  'الفواتير غير المسددة',
                  'Outstanding invoices',
                ),
              ),
              Tab(text: l10n.expenses),
              Tab(text: _t(context, 'الإيرادات', 'Income')),
              Tab(text: _t(context, 'تسوية العملاء', 'Receivables reconciliation')),
              Tab(text: _t(context, 'تسوية الموردين', 'Payables reconciliation')),
              Tab(text: l10n.fixedAssets),
              Tab(text: l10n.costCenterReport),
              Tab(text: l10n.budgetReport),
              Tab(text: _t(context, 'مركز التسويات', 'Reconciliation center')),
            ],
          ),
          // Download and print always reflect the tab that is open and the
          // period on screen, because they are built from the same values.
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Align(
              alignment: AlignmentDirectional.centerEnd,
              // The exported report catalogue does not include the two
              // cost-centre reports yet, so the button is not offered for a
              // report it would fail to produce.
              child: _tabs.index >= 19
                  ? const SizedBox.shrink()
                  : ReportExportActions(
                      report: _reportSlug,
                      from: period.from,
                      to: period.to,
                      accountId: _tabs.index == 7
                          ? ref.watch(ledgerAccountProvider)
                          : null,
                    ),
            ),
          ),
          Expanded(
            child: switch (_tabs.index) {
              0 => _TrialBalanceTab(
                onOpenAccount: (accountId) {
                  ref.read(ledgerAccountProvider.notifier).choose(accountId);
                  _tabs.animateTo(7);
                },
              ),
              1 => const _ProfitAndLossTab(),
              2 => const _BalanceSheetTab(),
              3 => const _CashFlowTab(),
              4 => const _EquityChangesTab(),
              5 => const _BalancesTab(
                path: '/reports/customer-balances',
                isCustomer: true,
              ),
              6 => const _BalancesTab(
                path: '/reports/supplier-balances',
                isCustomer: false,
              ),
              7 => const _AccountLedgerTab(),
              8 => const _GeneralJournalTab(),
              9 => const _SalesReportTab(),
              10 => const _PurchasesReportTab(),
              11 => const _PaymentsReportTab(),
              12 => const _CashReportTab(),
              13 => const _OutstandingInvoicesTab(),
              14 => const _ExpensesIncomeTab(isExpense: true),
              15 => const _ExpensesIncomeTab(isExpense: false),
              16 => const _ReconciliationTab(side: 'receivables'),
              17 => const _ReconciliationTab(side: 'payables'),
              18 => const _FixedAssetsReportTab(),
              19 => const _CostCentersTab(),
              20 => const _BudgetReportTab(),
              _ => _ReconciliationCenterTab(
                onOpenTab: (index) => _tabs.animateTo(index),
              ),
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
    2 => 'balance-sheet',
    3 => 'cash-flow',
    4 => 'equity-changes',
    5 => 'customer-balances',
    6 => 'supplier-balances',
    7 => 'account-ledger',
    8 => 'general-journal',
    9 => 'sales',
    10 => 'purchases',
    11 => 'payments',
    12 => 'cash',
    13 => 'outstanding-invoices',
    14 => 'expenses',
    15 => 'income',
    16 => 'receivables-reconciliation',
    17 => 'payables-reconciliation',
    18 => 'fixed-assets',
    19 => 'cost-centers',
    _ => 'budgets',
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
  const _TrialBalanceTab({required this.onOpenAccount});

  /// Opens the ledger tab on the tapped account: a trial-balance figure
  /// is a claim, and the ledger behind it is one tap away.
  final void Function(String accountId) onOpenAccount;

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
        // Heading subtotals interleave with their accounts by code so the
        // page reads as the chart does. A subtotal is a sum of the rows
        // under it — never an extra row in the totals, and tapping one
        // opens nothing (a heading has no ledger of its own).
        final isArabic = Localizations.localeOf(context).languageCode == 'ar';
        final rows = <Json>[
          ...listOf(data['rows']),
          for (final group in listOf(data['groups']))
            {...group, 'isGroup': true},
        ]..sort((a, b) => text(a, 'code').compareTo(text(b, 'code')));
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
                onTap: (row) {
                  if (flag(row, 'isGroup')) return;
                  onOpenAccount(text(row, 'accountId'));
                },
                columns: [
                  ColumnSpec(
                    l10n.accountCode,
                    value: (r) => flag(r, 'isGroup')
                        ? '${text(r, 'code')} ▸'
                        : text(r, 'code'),
                    emphasise: true,
                  ),
                  ColumnSpec(
                    l10n.accountName,
                    value: (r) {
                      final name = isArabic
                          ? text(r, 'nameAr', fallback: text(r, 'nameEn'))
                          : text(r, 'nameEn', fallback: text(r, 'nameAr'));
                      if (!flag(r, 'isGroup')) return name;
                      final depth = (r['depth'] as num?)?.toInt() ?? 0;
                      return '${'   ' * depth}▸ $name';
                    },
                  ),
                  ColumnSpec(
                    l10n.opening,
                    numeric: true,
                    value: (r) => formatAmount(asString(r['opening'])),
                  ),
                  ColumnSpec(
                    l10n.debit,
                    numeric: true,
                    value: (r) => formatAmount(asString(r['debit'])),
                  ),
                  ColumnSpec(
                    l10n.credit,
                    numeric: true,
                    value: (r) => formatAmount(asString(r['credit'])),
                  ),
                  ColumnSpec(
                    l10n.closing,
                    numeric: true,
                    value: (r) => formatAmount(asString(r['closing'])),
                    emphasise: true,
                  ),
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
        // A Wrap, not a Row: a verdict plus three totals cannot share
        // one phone-width line; on narrow screens the totals flow to
        // their own line, whole, instead of overflowing the card.
        child: Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Icon(
              balanced ? Icons.verified_outlined : Icons.error_outline,
              color: balanced ? scheme.primary : scheme.error,
            ),
            Text(balanced ? l10n.balanced : l10n.outOfBalance),
            const SizedBox(width: 12),
            Text(
              '${l10n.debit}: ${formatAmount(asString(totals['closingDebit']))}',
            ),
            const SizedBox(width: 12),
            Text(
              '${l10n.credit}: ${formatAmount(asString(totals['closingCredit']))}',
            ),
            const SizedBox(width: 12),
            Text(
              '${l10n.difference}: ${formatAmount(asString(totals['difference']))}',
            ),
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
                _SheetSection(
                  title: l10n.revenue,
                  rows: revenue,
                  total: asString(totals['revenue']),
                ),
                const SizedBox(height: 16),
                _SheetSection(
                  title: l10n.expenses,
                  rows: expenses,
                  total: asString(totals['expenses']),
                ),
                const Divider(height: 32),
                Row(
                  children: [
                    Text(
                      l10n.netProfit,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
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
                    Expanded(child: Text(text(row, 'nameEn'))),
                    Text(formatAmount(asString(row['amount']))),
                  ],
                ),
              ),
            if (total != null) ...[
              const Divider(),
              Row(
                children: [
                  const Spacer(),
                  Text(formatAmount(total), style: theme.textTheme.titleSmall),
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
        // A partner who left money on account has no document balance: the
        // report keeps the row (it explains a control-account difference) but
        // a table that stops at `balance` would print 0.00 and hide why. The
        // credit and the net it produces appear only when there is one.
        final showsOnAccount = rows.any(
          (row) => amount(row, 'onAccount') != '0.0000',
        );
        return RecordsTable(
          rows: rows,
          columns: [
            ColumnSpec(
              l10n.accountCode,
              value: (r) => text(r, 'code'),
              emphasise: true,
            ),
            ColumnSpec('Name', value: (r) => text(r, 'nameEn')),
            ColumnSpec(
              isCustomer ? l10n.customer : l10n.supplier,
              value: (r) => text(r, 'nameAr'),
            ),
            ColumnSpec(
              l10n.balance,
              numeric: true,
              value: (r) => formatAmount(asString(r['balance'])),
              emphasise: !showsOnAccount,
            ),
            if (showsOnAccount) ...[
              ColumnSpec(
                _t(context, 'على الحساب', 'On account'),
                numeric: true,
                value: (r) => formatAmount(amount(r, 'onAccount')),
              ),
              ColumnSpec(
                _t(context, 'الصافي', 'Net'),
                numeric: true,
                value: (r) => formatAmount(amount(r, 'netBalance')),
                emphasise: true,
              ),
            ],
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
        child: Center(child: Text(l10n.accountRequired)),
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
                  child: Text(
                    accountLabel(
                      account,
                      Localizations.localeOf(context).languageCode,
                    ),
                  ),
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
                        Text(
                          '${l10n.opening}: ${formatAmount(asString(data['opening']))}',
                        ),
                        const Spacer(),
                        Text(
                          '${l10n.closing}: ${formatAmount(asString(data['closing']))}',
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: movements.isEmpty
                        ? EmptyView(message: l10n.noMovements)
                        : RecordsTable(
                            rows: movements,
                            columns: [
                              ColumnSpec(
                                l10n.invoiceNumber,
                                value: (r) => text(r, 'entryNumber'),
                                emphasise: true,
                              ),
                              ColumnSpec(
                                l10n.invoiceDate,
                                value: (r) => text(r, 'entryDate'),
                              ),
                              ColumnSpec(
                                l10n.description,
                                value: (r) => text(r, 'description'),
                              ),
                              ColumnSpec(
                                l10n.debit,
                                numeric: true,
                                value: (r) =>
                                    formatAmount(asString(r['debit'])),
                              ),
                              ColumnSpec(
                                l10n.credit,
                                numeric: true,
                                value: (r) =>
                                    formatAmount(asString(r['credit'])),
                              ),
                              ColumnSpec(
                                l10n.runningBalance,
                                numeric: true,
                                value: (r) =>
                                    formatAmount(asString(r['runningBalance'])),
                              ),
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

/// Inline bilingual label: the report center grows faster than the
/// translation files, and a hard-coded English label is worse than this.
String _t(BuildContext context, String ar, String en) =>
    Localizations.localeOf(context).languageCode == 'ar' ? ar : en;

/// A compact totals strip: label + formatted amount pairs from `data['totals']`.
class _SummaryStrip extends StatelessWidget {
  const _SummaryStrip({required this.entries});

  final List<MapEntry<String, String>> entries;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Wrap(
        spacing: 18,
        runSpacing: 6,
        children: [
          for (final entry in entries)
            Text(
              '${entry.key}: ${entry.value}',
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
        ],
      ),
    );
  }
}

/// Rows + totals, the shape shared by the operational reports.
class _RowsTab extends ConsumerWidget {
  const _RowsTab({
    required this.path,
    required this.columns,
    this.summary = const {},
    this.filters = const [],
  });

  final String path;
  final List<ColumnSpec> columns;
  final Map<String, String> summary;
  final List<Widget> filters;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(reportProvider(path));
    return AsyncStateView<Json>(
      value: async,
      onRetry: () => ref.invalidate(reportProvider),
      data: (data) {
        final rows = listOf(data['rows']);
        final totals = data['totals'] is Map
            ? Map<String, dynamic>.from(data['totals'] as Map)
            : <String, dynamic>{};
        return Column(
          children: [
            if (filters.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: Row(children: filters),
              ),
            if (summary.isNotEmpty)
              _SummaryStrip(
                entries: [
                  for (final entry in summary.entries)
                    MapEntry(
                      entry.value,
                      (entry.key == 'count' || entry.key == 'documents')
                          ? '${totals[entry.key] ?? ''}'
                          : formatAmount(asString(totals[entry.key])),
                    ),
                ],
              ),
            Expanded(
              child: RecordsTable(rows: rows, columns: columns),
            ),
          ],
        );
      },
    );
  }
}

/// A status/kind filter dropdown bound to its provider.
class _FilterChoice extends ConsumerWidget {
  const _FilterChoice({
    required this.provider,
    required this.options,
    required this.label,
  });

  final NotifierProvider<_FilterController, String> provider;
  final Map<String, String> options;
  final String label;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final current = ref.watch(provider);
    return SizedBox(
      width: 220,
      child: DropdownButtonFormField<String>(
        initialValue: options.containsKey(current) ? current : options.keys.first,
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          isDense: true,
        ),
        items: [
          for (final entry in options.entries)
            DropdownMenuItem(value: entry.key, child: Text(entry.value)),
        ],
        onChanged: (value) {
          if (value != null) ref.read(provider.notifier).choose(value);
        },
      ),
    );
  }
}

class _BalanceSheetTab extends ConsumerWidget {
  const _BalanceSheetTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final period = ref.watch(periodProvider);
    final async = ref.watch(
      reportProvider('/reports/balance-sheet?from=${period.from}&to=${period.to}'),
    );
    return AsyncStateView<Json>(
      value: async,
      onRetry: () => ref.invalidate(reportProvider),
      data: (data) {
        final totals = data['totals'] is Map
            ? Map<String, dynamic>.from(data['totals'] as Map)
            : <String, dynamic>{};
        String section(String key) {
          final rows = listOf(data[key]);
          final lines = StringBuffer();
          for (final row in rows) {
            lines.writeln(
              '${text(row, 'code')}  ${text(row, 'nameEn')}  '
              '${formatAmount(asString(row['balance']))}',
            );
          }
          return lines.toString().trim();
        }

        return SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _SummaryStrip(
                entries: [
                  MapEntry(
                    _t(context, 'الأصول', 'Assets'),
                    formatAmount(asString(totals['assets'])),
                  ),
                  MapEntry(
                    _t(context, 'الالتزامات', 'Liabilities'),
                    formatAmount(asString(totals['liabilities'])),
                  ),
                  MapEntry(
                    _t(context, 'حقوق الملكية', 'Equity'),
                    formatAmount(asString(totals['equity'])),
                  ),
                  MapEntry(
                    _t(context, 'الفرق (يجب أن يكون صفر)', 'Difference (must be zero)'),
                    formatAmount(asString(totals['difference'])),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              for (final entry in <MapEntry<String, String>>[
                MapEntry(_t(context, 'الأصول', 'Assets'), section('assets')),
                MapEntry(
                  _t(context, 'الالتزامات', 'Liabilities'),
                  section('liabilities'),
                ),
                MapEntry(
                  _t(context, 'حقوق الملكية', 'Equity'),
                  section('equity'),
                ),
              ])
                Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          entry.key,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          entry.value.isEmpty
                              ? context.l10n.noData
                              : entry.value,
                          style: Theme.of(context).textTheme.bodyMedium
                              ?.copyWith(fontFamily: 'monospace'),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _CashFlowTab extends ConsumerWidget {
  const _CashFlowTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final period = ref.watch(periodProvider);
    final async = ref.watch(
      reportProvider('/reports/cash-flow?from=${period.from}&to=${period.to}'),
    );
    return AsyncStateView<Json>(
      value: async,
      onRetry: () => ref.invalidate(reportProvider),
      data: (data) {
        final rows = [
          ...listOf(data['inflows']),
          ...listOf(data['outflows']),
        ];
        final totals = data['totals'] is Map
            ? Map<String, dynamic>.from(data['totals'] as Map)
            : <String, dynamic>{};
        return Column(
          children: [
            _SummaryStrip(
              entries: [
                MapEntry(
                  _t(context, 'النقدية أول الفترة', 'Opening cash'),
                  formatAmount(asString(totals['opening'])),
                ),
                MapEntry(
                  _t(context, 'وارد', 'Inflow'),
                  formatAmount(asString(totals['inflow'])),
                ),
                MapEntry(
                  _t(context, 'صادر', 'Outflow'),
                  formatAmount(asString(totals['outflow'])),
                ),
                MapEntry(
                  _t(context, 'الصافي', 'Net'),
                  formatAmount(asString(totals['net'])),
                ),
                MapEntry(
                  _t(context, 'النقدية آخر الفترة', 'Closing cash'),
                  formatAmount(asString(totals['closing'])),
                ),
                for (final section in listOf(data['sections']))
                  if ((double.tryParse(asString(section['net']) ?? '') ?? 0) !=
                      0)
                    MapEntry(
                      _cashFlowClassLabel(
                        context,
                        asString(section['cashFlowClass']),
                      ),
                      formatAmount(asString(section['net'])),
                    ),
              ],
            ),
            Expanded(
              child: RecordsTable(
                rows: rows,
                columns: [
                  ColumnSpec('Code', value: (r) => text(r, 'code')),
                  ColumnSpec('Name', value: (r) => text(r, 'nameEn')),
                  ColumnSpec(
                    _t(context, 'الاسم بالعربية', 'Name (Arabic)'),
                    value: (r) => text(r, 'nameAr'),
                  ),
                  ColumnSpec(
                    _t(context, 'المبلغ', 'Amount'),
                    numeric: true,
                    value: (r) => formatAmount(asString(r['movement'])),
                    emphasise: true,
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

String _cashFlowClassLabel(BuildContext context, String? value) =>
    switch (value) {
      'operating' => _t(context, 'تشغيلية', 'Operating'),
      'investing' => _t(context, 'استثمارية', 'Investing'),
      'financing' => _t(context, 'تمويلية', 'Financing'),
      _ => _t(context, 'غير مصنّفة', 'Unclassified'),
    };

/// Subledger against control account, with the difference explained:
/// advances held, the postings no party document wrote (listed), and
/// whatever is left unexplained — zero on consistent books.
class _ReconciliationTab extends ConsumerWidget {
  const _ReconciliationTab({required this.side});

  final String side;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final period = ref.watch(periodProvider);
    final async = ref.watch(
      reportProvider('/reports/$side-reconciliation?asOf=${period.to}'),
    );
    return AsyncStateView<Json>(
      value: async,
      onRetry: () => ref.invalidate(reportProvider),
      data: (data) {
        final subledger = data['subledger'] is Map
            ? Map<String, dynamic>.from(data['subledger'] as Map)
            : <String, dynamic>{};
        final rows = listOf(data['otherPostings']);
        return Column(
          children: [
            _SummaryStrip(
              entries: [
                MapEntry(
                  _t(context, 'الأستاذ المساعد', 'Subledger'),
                  formatAmount(asString(subledger['total'])),
                ),
                MapEntry(
                  _t(context, 'حساب الرقابة', 'Control account'),
                  formatAmount(asString(data['controlBalance'])),
                ),
                MapEntry(
                  _t(context, 'مقدّمات غير مطبّقة', 'Advances held'),
                  formatAmount(asString(data['advances'])),
                ),
                MapEntry(
                  _t(context, 'الفرق', 'Difference'),
                  formatAmount(asString(data['difference'])),
                ),
                MapEntry(
                  _t(context, 'غير مفسَّر', 'Unexplained'),
                  formatAmount(asString(data['unexplained'])),
                ),
              ],
            ),
            Expanded(
              child: RecordsTable(
                rows: rows,
                columns: [
                  ColumnSpec(
                    _t(context, 'القيد', 'Entry'),
                    value: (r) => text(r, 'entryNumber'),
                    emphasise: true,
                  ),
                  ColumnSpec(
                    _t(context, 'التاريخ', 'Date'),
                    value: (r) => text(r, 'entryDate'),
                  ),
                  ColumnSpec(
                    _t(context, 'المصدر', 'Source'),
                    value: (r) => text(r, 'sourceType'),
                  ),
                  ColumnSpec(
                    _t(context, 'المستند', 'Document'),
                    value: (r) => text(r, 'sourceNumber'),
                  ),
                  ColumnSpec(
                    _t(context, 'المبلغ', 'Amount'),
                    numeric: true,
                    value: (r) => formatAmount(asString(r['amount'])),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

/// Every subledger against its control account, on one page: the
/// receivables and payables reconciliations in summary, the stock
/// valuation against the inventory account, and the asset register
/// against its ledger accounts. A difference is shown with what
/// explains it — advances held, postings with no document — and a
/// section that cannot be computed says so instead of pretending.
/// Nothing here adjusts a balance; tapping a section opens the detail
/// report where the difference can be chased.
class _ReconciliationCenterTab extends ConsumerWidget {
  const _ReconciliationCenterTab({required this.onOpenTab});

  final void Function(int index) onOpenTab;

  /// The detail tab behind each section, where one exists.
  static const _detailTab = {
    'receivables': 16,
    'payables': 17,
    'fixedAssets': 18,
  };

  String _title(BuildContext context, String key) => switch (key) {
    'receivables' => _t(context, 'تسوية العملاء', 'Receivables reconciliation'),
    'payables' => _t(context, 'تسوية الموردين', 'Payables reconciliation'),
    'inventory' => _t(context, 'تسوية المخزون', 'Inventory reconciliation'),
    _ => _t(context, 'تسوية الأصول الثابتة', 'Fixed assets reconciliation'),
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final period = ref.watch(periodProvider);
    final async = ref.watch(
      reportProvider('/reports/reconciliation-center?asOf=${period.to}'),
    );
    return AsyncStateView<Json>(
      value: async,
      onRetry: () => ref.invalidate(reportProvider),
      data: (data) {
        final sections = listOf(data['sections']);
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              '${_t(context, 'حتى تاريخ', 'As of')}: ${text(data, 'asOf')}',
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: 12),
            for (final section in sections)
              _ReconciliationSectionCard(
                section: section,
                title: _title(context, text(section, 'key')),
                onOpen: _detailTab[text(section, 'key')] == null
                    ? null
                    : () => onOpenTab(_detailTab[text(section, 'key')]!),
              ),
          ],
        );
      },
    );
  }
}

class _ReconciliationSectionCard extends StatelessWidget {
  const _ReconciliationSectionCard({
    required this.section,
    required this.title,
    required this.onOpen,
  });

  final Json section;
  final String title;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final status = text(section, 'status');
    final explained = flag(section, 'fullyExplained');
    final (tone, statusLabel, icon) = switch (status) {
      'matched' => (
        AppTone.success,
        _t(context, 'متطابق', 'Matched'),
        Icons.check_circle_outline,
      ),
      'incomplete' => (
        AppTone.neutral,
        _t(context, 'غير مكتمل', 'Incomplete'),
        Icons.help_outline,
      ),
      _ when explained => (
        AppTone.warning,
        _t(context, 'يوجد فرق مفسَّر', 'Explained difference'),
        Icons.info_outline,
      ),
      _ => (
        AppTone.danger,
        _t(context, 'يوجد فرق', 'Difference'),
        Icons.error_outline,
      ),
    };
    final details = section['details'] is Map
        ? Map<String, dynamic>.from(section['details'] as Map)
        : <String, dynamic>{};

    Widget line(String label, String? raw) => Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        children: [
          Expanded(child: Text(label)),
          Text(
            raw == null ? '—' : formatAmount(raw),
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, size: 20, color: tone.foreground),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      title,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  if (onOpen != null) ...[
                    const SizedBox(width: 4),
                    const Icon(Icons.chevron_right, size: 20),
                  ],
                ],
              ),
              const SizedBox(height: 8),
              // The status pill gets its own line: beside the title it
              // left so little room on a phone that a single long word
              // ('reconciliation') overflowed the header row outright.
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: tone.background,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    statusLabel,
                    style: TextStyle(
                      color: tone.foreground,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
              if (status == 'incomplete')
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(text(section, 'reason')),
                )
              else ...[
                line(
                  _t(context, 'الأستاذ المساعد', 'Subledger'),
                  asString(section['subledger']),
                ),
                line(
                  _t(context, 'حساب الرقابة', 'Control account'),
                  asString(section['control']),
                ),
                line(
                  _t(context, 'الفرق', 'Difference'),
                  asString(section['difference']),
                ),
                if (details['advances'] != null &&
                    asString(details['advances']) != '0.0000')
                  line(
                    _t(context, 'مقدّمات غير مطبّقة', 'Advances held'),
                    asString(details['advances']),
                  ),
                if (details['otherPostings'] != null &&
                    (details['otherPostings'] as num? ?? 0) > 0)
                  line(
                    _t(
                      context,
                      'قيود دون مستند فرعي',
                      'Postings without a document',
                    ),
                    asString(details['otherPostingsTotal']),
                  ),
                if (details['unexplained'] != null)
                  line(
                    _t(context, 'غير مفسَّر', 'Unexplained'),
                    asString(details['unexplained']),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// The asset register as a report: what the company owns, what has
/// been charged against it, and what it is still worth on the books.
class _FixedAssetsReportTab extends ConsumerWidget {
  const _FixedAssetsReportTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final async = ref.watch(
      reportProvider('/fixed-assets/reports/summary'),
    );
    return AsyncStateView<Json>(
      value: async,
      onRetry: () => ref.invalidate(reportProvider),
      data: (data) {
        final totals = data['totals'] is Map
            ? Map<String, dynamic>.from(data['totals'] as Map)
            : <String, dynamic>{};
        final rows = listOf(data['items']);
        return Column(
          children: [
            _SummaryStrip(
              entries: [
                MapEntry(
                  l10n.assetCost,
                  formatAmount(asString(totals['cost'])),
                ),
                MapEntry(
                  l10n.accumulatedDepreciation,
                  formatAmount(asString(totals['accumulatedDepreciation'])),
                ),
                MapEntry(
                  l10n.bookValue,
                  formatAmount(asString(totals['bookValue'])),
                ),
              ],
            ),
            Expanded(
              child: RecordsTable(
                rows: rows,
                columns: [
                  ColumnSpec(
                    l10n.assetCode,
                    value: (r) => text(r, 'code'),
                    emphasise: true,
                  ),
                  ColumnSpec('Name', value: (r) => text(r, 'nameEn')),
                  ColumnSpec(
                    _t(context, 'الاسم بالعربية', 'Name (Arabic)'),
                    value: (r) => text(r, 'nameAr'),
                  ),
                  ColumnSpec(
                    l10n.assetCategory,
                    value: (r) => text(r, 'category'),
                  ),
                  ColumnSpec(
                    l10n.status,
                    value: (r) => text(r, 'status'),
                  ),
                  ColumnSpec(
                    l10n.assetCost,
                    numeric: true,
                    value: (r) => formatAmount(asString(r['cost'])),
                  ),
                  ColumnSpec(
                    l10n.accumulatedDepreciation,
                    numeric: true,
                    value: (r) =>
                        formatAmount(asString(r['accumulatedDepreciation'])),
                  ),
                  ColumnSpec(
                    l10n.bookValue,
                    numeric: true,
                    emphasise: true,
                    value: (r) => formatAmount(asString(r['bookValue'])),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

class _EquityChangesTab extends ConsumerWidget {
  const _EquityChangesTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final period = ref.watch(periodProvider);
    final async = ref.watch(
      reportProvider(
        '/reports/equity-changes?from=${period.from}&to=${period.to}',
      ),
    );
    return AsyncStateView<Json>(
      value: async,
      onRetry: () => ref.invalidate(reportProvider),
      data: (data) {
        final result = data['result'] is Map
            ? Map<String, dynamic>.from(data['result'] as Map)
            : <String, dynamic>{};
        final totals = data['totals'] is Map
            ? Map<String, dynamic>.from(data['totals'] as Map)
            : <String, dynamic>{};
        // The unclosed-result row reads opening - transferred + period
        // result = closing, so its transferred amount flips sign to keep
        // every row adding up on screen the way the statement is printed.
        final transferred = asString(result['transferredToEquity']) ?? '';
        final unclosedTransferred = transferred.startsWith('-')
            ? transferred.substring(1)
            : (double.tryParse(transferred) ?? 0) == 0
            ? transferred
            : '-$transferred';
        final rows = [
          ...listOf(data['accounts']),
          {
            'code': '',
            'nameEn': 'Result not yet closed',
            'nameAr': 'نتيجة لم تُرحَّل بعد',
            'opening': result['openingUnclosed'],
            'transferredResult': unclosedTransferred,
            'otherMovements': result['forPeriod'],
            'closing': result['closingUnclosed'],
          },
        ];
        return Column(
          children: [
            _SummaryStrip(
              entries: [
                MapEntry(
                  _t(context, 'أول الفترة', 'Opening equity'),
                  formatAmount(asString(totals['opening'])),
                ),
                MapEntry(
                  _t(context, 'نتيجة الفترة', 'Result for the period'),
                  formatAmount(asString(totals['resultForPeriod'])),
                ),
                MapEntry(
                  _t(context, 'حركات أخرى', 'Other movements'),
                  formatAmount(asString(totals['otherMovements'])),
                ),
                MapEntry(
                  _t(context, 'آخر الفترة', 'Closing equity'),
                  formatAmount(asString(totals['closing'])),
                ),
              ],
            ),
            Expanded(
              child: RecordsTable(
                rows: rows,
                columns: [
                  ColumnSpec('Code', value: (r) => text(r, 'code')),
                  ColumnSpec('Name', value: (r) => text(r, 'nameEn')),
                  ColumnSpec(
                    _t(context, 'الاسم بالعربية', 'Name (Arabic)'),
                    value: (r) => text(r, 'nameAr'),
                  ),
                  ColumnSpec(
                    _t(context, 'أول الفترة', 'Opening'),
                    numeric: true,
                    value: (r) => formatAmount(asString(r['opening'])),
                  ),
                  ColumnSpec(
                    _t(context, 'النتيجة المرحَّلة', 'Transferred result'),
                    numeric: true,
                    value: (r) =>
                        formatAmount(asString(r['transferredResult'])),
                  ),
                  ColumnSpec(
                    _t(context, 'الحركات', 'Movements'),
                    numeric: true,
                    value: (r) =>
                        formatAmount(asString(r['otherMovements'])),
                  ),
                  ColumnSpec(
                    _t(context, 'آخر الفترة', 'Closing'),
                    numeric: true,
                    value: (r) => formatAmount(asString(r['closing'])),
                    emphasise: true,
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

class _GeneralJournalTab extends ConsumerWidget {
  const _GeneralJournalTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final period = ref.watch(periodProvider);
    final async = ref.watch(
      reportProvider(
        '/reports/general-journal?from=${period.from}&to=${period.to}',
      ),
    );
    return AsyncStateView<Json>(
      value: async,
      onRetry: () => ref.invalidate(reportProvider),
      data: (data) {
        final rows = listOf(data['items']);
        return Column(
          children: [
            _SummaryStrip(
              entries: [
                MapEntry(
                  _t(context, 'عدد القيود', 'Entries'),
                  '${data['total'] ?? rows.length}',
                ),
                MapEntry(
                  _t(context, 'الصفحة', 'Page'),
                  '${data['page'] ?? 1}',
                ),
              ],
            ),
            Expanded(
              child: RecordsTable(
                rows: rows,
                columns: [
                  ColumnSpec(
                    _t(context, 'القيد', 'Entry'),
                    value: (r) => text(r, 'entryNumber'),
                    emphasise: true,
                  ),
                  ColumnSpec(
                    _t(context, 'التاريخ', 'Date'),
                    value: (r) => text(r, 'entryDate'),
                  ),
                  ColumnSpec(
                    _t(context, 'البيان', 'Description'),
                    value: (r) => text(r, 'description'),
                  ),
                  ColumnSpec(
                    _t(context, 'المصدر', 'Source'),
                    value: (r) {
                      final source = r['source'];
                      final kind = source is Map
                          ? text(source as Map<String, dynamic>, 'type')
                          : '';
                      return [
                        kind,
                        text(r, 'sourceNumber'),
                      ].where((part) => part.isNotEmpty).join(' ');
                    },
                  ),
                  ColumnSpec(
                    _t(context, 'الحالة', 'Status'),
                    value: (r) => text(r, 'status'),
                  ),
                  ColumnSpec(
                    _t(context, 'الإجمالي', 'Total'),
                    numeric: true,
                    value: (r) => formatAmount(asString(r['totalDebit'])),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}

class _SalesReportTab extends ConsumerWidget {
  const _SalesReportTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final period = ref.watch(periodProvider);
    final status = ref.watch(salesStatusProvider);
    final filter = status == 'ALL' ? '' : '&status=$status';
    return _RowsTab(
      path:
          '/reports/sales?from=${period.from}&to=${period.to}$filter',
      summary: {
        'total': _t(context, 'الإجمالي', 'Total'),
        'paid': _t(context, 'المسدَّد', 'Paid'),
        'outstanding': _t(context, 'المتبقي', 'Outstanding'),
        'grossProfit': _t(context, 'مجمل الربح', 'Gross profit'),
        'documents': _t(context, 'الفواتير', 'Invoices'),
      },
      filters: [
        _FilterChoice(
          provider: salesStatusProvider,
          label: _t(context, 'الحالة', 'Status'),
          options: {
            'ALL': _t(context, 'الكل', 'All'),
            'DRAFT': _t(context, 'مسودة', 'Draft'),
            'POSTED': _t(context, 'مرحّلة', 'Posted'),
            'CANCELLED': _t(context, 'ملغاة', 'Cancelled'),
          },
        ),
      ],
      columns: [
        ColumnSpec(
          _t(context, 'الفاتورة', 'Invoice'),
          value: (r) => text(r, 'invoiceNumber'),
          emphasise: true,
        ),
        ColumnSpec(
          _t(context, 'التاريخ', 'Date'),
          value: (r) => text(r, 'invoiceDate'),
        ),
        ColumnSpec(
          _t(context, 'العميل', 'Customer'),
          value: (r) => r['customer'] is Map
              ? text(r['customer'] as Map<String, dynamic>, 'nameEn')
              : '',
        ),
        ColumnSpec(
          _t(context, 'الإجمالي', 'Total'),
          numeric: true,
          value: (r) => formatAmount(asString(r['totalAmount'])),
        ),
        ColumnSpec(
          _t(context, 'المسدَّد', 'Paid'),
          numeric: true,
          value: (r) => formatAmount(asString(r['paidAmount'])),
        ),
        ColumnSpec(
          _t(context, 'المتبقي', 'Outstanding'),
          numeric: true,
          value: (r) => formatAmount(asString(r['outstanding'])),
        ),
        ColumnSpec(
          _t(context, 'مجمل الربح', 'Gross profit'),
          numeric: true,
          value: (r) => formatAmount(asString(r['grossProfit'])),
        ),
      ],
    );
  }
}

class _PurchasesReportTab extends ConsumerWidget {
  const _PurchasesReportTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final period = ref.watch(periodProvider);
    final status = ref.watch(purchaseStatusProvider);
    final filter = status == 'ALL' ? '' : '&status=$status';
    return _RowsTab(
      path:
          '/reports/purchases?from=${period.from}&to=${period.to}$filter',
      summary: {
        'total': _t(context, 'الإجمالي', 'Total'),
        'paid': _t(context, 'المسدَّد', 'Paid'),
        'outstanding': _t(context, 'المتبقي', 'Outstanding'),
        'documents': _t(context, 'الفواتير', 'Invoices'),
      },
      filters: [
        _FilterChoice(
          provider: purchaseStatusProvider,
          label: _t(context, 'الحالة', 'Status'),
          options: {
            'ALL': _t(context, 'الكل', 'All'),
            'DRAFT': _t(context, 'مسودة', 'Draft'),
            'POSTED': _t(context, 'مرحّلة', 'Posted'),
            'CANCELLED': _t(context, 'ملغاة', 'Cancelled'),
          },
        ),
      ],
      columns: [
        ColumnSpec(
          _t(context, 'الفاتورة', 'Invoice'),
          value: (r) => text(r, 'invoiceNumber'),
          emphasise: true,
        ),
        ColumnSpec(
          _t(context, 'التاريخ', 'Date'),
          value: (r) => text(r, 'invoiceDate'),
        ),
        ColumnSpec(
          _t(context, 'المورد', 'Supplier'),
          value: (r) => r['supplier'] is Map
              ? text(r['supplier'] as Map<String, dynamic>, 'nameEn')
              : '',
        ),
        ColumnSpec(
          _t(context, 'الإجمالي', 'Total'),
          numeric: true,
          value: (r) => formatAmount(asString(r['totalAmount'])),
        ),
        ColumnSpec(
          _t(context, 'المسدَّد', 'Paid'),
          numeric: true,
          value: (r) => formatAmount(asString(r['paidAmount'])),
        ),
        ColumnSpec(
          _t(context, 'المتبقي', 'Outstanding'),
          numeric: true,
          value: (r) => formatAmount(asString(r['outstanding'])),
        ),
      ],
    );
  }
}

class _PaymentsReportTab extends ConsumerWidget {
  const _PaymentsReportTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final period = ref.watch(periodProvider);
    final kind = ref.watch(paymentsKindProvider);
    final filter = kind == 'ALL' ? '' : '&kind=$kind';
    return _RowsTab(
      path: '/reports/payments?from=${period.from}&to=${period.to}$filter',
      summary: {
        'receipts': _t(context, 'المقبوضات', 'Receipts'),
        'payments': _t(context, 'المدفوعات', 'Payments'),
        'net': _t(context, 'الصافي', 'Net'),
        'count': _t(context, 'السندات', 'Vouchers'),
      },
      filters: [
        _FilterChoice(
          provider: paymentsKindProvider,
          label: _t(context, 'النوع', 'Kind'),
          options: {
            'ALL': _t(context, 'الكل', 'All'),
            'RECEIPT': _t(context, 'قبض', 'Receipt'),
            'PAYMENT': _t(context, 'دفع', 'Payment'),
          },
        ),
      ],
      columns: [
        ColumnSpec(
          _t(context, 'السند', 'Voucher'),
          value: (r) => text(r, 'voucherNumber'),
          emphasise: true,
        ),
        ColumnSpec(
          _t(context, 'التاريخ', 'Date'),
          value: (r) => text(r, 'voucherDate'),
        ),
        ColumnSpec(
          _t(context, 'النوع', 'Kind'),
          value: (r) => text(r, 'kind'),
        ),
        ColumnSpec(
          _t(context, 'الطرف', 'Party'),
          value: (r) {
            for (final key in ['customer', 'supplier', 'counterAccount']) {
              if (r[key] is Map) {
                final name = text(r[key] as Map<String, dynamic>, 'nameEn');
                if (name.isNotEmpty) return name;
              }
            }
            return '';
          },
        ),
        ColumnSpec(
          _t(context, 'المبلغ', 'Amount'),
          numeric: true,
          value: (r) => formatAmount(asString(r['amount'])),
          emphasise: true,
        ),
      ],
    );
  }
}

class _CashReportTab extends ConsumerWidget {
  const _CashReportTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final period = ref.watch(periodProvider);
    return _RowsTab(
      path: '/reports/cash?from=${period.from}&to=${period.to}',
      summary: {
        'opening': _t(context, 'رصيد افتتاحي', 'Opening'),
        'inflow': _t(context, 'وارد', 'Inflow'),
        'outflow': _t(context, 'صادر', 'Outflow'),
        'closing': _t(context, 'رصيد ختامي', 'Closing'),
      },
      columns: [
        ColumnSpec('Code', value: (r) => text(r, 'code'), emphasise: true),
        ColumnSpec('Name', value: (r) => text(r, 'nameEn')),
        ColumnSpec(
          _t(context, 'النوع', 'Kind'),
          value: (r) => text(r, 'kind'),
        ),
        ColumnSpec(
          _t(context, 'رصيد افتتاحي', 'Opening'),
          numeric: true,
          value: (r) => formatAmount(asString(r['opening'])),
        ),
        ColumnSpec(
          _t(context, 'وارد', 'In'),
          numeric: true,
          value: (r) => formatAmount(asString(r['inflow'])),
        ),
        ColumnSpec(
          _t(context, 'صادر', 'Out'),
          numeric: true,
          value: (r) => formatAmount(asString(r['outflow'])),
        ),
        ColumnSpec(
          _t(context, 'رصيد ختامي', 'Closing'),
          numeric: true,
          value: (r) => formatAmount(asString(r['closing'])),
          emphasise: true,
        ),
      ],
    );
  }
}

class _OutstandingInvoicesTab extends ConsumerWidget {
  const _OutstandingInvoicesTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final period = ref.watch(periodProvider);
    final kind = ref.watch(outstandingKindProvider);
    final filter = kind == 'ALL' ? '' : '&kind=$kind';
    return _RowsTab(
      path:
          '/reports/outstanding-invoices?from=${period.from}&to=${period.to}'
          '$filter',
      summary: {
        'outstanding': _t(context, 'المتبقي', 'Outstanding'),
        'overdue': _t(context, 'متأخر', 'Overdue'),
        'count': _t(context, 'الفواتير', 'Invoices'),
      },
      filters: [
        _FilterChoice(
          provider: outstandingKindProvider,
          label: _t(context, 'النوع', 'Kind'),
          options: {
            'ALL': _t(context, 'الكل', 'All'),
            'sales': _t(context, 'مبيعات', 'Sales'),
            'purchases': _t(context, 'مشتريات', 'Purchases'),
          },
        ),
      ],
      columns: [
        ColumnSpec(
          _t(context, 'الفاتورة', 'Invoice'),
          value: (r) => text(r, 'invoiceNumber'),
          emphasise: true,
        ),
        ColumnSpec(
          _t(context, 'التاريخ', 'Date'),
          value: (r) => text(r, 'invoiceDate'),
        ),
        ColumnSpec(
          _t(context, 'الاستحقاق', 'Due'),
          value: (r) => text(r, 'dueDate'),
        ),
        ColumnSpec(
          _t(context, 'الطرف', 'Party'),
          value: (r) => r['party'] is Map
              ? text(r['party'] as Map<String, dynamic>, 'nameEn')
              : '',
        ),
        ColumnSpec(
          _t(context, 'المتبقي', 'Outstanding'),
          numeric: true,
          value: (r) => formatAmount(asString(r['outstanding'])),
          emphasise: true,
        ),
        ColumnSpec(
          _t(context, 'أيام التأخير', 'Days overdue'),
          numeric: true,
          value: (r) => asString(r['daysOverdue']),
        ),
        ColumnSpec(
          _t(context, 'الحالة', 'State'),
          value: (r) => text(r, 'state'),
        ),
      ],
    );
  }
}

class _ExpensesIncomeTab extends ConsumerWidget {
  const _ExpensesIncomeTab({required this.isExpense});

  final bool isExpense;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final period = ref.watch(periodProvider);
    final path = isExpense ? '/reports/expenses' : '/reports/income';
    return _RowsTab(
      path: '$path?from=${period.from}&to=${period.to}',
      summary: {
        'total': isExpense
            ? _t(context, 'إجمالي المصروفات', 'Total expenses')
            : _t(context, 'إجمالي الإيرادات', 'Total income'),
        'count': _t(context, 'الحسابات', 'Accounts'),
      },
      columns: [
        ColumnSpec('Code', value: (r) => text(r, 'code'), emphasise: true),
        ColumnSpec('Name', value: (r) => text(r, 'nameEn')),
        ColumnSpec(
          _t(context, 'الاسم بالعربية', 'Name (Arabic)'),
          value: (r) => text(r, 'nameAr'),
        ),
        ColumnSpec(
          _t(context, 'عدد القيود', 'Entries'),
          numeric: true,
          value: (r) => asString(r['entries']),
        ),
        ColumnSpec(
          _t(context, 'الصافي', 'Net'),
          numeric: true,
          value: (r) => formatAmount(asString(r['net'])),
          emphasise: true,
        ),
      ],
    );
  }
}


/// Cost-center revenue, expenses and result, with the unattributed bucket and
/// the ledger reconciliation the API returns. The figures come from posted
/// entries only; the screen adds nothing to them.
class _CostCentersTab extends ConsumerWidget {
  const _CostCentersTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final period = ref.watch(periodProvider);
    final language = Localizations.localeOf(context).languageCode;
    final path =
        '/reports/cost-centers?from=${period.from}&to=${period.to}&includeInactive=true';
    final async = ref.watch(reportProvider(path));

    return AsyncStateView<Json>(
      value: async,
      onRetry: () => ref.invalidate(reportProvider),
      data: (data) {
        final rows = listOf(data['items']);
        final unallocated = data['unallocated'] is Map
            ? Map<String, dynamic>.from(data['unallocated'] as Map)
            : <String, dynamic>{};
        final totals = data['totals'] is Map
            ? Map<String, dynamic>.from(data['totals'] as Map)
            : <String, dynamic>{};
        return Column(
          children: [
            _SummaryStrip(
              entries: [
                MapEntry(l10n.revenue, formatAmount(asString(totals['revenue']))),
                MapEntry(l10n.expenses, formatAmount(asString(totals['expenses']))),
                MapEntry(l10n.netProfit, formatAmount(asString(totals['result']))),
                MapEntry(
                  l10n.unallocated,
                  '${formatAmount(asString(unallocated['revenue']))} / '
                      '${formatAmount(asString(unallocated['expenses']))}',
                ),
              ],
            ),
            Expanded(
              child: RecordsTable(
                rows: rows,
                columns: [
                  ColumnSpec(
                    l10n.costCenter,
                    emphasise: true,
                    value: (row) =>
                        '${text(row, 'code')} — '
                        '${language == 'ar' ? text(row, 'nameAr') : text(row, 'nameEn')}',
                  ),
                  ColumnSpec(
                    l10n.costCenterType,
                    value: (row) => _costCenterTypeLabel(context, text(row, 'type')),
                  ),
                  ColumnSpec(
                    l10n.ownAmount,
                    numeric: true,
                    value: (row) =>
                        '${formatAmount(asString(row['ownRevenue']))} / '
                        '${formatAmount(asString(row['ownExpenses']))}',
                  ),
                  ColumnSpec(
                    l10n.rolledUp,
                    numeric: true,
                    value: (row) =>
                        '${formatAmount(asString(row['revenue']))} / '
                        '${formatAmount(asString(row['expenses']))}',
                  ),
                  ColumnSpec(
                    l10n.netProfit,
                    numeric: true,
                    value: (row) => formatAmount(asString(row['result'])),
                    emphasise: true,
                  ),
                  ColumnSpec(
                    l10n.status,
                    value: (row) => flag(row, 'isActive', fallback: true)
                        ? l10n.active
                        : l10n.inactive,
                    tone: (row) => flag(row, 'isActive', fallback: true)
                        ? AppTone.success
                        : AppTone.neutral,
                  ),
                ],
                actions: (row) => [
                  IconButton(
                    tooltip: l10n.drillDown,
                    icon: const Icon(Icons.list_alt_outlined, size: 20),
                    onPressed: () => _showLines(
                      context,
                      ref,
                      id: text(row, 'costCenterId'),
                      title: '${text(row, 'code')} — ${text(row, 'nameEn')}',
                    ),
                  ),
                ],
              ),
            ),
            if (unallocated.isNotEmpty)
              Padding(
                padding: const EdgeInsets.all(12),
                child: Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: TextButton.icon(
                    onPressed: () => _showLines(
                      context,
                      ref,
                      id: 'unallocated',
                      title: l10n.unallocated,
                    ),
                    icon: const Icon(Icons.list_alt_outlined),
                    label: Text(
                      '${l10n.unallocated}: '
                      '${formatAmount(asString(unallocated['revenue']))} / '
                      '${formatAmount(asString(unallocated['expenses']))}',
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }

  Future<void> _showLines(
    BuildContext context,
    WidgetRef ref, {
    required String id,
    required String title,
  }) async {
    final period = ref.read(periodProvider);
    Json data;
    try {
      data = await ref.read(apiClientProvider).getObject(
        '/reports/cost-centers/$id/transactions',
        query: {'from': period.from, 'to': period.to, 'pageSize': '200'},
      );
    } on Failure catch (error) {
      if (context.mounted) showMessage(context, error.message, error: true);
      return;
    }
    if (!context.mounted) return;
    final l10n = context.l10n;
    final rows = listOf(data['items']);
    await showDataDialog<void>(
      context,
      storageKey: 'cost-center-transactions',
      title: title,
      icon: Icons.account_tree_outlined,
      initialSize: const Size(900, 560),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: rows.isEmpty
            ? Center(child: Text(l10n.noTransactions))
            : RecordsTable(
                rows: rows,
                columns: [
                  ColumnSpec(
                    l10n.entryNumber,
                    emphasise: true,
                    value: (row) => text(row, 'entryNumber'),
                  ),
                  ColumnSpec(l10n.invoiceDate, value: (row) => text(row, 'entryDate')),
                  ColumnSpec(
                    l10n.account,
                    value: (row) => '${text(row, 'accountCode')} — '
                        '${text(row, 'accountName')}',
                  ),
                  ColumnSpec(
                    l10n.description,
                    value: (row) => text(row, 'description'),
                  ),
                  ColumnSpec(
                    l10n.amount,
                    numeric: true,
                    value: (row) => formatAmount(asString(row['amount'])),
                  ),
                  ColumnSpec(
                    l10n.status,
                    value: (row) => text(row, 'status'),
                    tone: (row) => toneForStatus(text(row, 'status')),
                  ),
                ],
              ),
      ),
    );
  }
}

String _costCenterTypeLabel(BuildContext context, String type) {
  final l10n = context.l10n;
  return switch (type) {
    'DEPARTMENT' => l10n.department,
    'ADMINISTRATIVE_UNIT' => l10n.administrativeUnit,
    'PROJECT' => l10n.project,
    _ => type,
  };
}

/// Budget against actual, row by row. Every figure is the API's answer from
/// posted ledger lines; the screen only arranges it.
class _BudgetReportTab extends ConsumerWidget {
  const _BudgetReportTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final period = ref.watch(periodProvider);
    final language = Localizations.localeOf(context).languageCode;
    final path =
        '/reports/budgets?from=${period.from}&to=${period.to}&includeInactive=true';
    final async = ref.watch(reportProvider(path));

    return AsyncStateView<Json>(
      value: async,
      onRetry: () => ref.invalidate(reportProvider),
      data: (data) {
        final rows = listOf(data['rows']);
        final totals = data['totals'] is Map
            ? Map<String, dynamic>.from(data['totals'] as Map)
            : <String, dynamic>{};
        final expense = totals['expense'] is Map
            ? Map<String, dynamic>.from(totals['expense'] as Map)
            : <String, dynamic>{};
        final revenue = totals['revenue'] is Map
            ? Map<String, dynamic>.from(totals['revenue'] as Map)
            : <String, dynamic>{};
        return Column(
          children: [
            _SummaryStrip(
              entries: [
                MapEntry(
                  '${l10n.expenses} — ${l10n.budget}',
                  formatAmount(asString(expense['budget'])),
                ),
                MapEntry(
                  '${l10n.expenses} — ${l10n.actualAmount}',
                  formatAmount(asString(expense['actual'])),
                ),
                MapEntry(
                  '${l10n.revenue} — ${l10n.budget}',
                  formatAmount(asString(revenue['budget'])),
                ),
                MapEntry(
                  '${l10n.revenue} — ${l10n.actualAmount}',
                  formatAmount(asString(revenue['actual'])),
                ),
              ],
            ),
            Expanded(
              child: rows.isEmpty
                  ? Center(child: Text(l10n.noBudgets))
                  : RecordsTable(
                      rows: rows,
                      columns: [
                        ColumnSpec(
                          l10n.costCenter,
                          emphasise: true,
                          value: (row) =>
                              '${text(row, 'costCenterCode')} — '
                              '${language == 'ar' ? text(row, 'costCenterNameAr') : text(row, 'costCenterNameEn')}',
                        ),
                        ColumnSpec(
                          l10n.account,
                          value: (row) =>
                              '${text(row, 'accountCode')} — '
                              '${language == 'ar' ? text(row, 'accountNameAr') : text(row, 'accountNameEn')}',
                        ),
                        ColumnSpec(
                          l10n.budgetPeriod,
                          value: (row) =>
                              '${text(row, 'periodStart')} → ${text(row, 'periodEnd')}',
                        ),
                        ColumnSpec(
                          l10n.budgetAmount,
                          numeric: true,
                          value: (row) => formatAmount(asString(row['budget'])),
                        ),
                        ColumnSpec(
                          l10n.actualAmount,
                          numeric: true,
                          value: (row) => formatAmount(asString(row['actual'])),
                        ),
                        ColumnSpec(
                          l10n.variance,
                          numeric: true,
                          value: (row) => formatAmount(asString(row['variance'])),
                          emphasise: true,
                        ),
                        ColumnSpec(
                          l10n.variancePercent,
                          numeric: true,
                          value: (row) => row['variancePercent'] == null
                              ? '—'
                              : '${text(row, 'variancePercent')}%',
                        ),
                        ColumnSpec(
                          l10n.status,
                          value: (row) => row['retired'] == true
                              ? l10n.budgetRetired
                              : (flag(row, 'isActive', fallback: true)
                                    ? l10n.active
                                    : l10n.inactive),
                          tone: (row) => row['retired'] == true
                              ? AppTone.neutral
                              : (flag(row, 'isActive', fallback: true)
                                    ? AppTone.success
                                    : AppTone.neutral),
                        ),
                        ColumnSpec(
                          l10n.resultLabel,
                          value: (row) => row['favorable'] == true
                              ? l10n.favorable
                              : l10n.unfavorable,
                        ),
                      ],
                    ),
            ),
          ],
        );
      },
    );
  }
}
