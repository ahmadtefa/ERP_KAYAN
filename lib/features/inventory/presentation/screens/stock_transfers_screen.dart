import '../../../../shared/widgets/persistent_table_scroll.dart';

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/network/api_client.dart';
import '../../../auth/domain/entities/app_user.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
import '../../../../shared/barcode/barcode_scan.dart';

final stockTransfersProvider =
    AsyncNotifierProvider<StockTransfersController, List<Json>>(
      StockTransfersController.new,
    );

class StockTransfersController extends AsyncNotifier<List<Json>> {
  @override
  Future<List<Json>> build() =>
      ref.read(apiClientProvider).getList('/inventory/stock-transfers');
  Future<void> reload() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(
      () => ref.read(apiClientProvider).getList('/inventory/stock-transfers'),
    );
  }
}

class StockTransfersScreen extends ConsumerStatefulWidget {
  const StockTransfersScreen({super.key});
  @override
  ConsumerState<StockTransfersScreen> createState() =>
      _StockTransfersScreenState();
}

class _StockTransfersScreenState extends ConsumerState<StockTransfersScreen> {
  bool _busy = false;
  String _query = '';
  String? _lastNotificationTransfer;
  bool get ar => Localizations.localeOf(context).languageCode == 'ar';
  String t(String a, String e) => ar ? a : e;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final transferId = GoRouterState.of(context)
        .uri
        .queryParameters['transferId'];
    if (transferId == null || transferId.isEmpty) {
      _lastNotificationTransfer = null;
      return;
    }
    if (_lastNotificationTransfer == transferId) return;
    _lastNotificationTransfer = transferId;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_openNotificationTransfer(transferId));
    });
  }

  Future<void> _openNotificationTransfer(String id) async {
    await _details({'id': id});
    if (!mounted) return;
    if (GoRouterState.of(context).uri.queryParameters['transferId'] == id) {
      context.go('/inventory/stock-transfers');
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = ref.watch(stockTransfersProvider);
    final user = ref.watch(currentUserProvider);
    return ModuleScaffold(
      title: t('التحويلات المخزنية', 'Stock transfers'),
      eyebrow: t('المخزون', 'Inventory'),
      trailing: Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          SizedBox(
            width: 190,
            child: TextField(
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search),
                hintText: t('بحث', 'Search'),
                isDense: true,
              ),
              onChanged: (v) => setState(() => _query = v.trim().toLowerCase()),
            ),
          ),
          IconButton(
            tooltip: t('تحديث', 'Refresh'),
            onPressed: () => ref.read(stockTransfersProvider.notifier).reload(),
            icon: const Icon(Icons.refresh),
          ),
          if (user?.can('inventory.transfer.report') ?? false)
            IconButton(
              tooltip: t('تقرير التحويلات والطريق', 'Transfer/transit report'),
              onPressed: _report,
              icon: const Icon(Icons.assessment_outlined),
            ),
          if (user?.can('inventory.transfer.create') ?? false)
            FilledButton.icon(
              onPressed: _busy ? null : _create,
              icon: const Icon(Icons.add),
              label: Text(t('طلب تحويل', 'Request transfer')),
            ),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: rows,
        onRetry: () => ref.read(stockTransfersProvider.notifier).reload(),
        isEmpty: (x) => _visible(x).isEmpty,
        emptyMessage: t('لا توجد تحويلات مخزنية.', 'No stock transfers yet.'),
        data: (items) => ListView.separated(
          padding: const EdgeInsets.all(12),
          itemCount: _visible(items).length,
          separatorBuilder: (_, _) => const SizedBox(height: 8),
          itemBuilder: (context, i) {
            final row = _visible(items)[i];
            final from = row['sourceWarehouse'] as Map? ?? const {},
                to = row['destinationWarehouse'] as Map? ?? const {};
            return Card(
              child: ListTile(
                isThreeLine: true,
                title: Wrap(
                  spacing: 8,
                  children: [
                    Text(
                      text(row, 'documentNumber'),
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                    Chip(
                      label: Text(_status(text(row, 'status'))),
                      visualDensity: VisualDensity.compact,
                    ),
                  ],
                ),
                subtitle: Text(
                  '${ar ? (from['nameAr'] ?? from['nameEn']) : (from['nameEn'] ?? from['nameAr'])}  →  ${ar ? (to['nameAr'] ?? to['nameEn']) : (to['nameEn'] ?? to['nameAr'])}\n${text(row, 'transferDate').split('T').first} · ${(row['lines'] as List? ?? const []).length} ${t('بنود', 'lines')}',
                ),
                trailing: IconButton(
                  tooltip: t('التفاصيل', 'Details'),
                  icon: const Icon(Icons.open_in_new),
                  onPressed: () => _details(row),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  List<Json> _visible(List<Json> rows) => rows
      .where(
        (r) =>
            _query.isEmpty ||
            '${r['documentNumber']} ${r['reason']} ${r['status']}'
                .toLowerCase()
                .contains(_query),
      )
      .toList();
  String _status(String s) => switch (s) {
    'DRAFT' => t('مسودة', 'Draft'),
    'REVIEWED' => t('قيد المراجعة', 'Reviewed'),
    'PENDING_APPROVAL' => t('بانتظار الاعتماد', 'Pending approval'),
    'APPROVED' => t('معتمد', 'Approved'),
    'DISPATCHING' => t('جارٍ التسليم', 'Dispatching'),
    'RECEIVING' => t('جارٍ الاستلام', 'Receiving'),
    'SETTLING' => t('جارٍ التسوية', 'Settling'),
    'PARTIALLY_DISPATCHED' => t('تسليم جزئي', 'Partially dispatched'),
    'DISPATCHED' => t('تم التسليم', 'Dispatched'),
    'PARTIALLY_RECEIVED' => t('استلام جزئي', 'Partially received'),
    'RECEIVED' => t('تم الاستلام', 'Received'),
    'SETTLEMENT_PENDING' => t(
      'إعدام بانتظار الاعتماد',
      'Write-off approval pending',
    ),
    'SETTLED' => t('تمت التسوية', 'Settled'),
    'CLOSED' => t('مغلق', 'Closed'),
    'REJECTED' => t('مرفوض', 'Rejected'),
    'CANCELLED' => t('ملغى', 'Cancelled'),
    _ => s,
  };
  Future<void> _create() async {
    try {
      final api = ref.read(apiClientProvider);
      final warehouses = await api.getList('/inventory/warehouses');
      final items = await api.getList('/inventory/items');
      final batches = await api.getList('/inventory/batches');
      if (!mounted) return;
      String? lastBody;
      String lastKey = '';
      // The dialog sends the request itself, so a refusal leaves it open with
      // everything typed. The same body keeps the same key (a retry after an
      // uncertain answer cannot double-create); a changed body gets a new one.
      Future<Object?> submit(Json body) async {
        final encoded = jsonEncode(body);
        if (encoded != lastBody) {
          lastBody = encoded;
          lastKey = 'create-${DateTime.now().microsecondsSinceEpoch}';
        }
        try {
          await api.post(
            '/inventory/stock-transfers',
            body: body,
            idempotencyKey: lastKey,
          );
          return null;
        } catch (e) {
          return e;
        }
      }

      final created = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (_) => _CreateTransferDialog(
          ar: ar,
          warehouses: warehouses,
          items: items,
          batches: batches,
          api: api,
          submit: submit,
        ),
      );
      if (created != true || !mounted) return;
      setState(() => _busy = true);
      await ref.read(stockTransfersProvider.notifier).reload();
    } catch (e) {
      if (mounted) _msg(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _details(Json row) async {
    final changed = await showDialog<bool>(
      context: context,
      builder: (_) => _TransferDialog(id: text(row, 'id'), ar: ar),
    );
    if (changed == true && mounted) {
      await ref.read(stockTransfersProvider.notifier).reload();
    }
  }

  Future<void> _report() async {
    try {
      final report = await ref
          .read(apiClientProvider)
          .getObject('/inventory/stock-transfers/report');
      if (!mounted) return;
      final rows = (report['rows'] as List? ?? const [])
          .whereType<Map>()
          .toList();
      await showDialog<void>(
        context: context,
        builder: (_) => AlertDialog(
          title: Text(
            t('تقرير التحويلات والأرصدة بالطريق', 'Transfers & transit report'),
          ),
          content: SizedBox(
            width: 760,
            child: HorizontalScrollFrame(
              child: DataTable(
                columns: [
                  DataColumn(label: Text(t('رقم', 'Number'))),
                  DataColumn(label: Text(t('الحالة', 'Status'))),
                  DataColumn(label: Text(t('مرسل', 'Dispatched'))),
                  DataColumn(label: Text(t('مستلم', 'Received'))),
                  DataColumn(label: Text(t('بالطريق', 'In transit'))),
                  DataColumn(label: Text(t('فروق', 'Differences'))),
                ],
                rows: rows
                    .map(
                      (row) => DataRow(
                        cells: [
                          DataCell(Text('${row['documentNumber']}')),
                          DataCell(Text(_status('${row['status']}'))),
                          DataCell(Text('${row['dispatched']}')),
                          DataCell(Text('${row['received']}')),
                          DataCell(Text('${row['inTransit']}')),
                          DataCell(Text('${row['differences']}')),
                        ],
                      ),
                    )
                    .toList(),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(t('إغلاق', 'Close')),
            ),
          ],
        ),
      );
    } catch (e) {
      if (mounted) _msg(e.toString());
    }
  }

  void _msg(String s) => ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(s), behavior: SnackBarBehavior.floating),
  );
}

class _DraftLine {
  String? itemId, batchId, unitName;
  final quantity = TextEditingController(text: '1');
  void dispose() => quantity.dispose();
}

class _CreateTransferDialog extends StatefulWidget {
  const _CreateTransferDialog({
    required this.ar,
    required this.warehouses,
    required this.items,
    required this.batches,
    required this.api,
    required this.submit,
  });

  /// Sends the request; returns null on success or the error.
  final Future<Object?> Function(Json body) submit;
  final bool ar;
  final List<Json> warehouses, items, batches;
  final ApiClient api;
  @override
  State<_CreateTransferDialog> createState() => _CreateTransferDialogState();
}

class _CreateTransferDialogState extends State<_CreateTransferDialog> {
  final _reason = TextEditingController(),
      _notes = TextEditingController(),
      _barcode = TextEditingController();
  final List<_DraftLine> _lines = [_DraftLine()];
  late final List<Json> _items = List<Json>.of(widget.items);
  String? _from, _to;
  bool _scanning = false, _sending = false;
  final _errors = <String, String>{};
  void _clear(String key) {
    if (_errors.remove(key) != null) setState(() {});
  }

  bool get ar => widget.ar;
  String t(String a, String e) => ar ? a : e;
  @override
  void dispose() {
    _reason.dispose();
    _notes.dispose();
    _barcode.dispose();
    for (final line in _lines) {
      line.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(t('طلب تحويل مخزني', 'Request stock transfer')),
    content: SizedBox(
      width: 920,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: _from,
              decoration: InputDecoration(
                labelText: t('من المخزن', 'Source warehouse'),
                errorText: _errors['sourceWarehouseId'],
              ),
              items: widget.warehouses
                  .map(
                    (w) => DropdownMenuItem(
                      value: text(w, 'id'),
                      child: Text(
                        '${text(w, 'code')} · ${ar ? text(w, 'nameAr') : text(w, 'nameEn')}',
                      ),
                    ),
                  )
                  .toList(),
              onChanged: (v) {
                _errors.remove('sourceWarehouseId');
                setState(() => _from = v);
              },
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              initialValue: _to,
              decoration: InputDecoration(
                labelText: t('إلى المخزن', 'Destination warehouse'),
                errorText: _errors['destinationWarehouseId'],
              ),
              items: widget.warehouses
                  .map(
                    (w) => DropdownMenuItem(
                      value: text(w, 'id'),
                      child: Text(
                        '${text(w, 'code')} · ${ar ? text(w, 'nameAr') : text(w, 'nameEn')}',
                      ),
                    ),
                  )
                  .toList(),
              onChanged: (v) {
                _errors.remove('destinationWarehouseId');
                setState(() => _to = v);
              },
            ),
            const SizedBox(height: 12),
            BarcodeScanField(
              controller: _barcode,
              arabic: ar,
              enabled: !_scanning,
              label: t('مسح لإضافة صنف أو وحدة', 'Scan to add item or unit'),
              onSubmitted: _scan,
            ),
            const SizedBox(height: 10),
            ..._lines.asMap().entries.map((entry) {
              final index = entry.key, line = entry.value;
              final item = _items.cast<Json?>().firstWhere(
                (x) => x?['id'] == line.itemId,
                orElse: () => null,
              );
              final units = (item?['units'] as List? ?? const [])
                  .whereType<Map>()
                  .map((e) => Map<String, dynamic>.from(e))
                  .where((u) => u['isActive'] != false)
                  .toList();
              final selectedUnits = units.isNotEmpty
                  ? units
                  : <Json>[
                      {'unit': item?['unit'] ?? ''},
                    ];
              final lots = widget.batches
                  .where(
                    (b) =>
                        b['warehouseId'] == _from &&
                        b['itemId'] == line.itemId &&
                        (double.tryParse('${b['remainingQuantity']}') ?? 0) > 0,
                  )
                  .toList();
              return Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    SizedBox(
                      width: 270,
                      child: DropdownButtonFormField<String>(
                        initialValue: line.itemId,
                        decoration: InputDecoration(
                          labelText: t('الصنف', 'Item'),
                          errorText: _errors['lines.$index.itemId'],
                        ),
                        items: _items.map((x) {
                          final barcode = text(x, 'barcode');
                          return DropdownMenuItem(
                            value: text(x, 'id'),
                            child: Text(
                              '${text(x, 'code')} · ${ar ? text(x, 'nameAr') : text(x, 'nameEn')}${barcode.isNotEmpty ? '  [$barcode]' : ''}',
                              overflow: TextOverflow.ellipsis,
                            ),
                          );
                        }).toList(),
                        onChanged: (v) {
                          _errors.remove('lines.$index.itemId');
                          setState(() {
                            line.itemId = v;
                            line.batchId = null;
                            line.unitName = null;
                          });
                        },
                      ),
                    ),
                    SizedBox(
                      width: 115,
                      child: TextField(
                        controller: line.quantity,
                        onChanged: (_) => _clear('lines.$index.quantity'),
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: InputDecoration(
                          labelText: t('كمية', 'Quantity'),
                          errorText: _errors['lines.$index.quantity'],
                        ),
                      ),
                    ),
                    if (item != null)
                      SizedBox(
                        width: 160,
                        child: DropdownButtonFormField<String>(
                          isExpanded: true,
                          initialValue: line.unitName ?? text(item, 'unit'),
                          decoration: InputDecoration(
                            labelText: t('الوحدة', 'Unit'),
                            errorText: _errors['lines.$index.unitName'],
                          ),
                          items: selectedUnits
                              .map(
                                (u) => DropdownMenuItem(
                                  value: '${u['unit'] ?? text(item, 'unit')}',
                                  child: Text(
                                    '${u['unit'] ?? text(item, 'unit')} × ${u['factor'] ?? 1}',
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              )
                              .toList(),
                          onChanged: (v) {
                            _errors.remove('lines.$index.unitName');
                            setState(() => line.unitName = v);
                          },
                        ),
                      ),
                    if (lots.isNotEmpty)
                      SizedBox(
                        width: 180,
                        child: DropdownButtonFormField<String>(
                          initialValue: line.batchId,
                          decoration: InputDecoration(
                            labelText: t('دفعة المصدر', 'Source lot'),
                          ),
                          items: lots
                              .map(
                                (b) => DropdownMenuItem(
                                  value: text(b, 'id'),
                                  child: Text(
                                    '${text(b, 'batchNumber')} · ${b['remainingQuantity']}',
                                  ),
                                ),
                              )
                              .toList(),
                          onChanged: (v) => setState(() => line.batchId = v),
                        ),
                      ),
                    IconButton(
                      tooltip: t('حذف البند', 'Remove line'),
                      onPressed: _lines.length == 1
                          ? null
                          : () => setState(
                              () => _lines.removeAt(index).dispose(),
                            ),
                      icon: const Icon(Icons.remove_circle_outline),
                    ),
                  ],
                ),
              );
            }),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton.icon(
                onPressed: () => setState(() => _lines.add(_DraftLine())),
                icon: const Icon(Icons.add),
                label: Text(t('إضافة صنف', 'Add item')),
              ),
            ),
            TextField(
              controller: _reason,
              onChanged: (_) => _clear('reason'),
              decoration: InputDecoration(
                labelText: t('سبب التحويل', 'Transfer reason'),
                errorText: _errors['reason'],
              ),
            ),
            TextField(
              controller: _notes,
              onChanged: (_) => _clear('notes'),
              decoration: InputDecoration(
                labelText: t('ملاحظات', 'Notes'),
                errorText: _errors['notes'],
              ),
            ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: _sending ? null : () => Navigator.pop(context, false),
        child: Text(t('إلغاء', 'Cancel')),
      ),
      FilledButton(
        onPressed: _sending ? null : _save,
        child: Text(t('إنشاء الطلب', 'Create request')),
      ),
    ],
  );
  Future<void> _scan(String raw) async {
    if (_scanning || raw.trim().isEmpty) return;
    setState(() => _scanning = true);
    try {
      final scanner = BarcodeScanner(
        lookup: (code) => widget.api.getObject(
          '/inventory/items/by-barcode/${Uri.encodeComponent(code)}',
        ),
      );
      await scanner.scan(
        raw,
        arabic: ar,
        onFailure: (message) => showAppPlainError(context, message),
        onMatch: (match) async {
          if (!mounted) return;
          setState(() {
            if (!_items.any((item) => text(item, 'id') == match.itemId)) {
              _items.add(match.item);
            }
            final matchingLines = _lines
                .where(
                  (x) => x.itemId == match.itemId && x.unitName == match.unit,
                )
                .toList();
            final line = matchingLines.isNotEmpty
                ? matchingLines.first
                : (_DraftLine()
                    ..itemId = match.itemId
                    ..unitName = match.unit);
            if (matchingLines.isEmpty) _lines.add(line);
            final count = double.tryParse(line.quantity.text) ?? 0;
            line.quantity.text = (count + 1).toString();
            final item = _items.firstWhere(
              (x) => text(x, 'id') == match.itemId,
            );
            final isBatch = flag(item, 'requiresBatch');
            final lots = widget.batches
                .where(
                  (b) =>
                      b['warehouseId'] == _from &&
                      b['itemId'] == match.itemId &&
                      (double.tryParse('${b['remainingQuantity']}') ?? 0) > 0,
                )
                .toList();
            if (isBatch && lots.length == 1) {
              line.batchId = text(lots.first, 'id');
            }
            _barcode.clear();
          });
        },
      );
    } finally {
      if (mounted) setState(() => _scanning = false);
    }
  }

  Future<void> _save() async {
    final required = t('مطلوب', 'Required');
    final found = <String, String>{};
    if (_from == null) found['sourceWarehouseId'] = required;
    if (_to == null) found['destinationWarehouseId'] = required;
    if (_from != null && _from == _to) {
      found['destinationWarehouseId'] = t(
        'المخزن المصدر والوجهة يجب أن يختلفا',
        'Source and destination must differ',
      );
    }
    if (_reason.text.trim().isEmpty) found['reason'] = required;
    final lines = <Json>[];
    for (var i = 0; i < _lines.length; i++) {
      final line = _lines[i];
      final q = double.tryParse(line.quantity.text);
      if (line.itemId == null) found['lines.$i.itemId'] = required;
      if (q == null || q <= 0) {
        found['lines.$i.quantity'] = t(
          'أدخل كمية أكبر من صفر',
          'Enter a quantity above zero',
        );
      }
      lines.add({
        'itemId': line.itemId,
        'quantity': line.quantity.text,
        'unitName': line.unitName,
        'batchId': line.batchId,
      });
    }
    if (found.isNotEmpty) {
      setState(() {
        _errors
          ..clear()
          ..addAll(found);
      });
      return;
    }
    final body = {
      'sourceWarehouseId': _from,
      'destinationWarehouseId': _to,
      'transferDate': DateTime.now().toIso8601String().substring(0, 10),
      'reason': _reason.text.trim(),
      'notes': _notes.text.trim(),
      'lines': lines,
    };
    setState(() {
      _errors.clear();
      _sending = true;
    });
    final error = await widget.submit(body);
    if (!mounted) return;
    if (error == null) {
      Navigator.pop(context, true);
      return;
    }
    setState(() => _sending = false);
    if (error is ApiFailure &&
        const {400, 422}.contains(error.statusCode) &&
        error.fieldErrors.isNotEmpty) {
      final known = <String>{
        'sourceWarehouseId',
        'destinationWarehouseId',
        'reason',
        'notes',
        for (var i = 0; i < _lines.length; i++)
          for (final f in const ['itemId', 'quantity', 'unitName'])
            'lines.$i.$f',
      };
      final rest = <String, String>{};
      setState(() {
        for (final e in error.fieldErrors.entries) {
          if (known.contains(e.key)) {
            _errors[e.key] = e.value;
          } else {
            rest[e.key] = e.value;
          }
        }
      });
      if (rest.isNotEmpty) {
        await showAppError(
          context,
          ApiFailure(
            error.message,
            statusCode: error.statusCode,
            fieldErrors: rest,
          ),
        );
      }
      return;
    }
    await showAppError(context, error);
  }
}

class _UncertainTransferOperation {
  _UncertainTransferOperation(this.action, this.key, this.lines);
  final String action, key;
  final List<Json> lines;
}

final _uncertainTransferOperations =
    Provider<Map<String, _UncertainTransferOperation>>((ref) => {});

class _TransferDialog extends ConsumerStatefulWidget {
  const _TransferDialog({required this.id, required this.ar});
  final String id;
  final bool ar;
  @override
  ConsumerState<_TransferDialog> createState() => _TransferDialogState();
}

class _TransferDialogState extends ConsumerState<_TransferDialog> {
  final _horizontalScroll = ScrollController();
  final _verticalScroll = ScrollController();
  @override
  void dispose() {
    _horizontalScroll.dispose();
    _verticalScroll.dispose();
    super.dispose();
  }

  Json? row;
  bool loading = true, busy = false;
  bool get ar => widget.ar;
  String t(String a, String e) => ar ? a : e;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Json? approvalPath;
  String? reconciliation;
  Future<void> _load() async {
    try {
      final api = ref.read(apiClientProvider);
      final x = await api.getObject('/inventory/stock-transfers/${widget.id}');
      final pending = ref.read(_uncertainTransferOperations)[widget.id];
      if (pending != null) {
        final actions = listOf(x['actions']);
        final confirmed = actions.any(
          (a) =>
              a['requestKey'] ==
                  '${pending.action.toUpperCase()}:${pending.key}' &&
              a['stockDocumentId'] != null,
        );
        if (confirmed) {
          ref.read(_uncertainTransferOperations).remove(widget.id);
          reconciliation = t(
            'تم تأكيد العملية السابقة من سجل التحويل. راجع الكميات المحدثة.',
            'The earlier operation is confirmed in the transfer record. Review the updated quantities.',
          );
        }
      }
      Json? p;
      try {
        p = await api.getObject(
          '/inventory/stock-transfers/${widget.id}/approvals',
        );
      } catch (_) {
        p = null;
      }
      if (mounted) {
        setState(() {
          row = x;
          approvalPath = p;
        });
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final status = text(row ?? {}, 'status');
    final lines = (row?['lines'] as List? ?? const [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    return AlertDialog(
      title: Text(
        row == null ? t('التحويل', 'Transfer') : text(row!, 'documentNumber'),
      ),
      content: SizedBox(
        width: 800,
        child: loading
            ? const Center(child: CircularProgressIndicator())
            : row == null
            ? Text(t('تعذر تحميل التحويل', 'Could not load transfer'))
            : Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (reconciliation != null) Text(reconciliation!),
                  if (ref.read(_uncertainTransferOperations)[widget.id] != null)
                    Text(
                      t(
                        'توجد عملية غير مؤكدة محفوظة. افتح نفس الإجراء لمراجعة بياناته. الإرسال محظور حتى يؤكد سجل التحويل النتيجة. حدّث أو راجع المدير.',
                        'An uncertain operation is saved. Open the same action to review its entries. Submission is blocked until the transfer record confirms the result. Refresh or ask the administrator to review.',
                      ),
                    ),
                  Text('${text(row!, 'reason')} · $status'),
                  const SizedBox(height: 10),
                  _approvalPath(),
                  Flexible(
                    child: Scrollbar(
                      controller: _horizontalScroll,
                      thumbVisibility: true,
                      child: SingleChildScrollView(
                        controller: _horizontalScroll,
                        scrollDirection: Axis.horizontal,
                        child: Scrollbar(
                          controller: _verticalScroll,
                          thumbVisibility: true,
                          child: SingleChildScrollView(
                            controller: _verticalScroll,
                            child: DataTable(
                              columns: [
                                DataColumn(label: Text(t('الصنف', 'Item'))),
                                DataColumn(
                                  label: Text(t('مطلوب', 'Requested')),
                                ),
                                DataColumn(
                                  label: Text(t('سُلّم', 'Dispatched')),
                                ),
                                DataColumn(
                                  label: Text(t('استُلم', 'Received')),
                                ),
                                DataColumn(label: Text(t('مرتجع', 'Returned'))),
                                DataColumn(
                                  label: Text(t('مفقود/تالف', 'Short/damaged')),
                                ),
                              ],
                              rows: lines.map((l) {
                                final i = l['item'] as Map? ?? const {};
                                return DataRow(
                                  cells: [
                                    DataCell(
                                      Text(
                                        ar
                                            ? '${i['nameAr'] ?? i['nameEn']}'
                                            : '${i['nameEn'] ?? i['nameAr']}',
                                      ),
                                    ),
                                    DataCell(Text('${l['requestedQuantity']}')),
                                    DataCell(
                                      Text('${l['dispatchedQuantity']}'),
                                    ),
                                    DataCell(Text('${l['receivedQuantity']}')),
                                    DataCell(Text('${l['returnedQuantity']}')),
                                    DataCell(
                                      Text(
                                        '${l['reportedShortage']} / ${l['reportedDamage']}',
                                      ),
                                    ),
                                  ],
                                );
                              }).toList(),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
      ),
      actions: _actions(user, status, lines),
    );
  }

  /// The buttons, derived from the document's own state and the caller's
  /// permissions.
  ///
  /// A configured chain is decided level by level, so "Approve" is offered
  /// only when the pending level names a permission this person holds. The
  /// backend enforces the same rules; hiding a button is courtesy, not the
  /// control.
  List<Widget> _actions(AppUser? user, String status, List<Json> lines) {
    bool can(String permission) => user?.can(permission) ?? false;
    final configured = approvalPath?['source'] == 'POLICY';
    final levels = (approvalPath?['levels'] as List? ?? const [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    Map<String, dynamic>? pending;
    for (final level in levels) {
      if (level['state'] == 'PENDING') {
        pending = level;
        break;
      }
    }
    final pendingPermission = pending?['permission'] as String?;
    final pendingRole = pending?['roleCode'] as String?;
    final mayDecide =
        pending != null &&
        pendingPermission != null &&
        can(pendingPermission) &&
        (pendingRole == null || (user?.hasRole(pendingRole) ?? false));
    return [
      if (status == 'DRAFT' && !configured && can('inventory.transfer.review'))
        _action('review', t('مراجعة', 'Review')),
      if (status == 'DRAFT' && can('inventory.transfer.create'))
        _action('submit', t('إرسال للاعتماد', 'Submit for approval')),
      if (status == 'PENDING_APPROVAL' && mayDecide)
        _action('approve', t('اعتماد المستوى', 'Approve level')),
      if (status == 'PENDING_APPROVAL' && mayDecide)
        _action('return', t('إرجاع للتعديل', 'Return for amendment')),
      if (['PENDING_APPROVAL', 'REVIEWED'].contains(status) &&
          can('inventory.transfer.review'))
        _action('reject', t('رفض', 'Reject')),
      if (status == 'REVIEWED' && can('inventory.transfer.approve'))
        _action('approve', t('اعتماد', 'Approve')),
      if ([
            'APPROVED',
            'PARTIALLY_DISPATCHED',
            'PARTIALLY_RECEIVED',
            'DISPATCHING',
          ].contains(status) &&
          (status != 'PARTIALLY_RECEIVED' ||
              lines.any(
                (line) =>
                    (double.tryParse('${line['requestedQuantity']}') ?? 0) >
                    (double.tryParse('${line['dispatchedQuantity']}') ?? 0),
              )) &&
          can('inventory.transfer.dispatch'))
        _action('dispatch', t('تسليم', 'Dispatch')),
      if ([
            'DISPATCHED',
            'PARTIALLY_DISPATCHED',
            'PARTIALLY_RECEIVED',
            'RECEIVING',
          ].contains(status) &&
          can('inventory.transfer.receive'))
        _action('receive', t('استلام', 'Receive')),
      if ([
            'DISPATCHED',
            'PARTIALLY_DISPATCHED',
            'PARTIALLY_RECEIVED',
            'SETTLING',
          ].contains(status) &&
          can('inventory.transfer.settle'))
        _action('settle', t('تسوية الفروق', 'Settle differences')),
      if (status == 'SETTLEMENT_PENDING' &&
          can('inventory.transfer.settle.approve'))
        _action('settle/approve', t('اعتماد الإعدام', 'Approve write-off')),
      if (['RECEIVED', 'SETTLED'].contains(status) &&
          can('inventory.transfer.close'))
        _action('close', t('إغلاق', 'Close')),
      if (![
            'CLOSED',
            'CANCELLED',
            'REJECTED',
            'SETTLEMENT_PENDING',
          ].contains(status) &&
          can('inventory.transfer.cancel'))
        _action('cancel', t('إلغاء/عكس', 'Cancel/reverse')),
      TextButton(
        onPressed: busy ? null : _load,
        child: Text(t('تحديث التحويل', 'Refresh transfer')),
      ),
      TextButton(
        onPressed: busy ? null : () => Navigator.pop(context, true),
        child: Text(t('تم', 'Done')),
      ),
    ];
  }

  /// The path this request is following, so a person can see who closed each
  /// level, when, and why — and why an action they expected is not offered.
  Widget _approvalPath() {
    final source = approvalPath?['source'];
    if (source != 'POLICY') return const SizedBox.shrink();
    final levels = (approvalPath?['levels'] as List? ?? const [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    if (levels.isEmpty) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        border: Border.all(color: Theme.of(context).dividerColor),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            t('مسار الاعتماد', 'Approval path'),
            style: Theme.of(context).textTheme.labelLarge,
          ),
          const SizedBox(height: 6),
          ...levels.map((level) {
            final state = '${level['state']}';
            final label = switch (state) {
              'APPROVED' => t('معتمد', 'Approved'),
              'REJECTED' => t('مرفوض', 'Rejected'),
              'RETURNED' => t('أُعيد للتعديل', 'Returned'),
              'PENDING' => t('بانتظار القرار', 'Pending'),
              _ => t('في الانتظار', 'Waiting'),
            };
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Text(
                '${level['level']}. ${ar ? level['nameAr'] : level['nameEn']} — $label${level['reason'] != null ? ' · ${level['reason']}' : ''}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _action(String action, String label) => TextButton(
    onPressed: busy ? null : () => _run(action),
    child: Text(label),
  );
  Future<void> _run(String action) async {
    final api = ref.read(apiClientProvider);
    final lines = (row?['lines'] as List? ?? const [])
        .whereType<Map>()
        .map((entry) => Map<String, dynamic>.from(entry))
        .toList();
    final existingPending = ref.read(_uncertainTransferOperations)[widget.id];
    if (existingPending != null && existingPending.action != action) {
      await showAppError(
        context,
        const ValidationFailure(
          'Review the saved uncertain operation before another stock action.',
        ),
      );
      return;
    }
    Object? body;
    final key = '$action-${DateTime.now().microsecondsSinceEpoch}';
    if (action == 'dispatch' || action == 'receive' || action == 'settle') {
      final savedOperations = ref.read(_uncertainTransferOperations);
      final pending = savedOperations[widget.id];
      if (pending != null && pending.action != action) {
        await showAppError(
          context,
          const ValidationFailure(
            'Review the saved uncertain operation before another stock action.',
          ),
        );
        return;
      }
      Future<void> send(List<Json> selected) async {
        final requestKey = '$action-${DateTime.now().microsecondsSinceEpoch}';
        try {
          await api.post(
            '/inventory/stock-transfers/${widget.id}/$action',
            body: {'lines': selected},
            idempotencyKey: requestKey,
          );
          savedOperations.remove(widget.id);
        } catch (error) {
          if (!(error is ApiFailure &&
              error.statusCode != null &&
              error.statusCode! >= 400 &&
              error.statusCode! < 500)) {
            savedOperations[widget.id] = _UncertainTransferOperation(
              action,
              requestKey,
              selected.map((e) => Map<String, dynamic>.from(e)).toList(),
            );
          }
          rethrow;
        }
      }

      final saved = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (_) => action == 'settle'
            ? _SettlementDialog(
                ar: ar,
                lines: lines,
                onSubmit: send,
                pending: pending?.lines,
              )
            : _QuantityDialog(
                ar: ar,
                lines: lines,
                receive: action == 'receive',
                onSubmit: send,
                pending: pending?.lines,
              ),
      );
      if (mounted && (saved == true || savedOperations[widget.id] != null)) {
        await _load();
      }
      return;
    }
    if (action == 'reject' || action == 'return') {
      final reason = await _ask(
        action == 'reject'
            ? t('سبب الرفض', 'Rejection reason')
            : t('سبب الإرجاع للتعديل', 'Reason for returning it'),
      );
      if (reason == null || !mounted) return;
      body = {'reason': reason};
    }
    if (!mounted) return;
    setState(() => busy = true);
    try {
      await api.post(
        '/inventory/stock-transfers/${widget.id}/$action',
        body: body,
        idempotencyKey: key,
      );
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<String?> _ask(String title) async {
    final controller = TextEditingController();
    final route = DialogRoute<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: TextField(controller: controller),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text(t('إلغاء', 'Cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text),
            child: Text(t('تأكيد', 'Confirm')),
          ),
        ],
      ),
    );
    final value = await Navigator.of(context, rootNavigator: true).push(route);
    await route.completed;
    controller.dispose();
    return value;
  }
}

mixin _RetainedTransferSubmission<T extends StatefulWidget> on State<T> {
  bool sending = false, uncertain = false;
  String? submissionMessage;
  Future<void> submitLines(
    List<Json> lines,
    Future<void> Function(List<Json>) send,
    bool arabic,
  ) async {
    if (sending || uncertain) return;
    setState(() {
      sending = true;
      submissionMessage = null;
    });
    try {
      await send(lines);
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (!mounted) return;
      final definite =
          error is ApiFailure &&
          error.statusCode != null &&
          error.statusCode! >= 400 &&
          error.statusCode! < 500;
      setState(() {
        uncertain = !definite;
        submissionMessage = uncertain
            ? (arabic
                  ? 'ربما اكتملت العملية. بياناتك محفوظة؛ أغلق النافذة وحدّث التحويل وراجع الكميات قبل المحاولة من جديد. لا ترسل مرة أخرى الآن.'
                  : 'The operation may have completed. Your entries are retained. Close this dialog, refresh the transfer and check quantities before trying again. Do not submit again now.')
            : (arabic
                  ? 'لم يُقبل الطلب. بياناتك محفوظة؛ صحح السبب الموضح ثم أرسل من جديد.'
                  : 'The request was refused. Your entries are retained. Correct the reported problem, then submit again.');
      });
      await showAppError(context, error);
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }
}

class _QuantityDialog extends StatefulWidget {
  const _QuantityDialog({
    required this.ar,
    required this.lines,
    required this.receive,
    required this.onSubmit,
    this.pending,
  });

  final bool ar;
  final bool receive;
  final List<Json>? pending;
  final Future<void> Function(List<Json>) onSubmit;
  final List<Json> lines;

  @override
  State<_QuantityDialog> createState() => _QuantityDialogState();
}

class _QuantityDialogState extends State<_QuantityDialog>
    with _RetainedTransferSubmission<_QuantityDialog> {
  late final List<TextEditingController> controllers;

  @override
  void initState() {
    super.initState();
    uncertain = widget.pending != null;
    if (uncertain) submissionMessage = "The operation may have completed. Saved entries remain blocked. Refresh the transfer or ask the administrator to verify the original operation.";
    controllers = widget.lines.map((line) {
      final dispatched = double.tryParse('${line['dispatchedQuantity']}') ?? 0;
      final received = double.tryParse('${line['receivedQuantity']}') ?? 0;
      final requested = double.tryParse('${line['requestedQuantity']}') ?? 0;
      final returned = double.tryParse('${line['returnedQuantity']}') ?? 0;
      final writtenOff = double.tryParse('${line['writtenOffQuantity']}') ?? 0;
      final remaining = widget.receive
          ? dispatched - received - returned - writtenOff
          : requested - dispatched;
      return TextEditingController(
        text:
            widget.pending
                ?.where((p) => p['lineId'] == line['id'])
                .firstOrNull?['quantity']
                ?.toString() ??
            remaining.clamp(0, double.infinity).toString(),
      );
    }).toList();
  }

  @override
  void dispose() {
    for (final controller in controllers) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(
      widget.ar
          ? (widget.receive ? 'تسجيل الاستلام' : 'تسجيل التسليم')
          : (widget.receive ? 'Receive quantities' : 'Dispatch quantities'),
    ),
    content: SizedBox(
      width: 520,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(widget.lines.length, (index) {
            final item = widget.lines[index]['item'] as Map? ?? const {};
            final itemName = widget.ar
                ? (item['nameAr'] ?? item['nameEn'])
                : (item['nameEn'] ?? item['nameAr']);
            return Row(
              children: [
                Expanded(child: Text('$itemName')),
                SizedBox(
                  width: 110,
                  child: TextField(
                    controller: controllers[index],
                    enabled: !sending && !uncertain,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: InputDecoration(
                      labelText: widget.ar ? 'كمية' : 'Qty',
                    ),
                  ),
                ),
              ],
            );
          }),
        ),
      ),
    ),
    actions: [
      if (submissionMessage != null)
        Padding(
          padding: const EdgeInsets.all(8),
          child: Text(submissionMessage!),
        ),
      TextButton(
        onPressed: sending ? null : () => Navigator.pop(context),
        child: Text(widget.ar ? 'إلغاء' : 'Cancel'),
      ),
      FilledButton(
        onPressed: sending || uncertain
            ? null
            : () {
                final result = <Json>[];
                for (var index = 0; index < widget.lines.length; index++) {
                  final quantity =
                      double.tryParse(controllers[index].text) ?? 0;
                  if (quantity > 0) {
                    result.add({
                      'lineId': widget.lines[index]['id'],
                      'quantity': controllers[index].text,
                    });
                  }
                }
                submitLines(result, widget.onSubmit, widget.ar);
              },
        child: Text(widget.ar ? 'تأكيد' : 'Confirm'),
      ),
    ],
  );
}

class _SettlementDialog extends StatefulWidget {
  const _SettlementDialog({
    required this.ar,
    required this.lines,
    required this.onSubmit,
    this.pending,
  });
  final bool ar;
  final List<Json> lines;
  final Future<void> Function(List<Json>) onSubmit;
  final List<Json>? pending;

  @override
  State<_SettlementDialog> createState() => _SettlementDialogState();
}

class _SettlementDialogState extends State<_SettlementDialog>
    with _RetainedTransferSubmission<_SettlementDialog> {
  late final List<TextEditingController> returns;
  late final List<TextEditingController> shortages;
  late final List<TextEditingController> damages;
  late final List<TextEditingController> reasons;

  String t(String arabic, String english) => widget.ar ? arabic : english;

  @override
  void initState() {
    super.initState();
    returns = List.generate(
      widget.lines.length,
      (_) => TextEditingController(text: '0'),
    );
    shortages = List.generate(
      widget.lines.length,
      (_) => TextEditingController(text: '0'),
    );
    damages = List.generate(
      widget.lines.length,
      (_) => TextEditingController(text: '0'),
    );
    reasons = List.generate(
      widget.lines.length,
      (_) => TextEditingController(),
    );
    uncertain = widget.pending != null;
    if (uncertain) submissionMessage = 'The operation may have completed. Saved entries remain blocked. Refresh the transfer or ask the administrator to verify the original operation.';
    for (var i = 0; i < widget.lines.length; i++) {
      final draft = widget.pending
          ?.where((p) => p['lineId'] == widget.lines[i]['id'])
          .firstOrNull;
      if (draft != null) {
        returns[i].text = '${draft['returnedQuantity']}';
        shortages[i].text = '${draft['shortage']}';
        damages[i].text = '${draft['damage']}';
        reasons[i].text = '${draft['reason']}';
      }
    }
  }

  @override
  void dispose() {
    for (final group in [returns, shortages, damages, reasons]) {
      for (final controller in group) {
        controller.dispose();
      }
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(t('تسوية البضاعة بالطريق', 'Settle goods in transit')),
    content: SizedBox(
      width: 780,
      child: HorizontalScrollFrame(
        child: SingleChildScrollView(
          child: DataTable(
            columns: [
              DataColumn(label: Text(t('الصنف', 'Item'))),
              DataColumn(label: Text(t('مرتجع', 'Return'))),
              DataColumn(label: Text(t('مفقود', 'Shortage'))),
              DataColumn(label: Text(t('تالف', 'Damaged'))),
              DataColumn(label: Text(t('السبب', 'Reason'))),
            ],
            rows: List.generate(widget.lines.length, (index) {
              final item = widget.lines[index]['item'] as Map? ?? const {};
              final name = widget.ar
                  ? (item['nameAr'] ?? item['nameEn'])
                  : (item['nameEn'] ?? item['nameAr']);
              return DataRow(
                cells: [
                  DataCell(SizedBox(width: 140, child: Text('$name'))),
                  DataCell(_field(returns[index])),
                  DataCell(_field(shortages[index])),
                  DataCell(_field(damages[index])),
                  DataCell(
                    SizedBox(
                      width: 190,
                      child: TextField(
                        controller: reasons[index],
                        enabled: !sending && !uncertain,
                        decoration: InputDecoration(
                          hintText: t(
                            'سبب الفقد أو التلف',
                            'Reason for loss/damage',
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              );
            }),
          ),
        ),
      ),
    ),
    actions: [
      if (submissionMessage != null)
        Padding(
          padding: const EdgeInsets.all(8),
          child: Text(submissionMessage!),
        ),
      TextButton(
        onPressed: sending ? null : () => Navigator.pop(context),
        child: Text(t('إلغاء', 'Cancel')),
      ),
      FilledButton(
        onPressed: sending || uncertain
            ? null
            : () {
                final result = <Json>[];
                for (var index = 0; index < widget.lines.length; index++) {
                  final returned = double.tryParse(returns[index].text) ?? 0;
                  final shortage = double.tryParse(shortages[index].text) ?? 0;
                  final damage = double.tryParse(damages[index].text) ?? 0;
                  if (returned > 0 || shortage > 0 || damage > 0) {
                    result.add({
                      'lineId': widget.lines[index]['id'],
                      'returnedQuantity': returns[index].text,
                      'shortage': shortages[index].text,
                      'damage': damages[index].text,
                      'reason': reasons[index].text,
                    });
                  }
                }
                if (result.isNotEmpty) {
                  submitLines(result, widget.onSubmit, widget.ar);
                }
              },
        child: Text(t('إرسال التسوية', 'Submit settlement')),
      ),
    ],
  );

  Widget _field(TextEditingController controller) => SizedBox(
    width: 85,
    child: TextField(
      controller: controller,
      enabled: !sending && !uncertain,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: const InputDecoration(isDense: true),
    ),
  );
}
