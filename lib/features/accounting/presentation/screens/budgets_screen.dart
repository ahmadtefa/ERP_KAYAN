import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/utils/account_name.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/form_sheet.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../domain/entities/account.dart';
import '../../domain/entities/account_type.dart';
import '../providers/chart_of_accounts_providers.dart';
import '../providers/cost_center_providers.dart';

/// Budgets, as definitions. The comparison with the ledger lives in the
/// budget report, which reads posted entries only.
final budgetsProvider = FutureProvider<List<Json>>((ref) async {
  final page = await ref.read(apiClientProvider).getObject(
    '/accounting/budgets',
    query: const {'includeInactive': 'true', 'pageSize': '500'},
  );
  return listOf(page['items']);
});

class BudgetsScreen extends ConsumerStatefulWidget {
  const BudgetsScreen({super.key});

  @override
  ConsumerState<BudgetsScreen> createState() => _BudgetsScreenState();
}

class _BudgetsScreenState extends ConsumerState<BudgetsScreen> {
  bool _busy = false;

  String _language() => Localizations.localeOf(context).languageCode;

  Future<void> _refresh() async {
    ref.invalidate(budgetsProvider);
    await ref.read(budgetsProvider.future);
  }

  Future<void> _save({Json? existing}) async {
    final l10n = context.l10n;
    final language = _language();
    final centers = ref.read(costCentersProvider).value ?? const <Json>[];
    final accounts = ref.read(chartOfAccountsProvider).value ?? const <Account>[];
    final budgetable = accounts
        .where(
          (account) =>
              account.isPostable &&
              account.isActive &&
              (account.type == AccountType.revenue ||
                  account.type == AccountType.expense),
        )
        .toList(growable: false);

    if (centers.isEmpty || budgetable.isEmpty) {
      showMessage(context, l10n.noData, error: true);
      return;
    }

    final isEdit = existing != null;
    final active = centers
        .where((center) => flag(center, 'isActive', fallback: true))
        .toList(growable: false);
    // A budget that already names a deactivated centre keeps it; the list of
    // choices only offers active centres for a new assignment.
    final choices = isEdit ? centers : active;

    final values = await showFormSheet(
      context,
      title: isEdit ? l10n.editBudget : l10n.newBudget,
      fields: [
        FieldSpec(
          'costCenterId',
          l10n.costCenter,
          kind: FieldKind.select,
          required: true,
          options: [
            for (final center in choices)
              FieldOption(
                text(center, 'id'),
                '${text(center, 'code')} — '
                    '${language == 'ar' ? text(center, 'nameAr') : text(center, 'nameEn')}',
              ),
          ],
        ),
        FieldSpec(
          'accountId',
          l10n.account,
          kind: FieldKind.select,
          required: true,
          options: [
            for (final account in budgetable)
              FieldOption(account.id, accountLabel(account, language)),
          ],
        ),
        FieldSpec('periodStart', l10n.from, kind: FieldKind.date, required: true),
        FieldSpec('periodEnd', l10n.to, kind: FieldKind.date, required: true),
        FieldSpec('amount', l10n.budgetAmount, kind: FieldKind.decimal, required: true),
        FieldSpec('notes', l10n.description, kind: FieldKind.multiline, maxLines: 2),
      ],
      initial: existing,
    );
    if (values == null || !mounted) return;

    setState(() => _busy = true);
    try {
      final client = ref.read(apiClientProvider);
      if (isEdit) {
        await client.patch('/accounting/budgets/${existing['id']}', body: values);
      } else {
        await client.post('/accounting/budgets', body: values);
      }
      await _refresh();
      if (mounted) showMessage(context, l10n.budgetSaved);
    } on Failure catch (error) {
      // Duplicate period, inactive centre, balance-sheet account: the server
      // explains it, and that explanation is what the person needs to see.
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _retire(Json row) async {
    final l10n = context.l10n;
    final ok = await confirmAction(
      context,
      title: l10n.retireBudget,
      message: l10n.confirmRetireBudget,
      confirmLabel: l10n.retireBudget,
      destructive: true,
    );
    if (!ok || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).delete('/accounting/budgets/${row['id']}');
      await _refresh();
      if (mounted) showMessage(context, l10n.budgetSaved);
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final language = _language();
    final async = ref.watch(budgetsProvider);
    final canManage =
        ref.watch(currentUserProvider)?.can('accounting.budgets.manage') ?? false;

    return ModuleScaffold(
      title: l10n.budgets,
      trailing: canManage
          ? FilledButton.icon(
              onPressed: _busy ? null : () => _save(),
              icon: const Icon(Icons.add),
              label: Text(l10n.newBudget),
            )
          : null,
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.invalidate(budgetsProvider),
        isEmpty: (rows) => rows.isEmpty,
        emptyMessage: l10n.noBudgets,
        data: (rows) => RecordsTable(
          rows: rows,
          columns: [
            ColumnSpec(
              l10n.costCenter,
              emphasise: true,
              value: (row) {
                final center = row['costCenter'];
                if (center is! Map) return '';
                final map = Map<String, dynamic>.from(center);
                final name =
                    language == 'ar' ? text(map, 'nameAr') : text(map, 'nameEn');
                return '${text(map, 'code')} — $name';
              },
            ),
            ColumnSpec(
              l10n.account,
              value: (row) {
                final account = row['account'];
                if (account is! Map) return '';
                final map = Map<String, dynamic>.from(account);
                final name =
                    language == 'ar' ? text(map, 'nameAr') : text(map, 'nameEn');
                return '${text(map, 'code')} — $name';
              },
            ),
            ColumnSpec(
              l10n.budgetPeriod,
              value: (row) => '${text(row, 'periodStart')} → ${text(row, 'periodEnd')}',
            ),
            ColumnSpec(
              l10n.budgetAmount,
              numeric: true,
              value: (row) => formatAmount(text(row, 'amount', fallback: '0')),
            ),
            ColumnSpec(
              l10n.status,
              value: (row) => row['retired'] == true
                  ? l10n.budgetRetired
                  : (flag(row, 'isActive', fallback: true)
                        ? l10n.active
                        : l10n.inactive),
            ),
          ],
          actions: (row) => [
            if (canManage && row['retired'] != true)
              IconButton(
                tooltip: l10n.edit,
                icon: const Icon(Icons.edit_outlined, size: 20),
                onPressed: _busy ? null : () => _save(existing: row),
              ),
            if (canManage && row['retired'] != true)
              IconButton(
                tooltip: l10n.retireBudget,
                icon: const Icon(Icons.block_outlined, size: 20),
                onPressed: _busy ? null : () => _retire(row),
              ),
          ],
        ),
      ),
    );
  }
}
