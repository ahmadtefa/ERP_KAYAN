import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/error/failure.dart';
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
            ),
          ],
          actions: (row) {
            final status = text(row, 'status').toLowerCase();
            return [
              IconButton(
                tooltip: Localizations.localeOf(context).languageCode == 'ar'
                    ? 'عرض تفاصيل القيد'
                    : 'View journal details',
                icon: const Icon(Icons.visibility_outlined, size: 20),
                onPressed: () => showDialog<void>(
                  context: context,
                  builder: (_) => _JournalDetailDialog(entry: row),
                ),
              ),
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


class _JournalDetailDialog extends StatelessWidget {
  const _JournalDetailDialog({required this.entry});

  final Json entry;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final language = Localizations.localeOf(context).languageCode;
    final lines = listOf(entry['lines']);

    String centreLabel(Json row) {
      final code = text(row, 'costCenterCode');
      final name = language == 'ar'
          ? text(row, 'costCenterNameAr')
          : text(row, 'costCenterNameEn');
      if (code.isEmpty && name.isEmpty) return '—';
      return code.isEmpty ? name : '$code — $name';
    }

    String allocationsLabel(Json row) {
      final allocations = listOf(row['allocations']);
      if (allocations.isNotEmpty) {
        return allocations.map((allocation) {
          final code = text(allocation, 'costCenterCode');
          final name = language == 'ar'
              ? text(allocation, 'costCenterNameAr')
              : text(allocation, 'costCenterNameEn');
          final centre = code.isEmpty ? name : '$code — $name';
          return '$centre: ${formatAmount(asString(allocation['amount']))}';
        }).join('\n');
      }
      return centreLabel(row);
    }

    return AlertDialog(
      title: Text('${l10n.entryNumber}: ${text(entry, 'entryNumber')}'),
      content: SizedBox(
        width: 920,
        height: 480,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('${l10n.description}: ${text(entry, 'description')}'),
            const SizedBox(height: 8),
            Text('${l10n.debit}: ${formatAmount(asString(entry['totalDebit']))}    '
                '${l10n.credit}: ${formatAmount(asString(entry['totalCredit']))}'),
            const SizedBox(height: 12),
            Expanded(
              child: SingleChildScrollView(
                child: RecordsTable(
                  rows: lines,
                  columns: [
                    ColumnSpec('#', numeric: true,
                      value: (row) => asNum(row['lineNumber'])?.toString() ?? ''),
                    ColumnSpec(l10n.chartOfAccounts,
                      value: (row) => '${text(row, 'accountCode')} — ${language == 'ar' ? text(row, 'accountNameAr') : text(row, 'accountNameEn')}'),
                    ColumnSpec(l10n.description, value: (row) => text(row, 'description')),
                    ColumnSpec(language == 'ar' ? 'مركز التكلفة / التوزيع' : 'Cost center / allocation',
                      value: allocationsLabel),
                    ColumnSpec(l10n.debit, numeric: true,
                      value: (row) => formatAmount(asString(row['debit']))),
                    ColumnSpec(l10n.credit, numeric: true,
                      value: (row) => formatAmount(asString(row['credit']))),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: Text(l10n.close)),
      ],
    );
  }
}

class _AllocationDraft {
  _AllocationDraft() : amount = TextEditingController();

  String? costCenterId;
  final TextEditingController amount;

  void dispose() => amount.dispose();
}

class _EntryLineDraft {
  _EntryLineDraft()
    : accountId = null,
      costCenterId = null,
      splitAllocation = false,
      allocations = <_AllocationDraft>[],
      debit = TextEditingController(),
      credit = TextEditingController(),
      description = TextEditingController();

  String? accountId;
  String? costCenterId;
  bool splitAllocation;
  final List<_AllocationDraft> allocations;
  final TextEditingController debit;
  final TextEditingController credit;
  final TextEditingController description;

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
      if (line.splitAllocation) {
        final amount = Decimal.tryParse(debit.isNotEmpty && debit != '0' ? debit : credit) ?? Decimal.zero;
        final allocated = line.allocations.fold(
          Decimal.zero,
          (sum, part) => sum + (Decimal.tryParse(part.amount.text.trim()) ?? Decimal.zero),
        );
        final ids = line.allocations.map((part) => part.costCenterId).toList();
        final validParts = line.allocations.isNotEmpty &&
            line.allocations.every((part) =>
                part.costCenterId != null &&
                (Decimal.tryParse(part.amount.text.trim()) ?? Decimal.zero) > Decimal.zero) &&
            ids.toSet().length == ids.length;
        if (!validParts || amount <= Decimal.zero || allocated != amount) {
          showMessage(
            context,
            _journalText(context, 'توزيع السطر يجب أن يكون على مراكز مختلفة ومجموعه مطابقًا لمبلغ السطر', 'Split allocations must use distinct centres and add up exactly to the line amount'),
            error: true,
          );
          return;
        }
      }
      lines.add({
        'accountId': line.accountId,
        if (debit.isNotEmpty && debit != '0') 'debit': debit,
        if (credit.isNotEmpty && credit != '0') 'credit': credit,
        if (line.description.text.trim().isNotEmpty)
          'description': line.description.text.trim(),
        if (line.splitAllocation)
          'allocations': [
            for (final part in line.allocations)
              {'costCenterId': part.costCenterId, 'amount': part.amount.text.trim()},
          ]
        else if (line.costCenterId != null)
          'costCenterId': line.costCenterId,
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

  Future<void> _editAllocations(
    _EntryLineDraft line,
    List<Json> centres,
    String language,
  ) async {
    if (!line.splitAllocation) {
      setState(() {
        line.splitAllocation = true;
        line.costCenterId = null;
        if (line.allocations.isEmpty) line.allocations.add(_AllocationDraft());
      });
    }
    final amount = Decimal.tryParse(
          line.debit.text.trim().isNotEmpty && line.debit.text.trim() != '0'
              ? line.debit.text.trim()
              : line.credit.text.trim(),
        ) ??
        Decimal.zero;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) {
          final allocated = line.allocations.fold(
            Decimal.zero,
            (sum, part) => sum + (Decimal.tryParse(part.amount.text.trim()) ?? Decimal.zero),
          );
          final valid = amount > Decimal.zero &&
              line.allocations.isNotEmpty &&
              line.allocations.every((part) =>
                  part.costCenterId != null &&
                  (Decimal.tryParse(part.amount.text.trim()) ?? Decimal.zero) > Decimal.zero) &&
              line.allocations.map((part) => part.costCenterId).toSet().length == line.allocations.length &&
              allocated == amount;
          return AlertDialog(
            title: Text(_journalText(context, 'توزيع مبلغ السطر', 'Allocate line amount')),
            content: SizedBox(
              width: 640,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: Text('${_journalText(context, 'مبلغ السطر', 'Line amount')}: ${formatAmount(amount.toString())}'),
                    ),
                    const SizedBox(height: 12),
                    for (var i = 0; i < line.allocations.length; i++)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Row(
                          children: [
                            Expanded(
                              flex: 3,
                              child: DropdownButtonFormField<String>(
                                initialValue: line.allocations[i].costCenterId,
                                isExpanded: true,
                                decoration: InputDecoration(
                                  labelText: context.l10n.costCenter,
                                  isDense: true,
                                  border: const OutlineInputBorder(),
                                ),
                                items: [
                                  for (final centre in centres)
                                    if (text(centre, 'id') == line.allocations[i].costCenterId ||
                                        !line.allocations.any((other) =>
                                            !identical(other, line.allocations[i]) &&
                                            other.costCenterId == text(centre, 'id')))
                                      DropdownMenuItem(
                                        value: text(centre, 'id'),
                                        child: Text(costCenterLabel(centre, language), overflow: TextOverflow.ellipsis),
                                      ),
                                ],
                                onChanged: (value) => setDialogState(() => line.allocations[i].costCenterId = value),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              flex: 2,
                              child: TextField(
                                controller: line.allocations[i].amount,
                                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                decoration: InputDecoration(
                                  labelText: _journalText(context, 'المبلغ', 'Amount'),
                                  isDense: true,
                                  border: const OutlineInputBorder(),
                                ),
                                onChanged: (_) => setDialogState(() {}),
                              ),
                            ),
                            IconButton(
                              tooltip: _journalText(context, 'حذف التوزيع', 'Remove allocation'),
                              icon: const Icon(Icons.delete_outline),
                              onPressed: line.allocations.length <= 1 ? null : () => setDialogState(() => line.allocations.removeAt(i).dispose()),
                            ),
                          ],
                        ),
                      ),
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: TextButton.icon(
                        onPressed: () => setDialogState(() => line.allocations.add(_AllocationDraft())),
                        icon: const Icon(Icons.add),
                        label: Text(_journalText(context, 'إضافة مركز', 'Add centre')),
                      ),
                    ),
                    const Divider(),
                    Text('${_journalText(context, 'الموزع', 'Allocated')}: ${formatAmount(allocated.toString())}    ${_journalText(context, 'المتبقي', 'Remaining')}: ${formatAmount((amount - allocated).toString())}'),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () {
                  setState(() => line.splitAllocation = false);
                  Navigator.of(dialogContext).pop();
                },
                child: Text(_journalText(context, 'استخدام مركز واحد', 'Use one centre')),
              ),
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: Text(context.l10n.cancel),
              ),
              FilledButton(
                onPressed: valid ? () => Navigator.of(dialogContext).pop() : null,
                child: Text(_journalText(context, 'تم', 'Done')),
              ),
            ],
          );
        },
      ),
    );
    if (mounted) setState(() {});
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
                      child: Row(
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
                            Expanded(
                              flex: 3,
                              child: _lines[index].splitAllocation
                                  ? OutlinedButton.icon(
                                      onPressed: _saving
                                          ? null
                                          : () => _editAllocations(_lines[index], costCenters, language),
                                      icon: const Icon(Icons.call_split_outlined, size: 18),
                                      label: Text(
                                        _journalText(context, 'توزيع (${_lines[index].allocations.length})', 'Split (${_lines[index].allocations.length})'),
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    )
                                  : DropdownButtonFormField<String>(
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
                                          child: Text(l10n.noAllocation, overflow: TextOverflow.ellipsis),
                                        ),
                                        for (final center in costCenters)
                                          DropdownMenuItem(
                                            value: text(center, 'id'),
                                            child: Text(costCenterLabel(center, language), overflow: TextOverflow.ellipsis),
                                          ),
                                      ],
                                      onChanged: (value) => setState(
                                        () => _lines[index].costCenterId = value == null || value.isEmpty ? null : value,
                                      ),
                                    ),
                            ),
                            const SizedBox(width: 4),
                            IconButton(
                              tooltip: _journalText(context, 'توزيع على عدة مراكز', 'Split across centres'),
                              icon: const Icon(Icons.call_split_outlined, size: 20),
                              onPressed: _saving ? null : () => _editAllocations(_lines[index], costCenters, language),
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
}


String _journalText(BuildContext context, String arabic, String english) =>
    Localizations.localeOf(context).languageCode == 'ar' ? arabic : english;
