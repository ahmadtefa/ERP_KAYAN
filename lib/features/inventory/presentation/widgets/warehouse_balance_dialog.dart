import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/network/api_client.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../common/presentation/providers/resource_providers.dart';

/// Shows the item balances for one warehouse.
///
/// The API response is an object whose records live under `rows` (not
/// `items`, which is used by the generic list endpoints).
class WarehouseBalanceDialog extends ConsumerStatefulWidget {
  const WarehouseBalanceDialog({
    super.key,
    required this.warehouseId,
    required this.warehouseName,
  });

  final String warehouseId;
  final String warehouseName;

  @override
  ConsumerState<WarehouseBalanceDialog> createState() =>
      _WarehouseBalanceDialogState();
}

class _WarehouseBalanceDialogState
    extends ConsumerState<WarehouseBalanceDialog> {
  late Future<Json> _future;
  String _query = '';

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<Json> _load() => ref.read(apiClientProvider).getObject(
    '/inventory/warehouses/balance',
    query: {'warehouseId': widget.warehouseId},
  );

  void _refresh() {
    setState(() => _future = _load());
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  decoration: InputDecoration(
                    prefixIcon: const Icon(Icons.search),
                    hintText: _arabic ? 'بحث عن صنف' : 'Search items',
                    isDense: true,
                  ),
                  onChanged: (value) => setState(() => _query = value.trim()),
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                tooltip: _arabic ? 'تحديث' : 'Refresh',
                onPressed: _refresh,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Expanded(
            child: FutureBuilder<Json>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_arabic
                            ? 'تعذر تحميل أرصدة المستودع.'
                            : 'Could not load warehouse balances.'),
                        const SizedBox(height: 8),
                        FilledButton.icon(
                          onPressed: _refresh,
                          icon: const Icon(Icons.refresh),
                          label: Text(_arabic ? 'إعادة المحاولة' : 'Retry'),
                        ),
                      ],
                    ),
                  );
                }

                // This endpoint deliberately returns { rows: [...] }.
                final rows = listOf(snapshot.data?['rows']);
                final needle = _query.toLowerCase();
                final visible = needle.isEmpty
                    ? rows
                    : rows.where((row) {
                        return text(row, 'itemCode').toLowerCase().contains(needle) ||
                            text(row, 'itemNameEn').toLowerCase().contains(needle) ||
                            text(row, 'itemNameAr').contains(_query);
                      }).toList(growable: false);

                if (visible.isEmpty) {
                  return Center(
                    child: Text(_arabic
                        ? (rows.isEmpty
                            ? 'لا توجد أرصدة في هذا المستودع.'
                            : 'لا توجد أصناف مطابقة للبحث.')
                        : (rows.isEmpty
                            ? 'No balances in this warehouse.'
                            : 'No matching items.')),
                  );
                }

                return RecordsTable(
                  rows: visible,
                  columns: [
                    ColumnSpec(
                      _arabic ? 'كود الصنف' : 'Item code',
                      value: (row) => text(row, 'itemCode'),
                      emphasise: true,
                    ),
                    ColumnSpec(
                      _arabic ? 'الصنف' : 'Item',
                      value: (row) => _arabic
                          ? text(row, 'itemNameAr', fallback: text(row, 'itemNameEn'))
                          : text(row, 'itemNameEn', fallback: text(row, 'itemNameAr')),
                    ),
                    ColumnSpec(
                      _arabic ? 'الكمية' : 'Quantity',
                      numeric: true,
                      value: (row) => text(
                        row,
                        'quantityText',
                        fallback: formatQuantity(asString(row['quantity'])),
                      ),
                    ),
                    ColumnSpec(
                      _arabic ? 'الوحدة' : 'Unit',
                      value: (row) => text(row, 'unit'),
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
