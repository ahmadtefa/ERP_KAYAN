import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/error/failure.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../providers/chart_of_accounts_providers.dart';

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

class _EntryLineDraft {
  _EntryLineDraft()
    : accountId = null,
      debit = TextEditingController(),
      credit = TextEditingController(),
      description = TextEditingController();

  String? accountId;
  final TextEditingController debit;
  final TextEditingController credit;
  final TextEditingController description;

  void dispose() {
    debit.dispose();
    credit.dispose();
    description.dispose();
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
      lines.add({
        'accountId': line.accountId,
        if (debit.isNotEmpty && debit != '0') 'debit': debit,
        if (credit.isNotEmpty && credit != '0') 'credit': credit,
        if (line.description.text.trim().isNotEmpty)
          'description': line.description.text.trim(),
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
                                      '${account.code} — ${account.name}',
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
