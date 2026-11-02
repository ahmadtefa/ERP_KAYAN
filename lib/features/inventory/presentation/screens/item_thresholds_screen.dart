import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// «حدود الصنف في المخزن» - the minimum, the reorder point and the maximum,
/// decided per shelf instead of once for the whole company.
///
/// A shop with a main store, a cold room and a branch shelf does not want the
/// same minimum in all three: the cold room holds a week, the shelf holds a
/// day. These are the figures the reorder report prints and the notification
/// centre reads at night, so they are edited here - next to the warehouse -
/// and the screen says plainly what to order today rather than leaving the
/// arithmetic to the reader.
class ItemThresholdsScreen extends ConsumerStatefulWidget {
  const ItemThresholdsScreen({super.key});

  @override
  ConsumerState<ItemThresholdsScreen> createState() => _ItemThresholdsScreenState();
}

class _ItemThresholdsScreenState extends ConsumerState<ItemThresholdsScreen> {
  List<Json> _warehouses = const [];
  String? _warehouseId;
  Future<List<Json>>? _future;
  String _query = '';
  bool _onlyBelowMinimum = false;
  bool _busy = false;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  bool get _canManage =>
      ref.read(currentUserProvider)?.can('inventory.warehouses.manage') ?? false;

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
        _future = _load();
      });
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    }
  }

  Future<List<Json>> _load() {
    final client = ref.read(apiClientProvider);
    return client.getList('/inventory/item-thresholds', query: {
      if (_warehouseId != null) 'warehouseId': _warehouseId,
      if (_onlyBelowMinimum) 'belowMinimum': 'true',
    });
  }

  void _refresh() => setState(() => _future = _load());

  String _itemLabel(Json row) {
    final item = row['item'] is Map ? Map<String, dynamic>.from(row['item'] as Map) : const <String, dynamic>{};
    final ar = text(item, 'nameAr');
    final en = text(item, 'nameEn');
    final name = _arabic ? (ar.isEmpty ? en : ar) : (en.isEmpty ? ar : en);
    return text(item, 'code').isEmpty ? name : '${text(item, 'code')} — $name';
  }

  String _warehouseLabel(Json row) {
    final warehouse = row['warehouse'] is Map
        ? Map<String, dynamic>.from(row['warehouse'] as Map)
        : const <String, dynamic>{};
    return text(warehouse, 'code').isEmpty ? '—' : text(warehouse, 'code');
  }

  List<Json> _filter(List<Json> rows) {
    final needle = _query.toLowerCase();
    if (needle.isEmpty) return rows;
    return rows.where((row) {
      final haystack = [
        _itemLabel(row),
        _warehouseLabel(row),
        text(row, 'itemId'),
      ].join(' ').toLowerCase();
      return haystack.contains(needle);
    }).toList(growable: false);
  }

  Future<void> _edit(Json row) async {
    final minController = TextEditingController(text: text(row, 'minQuantity', fallback: '0'));
    final reorderController =
        TextEditingController(text: text(row, 'reorderQuantity', fallback: '0'));
    final maxController = TextEditingController(text: text(row, 'maxQuantity', fallback: '0'));
    var error = '';

    final draft = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: Text(_t('حدود الصنف', 'The item’s limits')),
          content: SizedBox(
            width: 440,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(_itemLabel(row), style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  _t(
                    'المخزن ${_warehouseLabel(row)} · الرصيد الآن ${text(row, 'onHand', fallback: '0')}',
                    'Warehouse ${_warehouseLabel(row)} · on hand now ${text(row, 'onHand', fallback: '0')}',
                  ),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: minController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                    labelText: _t('الحد الأدنى', 'Minimum'),
                    helperText: _t(
                      'نقص عن هذا الحد يعني «تحت الحد الأدنى» في التنبيهات والتقارير.',
                      'Falling to this figure means “below minimum” in the alerts and reports.',
                    ),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: reorderController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                    labelText: _t('نقطة إعادة الطلب', 'Reorder point'),
                    helperText: _t(
                      'عندها يُطلب الصنف. صفر يعني استخدام الحد الأدنى.',
                      'The figure that triggers ordering. Zero means “use the minimum”.',
                    ),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: maxController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                    labelText: _t('الحد الأقصى', 'Maximum'),
                    helperText: _t(
                      'سقف المخزون. صفر يعني بلا سقف، وليس «اطلب صفرًا».',
                      'The ceiling. Zero means no ceiling, not “order nothing”.',
                    ),
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
              key: const ValueKey('threshold-save'),
              onPressed: () {
                final min = double.tryParse(minController.text.trim());
                final reorder = double.tryParse(reorderController.text.trim());
                final max = double.tryParse(maxController.text.trim());
                if (min == null || reorder == null || max == null) {
                  setDialogState(
                    () => error = _t(
                      'الحدود أرقام. اكتب 0 لتعطيل حد لا تستخدمه.',
                      'The limits are numbers. Write 0 for a limit you do not use.',
                    ),
                  );
                  return;
                }
                if (min < 0 || reorder < 0 || max < 0) {
                  setDialogState(
                    () => error = _t('لا يكون الحد سالبًا.', 'A limit cannot be negative.'),
                  );
                  return;
                }
                if (max > 0 && max < min) {
                  setDialogState(
                    () => error = _t(
                      'الحد الأقصى أقل من الحد الأدنى.',
                      'The maximum is below the minimum.',
                    ),
                  );
                  return;
                }
                if (max > 0 && reorder > max) {
                  setDialogState(
                    () => error = _t(
                      'نقطة إعادة الطلب أعلى من الحد الأقصى.',
                      'The reorder point is above the maximum.',
                    ),
                  );
                  return;
                }
                Navigator.of(dialogContext).pop({
                  'minQuantity': min,
                  'reorderQuantity': reorder,
                  'maxQuantity': max,
                });
              },
              child: Text(_t('حفظ', 'Save')),
            ),
          ],
        ),
      ),
    );
    if (draft == null || !mounted) return;

    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).put(
        '/inventory/item-thresholds/${text(row, 'warehouseId')}/${text(row, 'itemId')}',
        body: draft,
      );
      if (!mounted) return;
      showMessage(context, _t('تم حفظ الحدود.', 'The limits were saved.'));
      _refresh();
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ModuleScaffold(
      title: _t('حدود الأصناف في المخازن', 'Item limits per warehouse'),
      subtitle: _t(
        'الحد الأدنى ونقطة إعادة الطلب والحد الأقصى لكل صنف في كل مخزن، وما يُطلب اليوم.',
        'The minimum, reorder point and maximum for each item in each warehouse, and what to order today.',
      ),
      body: Column(
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
                  width: 240,
                  child: DropdownButtonFormField<String>(
                    initialValue: _warehouseId ?? '',
                    decoration: InputDecoration(
                      labelText: _t('المخزن', 'Warehouse'),
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                    items: [
                      DropdownMenuItem<String>(
                        value: '',
                        child: Text(_t('كل المخازن', 'All warehouses')),
                      ),
                      for (final warehouse in _warehouses)
                        DropdownMenuItem<String>(
                          value: text(warehouse, 'id'),
                          child: Text(
                            _arabic
                                ? text(warehouse, 'nameAr', fallback: text(warehouse, 'code'))
                                : text(warehouse, 'nameEn', fallback: text(warehouse, 'code')),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                    onChanged: (value) {
                      setState(() {
                        _warehouseId = value == null || value.isEmpty ? null : value;
                        _future = _load();
                      });
                    },
                  ),
                ),
                SearchField(
                  hint: _t('ابحث بالصنف', 'Search item'),
                  onChanged: (value) => setState(() => _query = value.trim()),
                ),
                FilterChip(
                  selected: _onlyBelowMinimum,
                  label: Text(_t('تحت الحد الأدنى فقط', 'Below minimum only')),
                  onSelected: (value) {
                    setState(() {
                      _onlyBelowMinimum = value;
                      _future = _load();
                    });
                  },
                ),
                IconButton(
                  tooltip: _t('تحديث', 'Refresh'),
                  onPressed: _refresh,
                  icon: const Icon(Icons.refresh),
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
          Expanded(
            child: _future == null
                ? const Center(child: CircularProgressIndicator())
                : FutureBuilder<List<Json>>(
                    future: _future,
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
                      final rows = _filter(snapshot.data ?? const <Json>[]);
                      if (rows.isEmpty) {
                        return Center(
                          child: Text(
                            _t(
                              'لا توجد حدود مسجلة بعد. افتح الحدود من أي صنف لتحديدها لكل مخزن.',
                              'No limits recorded yet. Open the limits of any item to set them per warehouse.',
                            ),
                          ),
                        );
                      }
                      return RecordsTable(
                        rows: rows,
                        onTap: _canManage ? _edit : null,
                        columns: [
                          ColumnSpec(
                            _t('الصنف', 'Item'),
                            flex: 3,
                            value: _itemLabel,
                          ),
                          ColumnSpec(_t('المخزن', 'Warehouse'), value: _warehouseLabel),
                          ColumnSpec(
                            _t('الرصيد', 'On hand'),
                            numeric: true,
                            value: (row) => text(row, 'onHand', fallback: '0.0000'),
                          ),
                          ColumnSpec(
                            _t('الأدنى', 'Min'),
                            numeric: true,
                            value: (row) => text(row, 'minQuantity', fallback: '0.0000'),
                          ),
                          ColumnSpec(
                            _t('إعادة الطلب', 'Reorder'),
                            numeric: true,
                            value: (row) => text(row, 'reorderQuantity', fallback: '0.0000'),
                          ),
                          ColumnSpec(
                            _t('الأقصى', 'Max'),
                            numeric: true,
                            value: (row) => text(row, 'maxQuantity', fallback: '0.0000'),
                          ),
                          ColumnSpec(
                            _t('اطلب اليوم', 'Order today'),
                            numeric: true,
                            emphasise: true,
                            value: (row) => text(row, 'suggestedOrder', fallback: '0.0000'),
                          ),
                          ColumnSpec(
                            _t('الحالة', 'State'),
                            value: (row) {
                              if (flag(row, 'isBelowMinimum')) {
                                return _t('تحت الحد الأدنى', 'Below minimum');
                              }
                              if (flag(row, 'isAboveMaximum')) {
                                return _t('أعلى من الأقصى', 'Above maximum');
                              }
                              return _t('داخل الحدود', 'Within limits');
                            },
                            tone: (row) {
                              if (flag(row, 'isBelowMinimum')) return AppTone.danger;
                              if (flag(row, 'isAboveMaximum')) return AppTone.warning;
                              return AppTone.success;
                            },
                          ),
                        ],
                        actions: (row) => [
                          if (_canManage)
                            IconButton(
                              tooltip: _t('تعديل الحدود', 'Edit the limits'),
                              onPressed: _busy ? null : () => _edit(row),
                              icon: const Icon(Icons.tune, size: 18),
                            ),
                        ],
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
