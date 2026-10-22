import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/widgets/status_pill.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../data/presentation/providers/data_providers.dart';
import '../providers/quotation_providers.dart';
import '../quotation_status.dart';
import 'quotation_detail_dialog.dart';

/// The quotation register.
///
/// A quotation is not an invoice: nothing here moves stock, writes to the
/// ledger or changes a balance. The screen says so, because a salesperson who
/// believes an accepted offer has already been invoiced would stop chasing it.
class QuotationListScreen extends ConsumerStatefulWidget {
  const QuotationListScreen({super.key});

  @override
  ConsumerState<QuotationListScreen> createState() =>
      _QuotationListScreenState();
}

class _QuotationListScreenState extends ConsumerState<QuotationListScreen> {
  final _search = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _pickRange() async {
    final filters = ref.read(quotationFiltersProvider);
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year - 10),
      lastDate: DateTime(now.year + 5),
      initialDateRange: filters.from != null && filters.to != null
          ? DateTimeRange(
              start: DateTime.parse(filters.from!),
              end: DateTime.parse(filters.to!),
            )
          : null,
    );
    if (picked == null || !mounted) return;
    String iso(DateTime value) =>
        '${value.year.toString().padLeft(4, '0')}-'
        '${value.month.toString().padLeft(2, '0')}-'
        '${value.day.toString().padLeft(2, '0')}';
    ref
        .read(quotationFiltersProvider.notifier)
        .set(filters.copyWith(from: iso(picked.start), to: iso(picked.end)));
  }

  Future<void> _delete(Json row) async {
    final l10n = context.l10n;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.quotation),
        content: Text(l10n.deleteQuotationConfirm),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.deleteRecord),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .delete('/sales/quotations/${text(row, 'id')}');
      ref.invalidate(quotationsProvider);
      if (mounted) showMessage(context, l10n.quotationDeleted);
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final language = Localizations.localeOf(context).languageCode;
    final async = ref.watch(quotationsProvider);
    final filters = ref.watch(quotationFiltersProvider);
    final user = ref.watch(currentUserProvider);
    // Includes inactive customers: an old quotation may name one, and a
    // dropdown value that is not among its items asserts.
    final customers = ref.watch(customersProvider).value ?? const <Json>[];
    final canManage = user?.can('sales.quotations.manage') ?? false;
    final canExport = user?.can('sales.quotations.export') ?? false;
    final links = ref.read(reportLinkProvider);

    return ModuleScaffold(
      title: l10n.quotations,
      actions: [
        if (canManage)
          FilledButton.icon(
            onPressed: _busy ? null : () => context.go(AppRoutes.quotationNew),
            icon: const Icon(Icons.add),
            label: Text(l10n.newQuotation),
          ),
      ],
      trailing: Wrap(
        spacing: 8,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          SizedBox(
            width: 240,
            child: SearchField(
              controller: _search,
              hint: l10n.searchHint,
              onChanged: (value) => ref
                  .read(quotationFiltersProvider.notifier)
                  .update((current) => current.copyWith(search: value)),
            ),
          ),
          DropdownButton<String>(
            value: filters.status,
            items: [
              DropdownMenuItem(value: '', child: Text(l10n.allStatuses)),
              for (final status in quotationStatuses)
                DropdownMenuItem(
                  value: status,
                  child: Text(quotationStatusLabel(context, status)),
                ),
            ],
            onChanged: (value) => ref
                .read(quotationFiltersProvider.notifier)
                .update((current) => current.copyWith(status: value ?? '')),
          ),
          DropdownButton<String?>(
            value: filters.customerId,
            hint: Text(l10n.customer),
            items: [
              for (final customer in customers)
                DropdownMenuItem(
                  value: text(customer, 'id'),
                  child: Text(
                    '${text(customer, 'code')} — ${text(customer, 'nameEn')}',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            onChanged: (value) {
              ref
                  .read(quotationFiltersProvider.notifier)
                  .update(
                    (current) => value == null
                        ? current.copyWith(clearCustomer: true)
                        : current.copyWith(customerId: value),
                  );
            },
          ),
          OutlinedButton.icon(
            onPressed: _pickRange,
            icon: const Icon(Icons.date_range_outlined, size: 18),
            label: Text(
              filters.from == null || filters.to == null
                  ? l10n.quotationDate
                  : '${filters.from} → ${filters.to}',
            ),
          ),
          if (filters.isActive)
            TextButton.icon(
              onPressed: () {
                _search.clear();
                ref
                    .read(quotationFiltersProvider.notifier)
                    .set(const QuotationFilters());
              },
              icon: const Icon(Icons.filter_alt_off_outlined, size: 18),
              label: Text(l10n.clear),
            ),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.invalidate(quotationsProvider),
        isEmpty: (rows) => rows.isEmpty,
        emptyMessage: l10n.noQuotations,
        data: (rows) => Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                l10n.quotationDraftHint,
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 8),
              Expanded(
                child: RecordsTable(
                  rows: rows,
                  onTap: (row) => showQuotationDetail(context, id: text(row, 'id')),
                  columns: [
                    ColumnSpec(
                      l10n.quotationNumber,
                      value: (row) => text(row, 'quotationNumber'),
                      emphasise: true,
                    ),
                    ColumnSpec(
                      l10n.quotationDate,
                      value: (row) => text(row, 'quotationDate'),
                    ),
                    ColumnSpec(
                      l10n.validUntil,
                      value: (row) => text(row, 'validUntil'),
                    ),
                    ColumnSpec(
                      l10n.customer,
                      flex: 2,
                      value: (row) => partyName(row['customer'], language),
                    ),
                    ColumnSpec(
                      l10n.subject,
                      flex: 2,
                      value: (row) => text(row, 'subject'),
                    ),
                    ColumnSpec(
                      l10n.status,
                      value: (row) => quotationStatusLabel(
                        context,
                        text(row, 'status'),
                      ),
                      tone: (row) => toneForStatus(text(row, 'status')),
                    ),
                    ColumnSpec(
                      l10n.version,
                      numeric: true,
                      value: (row) => asNum(row['version'])?.toString() ?? '',
                    ),
                    ColumnSpec(
                      l10n.totalAmount,
                      numeric: true,
                      emphasise: true,
                      value: (row) => formatAmount(
                        text(row, 'totalAmount'),
                        locale: language,
                      ),
                    ),
                  ],
                  actions: (row) => [
                    IconButton(
                      tooltip: l10n.edit,
                      onPressed: canManage && text(row, 'status') == 'draft'
                          ? () => context.go(
                                '${AppRoutes.quotations}/${text(row, 'id')}/edit',
                              )
                          : null,
                      icon: const Icon(Icons.edit_outlined, size: 18),
                    ),
                    IconButton(
                      tooltip: l10n.print,
                      onPressed: canExport
                          ? () => runPrint(
                                context,
                                links.quotationPrint(
                                  id: text(row, 'id'),
                                  language: language,
                                ),
                              )
                          : null,
                      icon: const Icon(Icons.print_outlined, size: 18),
                    ),
                    IconButton(
                      tooltip: l10n.deleteRecord,
                      onPressed: canManage && text(row, 'status') == 'draft'
                          ? () => _delete(row)
                          : null,
                      icon: const Icon(Icons.delete_outline, size: 18),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
