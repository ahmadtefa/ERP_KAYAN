import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/json/amount_format.dart';
import '../../core/json/json_utils.dart';
import '../../features/auth/presentation/providers/auth_providers.dart';
import '../../features/common/presentation/providers/resource_providers.dart';
import '../extensions/l10n_extension.dart';
import 'data_dialog.dart';
import 'resizable_table.dart';
import 'state_views.dart';

/// Picks an item, and shows what is actually in stock where it is actually
/// tracked.
///
/// Two figures are shown, and they are not the same thing:
///
///  - the branch balance, from `stock_balances`, which is per **branch and
///    item** - the same figure the invoice posting checks before it lets goods
///    leave;
///  - where that stock sits, warehouse by warehouse, summed from the
///    append-only movements. A movement that names no warehouse is shown as
///    "unassigned" rather than being attributed to one.
///
/// Without `inventory.stock.read` both columns are absent and the dialog says
/// why, instead of showing a made-up zero.
Future<Json?> showItemPicker(
  BuildContext context, {
  String? title,
  String? branchId,
}) {
  return showDataDialog<Json>(
    context,
    storageKey: 'item-picker',
    title: title,
    icon: Icons.inventory_2_outlined,
    child: ItemPickerDialog(branchId: branchId),
  );
}

class ItemPickerDialog extends ConsumerStatefulWidget {
  const ItemPickerDialog({super.key, this.branchId});

  final String? branchId;

  @override
  ConsumerState<ItemPickerDialog> createState() => _ItemPickerDialogState();
}

class _ItemPickerDialogState extends ConsumerState<ItemPickerDialog> {
  final _search = TextEditingController();
  Future<List<Json>>? _stock;
  Future<List<Json>>? _byWarehouse;
  bool _canSeeStock = false;
  String _query = '';

  @override
  void initState() {
    super.initState();
    final user = ref.read(currentUserProvider);
    _canSeeStock = user?.can('inventory.stock.read') ?? false;
    if (_canSeeStock) {
      final branchId = widget.branchId ?? user?.branchId;
      _stock = ref.read(apiClientProvider).getList(
        '/inventory/stock',
        query: {'branchId': ?branchId},
      );
      _byWarehouse = ref.read(apiClientProvider).getList(
        '/inventory/stock/by-warehouse',
        query: {'branchId': ?branchId},
      );
    }
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final items = ref.watch(activeItemsProvider);
    final language = Localizations.localeOf(context).languageCode;

    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        children: [
          TextField(
            controller: _search,
            autofocus: true,
            decoration: InputDecoration(
              labelText: l10n.searchItems,
              prefixIcon: const Icon(Icons.search),
              border: const OutlineInputBorder(),
              isDense: true,
            ),
            onChanged: (value) => setState(() => _query = value.trim().toLowerCase()),
          ),
          const SizedBox(height: 8),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: Text(
              _canSeeStock ? l10n.branchStockHint : l10n.stockNotVisible,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: AsyncStateView<List<Json>>(
              value: items,
              onRetry: () => ref.invalidate(itemsProvider),
              isEmpty: (rows) => _filter(rows, language).isEmpty,
              emptyMessage: l10n.noRecords,
              data: (rows) => FutureBuilder<List<Json>>(
                future: _stock,
                builder: (context, snapshot) => FutureBuilder<List<Json>>(
                  future: _byWarehouse,
                  builder: (context, warehouseSnapshot) {
                  final stock = _stockByItem(snapshot.data ?? const []);
                  final where = _warehousesByItem(
                    warehouseSnapshot.data ?? const [],
                  );
                  return SingleChildScrollView(
                    child: ResizableTable(
                      storageKey: 'item-picker',
                      rows: _filter(rows, language),
                      onTap: (row) => Navigator.of(context).pop(row),
                      columns: [
                        ResizableColumn(
                          l10n.item,
                          width: 110,
                          value: (row) => text(row, 'code'),
                        ),
                        ResizableColumn(
                          language == 'ar' ? 'الاسم' : 'Name',
                          width: 260,
                          value: (row) =>
                              language == 'ar' && text(row, 'nameAr').isNotEmpty
                                  ? text(row, 'nameAr')
                                  : text(row, 'nameEn'),
                        ),
                        ResizableColumn(
                          l10n.unit,
                          width: 90,
                          value: (row) => text(row, 'unit'),
                        ),
                        if (_canSeeStock)
                          ResizableColumn(
                            l10n.availableInBranch,
                            width: 150,
                            numeric: true,
                            value: (row) {
                              if (!flag(row, 'isStockTracked', fallback: true)) {
                                return '—';
                              }
                              return stock[text(row, 'id')] ?? '0.0000';
                            },
                          ),
                        if (_canSeeStock)
                          ResizableColumn(
                            l10n.perWarehouse,
                            width: 210,
                            value: (row) {
                              if (!flag(row, 'isStockTracked', fallback: true)) {
                                return '—';
                              }
                              return where[text(row, 'id')] ?? '—';
                            },
                          ),
                        ResizableColumn(
                          l10n.unitPrice,
                          width: 130,
                          numeric: true,
                          value: (row) => formatAmount(text(row, 'salePrice')),
                        ),
                      ],
                      actions: (row) => [
                        TextButton(
                          onPressed: () => Navigator.of(context).pop(row),
                          child: Text(l10n.selectItem),
                        ),
                      ],
                    ),
                  );
                  },
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  List<Json> _filter(List<Json> rows, String language) {
    final active = rows
        .where((row) => flag(row, 'isActive', fallback: true))
        .toList(growable: false);
    if (_query.isEmpty) return active;
    return active.where((row) {
      final name = language == 'ar' && text(row, 'nameAr').isNotEmpty
          ? text(row, 'nameAr')
          : text(row, 'nameEn');
      return text(row, 'code').toLowerCase().contains(_query) ||
          name.toLowerCase().contains(_query) ||
          text(row, 'barcode').toLowerCase().contains(_query);
    }).toList(growable: false);
  }

  /// "WH-1 3 · WH-2 4 · Unassigned 1", in the reader's language. Empty when the
  /// item has no movements yet.
  Map<String, String> _warehousesByItem(List<Json> rows) {
    final language = Localizations.localeOf(context).languageCode;
    final map = <String, String>{};
    for (final row in rows) {
      final itemId = text(row, 'itemId');
      if (itemId.isEmpty) continue;
      final parts = <String>[];
      for (final warehouse in listOf(row['warehouses'])) {
        final name = language == 'ar' && text(warehouse, 'nameAr').isNotEmpty
            ? text(warehouse, 'nameAr')
            : text(warehouse, 'nameEn');
        final label = name.isNotEmpty
            ? name
            : (text(warehouse, 'code').isNotEmpty
                  ? text(warehouse, 'code')
                  : context.l10n.unassignedWarehouse);
        parts.add('$label ${formatQuantity(text(warehouse, 'quantity'))}');
      }
      if (parts.isNotEmpty) map[itemId] = parts.join(' · ');
    }
    return map;
  }

  /// The stock endpoint returns one row per branch and item. The picker asks
  /// for one branch (the caller's, or the signed-in user's), so each item has
  /// exactly one row and the figure is that branch's balance. If no branch is
  /// known the last row the server sent wins, which is why the screen says
  /// which branch the numbers belong to.
  Map<String, String> _stockByItem(List<Json> rows) {
    final map = <String, String>{};
    for (final row in rows) {
      final itemId = text(row, 'itemId');
      if (itemId.isEmpty) continue;
      map[itemId] = text(row, 'quantity', fallback: '0.0000');
    }
    return map;
  }
}
