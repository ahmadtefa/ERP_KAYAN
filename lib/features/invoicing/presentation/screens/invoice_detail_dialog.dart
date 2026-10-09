import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/error/failure.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../invoice_status.dart';
import '../providers/invoice_providers.dart';

/// The full document, including the cost that was frozen onto each line at
/// posting time.
class InvoiceDetailDialog extends ConsumerStatefulWidget {
  const InvoiceDetailDialog({
    super.key,
    required this.kind,
    required this.summary,
  });

  final InvoiceKind kind;
  final Json summary;

  @override
  ConsumerState<InvoiceDetailDialog> createState() =>
      _InvoiceDetailDialogState();
}

class _InvoiceDetailDialogState extends ConsumerState<InvoiceDetailDialog> {
  late Future<Json> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<Json> _load() {
    final id = text(widget.summary, 'id');
    return ref
        .read(apiClientProvider)
        .getObject('${widget.kind.basePath}/$id');
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isSales = widget.kind.isSales;
    return AlertDialog(
      title: Text(
        '${l10n.invoiceNumber} ${text(widget.summary, 'invoiceNumber')}',
      ),
      content: SizedBox(
        width: 780,
        height: 460,
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
            final invoice = snapshot.data!;
            final lines = listOf(invoice['lines']);
            final party = partyOf(invoice, widget.kind);

            Widget field(String label, String value) => Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  SizedBox(
                    width: 140,
                    child: Text(
                      label,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                  Expanded(child: Text(value)),
                ],
              ),
            );

            return SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            field(l10n.invoiceDate, text(invoice, 'invoiceDate')),
                            field(
                              isSales ? l10n.customer : l10n.supplier,
                              party.isEmpty
                                  ? '—'
                                  : '${text(party, 'code')} — ${text(party, 'nameEn')}',
                            ),
                            field(l10n.status, statusLabel(context, invoice)),
                          ],
                        ),
                      ),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            field(
                              l10n.subTotal,
                              formatAmount(asString(invoice['subTotal'])),
                            ),
                            field(
                              l10n.taxAmount,
                              formatAmount(asString(invoice['taxAmount'])),
                            ),
                            field(
                              l10n.totalAmount,
                              formatAmount(asString(invoice['totalAmount'])),
                            ),
                            if (isSales) ...[
                              field(
                                l10n.costOfGoods,
                                formatAmount(asString(invoice['costOfGoods'])),
                              ),
                              field(
                                l10n.grossProfit,
                                formatAmount(asString(invoice['grossProfit'])),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text(l10n.lines, style: Theme.of(context).textTheme.titleSmall),
                  const SizedBox(height: 8),
                  RecordsTable(
                    rows: lines,
                    columns: [
                      ColumnSpec(
                        '#',
                        numeric: true,
                        value: (r) => asNum(r['lineNumber'])?.toString() ?? '',
                      ),
                      ColumnSpec(
                        l10n.item,
                        value: (r) =>
                            '${text(r, 'itemCode')} ${text(r, 'itemNameEn')}'.trim(),
                      ),
                      ColumnSpec(
                        l10n.description,
                        value: (r) => text(r, 'description'),
                      ),
                      ColumnSpec(
                        l10n.quantity,
                        numeric: true,
                        value: (r) => formatQuantity(asString(r['quantity'])),
                      ),
                      ColumnSpec(
                        l10n.unitPrice,
                        numeric: true,
                        value: (r) => formatAmount(asString(r['unitPrice'])),
                      ),
                      ColumnSpec(
                        l10n.taxAmount,
                        numeric: true,
                        value: (r) => formatAmount(asString(r['taxAmount'])),
                      ),
                      ColumnSpec(
                        l10n.lineTotal,
                        numeric: true,
                        value: (r) => formatAmount(asString(r['lineTotal'])),
                      ),
                      // The cost is frozen on the line when the document is
                      // posted, so profit does not move later.
                      if (text(invoice, 'status').toLowerCase() != 'draft')
                        ColumnSpec(
                          l10n.costOfGoods,
                          numeric: true,
                          value: (r) => formatAmount(asString(r['costTotal'])),
                        ),
                    ],
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
