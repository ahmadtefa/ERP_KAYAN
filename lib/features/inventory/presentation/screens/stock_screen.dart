import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/error/failure.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

class StockController extends JsonListController {
  @override
  String get resourcePath => '/inventory/stock';
}

final stockListProvider =
    AsyncNotifierProvider<JsonListController, List<Json>>(StockController.new);

/// Stock on hand per item and branch, with the moving average cost the ledger
/// is carrying.
///
/// REQUIRES BUSINESS DECISION: weighted average is the valuation method the
/// stock tables are built on. FIFO or standard costing would change these
/// figures and needs an explicit decision.
class StockScreen extends ConsumerStatefulWidget {
  const StockScreen({super.key});

  @override
  ConsumerState<StockScreen> createState() => _StockScreenState();
}

class _StockScreenState extends ConsumerState<StockScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(stockListProvider);

    return ModuleScaffold(
      title: l10n.stockBalances,
      trailing: SearchField(
        hint: l10n.searchItems,
        onChanged: (value) => setState(() => _query = value.trim()),
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(stockListProvider.notifier).reload(),
        isEmpty: (rows) => _filter(rows).isEmpty,
        emptyMessage: l10n.noStock,
        data: (rows) {
          final visible = _filter(rows);
          return Column(
            children: [
              _Totals(rows: visible),
              Expanded(
                child: RecordsTable(
                  rows: visible,
                  onTap: _openLedger,
                  columns: [
                    ColumnSpec(
                      l10n.accountCode,
                      value: (r) => text(r, 'itemCode'),
                      emphasise: true,
                    ),
                    ColumnSpec('Name', value: (r) => text(r, 'itemNameEn')),
                    ColumnSpec('الاسم', value: (r) => text(r, 'itemNameAr')),
                    ColumnSpec(l10n.unit, value: (r) => text(r, 'unit')),
                    ColumnSpec(
                      l10n.onHand,
                      numeric: true,
                      value: (r) => formatQuantity(asString(r['quantity'])),
                    ),
                    ColumnSpec(
                      l10n.averageCost,
                      numeric: true,
                      value: (r) => formatAmount(asString(r['averageCost'])),
                    ),
                    ColumnSpec(
                      l10n.stockValue,
                      numeric: true,
                      value: (r) => formatAmount(asString(r['value'])),
                    ),
                  ],
                ),
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
              text(r, 'itemCode').toLowerCase().contains(needle) ||
              text(r, 'itemNameEn').toLowerCase().contains(needle) ||
              text(r, 'itemNameAr').contains(_query),
        )
        .toList(growable: false);
  }

  void _openLedger(Json row) {
    final itemId = asString(row['itemId']);
    if (itemId == null) return;
    showDialog<void>(
      context: context,
      builder: (_) => _LedgerDialog(
        itemId: itemId,
        title: '${text(row, 'itemCode')} — ${text(row, 'itemNameEn')}',
      ),
    );
  }
}

class _Totals extends StatelessWidget {
  const _Totals({required this.rows});

  /// The number of decimals the API sends amounts with.
  static const scale = 4;

  final List<Json> rows;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    // Summed as decimal strings so the total matches the ledger exactly.
    var quantity = BigInt.zero;
    var value = BigInt.zero;
    for (final row in rows) {
      quantity += _scaled(asString(row['quantity']));
      value += _scaled(asString(row['value']));
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Row(
        children: [
          Text(
            '${l10n.totalQuantity}: ${_show(quantity, scale)}',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(width: 24),
          Text(
            '${l10n.totalValue}: ${_show(value, scale)}',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ],
      ),
    );
  }

  BigInt _scaled(String? raw) {
    if (raw == null || raw.isEmpty) return BigInt.zero;
    final negative = raw.startsWith('-');
    final parts = (negative ? raw.substring(1) : raw).split('.');
    final fraction = parts.length > 1 ? parts[1] : '';
    final digits = '${parts.first}${fraction.padRight(scale, '0').substring(0, scale)}';
    final parsed = BigInt.tryParse(digits) ?? BigInt.zero;
    return negative ? -parsed : parsed;
  }

  String _show(BigInt value, int scale) {
    final negative = value.isNegative;
    final digits = (negative ? -value : value).toString().padLeft(scale + 1, '0');
    final whole = digits.substring(0, digits.length - scale);
    final fraction = digits.substring(digits.length - scale);
    return '${negative ? '-' : ''}$whole.$fraction';
  }
}

/// Replays every movement of one item, the way a stock card does.
class _LedgerDialog extends ConsumerStatefulWidget {
  const _LedgerDialog({required this.itemId, required this.title});

  final String itemId;
  final String title;

  @override
  ConsumerState<_LedgerDialog> createState() => _LedgerDialogState();
}

class _LedgerDialogState extends ConsumerState<_LedgerDialog> {
  late Future<Json> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<Json> _load() {
    return ref
        .read(apiClientProvider)
        .getObject('/inventory/stock/${widget.itemId}/ledger');
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AlertDialog(
      title: Text(widget.title),
      content: SizedBox(
        width: 720,
        height: 420,
        child: FutureBuilder<Json>(
          future: _future,
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              final error = snapshot.error!;
              return ErrorView(
                message: error is Failure ? error.message : '$error',
                onRetry: () => setState(() => _future = _load()),
              );
            }
            if (!snapshot.hasData) return const LoadingView();
            final data = snapshot.data!;
            final movements = listOf(data['movements']);
            if (movements.isEmpty) {
              return EmptyView(message: l10n.noMovements);
            }
            return SingleChildScrollView(
              child: RecordsTable(
                rows: movements,
                columns: [
                  ColumnSpec(
                    l10n.invoiceDate,
                    value: (r) => text(r, 'date').split('T').first,
                  ),
                  ColumnSpec(
                    l10n.reference,
                    value: (r) =>
                        '${text(r, 'referenceType')} ${text(r, 'referenceNumber')}',
                  ),
                  ColumnSpec(
                    l10n.direction,
                    value: (r) => text(r, 'direction').toLowerCase() == 'in'
                        ? l10n.movementIn
                        : l10n.movementOut,
                  ),
                  ColumnSpec(
                    l10n.quantity,
                    numeric: true,
                    value: (r) => formatQuantity(asString(r['quantity'])),
                  ),
                  ColumnSpec(
                    l10n.unitPrice,
                    numeric: true,
                    value: (r) => formatAmount(asString(r['unitCost'])),
                  ),
                  ColumnSpec(
                    l10n.lineTotal,
                    numeric: true,
                    value: (r) => formatAmount(asString(r['totalCost'])),
                  ),
                  ColumnSpec(
                    l10n.runningBalance,
                    numeric: true,
                    value: (r) =>
                        '${formatQuantity(asString(r['runningQuantity']))} / '
                        '${formatAmount(asString(r['runningValue']))}',
                  ),
                ],
              ),
            );
          },
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.close),
        ),
      ],
    );
  }
}
