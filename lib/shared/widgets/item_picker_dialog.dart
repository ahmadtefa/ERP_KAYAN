import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/json/amount_format.dart';
import '../../core/json/json_utils.dart';
import '../../features/auth/presentation/providers/auth_providers.dart';
import '../../features/common/presentation/providers/resource_providers.dart';
import '../../features/inventory/data/item_image_data_source.dart';
import '../../features/inventory/presentation/widgets/item_picture.dart';
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

  /// Small pictures for the items currently listed, so a picker shows the same
  /// picture the catalogue and the invoice do. Absent means "no picture".
  Map<String, Uint8List> _pictures = const {};
  String _picturesKey = '';

  @override
  void initState() {
    super.initState();
    final user = ref.read(currentUserProvider);
    _canSeeStock = user?.can('inventory.stock.read') ?? false;
    if (_canSeeStock) {
      final branchId = widget.branchId ?? user?.branchId;
      _stock = ref
          .read(apiClientProvider)
          .getList('/inventory/stock', query: {'branchId': ?branchId});
      _byWarehouse = ref
          .read(apiClientProvider)
          .getList(
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
            onChanged: (value) =>
                setState(() => _query = value.trim().toLowerCase()),
            onSubmitted: (value) {
              final code = value.trim().toLowerCase();
              final rows = items.value ?? const <Json>[];
              final matches = rows
                  .where((row) {
                    return text(row, 'barcode').toLowerCase() == code ||
                        listOf(row['units']).any(
                          (unit) => text(unit, 'barcode').toLowerCase() == code,
                        );
                  })
                  .toList(growable: false);
              if (code.isNotEmpty && matches.length == 1) {
                Navigator.of(context).pop(_select(matches.single));
              }
            },
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
                    _loadPictures(_filter(rows, language));
                    return SingleChildScrollView(
                      child: ResizableTable(
                        storageKey: 'item-picker',
                        rows: _filter(rows, language),
                        onTap: (row) => Navigator.of(context).pop(_select(row)),
                        columns: [
                          ResizableColumn(
                            l10n.item,
                            width: 150,
                            value: (row) => text(row, 'code'),
                            leading: (row) =>
                                ItemThumbnail(bytes: _pictures[text(row, 'id')]),
                          ),
                          ResizableColumn(
                            language == 'ar' ? 'الاسم' : 'Name',
                            width: 260,
                            value: (row) =>
                                language == 'ar' &&
                                    text(row, 'nameAr').isNotEmpty
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
                                if (!flag(
                                  row,
                                  'isStockTracked',
                                  fallback: true,
                                )) {
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
                                if (!flag(
                                  row,
                                  'isStockTracked',
                                  fallback: true,
                                )) {
                                  return '—';
                                }
                                return where[text(row, 'id')] ?? '—';
                              },
                            ),
                          ResizableColumn(
                            l10n.unitPrice,
                            width: 130,
                            numeric: true,
                            value: (row) =>
                                formatAmount(text(row, 'salePrice')),
                          ),
                        ],
                        actions: (row) => [
                          Flexible(
                            child: TextButton(
                              onPressed: () =>
                                  Navigator.of(context).pop(_select(row)),
                              child: Text(
                                l10n.selectItem,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
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

  /// Asks for the pictures of the items on show, once per distinct set.
  ///
  /// The ids are sorted before they form the key, so scrolling or rebuilding
  /// does not re-request the same page. A failure is silence: a picker that
  /// cannot fetch a thumbnail still lists every item, just without pictures.
  void _loadPictures(List<Json> rows) {
    final ids = [
      for (final row in rows)
        if (text(row, 'id').isNotEmpty) text(row, 'id'),
    ]..sort();
    final key = ids.join(',');
    if (key == _picturesKey) return;
    _picturesKey = key;
    if (ids.isEmpty) return;
    ItemImageDataSource(ref.read(apiClientProvider))
        .thumbnails(ids)
        .then((pictures) {
          if (!mounted || _picturesKey != key) return;
          setState(() => _pictures = pictures);
        })
        .catchError((Object _) => <String, Uint8List>{});
  }

  List<Json> _filter(List<Json> rows, String language) {
    final active = rows
        .where((row) => flag(row, 'isActive', fallback: true))
        .toList(growable: false);
    if (_query.isEmpty) return active;
    return active
        .where((row) {
          final name = language == 'ar' && text(row, 'nameAr').isNotEmpty
              ? text(row, 'nameAr')
              : text(row, 'nameEn');
          return text(row, 'code').toLowerCase().contains(_query) ||
              name.toLowerCase().contains(_query) ||
              text(row, 'barcode').toLowerCase().contains(_query) ||
              listOf(row['units']).any(
                (unit) => text(unit, 'barcode').toLowerCase().contains(_query),
              );
        })
        .toList(growable: false);
  }

  Json _select(Json row) {
    final matchingUnit = listOf(row['units']).where(
      (unit) =>
          _query.isNotEmpty && text(unit, 'barcode').toLowerCase() == _query,
    );
    final unitName = matchingUnit.isEmpty
        ? ''
        : text(matchingUnit.first, 'unit');
    return {...row, if (unitName.isNotEmpty) '_scannedUnitName': unitName};
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
