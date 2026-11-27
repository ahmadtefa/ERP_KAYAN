import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme/design_tokens.dart';
import '../../../core/json/json_utils.dart';
import '../../../shared/widgets/form_sheet.dart';
import '../../../shared/widgets/records_table.dart';
import '../../../shared/widgets/state_views.dart';
import '../../auth/presentation/providers/auth_providers.dart';
import '../../common/presentation/providers/resource_providers.dart';
import '../../common/presentation/screens/module_scaffold.dart';

/// Sales-rep commissions: the reps and their rates, what each posted invoice
/// earned, the invoices still without a rep, and what has been paid out.
final commissionEntriesProvider = AsyncNotifierProvider<CommissionEntriesController, List<Json>>(CommissionEntriesController.new);
final commissionRepsProvider = AsyncNotifierProvider<CommissionRepsController, List<Json>>(CommissionRepsController.new);
final commissionUnassignedProvider = AsyncNotifierProvider<CommissionUnassignedController, List<Json>>(CommissionUnassignedController.new);
final commissionPayoutsProvider = AsyncNotifierProvider<CommissionPayoutsController, List<Json>>(CommissionPayoutsController.new);

class CommissionEntriesController extends JsonListController {
  @override
  String get resourcePath => '/commissions/entries';
}

class CommissionRepsController extends JsonListController {
  @override
  String get resourcePath => '/commissions/reps';
}

class CommissionUnassignedController extends JsonListController {
  @override
  String get resourcePath => '/commissions/unassigned';
}

class CommissionPayoutsController extends JsonListController {
  @override
  String get resourcePath => '/commissions/payouts';
}

/// What a payout of the unpaid entries would come to, in piasters, sales net of
/// returns. The server works the real figure; this is only the preview.
int unpaidNetPiasters(List<Json> entries, {String? repId}) {
  var total = 0;
  for (final e in entries) {
    if (text(e, 'status') != 'ACCRUED') continue;
    if (repId != null && text(e, 'repId') != repId) continue;
    final amount = e['amount'];
    final value = amount is num ? amount.toDouble() : double.tryParse('$amount') ?? 0;
    total += (value * 100).round();
  }
  return total;
}

String piastersText(int piasters) => (piasters / 100).toStringAsFixed(2);

class CommissionsScreen extends ConsumerStatefulWidget {
  const CommissionsScreen({super.key});

  @override
  ConsumerState<CommissionsScreen> createState() => _CommissionsScreenState();
}

class _CommissionsScreenState extends ConsumerState<CommissionsScreen> {
  String _view = 'entries';

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String _name(Json r, {String en = 'nameEn', String ar = 'nameAr'}) =>
      _arabic ? text(r, ar, fallback: text(r, en)) : text(r, en, fallback: text(r, ar));

  void _reloadAll() {
    ref.invalidate(commissionEntriesProvider);
    ref.invalidate(commissionRepsProvider);
    ref.invalidate(commissionUnassignedProvider);
    ref.invalidate(commissionPayoutsProvider);
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final canManage = user?.can('commissions.manage') ?? false;
    final labels = {
      'entries': _arabic ? 'العمولات' : 'Commissions',
      'reps': _arabic ? 'المندوبون' : 'Reps',
      'unassigned': _arabic ? 'فواتير بلا مندوب' : 'Invoices without a rep',
      'payouts': _arabic ? 'المصروف' : 'Paid out',
    };
    return ModuleScaffold(
      title: _arabic ? 'عمولات المندوبين' : 'Sales-rep commissions',
      eyebrow: _arabic ? 'المبيعات' : 'Sales',
      trailing: Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          if (canManage && _view == 'reps')
            FilledButton.icon(
              onPressed: () => _repForm(null),
              icon: const Icon(Icons.add, size: 18),
              label: Text(_arabic ? 'مندوب جديد' : 'New rep'),
            ),
          if (canManage && _view == 'entries')
            FilledButton.icon(
              onPressed: _payout,
              icon: const Icon(Icons.payments_outlined, size: 18),
              label: Text(_arabic ? 'صرف عمولة' : 'Pay out'),
            ),
          IconButton(
            tooltip: _arabic ? 'تحديث' : 'Refresh',
            icon: const Icon(Icons.refresh),
            onPressed: _reloadAll,
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final v in labels.entries)
                  ChoiceChip(
                    key: ValueKey('commission-view-${v.key}'),
                    label: Text(v.value),
                    selected: _view == v.key,
                    onSelected: (_) => setState(() => _view = v.key),
                  ),
              ],
            ),
          ),
          Expanded(child: switch (_view) {
            'reps' => _reps(canManage),
            'unassigned' => _unassigned(canManage),
            'payouts' => _payouts(),
            _ => _entries(),
          }),
        ],
      ),
    );
  }

  Widget _entries() {
    final async = ref.watch(commissionEntriesProvider);
    return AsyncStateView<List<Json>>(
      value: async,
      onRetry: () => ref.read(commissionEntriesProvider.notifier).reload(),
      isEmpty: (rows) => rows.isEmpty,
      emptyMessage: _arabic ? 'لا توجد عمولات بعد. اربط فاتورة بمندوب من تبويب «فواتير بلا مندوب».' : 'No commissions yet. Put an invoice under a rep from "Invoices without a rep".',
      data: (rows) => RecordsTable(
        rows: rows,
        columns: [
          ColumnSpec(_arabic ? 'المستند' : 'Document', value: (r) => text(r, 'invoiceNumber'), emphasise: true),
          ColumnSpec(_arabic ? 'التاريخ' : 'Date', value: (r) => text(r, 'documentDate')),
          ColumnSpec(_arabic ? 'المندوب' : 'Rep', value: (r) => _name(r, en: 'repEn', ar: 'repAr')),
          ColumnSpec(_arabic ? 'قبل الضريبة' : 'Before VAT', value: (r) => '${r['basis']}'),
          ColumnSpec(_arabic ? 'النسبة %' : 'Rate %', value: (r) => '${r['ratePercent']}'),
          ColumnSpec(
            _arabic ? 'العمولة' : 'Commission',
            value: (r) => '${r['amount']}',
            tone: (r) => text(r, 'kind') == 'RETURN' ? AppTone.warning : AppTone.neutral,
          ),
          ColumnSpec(
            _arabic ? 'الحالة' : 'Status',
            value: (r) => text(r, 'status') == 'PAID' ? (_arabic ? 'مصروفة' : 'Paid') : (_arabic ? 'مستحقة' : 'Due'),
            tone: (r) => text(r, 'status') == 'PAID' ? AppTone.success : AppTone.neutral,
          ),
        ],
        actions: (row) => [
          if ((ref.read(currentUserProvider)?.can('commissions.manage') ?? false) && text(row, 'status') == 'ACCRUED')
            IconButton(
              key: ValueKey('commission-remove-${text(row, 'id')}'),
              tooltip: _arabic ? 'إزالة من المندوب' : 'Take off the rep',
              icon: const Icon(Icons.link_off, size: 20),
              onPressed: () => _remove(row),
            ),
        ],
      ),
    );
  }

  Widget _reps(bool canManage) {
    final async = ref.watch(commissionRepsProvider);
    return AsyncStateView<List<Json>>(
      value: async,
      onRetry: () => ref.read(commissionRepsProvider.notifier).reload(),
      isEmpty: (rows) => rows.isEmpty,
      emptyMessage: _arabic ? 'لا يوجد مندوبون. أضف مندوبًا بنسبة عمولته.' : 'No reps yet. Add a rep with a commission rate.',
      data: (rows) => RecordsTable(
        rows: rows,
        columns: [
          ColumnSpec(_arabic ? 'المندوب' : 'Rep', value: _name, emphasise: true),
          ColumnSpec(_arabic ? 'النسبة %' : 'Rate %', value: (r) => '${r['ratePercent']}'),
          ColumnSpec(
            _arabic ? 'الحالة' : 'Status',
            value: (r) => r['active'] == false ? (_arabic ? 'متوقف' : 'Inactive') : (_arabic ? 'يعمل' : 'Active'),
            tone: (r) => r['active'] == false ? AppTone.neutral : AppTone.success,
          ),
        ],
        actions: (row) => [
          if (canManage)
            IconButton(
              key: ValueKey('rep-edit-${text(row, 'id')}'),
              tooltip: _arabic ? 'تعديل' : 'Edit',
              icon: const Icon(Icons.edit_outlined, size: 20),
              onPressed: () => _repForm(row),
            ),
        ],
      ),
    );
  }

  Widget _unassigned(bool canManage) {
    final async = ref.watch(commissionUnassignedProvider);
    return AsyncStateView<List<Json>>(
      value: async,
      onRetry: () => ref.read(commissionUnassignedProvider.notifier).reload(),
      isEmpty: (rows) => rows.isEmpty,
      emptyMessage: _arabic ? 'كل المستندات المرحّلة لها مندوب.' : 'Every posted document has a rep.',
      data: (rows) => RecordsTable(
        rows: rows,
        columns: [
          ColumnSpec(_arabic ? 'المستند' : 'Document', value: (r) => text(r, 'invoiceNumber'), emphasise: true),
          ColumnSpec(_arabic ? 'النوع' : 'Type', value: (r) => text(r, 'documentType') == 'CREDIT_NOTE' ? (_arabic ? 'إشعار دائن' : 'Credit note') : (_arabic ? 'فاتورة' : 'Invoice')),
          ColumnSpec(_arabic ? 'التاريخ' : 'Date', value: (r) => text(r, 'invoiceDate')),
          ColumnSpec(_arabic ? 'العميل' : 'Customer', value: (r) => _name(r, en: 'customerEn', ar: 'customerAr')),
          ColumnSpec(_arabic ? 'قبل الضريبة' : 'Before VAT', value: (r) => '${r['basis']}'),
        ],
        actions: (row) => [
          if (canManage)
            IconButton(
              key: ValueKey('commission-assign-${text(row, 'id')}'),
              tooltip: text(row, 'documentType') == 'CREDIT_NOTE' ? (_arabic ? 'خصم من مندوب الفاتورة' : 'Take back from the invoice rep') : (_arabic ? 'ربط بمندوب' : 'Put under a rep'),
              icon: const Icon(Icons.person_add_alt_outlined, size: 20),
              onPressed: () => _assign(row),
            ),
        ],
      ),
    );
  }

  Widget _payouts() {
    final async = ref.watch(commissionPayoutsProvider);
    return AsyncStateView<List<Json>>(
      value: async,
      onRetry: () => ref.read(commissionPayoutsProvider.notifier).reload(),
      isEmpty: (rows) => rows.isEmpty,
      emptyMessage: _arabic ? 'لم تُصرف عمولات بعد.' : 'Nothing has been paid out yet.',
      data: (rows) => RecordsTable(
        rows: rows,
        columns: [
          ColumnSpec(_arabic ? 'المندوب' : 'Rep', value: (r) => _name(r, en: 'repEn', ar: 'repAr'), emphasise: true),
          ColumnSpec(_arabic ? 'من' : 'From', value: (r) => text(r, 'from')),
          ColumnSpec(_arabic ? 'إلى' : 'To', value: (r) => text(r, 'to')),
          ColumnSpec(_arabic ? 'المبلغ' : 'Amount', value: (r) => '${r['amount']}'),
          ColumnSpec(_arabic ? 'عدد المستندات' : 'Documents', value: (r) => '${r['entryCount']}'),
          ColumnSpec(_arabic ? 'ملاحظة' : 'Note', value: (r) => text(r, 'note')),
        ],
      ),
    );
  }

  Future<void> _repForm(Json? rep) async {
    final editing = rep != null;
    final saved = await showFormSheet(
      context,
      title: editing ? (_arabic ? 'تعديل المندوب' : 'Edit the rep') : (_arabic ? 'مندوب جديد' : 'New rep'),
      submitLabel: _arabic ? 'حفظ' : 'Save',
      initial: rep == null
          ? const <String, dynamic>{}
          : <String, dynamic>{'nameEn': text(rep, 'nameEn'), 'nameAr': text(rep, 'nameAr'), 'ratePercent': '${rep['ratePercent']}', 'active': rep['active'] != false},
      fields: [
        FieldSpec('nameEn', _arabic ? 'الاسم بالإنجليزية' : 'Name in English', required: true, maxLength: 120),
        FieldSpec('nameAr', _arabic ? 'الاسم بالعربية' : 'Name in Arabic', required: true, maxLength: 120),
        FieldSpec(
          'ratePercent',
          _arabic ? 'نسبة العمولة %' : 'Commission rate %',
          kind: FieldKind.decimal,
          required: true,
          helper: _arabic
              ? 'من 0 إلى 100. التغيير يسري على المستندات التي تُربط بعده فقط.'
              : 'From 0 to 100. A change applies only to documents put under the rep afterwards.',
        ),
        if (editing) FieldSpec('active', _arabic ? 'يعمل' : 'Active', kind: FieldKind.toggle),
      ],
      onSubmit: (values) async {
        final body = {
          'nameEn': text(values, 'nameEn').trim(),
          'nameAr': text(values, 'nameAr').trim(),
          'ratePercent': text(values, 'ratePercent').trim(),
          if (editing) 'active': values['active'] == true,
        };
        final api = ref.read(apiClientProvider);
        if (rep != null) {
          await api.put('/commissions/reps/${text(rep, 'id')}', body: body);
        } else {
          await api.post('/commissions/reps', body: body);
        }
      },
    );
    if (saved != null && mounted) {
      showMessage(context, _arabic ? 'تم الحفظ.' : 'Saved.');
      ref.invalidate(commissionRepsProvider);
    }
  }

  Future<List<FieldOption>> _repOptions({bool activeOnly = true}) async {
    final reps = await ref.read(apiClientProvider).getList('/commissions/reps');
    return [
      for (final r in reps)
        if (!activeOnly || r['active'] != false) FieldOption(text(r, 'id'), '${_name(r)}  (${r['ratePercent']}%)'),
    ];
  }

  Future<void> _assign(Json row) async {
    final isReturn = text(row, 'documentType') == 'CREDIT_NOTE';
    if (isReturn) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(_arabic ? 'خصم عمولة المرتجع؟' : 'Take back the commission?'),
          content: Text(_arabic
              ? 'تُخصم عمولة ${text(row, 'invoiceNumber')} من مندوب الفاتورة الأصلية وبنسبته وقت البيع.'
              : 'The commission on ${text(row, 'invoiceNumber')} is taken back from the original invoice rep at the rate used then.'),
          actions: [
            TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: Text(_arabic ? 'إلغاء' : 'Cancel')),
            FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: Text(_arabic ? 'تأكيد' : 'Confirm')),
          ],
        ),
      );
      if (ok != true || !mounted) return;
      try {
        await ref.read(apiClientProvider).post('/commissions/assign', body: {'salesInvoiceId': text(row, 'id')});
        if (!mounted) return;
        showMessage(context, _arabic ? 'تم خصم العمولة.' : 'The commission was taken back.');
        ref.invalidate(commissionEntriesProvider);
        ref.invalidate(commissionUnassignedProvider);
      } catch (error) {
        if (mounted) showMessage(context, error, error: true);
      }
      return;
    }
    List<FieldOption> reps;
    try {
      reps = await _repOptions();
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
      return;
    }
    if (reps.isEmpty) {
      if (mounted) showMessage(context, _arabic ? 'أضف مندوبًا أولًا من تبويب «المندوبون».' : 'Add a rep first, in the "Reps" view.', error: true);
      return;
    }
    if (!mounted) return;
    final saved = await showFormSheet(
      context,
      title: _arabic ? 'ربط ${text(row, 'invoiceNumber')} بمندوب' : 'Put ${text(row, 'invoiceNumber')} under a rep',
      submitLabel: _arabic ? 'تأكيد' : 'Confirm',
      fields: [FieldSpec('repId', _arabic ? 'المندوب' : 'Rep', kind: FieldKind.select, required: true, options: reps)],
      onSubmit: (values) async {
        await ref.read(apiClientProvider).post('/commissions/assign', body: {'salesInvoiceId': text(row, 'id'), 'repId': text(values, 'repId')});
      },
    );
    if (saved != null && mounted) {
      showMessage(context, _arabic ? 'تم تسجيل العمولة.' : 'The commission was recorded.');
      ref.invalidate(commissionEntriesProvider);
      ref.invalidate(commissionUnassignedProvider);
    }
  }

  Future<void> _remove(Json row) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_arabic ? 'إزالة العمولة؟' : 'Take this commission off?'),
        content: Text(_arabic ? 'يعود المستند ${text(row, 'invoiceNumber')} إلى «فواتير بلا مندوب».' : '${text(row, 'invoiceNumber')} goes back to "Invoices without a rep".'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: Text(_arabic ? 'إلغاء' : 'Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: Text(_arabic ? 'إزالة' : 'Take off')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await ref.read(apiClientProvider).delete('/commissions/entries/${text(row, 'id')}');
      if (!mounted) return;
      showMessage(context, _arabic ? 'تمت الإزالة.' : 'Taken off.');
      ref.invalidate(commissionEntriesProvider);
      ref.invalidate(commissionUnassignedProvider);
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
    }
  }

  Future<void> _payout() async {
    List<FieldOption> reps;
    try {
      reps = await _repOptions(activeOnly: false);
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
      return;
    }
    if (!mounted) return;
    List<Json> accounts;
    try {
      accounts = await ref.read(apiClientProvider).getList('/accounting/chart-of-accounts');
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
      return;
    }
    if (!mounted) return;
    List<FieldOption> accountOptions(Set<String> types) => [
          for (final a in accounts)
            if (flag(a, 'isPostable') && flag(a, 'isActive') && types.contains(text(a, 'type')))
              FieldOption(text(a, 'id'), '${text(a, 'code')} — ${_arabic ? text(a, 'nameAr') : text(a, 'nameEn')}'),
        ];
    final entries = ref.read(commissionEntriesProvider).value ?? const <Json>[];
    final saved = await showFormSheet(
      context,
      title: _arabic ? 'صرف عمولة مندوب' : 'Pay out a rep',
      submitLabel: _arabic ? 'صرف' : 'Pay out',
      fields: [
        FieldSpec('repId', _arabic ? 'المندوب' : 'Rep', kind: FieldKind.select, required: true, options: reps),
        FieldSpec('from', _arabic ? 'من تاريخ' : 'From', kind: FieldKind.date, required: true),
        FieldSpec(
          'to',
          _arabic ? 'إلى تاريخ' : 'To',
          kind: FieldKind.date,
          required: true,
          helper: _arabic
              ? 'تُصرف كل العمولات المستحقة في الفترة، بعد خصم المرتجعات. المستحق الآن: ${piastersText(unpaidNetPiasters(entries))}. يُسجَّل قيد يومية تلقائيًا بتاريخ اليوم.'
              : 'Pays every due commission in the period, net of returns. Due now: ${piastersText(unpaidNetPiasters(entries))}. A journal entry is posted automatically, dated today.',
        ),
        FieldSpec('expenseAccountId', _arabic ? 'حساب مصروف العمولات (مدين)' : 'Commission expense account (debit)',
            kind: FieldKind.select, required: true, options: accountOptions({'EXPENSE'})),
        FieldSpec('fundingAccountId', _arabic ? 'حساب الصرف: صندوق أو بنك أو دائنون (دائن)' : 'Paid from: cash, bank or payable (credit)',
            kind: FieldKind.select, required: true, options: accountOptions({'ASSET', 'LIABILITY'})),
        FieldSpec('note', _arabic ? 'ملاحظة' : 'Note', maxLength: 240),
      ],
      onSubmit: (values) async {
        await ref.read(apiClientProvider).post('/commissions/payouts', body: {
          'repId': text(values, 'repId'),
          'from': text(values, 'from'),
          'to': text(values, 'to'),
          'expenseAccountId': text(values, 'expenseAccountId'),
          'fundingAccountId': text(values, 'fundingAccountId'),
          if (text(values, 'note').trim().isNotEmpty) 'note': text(values, 'note').trim(),
        });
      },
    );
    if (saved != null && mounted) {
      showMessage(context, _arabic ? 'تم تسجيل الصرف.' : 'The payout was recorded.');
      _reloadAll();
    }
  }
}
