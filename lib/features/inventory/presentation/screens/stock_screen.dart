import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/router/draft_exit_guard.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/data_dialog.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/resizable_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../data/presentation/providers/data_providers.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../providers/stock_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../data/presentation/widgets/list_export_actions.dart';
import 'stock_vouchers_screen.dart';

export '../providers/stock_providers.dart'
    show stockListProvider, StockController;

/// Stock on hand per item and branch, with the moving average cost the ledger
/// is carrying.
///
/// REQUIRES BUSINESS DECISION: weighted average is the valuation method the
/// stock tables are built on. FIFO or standard costing would change these
/// figures and needs an explicit decision.
class StockScreen extends ConsumerStatefulWidget {
  const StockScreen({super.key, this.navigationKey});
  final ValueKey<String>? navigationKey;

  @override
  ConsumerState<StockScreen> createState() => _StockScreenState();
}

class _StockScreenState extends ConsumerState<StockScreen> {
  String _query = '';
  late final DraftExitGuard _exitGuard;
  final _exitRelay = DraftExitRelay();
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

  Future<void> _openVouchers() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => StockVouchersScreen(exitRelay: _exitRelay),
      ),
    );
    if (mounted) ref.invalidate(stockListProvider);
  }

  Future<void> _openCostCenterReport() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => const StockCostCenterReportScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(stockListProvider);
    final canReadCost =
        ref.watch(currentUserProvider)?.can('inventory.cost.read') ?? false;

    return ModuleScaffold(
      title: l10n.stockBalances,
      actions: [
        IconButton(
          tooltip: l10n.refresh,
          icon: const Icon(Icons.refresh),
          onPressed: () => ref.read(stockListProvider.notifier).reload(),
        ),
        OutlinedButton.icon(
          onPressed: _openVouchers,
          icon: const Icon(Icons.inventory_2_outlined),
          label: Text(
            Localizations.localeOf(context).languageCode == 'ar'
                ? 'أذون المخزون'
                : 'Stock vouchers',
          ),
        ),
        OutlinedButton.icon(
          onPressed: _openCostCenterReport,
          icon: const Icon(Icons.account_tree_outlined),
          label: Text(
            Localizations.localeOf(context).languageCode == 'ar'
                ? 'حركة المخزون حسب مركز التكلفة'
                : 'Stock by cost center',
          ),
        ),
        const ListExportActions(list: 'stock'),
      ],
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
              _Totals(rows: visible, canReadCost: canReadCost),
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
                    if (canReadCost)
                      ColumnSpec(
                        l10n.averageCost,
                        numeric: true,
                        value: (r) => formatAmount(asString(r['averageCost'])),
                      ),
                    if (canReadCost)
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
    showDataDialog<void>(
      context,
      storageKey: 'stock-ledger',
      title: '${text(row, 'itemCode')} — ${text(row, 'itemNameEn')}',
      icon: Icons.receipt_long_outlined,
      initialSize: const Size(1000, 620),
      child: _LedgerDialog(
        itemId: itemId,
        row: row,
        title: '${text(row, 'itemCode')} — ${text(row, 'itemNameEn')}',
      ),
    );
  }
}

/// Attributes append-only stock movements through their saved source document.
class StockCostCenterReportScreen extends ConsumerStatefulWidget {
  const StockCostCenterReportScreen({super.key});
  @override
  ConsumerState<StockCostCenterReportScreen> createState() =>
      _StockCostCenterReportScreenState();
}

class _StockCostCenterReportScreenState
    extends ConsumerState<StockCostCenterReportScreen> {
  late Future<Json> _future;
  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<Json> _load() => ref
      .read(apiClientProvider)
      .getObject('/inventory/reports/cost-center-movements');
  void _refresh() => setState(() {
    _future = _load();
  });

  @override
  Widget build(BuildContext context) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final canReadCost =
        ref.watch(currentUserProvider)?.can('inventory.cost.read') ?? false;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          arabic ? 'حركة المخزون حسب مركز التكلفة' : 'Stock by cost center',
        ),
        actions: [
          IconButton(
            tooltip: arabic ? 'تحديث' : 'Refresh',
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: FutureBuilder<Json>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done)
            return const Center(child: CircularProgressIndicator());
          if (snapshot.hasError)
            return ErrorView(message: snapshot.error!, onRetry: _refresh);
          if (!snapshot.hasData) return const SizedBox.shrink();
          final data = snapshot.data!;
          final totals = listOf(data['totals']);
          final movements = listOf(data['items']);
          if (movements.isEmpty)
            return Center(
              child: Text(
                arabic ? 'لا توجد حركات مخزنية' : 'No stock movements',
              ),
            );
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              for (final total in totals)
                Card(
                  child: ListTile(
                    title: Text(
                      text(total, 'costCenterCode').isEmpty
                          ? (arabic
                                ? 'حركات قديمة بلا مركز تكلفة'
                                : 'Legacy movements without a cost center')
                          : '${text(total, 'costCenterCode')} • ${arabic ? text(total, 'costCenterNameAr', fallback: text(total, 'costCenterNameEn')) : text(total, 'costCenterNameEn')}',
                    ),
                    subtitle: Text(
                      '${arabic ? 'الحركات' : 'Movements'}: ${text(total, 'movementCount')} • ${arabic ? 'داخل' : 'In'}: ${text(total, 'quantityIn')} • ${arabic ? 'خارج' : 'Out'}: ${text(total, 'quantityOut')}'
                      '${canReadCost ? ' • ${arabic ? 'صافي القيمة' : 'Net value'}: ${text(total, 'netValue')}' : ''}',
                    ),
                  ),
                ),
              const Divider(),
              for (final row in movements)
                ListTile(
                  title: Text(
                    '${text(row, 'referenceNumber', fallback: text(row, 'referenceType'))} • ${text(row, 'itemCode')} • ${arabic ? text(row, 'itemNameAr', fallback: text(row, 'itemNameEn')) : text(row, 'itemNameEn')}',
                  ),
                  subtitle: Text(
                    '${text(row, 'movementDate')} • ${text(row, 'direction') == 'IN' ? (arabic ? 'دخول' : 'IN') : (arabic ? 'خروج' : 'OUT')} ${text(row, 'quantity')} ${text(row, 'unit')} • ${text(row, 'costCenterCode', fallback: arabic ? 'بلا مركز' : 'No center')}',
                  ),
                  trailing: canReadCost ? Text(text(row, 'value')) : null,
                ),
            ],
          );
        },
      ),
    );
  }
}

class _Totals extends StatelessWidget {
  const _Totals({required this.rows, required this.canReadCost});

  /// The number of decimals the API sends amounts with.
  static const scale = 4;

  final List<Json> rows;
  final bool canReadCost;

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
          if (canReadCost) ...[
            const SizedBox(width: 24),
            Text(
              '${l10n.totalValue}: ${rows.every((row) => RegExp(r'^-?\d+(?:\.\d{1,4})?$').hasMatch(asString(row['value']) ?? '')) ? _show(value, scale) : '—'}',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ],
      ),
    );
  }

  BigInt _scaled(String? raw) {
    if (raw == null || raw.isEmpty) return BigInt.zero;
    final negative = raw.startsWith('-');
    final parts = (negative ? raw.substring(1) : raw).split('.');
    final fraction = parts.length > 1 ? parts[1] : '';
    final digits =
        '${parts.first}${fraction.padRight(scale, '0').substring(0, scale)}';
    final parsed = BigInt.tryParse(digits) ?? BigInt.zero;
    return negative ? -parsed : parsed;
  }

  String _show(BigInt value, int scale) {
    final negative = value.isNegative;
    final digits = (negative ? -value : value).toString().padLeft(
      scale + 1,
      '0',
    );
    final whole = digits.substring(0, digits.length - scale);
    final fraction = digits.substring(digits.length - scale);
    return '${negative ? '-' : ''}$whole.$fraction';
  }
}

/// Replays every movement of one item, the way a stock card does.
class _LedgerDialog extends ConsumerStatefulWidget {
  const _LedgerDialog({
    required this.itemId,
    required this.row,
    required this.title,
  });

  final String itemId;

  /// The stock row the dialog was opened from: the balance, value and average
  /// cost this branch is carrying. Shown as they are — never recomputed from
  /// the movements, which would invent a number the ledger does not hold.
  final Json row;
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
    final language = Localizations.localeOf(context).languageCode;
    final canReadCost =
        ref.watch(currentUserProvider)?.can('inventory.cost.read') ?? false;
    final links = ref.read(reportLinkProvider);
    final filters = {'itemId': widget.itemId};

    return Padding(
      padding: const EdgeInsets.fromLTRB(18, 4, 18, 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: 24,
            runSpacing: 8,
            children: [
              _stat(
                l10n.onHand,
                formatQuantity(asString(widget.row['quantity'])),
              ),
              if (canReadCost)
                _stat(
                  l10n.averageCost,
                  formatAmount(asString(widget.row['averageCost'])),
                ),
              if (canReadCost)
                _stat(
                  l10n.stockValue,
                  formatAmount(asString(widget.row['value'])),
                ),
              _stat(l10n.branch, text(widget.row, 'branchCode')),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed: () => runPrint(
                  context,
                  links.listPrint(
                    list: 'stock-ledger',
                    language: language,
                    filters: filters,
                  ),
                ),
                icon: const Icon(Icons.print_outlined, size: 18),
                label: Text(l10n.printPreview),
              ),
              OutlinedButton.icon(
                onPressed: () => runDownload(
                  context,
                  links.listPdf(
                    list: 'stock-ledger',
                    language: language,
                    filters: filters,
                  ),
                ),
                icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
                label: Text(l10n.exportPdf),
              ),
              OutlinedButton.icon(
                onPressed: () => runDownload(
                  context,
                  links.listFile(
                    list: 'stock-ledger',
                    format: 'xlsx',
                    language: language,
                    filters: filters,
                  ),
                ),
                icon: const Icon(Icons.table_view_outlined, size: 18),
                label: Text(l10n.exportExcel),
              ),
              OutlinedButton.icon(
                onPressed: () => runDownload(
                  context,
                  links.listFile(
                    list: 'stock-ledger',
                    format: 'csv',
                    language: language,
                    filters: filters,
                  ),
                ),
                icon: const Icon(Icons.text_snippet_outlined, size: 18),
                label: Text(l10n.exportCsv),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Expanded(
            child: FutureBuilder<Json>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  final error = snapshot.error!;
                  return ErrorView(
                    message: error,
                    onRetry: () => setState(() {
                      _future = _load();
                    }),
                  );
                }
                if (!snapshot.hasData) return const LoadingView();
                final data = snapshot.data!;
                final movements = listOf(data['movements']);
                if (movements.isEmpty) {
                  return EmptyView(message: l10n.noMovements);
                }
                return SingleChildScrollView(
                  child: ResizableTable(
                    storageKey: 'stock-ledger',
                    rows: movements,
                    columns: [
                      ResizableColumn(
                        l10n.invoiceDate,
                        width: 110,
                        value: (r) => text(r, 'date').split('T').first,
                      ),
                      ResizableColumn(
                        l10n.reference,
                        width: 200,
                        value: (r) =>
                            '${text(r, 'referenceType')} ${text(r, 'referenceNumber')}',
                      ),
                      ResizableColumn(
                        l10n.direction,
                        width: 90,
                        value: (r) => text(r, 'direction').toLowerCase() == 'in'
                            ? l10n.movementIn
                            : l10n.movementOut,
                      ),
                      ResizableColumn(
                        l10n.quantity,
                        width: 110,
                        numeric: true,
                        value: (r) => formatQuantity(asString(r['quantity'])),
                      ),
                      if (canReadCost)
                        ResizableColumn(
                          l10n.unitPrice,
                          width: 120,
                          numeric: true,
                          value: (r) => formatAmount(asString(r['unitCost'])),
                        ),
                      if (canReadCost)
                        ResizableColumn(
                          l10n.lineTotal,
                          width: 120,
                          numeric: true,
                          value: (r) => formatAmount(asString(r['totalCost'])),
                        ),
                      ResizableColumn(
                        l10n.runningBalance,
                        width: 190,
                        numeric: true,
                        value: (r) => canReadCost
                            ? '${formatQuantity(asString(r['runningQuantity']))} / ${formatAmount(asString(r['runningValue']))}'
                            : formatQuantity(asString(r['runningQuantity'])),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: Text(l10n.close),
            ),
          ),
        ],
      ),
    );
  }

  Widget _stat(String label, String value) {
    return Builder(
      builder: (context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          Text(value, style: Theme.of(context).textTheme.titleSmall),
        ],
      ),
    );
  }
}
