import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/router/draft_exit_guard.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
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
  const FiscalPeriodsScreen({super.key, this.navigationKey});
  final ValueKey<String>? navigationKey;

  @override
  ConsumerState<FiscalPeriodsScreen> createState() =>
      _FiscalPeriodsScreenState();
}

class _FiscalPeriodsScreenState extends ConsumerState<FiscalPeriodsScreen> {
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

  Future<void> _save({Json? existing}) async {
    final l10n = context.l10n;
    final isEdit = existing != null;
    final values = await showFormSheet(
      context,
      exitRelay: _exitRelay,
      title: isEdit ? l10n.editPeriod : l10n.newPeriod,
      fields: [
        if (!isEdit) FieldSpec('code', l10n.periodCode, required: true),
        FieldSpec('nameEn', l10n.fullNameEn, required: true),
        FieldSpec('nameAr', l10n.fullNameAr, required: true),
        FieldSpec('startDate', l10n.startDate, kind: FieldKind.date, required: true),
        FieldSpec('endDate', l10n.endDate, kind: FieldKind.date, required: true),
      ],
      initial: existing,
      onSubmit: (draft) async {
        try {
          final client = ref.read(apiClientProvider);
          if (isEdit) {
            await client.patch('/accounting/fiscal-periods/${existing['id']}', body: draft);
          } else {
            await client.post('/accounting/fiscal-periods', body: draft);
          }
        } catch (error) {
          if (mounted) ref.read(fiscalPeriodsListProvider.notifier).reload();
          throw UncertainFormSubmission(error);
        }
      },
    );
    if (values == null || !mounted) return;
    await ref.read(fiscalPeriodsListProvider.notifier).reload();
    if (mounted) showMessage(context, l10n.createdSuccessfully);
  }

  Future<void> _closeYear(Json period) async {
    final closed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _YearEndCloseDialog(period: period, exitRelay: _exitRelay),
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
    } catch (error) {
      if (mounted) {
        await ref.read(fiscalPeriodsListProvider.notifier).reload();
        if (mounted) await showAppError(context, error);
      }
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
  const _YearEndCloseDialog({required this.period, required this.exitRelay});

  final Json period;
  final DraftExitRelay exitRelay;

  @override
  ConsumerState<_YearEndCloseDialog> createState() =>
      _YearEndCloseDialogState();
}

class _YearEndCloseDialogState extends ConsumerState<_YearEndCloseDialog> {
  final _reason = TextEditingController();
  bool _loading = true;
  bool _closing = false;
  bool _uncertain = false;
  bool _confirming = false;
  bool _reconciliationUnavailable = false;
  String? _error;
  Json _preview = const {};
  Json _centre = const {};
  Json? _result;

  @override
  void initState() {
    super.initState();
    widget.exitRelay.attach(_leaveForRoute);
    _load();
  }

  @override
  void dispose() {
    widget.exitRelay.detach(_leaveForRoute);
    _reason.dispose();
    super.dispose();
  }

  Future<bool> _canLeave() async {
    if (_closing || _confirming) return false;
    if (_result == null && (_uncertain || _reason.text.trim().isNotEmpty)) {
      _confirming = true;
      try {
        final discard = await confirmAction(context,
          title: _t(context, 'تغييرات غير محفوظة', 'Unsaved changes'),
          message: _uncertain
              ? _t(context, 'قد تكون عملية الإقفال اكتملت. راجع حالة الفترة قبل المحاولة مجددًا.', 'The close may have completed. Review the period before retrying.')
              : _t(context, 'الخروج دون حفظ المدخلات؟', 'Leave without saving your changes?'),
          confirmLabel: _t(context, 'الخروج دون حفظ', 'Discard changes'), destructive: true);
        if (!discard || !mounted) return false;
      } finally {
        _confirming = false;
      }
    }
    return mounted;
  }

  Future<void> _requestClose() async {
    if (await _canLeave() && mounted) Navigator.of(context).pop(_uncertain || _result != null);
  }

  Future<bool> _leaveForRoute() async {
    if (!await _canLeave() || !mounted) return false;
    Navigator.of(context).pop(_uncertain || _result != null);
    return true;
  }

  Future<void> _load() async {
    try {
      final client = ref.read(apiClientProvider);
      var reconciliationUnavailable = false;
      final results = await Future.wait([
        client.getObject(
          '/accounting/fiscal-periods/${widget.period['id']}/closing-preview',
        ),
        client
            .getObject('/reports/reconciliation-center')
            .catchError((_) {
              reconciliationUnavailable = true;
              return <String, dynamic>{};
            }),
      ]);
      if (mounted) {
        setState(() {
          _preview = results[0];
          _centre = results[1];
          _reconciliationUnavailable = reconciliationUnavailable;
          _loading = false;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = _t(context, 'تعذر تحميل معاينة الإقفال.', 'Could not load the closing preview.');
          _loading = false;
        });
        await showAppError(context, error);
      }
    }
  }

  Future<void> _closeYear() async {
    if (_closing || _uncertain) return;
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
      if (mounted) {
        ref.invalidate(fiscalPeriodsListProvider);
        setState(() { _result = body; _closing = false; });
      }
    } catch (error) {
      if (mounted) {
        ref.invalidate(fiscalPeriodsListProvider);
        setState(() { _closing = false; _uncertain = true; });
        await showAppError(context, error);
      }
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: false,
    onPopInvokedWithResult: (didPop, _) { if (!didPop) _requestClose(); },
    child: _buildDialog(context),
  );

  Widget _buildDialog(BuildContext context) {
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
            onPressed: _requestClose,
            child: Text(l10n.close),
          ),
        ],
      );
    }

    final blockers = _preview['blockers'] is List
        ? (_preview['blockers'] as List).map((e) => '$e').toList()
        : <String>[];
    final warnings = <String>[
      if (_reconciliationUnavailable)
        _t(context, 'تعذر تحميل مركز التسوية؛ تحقق منه قبل الإقفال.', 'Reconciliation center could not be loaded; review it before closing.'),
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
                    if (_uncertain)
                      Text(_t(context, 'قد تكون العملية اكتملت. أغلق النافذة وراجع الفترة قبل المحاولة مجددًا.', 'The close may have completed. Close this dialog and review the period before retrying.')),
                    TextField(
                      controller: _reason,
                      enabled: !_closing && !_uncertain,
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
          onPressed: _closing ? null : _requestClose,
          child: Text(l10n.cancel),
        ),
        FilledButton(
          onPressed:
              (_loading || _closing || _uncertain || _error != null || blockers.isNotEmpty)
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
