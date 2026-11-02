import 'dart:math' as math;

import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// «مستندات الإعدام» - the goods that cannot be sold, and the paper that says
/// who destroyed them and why.
///
/// This is a document, not a button on a lot. A write-off is recorded as a
/// draft with a reason and the goods it names, approved by somebody other than
/// the person who recorded it, and only then posted - at which point the stock
/// leaves the shelf, the loss reaches the ledger, and the paper carries a
/// number of its own (WO-…) that can be filed and argued about.
///
/// The one-click write-off on the lots screen still exists for a single lot and
/// is not a substitute for this: it cannot carry several goods, a location, a
/// cost centre, or the name of the person who signed.
class WriteOffsScreen extends ConsumerStatefulWidget {
  const WriteOffsScreen({super.key});

  @override
  ConsumerState<WriteOffsScreen> createState() => _WriteOffsScreenState();
}

class _WriteOffsScreenState extends ConsumerState<WriteOffsScreen> {
  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  @override
  Widget build(BuildContext context) {
    return ModuleScaffold(
      title: _t('مستندات الإعدام', 'Write-offs'),
      subtitle: _t(
        'إتلاف بضاعة بسبب موثّق، يعتمده شخص غير من سجّله، ثم يُرحّل ليخرج من المخزن ويدخل الخسارة في الدفاتر.',
        'Destroying stock for a recorded reason. Somebody other than the recorder approves it, then it is posted '
            'so it leaves the warehouse and the loss reaches the books.',
      ),
      body: const _WriteOffBody(),
    );
  }
}

String _statusLabel(String status, bool arabic) {
  switch (status.toUpperCase()) {
    case 'DRAFT':
      return arabic ? 'مسودة' : 'Draft';
    case 'POSTED':
      return arabic ? 'مُرحّل' : 'Posted';
    case 'REVERSED':
      return arabic ? 'معكوس' : 'Reversed';
    default:
      return status.toUpperCase();
  }
}

AppTone _statusTone(String status) {
  switch (status.toUpperCase()) {
    case 'POSTED':
      return AppTone.success;
    case 'DRAFT':
      return AppTone.warning;
    default:
      return AppTone.neutral;
  }
}

/// A shelf's own code, pushed right by as many steps as it sits deep in the
/// tree, so the drop-down reads like the tree it was loaded from. Dart has no
/// string repetition, so the spaces are built rather than multiplied.
String _indentLocation(Json location) {
  final depth = asNum(location['depth'])?.toInt() ?? 0;
  final indent = depth <= 0 ? '' : List.filled(depth, '  ').join();
  return '$indent${text(location, 'code')}';
}

class _WriteOffLineDraft {
  _WriteOffLineDraft();

  String itemId = '';
  String? batchId;
  String? storageLocationId;
  String quantity = '';
  String unitCost = '';
  List<Json> lots = const [];
}

class _WriteOffBody extends ConsumerStatefulWidget {
  const _WriteOffBody();

  @override
  ConsumerState<_WriteOffBody> createState() => _WriteOffBodyState();
}

class _WriteOffBodyState extends ConsumerState<_WriteOffBody> {
  List<Json> _documents = const [];
  List<Json> _warehouses = const [];
  List<Json> _items = const [];
  Json? _open;
  String _query = '';
  bool _loading = true;
  bool _busy = false;
  String? _error;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  bool _can(String permission) =>
      ref.read(currentUserProvider)?.can(permission) ?? false;

  String get _userId => ref.read(currentUserProvider)?.id ?? '';

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    final client = ref.read(apiClientProvider);
    try {
      final warehouses = await client.getList('/inventory/warehouses');
      if (mounted) setState(() => _warehouses = warehouses);
    } on Failure {
      // The warehouse list is needed to record a loss, not to read one.
    }
    await _load();
  }

  Future<void> _load() async {
    if (mounted) setState(() => _loading = true);
    try {
      final rows = await ref.read(apiClientProvider).getList(
        '/inventory/stock-documents',
        query: {'kind': 'WRITE_OFF', 'pageSize': 200},
      );
      if (!mounted) return;
      setState(() {
        _documents = rows;
        _error = null;
      });
    } on Failure catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openDocument(String id) async {
    setState(() => _busy = true);
    try {
      final data = await ref.read(apiClientProvider).getObject('/inventory/stock-documents/$id');
      if (!mounted) return;
      setState(() => _open = data);
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } catch (error) {
      if (mounted) {
        showMessage(context, '${_t('تعذر تنفيذ العملية', 'Action failed')}: $error', error: true);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _warehouseName(Json? warehouse) {
    if (warehouse == null) return '—';
    final ar = text(warehouse, 'nameAr');
    final en = text(warehouse, 'nameEn');
    final name = _arabic ? (ar.isEmpty ? en : ar) : (en.isEmpty ? ar : en);
    final code = text(warehouse, 'code');
    return code.isEmpty ? name : '$code — $name';
  }

  String _itemLabel(Json item) {
    final ar = text(item, 'nameAr');
    final en = text(item, 'nameEn');
    final name = _arabic ? (ar.isEmpty ? en : ar) : (en.isEmpty ? ar : en);
    return '${text(item, 'code')} — $name';
  }

  /// Every shelf in a warehouse, flattened with its depth so the picker reads
  /// like the tree it came from.
  Future<List<Json>> _locationsOf(String warehouseId) async {
    try {
      final tree = await ref.read(apiClientProvider).getObject(
        '/inventory/locations/tree/$warehouseId',
      );
      final out = <Json>[];
      void walk(List<Json> rows, int depth) {
        for (final row in rows) {
          out.add({...row, 'depth': depth});
          walk(listOf(row['children']), depth + 1);
        }
      }

      walk(listOf(tree['items']), 0);
      return out;
    } on Failure {
      return const [];
    }
  }

  Future<void> _create() async {
    if (_warehouses.isEmpty) {
      showMessage(
        context,
        _t('لا يوجد مخزن مسند إليك.', 'No warehouse is assigned to you.'),
        error: true,
      );
      return;
    }
    if (_items.isEmpty) {
      try {
        final rows = await ref
            .read(apiClientProvider)
            .getList('/inventory/items', query: {'pageSize': 500, 'includeInactive': false});
        if (mounted) setState(() => _items = rows);
      } on Failure catch (error) {
        if (mounted) showMessage(context, error.message, error: true);
        return;
      }
    }
    if (!mounted || _items.isEmpty) {
      if (mounted) {
        showMessage(context, _t('لا توجد أصناف.', 'There are no items.'), error: true);
      }
      return;
    }

    var warehouseId = text(_warehouses.first, 'id');
    var locations = await _locationsOf(warehouseId);
    if (!mounted) return;
    final documentDateController =
        TextEditingController(text: DateTime.now().toIso8601String().split('T').first);
    final reasonController = TextEditingController();
    final notesController = TextEditingController();
    final lines = <_WriteOffLineDraft>[_WriteOffLineDraft()];
    var error = '';

    Future<void> loadLots(_WriteOffLineDraft line) async {
      if (line.itemId.isEmpty) {
        line.lots = const [];
        return;
      }
      try {
        line.lots = await ref.read(apiClientProvider).getList(
          '/inventory/batches',
          query: {'itemId': line.itemId, 'warehouseId': warehouseId, 'pageSize': 200},
        );
      } on Failure {
        line.lots = const [];
      }
    }

    final draft = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) {
          // A dialog asks for room it may not have: on a 1366-wide desktop it
          // is comfortable, on a small window or a phone it must shrink rather
          // than overflow. The numbers are a wish, the screen decides.
          final media = MediaQuery.sizeOf(dialogContext);
          final dialogWidth = math.min(media.width - 96, 760.0);
          final dialogHeight = math.min(media.height - 200, 560.0);
          return AlertDialog(
            title: Text(_t('مستند إعدام جديد', 'New write-off')),
            content: SizedBox(
              width: dialogWidth < 320 ? 320 : dialogWidth,
              height: dialogHeight < 260 ? 260 : dialogHeight,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: [
                      SizedBox(
                        width: 260,
                        child: DropdownButtonFormField<String>(
                          initialValue: warehouseId,
                          // A store name is longer than the field on purpose:
                          // the menu expands to the field, never past it.
                          isExpanded: true,
                          decoration: InputDecoration(
                            labelText: _t('المخزن', 'Warehouse'),
                            border: const OutlineInputBorder(),
                            isDense: true,
                          ),
                          items: [
                            for (final warehouse in _warehouses)
                              DropdownMenuItem(
                                value: text(warehouse, 'id'),
                                child: Text(
                                  _warehouseName(warehouse),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                          ],
                          onChanged: (value) async {
                            final chosen = value ?? warehouseId;
                            setDialogState(() {
                              warehouseId = chosen;
                              locations = const [];
                              for (final line in lines) {
                                line.storageLocationId = null;
                              }
                            });
                            final loaded = await _locationsOf(chosen);
                            if (!dialogContext.mounted) return;
                            setDialogState(() => locations = loaded);
                          },
                        ),
                      ),
                      SizedBox(
                        width: 180,
                        child: TextField(
                          controller: documentDateController,
                          decoration: InputDecoration(
                            labelText: _t('التاريخ', 'Date'),
                            border: const OutlineInputBorder(),
                            isDense: true,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  TextField(
                    controller: reasonController,
                    decoration: InputDecoration(
                      labelText: _t('سبب الإعدام (إلزامي)', 'Reason for the write-off (required)'),
                      helperText: _t(
                        'هذه الجملة هي ما سيقرأه المدقق في القيد بعد سنتين.',
                        'This sentence is what an auditor will read on the entry in two years.',
                      ),
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    _t('البضاعة المُتلفة', 'The goods being destroyed'),
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  Expanded(
                    child: ListView.builder(
                      itemCount: lines.length,
                      itemBuilder: (context, index) {
                        final line = lines[index];
                        return Card(
                          margin: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
                          child: Padding(
                            padding: const EdgeInsets.all(AppSpacing.sm),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: DropdownButtonFormField<String>(
                                        initialValue:
                                            line.itemId.isEmpty ? null : line.itemId,
                                        isExpanded: true,
                                        decoration: InputDecoration(
                                          labelText: _t('الصنف', 'Item'),
                                          border: const OutlineInputBorder(),
                                          isDense: true,
                                        ),
                                        items: [
                                          for (final item in _items)
                                            DropdownMenuItem(
                                              value: text(item, 'id'),
                                              child: Text(
                                                _itemLabel(item),
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                            ),
                                        ],
                                        onChanged: (value) async {
                                          if (value == null) return;
                                          setDialogState(() {
                                            line.itemId = value;
                                            line.batchId = null;
                                            line.lots = const [];
                                          });
                                          await loadLots(line);
                                          if (!dialogContext.mounted) return;
                                          setDialogState(() {});
                                        },
                                      ),
                                    ),
                                    if (lines.length > 1)
                                      IconButton(
                                        tooltip: _t('حذف السطر', 'Remove the line'),
                                        onPressed: () => setDialogState(() => lines.removeAt(index)),
                                        icon: const Icon(Icons.delete_outline, size: 18),
                                      ),
                                  ],
                                ),
                                const SizedBox(height: AppSpacing.xs),
                                Wrap(
                                  spacing: AppSpacing.sm,
                                  runSpacing: AppSpacing.sm,
                                  crossAxisAlignment: WrapCrossAlignment.center,
                                  children: [
                                    SizedBox(
                                      width: 220,
                                      child: DropdownButtonFormField<String>(
                                        initialValue: line.batchId,
                                        isExpanded: true,
                                        decoration: InputDecoration(
                                          labelText: _t('الدفعة', 'Lot'),
                                          border: const OutlineInputBorder(),
                                          isDense: true,
                                        ),
                                        items: [
                                          for (final lot in line.lots)
                                            DropdownMenuItem(
                                              value: text(lot, 'id'),
                                              child: Text(
                                                '${text(lot, 'batchNumber')} · ${text(lot, 'remainingQuantity')}',
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                            ),
                                        ],
                                        onChanged: (value) => setDialogState(() {
                                          line.batchId = value;
                                          final lot = line.lots.firstWhere(
                                            (row) => text(row, 'id') == value,
                                            orElse: () => const <String, dynamic>{},
                                          );
                                          // The lot knows what it cost; using it
                                          // keeps the paper equal to the ledger.
                                          if (line.unitCost.isEmpty) {
                                            line.unitCost = text(lot, 'unitCost');
                                          }
                                        }),
                                      ),
                                    ),
                                    SizedBox(
                                      width: 220,
                                      child: DropdownButtonFormField<String>(
                                        initialValue: line.storageLocationId,
                                        isExpanded: true,
                                        decoration: InputDecoration(
                                          labelText: _t('الموقع', 'Location'),
                                          border: const OutlineInputBorder(),
                                          isDense: true,
                                        ),
                                        items: [
                                          for (final location in locations)
                                            DropdownMenuItem(
                                              value: text(location, 'id'),
                                              child: Text(
                                                _indentLocation(location),
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                            ),
                                        ],
                                        onChanged: (value) =>
                                            setDialogState(() => line.storageLocationId = value),
                                      ),
                                    ),
                                    SizedBox(
                                      width: 120,
                                      child: TextField(
                                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                        decoration: InputDecoration(
                                          labelText: _t('الكمية', 'Quantity'),
                                          border: const OutlineInputBorder(),
                                          isDense: true,
                                        ),
                                        onChanged: (value) => line.quantity = value,
                                      ),
                                    ),
                                    SizedBox(
                                      width: 130,
                                      child: TextField(
                                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                        decoration: InputDecoration(
                                          labelText: _t('تكلفة الوحدة', 'Unit cost'),
                                          border: const OutlineInputBorder(),
                                          isDense: true,
                                        ),
                                        onChanged: (value) => line.unitCost = value,
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: TextButton.icon(
                      onPressed: () => setDialogState(() => lines.add(_WriteOffLineDraft())),
                      icon: const Icon(Icons.add, size: 18),
                      label: Text(_t('إضافة صنف آخر', 'Add another item')),
                    ),
                  ),
                  TextField(
                    controller: notesController,
                    decoration: InputDecoration(
                      labelText: _t('ملاحظات', 'Notes'),
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  if (error.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: AppSpacing.sm),
                      child: Text(
                        error,
                        style: TextStyle(color: Theme.of(context).colorScheme.error),
                      ),
                    ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: Text(_t('إلغاء', 'Cancel')),
              ),
              FilledButton(
                key: const ValueKey('write-off-save'),
                onPressed: () {
                  if (reasonController.text.trim().isEmpty) {
                    setDialogState(
                      () => error = _t(
                        'سبب الإعدام مطلوب: هو تفسير الفرق للمدقق.',
                        'A reason is required: it is the explanation an auditor reads.',
                      ),
                    );
                    return;
                  }
                  final payloadLines = <Map<String, dynamic>>[];
                  for (final line in lines) {
                    if (line.itemId.isEmpty) {
                      setDialogState(
                        () => error = _t(
                          'اختر الصنف في كل سطر.',
                          'Choose the item on every line.',
                        ),
                      );
                      return;
                    }
                    final typed = Decimal.tryParse(line.quantity.trim());
                    if (typed == null || typed <= Decimal.zero) {
                      setDialogState(
                        () => error = _t(
                          'كمية كل سطر أكبر من صفر.',
                          'Every line needs a quantity above zero.',
                        ),
                      );
                      return;
                    }
                    payloadLines.add({
                      'itemId': line.itemId,
                      // The document carries the SIGNED change, not the number
                      // typed: a write-off takes goods out, so ten cartons the
                      // person is destroying is -10 on the line. Sending a
                      // positive figure here would have received the goods the
                      // paper says were destroyed, and the server now refuses it.
                      'quantity': (-typed).toString(),
                      'batchId': ?line.batchId,
                      'storageLocationId': ?line.storageLocationId,
                      if (line.unitCost.trim().isNotEmpty) 'unitCost': line.unitCost.trim(),
                    });
                  }
                  Navigator.of(dialogContext).pop({
                    'kind': 'WRITE_OFF',
                    'documentDate': documentDateController.text.trim(),
                    'reason': reasonController.text.trim(),
                    'toWarehouseId': warehouseId,
                    if (notesController.text.trim().isNotEmpty)
                      'notes': notesController.text.trim(),
                    'lines': payloadLines,
                  });
                },
                child: Text(_t('حفظ كمسودة', 'Save as draft')),
              ),
            ],
          );
        },
      ),
    );
    if (draft == null || !mounted) return;

    // A retry after a dropped connection must not book a second loss, so the
    // same key travels with the same document.
    final key =
        'kayan-writeoff-${DateTime.now().millisecondsSinceEpoch}-${math.Random().nextInt(1 << 32)}';
    await _run(() async {
      final created = await ref.read(apiClientProvider).post(
        '/inventory/stock-documents',
        body: draft,
        idempotencyKey: key,
      );
      if (!mounted) return;
      showMessage(
        context,
        _t(
          'حُفظ المستند كمسودة. لا يخرج من المخزن شيء حتى يُعتمد ثم يُرحّل.',
          'Saved as a draft. Nothing leaves the warehouse until it is approved and posted.',
        ),
      );
      await _load();
      final id = created['id'];
      if (id is String) await _openDocument(id);
    });
  }

  Future<void> _approve(Json document) async {
    await _run(() async {
      final updated = await ref
          .read(apiClientProvider)
          .post('/inventory/stock-documents/${text(document, 'id')}/approve');
      if (!mounted) return;
      setState(() => _open = updated);
      showMessage(
        context,
        _t(
          'اعتُمد المستند. الترحيل الآن يخرج البضاعة من المخزن ويقيد الخسارة.',
          'Approved. Posting now removes the goods and books the loss.',
        ),
      );
      await _load();
    });
  }

  Future<void> _post(Json document) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_t('ترحيل الإعدام', 'Post the write-off')),
        content: Text(
          _t(
            'سيخرج هذا المستند البضاعة من المخزن ويقيد الخسارة في الدفاتر. لا يمكن التراجع إلا بعكس المستند.',
            'This removes the goods from the warehouse and books the loss. Undoing it needs a reversing document.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(_t('رجوع', 'Back')),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(_t('ترحيل', 'Post')),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    await _run(() async {
      final updated = await ref
          .read(apiClientProvider)
          .post('/inventory/stock-documents/${text(document, 'id')}/write-off/post');
      if (!mounted) return;
      setState(() => _open = updated);
      showMessage(
        context,
        _t('رُحّل الإعدام وأُقيدت الخسارة.', 'The write-off was posted and the loss booked.'),
      );
      await _load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final open = _open;
    if (open != null) return _detail(open);
    return _list();
  }

  Widget _list() {
    final rows = _query.isEmpty
        ? _documents
        : _documents.where((row) {
            final haystack = [
              text(row, 'documentNumber'),
              text(row, 'reason'),
              _warehouseName(row['toWarehouse'] is Map
                  ? Map<String, dynamic>.from(row['toWarehouse'] as Map)
                  : null),
            ].join(' ').toLowerCase();
            return haystack.contains(_query.toLowerCase());
          }).toList(growable: false);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.sm,
          ),
          child: Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              SearchField(
                hint: _t('ابحث برقم المستند أو السبب', 'Search number or reason'),
                onChanged: (value) => setState(() => _query = value.trim()),
              ),
              IconButton(
                tooltip: _t('تحديث', 'Refresh'),
                onPressed: _load,
                icon: const Icon(Icons.refresh),
              ),
              if (_can('inventory.stock.adjust') || _can('inventory.writeoff.create'))
                FilledButton.icon(
                  key: const ValueKey('write-off-new'),
                  onPressed: _busy ? null : _create,
                  icon: const Icon(Icons.delete_sweep_outlined, size: 18),
                  label: Text(_t('إعدام جديد', 'New write-off')),
                ),
              if (_busy)
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : rows.isEmpty
                  ? Center(
                      child: Text(
                        _t(
                          'لا توجد مستندات إعدام. كل إتلاف يبدأ بمسودة بسبب مكتوب، ثم اعتماد شخص آخر، ثم ترحيل.',
                          'No write-offs yet. Every destruction starts as a draft with a written reason, then somebody '
                              'else approves it, then it is posted.',
                        ),
                      ),
                    )
                  : RecordsTable(
                      rows: rows,
                      onTap: (row) => _openDocument(text(row, 'id')),
                      columns: [
                        ColumnSpec(
                          _t('المستند', 'Document'),
                          value: (row) => text(row, 'documentNumber'),
                        ),
                        ColumnSpec(
                          _t('المخزن', 'Warehouse'),
                          value: (row) => _warehouseName(row['toWarehouse'] is Map
                              ? Map<String, dynamic>.from(row['toWarehouse'] as Map)
                              : null),
                        ),
                        ColumnSpec(
                          _t('السبب', 'Reason'),
                          flex: 2,
                          value: (row) => text(row, 'reason', fallback: '—'),
                        ),
                        ColumnSpec(
                          _t('الحالة', 'Status'),
                          value: (row) => _statusLabel(text(row, 'status'), _arabic),
                          tone: (row) => _statusTone(text(row, 'status')),
                        ),
                        ColumnSpec(
                          _t('سجّله', 'Recorded by'),
                          value: (row) => text(row, 'createdByName', fallback: '—'),
                        ),
                        ColumnSpec(
                          _t('اعتمده', 'Approved by'),
                          value: (row) => text(row, 'approvedByName', fallback: '—'),
                        ),
                        ColumnSpec(
                          _t('التاريخ', 'Date'),
                          value: (row) => text(row, 'documentDate', fallback: '—'),
                        ),
                      ],
                    ),
        ),
      ],
    );
  }

  Widget _detail(Json document) {
    final status = text(document, 'status').toUpperCase();
    final lines = listOf(document['lines']);
    final createdById = text(document, 'createdById');
    final approved = text(document, 'approvedAt').isNotEmpty;
    final createdByMe = createdById.isNotEmpty && createdById == _userId;
    final canApprove = _can('inventory.writeoff.approve');
    final canPost = _can('inventory.writeoff.post');

    final warehouse = document['toWarehouse'] is Map
        ? Map<String, dynamic>.from(document['toWarehouse'] as Map)
        : null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.sm,
          ),
          child: Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              TextButton.icon(
                onPressed: () => setState(() => _open = null),
                icon: const Icon(Icons.arrow_back, size: 18),
                label: Text(_t('كل المستندات', 'All write-offs')),
              ),
              Chip(label: Text(text(document, 'documentNumber'))),
              Chip(label: Text(_warehouseName(warehouse))),
              Chip(
                label: Text(_statusLabel(status, _arabic)),
                backgroundColor: _statusTone(status).background,
              ),
              Chip(label: Text(_t('بتاريخ ${text(document, 'documentDate')}', 'dated ${text(document, 'documentDate')}'))),
              if (canApprove && status == 'DRAFT')
                FilledButton.icon(
                  key: const ValueKey('write-off-approve'),
                  onPressed: _busy || createdByMe ? null : () => _approve(document),
                  icon: const Icon(Icons.verified_outlined, size: 18),
                  label: Text(
                    createdByMe
                        ? _t('يعتمده شخص آخر', 'Somebody else must approve')
                        : _t('اعتماد', 'Approve'),
                  ),
                ),
              if (canPost && status == 'DRAFT')
                FilledButton.icon(
                  key: const ValueKey('write-off-post'),
                  onPressed: _busy || !approved ? null : () => _post(document),
                  icon: const Icon(Icons.post_add, size: 18),
                  label: Text(_t('ترحيل', 'Post')),
                ),
              if (_busy)
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _t('السبب', 'Reason'),
                style: Theme.of(context).textTheme.labelMedium,
              ),
              Text(text(document, 'reason', fallback: '—')),
              const SizedBox(height: AppSpacing.xs),
              Text(
                [
                  '${_t('سجّله', 'Recorded by')}: ${text(document, 'createdByName', fallback: '—')}',
                  '${_t('اعتمده', 'Approved by')}: ${text(document, 'approvedByName', fallback: '—')}',
                  '${_t('رُحّل بواسطة', 'Posted by')}: ${text(document, 'postedByName', fallback: '—')}',
                  '${_t('تاريخ الترحيل', 'Posted at')}: ${text(document, 'postedAt', fallback: '—')}',
                ].join(' · '),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              if (status == 'DRAFT' && !approved)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.xs),
                  child: Text(
                    _t(
                      'مسودة: لم يخرج من المخزن شيء بعد. الترحيل يحتاج اعتماد شخص غير من سجّله.',
                      'Draft: nothing has left the warehouse. Posting needs an approval from somebody other than the recorder.',
                    ),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              if (text(document, 'journalEntryId').isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.xs),
                  child: Text(
                    _t(
                      'القيد المحاسبي: ${text(document, 'journalEntryId')}',
                      'Journal entry: ${text(document, 'journalEntryId')}',
                    ),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              const SizedBox(height: AppSpacing.sm),
            ],
          ),
        ),
        Expanded(
          child: RecordsTable(
            rows: lines,
            columns: [
              ColumnSpec(
                _t('الصنف', 'Item'),
                flex: 3,
                value: (row) =>
                    '${text(row, 'itemCode')} — ${_arabic ? text(row, 'itemNameAr') : text(row, 'itemNameEn')}',
              ),
              ColumnSpec(
                _t('الدفعة', 'Lot'),
                value: (row) => text(row, 'batchNumber', fallback: '—'),
              ),
              ColumnSpec(
                _t('الصلاحية', 'Expiry'),
                value: (row) => text(row, 'expiryDate', fallback: '—'),
              ),
              ColumnSpec(
                _t('الموقع', 'Location'),
                value: (row) => text(row, 'storageLocationCode', fallback: '—'),
              ),
              ColumnSpec(
                _t('الكمية', 'Quantity'),
                numeric: true,
                value: (row) => text(row, 'quantity'),
              ),
              ColumnSpec(
                _t('تكلفة الوحدة', 'Unit cost'),
                numeric: true,
                value: (row) => text(row, 'unitCost', fallback: '—'),
              ),
              ColumnSpec(
                _t('الإجمالي', 'Total'),
                numeric: true,
                emphasise: true,
                value: (row) => text(row, 'totalCost', fallback: '—'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
