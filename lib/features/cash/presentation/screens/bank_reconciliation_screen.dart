import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

final bankReconciliationsProvider = FutureProvider<List<Json>>((ref) async {
  final response = await ref.read(apiClientProvider).getObject('/cash/reconciliations');
  return listOf(response['items']);
});

/// Bank statement matching. The ledger balance is calculated by the server;
/// this screen only records the statement and the posted vouchers selected by
/// the accountant. It never posts an adjustment to make a difference vanish.
class BankReconciliationScreen extends ConsumerWidget {
  const BankReconciliationScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(bankReconciliationsProvider);
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    String t(String ar, String en) => arabic ? ar : en;

    return ModuleScaffold(
      title: t('تسوية كشوف البنوك', 'Bank reconciliation'),
      subtitle: t(
        'مطابقة كشف البنك مع رصيد دفتر الأستاذ والسندات المرحلة',
        'Match bank statements to posted ledger balances and vouchers',
      ),
      trailing: FilledButton.icon(
        onPressed: () async {
          final saved = await showDialog<bool>(
            context: context,
            barrierDismissible: false,
            builder: (_) => const _CreateReconciliationDialog(),
          );
          if (saved == true) ref.invalidate(bankReconciliationsProvider);
        },
        icon: const Icon(Icons.add),
        label: Text(t('تسوية جديدة', 'New reconciliation')),
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.invalidate(bankReconciliationsProvider),
        isEmpty: (rows) => rows.isEmpty,
        emptyMessage: t('لا توجد تسويات بنكية بعد', 'No bank reconciliations yet'),
        data: (rows) => RecordsTable(
          rows: rows,
          columns: [
            ColumnSpec(
              t('الحساب البنكي', 'Bank account'),
              value: (row) {
                final account = row['cashAccount'] is Map
                    ? Map<String, dynamic>.from(row['cashAccount'] as Map)
                    : <String, dynamic>{};
                return arabic
                    ? text(account, 'nameAr', fallback: text(account, 'nameEn'))
                    : text(account, 'nameEn', fallback: text(account, 'nameAr'));
              },
            ),
            ColumnSpec(t('تاريخ الكشف', 'Statement date'), value: (r) => text(r, 'statementDate')),
            ColumnSpec(t('رصيد البنك', 'Statement balance'), numeric: true,
                value: (r) => formatAmount(asString(r['statementBalance']))),
            ColumnSpec(t('رصيد الدفاتر', 'Book balance'), numeric: true,
                value: (r) => formatAmount(asString(r['bookBalance']))),
            ColumnSpec(t('الفرق', 'Difference'), numeric: true,
                value: (r) => formatAmount(asString(r['difference']))),
            ColumnSpec(t('الحالة', 'Status'), value: (r) {
              final balanced = flag(r, 'isBalanced');
              return balanced
                  ? t('متطابقة', 'Balanced')
                  : t('يوجد فرق', 'Difference');
            }),
            ColumnSpec(t('نوع المستند', 'Record'), value: (r) => text(r, 'status')),
          ],
          onTap: (row) => _showDetails(context, row, arabic),
        ),
      ),
    );
  }

  Future<void> _showDetails(BuildContext context, Json row, bool arabic) async {
    final response = await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(arabic ? 'تفاصيل التسوية' : 'Reconciliation details'),
        content: SizedBox(
          width: 620,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                _DetailLine(arabic ? 'تاريخ الكشف' : 'Statement date', text(row, 'statementDate')),
                _DetailLine(arabic ? 'من' : 'Period from', text(row, 'periodFrom')),
                _DetailLine(arabic ? 'إلى' : 'Period to', text(row, 'periodTo')),
                _DetailLine(arabic ? 'رصيد كشف البنك' : 'Statement balance', text(row, 'statementBalance')),
                _DetailLine(arabic ? 'رصيد دفتر الأستاذ' : 'Ledger balance', text(row, 'bookBalance')),
                _DetailLine(arabic ? 'الفرق' : 'Difference', text(row, 'difference')),
                if (text(row, 'notes').isNotEmpty)
                  _DetailLine(arabic ? 'ملاحظات' : 'Notes', text(row, 'notes')),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(arabic ? 'إغلاق' : 'Close'),
          ),
        ],
      ),
    );
    return response;
  }
}

class _DetailLine extends StatelessWidget {
  const _DetailLine(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(
          children: [
            SizedBox(width: 190, child: Text(label, style: const TextStyle(fontWeight: FontWeight.w600))),
            Expanded(child: Text(value.isEmpty ? '—' : value)),
          ],
        ),
      );
}

class _CreateReconciliationDialog extends ConsumerStatefulWidget {
  const _CreateReconciliationDialog();

  @override
  ConsumerState<_CreateReconciliationDialog> createState() => _CreateReconciliationDialogState();
}

class _CreateReconciliationDialogState extends ConsumerState<_CreateReconciliationDialog> {
  final _formKey = GlobalKey<FormState>();
  final _from = TextEditingController();
  final _to = TextEditingController();
  final _statementDate = TextEditingController();
  final _balance = TextEditingController();
  final _notes = TextEditingController();
  List<Json> _accounts = [];
  List<Json> _unmatched = [];
  final Set<String> _selected = {};
  String? _accountId;
  bool _loading = true;
  bool _saving = false;
  String? _error;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String t(String ar, String en) => _arabic ? ar : en;
  String get _today {
    final now = DateTime.now();
    return '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
  }

  @override
  void initState() {
    super.initState();
    _from.text = '${DateTime.now().year}-01-01';
    _to.text = _today;
    _statementDate.text = _today;
    _loadAccounts();
  }

  @override
  void dispose() {
    _from.dispose();
    _to.dispose();
    _statementDate.dispose();
    _balance.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _loadAccounts() async {
    try {
      final accounts = await ref.read(apiClientProvider).getList('/cash/accounts?kind=BANK');
      if (!mounted) return;
      setState(() {
        _accounts = accounts;
        _accountId = accounts.isEmpty ? null : text(accounts.first, 'id');
        _loading = false;
      });
      if (_accountId != null) await _loadUnmatched();
    } on Failure catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _loadUnmatched() async {
    final id = _accountId;
    if (id == null) return;
    setState(() { _loading = true; _selected.clear(); });
    try {
      final response = await ref.read(apiClientProvider).getObject(
        '/cash/reconciliations/unmatched/$id?to=${Uri.encodeQueryComponent(_to.text.trim())}',
      );
      if (!mounted) return;
      setState(() {
        _unmatched = listOf(response['items']);
        _loading = false;
        _error = null;
      });
    } on Failure catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false) || _accountId == null) return;
    setState(() { _saving = true; _error = null; });
    try {
      await ref.read(apiClientProvider).post('/cash/reconciliations', body: {
        'cashAccountId': _accountId,
        'statementDate': _statementDate.text.trim(),
        'periodFrom': _from.text.trim(),
        'periodTo': _to.text.trim(),
        'statementBalance': _balance.text.trim(),
        'notes': _notes.text.trim(),
        'voucherIds': _selected.toList(growable: false),
        'finalise': true,
      });
      if (mounted) Navigator.pop(context, true);
    } on Failure catch (e) {
      if (mounted) setState(() { _error = e.message; _saving = false; });
    }
  }

  String? _dateValidator(String? value) {
    final v = value?.trim() ?? '';
    if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(v) || DateTime.tryParse(v) == null) {
      return t('أدخل التاريخ بصيغة YYYY-MM-DD', 'Use a valid YYYY-MM-DD date');
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(t('إنشاء تسوية بنكية', 'Create bank reconciliation')),
      content: SizedBox(
        width: 700,
        child: _loading && _accounts.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : Form(
                key: _formKey,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (_error != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                        ),
                      DropdownButtonFormField<String>(
                        initialValue: _accountId,
                        decoration: InputDecoration(labelText: t('الحساب البنكي', 'Bank account')),
                        items: [
                          for (final account in _accounts)
                            DropdownMenuItem(
                              value: text(account, 'id'),
                              child: Text('${text(account, 'code')} — ${_arabic ? text(account, 'nameAr', fallback: text(account, 'nameEn')) : text(account, 'nameEn', fallback: text(account, 'nameAr'))}'),
                            ),
                        ],
                        onChanged: _saving ? null : (value) {
                          setState(() => _accountId = value);
                          _loadUnmatched();
                        },
                        validator: (value) => value == null ? t('اختر حسابًا بنكيًا', 'Select a bank account') : null,
                      ),
                      const SizedBox(height: 10),
                      _dateField(_statementDate, t('تاريخ كشف البنك', 'Statement date')),
                      _dateField(_from, t('بداية الفترة', 'Period from')),
                      _dateField(_to, t('نهاية الفترة', 'Period to')),
                      TextFormField(
                        controller: _balance,
                        keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                        decoration: InputDecoration(labelText: t('رصيد كشف البنك', 'Statement balance')),
                        validator: (value) {
                          final v = value?.trim() ?? '';
                          return v.isNotEmpty && RegExp(r'^-?\d{1,15}(\.\d{1,4})?$').hasMatch(v)
                              ? null
                              : t('أدخل مبلغًا صحيحًا حتى 4 منازل عشرية', 'Enter a valid amount with up to 4 decimals');
                        },
                      ),
                      const SizedBox(height: 12),
                      Text(t('السندات المرحلة غير المطابقة', 'Unmatched posted vouchers'), style: Theme.of(context).textTheme.titleSmall),
                      const SizedBox(height: 6),
                      if (_loading)
                        const LinearProgressIndicator()
                      else if (_unmatched.isEmpty)
                        Text(t('لا توجد سندات غير مطابقة حتى تاريخ الكشف', 'No unmatched posted vouchers through the statement date'))
                      else
                        Container(
                          constraints: const BoxConstraints(maxHeight: 220),
                          decoration: BoxDecoration(
                            border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: ListView.builder(
                            shrinkWrap: true,
                            itemCount: _unmatched.length,
                            itemBuilder: (context, index) {
                              final voucher = _unmatched[index];
                              final id = text(voucher, 'id');
                              final selected = _selected.contains(id);
                              return CheckboxListTile(
                                dense: true,
                                value: selected,
                                onChanged: _saving ? null : (checked) => setState(() {
                                  if (checked == true) { _selected.add(id); } else { _selected.remove(id); }
                                }),
                                title: Text('${text(voucher, 'voucherNumber')} • ${text(voucher, 'voucherDate')}'),
                                subtitle: Text('${text(voucher, 'kind')} • ${text(voucher, 'description')}'),
                                secondary: Text(formatAmount(asString(voucher['amount']))),
                              );
                            },
                          ),
                        ),
                      const SizedBox(height: 10),
                      TextFormField(
                        controller: _notes,
                        maxLines: 2,
                        decoration: InputDecoration(labelText: t('ملاحظات', 'Notes')),
                      ),
                    ],
                  ),
                ),
              ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.pop(context, false),
          child: Text(t('إلغاء', 'Cancel')),
        ),
        FilledButton.icon(
          onPressed: _saving || _loading || _accounts.isEmpty ? null : _save,
          icon: _saving ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.save_outlined),
          label: Text(t('حفظ التسوية', 'Save reconciliation')),
        ),
      ],
    );
  }

  Widget _dateField(TextEditingController controller, String label) => Padding(
        padding: const EdgeInsets.only(top: 8),
        child: TextFormField(
          controller: controller,
          decoration: InputDecoration(labelText: label, hintText: 'YYYY-MM-DD'),
          validator: _dateValidator,
          onEditingComplete: identical(controller, _to) ? _loadUnmatched : null,
        ),
      );
}
