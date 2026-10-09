import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/form_sheet.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../data/presentation/widgets/list_export_actions.dart';

/// The fiscal years of this company.
///
/// A period is the fence around the ledger: while it is open anything may be
/// posted into it, and once it is closed nothing may be — not an invoice, not
/// a manual entry.
class FiscalPeriodsController extends JsonListController {
  @override
  String get resourcePath => '/accounting/fiscal-periods';
}

final fiscalPeriodsListProvider =
    AsyncNotifierProvider<JsonListController, List<Json>>(
      FiscalPeriodsController.new,
    );

class FiscalPeriodsScreen extends ConsumerStatefulWidget {
  const FiscalPeriodsScreen({super.key});

  @override
  ConsumerState<FiscalPeriodsScreen> createState() =>
      _FiscalPeriodsScreenState();
}

class _FiscalPeriodsScreenState extends ConsumerState<FiscalPeriodsScreen> {
  bool _busy = false;

  Future<void> _save({Json? existing}) async {
    final l10n = context.l10n;
    final isEdit = existing != null;
    final values = await showFormSheet(
      context,
      title: isEdit ? l10n.editPeriod : l10n.newPeriod,
      fields: [
        if (!isEdit) FieldSpec('code', l10n.periodCode, required: true),
        FieldSpec('nameEn', l10n.fullNameEn, required: true),
        FieldSpec('nameAr', l10n.fullNameAr, required: true),
        FieldSpec('startDate', l10n.startDate, kind: FieldKind.date, required: true),
        FieldSpec('endDate', l10n.endDate, kind: FieldKind.date, required: true),
      ],
      initial: existing,
    );
    if (values == null || !mounted) return;

    setState(() => _busy = true);
    try {
      final client = ref.read(apiClientProvider);
      if (isEdit) {
        await client.patch(
          '/accounting/fiscal-periods/${existing['id']}',
          body: values,
        );
      } else {
        await client.post('/accounting/fiscal-periods', body: values);
      }
      await ref.read(fiscalPeriodsListProvider.notifier).reload();
      if (mounted) showMessage(context, l10n.createdSuccessfully);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _close(Json period) async {
    final l10n = context.l10n;
    final ok = await confirmAction(
      context,
      title: l10n.closePeriod,
      message: l10n.confirmClosePeriod,
      confirmLabel: l10n.closePeriod,
      destructive: true,
    );
    if (!ok || !mounted) return;

    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .post('/accounting/fiscal-periods/${period['id']}/close');
      await ref.read(fiscalPeriodsListProvider.notifier).reload();
      if (mounted) showMessage(context, l10n.periodClosed);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(fiscalPeriodsListProvider);
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    return ModuleScaffold(
      title: l10n.fiscalPeriods,
      actions: const [ListExportActions(list: 'fiscal-periods')],
      trailing: Row(
        children: [
          IconButton(
            tooltip: l10n.refresh,
            onPressed: _busy
                ? null
                : () => ref.read(fiscalPeriodsListProvider.notifier).reload(),
            icon: const Icon(Icons.refresh),
          ),
          const SizedBox(width: 4),
          FilledButton.icon(
            onPressed: _busy ? null : () => _save(),
            icon: const Icon(Icons.add),
            label: Text(l10n.newPeriod),
          ),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(fiscalPeriodsListProvider.notifier).reload(),
        isEmpty: (rows) => rows.isEmpty,
        emptyMessage: l10n.noPeriods,
        data: (rows) => RecordsTable(
          rows: rows,
          columns: [
            ColumnSpec(
              l10n.periodCode,
              value: (r) => text(r, 'code'),
              emphasise: true,
            ),
            ColumnSpec(
              isArabic ? l10n.fullNameAr : l10n.fullNameEn,
              value: (r) => isArabic
                  ? text(r, 'nameAr', fallback: text(r, 'nameEn'))
                  : text(r, 'nameEn', fallback: text(r, 'nameAr')),
            ),
            ColumnSpec(l10n.startDate, value: (r) => text(r, 'startDate')),
            ColumnSpec(l10n.endDate, value: (r) => text(r, 'endDate')),
            ColumnSpec(
              l10n.status,
              value: (r) =>
                  flag(r, 'isClosed') ? l10n.closed : l10n.open,
            ),
            ColumnSpec(
              l10n.closedOn,
              value: (r) => text(r, 'closedAt').isEmpty
                  ? '—'
                  : text(r, 'closedAt').split('T').first,
            ),
          ],
          actions: (row) => [
            IconButton(
              tooltip: l10n.edit,
              icon: const Icon(Icons.edit_outlined, size: 20),
              onPressed: _busy || flag(row, 'isClosed')
                  ? null
                  : () => _save(existing: row),
            ),
            IconButton(
              tooltip: l10n.closePeriod,
              icon: const Icon(Icons.lock_outline, size: 20),
              onPressed: _busy || flag(row, 'isClosed')
                  ? null
                  : () => _close(row),
            ),
          ],
        ),
      ),
    );
  }
}
