import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';

import '../../../../core/network/api_client.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../auth/domain/entities/app_user.dart';

typedef _Record = Map<String, dynamic>;

Future<bool?> showOpeningBalanceDraft(
  BuildContext context,
  ApiClient api,
  AppUser user, {
  Map<String, dynamic>? draft,
}) async {
  Future<List<_Record>> all(String path) async {
    const size = 200;
    final result = <_Record>[];
    for (var page = 1; ; page++) {
      final rows = await api.getList(
        path,
        query: {'page': page, 'pageSize': size},
      );
      result.addAll(rows);
      if (rows.length < size) return result;
    }
  }

  final responses = await Future.wait([
    api.getList('/company/branches'),
    api.getList('/accounting/chart-of-accounts'),
    if (user.can('cash.accounts.read'))
      api.getList('/cash/accounts')
    else
      Future.value(<_Record>[]),
    if (user.can('parties.customers.read'))
      all('/parties/customers')
    else
      Future.value(<_Record>[]),
    if (user.can('parties.suppliers.read'))
      all('/parties/suppliers')
    else
      Future.value(<_Record>[]),
    if (user.can('inventory.items.read') && user.can('inventory.cost.read'))
      all('/inventory/items')
    else
      Future.value(<_Record>[]),
    if (user.can('inventory.warehouses.read'))
      api.getList('/inventory/warehouses')
    else
      Future.value(<_Record>[]),
  ]);
  final profile = await api.getObject('/company/profile');
  if (!context.mounted) return null;
  return showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _DraftDialog(
      api: api,
      draft: draft,
      initialBranch: user.branchId,
      branches: responses[0]
          .where(
            (row) =>
                row['isActive'] != false &&
                (user.isSuperAdmin || row['id'] == user.branchId),
          )
          .toList(),
      accounts: responses[1],
      cash: responses[2],
      customers: responses[3],
      suppliers: responses[4],
      items: responses[5]
          .where((row) => row['isStockTracked'] == true)
          .toList(),
      warehouses: responses[6],
      currency: '${profile['currency'] ?? ''}',
    ),
  );
}

class _DraftLine {
  _DraftLine([_Record? row])
    : accountId = row?['accountId'] as String?,
      customerId = row?['customerId'] as String?,
      supplierId = row?['supplierId'] as String?,
      itemId = row?['itemId'] as String?,
      debit = _controller(row?['debit']),
      credit = _controller(row?['credit']),
      quantity = _controller(row?['quantity']),
      unitCost = _controller(row?['unitCost']),
      description = TextEditingController(text: row?['description'] as String?);

  String? accountId;
  String? customerId;
  String? supplierId;
  String? itemId;
  final TextEditingController debit;
  final TextEditingController credit;
  final TextEditingController quantity;
  final TextEditingController unitCost;
  final TextEditingController description;

  static TextEditingController _controller(Object? value) {
    final text = value?.toString() ?? '';
    return TextEditingController(
      text: Decimal.tryParse(text) == Decimal.zero ? '' : text,
    );
  }

  void dispose() {
    debit.dispose();
    credit.dispose();
    quantity.dispose();
    unitCost.dispose();
    description.dispose();
  }
}

class _DraftDialog extends StatefulWidget {
  const _DraftDialog({
    required this.api,
    required this.draft,
    required this.initialBranch,
    required this.branches,
    required this.accounts,
    required this.cash,
    required this.customers,
    required this.suppliers,
    required this.items,
    required this.warehouses,
    required this.currency,
  });

  final ApiClient api;
  final _Record? draft;
  final String? initialBranch;
  final List<_Record> branches;
  final List<_Record> accounts;
  final List<_Record> cash;
  final List<_Record> customers;
  final List<_Record> suppliers;
  final List<_Record> items;
  final List<_Record> warehouses;
  final String currency;

  @override
  State<_DraftDialog> createState() => _DraftDialogState();
}

class _DraftDialogState extends State<_DraftDialog> {
  late final List<_DraftLine> _lines;
  late final TextEditingController _date;
  late final TextEditingController _description;
  String? _branch;
  String? _warehouse;
  bool _saving = false;
  bool _dirty = false;
  late bool _autoBalance;
  final _removed = <_DraftLine>[];
  static final _amount = RegExp(r'^\d{1,15}(?:\.\d{1,4})?$');

  @override
  void initState() {
    super.initState();
    final draft = widget.draft;
    _date = TextEditingController(
      text:
          draft?['asOfDate'] as String? ??
          DateTime.now().toIso8601String().substring(0, 10),
    );
    _description = TextEditingController(
      text: draft?['description'] as String?,
    );
    _branch = draft?['branchId'] as String? ?? widget.initialBranch;
    if (_branch == null && widget.branches.length == 1) {
      _branch = widget.branches.single['id'] as String?;
    }
    final warehouse = draft?['warehouse'];
    if (warehouse is Map) _warehouse = warehouse['id'] as String?;
    _lines = (draft?['lines'] as List? ?? const [])
        .whereType<Map>()
        .map((row) => _DraftLine(Map<String, dynamic>.from(row)))
        .toList();
    if (_lines.isEmpty) _lines.add(_DraftLine());
    _autoBalance = draft == null;
  }

  @override
  void dispose() {
    for (final line in [..._lines, ..._removed]) {
      line.dispose();
    }
    _date.dispose();
    _description.dispose();
    super.dispose();
  }

  String _label(String ar, String en) =>
      Localizations.localeOf(context).languageCode == 'ar' ? ar : en;

  String _name(_Record row) {
    final primary = _label('nameAr', 'nameEn');
    final secondary = _label('nameEn', 'nameAr');
    final preferred = '${row[primary] ?? ''}'.trim();
    return '${row['code'] ?? ''}  ${preferred.isEmpty ? row[secondary] ?? '' : preferred}';
  }

  void _change(VoidCallback action) => setState(() {
    _dirty = true;
    action();
  });

  Future<void> _close() async {
    if (_saving) return;
    if (_dirty &&
        !await confirmAction(
          context,
          title: _label('تغييرات غير محفوظة', 'Unsaved changes'),
          message: _label('هل تريد تجاهل التغييرات؟', 'Discard your changes?'),
          confirmLabel: _label('تجاهل التغييرات', 'Discard changes'),
          destructive: true,
        )) {
      return;
    }
    if (mounted) Navigator.of(context).pop(false);
  }

  DateTime? _calendarDate() {
    final date = DateTime.tryParse(_date.text);
    return date != null && date.year >= 1900 && date.year < 2200 ? date : null;
  }

  Decimal? _number(TextEditingController controller) {
    final text = controller.text.trim();
    if (text.isEmpty) return Decimal.zero;
    return _amount.hasMatch(text) ? Decimal.tryParse(text) : null;
  }

  Decimal? _debit(_DraftLine line) {
    if (line.itemId == null) return _number(line.debit);
    final qty = _number(line.quantity);
    final cost = _number(line.unitCost);
    return qty == null || cost == null ? null : (qty * cost).round(scale: 4);
  }

  List<_Record> get _availableAccounts => widget.accounts
      .where((row) => row['isPostable'] == true && row['isActive'] != false)
      .toList();

  Future<void> _save() async {
    if (_saving) return;
    final date = _date.text.trim();
    final parsed = DateTime.tryParse(date);
    final branch = _branch;
    if (branch == null ||
        parsed == null ||
        parsed.toIso8601String().substring(0, 10) != date) {
      showMessage(
        context,
        _label('اختر الفرع وتاريخًا صحيحًا', 'Choose a branch and valid date'),
        error: true,
      );
      return;
    }
    final lines = <_Record>[];
    for (final line in _lines) {
      final debit = _debit(line);
      final credit = line.itemId == null ? _number(line.credit) : Decimal.zero;
      if (line.accountId == null ||
          debit == null ||
          credit == null ||
          (debit == Decimal.zero) == (credit == Decimal.zero)) {
        showMessage(
          context,
          _label(
            'اختر حسابًا وأدخل مبلغًا مدينًا أو دائنًا لكل سطر',
            'Choose an account and enter one debit or credit amount per line',
          ),
          error: true,
        );
        return;
      }
      lines.add({
        'accountId': line.accountId,
        'debit': debit.toStringAsFixed(4),
        'credit': credit.toStringAsFixed(4),
        if (line.customerId != null) 'customerId': line.customerId,
        if (line.supplierId != null) 'supplierId': line.supplierId,
        if (line.itemId != null) ...{
          'itemId': line.itemId,
          'quantity': line.quantity.text.trim(),
          'unitCost': line.unitCost.text.trim(),
        },
        if (line.description.text.trim().isNotEmpty)
          'description': line.description.text.trim(),
      });
    }
    final body = {
      'branchId': branch,
      'currency': widget.currency,
      'asOfDate': date,
      'description': _description.text.trim(),
      if (_warehouse != null) 'warehouseId': _warehouse,
      'autoBalanceToEquity': _autoBalance,
      'lines': lines,
    };
    setState(() => _saving = true);
    try {
      const path = '/accounting/opening-balances';
      final id = widget.draft?['id'];
      if (id == null) {
        await widget.api.post(path, body: body);
      } else {
        await widget.api.patch('$path/$id', body: body);
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _picker(
    String label,
    List<_Record> records,
    String? value,
    ValueChanged<String?>? change, {
    String valueKey = 'id',
    bool optional = false,
  }) {
    final byId = {for (final row in records) row[valueKey] as String: row};
    return DropdownButtonFormField<String>(
      key: ValueKey((label, value)),
      isExpanded: true,
      initialValue: value ?? (optional ? '' : null),
      decoration: InputDecoration(labelText: label),
      items: [
        if (optional)
          DropdownMenuItem(value: '', child: Text(_label('بدون', 'None'))),
        if (value != null && !byId.containsKey(value))
          DropdownMenuItem(
            value: value,
            child: Text(_label('القيمة الحالية', 'Current value')),
          ),
        for (final entry in byId.entries)
          DropdownMenuItem(
            value: entry.key,
            child: Text(_name(entry.value), overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: _saving || change == null
          ? null
          : (selected) =>
                _change(() => change(selected == '' ? null : selected)),
    );
  }

  Widget _money(String label, TextEditingController controller) => TextField(
    controller: controller,
    enabled: !_saving,
    keyboardType: const TextInputType.numberWithOptions(decimal: true),
    decoration: InputDecoration(labelText: label),
    onChanged: (_) => _change(() {}),
  );

  void _chooseAccount(_DraftLine line, List<_Record> accounts, String code) {
    for (final account in accounts) {
      if (account['code'] == code) {
        line.accountId = account['id'] as String;
        return;
      }
    }
    line.accountId = null;
  }

  Widget _line(_DraftLine line) {
    final l10n = context.l10n;
    final cash = widget.cash
        .where(
          (row) =>
              row['accountId'] is String &&
              (row['branchId'] == null || row['branchId'] == _branch) &&
              row['currency'] == widget.currency,
        )
        .toList();
    final accounts = _availableAccounts
        .where(
          (row) =>
              row['currency'] == null || row['currency'] == widget.currency,
        )
        .toList();
    return Card(
      key: ObjectKey(line),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            if (cash.isNotEmpty &&
                line.customerId == null &&
                line.supplierId == null &&
                line.itemId == null)
              _picker(
                _label('بنك أو خزنة', 'Bank or cash'),
                cash,
                cash.any((row) => row['accountId'] == line.accountId)
                    ? line.accountId
                    : null,
                (id) {
                  if (id != null) line.accountId = id;
                },
                valueKey: 'accountId',
                optional: true,
              ),
            _picker(
              _label('الحساب المحاسبي', 'Ledger account'),
              accounts,
              line.accountId,
              (id) => line.accountId = id,
            ),
            if (line.supplierId == null &&
                line.itemId == null &&
                (widget.customers.isNotEmpty || line.customerId != null))
              _picker(
                _label('العميل', 'Customer'),
                widget.customers,
                line.customerId,
                (id) {
                  line.customerId = id;
                  if (id != null) _chooseAccount(line, accounts, '1103');
                },
                optional: true,
              ),
            if (line.customerId == null &&
                line.itemId == null &&
                (widget.suppliers.isNotEmpty || line.supplierId != null))
              _picker(
                _label('المورد', 'Supplier'),
                widget.suppliers,
                line.supplierId,
                (id) {
                  line.supplierId = id;
                  if (id != null) _chooseAccount(line, accounts, '2101');
                },
                optional: true,
              ),
            if (line.customerId == null &&
                line.supplierId == null &&
                (widget.items.isNotEmpty || line.itemId != null))
              _picker(
                _label('صنف مخزني', 'Stock item'),
                widget.items,
                line.itemId,
                (id) {
                  line.itemId = id;
                  if (id != null) _chooseAccount(line, accounts, '1104');
                },
                optional: true,
              ),
            Row(
              children: [
                Expanded(
                  child: line.itemId == null
                      ? _money(l10n.debit, line.debit)
                      : _money(_label('الكمية', 'Quantity'), line.quantity),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: line.itemId == null
                      ? _money(l10n.credit, line.credit)
                      : _money(
                          _label('تكلفة الوحدة', 'Unit cost'),
                          line.unitCost,
                        ),
                ),
                IconButton(
                  tooltip: _label('حذف السطر', 'Remove line'),
                  onPressed: _saving || _lines.length == 1
                      ? null
                      : () => _change(() {
                          _lines.remove(line);
                          _removed.add(line);
                        }),
                  icon: const Icon(Icons.remove_circle_outline),
                ),
              ],
            ),
            if (line.description.text.isNotEmpty)
              TextField(
                controller: line.description,
                enabled: !_saving,
                decoration: InputDecoration(labelText: l10n.description),
                onChanged: (_) => _change(() {}),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final debit = _lines.fold(
      Decimal.zero,
      (sum, line) => sum + (_debit(line) ?? Decimal.zero),
    );
    final credit = _lines.fold(
      Decimal.zero,
      (sum, line) =>
          sum +
          (line.itemId == null
              ? _number(line.credit) ?? Decimal.zero
              : Decimal.zero),
    );
    final warehouses = widget.warehouses
        .where((row) => row['branchId'] == _branch)
        .toList();
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _close();
      },
      child: AlertDialog(
        title: Text(
          _label('مسودة الأرصدة الافتتاحية', 'Opening balance draft'),
        ),
        content: SizedBox(
          width: 650,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _picker(
                  l10n.branch,
                  widget.branches,
                  _branch,
                  widget.draft != null
                      ? null
                      : (branch) {
                          _branch = branch;
                          _warehouse = null;
                        },
                ),
                TextField(
                  controller: _date,
                  enabled: !_saving,
                  decoration: InputDecoration(
                    labelText: _label(
                      'تاريخ الأرصدة (YYYY-MM-DD)',
                      'Opening date (YYYY-MM-DD)',
                    ),
                    suffixIcon: IconButton(
                      tooltip: _label('اختر التاريخ', 'Choose date'),
                      icon: const Icon(Icons.calendar_today_outlined),
                      onPressed: _saving
                          ? null
                          : () async {
                              final date = await showDatePicker(
                                context: context,
                                initialDate: _calendarDate(),
                                firstDate: DateTime(1900),
                                lastDate: DateTime(2200),
                              );
                              if (date != null && mounted) {
                                _change(() {
                                  _date.text = date.toIso8601String().substring(
                                    0,
                                    10,
                                  );
                                });
                              }
                            },
                    ),
                  ),
                  onChanged: (_) => _change(() {}),
                ),
                if (warehouses.isNotEmpty || _warehouse != null)
                  _picker(
                    l10n.warehouse,
                    warehouses,
                    _warehouse,
                    (id) => _warehouse = id,
                    optional: true,
                  ),
                TextField(
                  controller: _description,
                  enabled: !_saving,
                  decoration: InputDecoration(labelText: l10n.description),
                  onChanged: (_) => _change(() {}),
                ),
                for (final line in _lines) _line(line),
                TextButton.icon(
                  onPressed: _saving || _lines.length >= 999
                      ? null
                      : () => _change(() => _lines.add(_DraftLine())),
                  icon: const Icon(Icons.add),
                  label: Text(_label('إضافة سطر', 'Add line')),
                ),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    _label(
                      'ترحيل الفرق إلى حساب الأرصدة الافتتاحية',
                      'Balance the difference against opening equity',
                    ),
                  ),
                  value: _autoBalance,
                  onChanged: _saving
                      ? null
                      : (value) => _change(() => _autoBalance = value == true),
                ),
                Text(
                  '${l10n.debit} ${debit.toStringAsFixed(4)} · ${l10n.credit} ${credit.toStringAsFixed(4)} ${widget.currency}',
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: _saving ? null : _close,
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: Text(_label('حفظ مسودة للمراجعة', 'Save draft for review')),
          ),
        ],
      ),
    );
  }
}
