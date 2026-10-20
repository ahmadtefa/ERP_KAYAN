import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/widgets/status_pill.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../invoice_status.dart';
import '../providers/invoice_providers.dart';

/// Sales credit notes and purchase debit notes, kept apart from ordinary
/// invoices so every row on these screens is genuinely a return.
class ReturnsScreen extends ConsumerStatefulWidget {
  const ReturnsScreen({super.key, required this.kind});

  final InvoiceKind kind;

  @override
  ConsumerState<ReturnsScreen> createState() => _ReturnsScreenState();
}

class _ReturnsScreenState extends ConsumerState<ReturnsScreen> {
  String _status = '';
  bool _busy = false;

  Future<void> _createReturn() async {
    final created = await context.push<bool>(widget.kind.newReturnPath);
    if (!mounted || created != true) return;
    await ref.read(returnListProvider(widget.kind).notifier).reload();
  }

  Future<void> _post(Json row) async {
    final l10n = context.l10n;
    final accepted = await confirmAction(
      context,
      title: l10n.post,
      message: l10n.confirmPostReturn,
      confirmLabel: l10n.post,
    );
    if (!accepted || !mounted) return;

    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .post('${widget.kind.returnsPath}/${text(row, 'id')}/post');
      await ref.read(returnListProvider(widget.kind).notifier).reload();
      if (mounted) showMessage(context, l10n.returnPosted);
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reverse(Json row) async {
    final l10n = context.l10n;
    final accepted = await confirmAction(
      context,
      title: l10n.reverse,
      message: l10n.confirmReverse,
      confirmLabel: l10n.reverse,
      destructive: true,
    );
    if (!accepted || !mounted) return;

    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .post('${widget.kind.returnsPath}/${text(row, 'id')}/reverse');
      await ref.read(returnListProvider(widget.kind).notifier).reload();
      if (mounted) showMessage(context, l10n.returnReversed);
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _showDetails(Json summary) async {
    try {
      final detail = await ref
          .read(apiClientProvider)
          .getObject('${widget.kind.returnsPath}/${text(summary, 'id')}');
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => _ReturnDetailDialog(
          kind: widget.kind,
          invoice: detail,
        ),
      );
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    }
  }

  List<Json> _filter(List<Json> rows) {
    if (_status.isEmpty) return rows;
    return rows
        .where((row) => text(row, 'status').toLowerCase() == _status)
        .toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final user = ref.watch(currentUserProvider);
    final provider = returnListProvider(widget.kind);
    final async = ref.watch(provider);
    final isSales = widget.kind.isSales;
    final canCreate = user?.branchId != null &&
        (user!.can(isSales ? 'sales.invoices.create' : 'purchases.invoices.create'));
    final canPost = user?.can(isSales ? 'sales.invoices.post' : 'purchases.invoices.post') ?? false;

    return ModuleScaffold(
      title: isSales ? l10n.salesReturns : l10n.purchaseReturns,
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
            onPressed: _busy || !canCreate ? null : _createReturn,
            icon: const Icon(Icons.add),
            label: Text(isSales ? l10n.newSalesReturn : l10n.newPurchaseReturn),
          ),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(provider.notifier).reload(),
        isEmpty: (rows) => _filter(rows).isEmpty,
        emptyMessage: l10n.noReturns,
        data: (rows) => RecordsTable(
          rows: _filter(rows),
          onTap: _showDetails,
          columns: [
            ColumnSpec(
              l10n.invoiceNumber,
              value: (row) => text(row, 'invoiceNumber'),
              emphasise: true,
            ),
            ColumnSpec(
              l10n.invoiceDate,
              value: (row) => text(row, 'invoiceDate'),
            ),
            ColumnSpec(
              l10n.originalInvoice,
              value: (row) => text(row, 'originalInvoiceNumber', fallback: '—'),
            ),
            ColumnSpec(
              isSales ? l10n.customer : l10n.supplier,
              value: (row) {
                final party = row[widget.kind.partyKey];
                return party is Map ? text(Map<String, dynamic>.from(party), 'nameEn') : '—';
              },
            ),
            ColumnSpec(
              l10n.totalAmount,
              numeric: true,
              value: (row) => formatAmount(asString(row['totalAmount'])),
            ),
            ColumnSpec(
              l10n.status,
              value: (row) => statusLabel(context, row),
              tone: (row) => toneForStatus(text(row, 'status')),
            ),
          ],
          actions: (row) {
            final status = text(row, 'status').toLowerCase();
            return [
              IconButton(
                tooltip: l10n.viewDetails,
                icon: const Icon(Icons.receipt_long_outlined, size: 20),
                onPressed: _busy ? null : () => _showDetails(row),
              ),
              if (status == 'draft' && canPost)
                IconButton(
                  tooltip: l10n.post,
                  icon: const Icon(Icons.check_circle_outline, size: 20),
                  onPressed: _busy ? null : () => _post(row),
                ),
              if (status == 'posted' && canPost)
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
}

class _ReturnDetailDialog extends StatelessWidget {
  const _ReturnDetailDialog({required this.kind, required this.invoice});

  final InvoiceKind kind;
  final Json invoice;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final lines = listOf(invoice['lines']);
    return AlertDialog(
      title: Text(text(invoice, 'invoiceNumber')),
      content: SizedBox(
        width: 620,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${l10n.originalInvoice}: ${text(invoice, 'originalInvoiceNumber', fallback: '—')}'),
              const SizedBox(height: 6),
              Text('${l10n.invoiceDate}: ${text(invoice, 'invoiceDate')}'),
              const SizedBox(height: 6),
              Text('${l10n.status}: ${statusLabel(context, invoice)}'),
              if (text(invoice, 'returnReason').isNotEmpty) ...[
                const SizedBox(height: 6),
                Text('${l10n.returnReason}: ${text(invoice, 'returnReason')}'),
              ],
              const Divider(height: 24),
              Text(l10n.returnLines, style: Theme.of(context).textTheme.titleSmall),
              for (final line in lines)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    text(line, 'itemNameEn').isEmpty
                        ? text(line, 'description')
                        : text(line, 'itemNameEn'),
                  ),
                  subtitle: Text(
                    '${l10n.quantityToReturn}: ${text(line, 'quantity')} · '
                    '${l10n.totalAmount}: ${formatAmount(text(line, 'lineTotal'))}',
                  ),
                  trailing: kind.isSales || text(line, 'landedCostAmount') == '0.0000'
                      ? null
                      : Text('${l10n.landedCosts}: ${formatAmount(text(line, 'landedCostAmount'))}'),
                ),
              const Divider(height: 24),
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: Text(
                  '${l10n.totalAmount}: ${formatAmount(text(invoice, 'totalAmount'))}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.cancel),
        ),
      ],
    );
  }
}
