import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../core/error/failure.dart';
import '../../../core/json/json_utils.dart';
import '../../../shared/widgets/confirm_dialog.dart';
import '../../auth/presentation/providers/auth_providers.dart';
import '../../common/presentation/providers/resource_providers.dart';
import '../../common/presentation/screens/module_scaffold.dart';
import '../../invoicing/presentation/providers/invoice_providers.dart';
import '../../invoicing/presentation/screens/invoice_editor_screen.dart' show lineUnitsOf;
import 'order_retry_store.dart';

class _OrderLine {
  String? itemId;
  String? unitName;
  final quantity = TextEditingController(text: '1');
  final price = TextEditingController();
  final discount = TextEditingController(text: '0');
  final tax = TextEditingController();
  void dispose() { quantity.dispose(); price.dispose(); discount.dispose(); tax.dispose(); }
}

/// Creates a draft; an uncertain POST is retained with its original identity.
class OrderCreateScreen extends ConsumerStatefulWidget {
  const OrderCreateScreen({super.key, required this.kind});
  final InvoiceKind kind;
  @override
  ConsumerState<OrderCreateScreen> createState() => _OrderCreateScreenState();
}

class _OrderCreateScreenState extends ConsumerState<OrderCreateScreen> {
  final _form = GlobalKey<FormState>();
  final _date = TextEditingController();
  final _notes = TextEditingController();
  final _lines = <_OrderLine>[_OrderLine()];
  String? _party;
  OrderRetryStore? _store;
  String? _scope;
  Map<String, dynamic>? _pending;
  bool _busy = false;
  bool _dirty = false;
  bool _confirming = false;
  bool get _ar => Localizations.localeOf(context).languageCode == 'ar';
  String tr(String ar, String en) => _ar ? ar : en;
  String get _path => widget.kind.isSales ? '/sales/orders' : '/purchases/orders';

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _date.text = '${now.year.toString().padLeft(4, '0')}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    _loadPending();
  }

  Future<void> _loadPending() async {
    try {
      final user = ref.read(currentUserProvider);
      if (user == null || user.branchId == null) throw StateError('No user branch');
      final config = ref.read(appConfigProvider);
      final scope = orderRetryScope(apiBaseUrl: config.apiBaseUrl,
        embeddedLocalServer: config.embeddedLocalServer, companyId: user.companyId,
        branchId: user.branchId!, userId: user.id, kind: widget.kind.name, orderId: 'new-order');
      final store = OrderRetryStore(await SharedPreferences.getInstance());
      final pending = store.read(scope);
      if (mounted) {
        if (pending != null) _restoreDraft(pending);
        setState(() { _store = store; _scope = scope; _pending = pending; });
      }
    } catch (error) {
      if (mounted) showMessage(context, error.toString(), error: true);
    }
  }

  // Reconstruct the draft as well as the request. If a later retry is
  // definitively rejected, the user can correct it without retyping it.
  void _restoreDraft(Map<String, dynamic> request) {
    if (request['method'] != 'POST' || request['path'] != _path || request['body'] is! Map) {
      throw const FormatException('Invalid pending order request');
    }
    final body = Map<String, dynamic>.from(request['body'] as Map);
    final rawLines = listOf(body['lines']);
    if (rawLines.isEmpty) throw const FormatException('Invalid pending order lines');
    final restored = <_OrderLine>[];
    for (final raw in rawLines) {
      final line = _OrderLine()
        ..itemId = asString(raw['itemId'])
        ..unitName = asString(raw['unitName']);
      line.quantity.text = text(raw, 'quantity');
      line.price.text = text(raw, 'unitPrice');
      line.discount.text = text(raw, 'discountPercent', fallback: '0');
      line.tax.text = text(raw, 'taxRate');
      restored.add(line);
    }
    final old = List<_OrderLine>.from(_lines);
    _lines..clear()..addAll(restored);
    _party = asString(body[widget.kind.isSales ? 'customerId' : 'supplierId']);
    _date.text = text(body, 'orderDate');
    _notes.text = text(body, 'notes');
    _dirty = true;
    WidgetsBinding.instance.addPostFrameCallback((_) { for (final line in old) { line.dispose(); } });
  }

  @override
  void dispose() {
    _date.dispose(); _notes.dispose();
    for (final line in _lines) { line.dispose(); }
    super.dispose();
  }

  void _changed() { if (!_dirty) setState(() => _dirty = true); }
  Future<void> _close() async {
    if (_busy || _confirming) return;
    if (_dirty && _pending == null) {
      _confirming = true;
      final discard = await confirmAction(context,
        title: tr('تغييرات غير محفوظة', 'Unsaved changes'),
        message: tr('هل تريد الخروج دون حفظ الأمر؟', 'Leave without saving the order?'),
        confirmLabel: tr('الخروج دون حفظ', 'Discard changes'), destructive: true);
      _confirming = false;
      if (!discard || !mounted) return;
    }
    if (mounted) Navigator.of(context).pop();
  }

  String? _number(String? raw, {bool required = false, bool positive = false, bool percent = false}) {
    final value = (raw ?? '').trim();
    if (value.isEmpty) return required ? tr('مطلوب', 'Required') : null;
    if (!RegExp(r'^\d+(?:\.\d{1,4})?$').hasMatch(value)) return tr('رقم غير صالح', 'Invalid number');
    final parsed = Decimal.tryParse(value);
    if (parsed == null || (positive && parsed <= Decimal.zero) || (percent && parsed > Decimal.fromInt(100))) {
      return tr('رقم غير صالح', 'Invalid number');
    }
    return null;
  }

  Future<void> _save() async {
    if (_busy || _pending != null || _store == null || _scope == null) return;
    if (!(_form.currentState?.validate() ?? false)) return;
    final body = <String, dynamic>{
      widget.kind.isSales ? 'customerId' : 'supplierId': _party,
      'orderDate': _date.text.trim(),
      if (_notes.text.trim().isNotEmpty) 'notes': _notes.text.trim(),
      'lines': [for (final line in _lines) <String, dynamic>{
        'itemId': line.itemId, 'quantity': line.quantity.text.trim(),
        if (line.unitName != null && line.unitName!.isNotEmpty) 'unitName': line.unitName,
        if (line.price.text.trim().isNotEmpty) 'unitPrice': line.price.text.trim(),
        'discountPercent': line.discount.text.trim().isEmpty ? '0' : line.discount.text.trim(),
        'taxRate': line.tax.text.trim(),
      }],
    };
    setState(() => _busy = true);
    try {
      final request = await _store!.begin(_scope!, method: 'POST', path: _path, body: body);
      if (mounted) await _send(request);
    } catch (error) {
      if (mounted) showMessage(context, error.toString(), error: true);
    } finally { if (mounted) setState(() => _busy = false); }
  }

  Future<void> _send(Map<String, dynamic> request) async {
    setState(() { _busy = true; _pending = request; });
    try {
      if (request['method'] != 'POST' || request['path'] != _path) throw const FormatException('Invalid pending order request');
      final body = Map<String, dynamic>.from(request['body'] as Map);
      final result = await ref.read(apiClientProvider).post(_path, body: body);
      final id = text(result, 'id');
      if (id.isEmpty) throw const FormatException('Order response has no id');
      await _store!.complete(_scope!);
      if (!mounted) return;
      _dirty = false;
      Navigator.of(context).pop(id);
    } on Failure catch (error) {
      if (error is ApiFailure && const {400, 422}.contains(error.statusCode)) {
        await _store!.complete(_scope!);
        if (mounted) setState(() => _pending = null);
      }
      if (mounted) showMessage(context, error.message, error: true);
    } catch (error) {
      if (mounted) showMessage(context, error.toString(), error: true);
    } finally { if (mounted) setState(() => _busy = false); }
  }

  @override
  Widget build(BuildContext context) {
    final parties = ref.watch(widget.kind.isSales ? activeCustomersProvider : activeSuppliersProvider);
    final items = ref.watch(activeItemsProvider);
    final disabled = _busy || _pending != null || _store == null;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) { if (!didPop) _close(); },
      child: Scaffold(
        appBar: AppBar(title: Text(widget.kind.isSales ? tr('أمر بيع جديد', 'New sales order') : tr('أمر شراء جديد', 'New purchase order'))),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          if (_pending != null) Card(child: ListTile(
            title: Text(tr('لم يتأكد رد إنشاء الأمر؛ أعد المحاولة بنفس الطلب.', 'Order creation is unresolved; retry the same request.')),
            trailing: FilledButton(onPressed: _busy ? null : () => _send(_pending!), child: Text(tr('إعادة المحاولة', 'Retry'))),
          )),
          if (parties.hasError || items.hasError)
            Text(tr('تعذر تحميل الجهات أو الأصناف. أعد فتح الشاشة للمحاولة.', 'Could not load parties or items. Reopen the screen to retry.')),
          if (parties.isLoading || items.isLoading) const LinearProgressIndicator(),
          Form(key: _form, child: IgnorePointer(ignoring: disabled, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            DropdownButtonFormField<String>(
              key: ValueKey('party-$_party-${parties.hasValue}'),
              initialValue: (parties.value ?? <Json>[]).any((row) => text(row, 'id') == _party) ? _party : null, isExpanded: true,
              decoration: InputDecoration(labelText: widget.kind.isSales ? tr('العميل', 'Customer') : tr('المورد', 'Supplier')),
              items: [for (final party in parties.value ?? <Json>[])
                DropdownMenuItem(value: text(party, 'id'), child: Text('${text(party, 'code')} — ${text(party, _ar ? 'nameAr' : 'nameEn')}', overflow: TextOverflow.ellipsis))],
              onChanged: (value) { setState(() => _party = value); _changed(); },
              validator: (value) => value == null ? tr('مطلوب', 'Required') : null,
            ),
            TextFormField(controller: _date, onChanged: (_) => _changed(),
              decoration: InputDecoration(labelText: tr('تاريخ الأمر (YYYY-MM-DD)', 'Order date (YYYY-MM-DD)')),
              validator: (value) {
                final raw = (value ?? '').trim();
                final date = DateTime.tryParse(raw);
                if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(raw) || date == null ||
                    '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}' != raw) {
                  return tr('تاريخ غير صالح', 'Invalid date');
                }
                return null;
              }),
            TextFormField(controller: _notes, onChanged: (_) => _changed(), decoration: InputDecoration(labelText: tr('ملاحظات', 'Notes'))),
            const SizedBox(height: 12),
            for (final line in _lines) _lineEditor(line, items.value ?? <Json>[]),
            Align(alignment: AlignmentDirectional.centerStart, child: TextButton.icon(
              onPressed: () { setState(() => _lines.add(_OrderLine())); _changed(); },
              icon: const Icon(Icons.add), label: Text(tr('إضافة صنف', 'Add item')))),
            const SizedBox(height: 16),
            FilledButton(onPressed: parties.hasValue && items.hasValue && !disabled ? _save : null,
              child: Text(tr('حفظ مسودة الأمر', 'Save draft order'))),
          ]))),
        ]),
      ),
    );
  }

  Widget _lineEditor(_OrderLine line, List<Json> items) {
    final item = items.where((row) => text(row, 'id') == line.itemId).firstOrNull;
    final units = lineUnitsOf(item);
    return Card(key: ObjectKey(line), child: Padding(padding: const EdgeInsets.all(12), child: Column(children: [
      DropdownButtonFormField<String>(
        key: ValueKey('item-${line.itemId}-${items.isNotEmpty}'),
        initialValue: items.any((row) => text(row, 'id') == line.itemId) ? line.itemId : null, isExpanded: true,
        decoration: InputDecoration(labelText: tr('الصنف', 'Item')),
        items: [for (final row in items) DropdownMenuItem(value: text(row, 'id'),
          child: Text('${text(row, 'code')} — ${text(row, _ar ? 'nameAr' : 'nameEn')}', overflow: TextOverflow.ellipsis))],
        onChanged: (value) { setState(() { line.itemId = value; line.unitName = null; }); _changed(); },
        validator: (value) => value == null ? tr('مطلوب', 'Required') : null),
      if (item != null) DropdownButtonFormField<String>(
        key: ValueKey('unit-${line.itemId}-${line.unitName}'),
        initialValue: units.any((unit) => text(unit, 'unit') == line.unitName) ? line.unitName : null,
        validator: (_) => line.unitName != null && !units.any((unit) => text(unit, 'unit') == line.unitName)
          ? tr('اختر وحدة صالحة', 'Select an active unit') : null,
        decoration: InputDecoration(labelText: tr('الوحدة (الافتراضية إن تُركت فارغة)', 'Unit (default if blank)')),
        items: [for (final unit in units) DropdownMenuItem(value: text(unit, 'unit'), child: Text(text(unit, 'unit')))],
        onChanged: (value) { setState(() => line.unitName = value); _changed(); }),
      TextFormField(controller: line.quantity, onChanged: (_) => _changed(), keyboardType: TextInputType.number,
        decoration: InputDecoration(labelText: tr('الكمية', 'Quantity')), validator: (v) => _number(v, required: true, positive: true)),
      TextFormField(controller: line.price, onChanged: (_) => _changed(), keyboardType: TextInputType.number,
        decoration: InputDecoration(labelText: tr('السعر (فارغ لاستخدام السعر الافتراضي)', 'Price (blank uses default)')), validator: _number),
      TextFormField(controller: line.discount, onChanged: (_) => _changed(), keyboardType: TextInputType.number,
        decoration: InputDecoration(labelText: tr('الخصم %', 'Discount %')), validator: (v) => _number(v, percent: true)),
      TextFormField(controller: line.tax, onChanged: (_) => _changed(), keyboardType: TextInputType.number,
        decoration: InputDecoration(labelText: tr('الضريبة % (الفارغ صفر)', 'Tax % (blank is zero)')), validator: (v) => _number(v, percent: true)),
      if (_lines.length > 1) Align(alignment: AlignmentDirectional.centerEnd, child: TextButton(
        onPressed: () { setState(() => _lines.remove(line)); WidgetsBinding.instance.addPostFrameCallback((_) => line.dispose()); _changed(); }, child: Text(tr('حذف الصنف', 'Remove item')))),
    ])));
  }
}
