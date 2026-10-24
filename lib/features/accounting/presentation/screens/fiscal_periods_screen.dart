import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/json/amount_format.dart';
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

  Future<void> _closeYear(Json period) async {
    final closed = await showDialog<bool>(
      context: context,
      builder: (context) => _YearEndCloseDialog(period: period),
    );
    if (closed == true && mounted) {
      await ref.read(fiscalPeriodsListProvider.notifier).reload();
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
              value: (r) => flag(r, 'isClosed') ? l10n.closed : l10n.open,
              tone: (r) =>
                  flag(r, 'isClosed') ? AppTone.neutral : AppTone.success,
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
              tooltip: _t(context, 'إقفال السنة المالية', 'Year-end close'),
              icon: const Icon(Icons.event_busy_outlined, size: 20),
              onPressed: _busy || flag(row, 'isClosed')
                  ? null
                  : () => _closeYear(row),
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

/// Inline bilingual label, the house pattern for newer accounting chrome
/// that has no generated key yet.
String _t(BuildContext context, String ar, String en) =>
    Localizations.localeOf(context).languageCode == 'ar' ? ar : en;

/// Review before the point of no return: what closing this year will
/// move, what blocks it outright, and what merely deserves a look —
/// including any subledger the reconciliation centre currently shows
/// as different or incomplete. Blockers stop; warnings inform. The
/// close itself is the existing year-end mechanism (result to retained
/// earnings, then the lock), and its entry number is reported back.
class _YearEndCloseDialog extends ConsumerStatefulWidget {
  const _YearEndCloseDialog({required this.period});

  final Json period;

  @override
  ConsumerState<_YearEndCloseDialog> createState() =>
      _YearEndCloseDialogState();
}

class _YearEndCloseDialogState extends ConsumerState<_YearEndCloseDialog> {
  final _reason = TextEditingController();
  bool _loading = true;
  bool _closing = false;
  String? _error;
  Json _preview = const {};
  Json _centre = const {};
  Json? _result;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final client = ref.read(apiClientProvider);
      final results = await Future.wait([
        client.getObject(
          '/accounting/fiscal-periods/${widget.period['id']}/closing-preview',
        ),
        client
            .getObject('/reports/reconciliation-center')
            .catchError((_) => <String, dynamic>{}),
      ]);
      if (mounted) {
        setState(() {
          _preview = results[0];
          _centre = results[1];
          _loading = false;
        });
      }
    } on Failure catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    }
  }

  Future<void> _closeYear() async {
    setState(() => _closing = true);
    try {
      final body = await ref
          .read(apiClientProvider)
          .post(
            '/accounting/fiscal-periods/${widget.period['id']}/close-year',
            body: {
              if (_reason.text.trim().isNotEmpty)
                'reason': _reason.text.trim(),
            },
          );
      if (mounted) setState(() => _result = body);
    } on Failure catch (e) {
      if (mounted) {
        setState(() => _closing = false);
        showMessage(context, e.message, error: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final title =
        '${_t(context, 'إقفال السنة المالية', 'Year-end close')} — ${text(widget.period, 'code')}';

    if (_result != null) {
      final entry = _result!['closingEntry'] is Map
          ? Map<String, dynamic>.from(_result!['closingEntry'] as Map)
          : <String, dynamic>{};
      final totals = _result!['totals'] is Map
          ? Map<String, dynamic>.from(_result!['totals'] as Map)
          : <String, dynamic>{};
      return AlertDialog(
        title: Text(title),
        content: Text(
          '${_t(context, 'تم الإقفال. قيد الإقفال', 'Closed. Closing entry')} '
          '${text(entry, 'entryNumber')} · '
          '${_t(context, 'النتيجة', 'Result')}: '
          '${formatAmount(asString(totals['result']))}',
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.close),
          ),
        ],
      );
    }

    final blockers = _preview['blockers'] is List
        ? (_preview['blockers'] as List).map((e) => '$e').toList()
        : <String>[];
    final warnings = <String>[
      if (_preview['warnings'] is List)
        ...(_preview['warnings'] as List).map((e) => '$e'),
    ];
    // The reconciliation centre speaks for today: a subledger out of
    // step right now deserves a look before the year locks, even though
    // it is not by itself a reason the close would be wrong.
    for (final section in listOf(_centre['sections'])) {
      final status = text(section, 'status');
      if (status == 'matched') continue;
      final label = switch (text(section, 'key')) {
        'receivables' => _t(context, 'تسوية العملاء', 'Receivables'),
        'payables' => _t(context, 'تسوية الموردين', 'Payables'),
        'inventory' => _t(context, 'تسوية المخزون', 'Inventory'),
        _ => _t(context, 'تسوية الأصول الثابتة', 'Fixed assets'),
      };
      warnings.add(
        status == 'incomplete'
            ? '$label: ${_t(context, 'غير مكتملة', 'incomplete')} — ${text(section, 'reason')}'
            : '$label: ${_t(context, 'يوجد فرق', 'difference')} ${formatAmount(asString(section['difference']))}',
      );
    }
    final totals = _preview['totals'] is Map
        ? Map<String, dynamic>.from(_preview['totals'] as Map)
        : <String, dynamic>{};

    Widget amountLine(String label, Object? raw) => Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        children: [
          Expanded(child: Text(label)),
          Text(
            formatAmount(asString(raw)),
            style: const TextStyle(fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );

    return AlertDialog(
      title: Text(title),
      content: SizedBox(
        width: 560,
        child: _loading
            ? const Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: CircularProgressIndicator()),
              )
            : _error != null
            ? Text(_error!)
            : SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    amountLine(
                      _t(context, 'الإيرادات', 'Revenue'),
                      totals['revenue'],
                    ),
                    amountLine(
                      _t(context, 'المصروفات', 'Expenses'),
                      totals['expenses'],
                    ),
                    amountLine(
                      totals['resultLabel'] == 'loss'
                          ? _t(context, 'الخسارة', 'Loss')
                          : _t(context, 'الربح', 'Profit'),
                      totals['result'],
                    ),
                    if (blockers.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Text(
                        _t(
                          context,
                          'يجب حل هذه المشكلات قبل الإقفال:',
                          'Must be resolved before closing:',
                        ),
                        style: TextStyle(
                          color: AppTone.danger.foreground,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      for (final b in blockers)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text(
                            '• $b',
                            style: TextStyle(
                              color: AppTone.danger.foreground,
                            ),
                          ),
                        ),
                    ],
                    if (warnings.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Text(
                        _t(
                          context,
                          'للمراجعة قبل الإقفال (لا تمنع الإقفال):',
                          'Worth a look before closing (not blocking):',
                        ),
                        style: TextStyle(
                          color: AppTone.warning.foreground,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      for (final w in warnings)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Text('• $w'),
                        ),
                    ],
                    const SizedBox(height: 16),
                    TextField(
                      controller: _reason,
                      decoration: InputDecoration(
                        labelText: _t(
                          context,
                          'سبب الإقفال (اختياري)',
                          'Reason (optional)',
                        ),
                        border: const OutlineInputBorder(),
                      ),
                    ),
                  ],
                ),
              ),
      ),
      actions: [
        TextButton(
          onPressed: _closing ? null : () => Navigator.of(context).pop(false),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          onPressed:
              (_loading || _closing || _error != null || blockers.isNotEmpty)
              ? null
              : _closeYear,
          child: Text(
            _t(context, 'تنفيذ إقفال السنة', 'Close the year'),
          ),
        ),
      ],
    );
  }
}
