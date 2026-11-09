import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/router/draft_exit_guard.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/error/failure.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
import '../../../../shared/widgets/form_sheet.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../accounting/presentation/screens/journal_entries_screen.dart';
import '../../../dashboard/presentation/providers/dashboard_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../data/presentation/widgets/list_export_actions.dart';
import '../../data/item_image_data_source.dart';
import '../widgets/barcode_labels_dialog.dart';
import '../widgets/item_picture.dart';
import 'stock_screen.dart' show stockListProvider;

class ItemsController extends JsonListController {
  @override
  String get resourcePath => '/inventory/items';

  @override
  Map<String, dynamic> get resourceQuery => const {'includeInactive': 'true'};
}

final itemsListProvider = AsyncNotifierProvider<JsonListController, List<Json>>(
  ItemsController.new,
);

/// The small pictures for a page of the catalogue, in one request.
///
/// Keyed by the ids on screen, so paging or filtering asks exactly for what is
/// drawn and nothing more. Items without a picture are simply absent from the
/// answer and get the placeholder, which is why this is a map and not a list.
/// The key is the ids joined, not the list: two lists with the same ids are
/// not equal in Dart, so a list key would re-request the same page on every
/// rebuild. Sorting first means the same rows always produce the same key.
final itemThumbnailsProvider =
    FutureProvider.family<Map<String, Uint8List>, String>((ref, key) async {
  if (key.isEmpty) return const {};
  try {
    return await ItemImageDataSource(
      ref.watch(apiClientProvider),
    ).thumbnails(key.split(','));
  } on Object {
    // A picture is decoration. If the endpoint is unreachable - an older
    // server, a restricted account, a dropped connection - the catalogue
    // still lists every item, just without thumbnails. Letting this escape
    // would take the whole screen down over a 32-pixel square.
    return const {};
  }
});

/// The provider key for a page of ids.
String _thumbnailKey(Iterable<String> ids) => (ids.toList()..sort()).join(',');

class ItemsScreen extends ConsumerStatefulWidget {
  const ItemsScreen({super.key, this.navigationKey});

  final ValueKey<String>? navigationKey;

  @override
  ConsumerState<ItemsScreen> createState() => _ItemsScreenState();
}

class _ItemsScreenState extends ConsumerState<ItemsScreen> {
  String _query = '';
  bool _busy = false;
  final _exitRelay = DraftExitRelay();
  late final DraftExitGuard _exitGuard;

  @override
  void initState() {
    super.initState();
    _exitGuard = ref.read(draftExitGuardProvider);
    final key = widget.navigationKey;
    if (key != null) _exitGuard.register(key, _exitRelay.canLeave);
  }

  @override
  void dispose() {
    final key = widget.navigationKey;
    if (key != null) _exitGuard.unregister(key, _exitRelay.canLeave);
    super.dispose();
  }

  Future<void> _save({Json? existing}) async {
    final l10n = context.l10n;
    final isEdit = existing != null;
    final values = await showFormSheet(
      context,
      exitRelay: _exitRelay,
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
          emptyValue: '0',
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
        FieldSpec(
          'notes',
          l10n.description,
          kind: FieldKind.multiline,
          maxLines: 2,
        ),
      ],
      initial: existing,
      onSubmit: (draft) async {
        final client = ref.read(apiClientProvider);
        try {
          if (isEdit) {
            await client.patch(
              '/inventory/items/${existing['id']}',
              body: draft,
            );
          } else {
            await client.post('/inventory/items', body: draft);
          }
        } catch (error) {
          // The server may have committed before a transport error. Reload
          // the source instead of leaving dependent screens confidently stale.
          if (mounted) {
            ref.invalidate(itemsListProvider);
            ref.invalidate(itemsProvider);
            ref.invalidate(stockListProvider);
            ref.invalidate(journalEntriesProvider);
            invalidateDashboardAndReports(ref);
          }
          throw UncertainFormSubmission(error);
        }
      },
    );
    if (values == null || !mounted) return;

    setState(() => _busy = true);
    try {
      await ref.read(itemsListProvider.notifier).reload();
      ref.invalidate(itemsProvider);
      // Opening stock is written in the same transaction as the item, so the
      // cached stock table must be refreshed as well.
      ref.invalidate(stockListProvider);
      ref.invalidate(journalEntriesProvider);
      invalidateDashboardAndReports(ref);
      if (mounted) showMessage(context, l10n.createdSuccessfully);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The item's picture, on its own screen: an upload is not a form field.
  Future<void> _openPicture(Json row) async {
    // asString answers null for a missing or non-string value, so the empty
    // test has to come after the null one.
    final id = asString(row['id']) ?? '';
    if (id.isEmpty) return;
    final name = asString(row['nameEn']) ?? '';
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => Scaffold(
          appBar: AppBar(title: Text(context.l10n.itemPicture)),
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 12),
                ItemPictureEditor(itemId: id),
              ],
            ),
          ),
        ),
      ),
    );
    // The row now shows a different picture (or none), so both the list and
    // the thumbnails it draws are dropped. Invalidating the list alone would
    // leave the old thumbnail, because it is cached under the page's key.
    if (mounted) {
      ref.invalidate(itemThumbnailsProvider);
      ref.read(itemsListProvider.notifier).reload();
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
        ref.read(currentUserProvider)?.can('inventory.barcodes.manage') ??
        false;
    final canSeeCost =
        ref.read(currentUserProvider)?.can('inventory.cost.read') ?? false;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

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
      ref.invalidate(itemsProvider);
      await ref.read(itemsListProvider.notifier).reload();
    }

    Future<void> submitUnit(Future<void> Function() action) async {
      try {
        await action();
      } catch (error) {
        if (mounted) {
          ref.invalidate(itemsListProvider);
          ref.invalidate(itemsProvider);
        }
        throw UncertainFormSubmission(error);
      }
    }

    while (mounted) {
      List<Map<String, dynamic>> units;
      try {
        units = await loadUnits();
      } catch (error) {
        if (mounted) await showAppError(context, error);
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
                                  '${unit['unit'] ?? ''}',
                                ),
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
                                    Navigator.of(dialogContext)
                                        .pop('code:$unitId'),
                              ),
                            IconButton(
                              tooltip: l10n.unitsBarcodesEditTooltip,
                              icon: const Icon(Icons.edit_outlined, size: 20),
                              onPressed: () =>
                                  Navigator.of(dialogContext)
                                      .pop('edit:$unitId'),
                            ),
                            if (!isBase && !isActive)
                              IconButton(
                                tooltip: l10n.unitsBarcodesReactivateTooltip,
                                icon: const Icon(
                                  Icons.check_circle_outline,
                                  size: 20,
                                ),
                                onPressed: () =>
                                    Navigator.of(dialogContext)
                                        .pop('reactivate:$unitId'),
                              ),
                            if (isBase || isActive)
                              IconButton(
                                tooltip: isBase
                                    ? l10n.unitsBarcodesBaseCannotRemove
                                    : l10n.unitsBarcodesRemoveTooltip,
                                icon: const Icon(
                                  Icons.delete_outline,
                                  size: 20,
                                ),
                                onPressed: isBase
                                    ? null
                                    : () =>
                                          Navigator.of(dialogContext)
                                              .pop('delete:$unitId'),
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
              child: Text(
                MaterialLocalizations.of(dialogContext).closeButtonLabel,
              ),
            ),
            OutlinedButton.icon(
              onPressed:
                  units.any(
                    (unit) => '${unit['barcode'] ?? ''}'.trim().isNotEmpty,
                  )
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
          exitRelay: _exitRelay,
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
            FieldSpec(
              'salePrice',
              l10n.unitsBarcodesFieldSalePrice,
              kind: FieldKind.decimal,
            ),
            if (canSeeCost)
              FieldSpec(
                'purchasePrice',
                l10n.unitsBarcodesFieldPurchasePrice,
                kind: FieldKind.decimal,
              ),
          ],
          onSubmit: (draft) => submitUnit(() async {
            await client.post('/inventory/items/$itemId/units', body: draft);
          }),
        );
        if (values == null || !mounted) return;
        await reload();
        if (mounted) showMessage(context, l10n.unitsBarcodesAdded);
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
          await client.post(
            '/inventory/items/$itemId/units/$unitId/barcode',
            body: const {},
          );
          await reload();
          if (mounted) showMessage(context, l10n.unitsBarcodesBarcodeGenerated);
        } catch (error) {
          if (mounted) {
            ref.invalidate(itemsListProvider);
            ref.invalidate(itemsProvider);
            await showAppError(context, error);
          }
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
        } catch (error) {
          if (mounted) {
            ref.invalidate(itemsListProvider);
            ref.invalidate(itemsProvider);
            await showAppError(context, error);
          }
        }
        continue;
      }

      if (verb == 'delete') {
        final ok = await confirmAction(
          context,
          title: l10n.unitsBarcodesRemoveTitle,
          // The server deletes only a unit no document ever used; a used unit
          // is deactivated instead, so past documents keep their unit label.
          message: l10n.unitsBarcodesRemoveConfirm('${unit['unit'] ?? ''}'),
          confirmLabel: l10n.removeLine,
          destructive: true,
        );
        if (!ok || !mounted) return;
        try {
          final response = await client.delete(
            '/inventory/items/$itemId/units/$unitId',
          );
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
        } catch (error) {
          if (mounted) {
            ref.invalidate(itemsListProvider);
            ref.invalidate(itemsProvider);
            await showAppError(context, error);
          }
        }
        continue;
      }

      if (verb == 'edit') {
        final values = await showFormSheet(
          context,
          exitRelay: _exitRelay,
          title: l10n.unitsBarcodesEditTitle,
          initial: {
            'unit': unit['unit'],
            'factor': unit['factor'],
            if (canManageBarcodes) 'barcode': unit['barcode'],
            'salePrice': unit['salePrice'],
            if (canSeeCost) 'purchasePrice': unit['purchasePrice'],
            'isDefaultSale': unit['isDefaultSale'] == true,
            'isDefaultPurchase': unit['isDefaultPurchase'] == true,
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
            FieldSpec(
              'salePrice',
              l10n.unitsBarcodesFieldSalePrice,
              kind: FieldKind.decimal,
            ),
            if (canSeeCost)
              FieldSpec(
                'purchasePrice',
                l10n.unitsBarcodesFieldPurchasePrice,
                kind: FieldKind.decimal,
              ),
            FieldSpec(
              'isDefaultSale',
              isArabic ? 'وحدة البيع الافتراضية' : 'Default sales unit',
              kind: FieldKind.toggle,
            ),
            FieldSpec(
              'isDefaultPurchase',
              isArabic ? 'وحدة الشراء الافتراضية' : 'Default purchase unit',
              kind: FieldKind.toggle,
            ),
          ],
          onSubmit: (draft) => submitUnit(() async {
            await client.patch(
              '/inventory/items/$itemId/units/$unitId',
              body: draft,
            );
          }),
        );
        if (values == null || !mounted) return;
        await reload();
        if (mounted) showMessage(context, l10n.unitsBarcodesUpdated);
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
    } catch (error) {
      if (mounted) {
        ref.invalidate(itemsListProvider);
        ref.invalidate(itemsProvider);
        ref.invalidate(stockListProvider);
        await showAppError(context, error);
      }
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
      // The header actions live in an AppBar, which measures them with an
      // unbounded width. A Row there reported "RenderFlex overflowed" on a
      // narrow window instead of moving the button below the search box; a
      // Wrap gives each child its own width and wraps the rest.
      trailing: Wrap(
        spacing: 12,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          SearchField(
            hint: l10n.searchItems,
            onChanged: (value) => setState(() => _query = value.trim()),
          ),
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
        data: (rows) {
          final visible = _filter(rows);
          // Only the rows on screen are asked about, and only once: a filtered
          // catalogue does not fetch pictures for items it is not drawing.
          final ids = [
            for (final row in visible)
              if (text(row, 'id').isNotEmpty) text(row, 'id'),
          ];
          // A thumbnail is decoration. Watching this provider rethrows the
          // error it caught into the screen build, which took the whole
          // catalogue down - no rows, no row actions - for a 32-pixel square.
          // Reading the current value and ignoring a pending or failed future
          // keeps the list itself independent of the picture endpoint.
          Map<String, Uint8List> pictures = const {};
          if (ids.isNotEmpty) {
            final thumbnails = ref.watch(
              itemThumbnailsProvider(_thumbnailKey(ids)),
            );
            if (thumbnails.hasValue) {
              pictures = thumbnails.value ?? const {};
            }
          }
          return RecordsTable(
            rows: visible,
            columns: [
              ColumnSpec(
                l10n.accountCode,
                value: (r) => text(r, 'code'),
                emphasise: true,
                // The item's own picture sits with its code rather than in a
                // column of its own: on a phone the first column is the card's
                // headline, and a headline of nothing but a picture would lose
                // the code the rest of the app refers to.
                leading: (row) => ItemThumbnail(bytes: pictures[text(row, 'id')]),
              ),
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
                // The picture is edited on its own screen because changing it
                // uploads a file, which the plain field sheet cannot do.
                tooltip: l10n.itemPicture,
                icon: const Icon(Icons.image_outlined, size: 20),
                onPressed: _busy ? null : () => _openPicture(row),
              ),
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
          );
        },
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
