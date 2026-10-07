import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/error/failure.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../invoice_status.dart';
import '../providers/invoice_providers.dart';
import 'invoice_detail_dialog.dart';
import 'invoice_editor_screen.dart';

/// Sales and purchase invoices: the list, and the post/reverse actions.
///
/// A draft is harmless — it moves no stock and writes no ledger entry. Posting
/// is therefore the moment the figures become real, and it is always behind a
/// confirmation.
class InvoiceListScreen extends ConsumerStatefulWidget {
  const InvoiceListScreen({super.key, required this.kind});

  final InvoiceKind kind;

  @override
  ConsumerState<InvoiceListScreen> createState() => _InvoiceListScreenState();
}

class _InvoiceListScreenState extends ConsumerState<InvoiceListScreen> {
  String _status = '';
  bool _busy = false;

  String get _basePath => widget.kind.basePath;

  Future<void> _openEditor() async {
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => InvoiceEditorScreen(kind: widget.kind),
      ),
    );
  }

  Future<void> _post(Json row) async {
    final l10n = context.l10n;
    final ok = await confirmAction(
      context,
      title: l10n.post,
      message: l10n.confirmPost,
      confirmLabel: l10n.post,
    );
    if (!ok || !mounted) return;

    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .post('$_basePath/${row['id']}/post');
      await ref.read(invoiceListProvider(widget.kind).notifier).reload();
      if (mounted) showMessage(context, l10n.invoicePosted);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reverse(Json row) async {
    final l10n = context.l10n;
    final ok = await confirmAction(
      context,
      title: l10n.reverse,
      message: l10n.confirmReverse,
      confirmLabel: l10n.reverse,
      destructive: true,
    );
    if (!ok || !mounted) return;

    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .post('$_basePath/${row['id']}/reverse');
      await ref.read(invoiceListProvider(widget.kind).notifier).reload();
      if (mounted) showMessage(context, l10n.invoiceReversed);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _openDetail(Json row) {
    showDialog<void>(
      context: context,
      builder: (_) => InvoiceDetailDialog(kind: widget.kind, summary: row),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final provider = invoiceListProvider(widget.kind);
    final async = ref.watch(provider);
    final isSales = widget.kind.isSales;

    return ModuleScaffold(
      title: isSales ? l10n.salesInvoices : l10n.purchaseInvoices,
      trailing: Row(
        children: [
          DropdownButton<String>(
            value: _status,
            items: [
              DropdownMenuItem(value: '', child: Text(l10n.reports)),
              DropdownMenuItem(value: 'draft', child: Text(l10n.draft)),
              DropdownMenuItem(value: 'posted', child: Text(l10n.posted)),
              DropdownMenuItem(value: 'reversed', child: Text(l10n.reversed)),
            ],
            onChanged: (value) => setState(() => _status = value ?? ''),
          ),
          const SizedBox(width: 12),
          FilledButton.icon(
            onPressed: _busy ? null : _openEditor,
            icon: const Icon(Icons.add),
            label: Text(isSales ? l10n.newSalesInvoice : l10n.newPurchaseInvoice),
          ),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(provider.notifier).reload(),
        isEmpty: (rows) => _filter(rows).isEmpty,
        emptyMessage: isSales ? l10n.noSalesInvoices : l10n.noPurchaseInvoices,
        data: (rows) => RecordsTable(
          rows: _filter(rows),
          onTap: _openDetail,
          columns: [
            ColumnSpec(
              l10n.invoiceNumber,
              value: (r) => text(r, 'invoiceNumber'),
              emphasise: true,
            ),
            ColumnSpec(
              l10n.invoiceDate,
              value: (r) => text(r, 'invoiceDate'),
            ),
            ColumnSpec(
              isSales ? l10n.customer : l10n.supplier,
              value: (r) {
                final party = partyOf(r, widget.kind);
                return party.isEmpty ? '—' : text(party, 'nameEn');
              },
            ),
            ColumnSpec(
              l10n.totalAmount,
              numeric: true,
              value: (r) => formatAmount(asString(r['totalAmount'])),
            ),
            if (isSales)
              ColumnSpec(
                l10n.grossProfit,
                numeric: true,
                value: (r) => formatAmount(asString(r['grossProfit'])),
              )
            else
              ColumnSpec(
                l10n.remaining,
                numeric: true,
                value: (r) => formatAmount(asString(r['balanceDue'])),
              ),
            ColumnSpec(l10n.status, value: (r) => statusLabel(context, r)),
          ],
          actions: (row) {
            final status = text(row, 'status').toLowerCase();
            return [
              IconButton(
                tooltip: l10n.viewDetails,
                icon: const Icon(Icons.receipt_long_outlined, size: 20),
                onPressed: () => _openDetail(row),
              ),
              if (status == 'draft')
                IconButton(
                  tooltip: l10n.post,
                  icon: const Icon(Icons.check_circle_outline, size: 20),
                  onPressed: _busy ? null : () => _post(row),
                ),
              if (status == 'posted')
                IconButton(
                  tooltip: l10n.reverse,
                  icon: const Icon(Icons.undo_outlined, size: 20),
                  onPressed: _busy ? null : () => _reverse(row),
                ),
            ];
          },
        ),
      ),
    );
  }

  List<Json> _filter(List<Json> rows) {
    if (_status.isEmpty) return rows;
    return rows
        .where((r) => text(r, 'status').toLowerCase() == _status)
        .toList(growable: false);
  }
}
