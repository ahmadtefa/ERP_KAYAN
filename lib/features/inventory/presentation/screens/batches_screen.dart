import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

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

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(batchesListProvider);

    return ModuleScaffold(
      title: _arabic ? 'الدفعات' : 'Batches',
      eyebrow: _arabic ? 'المخزون' : 'Inventory',
      trailing: Row(
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
          const SizedBox(width: 12),
          SearchField(
            hint: _arabic ? 'بحث في الدفعات' : 'Search batches',
            onChanged: (value) => setState(() => _query = value.trim()),
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
              _arabic ? 'الانتهاء' : 'Expiry',
              // `asString` answers null for a missing or empty value, and a
              // lot with no expiry date is a real row in this table.
              value: (r) =>
                  asString(r['expiryDate'])?.split('T').first ?? '—',
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
