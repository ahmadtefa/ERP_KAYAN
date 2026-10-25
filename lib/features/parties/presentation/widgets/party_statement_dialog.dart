import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../cash/presentation/screens/cash_screen.dart';
import '../../../data/presentation/providers/data_providers.dart';
import '../../../invoicing/presentation/providers/invoice_providers.dart';
import '../../../invoicing/presentation/screens/invoice_detail_dialog.dart';
import '../../../invoicing/presentation/screens/returns_screen.dart';

/// The partner statement: what they owe, what they paid, and every movement
/// with its running balance - the sheet an accountant would otherwise build
/// by hand at month end.
Future<void> showPartyStatementDialog(
  BuildContext context, {
  required bool isCustomer,
  required Json party,
}) {
  return showDialog<void>(
    context: context,
    builder: (context) => _PartyStatementDialog(
      isCustomer: isCustomer,
      party: party,
    ),
  );
}

class _PartyStatementDialog extends ConsumerStatefulWidget {
  const _PartyStatementDialog({
    required this.isCustomer,
    required this.party,
  });

  final bool isCustomer;
  final Json party;

  @override
  ConsumerState<_PartyStatementDialog> createState() =>
      _PartyStatementDialogState();
}

class _PartyStatementDialogState extends ConsumerState<_PartyStatementDialog> {
  late DateTime _from;
  late DateTime _to;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _from = DateTime(now.year, 1, 1);
    _to = now;
  }

  String _fmt(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-'
      '${value.month.toString().padLeft(2, '0')}-'
      '${value.day.toString().padLeft(2, '0')}';

  /// A line on a statement is a document, so it opens that document rather
  /// than a second, read-only copy of the same figures. Each kind already has
  /// its own dialog on its own screen; the statement only points at it.
  Future<void> _openDocument(Json row) async {
    final type = text(row, 'type');
    final id = text(row, 'id');
    if (id.isEmpty) return;
    final summary = <String, dynamic>{
      'id': id,
      'invoiceNumber': text(row, 'number'),
    };

    if (type == 'SALES_INVOICE' || type == 'PURCHASE_INVOICE') {
      await showInvoiceDetail(
        context,
        kind: type == 'SALES_INVOICE' ? InvoiceKind.sales : InvoiceKind.purchase,
        summary: summary,
      );
      return;
    }
    if (type == 'CREDIT_NOTE' || type == 'DEBIT_NOTE') {
      await showReturnDetail(
        context,
        ref,
        kind: type == 'CREDIT_NOTE' ? InvoiceKind.sales : InvoiceKind.purchase,
        id: id,
      );
      return;
    }
    if (type == 'CASH_RECEIPT' || type == 'CASH_PAYMENT') {
      showVoucherDetail(
        context,
        id: id,
        title: text(row, 'number'),
        onOpen: (path) {
          // The reader asked for the screen behind the voucher; the statement
          // has done its job and gets out of the way.
          Navigator.of(context, rootNavigator: true).pop();
          context.go(path);
        },
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final user = ref.watch(currentUserProvider);
    // Exporting a report needs the report permission: the endpoint accepts
    // reports.read or reports.export, and nothing else. Offering the menu to a
    // role that would be refused is a button that cannot work.
    final canExport =
        user == null ||
        user.can('reports.read') ||
        user.can('reports.export');
    final base = widget.isCustomer
        ? '/parties/customers'
        : '/parties/suppliers';
    final id = widget.party['id'];
    final summaryAsync = ref.watch(
      partySummaryProvider('$base/summary/$id'),
    );
    final statementAsync = ref.watch(
      partyStatementProvider('$base/statement/$id?from=${_fmt(_from)}&to=${_fmt(_to)}'),
    );

    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 30),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1080, maxHeight: 720),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 12, 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      arabic ? 'كشف حساب' : 'Statement',
                      style: Theme.of(context)
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                  ),
                  IconButton(
                    tooltip: MaterialLocalizations.of(context).closeButtonTooltip,
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${text(widget.party, 'code')} — '
                      '${text(widget.party, 'nameEn')} / '
                      '${text(widget.party, 'nameAr')}',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  // The statement is a report the API already knows how to
                  // write out; this is the way to it from the screen the
                  // accountant is looking at. The same permission the server
                  // checks decides whether the menu is offered at all.
                  if (canExport) ...[
                    _StatementExport(
                      isCustomer: widget.isCustomer,
                      partyId: '$id',
                      from: _fmt(_from),
                      to: _fmt(_to),
                    ),
                    const SizedBox(width: 8),
                  ],
                  OutlinedButton.icon(
                    onPressed: () async {
                      final picked = await showDateRangePicker(
                        context: context,
                        firstDate: DateTime(2000),
                        lastDate: DateTime(DateTime.now().year + 5),
                        initialDateRange: DateTimeRange(
                          start: _from,
                          end: _to,
                        ),
                      );
                      if (picked == null) return;
                      setState(() {
                        _from = picked.start;
                        _to = picked.end;
                      });
                    },
                    icon: const Icon(Icons.date_range_outlined, size: 18),
                    label: Text(
                      arabic ? 'الفترة' : 'Period',
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: statementAsync.when(
                loading: () =>
                    const Center(child: CircularProgressIndicator()),
                error: (error, _) => Center(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Text(
                      arabic
                          ? 'تعذر تحميل كشف الحساب.'
                          : 'The statement could not be loaded.',
                    ),
                  ),
                ),
                data: (data) {
                  final rows = listOf(data['rows']);
                  return Column(
                    children: [
                      summaryAsync.when(
                        loading: () => const SizedBox.shrink(),
                        error: (_, _) => const SizedBox.shrink(),
                        data: (summary) {
                          final totals = summary['totals'] is Map
                              ? Map<String, dynamic>.from(
                                  summary['totals'] as Map,
                                )
                              : <String, dynamic>{};
                          // Money the partner left on account is not owed on
                          // any document, so it only appears when there is
                          // some; the balance then has to be the net one,
                          // which is the figure the control account carries.
                          final onAccount = amount(totals, 'onAccount');
                          final showsOnAccount = onAccount != '0.0000';
                          return Padding(
                            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
                            child: Wrap(
                              spacing: 18,
                              runSpacing: 6,
                              children: [
                                _chip(
                                  context,
                                  arabic ? 'إجمالي الفواتير' : 'Invoiced',
                                  formatAmount(asString(totals['invoiced'])),
                                ),
                                _chip(
                                  context,
                                  arabic ? 'المسدَّد' : 'Paid',
                                  formatAmount(asString(totals['paid'])),
                                ),
                                if (showsOnAccount)
                                  _chip(
                                    context,
                                    arabic ? 'على الحساب' : 'On account',
                                    formatAmount(onAccount),
                                  ),
                                _chip(
                                  context,
                                  arabic ? 'الرصيد' : 'Balance',
                                  formatAmount(
                                    showsOnAccount
                                        ? amount(totals, 'netBalance')
                                        : asString(totals['outstanding']),
                                  ),
                                ),
                                _chip(
                                  context,
                                  arabic ? 'المتأخر' : 'Overdue',
                                  formatAmount(asString(totals['overdue'])),
                                ),
                                _chip(
                                  context,
                                  arabic ? 'عدد الفواتير' : 'Invoices',
                                  '${totals['invoices'] ?? 0}',
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: Row(
                          children: [
                            Text(
                              '${arabic ? 'رصيد افتتاحي' : 'Opening'}: '
                              '${formatAmount(asString(data['openingBalance']))}',
                            ),
                            const Spacer(),
                            Text(
                              '${arabic ? 'رصيد ختامي' : 'Closing'}: '
                              '${formatAmount(asString(data['closingBalance']))}',
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 8),
                      Expanded(
                        child: rows.isEmpty
                            ? Center(
                                child: Text(
                                  arabic
                                      ? 'لا توجد حركات في هذه الفترة.'
                                      : 'No movements in this period.',
                                ),
                              )
                            : RecordsTable(
                                rows: rows,
                                onTap: _openDocument,
                                columns: [
                                  ColumnSpec(
                                    arabic ? 'التاريخ' : 'Date',
                                    value: (r) => text(r, 'date'),
                                  ),
                                  ColumnSpec(
                                    arabic ? 'المستند' : 'Document',
                                    value: (r) => text(r, 'number'),
                                    emphasise: true,
                                  ),
                                  ColumnSpec(
                                    arabic ? 'النوع' : 'Kind',
                                    value: (r) => text(r, 'type'),
                                  ),
                                  ColumnSpec(
                                    arabic ? 'الحالة' : 'Status',
                                    value: (r) => text(r, 'status'),
                                  ),
                                  ColumnSpec(
                                    arabic ? 'البيان' : 'Description',
                                    value: (r) => text(r, 'description'),
                                  ),
                                  ColumnSpec(
                                    arabic ? 'مدين' : 'Debit',
                                    numeric: true,
                                    value: (r) =>
                                        formatAmount(asString(r['debit'])),
                                  ),
                                  ColumnSpec(
                                    arabic ? 'دائن' : 'Credit',
                                    numeric: true,
                                    value: (r) =>
                                        formatAmount(asString(r['credit'])),
                                  ),
                                  ColumnSpec(
                                    arabic ? 'الرصيد' : 'Balance',
                                    numeric: true,
                                    value: (r) =>
                                        formatAmount(asString(r['balance'])),
                                    emphasise: true,
                                  ),
                                ],
                              ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _chip(BuildContext context, String label, String value) => Text(
        '$label: $value',
        style: Theme.of(context)
            .textTheme
            .bodyMedium
            ?.copyWith(fontWeight: FontWeight.w700),
      );
}

final partySummaryProvider =
    FutureProvider.family<Json, String>((ref, path) async {
  return ref.read(apiClientProvider).getObject(path);
});

final partyStatementProvider =
    FutureProvider.family<Json, String>((ref, path) async {
  return ref.read(apiClientProvider).getObject(path);
});

/// The four ways a statement leaves the program.
///
/// The file is written by the server from the same `parties.statement` call the
/// dialog renders, so the paper and the screen cannot disagree: same opening
/// balance, same movements in the same order, same closing balance. The period
/// on screen travels with the request.
class _StatementExport extends ConsumerWidget {
  const _StatementExport({
    required this.isCustomer,
    required this.partyId,
    required this.from,
    required this.to,
  });

  final bool isCustomer;
  final String partyId;
  final String from;
  final String to;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final language = Localizations.localeOf(context).languageCode;
    final links = ref.read(reportLinkProvider);
    final kind = isCustomer ? 'customer' : 'supplier';

    // A PDF needs a browser on the server. The choice is only offered when the
    // server says it can make one; a menu item that can only fail is worse than
    // one that is absent.
    final capabilities = ref.watch(exportCapabilitiesProvider);
    final pdfReady = capabilities.asData?.value.pdfOnTheServer ?? false;

    Future<void> download(String format) => runDownload(
          context,
          links.file(
            report: 'party-statement',
            format: format,
            language: language,
            from: from,
            to: to,
            partyId: partyId,
            kind: kind,
          ),
        );

    Future<void> downloadPdf() => runDownload(
          context,
          links.pdf(
            report: 'party-statement',
            language: language,
            from: from,
            to: to,
            partyId: partyId,
            kind: kind,
          ),
        );

    Future<void> print() => runPrint(
          context,
          links.print(
            report: 'party-statement',
            language: language,
            from: from,
            to: to,
            partyId: partyId,
            kind: kind,
          ),
        );

    return PopupMenuButton<String>(
      tooltip: l10n.exportStatementHint,
      onSelected: (choice) => switch (choice) {
        'xlsx' => download('xlsx'),
        'csv' => download('csv'),
        'pdf' => downloadPdf(),
        'print' => print(),
        _ => null,
      },
      itemBuilder: (context) => [
        PopupMenuItem(
          value: 'xlsx',
          child: ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.table_view_outlined, size: 18),
            title: Text(l10n.exportExcel),
          ),
        ),
        PopupMenuItem(
          value: 'csv',
          child: ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.description_outlined, size: 18),
            title: Text(l10n.exportCsv),
          ),
        ),
        if (pdfReady)
          PopupMenuItem(
            value: 'pdf',
            child: ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.picture_as_pdf_outlined, size: 18),
              title: Text(l10n.exportPdf),
            ),
          ),
        PopupMenuItem(
          value: 'print',
          child: ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.print_outlined, size: 18),
            title: Text(l10n.print),
            subtitle: Text(l10n.printPdfHint, style: const TextStyle(fontSize: 11)),
          ),
        ),
      ],
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          border: Border.all(
            color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.6),
          ),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.download_outlined,
              size: 17,
              color: Theme.of(context).colorScheme.primary,
            ),
            const SizedBox(width: 8),
            Text(
              l10n.downloadStatement,
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
            ),
            const Icon(Icons.arrow_drop_down, size: 20),
          ],
        ),
      ),
    );
  }
}
