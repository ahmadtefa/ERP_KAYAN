import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../widgets/batch_operation_dialog.dart';

/// The lots the company is holding, oldest expiry first.
///
/// A batch is not a settings record: it is a quantity with a cost frozen at
/// receipt, which is why the row shows what is left and what it is worth, not
/// an edit button. Lots are created by receiving stock and consumed by issuing
/// it; this screen reads them and reports what is about to expire.
///
/// The server narrows the list twice - by branch scope and by warehouse grant -
/// so a person sees the lots of their own shelves and nothing else.
///
/// Every route here needs `inventory.batches.read`; receiving, issuing,
/// writing off and transferring need their own grants, which this read-only
/// screen does not exercise.
class BatchesController extends JsonListController {
  @override
  String get resourcePath => '/inventory/batches';

  /// Empty lots are hidden: a lot with nothing left is history, not stock, and
  /// showing them would bury the lots that still hold goods.
  @override
  Map<String, dynamic> get resourceQuery => const {'includeEmpty': 'false'};
}

final batchesListProvider =
    AsyncNotifierProvider<BatchesController, List<Json>>(BatchesController.new);

/// Which slice of the lots the screen is showing.
enum BatchFilter { all, expiring, expired }

class BatchesScreen extends ConsumerStatefulWidget {
  const BatchesScreen({super.key});

  @override
  ConsumerState<BatchesScreen> createState() => _BatchesScreenState();
}

class _BatchesScreenState extends ConsumerState<BatchesScreen> {
  String _query = '';
  BatchFilter _filter = BatchFilter.all;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String _itemName(Json row) {
    final item = row['item'];
    if (item is! Map) return '';
    return _arabic
        ? text(Map<String, dynamic>.from(item), 'nameAr')
        : text(Map<String, dynamic>.from(item), 'nameEn');
  }

  String _warehouseName(Json row) {
    final warehouse = row['warehouse'];
    if (warehouse is! Map) return '';
    return _arabic
        ? text(Map<String, dynamic>.from(warehouse), 'nameAr')
        : text(Map<String, dynamic>.from(warehouse), 'nameEn');
  }

  /// A `@db.Date` column arrives as a full ISO timestamp; only the day is
  /// meaningful, and a missing one is a dash.
  String _dateCell(Object? value) {
    final raw = asString(value);
    if (raw == null || raw.isEmpty) return '—';
    return raw.split('T').first;
  }

  /// Runs one batch operation and refetches the list afterwards.
  ///
  /// The refetch is the point: a receive changes the remaining quantity, an
  /// issue may consume a different lot under FEFO, and a write-off empties one.
  /// Leaving the table as it was would show stock the server no longer holds.
  Future<void> _operate(BatchOperation operation, {Json? batch}) async {
    final user = ref.read(currentUserProvider);
    if (user == null || !user.can(operation.permission)) {
      showMessage(
        context,
        _arabic
            ? 'لا تملك صلاحية تنفيذ هذه العملية.'
            : 'You do not have permission for this operation.',
        error: true,
      );
      return;
    }
    // The pickers need items and warehouses. A failure here is a real error the
    // operator must see: without it the dialog would open with empty lists and
    // the submit would be refused for a reason that looks like their mistake.
    final List<Json> items;
    final List<Json> warehouses;
    final List<Json> locations;
    try {
      items = await ref.read(itemsProvider.future);
      warehouses = await ref.read(batchOperationWarehousesProvider.future);
      locations = await ref.read(batchOperationLocationsProvider.future);
    } catch (error) {
      if (!mounted) return;
      showMessage(context, error, error: true);
      return;
    }
    if (!mounted) return;
    final accepted = await showBatchOperationDialog(
      context,
      operation: operation,
      batch: batch,
      items: items,
      warehouses: warehouses,
      locations: locations,
    );
    if (!accepted || !mounted) return;
    // Quietly: the rows stay on screen while the new quantities arrive, so the
    // table does not flash empty between the operation and its result.
    await ref.read(batchesListProvider.notifier).refreshQuietly();
    if (!mounted) return;
    showMessage(context, _arabic ? 'تم' : 'Done');
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(batchesListProvider);
    // Watched once, at the top: the row actions and the receive button both
    // ask what the signed-in user may do, and a watch inside the row builder
    // would subscribe once per row.
    final user = ref.watch(currentUserProvider);
    final mayReceive = user?.can(BatchOperation.receive.permission) ?? false;

    return ModuleScaffold(
      title: _arabic ? 'الدفعات' : 'Batches',
      eyebrow: _arabic ? 'المخزون' : 'Inventory',
      // A Wrap, not a Row: the header already wraps its tools, but a Row
      // cannot be broken by the parent Wrap, so the Arabic labels of the
      // segmented control pushed the search box past the edge.
      trailing: Wrap(
        spacing: 8,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          SegmentedButton<BatchFilter>(
            segments: [
              ButtonSegment(
                value: BatchFilter.all,
                label: Text(_arabic ? 'الكل' : 'All'),
              ),
              ButtonSegment(
                value: BatchFilter.expiring,
                label: Text(_arabic ? 'قريبة الانتهاء' : 'Expiring'),
              ),
              ButtonSegment(
                value: BatchFilter.expired,
                label: Text(_arabic ? 'منتهية' : 'Expired'),
              ),
            ],
            selected: {_filter},
            onSelectionChanged: (value) =>
                setState(() => _filter = value.first),
          ),
          SearchField(
            hint: _arabic ? 'بحث في الدفعات' : 'Search batches',
            onChanged: (value) => setState(() => _query = value.trim()),
          ),
          IconButton(
            tooltip: _arabic ? 'تحديث' : 'Refresh',
            onPressed: () => ref.read(batchesListProvider.notifier).reload(),
            icon: const Icon(Icons.refresh),
          ),
          // Receiving is the only operation that does not start from a row: it
          // creates the lot the others consume.
          if (mayReceive)
            FilledButton.icon(
              onPressed: () => _operate(BatchOperation.receive),
              icon: const Icon(Icons.add_box_outlined),
              label: Text(_arabic ? 'استلام دفعة' : 'Receive'),
            ),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(batchesListProvider.notifier).reload(),
        isEmpty: (rows) => _visible(rows).isEmpty,
        emptyMessage: _arabic ? 'لا توجد دفعات.' : 'No batches.',
        data: (rows) => RecordsTable(
          rows: _visible(rows),
          actions: (row) {
            final remaining = asNum(row['remainingQuantity']) ?? 0;
            // An emptied lot cannot be issued, transferred or written off: the
            // server would refuse, so the buttons are not offered. Receiving
            // into an existing lot is a different call and stays available.
            final hasStock = remaining > 0;
            final buttons = <Widget>[];
            for (final entry in <(BatchOperation, String)>[
              (BatchOperation.issue, _arabic ? 'صرف' : 'Issue'),
              (BatchOperation.transfer, _arabic ? 'تحويل' : 'Transfer'),
              (BatchOperation.writeOff, _arabic ? 'شطب' : 'Write off'),
            ]) {
              final (operation, label) = entry;
              if (!(user?.can(operation.permission) ?? false)) continue;
              if (!hasStock) continue;
              buttons.add(
                TextButton(
                  onPressed: () => _operate(operation, batch: row),
                  child: Text(label),
                ),
              );
            }
            return buttons;
          },
          columns: [
            ColumnSpec(
              _arabic ? 'رقم الدفعة' : 'Batch',
              value: (r) => text(r, 'batchNumber'),
              emphasise: true,
            ),
            ColumnSpec(_arabic ? 'الصنف' : 'Item', value: _itemName),
            ColumnSpec(
              _arabic ? 'المستودع' : 'Warehouse',
              value: _warehouseName,
            ),
            ColumnSpec(
              _arabic ? 'المتبقي' : 'Remaining',
              numeric: true,
              value: (r) => formatQuantity(asString(r['remainingQuantity'])),
            ),
            ColumnSpec(
              _arabic ? 'تكلفة الوحدة' : 'Unit cost',
              numeric: true,
              value: (r) => formatAmount(asString(r['unitCost'])),
            ),
            ColumnSpec(
              _arabic ? 'القيمة' : 'Value',
              numeric: true,
              value: (r) => formatAmount(asString(r['value'])),
            ),
            ColumnSpec(
              _arabic ? 'الإنتاج' : 'Production',
              // Not every lot records one, and a lot without dates is normal
              // for an item that does not expire, so a missing value reads as
              // a dash instead of the word "null".
              value: (r) => _dateCell(r['productionDate']),
            ),
            ColumnSpec(
              _arabic ? 'الانتهاء' : 'Expiry',
              value: (r) => _dateCell(r['expiryDate']),
            ),
            ColumnSpec(
              _arabic ? 'الموقع' : 'Location',
              // The shelf is optional and may have been removed since the lot
              // was put away, so the code alone is shown when the detail is
              // missing.
              value: (r) {
                final location = r['storageLocation'];
                if (location is! Map) return '—';
                final row = Map<String, dynamic>.from(location);
                return _arabic
                    ? text(row, 'nameAr', fallback: text(row, 'code'))
                    : text(row, 'nameEn', fallback: text(row, 'code'));
              },
            ),
            ColumnSpec(
              _arabic ? 'الأيام' : 'Days',
              numeric: true,
              value: (r) => r['daysToExpiry'] == null
                  ? '—'
                  : asString(r['daysToExpiry']),
              tone: (r) {
                final days = asNum(r['daysToExpiry']);
                if (days == null) return AppTone.neutral;
                if (days < 0) return AppTone.danger;
                if (days <= 30) return AppTone.warning;
                return AppTone.neutral;
              },
            ),
            ColumnSpec(
              l10n.status,
              value: (r) => text(r, 'status'),
            ),
          ],
        ),
      ),
    );
  }

  /// The segmented filter is applied on the rows the server already narrowed.
  /// A client-side filter can only hide, never widen, which is why it is safe
  /// to keep the scope decision on the server.
  List<Json> _visible(List<Json> rows) {
    final filtered = rows.where((row) {
      final days = asNum(row['daysToExpiry']);
      return switch (_filter) {
        BatchFilter.all => true,
        BatchFilter.expiring => days != null && days >= 0 && days <= 30,
        BatchFilter.expired => days != null && days < 0,
      };
    });
    if (_query.isEmpty) return filtered.toList(growable: false);
    final needle = _query.toLowerCase();
    return filtered
        .where(
          (r) =>
              text(r, 'batchNumber').toLowerCase().contains(needle) ||
              _itemName(r).contains(_query),
        )
        .toList(growable: false);
  }
}
