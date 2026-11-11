import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/network/api_client.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

/// The four things that move a lot, exactly as the server models them.
///
/// Each one is a separate endpoint with its own permission, so the dialog does
/// not decide what an operation means - `BatchesService` does, including FEFO
/// picking, the negative-stock guard and the duplicate-movement guard. The form
/// only collects the values the endpoint requires and shows what came back.
enum BatchOperation {
  receive,
  issue,
  transfer,
  writeOff;

  /// The path segment, and the key the permission is built from.
  String get slug => switch (this) {
    BatchOperation.receive => 'receive',
    BatchOperation.issue => 'issue',
    BatchOperation.transfer => 'transfer',
    BatchOperation.writeOff => 'write-off',
  };

  /// `inventory.batches.writeoff` has no separator in the permission name, so
  /// it cannot simply be derived from [slug].
  String get permission => switch (this) {
    BatchOperation.receive => 'inventory.batches.receive',
    BatchOperation.issue => 'inventory.batches.issue',
    BatchOperation.transfer => 'inventory.batches.transfer',
    BatchOperation.writeOff => 'inventory.batches.writeoff',
  };

  /// Writing off and transferring move a named lot. Receiving creates one, and
  /// issuing may either name a lot or let FEFO choose.
  bool get needsBatch =>
      this == BatchOperation.transfer || this == BatchOperation.writeOff;

  /// Receiving is the only operation that asks for a cost: every other one
  /// consumes a lot whose cost was frozen when it arrived.
  bool get needsCost => this == BatchOperation.receive;
}

/// Issues expired stock only for someone who may.
///
/// The server decides this from the token and overwrites whatever the body
/// says, so this is only used to decide whether the reason box is shown and
/// whether the warning is a warning or an error. The gate itself is server-side.
const expiredIssuePermission = 'inventory.batches.expired.issue';

/// What the operator typed, in the shape the endpoint expects.
///
/// Kept separate from the widget so the mapping can be checked without a
/// rendering pass: the numeric fields arrive as strings from the form, and the
/// server validates them with `@IsNumber`, which rejects a numeric string.
Map<String, dynamic> batchOperationBody({
  required BatchOperation operation,
  required String branchId,
  required String warehouseId,
  required String itemId,
  String? batchId,
  String? toWarehouseId,
  required String quantity,
  String? unitCost,
  String? reason,
  String? productionDate,
  String? expiryDate,
  String? storageLocationId,
  String? documentDate,
}) {
  final body = <String, dynamic>{
    'branchId': branchId,
    'itemId': itemId,
    'quantity': num.parse(quantity.trim()),
  };
  switch (operation) {
    case BatchOperation.receive:
      body['warehouseId'] = warehouseId;
      body['unitCost'] = num.parse((unitCost ?? '').trim());
    case BatchOperation.issue:
      body['warehouseId'] = warehouseId;
      if (batchId != null) body['batchId'] = batchId;
    case BatchOperation.transfer:
      body['fromWarehouseId'] = warehouseId;
      body['toWarehouseId'] = toWarehouseId;
      body['batchId'] = batchId;
    case BatchOperation.writeOff:
      body['warehouseId'] = warehouseId;
      body['batchId'] = batchId;
      // The endpoint requires a reason and stores it on the movement, so an
      // empty string is not the same as omitting it.
      body['reason'] = (reason ?? '').trim();
  }
  if (reason != null &&
      (operation == BatchOperation.issue ||
          operation == BatchOperation.transfer)) {
    final trimmed = reason.trim();
    if (trimmed.isNotEmpty) body['reason'] = trimmed;
  }
  if (operation == BatchOperation.receive) {
    if (productionDate != null && productionDate.trim().isNotEmpty) {
      body['productionDate'] = productionDate.trim();
    }
    if (expiryDate != null && expiryDate.trim().isNotEmpty) {
      body['expiryDate'] = expiryDate.trim();
    }
    if (storageLocationId != null && storageLocationId.isNotEmpty) {
      body['storageLocationId'] = storageLocationId;
    }
  }
  if (operation == BatchOperation.issue &&
      storageLocationId != null &&
      storageLocationId.isNotEmpty) {
    body['storageLocationId'] = storageLocationId;
  }
  if (documentDate != null && documentDate.trim().isNotEmpty) {
    body['documentDate'] = documentDate.trim();
  }
  return body;
}

/// Asks for the values one operation needs and posts them.
///
/// Returns true when the server accepted the call, so the caller can refresh.
/// Every failure is shown as the server described it: a permission error, an
/// insufficient balance and a duplicate request must not all read the same.
Future<bool> showBatchOperationDialog(
  BuildContext context, {
  required BatchOperation operation,
  required Json? batch,
  List<Json> items = const [],
  List<Json> warehouses = const [],
  List<Json> locations = const [],
}) async {
  final accepted = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _BatchOperationDialog(
      operation: operation,
      batch: batch,
      items: items,
      warehouses: warehouses,
      locations: locations,
    ),
  );
  return accepted ?? false;
}

class _BatchOperationDialog extends ConsumerStatefulWidget {
  const _BatchOperationDialog({
    required this.operation,
    required this.batch,
    required this.items,
    required this.warehouses,
    required this.locations,
  });

  final BatchOperation operation;
  final Json? batch;
  final List<Json> items;
  final List<Json> warehouses;
  final List<Json> locations;

  @override
  ConsumerState<_BatchOperationDialog> createState() =>
      _BatchOperationDialogState();
}

class _BatchOperationDialogState extends ConsumerState<_BatchOperationDialog> {
  final _form = GlobalKey<FormState>();
  final _quantity = TextEditingController();
  final _unitCost = TextEditingController();
  final _reason = TextEditingController();
  final _productionDate = TextEditingController();
  final _expiryDate = TextEditingController();

  String? _itemId;
  String? _warehouseId;
  String? _toWarehouseId;
  String? _locationId;
  bool _busy = false;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _label(String ar, String en) => _arabic ? ar : en;

  @override
  void initState() {
    super.initState();
    final batch = widget.batch;
    if (batch != null) {
      // The lot already answers three of the questions, so the operator is not
      // asked to retype an id that is visible on the row.
      _itemId = text(batch, 'itemId');
      _warehouseId = text(batch, 'warehouseId');
      _locationId = asString(batch['storageLocationId']);
      final remaining = asNum(batch['remainingQuantity']);
      if (remaining != null && remaining > 0) {
        _quantity.text = _trimZeros(remaining.toString());
      }
    } else {
      _itemId = widget.items.isEmpty ? null : text(widget.items.first, 'id');
      _warehouseId = widget.warehouses.isEmpty
          ? null
          : text(widget.warehouses.first, 'id');
    }
    if (widget.items.length == 1) _itemId = text(widget.items.first, 'id');
  }

  @override
  void dispose() {
    _quantity.dispose();
    _unitCost.dispose();
    _reason.dispose();
    _productionDate.dispose();
    _expiryDate.dispose();
    super.dispose();
  }

  static String _trimZeros(String value) {
    if (!value.contains('.')) return value;
    final trimmed = value.replaceFirst(RegExp(r'0+$'), '');
    return trimmed.endsWith('.')
        ? trimmed.substring(0, trimmed.length - 1)
        : trimmed;
  }

  String? _required(String? value) {
    if ((value ?? '').trim().isEmpty) return _label('مطلوب', 'Required');
    return null;
  }

  String? _number(String? raw, {bool allowZero = false}) {
    final value = (raw ?? '').trim();
    if (!RegExp(r'^\d+(?:\.\d{1,4})?$').hasMatch(value)) {
      return _label('رقم غير صالح', 'Invalid number');
    }
    final parsed = num.tryParse(value);
    if (parsed == null) return _label('رقم غير صالح', 'Invalid number');
    if (!allowZero && parsed <= 0) return _label('يجب أن يكون أكبر من صفر', 'Must be greater than zero');
    return null;
  }

  /// A date the server accepts: it stores `@db.Date`, so a full timestamp is
  /// not what it expects and a mistyped month must be caught here rather than
  /// returned as a 400 after the operator has filled the whole form.
  String? _date(String? value, {bool required = false}) {
    final raw = (value ?? '').trim();
    if (raw.isEmpty) return required ? _label('مطلوب', 'Required') : null;
    if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(raw)) {
      return _label('الصيغة YYYY-MM-DD', 'Format YYYY-MM-DD');
    }
    final parsed = DateTime.tryParse(raw);
    if (parsed == null) return _label('تاريخ غير صالح', 'Invalid date');
    return null;
  }

  Future<void> _submit() async {
    if (_busy || !(_form.currentState?.validate() ?? false)) return;
    final user = ref.read(currentUserProvider);
    final branchId = user?.branchId ?? text(widget.batch ?? const {}, 'branchId');
    if (branchId.isEmpty) {
      _fail(_label('لا يوجد فرع للمستخدم', 'The user has no branch'));
      return;
    }
    final operation = widget.operation;
    if (operation.needsBatch && (widget.batch == null || _itemId == null)) {
      _fail(_label('اختر دفعة أولًا', 'Choose a lot first'));
      return;
    }
    // A lot always names its item and warehouse; a form opened without either
    // would otherwise post empty strings that the endpoint rejects as a 400.
    if ((_itemId ?? '').isEmpty || (_warehouseId ?? '').isEmpty) {
      _fail(_label('اختر الصنف والمستودع', 'Choose the item and warehouse'));
      return;
    }
    if (operation == BatchOperation.transfer &&
        (_toWarehouseId == null || _toWarehouseId == _warehouseId)) {
      _fail(
        _label(
          'اختر مستودعًا مختلفًا للتحويل',
          'Choose a different destination warehouse',
        ),
      );
      return;
    }
    final Map<String, dynamic> body;
    try {
      body = batchOperationBody(
        operation: operation,
        branchId: branchId,
        warehouseId: _warehouseId ?? '',
        itemId: _itemId ?? '',
        batchId: operation == BatchOperation.issue
            ? (widget.batch == null ? null : text(widget.batch!, 'id'))
            : text(widget.batch ?? const {}, 'id').isEmpty
            ? null
            : text(widget.batch!, 'id'),
        toWarehouseId: _toWarehouseId,
        quantity: _quantity.text,
        unitCost: _unitCost.text,
        reason: _reason.text,
        productionDate: _productionDate.text,
        expiryDate: _expiryDate.text,
        storageLocationId: _locationId,
      );
    } on FormatException {
      _fail(_label('رقم غير صالح', 'Invalid number'));
      return;
    }
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .post('/inventory/batches/${operation.slug}', body: body);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      // The server's own sentence: "insufficient balance", "lot is expired",
      // "a grant is required". Replacing it with a generic failure would hide
      // which of those the operator has to act on.
      _fail(_messageFor(error));
    }
  }

  String _messageFor(Object error) {
    if (error is Failure) return error.message;
    return error.toString();
  }

  void _fail(String message) {
    if (!mounted) return;
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(context.l10n.okAction),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final operation = widget.operation;
    final user = ref.watch(currentUserProvider);
    final mayIssueExpired = user?.can(expiredIssuePermission) ?? false;
    final expiry = asString(widget.batch?['expiryDate']);
    final days = asNum(widget.batch?['daysToExpiry']);
    final expired = days != null && days < 0;

    return AlertDialog(
      title: Text(switch (operation) {
        BatchOperation.receive => _label('استلام دفعة', 'Receive a batch'),
        BatchOperation.issue => _label('صرف من دفعة', 'Issue from a batch'),
        BatchOperation.transfer => _label('تحويل دفعة', 'Transfer a batch'),
        BatchOperation.writeOff => _label('شطب دفعة', 'Write off a batch'),
      }),
      content: SizedBox(
        width: 460,
        child: Form(
          key: _form,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (widget.batch != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: Text(
                        '${text(widget.batch!, 'batchNumber')} • '
                        '${formatQuantity(asString(widget.batch!['remainingQuantity']))}'
                        '${expiry != null && expiry.isNotEmpty ? ' • ${expiry.split('T').first}' : ''}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                  ),
                if (expired && operation == BatchOperation.issue)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      mayIssueExpired
                          ? _label(
                              'هذه الدفعة منتهية. الصرف مسموح بصلاحيتك، وسيُسجَّل السبب.',
                              'This lot has expired. Your permission allows the '
                                  'issue and the reason will be recorded.',
                            )
                          : _label(
                              'هذه الدفعة منتهية ولا تملك صلاحية صرف المنتهي.',
                              'This lot has expired and you may not issue '
                                  'expired stock.',
                            ),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        // Both branches are a warning colour, but they are not
                        // the same message: one says the issue is allowed and
                        // the reason will be recorded, the other says it is
                        // not. Keeping the error tone on both is deliberate -
                        // an expired lot is never ordinary stock.
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                // The item is fixed whenever the dialog was opened from a row,
                // because a lot belongs to exactly one item.
                if (widget.batch == null)
                  DropdownButtonFormField<String>(
                    initialValue: _itemId,
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: _label('الصنف', 'Item'),
                    ),
                    items: [
                      for (final row in widget.items)
                        DropdownMenuItem(
                          value: text(row, 'id'),
                          child: Text(
                            '${text(row, 'code')} • ${_itemName(row)}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                    onChanged: (value) => setState(() => _itemId = value),
                    validator: _required,
                  ),
                if (widget.batch == null && operation != BatchOperation.transfer)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: _warehouseField(
                      label: _label('المستودع', 'Warehouse'),
                      value: _warehouseId,
                      // Switching warehouse must drop the shelf: the one that
                      // was chosen belongs to the old warehouse and the server
                      // would refuse it.
                      onChanged: (value) => setState(() {
                        _warehouseId = value;
                        _locationId = null;
                      }),
                    ),
                  ),
                if (operation == BatchOperation.transfer) ...[
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: _warehouseField(
                      label: _label('من مستودع', 'From warehouse'),
                      value: _warehouseId,
                      onChanged: (value) =>
                          setState(() => _warehouseId = value),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: _warehouseField(
                      label: _label('إلى مستودع', 'To warehouse'),
                      value: _toWarehouseId,
                      onChanged: (value) =>
                          setState(() => _toWarehouseId = value),
                    ),
                  ),
                ],
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: TextFormField(
                    controller: _quantity,
                    decoration: InputDecoration(
                      labelText: _label('الكمية', 'Quantity'),
                    ),
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    validator: _number,
                  ),
                ),
                if (operation.needsCost)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: TextFormField(
                      controller: _unitCost,
                      decoration: InputDecoration(
                        labelText: _label(
                          'تكلفة الوحدة',
                          'Unit cost',
                        ),
                      ),
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      // A zero cost is legitimate (a free sample, a donated
                      // pallet), so this one accepts zero.
                      validator: (value) => _number(value, allowZero: true),
                    ),
                  ),
                if (operation == BatchOperation.receive) ...[
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: TextFormField(
                      controller: _productionDate,
                      decoration: InputDecoration(
                        labelText: _label(
                          'تاريخ الإنتاج (اختياري)',
                          'Production date (optional)',
                        ),
                        hintText: 'YYYY-MM-DD',
                      ),
                      keyboardType: TextInputType.datetime,
                      validator: _date,
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: TextFormField(
                      controller: _expiryDate,
                      decoration: InputDecoration(
                        labelText: _label(
                          'تاريخ الانتهاء (اختياري)',
                          'Expiry date (optional)',
                        ),
                        hintText: 'YYYY-MM-DD',
                      ),
                      keyboardType: TextInputType.datetime,
                      validator: _date,
                    ),
                  ),
                ],
                if ((operation == BatchOperation.receive ||
                        (operation == BatchOperation.issue &&
                            widget.batch != null)) &&
                    _warehouseId != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: _shelfField(_warehouseId!),
                  ),
                if (operation == BatchOperation.writeOff ||
                    operation == BatchOperation.transfer ||
                    operation == BatchOperation.issue)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: TextFormField(
                      controller: _reason,
                      decoration: InputDecoration(
                        labelText: operation == BatchOperation.writeOff
                            ? _label('السبب', 'Reason')
                            : _label('السبب (اختياري)', 'Reason (optional)'),
                      ),
                      maxLines: 2,
                      validator: operation == BatchOperation.writeOff
                          ? _required
                          : null,
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(false),
          child: Text(context.l10n.cancel),
        ),
        FilledButton(
          onPressed: _busy ? null : _submit,
          child: _busy
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(switch (operation) {
                  BatchOperation.receive => _label('استلام', 'Receive'),
                  BatchOperation.issue => _label('صرف', 'Issue'),
                  BatchOperation.transfer => _label('تحويل', 'Transfer'),
                  BatchOperation.writeOff => _label('شطب', 'Write off'),
                }),
        ),
      ],
    );
  }

  /// The shelves of the selected warehouse, read from the server.
  ///
  /// A shelf from another warehouse would be refused on receipt, so the list is
  /// narrowed to the one the goods go into. The prefetched `widget.locations`
  /// is used as the first answer and the narrowed query replaces it.
  Widget _shelfField(String warehouseId) {
    final prefetched = widget.locations
        .where(
          (row) =>
              asString(row['warehouseId']) == null ||
              asString(row['warehouseId']) == warehouseId,
        )
        .toList(growable: false);
    return Consumer(
      builder: (context, ref, _) {
        final shelves = ref.watch(batchShelvesOfProvider(warehouseId));
        final rows = shelves.value ?? prefetched;
        return DropdownButtonFormField<String>(
          initialValue: rows.any((row) => text(row, 'id') == _locationId)
              ? _locationId
              : null,
          isExpanded: true,
          decoration: InputDecoration(
            labelText: _label(
              'موقع التخزين (اختياري)',
              'Storage location (optional)',
            ),
          ),
          items: [
            for (final row in rows)
              DropdownMenuItem(
                value: text(row, 'id'),
                child: Text(
                  '${text(row, 'code')} • ${_locationName(row)}',
                  overflow: TextOverflow.ellipsis,
                ),
              ),
          ],
          onChanged: (value) => setState(() => _locationId = value),
        );
      },
    );
  }

  Widget _warehouseField({
    required String label,
    required String? value,
    required ValueChanged<String?> onChanged,
  }) {
    return DropdownButtonFormField<String>(
      initialValue: widget.warehouses.any((row) => text(row, 'id') == value)
          ? value
          : null,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: [
        for (final row in widget.warehouses)
          DropdownMenuItem(
            value: text(row, 'id'),
            child: Text(
              '${text(row, 'code')} • ${_arabic ? text(row, 'nameAr') : text(row, 'nameEn')}',
              overflow: TextOverflow.ellipsis,
            ),
          ),
      ],
      onChanged: onChanged,
      validator: _required,
    );
  }

  String _itemName(Json row) => _arabic ? text(row, 'nameAr') : text(row, 'nameEn');
  String _locationName(Json row) =>
      _arabic ? text(row, 'nameAr') : text(row, 'nameEn');
}

/// The warehouses and shelves the forms offer.
///
/// Both are read through the resources the rest of the app already uses, so a
/// grant decision made on the server is not second-guessed here.
final batchOperationWarehousesProvider =
    FutureProvider<List<Json>>((ref) async {
      final user = ref.watch(currentUserProvider);
      if (user?.branchId == null) return const [];
      return ref
          .read(apiClientProvider)
          .getList('/inventory/warehouses', query: {'branchId': user!.branchId});
    });

/// A first guess at the shelves, before a warehouse is known.
///
/// The dialog does not trust this list for receiving: `_shelfField` narrows it
/// to the chosen warehouse through [batchShelvesOfProvider], because a shelf
/// from another warehouse is refused on receipt. This one only fills the list
/// until that answer arrives, and for issuing out of a lot that already names
/// its shelf.
final batchOperationLocationsProvider = FutureProvider<List<Json>>((ref) async {
  return ref.read(apiClientProvider).getList('/inventory/locations');
});

/// The shelves of one warehouse.
///
/// Receiving validates that the shelf belongs to the warehouse it is put into,
/// so offering every shelf in the company would let the operator pick one the
/// server then rejects - after they have filled the form. Asking the server for
/// that warehouse's shelves means the list cannot offer an invalid choice.
final batchShelvesOfProvider =
    FutureProvider.family<List<Json>, String>((ref, warehouseId) async {
      if (warehouseId.isEmpty) return const [];
      return ref
          .read(apiClientProvider)
          .getList('/inventory/locations', query: {'warehouseId': warehouseId});
    });
