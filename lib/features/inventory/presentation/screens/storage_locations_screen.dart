import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// «مواقع التخزين» - where inside the warehouse the goods actually are.
///
/// A warehouse answers "which building"; this screen answers "which shelf". The
/// tree is zone → aisle → rack → shelf → bin, and the order is a rule rather
/// than a convention: a bin inside an aisle is a place, a zone inside a bin is
/// a drawing on a wall. The server refuses the impossible pairings and this
/// screen only offers the possible ones, so a person never fills a form that
/// was going to be rejected.
///
/// Two actions matter after the tree exists: moving stock between two shelves
/// of the same warehouse - which changes "where is it?" and no total - and
/// retiring a location, which is only allowed once nothing is in it and
/// nothing hangs off it.
class StorageLocationsScreen extends ConsumerStatefulWidget {
  const StorageLocationsScreen({super.key});

  @override
  ConsumerState<StorageLocationsScreen> createState() => _StorageLocationsScreenState();
}

class _StorageLocationsScreenState extends ConsumerState<StorageLocationsScreen> {
  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  @override
  Widget build(BuildContext context) {
    return ModuleScaffold(
      title: _t('مواقع التخزين', 'Storage locations'),
      subtitle: _t(
        'المناطق والممرات والأرفف والصناديق داخل كل مخزن، وما يوجد على كل رف الآن.',
        'The zones, aisles, racks, shelves and bins inside each warehouse, and what sits on each today.',
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: const [Expanded(child: _LocationTreeTab())],
      ),
    );
  }
}

/// The order a location may sit at inside another, mirroring the server. A
/// screen that offers an impossible pairing is a screen that wastes a person's
/// time and teaches them the program is unreliable.
const Map<String, List<String>> _allowedChildren = {
  'ZONE': ['AISLE', 'RACK'],
  'AISLE': ['RACK', 'SHELF'],
  'RACK': ['SHELF', 'BIN'],
  'SHELF': ['BIN'],
  'BIN': <String>[],
};

String _kindLabel(String kind, bool arabic) {
  switch (kind) {
    case 'ZONE':
      return arabic ? 'منطقة' : 'Zone';
    case 'AISLE':
      return arabic ? 'ممر' : 'Aisle';
    case 'RACK':
      return arabic ? 'رفوف' : 'Rack';
    case 'SHELF':
      return arabic ? 'رف' : 'Shelf';
    case 'BIN':
      return arabic ? 'صندوق' : 'Bin';
    default:
      return kind;
  }
}

IconData _kindIcon(String kind) {
  switch (kind) {
    case 'ZONE':
      return Icons.map_outlined;
    case 'AISLE':
      return Icons.linear_scale;
    case 'RACK':
      return Icons.view_agenda_outlined;
    case 'SHELF':
      return Icons.storage_outlined;
    default:
      return Icons.inbox_outlined;
  }
}

class _LocationNode {
  const _LocationNode(this.row, this.depth);
  final Json row;
  final int depth;
}

class _LocationTreeTab extends ConsumerStatefulWidget {
  const _LocationTreeTab();

  @override
  ConsumerState<_LocationTreeTab> createState() => _LocationTreeTabState();
}

class _LocationTreeTabState extends ConsumerState<_LocationTreeTab> {
  List<Json> _warehouses = const [];
  String? _warehouseId;
  Future<Json>? _tree;
  final Set<String> _collapsed = <String>{};
  String _query = '';
  bool _busy = false;
  String? _error;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  bool get _canManage =>
      ref.read(currentUserProvider)?.can('inventory.warehouses.manage') ?? false;
  bool get _canMove => ref.read(currentUserProvider)?.can('inventory.stock.adjust') ?? false;

  @override
  void initState() {
    super.initState();
    _loadWarehouses();
  }

  Future<void> _loadWarehouses() async {
    try {
      final rows = await ref
          .read(apiClientProvider)
          .getList('/inventory/warehouses', query: {'includeInactive': true});
      if (!mounted) return;
      setState(() {
        _warehouses = rows;
        _warehouseId = _warehouseId ??
            (rows.isEmpty ? null : text(rows.first, 'id'));
        _tree = _warehouseId == null ? null : _loadTree(_warehouseId!);
      });
    } on Failure catch (error) {
      if (mounted) setState(() => _error = error.message);
    }
  }

  Future<Json> _loadTree(String warehouseId) async {
    return ref
        .read(apiClientProvider)
        .getObject('/inventory/locations/tree/$warehouseId');
  }

  void _refresh() {
    final id = _warehouseId;
    if (id == null) return;
    setState(() {
      _error = null;
      _tree = _loadTree(id);
    });
  }

  String _label(Json row) {
    final ar = text(row, 'nameAr');
    final en = text(row, 'nameEn');
    return _arabic ? (ar.isEmpty ? en : ar) : (en.isEmpty ? ar : en);
  }

  String _warehouseLabel(Json row) {
    final ar = text(row, 'nameAr');
    final en = text(row, 'nameEn');
    final name = _arabic ? (ar.isEmpty ? en : ar) : (en.isEmpty ? ar : en);
    return text(row, 'code').isEmpty ? name : '${text(row, 'code')} — $name';
  }

  /// The tree as a flat list with a depth, so it can be searched and scrolled
  /// as one list rather than as nested widgets that rebuild everything.
  List<_LocationNode> _flatten(List<Json> nodes) {
    final out = <_LocationNode>[];
    void walk(List<Json> rows, int depth) {
      for (final row in rows) {
        out.add(_LocationNode(row, depth));
        final children = listOf(row['children']);
        if (children.isEmpty) continue;
        if (!_collapsed.contains(text(row, 'id'))) walk(children, depth + 1);
      }
    }

    walk(nodes, 0);
    return out;
  }

  List<_LocationNode> _search(List<_LocationNode> rows) {
    final needle = _query.toLowerCase();
    if (needle.isEmpty) return rows;
    return rows.where((node) {
      final haystack = [
        text(node.row, 'code'),
        text(node.row, 'nameEn'),
        text(node.row, 'nameAr'),
        text(node.row, 'kind'),
      ].join(' ').toLowerCase();
      return haystack.contains(needle);
    }).toList(growable: false);
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

  Future<void> _create({Json? parent}) async {
    final warehouseId = _warehouseId;
    if (warehouseId == null) return;
    final parentRow = parent;
    final parentKind = parentRow == null ? null : text(parentRow, 'kind');
    final choices = parentRow == null
        ? const ['ZONE']
        : (_allowedChildren[parentKind] ?? const <String>[]);
    if (choices.isEmpty) {
      showMessage(
        context,
        _t(
          'لا يمكن وضع شيء داخل صندوق. الصندوق آخر ما في الشجرة.',
          'Nothing sits inside a bin; the bin is the end of the tree.',
        ),
        error: true,
      );
      return;
    }

    final codeController = TextEditingController();
    final nameArController = TextEditingController();
    final nameEnController = TextEditingController();
    var kind = choices.first;
    var error = '';

    final draft = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: Text(
            parentRow == null
                ? _t('منطقة جديدة', 'New zone')
                : _t(
                    'موقع جديد داخل ${text(parentRow, 'code')}',
                    'New location inside ${text(parentRow, 'code')}',
                  ),
          ),
          content: SizedBox(
            width: 440,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: kind,
                  decoration: InputDecoration(
                    labelText: _t('نوع الموقع', 'Kind'),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  items: [
                    for (final value in choices)
                      DropdownMenuItem(value: value, child: Text(_kindLabel(value, _arabic))),
                  ],
                  onChanged: (value) => setDialogState(() => kind = value ?? kind),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: codeController,
                  textDirection: TextDirection.ltr,
                  decoration: InputDecoration(
                    labelText: _t('الكود', 'Code'),
                    helperText: _t(
                      'مثل Z1 أو A-03 أو BIN-12. فريد داخل المخزن.',
                      'Such as Z1, A-03 or BIN-12. Unique inside the warehouse.',
                    ),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: nameArController,
                  textDirection: TextDirection.rtl,
                  decoration: InputDecoration(
                    labelText: _t('الاسم (عربي)', 'Name (Arabic)'),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: nameEnController,
                  textDirection: TextDirection.ltr,
                  decoration: InputDecoration(
                    labelText: _t('الاسم (إنجليزي)', 'Name (English)'),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                if (error.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.sm),
                  Text(error, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: Text(_t('إلغاء', 'Cancel')),
            ),
            FilledButton(
              onPressed: () {
                if (codeController.text.trim().isEmpty ||
                    nameArController.text.trim().isEmpty ||
                    nameEnController.text.trim().isEmpty) {
                  setDialogState(
                    () => error = _t(
                      'الكود والاسمان مطلوبون: التقرير المطبوع يحتاج الاسمين.',
                      'The code and both names are required: a printed label needs both.',
                    ),
                  );
                  return;
                }
                Navigator.of(dialogContext).pop({
                  'warehouseId': warehouseId,
                  if (parentRow != null) 'parentId': text(parentRow, 'id'),
                  'kind': kind,
                  'code': codeController.text.trim(),
                  'nameEn': nameEnController.text.trim(),
                  'nameAr': nameArController.text.trim(),
                });
              },
              child: Text(_t('حفظ', 'Save')),
            ),
          ],
        ),
      ),
    );
    if (draft == null || !mounted) return;

    await _run(() async {
      await ref.read(apiClientProvider).post('/inventory/locations', body: draft);
      if (!mounted) return;
      showMessage(context, _t('تم إنشاء الموقع.', 'The location was created.'));
      _refresh();
    });
  }

  Future<void> _edit(Json row) async {
    final codeController = TextEditingController(text: text(row, 'code'));
    final nameArController = TextEditingController(text: text(row, 'nameAr'));
    final nameEnController = TextEditingController(text: text(row, 'nameEn'));
    var isActive = row['isActive'] != false;
    var error = '';

    final draft = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: Text(_t('تعديل موقع', 'Edit location')),
          content: SizedBox(
            width: 440,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: codeController,
                  textDirection: TextDirection.ltr,
                  decoration: InputDecoration(
                    labelText: _t('الكود', 'Code'),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: nameArController,
                  textDirection: TextDirection.rtl,
                  decoration: InputDecoration(
                    labelText: _t('الاسم (عربي)', 'Name (Arabic)'),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: nameEnController,
                  textDirection: TextDirection.ltr,
                  decoration: InputDecoration(
                    labelText: _t('الاسم (إنجليزي)', 'Name (English)'),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: isActive,
                  title: Text(_t('نشط', 'Active')),
                  subtitle: Text(
                    _t(
                      'الموقع غير النشط يبقى في التاريخ ولا يُختار في حركة جديدة.',
                      'An inactive location stays in the history and cannot be chosen for new movements.',
                    ),
                  ),
                  onChanged: (value) => setDialogState(() => isActive = value),
                ),
                if (error.isNotEmpty)
                  Text(error, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: Text(_t('إلغاء', 'Cancel')),
            ),
            FilledButton(
              onPressed: () {
                if (codeController.text.trim().isEmpty) {
                  setDialogState(() => error = _t('الكود مطلوب.', 'The code is required.'));
                  return;
                }
                Navigator.of(dialogContext).pop({
                  'code': codeController.text.trim(),
                  'nameAr': nameArController.text.trim(),
                  'nameEn': nameEnController.text.trim(),
                  'isActive': isActive,
                });
              },
              child: Text(_t('حفظ', 'Save')),
            ),
          ],
        ),
      ),
    );
    if (draft == null || !mounted) return;

    await _run(() async {
      await ref
          .read(apiClientProvider)
          .patch('/inventory/locations/${text(row, 'id')}', body: draft);
      if (!mounted) return;
      showMessage(context, _t('تم تحديث الموقع.', 'The location was updated.'));
      _refresh();
    });
  }

  Future<void> _retire(Json row) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_t('إيقاف الموقع', 'Retire the location')),
        content: Text(
          _t(
            'لا يمكن إيقاف موقع ما زال يحوي بضاعة أو مواقع فرعية. انقل ما فيه أولًا.',
            'A location still holding stock or sub-locations cannot be retired. Move what is in it first.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(_t('إلغاء', 'Cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(_t('إيقاف', 'Retire')),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    await _run(() async {
      await ref.read(apiClientProvider).delete('/inventory/locations/${text(row, 'id')}');
      if (!mounted) return;
      showMessage(context, _t('تم إيقاف الموقع.', 'The location was retired.'));
      _refresh();
    });
  }

  Future<void> _reactivate(Json row) async {
    await _run(() async {
      await ref
          .read(apiClientProvider)
          .patch('/inventory/locations/${text(row, 'id')}', body: {'isActive': true});
      if (!mounted) return;
      showMessage(context, _t('تم تفعيل الموقع.', 'The location is active again.'));
      _refresh();
    });
  }

  Future<void> _moveStock(Json from) async {
    final warehouseId = _warehouseId;
    if (warehouseId == null) return;

    List<Json> items = const [];
    List<Json> lots = const [];
    try {
      items = await ref
          .read(apiClientProvider)
          .getList('/inventory/items', query: {'pageSize': 500, 'includeInactive': false});
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
      return;
    }
    if (!mounted) return;
    if (items.isEmpty) {
      showMessage(context, _t('لا توجد أصناف لنقلها.', 'There are no items to move.'));
      return;
    }

    final siblings = await _loadTree(warehouseId);
    final options = _flatten(listOf(siblings['items']))
        .where((node) => text(node.row, 'id') != text(from, 'id'))
        .where((node) => node.row['isActive'] != false)
        .toList(growable: false);
    if (!mounted) return;
    if (options.isEmpty) {
      showMessage(
        context,
        _t(
          'لا يوجد موقع آخر نشط في هذا المخزن لنقل البضاعة إليه.',
          'There is no other active location in this warehouse to move stock to.',
        ),
        error: true,
      );
      return;
    }

    var itemId = text(items.first, 'id');
    var toId = text(options.first.row, 'id');
    String? batchId;
    final quantityController = TextEditingController();
    final reasonController = TextEditingController();
    var error = '';

    Future<List<Json>> lotsOf(String item) async {
      try {
        return await ref.read(apiClientProvider).getList(
          '/inventory/batches',
          query: {'itemId': item, 'warehouseId': warehouseId, 'pageSize': 200},
        );
      } on Failure {
        // A lot list is a convenience here: an item that is not lot-managed
        // has none, and the move is still recorded against the shelf.
        return const [];
      }
    }

    lots = await lotsOf(itemId);
    if (!mounted) return;

    final draft = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) {
          return AlertDialog(
            title: Text(_t('نقل بضاعة بين موقعين', 'Move stock between locations')),
            content: SizedBox(
              width: 460,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _t(
                        'من ${text(from, 'code')} إلى موقع آخر في نفس المخزن. المجاميع لا تتغير: يتغير مكان البضاعة فقط.',
                        'From ${text(from, 'code')} to another location in the same warehouse. No total changes: only where the goods are.',
                      ),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    DropdownButtonFormField<String>(
                      initialValue: itemId,
                      decoration: InputDecoration(
                        labelText: _t('الصنف', 'Item'),
                        border: const OutlineInputBorder(),
                        isDense: true,
                      ),
                      items: [
                        for (final item in items)
                          DropdownMenuItem(
                            value: text(item, 'id'),
                            child: Text(
                              '${text(item, 'code')} — ${_arabic ? text(item, 'nameAr') : text(item, 'nameEn')}',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                      onChanged: (value) async {
                        final chosen = value ?? itemId;
                        setDialogState(() {
                          itemId = chosen;
                          batchId = null;
                          lots = const [];
                        });
                        final rows = await lotsOf(chosen);
                        if (!dialogContext.mounted) return;
                        setDialogState(() => lots = rows);
                      },
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    DropdownButtonFormField<String>(
                      initialValue: batchId,
                      decoration: InputDecoration(
                        labelText: _t('الدفعة (اختياري)', 'Lot (optional)'),
                        helperText: _t(
                          'اتركها فارغة إن كان الصنف غير مُدار بالدفعات.',
                          'Leave empty when the item is not lot-controlled.',
                        ),
                        border: const OutlineInputBorder(),
                        isDense: true,
                      ),
                      items: [
                        for (final lot in lots)
                          DropdownMenuItem(
                            value: text(lot, 'id'),
                            child: Text(
                              '${text(lot, 'batchNumber')} · ${text(lot, 'remainingQuantity')}',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                      onChanged: (value) => setDialogState(() => batchId = value),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    DropdownButtonFormField<String>(
                      initialValue: toId,
                      decoration: InputDecoration(
                        labelText: _t('إلى موقع', 'To location'),
                        border: const OutlineInputBorder(),
                        isDense: true,
                      ),
                      items: [
                        for (final node in options)
                          DropdownMenuItem(
                            value: text(node.row, 'id'),
                            child: Text(
                              '${'  ' * node.depth}${text(node.row, 'code')} — ${_label(node.row)}',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                      onChanged: (value) => setDialogState(() => toId = value ?? toId),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    TextField(
                      controller: quantityController,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: InputDecoration(
                        labelText: _t('الكمية', 'Quantity'),
                        border: const OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    TextField(
                      controller: reasonController,
                      decoration: InputDecoration(
                        labelText: _t('السبب (يصبح في سجل الحركة)', 'Reason (recorded on the movement)'),
                        border: const OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                    if (error.isNotEmpty) ...[
                      const SizedBox(height: AppSpacing.sm),
                      Text(error, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    ],
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: Text(_t('إلغاء', 'Cancel')),
              ),
              FilledButton(
                onPressed: () {
                  final quantity = double.tryParse(quantityController.text.trim());
                  if (quantity == null || quantity <= 0) {
                    setDialogState(
                      () => error = _t('أدخل كمية أكبر من صفر.', 'Enter a quantity above zero.'),
                    );
                    return;
                  }
                  Navigator.of(dialogContext).pop({
                    'fromLocationId': text(from, 'id'),
                    'toLocationId': toId,
                    'itemId': itemId,
                    if (batchId != null) 'batchId': batchId,
                    'quantity': quantityController.text.trim(),
                    if (reasonController.text.trim().isNotEmpty)
                      'reason': reasonController.text.trim(),
                  });
                },
                child: Text(_t('نقل', 'Move')),
              ),
            ],
          );
        },
      ),
    );
    if (draft == null || !mounted) return;

    await _run(() async {
      await ref.read(apiClientProvider).post('/inventory/locations/move-stock', body: draft);
      if (!mounted) return;
      showMessage(context, _t('تم نقل البضاعة.', 'The stock was moved.'));
      _refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
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
              SizedBox(
                width: 280,
                child: DropdownButtonFormField<String>(
                  initialValue: _warehouseId,
                  decoration: InputDecoration(
                    labelText: _t('المخزن', 'Warehouse'),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  items: [
                    for (final warehouse in _warehouses)
                      DropdownMenuItem(
                        value: text(warehouse, 'id'),
                        child: Text(_warehouseLabel(warehouse), overflow: TextOverflow.ellipsis),
                      ),
                  ],
                  onChanged: (value) {
                    if (value == null) return;
                    setState(() {
                      _warehouseId = value;
                      _collapsed.clear();
                      _tree = _loadTree(value);
                    });
                  },
                ),
              ),
              SearchField(
                hint: _t('ابحث بالكود أو الاسم', 'Search code or name'),
                onChanged: (value) => setState(() => _query = value.trim()),
              ),
              IconButton(
                tooltip: _t('تحديث', 'Refresh'),
                onPressed: _refresh,
                icon: const Icon(Icons.refresh),
              ),
              if (_canManage)
                FilledButton.icon(
                  key: const ValueKey('location-create-zone'),
                  onPressed: _busy || _warehouseId == null ? null : () => _create(),
                  icon: const Icon(Icons.add, size: 18),
                  label: Text(_t('منطقة جديدة', 'New zone')),
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
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ),
        Expanded(
          child: _tree == null
              ? Center(
                  child: Text(
                    _warehouses.isEmpty
                        ? _t('لا يوجد مخزن بعد.', 'There is no warehouse yet.')
                        : _t('اختر مخزنًا لعرض شجرته.', 'Choose a warehouse to see its tree.'),
                  ),
                )
              : FutureBuilder<Json>(
                  future: _tree,
                  builder: (context, snapshot) {
                    if (snapshot.connectionState != ConnectionState.done) {
                      return const Center(child: CircularProgressIndicator());
                    }
                    if (snapshot.hasError) {
                      return Center(
                        child: Padding(
                          padding: const EdgeInsets.all(AppSpacing.lg),
                          child: Text('${snapshot.error}'),
                        ),
                      );
                    }
                    final rows = _search(_flatten(listOf(snapshot.data?['items'])));
                    if (rows.isEmpty) {
                      return Center(
                        child: Text(
                          _t(
                            'لا توجد مواقع في هذا المخزن. ابدأ بمنطقة، ثم ممر، ثم رف أو صندوق.',
                            'No locations in this warehouse. Start with a zone, then an aisle, then a shelf or bin.',
                          ),
                        ),
                      );
                    }
                    return ListView.separated(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                      itemCount: rows.length,
                      separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.xs),
                      itemBuilder: (context, index) => _row(rows[index]),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _row(_LocationNode node) {
    final row = node.row;
    final kind = text(row, 'kind');
    final children = listOf(row['children']);
    final active = row['isActive'] != false;
    final stock = row['stock'] is Map ? Map<String, dynamic>.from(row['stock'] as Map) : const <String, dynamic>{};

    return Padding(
      padding: EdgeInsetsDirectional.only(start: node.depth * 20.0),
      child: Card(
        margin: EdgeInsets.zero,
        child: ListTile(
          leading: Tooltip(
            message: _kindLabel(kind, _arabic),
            child: Icon(
              children.isEmpty ? _kindIcon(kind) : Icons.subdirectory_arrow_right,
              color: active ? null : Theme.of(context).disabledColor,
            ),
          ),
          title: Row(
            children: [
              Text(
                text(row, 'code'),
                style: const TextStyle(fontFeatures: [FontFeature.tabularFigures()]),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(child: Text(_label(row), overflow: TextOverflow.ellipsis)),
              if (!active)
                Padding(
                  padding: const EdgeInsetsDirectional.only(start: AppSpacing.sm),
                  child: Text(
                    _t('موقوف', 'Retired'),
                    style: Theme.of(context).textTheme.labelSmall,
                  ),
                ),
            ],
          ),
          subtitle: Text(
            [
              _kindLabel(kind, _arabic),
              '${_t('أصناف', 'items')}: ${text(stock, 'items', fallback: '0')}',
              '${_t('كمية', 'qty')}: ${text(stock, 'quantity', fallback: '0.0000')}',
              if (children.isNotEmpty) '${_t('داخلها', 'inside')}: ${children.length}',
            ].join(' · '),
          ),
          trailing: Wrap(
            spacing: AppSpacing.xs,
            children: [
              if (children.isNotEmpty)
                IconButton(
                  tooltip: _collapsed.contains(text(row, 'id'))
                      ? _t('إظهار', 'Expand')
                      : _t('إخفاء', 'Collapse'),
                  onPressed: () => setState(() {
                    final id = text(row, 'id');
                    if (!_collapsed.remove(id)) _collapsed.add(id);
                  }),
                  icon: Icon(
                    _collapsed.contains(text(row, 'id'))
                        ? Icons.unfold_more
                        : Icons.unfold_less,
                    size: 18,
                  ),
                ),
              if (_canManage && (_allowedChildren[kind] ?? const <String>[]).isNotEmpty)
                IconButton(
                  tooltip: _t('إضافة موقع داخله', 'Add a location inside'),
                  onPressed: _busy ? null : () => _create(parent: row),
                  icon: const Icon(Icons.add, size: 18),
                ),
              PopupMenuButton<String>(
                tooltip: _t('إجراءات', 'Actions'),
                onSelected: (value) {
                  if (value == 'edit') {
                    _edit(row);
                  } else if (value == 'move') {
                    _moveStock(row);
                  } else if (value == 'retire') {
                    _retire(row);
                  } else if (value == 'reactivate') {
                    _reactivate(row);
                  }
                },
                itemBuilder: (context) => [
                  if (_canManage)
                    PopupMenuItem(value: 'edit', child: Text(_t('تعديل', 'Edit'))),
                  if (_canMove)
                    PopupMenuItem(
                      value: 'move',
                      child: Text(_t('نقل بضاعة من هنا', 'Move stock from here')),
                    ),
                  if (_canManage && active)
                    PopupMenuItem(value: 'retire', child: Text(_t('إيقاف الموقع', 'Retire'))),
                  if (_canManage && !active)
                    PopupMenuItem(value: 'reactivate', child: Text(_t('تفعيل', 'Activate'))),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
