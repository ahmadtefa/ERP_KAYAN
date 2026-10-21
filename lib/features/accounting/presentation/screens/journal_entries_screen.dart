import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/error/failure.dart';
import '../../../../shared/widgets/status_pill.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/utils/account_name.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../providers/chart_of_accounts_providers.dart';
import '../providers/cost_center_providers.dart';
import '../../../data/presentation/widgets/list_export_actions.dart';
import '../../../data/presentation/widgets/document_export_actions.dart';

class JournalEntriesController extends JsonListController {
  @override
  String get resourcePath => '/accounting/journal-entries';
}

final journalEntriesProvider =
    AsyncNotifierProvider<JsonListController, List<Json>>(
      JournalEntriesController.new,
    );

/// Manual journal entries: things the documents do not cover — accruals,
/// corrections, opening balances.
///
/// An entry is created as a draft, checked for balance here and again on the
/// server, and only then posted. A posted entry is corrected by reversing it,
/// never by editing it.
class JournalEntriesScreen extends ConsumerStatefulWidget {
  const JournalEntriesScreen({super.key});

  @override
  ConsumerState<JournalEntriesScreen> createState() =>
      _JournalEntriesScreenState();
}

class _JournalEntriesScreenState extends ConsumerState<JournalEntriesScreen> {
  bool _busy = false;

  Future<void> _openEditor() async {
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const _JournalEditorScreen()),
    );
  }

  Future<void> _post(Json row) async {
    final l10n = context.l10n;
    final ok = await confirmAction(
      context,
      title: l10n.post,
      message: l10n.confirmPost,
      confirmLabel: l10n.post,
    );
    if (!ok || !mounted) return;
    await _run(
      () => ref
          .read(apiClientProvider)
          .post('/accounting/journal-entries/${row['id']}/post'),
      l10n.entryPosted,
    );
  }

  Future<void> _reverse(Json row) async {
    final l10n = context.l10n;
    final ok = await confirmAction(
      context,
      title: l10n.reverse,
      message: l10n.confirmReverse,
      confirmLabel: l10n.reverse,
      destructive: true,
    );
    if (!ok || !mounted) return;
    await _run(
      () => ref
          .read(apiClientProvider)
          .post('/accounting/journal-entries/${row['id']}/reverse'),
      l10n.entryReversed,
    );
  }

  Future<void> _run(Future<void> Function() action, String success) async {
    setState(() => _busy = true);
    try {
      await action();
      await ref.read(journalEntriesProvider.notifier).reload();
      if (mounted) showMessage(context, success);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(journalEntriesProvider);

    return ModuleScaffold(
      title: l10n.journalEntries,
      actions: const [ListExportActions(list: 'journal-entries')],
      trailing: FilledButton.icon(
        onPressed: _busy ? null : _openEditor,
        icon: const Icon(Icons.add),
        label: Text(l10n.newJournalEntry),
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(journalEntriesProvider.notifier).reload(),
        isEmpty: (rows) => rows.isEmpty,
        emptyMessage: l10n.noEntries,
        data: (rows) => RecordsTable(
          rows: rows,
          columns: [
            ColumnSpec(l10n.entryNumber, value: (r) => text(r, 'entryNumber'), emphasise: true),
            ColumnSpec(l10n.invoiceDate, value: (r) => text(r, 'entryDate')),
            ColumnSpec(l10n.description, value: (r) => text(r, 'description')),
            ColumnSpec(l10n.debit, numeric: true, value: (r) => formatAmount(asString(r['totalDebit']))),
            ColumnSpec(l10n.credit, numeric: true, value: (r) => formatAmount(asString(r['totalCredit']))),
            ColumnSpec(
              l10n.status,
              value: (r) => switch (text(r, 'status').toLowerCase()) {
                'draft' => l10n.draft,
                'posted' => l10n.posted,
                'reversed' => l10n.reversed,
                _ => text(r, 'status'),
              },
              tone: (r) => toneForStatus(text(r, 'status')),
            ),
          ],
          actions: (row) {
            final status = text(row, 'status').toLowerCase();
            return [
              IconButton(
                tooltip: Localizations.localeOf(context).languageCode == 'ar'
                    ? 'طباعة وتنزيل المستند'
                    : 'Print and download document',
                icon: const Icon(Icons.print_outlined, size: 20),
                onPressed: () => showDialog<void>(
                  context: context,
                  builder: (dialogContext) => AlertDialog(
                    title: Text(
                      '${l10n.entryNumber}: ${text(row, 'entryNumber')}',
                    ),
                    content: DocumentExportActions(
                      kind: 'journal-entry',
                      id: text(row, 'id'),
                    ),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.of(dialogContext).pop(),
                        child: Text(l10n.close),
                      ),
                    ],
                  ),
                ),
              ),
              if (status == 'draft')
                IconButton(
                  tooltip: l10n.post,
                  icon: const Icon(Icons.check_circle_outline, size: 20),
                  onPressed: _busy ? null : () => _post(row),
                ),
              if (status == 'posted')
                IconButton(
                  tooltip: l10n.reverse,
                  icon: const Icon(Icons.undo_outlined, size: 20),
                  onPressed: _busy ? null : () => _reverse(row),
                ),
            ];
          },
        ),
      ),
    );
  }
}

class _AllocationDraft {
  _AllocationDraft({this.costCenterId, String amount = ''})
    : amount = TextEditingController(text: amount);

  String? costCenterId;
  final TextEditingController amount;

  void dispose() => amount.dispose();
}

class _EntryLineDraft {
  _EntryLineDraft()
    : accountId = null,
      costCenterId = null,
      debit = TextEditingController(),
      credit = TextEditingController(),
      description = TextEditingController();

  String? accountId;

  /// The centre this line belongs to, when the cost is somebody's. Optional:
  /// a balance-sheet line usually has no owner. Ignored while [allocations] is
  /// non-empty: a line is either one centre or a controlled split, never both.
  String? costCenterId;
  final TextEditingController debit;
  final TextEditingController credit;
  final TextEditingController description;

  /// A split of this line across several centres. The server checks that the
  /// parts add up to the line amount exactly; the screen shows the same check
  /// before saving so nobody has to guess why it was refused.
  final List<_AllocationDraft> allocations = [];

  void dispose() {
    debit.dispose();
    credit.dispose();
    description.dispose();
    for (final allocation in allocations) {
      allocation.dispose();
    }
  }
}

class _JournalEditorScreen extends ConsumerStatefulWidget {
  const _JournalEditorScreen();

  @override
  ConsumerState<_JournalEditorScreen> createState() =>
      _JournalEditorScreenState();
}

class _JournalEditorScreenState extends ConsumerState<_JournalEditorScreen> {
  final _lines = <_EntryLineDraft>[_EntryLineDraft(), _EntryLineDraft()];
  final _description = TextEditingController();
  late String _entryDate;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _entryDate =
        '${now.year.toString().padLeft(4, '0')}-'
        '${now.month.toString().padLeft(2, '0')}-'
        '${now.day.toString().padLeft(2, '0')}';
  }

  @override
  void dispose() {
    _description.dispose();
    for (final line in _lines) {
      line.dispose();
    }
    super.dispose();
  }

  Decimal get _totalDebit =>
      _lines.fold(Decimal.zero, (sum, l) => sum + (Decimal.tryParse(l.debit.text.trim()) ?? Decimal.zero));

  Decimal get _totalCredit =>
      _lines.fold(Decimal.zero, (sum, l) => sum + (Decimal.tryParse(l.credit.text.trim()) ?? Decimal.zero));

  bool get _balanced => _totalDebit == _totalCredit && _totalDebit > Decimal.zero;

  Future<void> _save() async {
    final l10n = context.l10n;
    if (!_balanced) {
      showMessage(context, l10n.entryUnbalanced, error: true);
      return;
    }
    final lines = <Json>[];
    for (final line in _lines) {
      if (line.accountId == null) continue;
      final debit = line.debit.text.trim();
      final credit = line.credit.text.trim();
      if (debit.isEmpty && credit.isEmpty) continue;
      final lineAmount = Decimal.tryParse(
        debit.isNotEmpty && debit != '0' ? debit : credit,
      );
      if (line.allocations.isNotEmpty) {
        var allocated = Decimal.zero;
        final seen = <String>{};
        final allocations = <Json>[];
        for (final allocation in line.allocations) {
          final centre = allocation.costCenterId;
          final value = Decimal.tryParse(allocation.amount.text.trim());
          if (centre == null || value == null || value <= Decimal.zero) {
            showMessage(context, l10n.allocationMustReconcile, error: true);
            return;
          }
          if (!seen.add(centre)) {
            showMessage(context, l10n.duplicateCostCenter, error: true);
            return;
          }
          allocated += value;
          allocations.add({
            'costCenterId': centre,
            'amount': allocation.amount.text.trim(),
          });
        }
        if (lineAmount == null || allocated != lineAmount) {
          showMessage(context, l10n.allocationMustReconcile, error: true);
          return;
        }
        lines.add({
          'accountId': line.accountId,
          if (debit.isNotEmpty && debit != '0') 'debit': debit,
          if (credit.isNotEmpty && credit != '0') 'credit': credit,
          if (line.description.text.trim().isNotEmpty)
            'description': line.description.text.trim(),
          'allocations': allocations,
        });
        continue;
      }
      lines.add({
        'accountId': line.accountId,
        if (debit.isNotEmpty && debit != '0') 'debit': debit,
        if (credit.isNotEmpty && credit != '0') 'credit': credit,
        if (line.description.text.trim().isNotEmpty)
          'description': line.description.text.trim(),
        if (line.costCenterId != null) 'costCenterId': line.costCenterId,
      });
    }
    if (lines.length < 2) {
      showMessage(context, l10n.entryNeedsTwoLines, error: true);
      return;
    }

    setState(() => _saving = true);
    try {
      await ref
          .read(apiClientProvider)
          .post(
            '/accounting/journal-entries',
            body: {
              'entryDate': _entryDate,
              if (_description.text.trim().isNotEmpty)
                'description': _description.text.trim(),
              'lines': lines,
            },
          );
      await ref.read(journalEntriesProvider.notifier).reload();
      if (mounted) {
        Navigator.of(context).pop(true);
        showMessage(context, l10n.createdSuccessfully);
      }
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final accounts = ref.watch(chartOfAccountsProvider);
    final postable = (accounts.value ?? const [])
        .where((account) => account.isPostable)
        .toList(growable: false);
    final costCenters = ref.watch(activeCostCentersProvider).value ?? const <Json>[];
    final language = Localizations.localeOf(context).languageCode;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.newJournalEntry),
        actions: [
          Padding(
            padding: const EdgeInsetsDirectional.only(end: 16),
            child: FilledButton.icon(
              onPressed: _saving || !_balanced ? null : _save,
              icon: const Icon(Icons.save_outlined),
              label: Text(l10n.save),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Expanded(
                    child: InkWell(
                      onTap: () async {
                        final now = DateTime.now();
                        final picked = await showDatePicker(
                          context: context,
                          initialDate: DateTime.tryParse(_entryDate) ?? now,
                          firstDate: DateTime(now.year - 5),
                          lastDate: DateTime(now.year + 5),
                        );
                        if (picked == null) return;
                        setState(() {
                          _entryDate =
                              '${picked.year.toString().padLeft(4, '0')}-'
                              '${picked.month.toString().padLeft(2, '0')}-'
                              '${picked.day.toString().padLeft(2, '0')}';
                        });
                      },
                      child: InputDecorator(
                        decoration: InputDecoration(
                          labelText: l10n.invoiceDate,
                          border: const OutlineInputBorder(),
                          suffixIcon: const Icon(Icons.calendar_today_outlined),
                        ),
                        child: Text(_entryDate),
                      ),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    flex: 2,
                    child: TextField(
                      controller: _description,
                      decoration: InputDecoration(
                        labelText: l10n.description,
                        border: const OutlineInputBorder(),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Column(
                children: [
                  for (var index = 0; index < _lines.length; index++)
                    Padding(
                      key: ValueKey(_lines[index]),
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                        Row(
                        children: [
                          Expanded(
                            flex: 4,
                            child: DropdownButtonFormField<String>(
                              initialValue: _lines[index].accountId,
                              isExpanded: true,
                              decoration: InputDecoration(
                                labelText: l10n.account,
                                isDense: true,
                                border: const OutlineInputBorder(),
                              ),
                              items: [
                                for (final account in postable)
                                  DropdownMenuItem(
                                    value: account.id,
                                    child: Text(
                                      accountLabel(
                                        account,
                                        Localizations.localeOf(
                                          context,
                                        ).languageCode,
                                      ),
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                              ],
                              onChanged: (value) => setState(
                                () => _lines[index].accountId = value,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          // Offered only when the company actually keeps cost
                          // centres; a company that does not use the dimension
                          // sees the form it always saw.
                          if (costCenters.isNotEmpty) ...[
                            if (_lines[index].allocations.isNotEmpty)
                              Expanded(
                                flex: 3,
                                child: InputDecorator(
                                  decoration: InputDecoration(
                                    labelText: l10n.costCenter,
                                    isDense: true,
                                    border: const OutlineInputBorder(),
                                  ),
                                  child: Text(
                                    '${l10n.splitAcrossCenters} '
                                    '(${_lines[index].allocations.length})',
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              )
                            else
                            Expanded(
                              flex: 3,
                              child: DropdownButtonFormField<String>(
                                initialValue: _lines[index].costCenterId,
                                isExpanded: true,
                                decoration: InputDecoration(
                                  labelText: l10n.costCenter,
                                  isDense: true,
                                  border: const OutlineInputBorder(),
                                ),
                                items: [
                                  DropdownMenuItem(
                                    value: '',
                                    child: Text(
                                      l10n.noAllocation,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  for (final center in costCenters)
                                    DropdownMenuItem(
                                      value: text(center, 'id'),
                                      child: Text(
                                        costCenterLabel(center, language),
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                ],
                                onChanged: (value) => setState(
                                  () => _lines[index].costCenterId = value == null ||
                                          value.isEmpty
                                      ? null
                                      : value,
                                ),
                              ),
                            ),
                            const SizedBox(width: 4),
                            IconButton(
                              tooltip: l10n.splitAcrossCenters,
                              visualDensity: VisualDensity.compact,
                              icon: Icon(
                                _lines[index].allocations.isEmpty
                                    ? Icons.call_split
                                    : Icons.merge_type,
                                size: 18,
                              ),
                              onPressed: () => setState(() {
                                final line = _lines[index];
                                if (line.allocations.isNotEmpty) {
                                  for (final allocation in line.allocations) {
                                    allocation.dispose();
                                  }
                                  line.allocations.clear();
                                  return;
                                }
                                final amount = line.debit.text.trim().isNotEmpty
                                    ? line.debit.text.trim()
                                    : line.credit.text.trim();
                                line.allocations.add(
                                  _AllocationDraft(
                                    costCenterId: line.costCenterId,
                                    amount: amount,
                                  ),
                                );
                              }),
                            ),
                            const SizedBox(width: 4),
                          ],
                          Expanded(
                            flex: 2,
                            child: TextField(
                              controller: _lines[index].debit,
                              keyboardType: const TextInputType.numberWithOptions(
                                decimal: true,
                              ),
                              decoration: InputDecoration(
                                labelText: l10n.debit,
                                isDense: true,
                                border: const OutlineInputBorder(),
                              ),
                              onChanged: (_) => setState(() {}),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            flex: 2,
                            child: TextField(
                              controller: _lines[index].credit,
                              keyboardType: const TextInputType.numberWithOptions(
                                decimal: true,
                              ),
                              decoration: InputDecoration(
                                labelText: l10n.credit,
                                isDense: true,
                                border: const OutlineInputBorder(),
                              ),
                              onChanged: (_) => setState(() {}),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            flex: 3,
                            child: TextField(
                              controller: _lines[index].description,
                              decoration: InputDecoration(
                                labelText: l10n.lineDescription,
                                isDense: true,
                                border: const OutlineInputBorder(),
                              ),
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.delete_outline),
                            onPressed: _lines.length <= 2
                                ? null
                                : () => setState(
                                    () => _lines.removeAt(index).dispose(),
                                  ),
                          ),
                        ],
                      ),
                      if (_lines[index].allocations.isNotEmpty)
                        _allocationEditor(index, costCenters, language),
                      ],
                      ),
                    ),
                  const SizedBox(height: 8),
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: TextButton.icon(
                      onPressed: () =>
                          setState(() => _lines.add(_EntryLineDraft())),
                      icon: const Icon(Icons.add),
                      label: Text(l10n.addLine),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Card(
            color: _balanced
                ? Theme.of(context).colorScheme.surfaceContainerHighest
                : Theme.of(context).colorScheme.errorContainer,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Icon(
                    _balanced ? Icons.verified_outlined : Icons.error_outline,
                  ),
                  const SizedBox(width: 8),
                  Text(_balanced ? l10n.balanced : l10n.entryUnbalanced),
                  const Spacer(),
                  Text('${l10n.debit}: ${formatAmount(_totalDebit.toString())}'),
                  const SizedBox(width: 20),
                  Text(
                    '${l10n.credit}: ${formatAmount(_totalCredit.toString())}',
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// The controlled split of one line: amounts per centre, the total, and what
  /// is still unallocated. Duplicate centres and an inexact total are refused
  /// here and again by the server.
  Widget _allocationEditor(int index, List<Json> costCenters, String language) {
    final l10n = context.l10n;
    final line = _lines[index];
    final lineAmount = Decimal.tryParse(
      line.debit.text.trim().isNotEmpty
          ? line.debit.text.trim()
          : line.credit.text.trim(),
    ) ?? Decimal.zero;
    final allocated = line.allocations.fold(
      Decimal.zero,
      (sum, allocation) =>
          sum + (Decimal.tryParse(allocation.amount.text.trim()) ?? Decimal.zero),
    );
    final remaining = lineAmount - allocated;
    return Padding(
      padding: const EdgeInsetsDirectional.only(start: 24, top: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var position = 0;
              position < line.allocations.length;
              position++)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  Expanded(
                    flex: 3,
                    child: DropdownButtonFormField<String>(
                      key: ValueKey('allocation-$index-$position'),
                      initialValue: _allocationChoice(
                        costCenters,
                        line.allocations[position].costCenterId,
                      ),
                      isExpanded: true,
                      decoration: InputDecoration(
                        labelText: l10n.costCenter,
                        isDense: true,
                        border: const OutlineInputBorder(),
                      ),
                      items: [
                        for (final center in costCenters)
                          DropdownMenuItem(
                            value: text(center, 'id'),
                            child: Text(
                              costCenterLabel(center, language),
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                      onChanged: (value) => setState(
                        () => line.allocations[position].costCenterId = value,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    width: 160,
                    child: TextField(
                      controller: line.allocations[position].amount,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      decoration: InputDecoration(
                        labelText: l10n.amount,
                        isDense: true,
                        border: const OutlineInputBorder(),
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                  IconButton(
                    tooltip: l10n.remove,
                    icon: const Icon(Icons.delete_outline, size: 18),
                    onPressed: line.allocations.length == 1
                        ? null
                        : () => setState(
                            () => line.allocations.removeAt(position).dispose(),
                          ),
                  ),
                ],
              ),
            ),
          Row(
            children: [
              TextButton.icon(
                onPressed: () => setState(
                  () => line.allocations.add(_AllocationDraft()),
                ),
                icon: const Icon(Icons.add, size: 18),
                label: Text(l10n.addAllocation),
              ),
              const SizedBox(width: 16),
              Text(
                '${l10n.allocationTotal}: ${formatAmount(allocated.toString())}'
                '  ·  ${l10n.remainingToAllocate}: '
                '${formatAmount(remaining.toString())}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const Spacer(),
              if (remaining != Decimal.zero)
                Text(
                  l10n.allocationMustReconcile,
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.error,
                    fontSize: 12,
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  String? _allocationChoice(List<Json> centres, String? id) {
    if (id == null || id.isEmpty) return null;
    return centres.any((center) => text(center, 'id') == id) ? id : null;
  }
}
