import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

/// What is actually on each shelf: quantity per item, per warehouse.
///
/// This is a different question from the stock screen. That one answers "how
/// much of this item do we have anywhere"; this one answers "where is it",
/// which is what a picker needs and what a shelf count is checked against.
/// The server does the grouping and the branch scoping, so a warehouse the
/// caller cannot see is never in the answer at all.
///
/// A row is a warehouse/item pair, not an item: the same item in two stores is
/// two lines, because that is the whole point of opening this dialog.
class WarehouseBalanceDialog extends ConsumerStatefulWidget {
  const WarehouseBalanceDialog({super.key, this.warehouseId});

  /// When opened from one warehouse's row, only that warehouse is shown.
  final String? warehouseId;

  @override
  ConsumerState<WarehouseBalanceDialog> createState() =>
      _WarehouseBalanceDialogState();
}

class _WarehouseBalanceDialogState
    extends ConsumerState<WarehouseBalanceDialog> {
  List<Json> _rows = const [];
  bool _loading = true;
  String? _error;
  String _query = '';
  bool _includeZero = false;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final response = await ref
          .read(apiClientProvider)
          .getObject(
            '/inventory/warehouses/balance',
            query: {
              if (widget.warehouseId != null)
                'warehouseId': widget.warehouseId,
              if (_includeZero) 'includeZero': 'true',
              if (_query.trim().isNotEmpty) 'q': _query.trim(),
            },
          );
      if (!mounted) return;
      // The server calls this list `rows` (it also returns itemTotals and
      // warehouseTotals beside it). Reading `items` here would silently show
      // an empty report for a warehouse that is full.
      final rows = response['rows'];
      setState(() {
        _rows = rows is List
            ? items
                  .whereType<Map>()
                  .map((value) => Map<String, dynamic>.from(value))
                  .toList(growable: false)
            : const [];
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = '$error';
        _loading = false;
      });
    }
  }

  String _name(Json row, String en, String ar) =>
      _arabic ? text(row, ar) : text(row, en);

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(_arabic ? 'أرصدة المخازن' : 'Warehouse balances'),
      content: SizedBox(
        width: 900,
        height: 520,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: TextField(
                    decoration: InputDecoration(
                      isDense: true,
                      prefixIcon: const Icon(Icons.search, size: 18),
                      labelText: _arabic ? 'بحث' : 'Search',
                      border: const OutlineInputBorder(),
                    ),
                    onChanged: (value) {
                      _query = value;
                      _load();
                    },
                  ),
                ),
                const SizedBox(width: 12),
                // Off by default: a report of everything ever stocked is noise.
                // The switch is here because "which shelf is empty" is a real
                // question, and an empty shelf never appears in the default.
                FilterChip(
                  label: Text(_arabic ? 'إظهار الأصفار' : 'Show zeros'),
                  selected: _includeZero,
                  onSelected: (value) {
                    setState(() => _includeZero = value);
                    _load();
                  },
                ),
              ],
            ),
            const SizedBox(height: 12),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            _arabic
                                ? 'تعذّر تحميل الأرصدة.'
                                : 'Could not load the balances.',
                          ),
                          const SizedBox(height: 8),
                          TextButton(
                            onPressed: _load,
                            child: Text(context.l10n.retry),
                          ),
                        ],
                      ),
                    )
                  : _rows.isEmpty
                  ? Center(
                      child: Text(
                        _arabic
                            ? 'لا توجد أرصدة لعرضها.'
                            : 'No balances to show.',
                      ),
                    )
                  : RecordsTable(
                      rows: _rows,
                      columns: [
                        ColumnSpec(
                          _arabic ? 'المخزن' : 'Store',
                          value: (r) => _name(
                            r,
                            'warehouseNameEn',
                            'warehouseNameAr',
                          ),
                        ),
                        ColumnSpec(
                          _arabic ? 'الفرع' : 'Branch',
                          value: (r) => _name(r, 'branchNameEn', 'branchNameAr'),
                        ),
                        ColumnSpec(
                          _arabic ? 'الصنف' : 'Item',
                          value: (r) => text(r, 'itemCode'),
                          emphasise: true,
                        ),
                        ColumnSpec(
                          _arabic ? 'الاسم' : 'Name',
                          value: (r) => _name(r, 'itemNameEn', 'itemNameAr'),
                        ),
                        ColumnSpec(
                          _arabic ? 'الكمية' : 'Quantity',
                          numeric: true,
                          // quantityText is the server's own trimmed form
                          // ("12", not "12.0000"), so the shelf reads like a
                          // shelf and not like a ledger column.
                          value: (r) {
                            final trimmed = text(r, 'quantityText');
                            return trimmed.isNotEmpty
                                ? trimmed
                                : text(r, 'quantity', fallback: '0');
                          },
                        ),
                        ColumnSpec(
                          _arabic ? 'الوحدة' : 'Unit',
                          value: (r) => text(r, 'unit'),
                        ),
                      ],
                    ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(_arabic ? 'إغلاق' : 'Close'),
        ),
      ],
    );
  }
}

/// Shows [WarehouseBalanceDialog] and reports a failure instead of throwing
/// when the dialog itself cannot open.
Future<void> showWarehouseBalance(
  BuildContext context, {
  String? warehouseId,
}) async {
  try {
    await showDialog<void>(
      context: context,
      builder: (_) => WarehouseBalanceDialog(warehouseId: warehouseId),
    );
  } catch (error) {
    if (context.mounted) await showAppError(context, error);
  }
}
