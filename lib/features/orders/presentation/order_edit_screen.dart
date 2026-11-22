import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../app/router/draft_exit_guard.dart';
import '../../../core/error/failure.dart';
import '../../../core/json/json_utils.dart';
import '../../../shared/widgets/confirm_dialog.dart';
import '../../auth/presentation/providers/auth_providers.dart';
import '../../common/presentation/screens/module_scaffold.dart';
import '../../invoicing/presentation/providers/invoice_providers.dart';
import 'order_retry_store.dart';

class _EditableLine {
  _EditableLine(Json line) : id = text(line, 'id'),
    name = text(line, 'itemNameEn', fallback: text(line, 'itemCode')),
    unit = text(line, 'unit'),
    quantity = TextEditingController(text: text(line, 'unitQuantity')),
    price = TextEditingController(text: text(line, 'unitPrice')),
    discount = TextEditingController(text: text(line, 'discountPercent')),
    tax = TextEditingController(text: text(line, 'taxRate')),
    allocated = Decimal.tryParse(text(line, 'invoicedQuantity'));
  final String id, name, unit;
  final TextEditingController quantity, price, discount, tax;
  final Decimal? allocated;
  void dispose() { quantity.dispose(); price.dispose(); discount.dispose(); tax.dispose(); }
}

/// Edits existing lines; approved amendments preserve allocated financial terms.
class OrderEditScreen extends ConsumerStatefulWidget {
  const OrderEditScreen({super.key, required this.kind, required this.order, this.amendApproved = false, this.exitRelay});
  final DraftExitRelay? exitRelay;
  final bool amendApproved;
  final InvoiceKind kind;
  final Json order;
  @override
  ConsumerState<OrderEditScreen> createState() => _OrderEditScreenState();
}

class _OrderEditScreenState extends ConsumerState<OrderEditScreen> {
  final _form = GlobalKey<FormState>();
  late final List<_EditableLine> _lines;
  OrderRetryStore? _store;
  String? _scope;
  Map<String, dynamic>? _pending;
  bool _busy = false, _dirty = false, _confirming = false, _stale = false;
  bool get _ar => Localizations.localeOf(context).languageCode == 'ar';
  String tr(String ar, String en) => _ar ? ar : en;
  String get _path => '${widget.kind.isSales ? '/sales/orders' : '/purchases/orders'}/${text(widget.order, 'id')}${widget.amendApproved ? '/amend' : ''}';

  @override
  void initState() {
    super.initState();
    _lines = listOf(widget.order['lines']).map(_EditableLine.new).toList();
    widget.exitRelay?.attach(_confirmExit);
    _loadPending();
  }

  Future<void> _loadPending() async {
    try {
      final user = ref.read(currentUserProvider);
      if (user == null || user.branchId == null) throw StateError('No user branch');
      final config = ref.read(appConfigProvider);
      final scope = orderRetryScope(apiBaseUrl: config.apiBaseUrl, embeddedLocalServer: config.embeddedLocalServer,
        companyId: user.companyId, branchId: user.branchId!, userId: user.id,
        kind: widget.kind.name, orderId: text(widget.order, 'id'));
      final store = OrderRetryStore(await SharedPreferences.getInstance());
      if (!mounted) return;
      final pending = store.read(scope);
      if (pending != null) {
        if (pending['method'] != 'PUT' || pending['path'] != _path || pending['body'] is! Map) {
          throw const FormatException('A different order request is pending');
        }
        final body = Map<String, dynamic>.from(pending['body'] as Map);
        final restored = listOf(body['lines']);
        if (restored.length != _lines.length) throw const FormatException('Invalid pending order lines');
        for (final line in _lines) {
          final matches = restored.where((row) => text(row, 'orderLineId') == line.id).toList();
          if (matches.length != 1) throw const FormatException('Invalid pending order lines');
          final row = matches.single;
          line.quantity.text = text(row, 'quantity'); line.price.text = text(row, 'unitPrice');
          line.discount.text = text(row, 'discountPercent'); line.tax.text = text(row, 'taxRate');
        }
        _dirty = true;
      }
      if (mounted) setState(() { _store = store; _scope = scope; _pending = pending; });
    } catch (error) { if (mounted) showMessage(context, error, error: true); }
  }

  @override
  void dispose() { widget.exitRelay?.detach(_confirmExit); for (final line in _lines) { line.dispose(); } super.dispose(); }
  void _changed() { if (!_dirty) setState(() => _dirty = true); }
  Future<bool> _confirmExit() async {
    if (_busy || _confirming) return false;
    if (!_dirty || _pending != null) return true;
    _confirming = true;
    try {
      final discard = await confirmAction(context, title: tr('تغييرات غير محفوظة', 'Unsaved changes'),
        message: tr('هل تريد الخروج دون حفظ التعديلات؟', 'Leave without saving changes?'),
        confirmLabel: tr('الخروج دون حفظ', 'Discard changes'), destructive: true);
      return discard && mounted;
    } finally { _confirming = false; }
  }
  Future<void> _close() async {
    if (await _confirmExit() && mounted) Navigator.of(context).pop();
  }

  String? _number(String? raw, {bool positive = false, bool percent = false, bool allowEmpty = false}) {
    final value = (raw ?? '').trim();
    if (allowEmpty && value.isEmpty) return null;
    if (!RegExp(r'^\d+(?:\.\d{1,4})?$').hasMatch(value)) return tr('رقم غير صالح', 'Invalid number');
    final parsed = Decimal.tryParse(value);
    if (parsed == null || (positive && parsed <= Decimal.zero) || (percent && parsed > Decimal.fromInt(100))) {
      return tr('رقم غير صالح', 'Invalid number');
    }
    return null;
  }

  Future<void> _save() async {
    if (_busy || _pending != null || _store == null || _scope == null || _lines.isEmpty) return;
    if (!(_form.currentState?.validate() ?? false)) return;
    final body = <String, dynamic>{'expectedUpdatedAt': text(widget.order, 'updatedAt'),
      'lines': [for (final line in _lines) <String, dynamic>{
        'orderLineId': line.id, 'quantity': line.quantity.text.trim(), 'unitPrice': line.price.text.trim(),
        'discountPercent': line.discount.text.trim(),
        'taxRate': line.tax.text.trim().isEmpty ? '0' : line.tax.text.trim(),
      }]};
    setState(() => _busy = true);
    try {
      final request = await _store!.begin(_scope!, method: 'PUT', path: _path, body: body);
      if (mounted) await _send(request);
    } catch (error) { if (mounted) showMessage(context, error, error: true); }
    finally { if (mounted) setState(() => _busy = false); }
  }

  Future<void> _send(Map<String, dynamic> request) async {
    setState(() { _busy = true; _pending = request; });
    try {
      if (request['method'] != 'PUT' || request['path'] != _path) throw const FormatException('Invalid pending order edit');
      final body = Map<String, dynamic>.from(request['body'] as Map);
      final result = await ref.read(apiClientProvider).put(_path, body: body);
      if (text(result, 'id') != text(widget.order, 'id')) throw const FormatException('Invalid order response');
      await _store!.complete(_scope!);
      if (!mounted) return;
      _dirty = false;
      Navigator.of(context).pop(true);
    } on Failure catch (error) {
      if (error is ApiFailure && (const {400, 422}.contains(error.statusCode) ||
          (error.statusCode == 409 && error.code == 'ORDER_EDIT_STALE'))) {
        await _store!.complete(_scope!);
        if (mounted) setState(() { _pending = null; _stale = error.code == 'ORDER_EDIT_STALE'; });
      }
      if (mounted) showMessage(context, error, error: true);
    } catch (error) { if (mounted) showMessage(context, error, error: true); }
    finally { if (mounted) setState(() => _busy = false); }
  }

  @override
  Widget build(BuildContext context) {
    final disabled = _busy || _store == null || _pending != null;
    return PopScope(canPop: false, onPopInvokedWithResult: (didPop, _) { if (!didPop) _close(); },
      child: Scaffold(appBar: AppBar(title: Text(widget.amendApproved
        ? tr('تعديل الأمر المعتمد', 'Amend approved order') : tr('تعديل مسودة الأمر', 'Edit draft order'))),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          Text(tr('لا يمكن تغيير الأصناف أو الوحدات؛ تُحفظ معاملات الوحدات التاريخية.',
            'Items and units cannot be changed; historical unit factors are preserved.')),
          if (widget.amendApproved) Text(tr('لا يجوز تقليل الكمية عن المخصص، أو تغيير سعر أو خصم أو ضريبة سطر خُصصت له فاتورة.',
            'Quantity cannot fall below allocations. Price, discount and tax of allocated lines are locked.')),
          if (_stale) Text(tr('تغير الأمر؛ احتفظ بالقيم للمراجعة ثم ارجع وأعد فتحه من البيانات المحدثة.',
            'The order changed. Review your values, then go back and reopen the refreshed order.')),
          if (_pending != null) Card(child: ListTile(
            title: Text(tr('لم يتأكد رد تعديل الأمر؛ أعد المحاولة بنفس الطلب.', 'Order edit is unresolved; retry the same request.')),
            trailing: FilledButton(onPressed: _busy ? null : () => _send(_pending!), child: Text(tr('إعادة المحاولة', 'Retry'))),
          )),
          Form(key: _form, child: IgnorePointer(ignoring: disabled, child: Column(children: [
            for (final line in _lines) Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(children: [
              Text('${line.name} • ${line.unit}'),
              if (widget.amendApproved) Text('${tr('المخصص بالوحدة الأساسية', 'Allocated in base units')}: ${line.allocated ?? '—'}'),
              TextFormField(controller: line.quantity, onChanged: (_) => _changed(), keyboardType: TextInputType.number,
                decoration: InputDecoration(labelText: tr('الكمية', 'Quantity')), validator: (v) => _number(v, positive: true)),
              TextFormField(controller: line.price, enabled: !widget.amendApproved || (line.allocated != null && line.allocated == Decimal.zero),
                onChanged: (_) => _changed(), keyboardType: TextInputType.number,
                decoration: InputDecoration(labelText: tr('السعر', 'Price')), validator: _number),
              TextFormField(controller: line.discount, enabled: !widget.amendApproved || (line.allocated != null && line.allocated == Decimal.zero),
                onChanged: (_) => _changed(), keyboardType: TextInputType.number,
                decoration: InputDecoration(labelText: tr('الخصم %', 'Discount %')), validator: (v) => _number(v, percent: true)),
              TextFormField(controller: line.tax, enabled: !widget.amendApproved || (line.allocated != null && line.allocated == Decimal.zero),
                onChanged: (_) => _changed(), keyboardType: TextInputType.number,
                decoration: InputDecoration(labelText: tr('الضريبة %', 'Tax %')), validator: (v) => _number(v, percent: true, allowEmpty: true)),
            ]))),
            FilledButton(onPressed: disabled || _stale || _lines.isEmpty || text(widget.order, 'updatedAt').isEmpty ? null : _save,
              child: Text(tr('حفظ التعديلات', 'Save changes'))),
          ]))),
        ]),
      ));
  }
}
