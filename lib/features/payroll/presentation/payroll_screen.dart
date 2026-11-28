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

/// Payroll and HR: monthly runs, the employee file, monthly attendance, loans
/// and the insurance and tax figures the company types in.
final payrollRunsProvider = AsyncNotifierProvider<PayrollRunsController, List<Json>>(PayrollRunsController.new);
final payrollEmployeesProvider = AsyncNotifierProvider<PayrollEmployeesController, List<Json>>(PayrollEmployeesController.new);
final payrollLoansProvider = AsyncNotifierProvider<PayrollLoansController, List<Json>>(PayrollLoansController.new);
final payrollSettingsProvider = AsyncNotifierProvider<PayrollSettingsController, List<Json>>(PayrollSettingsController.new);

class PayrollRunsController extends JsonListController {
  @override
  String get resourcePath => '/hr/payroll/runs';
}

class PayrollEmployeesController extends JsonListController {
  @override
  String get resourcePath => '/hr/employees';
}

class PayrollLoansController extends JsonListController {
  @override
  String get resourcePath => '/hr/loans';
}

class PayrollSettingsController extends JsonListController {
  @override
  String get resourcePath => '/hr/settings';
}

/// Turns lines like "بدل انتقال, 300" or "نقابة, 50, 0, 1" into salary items.
/// The optional third and fourth columns say whether insurance and tax apply (1 or 0).
List<Map<String, dynamic>>? parsePayItems(String kind, String input) {
  final out = <Map<String, dynamic>>[];
  for (final raw in input.split('\n')) {
    final line = raw.trim();
    if (line.isEmpty) continue;
    final parts = line.split(RegExp('[,،]')).map((p) => p.trim()).toList();
    if (parts.length < 2 || parts.length > 4 || parts[0].isEmpty) return null;
    if (double.tryParse(parts[1]) == null) return null;
    bool flagAt(int i) => parts.length <= i || parts[i] != '0';
    out.add({'kind': kind, 'nameAr': parts[0], 'amount': parts[1], 'subjectToSI': flagAt(2), 'subjectToTax': flagAt(3)});
  }
  return out;
}

/// Turns lines like "0, 40000, 0" and "40000, , 10" into tax brackets: from, to (empty for the last), percent.
List<Map<String, dynamic>>? parseBrackets(String input) {
  final out = <Map<String, dynamic>>[];
  for (final raw in input.split('\n')) {
    final line = raw.trim();
    if (line.isEmpty) continue;
    final parts = line.split(RegExp('[,،]')).map((p) => p.trim()).toList();
    if (parts.length != 3 || double.tryParse(parts[0]) == null || double.tryParse(parts[2]) == null) return null;
    if (parts[1].isNotEmpty && double.tryParse(parts[1]) == null) return null;
    out.add({'from': parts[0], 'to': parts[1].isEmpty ? null : parts[1], 'ratePercent': parts[2]});
  }
  return out;
}

class PayrollScreen extends ConsumerStatefulWidget {
  const PayrollScreen({super.key});

  @override
  ConsumerState<PayrollScreen> createState() => _PayrollScreenState();
}

class _PayrollScreenState extends ConsumerState<PayrollScreen> {
  String? _view;
  String _attendanceMonth = '';

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  bool _can(String code) => ref.read(currentUserProvider)?.can(code) ?? false;

  String _status(String s) => switch (s) {
        'DRAFT' => _arabic ? 'مسودة' : 'Draft',
        'CALCULATED' => _arabic ? 'محسوب' : 'Calculated',
        'APPROVED' => _arabic ? 'معتمد' : 'Approved',
        'POSTED' => _arabic ? 'مرحَّل' : 'Posted',
        'PAID' => _arabic ? 'مدفوع' : 'Paid',
        'OPEN' => _arabic ? 'مفتوحة' : 'Open',
        'SETTLED' => _arabic ? 'مسددة' : 'Settled',
        'ACTIVE' => _arabic ? 'على رأس العمل' : 'Employed',
        'LEFT' => _arabic ? 'غادر' : 'Left',
        _ => s,
      };

  void _reloadAll() {
    ref.invalidate(payrollRunsProvider);
    ref.invalidate(payrollEmployeesProvider);
    ref.invalidate(payrollLoansProvider);
    ref.invalidate(payrollSettingsProvider);
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(currentUserProvider);
    final views = <String, String>{
      if (_can('payroll.run.read')) 'runs': _arabic ? 'مسيّرات الرواتب' : 'Payroll runs',
      if (_can('hr.employee.read')) 'employees': _arabic ? 'الموظفون' : 'Employees',
      if (_can('hr.attendance.read')) 'attendance': _arabic ? 'الحضور' : 'Attendance',
      if (_can('hr.loan.read')) 'loans': _arabic ? 'السلف' : 'Loans',
      if (_can('payroll.settings.read')) 'settings': _arabic ? 'إعدادات التأمينات والضريبة' : 'Insurance and tax settings',
    };
    final view = views.containsKey(_view) ? _view! : (views.isEmpty ? '' : views.keys.first);
    return ModuleScaffold(
      title: _arabic ? 'الرواتب وشؤون العاملين' : 'Payroll and HR',
      eyebrow: _arabic ? 'الموارد البشرية' : 'Human resources',
      trailing: Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          if (view == 'runs' && _can('payroll.run.create'))
            FilledButton.icon(
              onPressed: _newRun,
              icon: const Icon(Icons.add, size: 18),
              label: Text(_arabic ? 'مسيّر شهر جديد' : 'New monthly run'),
            ),
          if (view == 'employees' && _can('hr.employee.manage'))
            FilledButton.icon(
              onPressed: () => _employeeForm(null),
              icon: const Icon(Icons.add, size: 18),
              label: Text(_arabic ? 'موظف جديد' : 'New employee'),
            ),
          if (view == 'loans' && _can('hr.loan.manage'))
            FilledButton.icon(
              onPressed: _newLoan,
              icon: const Icon(Icons.add, size: 18),
              label: Text(_arabic ? 'سلفة جديدة' : 'New loan'),
            ),
          if (view == 'settings' && _can('payroll.settings.manage')) ...[
            OutlinedButton(onPressed: _accountsForm, child: Text(_arabic ? 'حسابات الرواتب' : 'Payroll accounts')),
            FilledButton.icon(
              onPressed: _settingsForm,
              icon: const Icon(Icons.add, size: 18),
              label: Text(_arabic ? 'مقادير جديدة' : 'New figures'),
            ),
          ],
          IconButton(tooltip: _arabic ? 'تحديث' : 'Refresh', icon: const Icon(Icons.refresh), onPressed: _reloadAll),
        ],
      ),
      body: views.isEmpty
          ? Center(child: Text(_arabic ? 'ليست لديك صلاحية على أي قسم من الرواتب.' : 'You do not have permission for any payroll section.'))
          : Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final v in views.entries)
                        ChoiceChip(
                          key: ValueKey('payroll-view-${v.key}'),
                          label: Text(v.value),
                          selected: view == v.key,
                          onSelected: (_) => setState(() => _view = v.key),
                        ),
                    ],
                  ),
                ),
                Expanded(child: switch (view) {
                  'employees' => _employees(),
                  'attendance' => _attendance(),
                  'loans' => _loans(),
                  'settings' => _settings(),
                  _ => _runs(),
                }),
              ],
            ),
    );
  }

  // ---- runs ----

  Widget _runs() {
    final async = ref.watch(payrollRunsProvider);
    return AsyncStateView<List<Json>>(
      value: async,
      onRetry: () => ref.read(payrollRunsProvider.notifier).reload(),
      isEmpty: (rows) => rows.isEmpty,
      emptyMessage: _arabic ? 'لا توجد مسيّرات رواتب بعد. أدخل الحضور الشهري ثم أنشئ مسيّر الشهر.' : 'No payroll runs yet. Enter the monthly attendance, then create the month\'s run.',
      data: (rows) => RecordsTable(
        rows: rows,
        columns: [
          ColumnSpec(_arabic ? 'الشهر' : 'Month', value: (r) => text(r, 'month'), emphasise: true),
          ColumnSpec(_arabic ? 'الحالة' : 'Status', value: (r) => _status(text(r, 'status')), tone: (r) => text(r, 'status') == 'PAID' ? AppTone.success : AppTone.neutral),
          ColumnSpec(_arabic ? 'إجمالي المستحق' : 'Total gross', value: (r) => text(r, 'totalGross')),
          ColumnSpec(_arabic ? 'صافي المدفوع' : 'Total net', value: (r) => text(r, 'totalNet')),
        ],
        actions: (row) => [
          IconButton(
            key: ValueKey('payroll-open-${text(row, 'id')}'),
            tooltip: _arabic ? 'فتح المسيّر' : 'Open the run',
            icon: const Icon(Icons.open_in_new, size: 20),
            onPressed: () => _openRun(text(row, 'id')),
          ),
        ],
      ),
    );
  }

  Future<void> _newRun() async {
    final now = DateTime.now();
    final prev = DateTime(now.year, now.month - 1);
    final saved = await showFormSheet(
      context,
      title: _arabic ? 'مسيّر شهر جديد' : 'New monthly run',
      submitLabel: _arabic ? 'إنشاء واحتساب' : 'Create and calculate',
      initial: {'month': '${prev.year}-${prev.month.toString().padLeft(2, '0')}'},
      fields: [
        FieldSpec(
          'month',
          _arabic ? 'الشهر (سنة-شهر، مثل 2026-03)' : 'Month (year-month, like 2026-03)',
          required: true,
          helper: _arabic
              ? 'يلزم أن تكون مقادير التأمينات والضريبة معتمدة والحضور مُدخلًا لكل موظف.'
              : 'The insurance and tax figures must be confirmed and attendance entered for every employee.',
        ),
      ],
      onSubmit: (values) async {
        await ref.read(apiClientProvider).post('/hr/payroll/runs', body: {'month': text(values, 'month').trim()});
      },
    );
    if (saved != null && mounted) {
      showMessage(context, _arabic ? 'تم إنشاء المسيّر واحتسابه.' : 'The run was created and calculated.');
      ref.invalidate(payrollRunsProvider);
      ref.invalidate(payrollLoansProvider);
    }
  }

  Future<void> _openRun(String id) async {
    Json run;
    try {
      run = await ref.read(apiClientProvider).getObject('/hr/payroll/runs/$id');
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
      return;
    }
    if (!mounted) return;
    final status = text(run, 'status');
    final lines = (run['lines'] is List) ? (run['lines'] as List).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : <Json>[];
    final action = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_arabic ? 'مسيّر ${text(run, 'month')} (${_status(status)})' : 'Run ${text(run, 'month')} (${_status(status)})'),
        content: SizedBox(
          width: 620,
          height: 420,
          child: ListView(
            children: [
              Text(_arabic ? 'إجمالي المستحق ${text(run, 'totalGross')}، وصافي المدفوع ${text(run, 'totalNet')}.' : 'Total gross ${text(run, 'totalGross')}, total net ${text(run, 'totalNet')}.'),
              const SizedBox(height: 8),
              for (final l in lines)
                ListTile(
                  dense: true,
                  title: Text('${text(l, 'code')}  ${text(l, 'nameAr')}'),
                  subtitle: Text(_arabic
                      ? 'مستحق ${text(l, 'gross')}، تأمينات ${text(l, 'employeeSI')}، ضريبة ${text(l, 'tax')}، استقطاعات ${text(l, 'deductions')}، قسط سلفة ${text(l, 'loanInstalment')}'
                      : 'Gross ${text(l, 'gross')}, insurance ${text(l, 'employeeSI')}, tax ${text(l, 'tax')}, deductions ${text(l, 'deductions')}, loan ${text(l, 'loanInstalment')}'),
                  trailing: Text(text(l, 'net'), style: const TextStyle(fontWeight: FontWeight.w700)),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: Text(_arabic ? 'إغلاق' : 'Close')),
          if ((status == 'DRAFT' || status == 'CALCULATED') && _can('payroll.run.create'))
            OutlinedButton(onPressed: () => Navigator.of(dialogContext).pop('recalculate'), child: Text(_arabic ? 'إعادة الاحتساب' : 'Recalculate')),
          if (status == 'CALCULATED' && _can('payroll.run.approve'))
            FilledButton(onPressed: () => Navigator.of(dialogContext).pop('approve'), child: Text(_arabic ? 'اعتماد' : 'Approve')),
          if (status == 'APPROVED' && _can('payroll.run.post'))
            FilledButton(onPressed: () => Navigator.of(dialogContext).pop('post'), child: Text(_arabic ? 'ترحيل للحسابات' : 'Post to the ledger')),
          if (status == 'POSTED' && _can('payroll.run.post'))
            OutlinedButton(onPressed: () => Navigator.of(dialogContext).pop('reverse'), child: Text(_arabic ? 'عكس الترحيل' : 'Reverse the posting')),
          if (status == 'POSTED' && _can('payroll.run.pay'))
            FilledButton(onPressed: () => Navigator.of(dialogContext).pop('pay'), child: Text(_arabic ? 'صرف الرواتب' : 'Pay the salaries')),
        ],
      ),
    );
    if (action == null || !mounted) return;
    if (action == 'pay') {
      await _payRun(id);
      return;
    }
    if (action == 'reverse' || action == 'post') {
      final ok = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(action == 'post' ? (_arabic ? 'ترحيل المسيّر؟' : 'Post this run?') : (_arabic ? 'عكس ترحيل المسيّر؟' : 'Reverse this posting?')),
          content: Text(action == 'post'
              ? (_arabic ? 'يُسجَّل قيد يومية بالرواتب وتُخصم أقساط السلف من أرصدتها.' : 'A journal entry is posted and loan instalments are taken off the loan balances.')
              : (_arabic ? 'يُعكس قيد اليومية وتعود أقساط السلف إلى أرصدتها ويعود المسيّر إلى حالة «محسوب».' : 'The journal entry is reversed, loan instalments go back onto the balances and the run returns to Calculated.')),
          actions: [
            TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: Text(_arabic ? 'إلغاء' : 'Cancel')),
            FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: Text(_arabic ? 'تأكيد' : 'Confirm')),
          ],
        ),
      );
      if (ok != true || !mounted) return;
    }
    try {
      await ref.read(apiClientProvider).post('/hr/payroll/runs/$id/$action');
      if (!mounted) return;
      showMessage(context, _arabic ? 'تمت العملية.' : 'Done.');
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
    }
    _reloadAll();
  }

  Future<List<FieldOption>> _accountOptions(Set<String> types) async {
    final accounts = await ref.read(apiClientProvider).getList('/accounting/chart-of-accounts');
    return [
      for (final a in accounts)
        if (flag(a, 'isPostable') && flag(a, 'isActive') && types.contains(text(a, 'type')))
          FieldOption(text(a, 'id'), '${text(a, 'code')} — ${_arabic ? text(a, 'nameAr') : text(a, 'nameEn')}'),
    ];
  }

  Future<void> _payRun(String id) async {
    List<FieldOption> funding;
    try {
      funding = await _accountOptions({'ASSET'});
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
      return;
    }
    if (!mounted) return;
    final saved = await showFormSheet(
      context,
      title: _arabic ? 'صرف الرواتب' : 'Pay the salaries',
      submitLabel: _arabic ? 'صرف' : 'Pay',
      fields: [FieldSpec('fundingAccountId', _arabic ? 'الصرف من (صندوق أو بنك)' : 'Paid from (cash or bank)', kind: FieldKind.select, required: true, options: funding)],
      onSubmit: (values) async {
        await ref.read(apiClientProvider).post('/hr/payroll/runs/$id/pay', body: {'fundingAccountId': text(values, 'fundingAccountId')});
      },
    );
    if (saved != null && mounted) {
      showMessage(context, _arabic ? 'تم صرف الرواتب.' : 'The salaries were paid.');
      ref.invalidate(payrollRunsProvider);
    }
  }

  // ---- employees ----

  Widget _employees() {
    final async = ref.watch(payrollEmployeesProvider);
    return AsyncStateView<List<Json>>(
      value: async,
      onRetry: () => ref.read(payrollEmployeesProvider.notifier).reload(),
      isEmpty: (rows) => rows.isEmpty,
      emptyMessage: _arabic ? 'لا يوجد موظفون. أضف أول موظف.' : 'No employees yet. Add the first one.',
      data: (rows) => RecordsTable(
        rows: rows,
        columns: [
          ColumnSpec(_arabic ? 'الكود' : 'Code', value: (r) => text(r, 'code'), emphasise: true),
          ColumnSpec(_arabic ? 'الاسم' : 'Name', value: (r) => text(r, 'nameAr')),
          ColumnSpec(_arabic ? 'الوظيفة' : 'Job title', value: (r) => text(r, 'jobTitle')),
          ColumnSpec(_arabic ? 'تاريخ التعيين' : 'Hired on', value: (r) => text(r, 'hireDate')),
          ColumnSpec(_arabic ? 'الحالة' : 'Status', value: (r) => _status(text(r, 'status')), tone: (r) => text(r, 'status') == 'LEFT' ? AppTone.neutral : AppTone.success),
        ],
        actions: (row) => [
          if (_can('hr.employee.manage'))
            IconButton(
              key: ValueKey('employee-edit-${text(row, 'id')}'),
              tooltip: _arabic ? 'تعديل' : 'Edit',
              icon: const Icon(Icons.edit_outlined, size: 20),
              onPressed: () => _employeeForm(row),
            ),
          if (_can('hr.salary.manage'))
            IconButton(
              key: ValueKey('employee-salary-${text(row, 'id')}'),
              tooltip: _arabic ? 'تسجيل مرتب جديد' : 'Set a new salary',
              icon: const Icon(Icons.payments_outlined, size: 20),
              onPressed: () => _salaryForm(row),
            ),
        ],
      ),
    );
  }

  Future<void> _employeeForm(Json? emp) async {
    final editing = emp != null;
    final saved = await showFormSheet(
      context,
      title: editing ? (_arabic ? 'تعديل الموظف' : 'Edit the employee') : (_arabic ? 'موظف جديد' : 'New employee'),
      submitLabel: _arabic ? 'حفظ' : 'Save',
      initial: emp == null
          ? const <String, dynamic>{}
          : <String, dynamic>{
              'code': text(emp, 'code'),
              'nameAr': text(emp, 'nameAr'),
              'jobTitle': text(emp, 'jobTitle'),
              'hireDate': text(emp, 'hireDate'),
              'leaveDate': text(emp, 'leaveDate'),
            },
      fields: [
        FieldSpec('code', _arabic ? 'كود الموظف' : 'Employee code', required: true, maxLength: 32),
        FieldSpec('nameAr', _arabic ? 'الاسم' : 'Name', required: true, maxLength: 160),
        FieldSpec('jobTitle', _arabic ? 'الوظيفة' : 'Job title', maxLength: 120),
        FieldSpec('hireDate', _arabic ? 'تاريخ التعيين' : 'Hire date', kind: FieldKind.date, required: true),
        if (!editing) FieldSpec('nationalId', _arabic ? 'الرقم القومي (14 رقمًا)' : 'National ID (14 digits)', maxLength: 14),
        if (!editing) FieldSpec('bankAccount', _arabic ? 'حساب البنك' : 'Bank account', maxLength: 64),
        if (editing) FieldSpec('leaveDate', _arabic ? 'تاريخ ترك العمل (اتركه فارغًا لمن يعمل)' : 'Leaving date (empty while employed)', kind: FieldKind.date, clearable: true),
      ],
      onSubmit: (values) async {
        final leave = text(values, 'leaveDate').trim();
        final body = <String, dynamic>{
          'code': text(values, 'code').trim(),
          'nameAr': text(values, 'nameAr').trim(),
          'jobTitle': text(values, 'jobTitle').trim(),
          'hireDate': text(values, 'hireDate'),
          if (!editing && text(values, 'nationalId').trim().isNotEmpty) 'nationalId': text(values, 'nationalId').trim(),
          if (!editing && text(values, 'bankAccount').trim().isNotEmpty) 'bankAccount': text(values, 'bankAccount').trim(),
          if (editing) 'leaveDate': leave.isEmpty ? null : leave,
          if (editing) 'status': leave.isEmpty ? 'ACTIVE' : 'LEFT',
        };
        final api = ref.read(apiClientProvider);
        if (emp != null) {
          await api.patch('/hr/employees/${text(emp, 'id')}', body: body);
        } else {
          await api.post('/hr/employees', body: body);
        }
      },
    );
    if (saved != null && mounted) {
      showMessage(context, _arabic ? 'تم الحفظ.' : 'Saved.');
      ref.invalidate(payrollEmployeesProvider);
    }
  }

  Future<void> _salaryForm(Json emp) async {
    final saved = await showFormSheet(
      context,
      title: _arabic ? 'مرتب ${text(emp, 'nameAr')}' : 'Salary of ${text(emp, 'nameAr')}',
      submitLabel: _arabic ? 'حفظ' : 'Save',
      fields: [
        FieldSpec('effectiveFrom', _arabic ? 'يسري من تاريخ' : 'Effective from', kind: FieldKind.date, required: true, helper: _arabic ? 'المرتب القديم يبقى محفوظًا في السجل.' : 'The old salary stays in the history.'),
        FieldSpec('basic', _arabic ? 'الأجر الأساسي الشهري' : 'Monthly basic pay', kind: FieldKind.decimal, required: true),
        FieldSpec('coveredBySI', _arabic ? 'مشمول بالتأمينات' : 'Covered by social insurance', kind: FieldKind.toggle),
        FieldSpec('coveredByTax', _arabic ? 'يخضع لضريبة كسب العمل' : 'Subject to payroll tax', kind: FieldKind.toggle),
        FieldSpec(
          'allowances',
          _arabic ? 'البدلات (سطر لكل بدل: الاسم، المبلغ، يخضع للتأمينات 1 أو 0، يخضع للضريبة 1 أو 0)' : 'Allowances (one line each: name, amount, insurance 1 or 0, tax 1 or 0)',
          kind: FieldKind.multiline,
          maxLines: 4,
          validator: (v) => parsePayItems('ALLOWANCE', v) == null ? (_arabic ? 'اكتب كل بدل في سطر: الاسم ثم فاصلة ثم المبلغ.' : 'Write each allowance on a line: name, comma, amount.') : null,
        ),
        FieldSpec(
          'deductions',
          _arabic ? 'الاستقطاعات الثابتة (نفس الشكل)' : 'Fixed deductions (same format)',
          kind: FieldKind.multiline,
          maxLines: 3,
          validator: (v) => parsePayItems('DEDUCTION', v) == null ? (_arabic ? 'اكتب كل استقطاع في سطر: الاسم ثم فاصلة ثم المبلغ.' : 'Write each deduction on a line: name, comma, amount.') : null,
        ),
      ],
      initial: const {'coveredBySI': true, 'coveredByTax': true},
      onSubmit: (values) async {
        final items = [
          ...?parsePayItems('ALLOWANCE', text(values, 'allowances')),
          ...?parsePayItems('DEDUCTION', text(values, 'deductions')),
        ];
        await ref.read(apiClientProvider).post('/hr/employees/${text(emp, 'id')}/salary', body: {
          'effectiveFrom': text(values, 'effectiveFrom'),
          'basic': text(values, 'basic').trim(),
          'coveredBySI': values['coveredBySI'] == true,
          'coveredByTax': values['coveredByTax'] == true,
          'items': items,
        });
      },
    );
    if (saved != null && mounted) showMessage(context, _arabic ? 'تم حفظ المرتب.' : 'The salary was saved.');
  }

  // ---- attendance ----

  Widget _attendance() {
    final month = _attendanceMonth.isEmpty ? _defaultMonth() : _attendanceMonth;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Row(
            children: [
              Text(_arabic ? 'الشهر: $month' : 'Month: $month'),
              const SizedBox(width: 12),
              OutlinedButton(
                key: const ValueKey('attendance-month'),
                onPressed: _pickMonth,
                child: Text(_arabic ? 'تغيير الشهر' : 'Change month'),
              ),
            ],
          ),
        ),
        Expanded(
          child: FutureBuilder<Json>(
            key: ValueKey('attendance-$month'),
            future: ref.read(apiClientProvider).getObject('/hr/attendance/$month'),
            builder: (context, snap) {
              if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
              if (snap.hasError) return Center(child: Text(_arabic ? 'تعذّر تحميل الحضور. حدّث الصفحة وأعد المحاولة.' : 'Could not load attendance. Refresh the page and try again.'));
              final items = (snap.data?['items'] is List) ? (snap.data!['items'] as List).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : <Json>[];
              if (items.isEmpty) return Center(child: Text(_arabic ? 'لا يوجد موظفون على رأس العمل.' : 'No employees are currently employed.'));
              return RecordsTable(
                rows: items,
                columns: [
                  ColumnSpec(_arabic ? 'الكود' : 'Code', value: (r) => text(r, 'code'), emphasise: true),
                  ColumnSpec(_arabic ? 'الموظف' : 'Employee', value: (r) => text(r, 'nameAr')),
                  ColumnSpec(_arabic ? 'أيام الحضور' : 'Days worked', value: (r) => text(r, 'workingDays', fallback: '-')),
                  ColumnSpec(_arabic ? 'أيام الغياب' : 'Absence days', value: (r) => text(r, 'absenceDays', fallback: '-')),
                  ColumnSpec(_arabic ? 'ساعات إضافية' : 'Overtime hours', value: (r) => text(r, 'overtimeHours', fallback: '-')),
                  ColumnSpec(_arabic ? 'جزاءات' : 'Penalties', value: (r) => text(r, 'penaltyAmount', fallback: '-')),
                  ColumnSpec(_arabic ? 'الحالة' : 'State', value: (r) => r['entered'] == true ? (_arabic ? 'مُدخل' : 'Entered') : (_arabic ? 'لم يُدخل' : 'Missing'), tone: (r) => r['entered'] == true ? AppTone.success : AppTone.warning),
                ],
                actions: (row) => [
                  if (_can('hr.attendance.manage'))
                    IconButton(
                      key: ValueKey('attendance-edit-${text(row, 'employeeId')}'),
                      tooltip: _arabic ? 'إدخال الحضور' : 'Enter attendance',
                      icon: const Icon(Icons.edit_calendar_outlined, size: 20),
                      onPressed: () => _attendanceForm(month, row),
                    ),
                ],
              );
            },
          ),
        ),
      ],
    );
  }

  String _defaultMonth() {
    final prev = DateTime(DateTime.now().year, DateTime.now().month - 1);
    return '${prev.year}-${prev.month.toString().padLeft(2, '0')}';
  }

  Future<void> _pickMonth() async {
    final saved = await showFormSheet(
      context,
      title: _arabic ? 'اختيار الشهر' : 'Choose the month',
      submitLabel: _arabic ? 'عرض' : 'Show',
      initial: {'month': _attendanceMonth.isEmpty ? _defaultMonth() : _attendanceMonth},
      fields: [
        FieldSpec(
          'month',
          _arabic ? 'الشهر (سنة-شهر، مثل 2026-03)' : 'Month (year-month, like 2026-03)',
          required: true,
          validator: (v) => RegExp(r'^\d{4}-(0[1-9]|1[0-2])$').hasMatch(v.trim()) ? null : (_arabic ? 'اكتب الشهر هكذا: 2026-03.' : 'Write the month like this: 2026-03.'),
        ),
      ],
    );
    if (saved != null && mounted) setState(() => _attendanceMonth = text(saved, 'month').trim());
  }

  Future<void> _attendanceForm(String month, Json row) async {
    final saved = await showFormSheet(
      context,
      title: _arabic ? 'حضور ${text(row, 'nameAr')} عن $month' : 'Attendance of ${text(row, 'nameAr')} for $month',
      submitLabel: _arabic ? 'حفظ' : 'Save',
      initial: {
        'workingDays': text(row, 'workingDays', fallback: '0'),
        'absenceDays': text(row, 'absenceDays', fallback: '0'),
        'overtimeHours': text(row, 'overtimeHours', fallback: '0'),
        'penaltyAmount': text(row, 'penaltyAmount', fallback: '0'),
      },
      fields: [
        FieldSpec('workingDays', _arabic ? 'أيام الحضور' : 'Days worked', kind: FieldKind.decimal, required: true),
        FieldSpec('absenceDays', _arabic ? 'أيام الغياب بدون إذن' : 'Unexcused absence days', kind: FieldKind.decimal, required: true),
        FieldSpec('overtimeHours', _arabic ? 'ساعات العمل الإضافي' : 'Overtime hours', kind: FieldKind.decimal, required: true),
        FieldSpec('penaltyAmount', _arabic ? 'جزاءات (مبلغ)' : 'Penalties (amount)', kind: FieldKind.decimal, required: true),
      ],
      onSubmit: (values) async {
        await ref.read(apiClientProvider).put('/hr/attendance/$month', body: {
          'rows': [
            {
              'employeeId': text(row, 'employeeId'),
              'workingDays': text(values, 'workingDays').trim(),
              'absenceDays': text(values, 'absenceDays').trim(),
              'overtimeHours': text(values, 'overtimeHours').trim(),
              'penaltyAmount': text(values, 'penaltyAmount').trim(),
            },
          ],
        });
      },
    );
    if (saved != null && mounted) {
      showMessage(context, _arabic ? 'تم حفظ الحضور.' : 'Attendance saved.');
      setState(() {});
    }
  }

  // ---- loans ----

  Widget _loans() {
    final async = ref.watch(payrollLoansProvider);
    return AsyncStateView<List<Json>>(
      value: async,
      onRetry: () => ref.read(payrollLoansProvider.notifier).reload(),
      isEmpty: (rows) => rows.isEmpty,
      emptyMessage: _arabic ? 'لا توجد سلف للعاملين.' : 'There are no employee loans.',
      data: (rows) => RecordsTable(
        rows: rows,
        columns: [
          ColumnSpec(_arabic ? 'الموظف' : 'Employee', value: (r) => '${text(r, 'code')}  ${text(r, 'nameAr')}', emphasise: true),
          ColumnSpec(_arabic ? 'التاريخ' : 'Date', value: (r) => text(r, 'loanDate')),
          ColumnSpec(_arabic ? 'المبلغ' : 'Amount', value: (r) => text(r, 'amount')),
          ColumnSpec(_arabic ? 'الأقساط' : 'Instalments', value: (r) => text(r, 'instalments')),
          ColumnSpec(_arabic ? 'أول خصم' : 'First deduction', value: (r) => text(r, 'firstDeductionMonth')),
          ColumnSpec(_arabic ? 'المتبقي' : 'Remaining', value: (r) => text(r, 'remainingBalance')),
          ColumnSpec(_arabic ? 'الحالة' : 'Status', value: (r) => _status(text(r, 'status')), tone: (r) => text(r, 'status') == 'SETTLED' ? AppTone.success : AppTone.neutral),
        ],
      ),
    );
  }

  Future<void> _newLoan() async {
    List<Json> employees;
    List<FieldOption> funding;
    try {
      employees = await ref.read(apiClientProvider).getList('/hr/employees');
      funding = await _accountOptions({'ASSET'});
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
      return;
    }
    if (!mounted) return;
    final saved = await showFormSheet(
      context,
      title: _arabic ? 'سلفة جديدة' : 'New loan',
      submitLabel: _arabic ? 'تسجيل السلفة' : 'Record the loan',
      fields: [
        FieldSpec('employeeId', _arabic ? 'الموظف' : 'Employee', kind: FieldKind.select, required: true, searchable: true, options: [for (final e in employees) FieldOption(text(e, 'id'), '${text(e, 'code')}  ${text(e, 'nameAr')}')]),
        FieldSpec('loanDate', _arabic ? 'تاريخ السلفة' : 'Loan date', kind: FieldKind.date, required: true),
        FieldSpec('amount', _arabic ? 'المبلغ' : 'Amount', kind: FieldKind.decimal, required: true),
        FieldSpec('instalments', _arabic ? 'عدد الأقساط الشهرية' : 'Number of monthly instalments', kind: FieldKind.integer, required: true, minInteger: 1, maxInteger: 120),
        FieldSpec('firstDeductionMonth', _arabic ? 'شهر أول خصم (سنة-شهر، مثل 2026-04)' : 'First deduction month (like 2026-04)', required: true),
        FieldSpec('fundingAccountId', _arabic ? 'تُصرف من (صندوق أو بنك)' : 'Paid from (cash or bank)', kind: FieldKind.select, required: true, options: funding, helper: _arabic ? 'يُسجَّل قيد يومية تلقائيًا.' : 'A journal entry is posted automatically.'),
        FieldSpec('note', _arabic ? 'ملاحظة' : 'Note', maxLength: 200),
      ],
      onSubmit: (values) async {
        await ref.read(apiClientProvider).post('/hr/loans', body: {
          'employeeId': text(values, 'employeeId'),
          'loanDate': text(values, 'loanDate'),
          'amount': text(values, 'amount').trim(),
          'instalments': int.tryParse(text(values, 'instalments').trim()) ?? 0,
          'firstDeductionMonth': text(values, 'firstDeductionMonth').trim(),
          'fundingAccountId': text(values, 'fundingAccountId'),
          if (text(values, 'note').trim().isNotEmpty) 'note': text(values, 'note').trim(),
        });
      },
    );
    if (saved != null && mounted) {
      showMessage(context, _arabic ? 'تم تسجيل السلفة.' : 'The loan was recorded.');
      ref.invalidate(payrollLoansProvider);
    }
  }

  // ---- settings ----

  Widget _settings() {
    final async = ref.watch(payrollSettingsProvider);
    return AsyncStateView<List<Json>>(
      value: async,
      onRetry: () => ref.read(payrollSettingsProvider.notifier).reload(),
      isEmpty: (rows) => rows.isEmpty,
      emptyMessage: _arabic ? 'لم تُكتب مقادير التأمينات والضريبة. اكتبها من الجهة المختصة ثم اعتمدها قبل أول مسيّر.' : 'No insurance and tax figures yet. Enter them from the official source and confirm them before the first run.',
      data: (rows) => RecordsTable(
        rows: rows,
        columns: [
          ColumnSpec(_arabic ? 'تسري من' : 'Effective from', value: (r) => text(r, 'effectiveFrom'), emphasise: true),
          ColumnSpec(_arabic ? 'تأمينات العامل %' : 'Employee insurance %', value: (r) => text(r, 'siEmployeeRate')),
          ColumnSpec(_arabic ? 'تأمينات صاحب العمل %' : 'Employer insurance %', value: (r) => text(r, 'siEmployerRate')),
          ColumnSpec(_arabic ? 'حد الأجر التأميني' : 'Insurable pay ceiling', value: (r) => text(r, 'siCeiling')),
          ColumnSpec(_arabic ? 'الإعفاء الشخصي' : 'Personal exemption', value: (r) => text(r, 'personalExemption')),
          ColumnSpec(_arabic ? 'الحالة' : 'Status', value: (r) => r['confirmed'] == true ? (_arabic ? 'معتمدة' : 'Confirmed') : (_arabic ? 'غير معتمدة' : 'Not confirmed'), tone: (r) => r['confirmed'] == true ? AppTone.success : AppTone.warning),
        ],
        actions: (row) => [
          if (_can('payroll.settings.manage') && row['confirmed'] != true)
            IconButton(
              key: ValueKey('settings-confirm-${text(row, 'id')}'),
              tooltip: _arabic ? 'اعتماد هذه المقادير' : 'Confirm these figures',
              icon: const Icon(Icons.verified_outlined, size: 20),
              onPressed: () => _confirmSettings(row),
            ),
        ],
      ),
    );
  }

  Future<void> _confirmSettings(Json row) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_arabic ? 'اعتماد المقادير؟' : 'Confirm these figures?'),
        content: Text(_arabic ? 'بعد الاعتماد تُستخدم في حساب الرواتب ولا تُعدَّل. تأكد أنك أخذتها من المصدر الرسمي.' : 'Once confirmed they are used for payroll and cannot be edited. Make sure you took them from the official source.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: Text(_arabic ? 'إلغاء' : 'Cancel')),
          FilledButton(onPressed: () => Navigator.of(dialogContext).pop(true), child: Text(_arabic ? 'اعتماد' : 'Confirm')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await ref.read(apiClientProvider).post('/hr/settings/${text(row, 'id')}/confirm');
      if (!mounted) return;
      showMessage(context, _arabic ? 'تم اعتماد المقادير.' : 'The figures were confirmed.');
      ref.invalidate(payrollSettingsProvider);
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
    }
  }

  Future<void> _settingsForm() async {
    final saved = await showFormSheet(
      context,
      title: _arabic ? 'مقادير التأمينات والضريبة' : 'Insurance and tax figures',
      submitLabel: _arabic ? 'حفظ' : 'Save',
      fields: [
        FieldSpec('effectiveFrom', _arabic ? 'تسري من تاريخ' : 'Effective from', kind: FieldKind.date, required: true),
        FieldSpec('siEmployeeRate', _arabic ? 'نسبة تأمينات العامل %' : 'Employee insurance rate %', kind: FieldKind.decimal, required: true),
        FieldSpec('siEmployerRate', _arabic ? 'نسبة تأمينات صاحب العمل %' : 'Employer insurance rate %', kind: FieldKind.decimal, required: true),
        FieldSpec('siCeiling', _arabic ? 'الحد الأقصى للأجر التأميني الشهري' : 'Monthly insurable pay ceiling', kind: FieldKind.decimal, required: true),
        FieldSpec('personalExemption', _arabic ? 'الإعفاء الشخصي السنوي' : 'Annual personal exemption', kind: FieldKind.decimal, required: true),
        FieldSpec('overtimeFactor', _arabic ? 'معامل أجر الساعة الإضافية' : 'Overtime hourly factor', kind: FieldKind.decimal, required: true),
        FieldSpec('monthDivisor', _arabic ? 'عدد أيام الشهر لحساب الأجر اليومي' : 'Days per month for the daily wage', kind: FieldKind.integer, required: true, minInteger: 20, maxInteger: 31),
        FieldSpec(
          'taxBrackets',
          _arabic ? 'شرائح الضريبة السنوية (سطر لكل شريحة: من، إلى، النسبة %، وفي الأخيرة اترك «إلى» فارغًا)' : 'Annual tax brackets (one line each: from, to, percent; leave "to" empty on the last)',
          kind: FieldKind.multiline,
          maxLines: 6,
          required: true,
          validator: (v) => parseBrackets(v) == null ? (_arabic ? 'اكتب كل شريحة في سطر: من، إلى، النسبة. مثال: 0, 40000, 0' : 'Write each bracket on a line: from, to, percent. Example: 0, 40000, 0') : null,
        ),
      ],
      initial: const {'overtimeFactor': '1', 'monthDivisor': '30'},
      onSubmit: (values) async {
        await ref.read(apiClientProvider).post('/hr/settings', body: {
          'effectiveFrom': text(values, 'effectiveFrom'),
          'siEmployeeRate': text(values, 'siEmployeeRate').trim(),
          'siEmployerRate': text(values, 'siEmployerRate').trim(),
          'siCeiling': text(values, 'siCeiling').trim(),
          'personalExemption': text(values, 'personalExemption').trim(),
          'overtimeFactor': text(values, 'overtimeFactor').trim(),
          'monthDivisor': int.tryParse(text(values, 'monthDivisor').trim()) ?? 30,
          'taxBrackets': parseBrackets(text(values, 'taxBrackets')) ?? const <Map<String, dynamic>>[],
        });
      },
    );
    if (saved != null && mounted) {
      showMessage(context, _arabic ? 'تم الحفظ. اعتمد المقادير ليبدأ استخدامها.' : 'Saved. Confirm the figures so they can be used.');
      ref.invalidate(payrollSettingsProvider);
    }
  }

  Future<void> _accountsForm() async {
    List<FieldOption> expense;
    List<FieldOption> liability;
    List<FieldOption> asset;
    Json current;
    try {
      expense = await _accountOptions({'EXPENSE'});
      liability = await _accountOptions({'LIABILITY'});
      asset = await _accountOptions({'ASSET'});
      current = await ref.read(apiClientProvider).getObject('/hr/payroll/accounts');
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
      return;
    }
    if (!mounted) return;
    final saved = await showFormSheet(
      context,
      title: _arabic ? 'حسابات الرواتب' : 'Payroll accounts',
      submitLabel: _arabic ? 'حفظ' : 'Save',
      initial: {for (final k in ['salariesExpenseId', 'employerSiExpenseId', 'siPayableId', 'taxPayableId', 'loansReceivableId', 'salariesPayableId', 'deductionsPayableId']) if (text(current, k).isNotEmpty) k: text(current, k)},
      fields: [
        FieldSpec('salariesExpenseId', _arabic ? 'مصروف الرواتب' : 'Salaries expense', kind: FieldKind.select, required: true, searchable: true, options: expense),
        FieldSpec('employerSiExpenseId', _arabic ? 'مصروف تأمينات صاحب العمل' : 'Employer insurance expense', kind: FieldKind.select, required: true, searchable: true, options: expense),
        FieldSpec('siPayableId', _arabic ? 'تأمينات مستحقة' : 'Insurance payable', kind: FieldKind.select, required: true, searchable: true, options: liability),
        FieldSpec('taxPayableId', _arabic ? 'ضريبة كسب العمل المستحقة' : 'Payroll tax payable', kind: FieldKind.select, required: true, searchable: true, options: liability),
        FieldSpec('loansReceivableId', _arabic ? 'سلف العاملين' : 'Employee loans receivable', kind: FieldKind.select, required: true, searchable: true, options: asset),
        FieldSpec('salariesPayableId', _arabic ? 'رواتب مستحقة الدفع' : 'Salaries payable', kind: FieldKind.select, required: true, searchable: true, options: liability),
        FieldSpec('deductionsPayableId', _arabic ? 'استقطاعات مستحقة' : 'Deductions payable', kind: FieldKind.select, required: true, searchable: true, options: liability),
      ],
      onSubmit: (values) async {
        await ref.read(apiClientProvider).put('/hr/payroll/accounts', body: {
          for (final k in ['salariesExpenseId', 'employerSiExpenseId', 'siPayableId', 'taxPayableId', 'loansReceivableId', 'salariesPayableId', 'deductionsPayableId']) k: text(values, k),
        });
      },
    );
    if (saved != null && mounted) showMessage(context, _arabic ? 'تم حفظ حسابات الرواتب.' : 'The payroll accounts were saved.');
  }
}
