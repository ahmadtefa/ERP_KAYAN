import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../../core/json/amount_format.dart';

import '../../../app/theme/design_tokens.dart';
import '../../../core/json/json_utils.dart';
import '../../../shared/widgets/form_sheet.dart';
import '../../../shared/widgets/records_table.dart';
import '../../../shared/widgets/state_views.dart';
import '../../auth/presentation/providers/auth_providers.dart';
import '../../common/presentation/providers/resource_providers.dart';
import '../../common/presentation/screens/module_scaffold.dart';

/// Customer installment plans: each plan splits one posted sales invoice into
/// dated installments. Customers pay the invoice as usual; what they have paid
/// is spread over the installments oldest first, so nothing is entered twice.
final installmentPlansProvider = AsyncNotifierProvider<InstallmentPlansController, List<Json>>(InstallmentPlansController.new);
final installmentOverdueProvider = AsyncNotifierProvider<InstallmentOverdueController, List<Json>>(InstallmentOverdueController.new);

class InstallmentPlansController extends JsonListController {
  @override
  String get resourcePath => '/installments/plans';
}

class InstallmentOverdueController extends JsonListController {
  @override
  String get resourcePath => '/installments/overdue';
}

/// The state of one installment as a word, in the screen's language.
String installmentStatusText(String status, {required bool arabic}) => switch (status) {
  'PAID' => arabic ? 'مسدد' : 'Paid',
  'PARTIAL' => arabic ? 'مسدد جزئيًا' : 'Part paid',
  'OVERDUE' => arabic ? 'متأخر' : 'Overdue',
  _ => arabic ? 'لم يحن موعده' : 'Not due yet',
};

/// A date the way a reader says it: 3 فبراير 2026, or 3 February 2026.
String _dateLabel(BuildContext context, String raw) {
  final parsed = DateTime.tryParse(raw);
  if (parsed == null) return raw;
  return DateFormat.yMMMMd(
    Localizations.localeOf(context).toLanguageTag(),
  ).format(parsed);
}

class InstallmentsScreen extends ConsumerStatefulWidget {
  const InstallmentsScreen({super.key});

  @override
  ConsumerState<InstallmentsScreen> createState() => _InstallmentsScreenState();
}

class _InstallmentsScreenState extends ConsumerState<InstallmentsScreen> {
  String _view = 'plans';

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String _customer(Json r) => _arabic ? text(r, 'customerAr', fallback: text(r, 'customerEn')) : text(r, 'customerEn', fallback: text(r, 'customerAr'));

  void _reloadAll() {
    ref.invalidate(installmentPlansProvider);
    ref.invalidate(installmentOverdueProvider);
  }

  @override
  Widget build(BuildContext context) {
    final canManage = ref.watch(currentUserProvider)?.can('installments.manage') ?? false;
    return ModuleScaffold(
      title: _arabic ? 'أقساط العملاء' : 'Customer installments',
      eyebrow: _arabic ? 'المبيعات' : 'Sales',
      trailing: Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          if (canManage)
            FilledButton.icon(
              key: const ValueKey('installment-new'),
              onPressed: () => _planForm(null),
              icon: const Icon(Icons.add, size: 18),
              label: Text(_arabic ? 'خطة تقسيط جديدة' : 'New installment plan'),
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
                ChoiceChip(
                  key: const ValueKey('installment-view-plans'),
                  label: Text(_arabic ? 'كل الخطط' : 'All plans'),
                  selected: _view == 'plans',
                  onSelected: (_) => setState(() => _view = 'plans'),
                ),
                ChoiceChip(
                  key: const ValueKey('installment-view-overdue'),
                  label: Text(_arabic ? 'الأقساط المتأخرة' : 'Overdue installments'),
                  selected: _view == 'overdue',
                  onSelected: (_) => setState(() => _view = 'overdue'),
                ),
              ],
            ),
          ),
          Expanded(child: _view == 'overdue' ? _overdue() : _plans(canManage)),
        ],
      ),
    );
  }

  Widget _plans(bool canManage) {
    final async = ref.watch(installmentPlansProvider);
    return AsyncStateView<List<Json>>(
      value: async,
      onRetry: () => ref.read(installmentPlansProvider.notifier).reload(),
      isEmpty: (rows) => rows.isEmpty,
      emptyMessage: _arabic
          ? 'لا توجد خطط تقسيط. اضغط «خطة تقسيط جديدة» لتقسيط فاتورة بيع مرحّلة.'
          : 'No installment plans yet. Press "New installment plan" to split a posted sales invoice.',
      data: (rows) => RecordsTable(
        rows: rows,
        columns: [
          ColumnSpec(_arabic ? 'الفاتورة' : 'Invoice', value: (r) => text(r, 'invoiceNumber'), emphasise: true),
          ColumnSpec(_arabic ? 'العميل' : 'Customer', value: _customer),
          ColumnSpec(_arabic ? 'الإجمالي' : 'Total', value: (r) => formatAmount(asString(r['total']))),
          ColumnSpec(_arabic ? 'المسدد' : 'Paid', value: (r) => formatAmount(asString(r['paid']))),
          ColumnSpec(
            _arabic ? 'القسط القادم' : 'Next due',
            value: (r) {
              final next = text(r, 'nextDue');
              return next.isEmpty
                  ? (_arabic ? 'سُدد بالكامل' : 'All paid')
                  : _dateLabel(context, next);
            },
          ),
          ColumnSpec(
            _arabic ? 'المتأخر' : 'Overdue',
            value: (r) => formatAmount(asString(r['overdueAmount'])),
            tone: (r) => (r['overdueCount'] is num && (r['overdueCount'] as num) > 0) ? AppTone.warning : AppTone.neutral,
          ),
        ],
        actions: (row) => [
          IconButton(
            key: ValueKey('installment-view-${text(row, 'invoiceId')}'),
            tooltip: _arabic ? 'عرض الجدول' : 'View the schedule',
            icon: const Icon(Icons.table_rows_outlined, size: 20),
            onPressed: () => _schedule(row),
          ),
          if (canManage)
            IconButton(
              key: ValueKey('installment-edit-${text(row, 'invoiceId')}'),
              tooltip: _arabic ? 'تغيير الخطة' : 'Change the plan',
              icon: const Icon(Icons.edit_outlined, size: 20),
              onPressed: () => _planForm(row),
            ),
          if (canManage)
            IconButton(
              key: ValueKey('installment-remove-${text(row, 'invoiceId')}'),
              tooltip: _arabic ? 'إلغاء الخطة' : 'Remove the plan',
              icon: const Icon(Icons.delete_outline, size: 20),
              onPressed: () => _remove(row),
            ),
        ],
      ),
    );
  }

  Widget _overdue() {
    final async = ref.watch(installmentOverdueProvider);
    return AsyncStateView<List<Json>>(
      value: async,
      onRetry: () => ref.read(installmentOverdueProvider.notifier).reload(),
      isEmpty: (rows) => rows.isEmpty,
      emptyMessage: _arabic ? 'لا توجد أقساط متأخرة.' : 'No installment is overdue.',
      data: (rows) => RecordsTable(
        rows: rows,
        columns: [
          ColumnSpec(_arabic ? 'الفاتورة' : 'Invoice', value: (r) => text(r, 'invoiceNumber'), emphasise: true),
          ColumnSpec(_arabic ? 'العميل' : 'Customer', value: _customer),
          ColumnSpec(_arabic ? 'القسط رقم' : 'Installment no.', value: (r) => '${r['no']}'),
          ColumnSpec(_arabic ? 'تاريخ الاستحقاق' : 'Due date', value: (r) => _dateLabel(context, text(r, 'dueDate'))),
          ColumnSpec(_arabic ? 'المتبقي' : 'Remaining', value: (r) => formatAmount(asString(r['remaining'])), tone: (r) => AppTone.warning),
          ColumnSpec(_arabic ? 'أيام التأخير' : 'Days late', value: (r) => '${r['daysLate']}'),
        ],
      ),
    );
  }

  Future<void> _schedule(Json plan) async {
    final items = (plan['items'] is List) ? (plan['items'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList() : <Json>[];
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('${_arabic ? 'جدول أقساط الفاتورة' : 'Installments of invoice'} ${text(plan, 'invoiceNumber')}'),
        content: SizedBox(
          width: 560,
          child: SingleChildScrollView(
            child: DataTable(
              key: const ValueKey('installment-schedule'),
              columns: [
                DataColumn(label: Text(_arabic ? 'رقم' : 'No.')),
                DataColumn(label: Text(_arabic ? 'الاستحقاق' : 'Due')),
                DataColumn(label: Text(_arabic ? 'المبلغ' : 'Amount')),
                DataColumn(label: Text(_arabic ? 'المسدد' : 'Paid')),
                DataColumn(label: Text(_arabic ? 'الحالة' : 'Status')),
              ],
              rows: [
                for (final i in items)
                  DataRow(cells: [
                    DataCell(Text('${i['no']}${i['isDownPayment'] == true ? (_arabic ? ' (مقدم)' : ' (down)') : ''}')),
                    DataCell(Text(text(i, 'dueDate'))),
                    DataCell(Text('${i['amount']}')),
                    DataCell(Text('${i['paid']}')),
                    DataCell(Text(installmentStatusText(text(i, 'status'), arabic: _arabic))),
                  ]),
              ],
            ),
          ),
        ),
        actions: [TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: Text(_arabic ? 'إغلاق' : 'Close'))],
      ),
    );
  }

  Future<void> _planForm(Json? plan) async {
    final editing = plan != null;
    List<Json> invoices = const [];
    if (!editing) {
      try {
        invoices = await ref.read(apiClientProvider).getList('/sales/invoices');
      } catch (error) {
        if (mounted) showMessage(context, error, error: true);
        return;
      }
      if (!mounted) return;
    }
    final saved = await showFormSheet(
      context,
      title: editing ? (_arabic ? 'تغيير خطة التقسيط' : 'Change the installment plan') : (_arabic ? 'خطة تقسيط جديدة' : 'New installment plan'),
      submitLabel: _arabic ? 'حفظ' : 'Save',
      initial: <String, dynamic>{
        if (editing) 'downPayment': '${plan['downPayment']}',
        if (editing) 'count': '${plan['count']}',
        'intervalMonths': editing ? '${plan['intervalMonths']}' : '1',
        if (editing) 'firstDue': text(plan, 'firstDue'),
      },
      fields: [
        if (!editing)
          FieldSpec(
            'invoiceId',
            _arabic ? 'فاتورة البيع (مرحّلة)' : 'Sales invoice (posted)',
            kind: FieldKind.select,
            required: true,
            searchable: true,
            options: [
              for (final i in invoices)
                if (text(i, 'status').toUpperCase() == 'POSTED' && text(i, 'documentType', fallback: 'INVOICE') == 'INVOICE')
                  FieldOption(text(i, 'id'), '${text(i, 'invoiceNumber')}  ${text(i, 'invoiceDate')}'),
            ],
          ),
        FieldSpec(
          'downPayment',
          _arabic ? 'الدفعة المقدمة (اختياري)' : 'Down payment (optional)',
          kind: FieldKind.decimal,
          helper: _arabic ? 'تستحق في تاريخ الفاتورة. اتركها فارغة إن لم توجد.' : 'Due on the invoice date. Leave empty if there is none.',
        ),
        FieldSpec(
          'count',
          _arabic ? 'عدد الأقساط (من 2 إلى 120)' : 'Number of installments (2 to 120)',
          kind: FieldKind.integer,
          required: true,
          minInteger: 2,
          maxInteger: 120,
        ),
        FieldSpec(
          'intervalMonths',
          _arabic ? 'الفاصل بين الأقساط بالشهور (1 إلى 12)' : 'Months between installments (1 to 12)',
          kind: FieldKind.integer,
          required: true,
          minInteger: 1,
          maxInteger: 12,
        ),
        FieldSpec(
          'firstDue',
          _arabic ? 'تاريخ أول قسط' : 'Date of the first installment',
          kind: FieldKind.date,
          required: true,
          helper: _arabic ? 'لا يسبق تاريخ الفاتورة. ما يبقى من القرش الأخير يُضاف للقسط الأخير.' : 'Not before the invoice date. Any odd piasters go on the last installment.',
        ),
      ],
      onSubmit: (values) async {
        final invoiceId = editing ? text(plan, 'invoiceId') : text(values, 'invoiceId');
        final down = text(values, 'downPayment').trim();
        await ref.read(apiClientProvider).put('/installments/invoices/$invoiceId', body: {
          if (down.isNotEmpty) 'downPayment': down,
          'count': int.tryParse(text(values, 'count').trim()) ?? 0,
          'intervalMonths': int.tryParse(text(values, 'intervalMonths').trim()) ?? 1,
          'firstDue': text(values, 'firstDue').trim(),
        });
      },
    );
    if (saved != null && mounted) {
      showMessage(context, _arabic ? 'تم حفظ خطة التقسيط.' : 'The installment plan was saved.');
      _reloadAll();
    }
  }

  Future<void> _remove(Json plan) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_arabic ? 'إلغاء خطة التقسيط؟' : 'Remove the installment plan?'),
        content: Text(_arabic
            ? 'تُلغى خطة الفاتورة ${text(plan, 'invoiceNumber')} فقط. الفاتورة والمدفوعات عليها لا تتغير.'
            : 'Only the plan of invoice ${text(plan, 'invoiceNumber')} is removed. The invoice and its payments do not change.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: Text(_arabic ? 'إلغاء' : 'Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: Text(_arabic ? 'إلغاء الخطة' : 'Remove the plan')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(apiClientProvider).delete('/installments/invoices/${text(plan, 'invoiceId')}');
      if (mounted) {
        showMessage(context, _arabic ? 'تم إلغاء الخطة.' : 'The plan was removed.');
        _reloadAll();
      }
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
    }
  }
}
