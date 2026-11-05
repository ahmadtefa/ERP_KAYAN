import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/router/draft_exit_guard.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/utils/account_name.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
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
  final page = await ref
      .read(apiClientProvider)
      .getObject(
        '/accounting/budgets',
        query: const {'includeInactive': 'true', 'pageSize': '500'},
      );
  return listOf(page['items']);
});

class BudgetsScreen extends ConsumerStatefulWidget {
  const BudgetsScreen({super.key, this.navigationKey});
  final ValueKey<String>? navigationKey;

  @override
  ConsumerState<BudgetsScreen> createState() => _BudgetsScreenState();
}

class _BudgetsScreenState extends ConsumerState<BudgetsScreen> {
  bool _busy = false;
  final _exitRelay = DraftExitRelay();
  late final DraftExitGuard _exitGuard;

  @override
  void initState() {
    super.initState();
    _exitGuard = ref.read(draftExitGuardProvider);
    final key = widget.navigationKey;
    if (key != null) _exitGuard.register(key, _exitRelay.canLeave);
  }

  @override
  void dispose() {
    final key = widget.navigationKey;
    if (key != null) _exitGuard.unregister(key, _exitRelay.canLeave);
    super.dispose();
  }

  String _language() => Localizations.localeOf(context).languageCode;

  Future<void> _refresh() async {
    ref.invalidate(budgetsProvider);
    await ref.read(budgetsProvider.future);
  }

  Future<void> _save({Json? existing}) async {
    final l10n = context.l10n;
    final language = _language();
    if (_busy) return;
    setState(() => _busy = true);
    late final List<Json> centers;
    late final List<Account> accounts;
    try {
      centers = await ref.read(costCentersProvider.future);
      if (!mounted) return;
      accounts = await ref.read(chartOfAccountsProvider.future);
    } catch (error) {
      if (mounted) await showAppError(context, error);
      return;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    if (!mounted) return;
    final isEdit = existing != null;
    final currentCenter = isEdit ? text(existing, 'costCenterId') : '';
    final currentAccount = isEdit ? text(existing, 'accountId') : '';
    final activeCenters = centers
        .where((center) => flag(center, 'isActive', fallback: true))
        .toList(growable: false);
    final budgetable = accounts
        .where(
          (account) =>
              account.isPostable &&
              account.isActive &&
              (account.type == AccountType.revenue ||
                  account.type == AccountType.expense),
        )
        .toList(growable: false);
    if ((!isEdit && (activeCenters.isEmpty || budgetable.isEmpty)) ||
        (isEdit && (currentCenter.isEmpty || currentAccount.isEmpty))) {
      showMessage(context, l10n.noData, error: true);
      return;
    }
    // Keep a now-inactive existing selection visible, but never offer a
    // different inactive item as a new assignment.
    final previousCenter = centers
        .where((row) => text(row, 'id') == currentCenter)
        .firstOrNull;
    final previousAccount = accounts
        .where((account) => account.id == currentAccount)
        .firstOrNull;
    final missingCenter =
        isEdit && !activeCenters.any((row) => text(row, 'id') == currentCenter);
    final missingAccount =
        isEdit && !budgetable.any((account) => account.id == currentAccount);
    final unavailable = language == 'ar' ? 'غير متاح' : 'Unavailable';

    final values = await showFormSheet(
      context,
      exitRelay: _exitRelay,
      title: isEdit ? l10n.editBudget : l10n.newBudget,
      fields: [
        FieldSpec(
          'costCenterId',
          l10n.costCenter,
          kind: FieldKind.select,
          required: true,
          options: [
            if (missingCenter)
              FieldOption(
                currentCenter,
                '${previousCenter == null ? currentCenter : costCenterLabel(previousCenter, language)} — $unavailable',
                enabled: false,
              ),
            for (final center in activeCenters)
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
            if (missingAccount)
              FieldOption(
                currentAccount,
                '${previousAccount == null ? currentAccount : accountLabel(previousAccount, language)} — $unavailable',
                enabled: false,
              ),
            for (final account in budgetable)
              FieldOption(account.id, accountLabel(account, language)),
          ],
        ),
        FieldSpec(
          'periodStart',
          l10n.from,
          kind: FieldKind.date,
          required: true,
        ),
        FieldSpec('periodEnd', l10n.to, kind: FieldKind.date, required: true),
        FieldSpec(
          'amount',
          l10n.budgetAmount,
          kind: FieldKind.decimal,
          required: true,
        ),
        FieldSpec(
          'notes',
          l10n.description,
          kind: FieldKind.multiline,
          maxLines: 2,
          emptyValue: '',
        ),
      ],
      initial: existing,
      onSubmit: (draft) async {
        // A historical budget can keep its original unavailable association.
        // Omitting unchanged IDs also avoids validating it as a new assignment.
        final body = <String, dynamic>{...draft};
        if (isEdit && body['accountId'] == currentAccount)
          body.remove('accountId');
        if (isEdit && body['costCenterId'] == currentCenter)
          body.remove('costCenterId');
        try {
          final client = ref.read(apiClientProvider);
          if (isEdit) {
            await client.patch(
              '/accounting/budgets/${existing['id']}',
              body: body,
            );
          } else {
            await client.post('/accounting/budgets', body: body);
          }
        } catch (error) {
          if (mounted) ref.invalidate(budgetsProvider);
          throw UncertainFormSubmission(error);
        }
      },
    );
    if (values == null || !mounted) return;
    ref.invalidate(budgetsProvider);
    showMessage(context, l10n.budgetSaved);
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
      await ref
          .read(apiClientProvider)
          .delete('/accounting/budgets/${row['id']}');
      await _refresh();
      if (mounted) showMessage(context, l10n.budgetSaved);
    } catch (error) {
      if (mounted) {
        ref.invalidate(budgetsProvider);
        await showAppError(context, error);
      }
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
        ref.watch(currentUserProvider)?.can('accounting.budgets.manage') ??
        false;

    return ModuleScaffold(
      title: l10n.budgets,
      trailing: Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          IconButton(
            tooltip: l10n.refresh,
            onPressed: _busy || async.isLoading
                ? null
                : () => ref.invalidate(budgetsProvider),
            icon: const Icon(Icons.refresh),
          ),
          if (canManage)
            FilledButton.icon(
              onPressed: _busy ? null : () => _save(),
              icon: const Icon(Icons.add),
              label: Text(l10n.newBudget),
            ),
        ],
      ),
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
                final name = language == 'ar'
                    ? text(map, 'nameAr')
                    : text(map, 'nameEn');
                return '${text(map, 'code')} — $name';
              },
            ),
            ColumnSpec(
              l10n.account,
              value: (row) {
                final account = row['account'];
                if (account is! Map) return '';
                final map = Map<String, dynamic>.from(account);
                final name = language == 'ar'
                    ? text(map, 'nameAr')
                    : text(map, 'nameEn');
                return '${text(map, 'code')} — $name';
              },
            ),
            ColumnSpec(
              l10n.budgetPeriod,
              value: (row) =>
                  '${text(row, 'periodStart')} → ${text(row, 'periodEnd')}',
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
              tone: (row) => row['retired'] == true
                  ? AppTone.neutral
                  : (flag(row, 'isActive', fallback: true)
                        ? AppTone.success
                        : AppTone.neutral),
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
