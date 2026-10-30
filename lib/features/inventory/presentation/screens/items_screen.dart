import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/error/failure.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/form_sheet.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../data/presentation/widgets/list_export_actions.dart';
import '../widgets/barcode_labels_dialog.dart';
import 'stock_screen.dart' show stockListProvider;

class ItemsController extends JsonListController {
  @override
  String get resourcePath => '/inventory/items';

  @override
  Map<String, dynamic> get resourceQuery => const {'includeInactive': 'true'};
}

final itemsListProvider =
    AsyncNotifierProvider<JsonListController, List<Json>>(ItemsController.new);

class ItemsScreen extends ConsumerStatefulWidget {
  const ItemsScreen({super.key});

  @override
  ConsumerState<ItemsScreen> createState() => _ItemsScreenState();
}

class _ItemsScreenState extends ConsumerState<ItemsScreen> {
  String _query = '';
  bool _busy = false;

  Future<void> _save({Json? existing}) async {
    final l10n = context.l10n;
    final isEdit = existing != null;
    final values = await showFormSheet(
      context,
      title: isEdit ? l10n.editItem : l10n.newItem,
      fields: [
        if (!isEdit) FieldSpec('code', l10n.accountCode, required: true),
        FieldSpec('nameEn', 'Name (English)', required: true),
        FieldSpec('nameAr', 'الاسم (عربي)', required: true),
        FieldSpec('unit', l10n.unit),
        FieldSpec('barcode', 'Barcode'),
        FieldSpec('salePrice', l10n.salePrice, kind: FieldKind.decimal),
        FieldSpec(
          'taxRate',
          l10n.taxRate,
          kind: FieldKind.decimal,
          helper: '0 - 100',
        ),
        FieldSpec(
          'isStockTracked',
          l10n.isStockTracked,
          kind: FieldKind.toggle,
          helper: l10n.stockTrackingDoesNotAddQuantity,
        ),
        if (!isEdit) ...[
          FieldSpec(
            'openingQuantity',
            l10n.openingQuantity,
            kind: FieldKind.decimal,
            helper: l10n.openingStockHint,
          ),
          FieldSpec(
            'openingUnitCost',
            l10n.openingUnitCost,
            kind: FieldKind.decimal,
          ),
        ],
        FieldSpec('notes', l10n.description, kind: FieldKind.multiline, maxLines: 2),
      ],
      initial: existing,
    );
    if (values == null || !mounted) return;

    setState(() => _busy = true);
    try {
      final client = ref.read(apiClientProvider);
      if (isEdit) {
        await client.patch('/inventory/items/${existing['id']}', body: values);
      } else {
        await client.post('/inventory/items', body: values);
      }
      await ref.read(itemsListProvider.notifier).reload();
      ref.invalidate(itemsProvider);
      // Opening stock is written in the same transaction as the item, so the
      // cached stock table must be refreshed as well.
      ref.invalidate(stockListProvider);
      if (mounted) showMessage(context, l10n.createdSuccessfully);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Units, packs and cartons for one item, each with its own code.
  ///
  /// The item's base unit is what stock is counted in; every other unit is a
  /// saved conversion factor. A barcode can belong to the item or to one unit,
  /// and a scan of a carton must mean a carton - which is why the unit's own
  /// factor is shown next to it instead of being assumed.
  Future<void> _manageUnits(Json row) async {
    final l10n = context.l10n;
    final itemId = text(row, 'id');
    final itemName = text(row, 'nameEn');
    final client = ref.read(apiClientProvider);
    final canManageBarcodes =
        ref.read(currentUserProvider)?.can('inventory.barcodes.manage') ?? false;
    final canSeeCost =
        ref.read(currentUserProvider)?.can('inventory.cost.read') ?? false;

    Future<List<Map<String, dynamic>>> loadUnits() async {
      final response = await client.raw.get<Map<String, dynamic>>(
        '/inventory/items/$itemId/units',
      );
      final values = response.data?['items'] as List<dynamic>? ?? const [];
      return values
          .whereType<Map>()
          .map((value) => Map<String, dynamic>.from(value))
          .toList(growable: false);
    }

    Future<void> reload() async {
      ref.read(itemsListProvider.notifier).reload();
    }

    while (mounted) {
      List<Map<String, dynamic>> units;
      try {
        units = await loadUnits();
      } on Failure catch (e) {
        if (mounted) showMessage(context, e.message, error: true);
        return;
      }
      if (!mounted) return;

      final action = await showDialog<String>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(l10n.unitsBarcodesTitle(itemName)),
          content: SizedBox(
            width: 560,
            child: units.isEmpty
                ? Text(l10n.unitsBarcodesEmpty)
                : ListView.separated(
                    shrinkWrap: true,
                    itemCount: units.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final unit = units[index];
                      final isBase = unit['isBase'] == true;
                      final isActive = unit['isActive'] != false;
                      final unitId = '${unit['id'] ?? ''}';
                      return ListTile(
                        dense: true,
                        title: Text(
                          isActive
                              ? '${unit['unit'] ?? ''}'
                              : l10n.unitsBarcodesInactiveUnit(
                                  '${unit['unit'] ?? ''}'),
                          style: isActive
                              ? null
                              : const TextStyle(color: Colors.grey),
                        ),
                        subtitle: Text(
                          l10n.unitsBarcodesFactorBarcode(
                            '${unit['factor'] ?? ''}',
                            '${unit['barcode'] ?? '—'}',
                          ) +
                              (isActive
                                  ? ''
                                  : '  •  ${l10n.unitsBarcodesHidden}'),
                        ),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              isBase
                                  ? l10n.unitsBarcodesBaseUnit
                                  : '× ${unit['factor'] ?? ''}',
                            ),
                            if (canManageBarcodes)
                              IconButton(
                                tooltip: l10n.unitsBarcodesGenerateTooltip,
                                icon: const Icon(Icons.qr_code_2, size: 20),
                                onPressed: () =>
                                    Navigator.of(dialogContext).pop('code:$unitId'),
                              ),
                            IconButton(
                              tooltip: l10n.unitsBarcodesEditTooltip,
                              icon: const Icon(Icons.edit_outlined, size: 20),
                              onPressed: () =>
                                  Navigator.of(dialogContext).pop('edit:$unitId'),
                            ),
                            if (!isBase && !isActive)
                              IconButton(
                                tooltip: l10n.unitsBarcodesReactivateTooltip,
                                icon: const Icon(
                                  Icons.check_circle_outline,
                                  size: 20,
                                ),
                                onPressed: () =>
                                    Navigator.of(dialogContext).pop('reactivate:$unitId'),
                              ),
                            if (isBase || isActive)
                              IconButton(
                                tooltip: isBase
                                    ? l10n.unitsBarcodesBaseCannotRemove
                                    : l10n.unitsBarcodesRemoveTooltip,
                                icon: const Icon(Icons.delete_outline, size: 20),
                                onPressed: isBase
                                    ? null
                                    : () => Navigator.of(dialogContext).pop('delete:$unitId'),
                              ),
                          ],
                        ),
                      );
                    },
                  ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: Text(MaterialLocalizations.of(dialogContext).closeButtonLabel),
            ),
            OutlinedButton.icon(
              onPressed: units
                      .any((unit) => '${unit['barcode'] ?? ''}'.trim().isNotEmpty)
                  ? () => Navigator.of(dialogContext).pop('labels')
                  : null,
              icon: const Icon(Icons.print_outlined, size: 18),
              label: Text(l10n.unitsBarcodesPrintLabels),
            ),
            FilledButton.icon(
              onPressed: () => Navigator.of(dialogContext).pop('add'),
              icon: const Icon(Icons.add),
              label: Text(l10n.unitsBarcodesAdd),
            ),
          ],
        ),
      );
      if (action == null || !mounted) return;

      if (action == 'add') {
        final values = await showFormSheet(
          context,
          title: l10n.unitsBarcodesAdd,
          fields: [
            FieldSpec('unit', l10n.unitsBarcodesFieldUnit, required: true),
            FieldSpec(
              'factor',
              l10n.unitsBarcodesFieldFactor,
              kind: FieldKind.decimal,
              required: true,
              helper: l10n.unitsBarcodesFactorHelper,
            ),
            if (canManageBarcodes)
              FieldSpec('barcode', l10n.unitsBarcodesFieldBarcode),
            FieldSpec('salePrice', l10n.unitsBarcodesFieldSalePrice,
                kind: FieldKind.decimal),
            if (canSeeCost)
              FieldSpec('purchasePrice', l10n.unitsBarcodesFieldPurchasePrice,
                  kind: FieldKind.decimal),
          ],
        );
        if (values == null || !mounted) return;
        try {
          await client.post('/inventory/items/$itemId/units', body: values);
          await reload();
          if (mounted) showMessage(context, l10n.unitsBarcodesAdded);
        } on Failure catch (e) {
          if (mounted) showMessage(context, e.message, error: true);
        }
        continue;
      }

      if (action == 'labels') {
        if (!mounted) return;
        await showDialog<void>(
          context: context,
          builder: (_) => BarcodeLabelsDialog(
            itemId: itemId,
            itemName: itemName,
            units: units
                .map(
                  (unit) => LabelUnitSelection(
                    unitId: '${unit['id'] ?? ''}',
                    unitName: '${unit['unit'] ?? ''}',
                    barcode: '${unit['barcode'] ?? ''}'.trim().isEmpty
                        ? null
                        : '${unit['barcode']}',
                    isActive: unit['isActive'] != false,
                  ),
                )
                .toList(growable: false),
          ),
        );
        continue;
      }

      final parts = action.split(':');
      final verb = parts.first;
      final unitId = parts.length > 1 ? parts.sublist(1).join(':') : '';
      final unit = units.firstWhere(
        (value) => '${value['id'] ?? ''}' == unitId,
        orElse: () => const <String, dynamic>{},
      );
      final isBase = unit['isBase'] == true;

      if (verb == 'code') {
        try {
          await client.post('/inventory/items/$itemId/units/$unitId/barcode', body: const {});
          await reload();
          if (mounted) showMessage(context, l10n.unitsBarcodesBarcodeGenerated);
        } on Failure catch (e) {
          if (mounted) showMessage(context, e.message, error: true);
        }
        continue;
      }

      if (verb == 'reactivate') {
        try {
          await client.post(
            '/inventory/items/$itemId/units/$unitId/reactivate',
          );
          await reload();
          if (mounted) showMessage(context, l10n.unitsBarcodesReactivated);
        } on Failure catch (e) {
          if (mounted) showMessage(context, e.message, error: true);
        }
        continue;
      }

      if (verb == 'delete') {
        final ok = await confirmAction(
          context,
          title: l10n.unitsBarcodesRemoveTitle,
          // The server deletes only a unit no document ever used; a used unit
          // is deactivated instead, so past documents keep their unit label.
          message: l10n.unitsBarcodesRemoveConfirm(
            '${unit['unit'] ?? ''}',
          ),
          confirmLabel: l10n.removeLine,
          destructive: true,
        );
        if (!ok || !mounted) return;
        try {
          final response =
              await client.delete('/inventory/items/$itemId/units/$unitId');
          await reload();
          if (mounted) {
            final deactivated = response['deactivated'] == true;
            showMessage(
              context,
              deactivated
                  ? l10n.unitsBarcodesDeactivated
                  : l10n.unitsBarcodesRemoved,
            );
          }
        } on Failure catch (e) {
          if (mounted) showMessage(context, e.message, error: true);
        }
        continue;
      }

      if (verb == 'edit') {
        final values = await showFormSheet(
          context,
          title: l10n.unitsBarcodesEditTitle,
          initial: {
            'unit': unit['unit'],
            'factor': unit['factor'],
            if (canManageBarcodes) 'barcode': unit['barcode'],
            'salePrice': unit['salePrice'],
            if (canSeeCost) 'purchasePrice': unit['purchasePrice'],
          },
          fields: [
            FieldSpec(
              'unit',
              l10n.unitsBarcodesFieldUnit,
              required: true,
              helper: isBase ? l10n.unitsBarcodesBaseCannotRenameHelper : null,
            ),
            FieldSpec(
              'factor',
              l10n.unitsBarcodesFieldFactor,
              kind: FieldKind.decimal,
              required: true,
              helper: isBase
                  ? l10n.unitsBarcodesBaseFactorHelper
                  : l10n.unitsBarcodesFactorEditHelper,
            ),
            if (canManageBarcodes)
              FieldSpec('barcode', l10n.unitsBarcodesFieldBarcode),
            FieldSpec('salePrice', l10n.unitsBarcodesFieldSalePrice,
                kind: FieldKind.decimal),
            if (canSeeCost)
              FieldSpec('purchasePrice', l10n.unitsBarcodesFieldPurchasePrice,
                  kind: FieldKind.decimal),
          ],
        );
        if (values == null || !mounted) return;
        try {
          await client.patch('/inventory/items/$itemId/units/$unitId', body: values);
          await reload();
          if (mounted) showMessage(context, l10n.unitsBarcodesUpdated);
        } on Failure catch (e) {
          if (mounted) showMessage(context, e.message, error: true);
        }
      }
    }
  }

  Future<void> _toggleActive(Json row) async {
    final l10n = context.l10n;
    final isActive = flag(row, 'isActive', fallback: true);
    if (isActive) {
      final ok = await confirmAction(
        context,
        title: l10n.deactivate,
        message: l10n.confirmReverse,
        confirmLabel: l10n.deactivate,
        destructive: true,
      );
      if (!ok || !mounted) return;
    }
    setState(() => _busy = true);
    try {
      final client = ref.read(apiClientProvider);
      if (isActive) {
        await client.post('/inventory/items/${row['id']}/deactivate');
      } else {
        await client.patch(
          '/inventory/items/${row['id']}',
          body: {'isActive': true},
        );
      }
      await ref.read(itemsListProvider.notifier).reload();
      ref.invalidate(itemsProvider);
      // Opening stock is written in the same transaction as the item, so the
      // cached stock table must be refreshed as well.
      ref.invalidate(stockListProvider);
      if (mounted) showMessage(context, l10n.createdSuccessfully);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(itemsListProvider);

    return ModuleScaffold(
      title: l10n.items,
      actions: const [ListExportActions(list: 'items')],
      trailing: Row(
        children: [
          SearchField(
            hint: l10n.searchItems,
            onChanged: (value) => setState(() => _query = value.trim()),
          ),
          const SizedBox(width: 12),
          FilledButton.icon(
            onPressed: _busy ? null : () => _save(),
            icon: const Icon(Icons.add),
            label: Text(l10n.newItem),
          ),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(itemsListProvider.notifier).reload(),
        isEmpty: (rows) => _filter(rows).isEmpty,
        emptyMessage: l10n.noItems,
        data: (rows) => RecordsTable(
          rows: _filter(rows),
          columns: [
            ColumnSpec(l10n.accountCode, value: (r) => text(r, 'code'), emphasise: true),
            ColumnSpec('Name', value: (r) => text(r, 'nameEn')),
            ColumnSpec('الاسم', value: (r) => text(r, 'nameAr')),
            ColumnSpec(l10n.unit, value: (r) => text(r, 'unit')),
            ColumnSpec(
              l10n.salePrice,
              numeric: true,
              value: (r) => formatAmount(asString(r['salePrice'])),
            ),
            ColumnSpec(
              l10n.taxAmount,
              numeric: true,
              value: (r) => formatQuantity(asString(r['taxRate'])),
            ),
            ColumnSpec(
              l10n.isStockTracked,
              value: (r) => flag(r, 'isStockTracked')
                  ? l10n.stockTracked
                  : l10n.stockNotTracked,
            ),
            ColumnSpec(
              l10n.status,
              value: (r) => flag(r, 'isActive', fallback: true)
                  ? l10n.active
                  : l10n.inactive,
              tone: (r) => flag(r, 'isActive', fallback: true)
                  ? AppTone.success
                  : AppTone.neutral,
            ),
          ],
          actions: (row) => [
            IconButton(
              tooltip: l10n.edit,
              icon: const Icon(Icons.edit_outlined, size: 20),
              onPressed: _busy ? null : () => _save(existing: row),
            ),
            IconButton(
              tooltip: l10n.unitsBarcodesTooltip,
              icon: const Icon(Icons.qr_code_2_outlined, size: 20),
              onPressed: _busy ? null : () => _manageUnits(row),
            ),
            IconButton(
              tooltip: flag(row, 'isActive', fallback: true)
                  ? l10n.deactivate
                  : l10n.activate,
              icon: Icon(
                flag(row, 'isActive', fallback: true)
                    ? Icons.block_outlined
                    : Icons.check_circle_outline,
                size: 20,
              ),
              onPressed: _busy ? null : () => _toggleActive(row),
            ),
          ],
        ),
      ),
    );
  }

  List<Json> _filter(List<Json> rows) {
    if (_query.isEmpty) return rows;
    final needle = _query.toLowerCase();
    return rows
        .where(
          (r) =>
              text(r, 'code').toLowerCase().contains(needle) ||
              text(r, 'nameEn').toLowerCase().contains(needle) ||
              text(r, 'nameAr').contains(_query),
        )
        .toList(growable: false);
  }
}
