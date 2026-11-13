import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/form_sheet.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// The minimum, reorder point and maximum of each item, per warehouse.
///
/// These are the numbers the reorder report prints and the evening
/// notification reads, so they belong next to the shelf they describe rather
/// than on the item card, which every store shares. The endpoint already
/// returns the on-hand quantity and the suggested order for each row, which is
/// what makes the screen useful: a threshold is only interesting beside the
/// quantity it is being compared to.
final itemThresholdsProvider =
    AsyncNotifierProvider<ItemThresholdsController, List<Json>>(
      ItemThresholdsController.new,
    );

class ItemThresholdsController extends JsonListController {
  @override
  String get resourcePath => '/inventory/item-thresholds';
}

class ItemThresholdsScreen extends ConsumerStatefulWidget {
  const ItemThresholdsScreen({super.key});

  @override
  ConsumerState<ItemThresholdsScreen> createState() =>
      _ItemThresholdsScreenState();
}

class _ItemThresholdsScreenState extends ConsumerState<ItemThresholdsScreen> {
  bool _belowMinimumOnly = false;
  String _query = '';

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String _itemName(Json row) {
    final item = row['item'];
    if (item is! Map) return '';
    final json = Map<String, dynamic>.from(item);
    return _arabic ? text(json, 'nameAr') : text(json, 'nameEn');
  }

  String _warehouseName(Json row) {
    final warehouse = row['warehouse'];
    if (warehouse is! Map) return '';
    final json = Map<String, dynamic>.from(warehouse);
    return _arabic ? text(json, 'nameAr') : text(json, 'nameEn');
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(itemThresholdsProvider);
    final canManage =
        ref.watch(currentUserProvider)?.can('inventory.warehouses.manage') ??
        false;

    return ModuleScaffold(
      title: _arabic ? 'حدود الأصناف' : 'Item thresholds',
      eyebrow: _arabic ? 'المخزون' : 'Inventory',
      trailing: SearchField(
        hint: _arabic ? 'بحث في الأصناف' : 'Search items',
        onChanged: (value) => setState(() => _query = value.trim()),
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(itemThresholdsProvider.notifier).reload(),
        isEmpty: (rows) => _visible(rows).isEmpty,
        emptyMessage: _arabic
            ? 'لم تُضبط حدود بعد.'
            : 'No thresholds have been set yet.',
        data: (rows) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 0, 24, 12),
              child: Align(
                alignment: AlignmentDirectional.centerStart,
                child: FilterChip(
                  label: Text(
                    _arabic ? 'تحت الحد الأدنى فقط' : 'Below minimum only',
                  ),
                  selected: _belowMinimumOnly,
                  onSelected: (value) =>
                      setState(() => _belowMinimumOnly = value),
                ),
              ),
            ),
            Expanded(
              child: RecordsTable(
                rows: _visible(rows),
                columns: [
                  ColumnSpec(
                    _arabic ? 'الصنف' : 'Item',
                    value: _itemName,
                    emphasise: true,
                  ),
                  ColumnSpec(
                    _arabic ? 'المستودع' : 'Warehouse',
                    value: _warehouseName,
                  ),
                  ColumnSpec(
                    _arabic ? 'المتاح' : 'On hand',
                    numeric: true,
                    value: (r) => formatQuantity(asString(r['onHand'])),
                  ),
                  ColumnSpec(
                    _arabic ? 'الحد الأدنى' : 'Minimum',
                    numeric: true,
                    value: (r) => formatQuantity(asString(r['minQuantity'])),
                  ),
                  ColumnSpec(
                    _arabic ? 'نقطة الطلب' : 'Reorder at',
                    numeric: true,
                    value: (r) =>
                        formatQuantity(asString(r['reorderQuantity'])),
                  ),
                  ColumnSpec(
                    _arabic ? 'الأقصى' : 'Maximum',
                    numeric: true,
                    value: (r) => formatQuantity(asString(r['maxQuantity'])),
                  ),
                  ColumnSpec(
                    _arabic ? 'المطلوب طلبه' : 'Suggested order',
                    numeric: true,
                    // Zero here means "nothing to order", not "no maximum" -
                    // the server says which, and the column stays quiet when
                    // there is nothing to do.
                    value: (r) {
                      final suggested = asString(r['suggestedOrder']) ?? '0';
                      return num.tryParse(suggested) == 0
                          ? '—'
                          : formatQuantity(suggested);
                    },
                    tone: (r) => flag(r, 'isBelowMinimum')
                        ? AppTone.danger
                        : AppTone.neutral,
                  ),
                  ColumnSpec(
                    l10n.status,
                    value: (r) {
                      if (flag(r, 'isBelowMinimum')) {
                        return _arabic ? 'تحت الحد' : 'Below minimum';
                      }
                      if (flag(r, 'isAboveMaximum')) {
                        return _arabic ? 'فوق الحد' : 'Above maximum';
                      }
                      return _arabic ? 'داخل الحد' : 'Within limits';
                    },
                  ),
                ],
                actions: canManage
                    ? (row) => [
                        IconButton(
                          tooltip: l10n.edit,
                          icon: const Icon(Icons.tune_rounded),
                          onPressed: () => _edit(row),
                        ),
                      ]
                    : null,
              ),
            ),
          ],
        ),
      ),
    );
  }

  List<Json> _visible(List<Json> rows) {
    var filtered = rows;
    if (_belowMinimumOnly) {
      filtered = filtered
          .where((row) => flag(row, 'isBelowMinimum'))
          .toList(growable: false);
    }
    if (_query.isEmpty) return filtered;
    final needle = _query.toLowerCase();
    return filtered
        .where(
          (row) =>
              _itemName(row).toLowerCase().contains(needle) ||
              _warehouseName(row).toLowerCase().contains(needle),
        )
        .toList(growable: false);
  }

  Future<void> _edit(Json row) async {
    final values = await showFormSheet(
      context,
      title: _arabic ? 'ضبط الحدود' : 'Set thresholds',
      submitLabel: _arabic ? 'حفظ' : 'Save',
      initial: row,
      fields: [
        FieldSpec(
          'minQuantity',
          _arabic ? 'الحد الأدنى' : 'Minimum',
          kind: FieldKind.decimal,
        ),
        FieldSpec(
          'reorderQuantity',
          _arabic ? 'نقطة الطلب' : 'Reorder at',
          kind: FieldKind.decimal,
          helper: _arabic
              ? 'صفر يعني الاعتماد على الحد الأدنى.'
              : 'Zero falls back to the minimum.',
        ),
        FieldSpec(
          'maxQuantity',
          _arabic ? 'الحد الأقصى' : 'Maximum',
          kind: FieldKind.decimal,
          helper: _arabic
              ? 'صفر يعني بلا سقف، لا «اطلب صفرًا».'
              : 'Zero means no ceiling, not "order nothing".',
        ),
      ],
      onSubmit: (input) async {
        await ref
            .read(apiClientProvider)
            .put(
              '/inventory/item-thresholds/'
              '${text(row, 'warehouseId')}/${text(row, 'itemId')}',
              body: input,
            );
        await ref.read(itemThresholdsProvider.notifier).refreshQuietly();
      },
    );
    if (values == null || !mounted) return;
    showMessage(context, _arabic ? 'تم الحفظ' : 'Saved');
  }
}
