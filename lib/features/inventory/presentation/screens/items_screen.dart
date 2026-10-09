import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
          helper: l10n.stockNotTracked,
        ),
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
      if (mounted) showMessage(context, l10n.createdSuccessfully);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
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
              value: (r) =>
                  flag(r, 'isActive', fallback: true) ? l10n.active : l10n.inactive,
            ),
          ],
          actions: (row) => [
            IconButton(
              tooltip: l10n.edit,
              icon: const Icon(Icons.edit_outlined, size: 20),
              onPressed: _busy ? null : () => _save(existing: row),
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
