import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/data_dialog.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../../../../shared/widgets/form_sheet.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../../shared/widgets/status_pill.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../data/presentation/providers/data_providers.dart';
import '../providers/quotation_providers.dart';
import 'quotation_preview_screen.dart';
import '../quotation_status.dart';

/// Opens one quotation with its tables, history and lifecycle actions.
Future<void> showQuotationDetail(BuildContext context, {required String id}) {
  return showDataDialog<void>(
    context,
    storageKey: 'quotation-detail',
    title: context.l10n.quotation,
    icon: Icons.description_outlined,
    initialSize: const Size(1040, 700),
    child: QuotationDetailDialog(id: id),
  );
}

class QuotationDetailDialog extends ConsumerStatefulWidget {
  const QuotationDetailDialog({super.key, required this.id});

  final String id;

  @override
  ConsumerState<QuotationDetailDialog> createState() =>
      _QuotationDetailDialogState();
}

class _QuotationDetailDialogState extends ConsumerState<QuotationDetailDialog> {
  bool _busy = false;

  Future<void> _act(
    String action, {
    Map<String, dynamic>? body,
    required String successMessage,
  }) async {
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .post('/sales/quotations/${widget.id}/$action', body: body ?? {});
      ref.invalidate(quotationDetailProvider(widget.id));
      ref.invalidate(quotationsProvider);
      if (mounted) showMessage(context, successMessage);
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _followUp() async {
    final l10n = context.l10n;
    final values = await showFormSheet(
      context,
      title: l10n.followUp,
      fields: [
        FieldSpec(
          'note',
          l10n.followUpNote,
          kind: FieldKind.multiline,
          required: true,
          maxLines: 4,
        ),
      ],
    );
    if (values == null || !mounted) return;
    await _act(
      'follow-up',
      body: {'note': text(values, 'note')},
      successMessage: l10n.followUp,
    );
  }

  Future<void> _convert(Json quotation) async {
    final l10n = context.l10n;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.convertToInvoice),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.conversionConfirm),
            const SizedBox(height: 8),
            Text(
              l10n.conversionTaxNote,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.convert),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _act(
      'convert',
      successMessage: l10n.quotationConverted,
    );
    // The converted quotation is still on screen, refreshed: the new invoice
    // number is shown in its header, and nothing was posted.
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final language = Localizations.localeOf(context).languageCode;
    final async = ref.watch(quotationDetailProvider(widget.id));
    final user = ref.watch(currentUserProvider);
    final links = ref.read(reportLinkProvider);
    final canManage = user?.can('sales.quotations.manage') ?? false;
    final canConvert =
        (user?.can('sales.quotations.convert') ?? false) &&
        (user?.can('sales.invoices.create') ?? false);
    final canExport = user?.can('sales.quotations.export') ?? false;

    return AsyncStateView<Json>(
      value: async,
      onRetry: () => ref.invalidate(quotationDetailProvider(widget.id)),
      data: (quotation) {
        final status = text(quotation, 'status');
        final customer = partyName(quotation['customer'], language);
        final tables = listOf(quotation['tables']);
        final events = listOf(quotation['events']);
        final converted = quotation['convertedInvoice'];
        final canEdit = quotation['canEdit'] == true;
        final mayConvert = quotation['canConvert'] == true && canConvert;

        Widget field(String label, String value) => Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 150,
                child: Text(label, style: theme.textTheme.bodySmall),
              ),
              Expanded(child: Text(value)),
            ],
          ),
        );

        return Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(
            AppSpacing.xl,
            AppSpacing.xs,
            AppSpacing.xl,
            AppSpacing.xl,
          ),
          child: ListView(
            children: [
              Wrap(
                spacing: 12,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  StatusPill(
                    label: quotationStatusLabel(context, status),
                    tone: toneForStatus(status),
                  ),
                  if (asNum(quotation['version']) != null &&
                      asNum(quotation['version'])! > 1)
                    Chip(label: Text('${l10n.version} ${quotation['version']}')),
                  if (text(quotation, 'snapshotAt').isNotEmpty)
                    Chip(
                      avatar: const Icon(Icons.lock_outline, size: 14),
                      label: Text(l10n.statusHistory),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              LayoutBuilder(
                builder: (context, constraints) {
                  final wide = constraints.maxWidth >= 660;
                  final left = Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        field(
                          l10n.quotationNumber,
                          text(quotation, 'quotationNumber'),
                        ),
                        field(l10n.quotationDate, text(quotation, 'quotationDate')),
                        field(
                          l10n.validUntil,
                          text(quotation, 'validUntil').isEmpty
                              ? '—'
                              : text(quotation, 'validUntil'),
                        ),
                        field(l10n.customer, customer),
                        if (text(quotation, 'subject').isNotEmpty)
                          field(l10n.subject, text(quotation, 'subject')),
                        field(
                          l10n.currency,
                          text(quotation, 'currency', fallback: '—'),
                        ),
                        field(
                          l10n.showTaxNumberOnOffer,
                          quotation['showTaxId'] == false
                              ? l10n.notPrintedOnOffer
                              : l10n.printedOnOffer,
                        ),
                      ],
                  );
                  final right = Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        field(
                          l10n.subtotalBeforeDiscount,
                          formatAmount(text(quotation, 'subTotal')),
                        ),
                        field(
                          l10n.totalDiscounts,
                          formatAmount(text(quotation, 'discountTotal')),
                        ),
                        field(
                          l10n.finalTotal,
                          formatAmount(text(quotation, 'totalAmount')),
                        ),
                        if (text(quotation, 'managerName').isNotEmpty)
                          field(l10n.managerName, text(quotation, 'managerName')),
                        if (text(quotation, 'responsibleName').isNotEmpty)
                          field(
                            l10n.responsibleName,
                            text(quotation, 'responsibleName'),
                          ),
                        if (text(quotation, 'responsiblePhone').isNotEmpty)
                          field(
                            l10n.responsiblePhone,
                            text(quotation, 'responsiblePhone'),
                          ),
                        if (converted is Map) ...[
                          field(
                            l10n.convertedInvoice,
                            '${text(Map<String, dynamic>.from(converted), 'invoiceNumber')} · '
                                '${formatAmount(text(Map<String, dynamic>.from(converted), 'totalAmount'))}',
                          ),
                        ],
                      ],
                  );
                  return Container(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceMuted,
                      border: Border.all(color: AppColors.border),
                      borderRadius: AppRadii.card,
                    ),
                    child: wide
                        ? Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(child: left),
                              const SizedBox(width: AppSpacing.xxl),
                              Expanded(child: right),
                            ],
                          )
                        : Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              left,
                              const SizedBox(height: AppSpacing.lg),
                              right,
                            ],
                          ),
                  );
                },
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton.icon(
                    onPressed: () => showQuotationPreview(
                      context,
                      quotation: quotation,
                      language: language,
                      canExport: canExport,
                    ),
                    icon: const Icon(Icons.visibility_outlined, size: 18),
                    label: Text(l10n.printPreview),
                  ),
                  // Print and Download PDF stay on screen for everyone who
                  // can open the offer: a missing export button reads as a
                  // missing feature. The server still decides who may export,
                  // and a refusal is shown as its own message.
                  OutlinedButton.icon(
                    onPressed: () => runPrint(
                      context,
                      links.quotationPrint(
                        id: widget.id,
                        language: language,
                      ),
                    ),
                    icon: const Icon(Icons.print_outlined, size: 18),
                    label: Text(l10n.print),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => runDownload(
                      context,
                      links.quotationPdf(id: widget.id, language: language),
                    ),
                    icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
                    label: Text(l10n.downloadPdf),
                  ),
                  if (canExport)
                    OutlinedButton.icon(
                      onPressed: () => runDownload(
                        context,
                        links.documentFile(
                          kind: 'sales-quotation',
                          id: widget.id,
                          format: 'xlsx',
                          language: language,
                        ),
                      ),
                      icon: const Icon(Icons.grid_on_outlined, size: 18),
                      label: Text(l10n.exportExcel),
                    ),
                  if (canExport)
                    OutlinedButton.icon(
                      onPressed: () => runDownload(
                        context,
                        links.documentFile(
                          kind: 'sales-quotation',
                          id: widget.id,
                          format: 'csv',
                          language: language,
                        ),
                      ),
                      icon: const Icon(Icons.table_view_outlined, size: 18),
                      label: Text(l10n.exportCsv),
                    ),
                  if (canManage && canEdit)
                    OutlinedButton.icon(
                      onPressed: () {
                        final router = GoRouter.of(context);
                        Navigator.of(context).pop();
                        router.go(
                          '${AppRoutes.quotations}/${widget.id}/edit',
                        );
                      },
                      icon: const Icon(Icons.edit_outlined, size: 18),
                      label: Text(l10n.edit),
                    ),
                  if (canManage && status == 'draft')
                    FilledButton.icon(
                      onPressed: _busy
                          ? null
                          : () => _act(
                                'send',
                                successMessage: l10n.quotationSent,
                              ),
                      icon: const Icon(Icons.send_outlined, size: 18),
                      label: Text(l10n.sendQuotation),
                    ),
                  if (canManage && (status == 'sent' || status == 'accepted'))
                    TextButton.icon(
                      onPressed: _busy ? null : _followUp,
                      icon: const Icon(Icons.history_edu_outlined, size: 18),
                      label: Text(l10n.followUp),
                    ),
                  if (canManage && status == 'sent') ...[
                    OutlinedButton.icon(
                      onPressed: _busy
                          ? null
                          : () => _act(
                                'accept',
                                successMessage: l10n.quotationAccepted,
                              ),
                      icon: const Icon(Icons.check_circle_outline, size: 18),
                      label: Text(l10n.acceptQuotation),
                    ),
                    TextButton.icon(
                      onPressed: _busy
                          ? null
                          : () => _act(
                                'reject',
                                successMessage: l10n.quotationRejected,
                              ),
                      icon: const Icon(Icons.cancel_outlined, size: 18),
                      label: Text(l10n.rejectQuotation),
                    ),
                  ],
                  if (canManage &&
                      (status == 'sent' || status == 'accepted' || status == 'rejected' || status == 'expired'))
                    OutlinedButton.icon(
                      onPressed: _busy
                          ? null
                          : () => _act(
                                'revise',
                                successMessage: l10n.quotationRevised,
                              ),
                      icon: const Icon(Icons.fork_right, size: 18),
                      label: Text(l10n.reviseQuotation),
                    ),
                  if (mayConvert)
                    FilledButton.icon(
                      onPressed: _busy ? null : () => _convert(quotation),
                      icon: const Icon(Icons.receipt_long_outlined, size: 18),
                      label: Text(l10n.convertToInvoice),
                    ),
                ],
              ),
              const Divider(height: 28, color: AppColors.border),
              for (var index = 0; index < tables.length; index++)
                _table(
                  context,
                  tables[index],
                  index,
                  listOf(quotation['columns']),
                ),
              if (text(quotation, 'terms').isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(l10n.termsAndConditions, style: theme.textTheme.titleSmall),
                const SizedBox(height: 4),
                Text(text(quotation, 'terms')),
              ],
              if (text(quotation, 'notes').isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(l10n.notesLabel, style: theme.textTheme.titleSmall),
                const SizedBox(height: 4),
                Text(text(quotation, 'notes')),
              ],
              const Divider(height: 28, color: AppColors.border),
              Text(l10n.statusHistory, style: theme.textTheme.titleSmall),
              const SizedBox(height: 4),
              if (events.isEmpty)
                Text(l10n.noRecords, style: theme.textTheme.bodySmall)
              else
                for (final event in events)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 3),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(
                          width: 170,
                          child: Text(
                            text(event, 'createdAt').split('T').first,
                            style: theme.textTheme.bodySmall,
                          ),
                        ),
                        Expanded(
                          child: Text(
                            [
                              text(event, 'type'),
                              if (text(event, 'toStatus').isNotEmpty)
                                '→ ${quotationStatusLabel(context, text(event, 'toStatus'))}',
                              if (text(event, 'note').isNotEmpty)
                                text(event, 'note'),
                            ].join(' · '),
                          ),
                        ),
                      ],
                    ),
                  ),
            ],
          ),
        );
      },
    );
  }

  /// The columns this offer prints: its own layout when it has one, the
  /// standard six otherwise. The detail screen, the printed page and the
  /// spreadsheet therefore show the same columns in the same order.
  List<Json> _layout(List<Json> stored) {
    if (stored.isNotEmpty) return stored.where((row) => row['visible'] != false).toList();
    return const <Json>[
      {'key': 'description', 'width': 4, 'visible': true},
      {'key': 'countryOfOrigin', 'width': 2, 'visible': true},
      {'key': 'unit', 'width': 1, 'visible': true},
      {'key': 'quantity', 'width': 1, 'visible': true},
      {'key': 'unitPrice', 'width': 2, 'visible': true},
      {'key': 'lineTotal', 'width': 2, 'visible': true},
    ];
  }

  String _columnName(BuildContext context, String key) {
    final l10n = context.l10n;
    return switch (key) {
      'itemCode' => l10n.itemCode,
      'description' => l10n.description,
      'countryOfOrigin' => l10n.countryOfOrigin,
      'unit' => l10n.unit,
      'quantity' => l10n.quantity,
      'unitPrice' => l10n.unitPrice,
      _ => l10n.lineTotal,
    };
  }

  String _columnLabel(
    BuildContext context,
    Json column,
    String language,
  ) {
    final override = language == 'ar'
        ? text(column, 'labelAr')
        : text(column, 'labelEn');
    if (override.isNotEmpty) return override;
    return _columnName(context, text(column, 'key'));
  }

  String _cell(Json line, String key, String language) {
    switch (key) {
      case 'itemCode':
        return text(line, 'itemCode').isEmpty ? '—' : text(line, 'itemCode');
      case 'countryOfOrigin':
        return text(line, 'countryOfOrigin').isEmpty
            ? '—'
            : text(line, 'countryOfOrigin');
      case 'unit':
        return text(line, 'unit');
      case 'quantity':
        return formatQuantity(text(line, 'quantity'));
      case 'unitPrice':
        return formatAmount(text(line, 'unitPrice'), locale: language);
      case 'lineTotal':
        return formatAmount(text(line, 'lineTotal'));
      default:
        return text(line, 'description');
    }
  }

  Widget _table(
    BuildContext context,
    Json table,
    int index,
    List<Json> storedColumns,
  ) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final language = Localizations.localeOf(context).languageCode;
    final lines = listOf(table['lines']);
    final columns = _layout(storedColumns);
    const numeric = {'quantity', 'unitPrice', 'lineTotal'};
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    '${index + 1}. ${text(table, 'title')}',
                    style: theme.textTheme.titleSmall,
                  ),
                ),
                Text(
                  '${l10n.netValue}: ${formatAmount(text(table, 'netTotal'))}',
                  style: theme.textTheme.bodyMedium,
                ),
              ],
            ),
            const SizedBox(height: 6),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                headingTextStyle: theme.textTheme.labelSmall,
                dataTextStyle: theme.textTheme.bodySmall,
                columns: [
                  DataColumn(label: Text('#')),
                  for (final column in columns)
                    DataColumn(
                      label: Text(_columnLabel(context, column, language)),
                      numeric: numeric.contains(text(column, 'key')),
                    ),
                ],
                rows: [
                  for (final line in lines)
                    DataRow(
                      cells: [
                        DataCell(
                          Text(asNum(line['lineNumber'])?.toString() ?? ''),
                        ),
                        for (final column in columns)
                          DataCell(
                            Text(
                              _cell(line, text(column, 'key'), language),
                            ),
                          ),
                      ],
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
