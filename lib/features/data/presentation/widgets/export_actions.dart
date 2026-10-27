import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/platform/browser_actions.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../providers/data_providers.dart';
import 'price_visibility_dialog.dart';

/// The ways out of a report: a spreadsheet, a plain file, a PDF, or paper.
///
/// One place, used by every report, so all four always look and behave the
/// same and always describe the period and the account currently on screen.
///
/// A file is fetched by the page and handed to the browser, so a refusal is
/// reported here rather than turning into a blank tab. A print page is a
/// navigation and cannot carry a header, so it carries a one-minute download
/// ticket instead - never the sign-in token.
class ReportExportActions extends ConsumerWidget {
  const ReportExportActions({
    super.key,
    required this.report,
    this.from,
    this.to,
    this.accountId,
  });

  /// The report's name in the API, e.g. `trial-balance`.
  final String report;

  final String? from;
  final String? to;

  /// Only the account ledger uses this. Until an account is chosen the buttons
  /// stay disabled: a ledger without an account is not a report.
  final String? accountId;

  bool get _needsAccount => report == 'account-ledger';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final language = Localizations.localeOf(context).languageCode;
    final links = ref.read(reportLinkProvider);
    final ready = !_needsAccount || (accountId?.isNotEmpty ?? false);

    // Whether this installation can make a PDF by itself. Until the answer
    // arrives the PDF button is not offered - a button that appears and then
    // fails is worse than one that was never there.
    final capabilities = ref.watch(exportCapabilitiesProvider);
    final pdfReady = capabilities.asData?.value.pdfOnTheServer ?? false;

    Future<void> download(Future<DownloadRequest> link) =>
        runDownload(context, link);

    Future<void> downloadPdf() async {
      final visibility = await choosePriceVisibility(context, arabic: language == 'ar');
      if (visibility == null || !context.mounted) return;
      await download(links.pdf(
        report: report,
        language: language,
        from: from,
        to: to,
        accountId: accountId,
        showSalePrice: visibility['showSalePrice'],
        showCost: visibility['showCost'],
      ));
    }

    Future<void> showPage() async {
      final visibility = await choosePriceVisibility(context, arabic: language == 'ar');
      if (visibility == null || !context.mounted) return;
      await runPrint(context, links.print(
        report: report,
        language: language,
        from: from,
        to: to,
        accountId: accountId,
        showSalePrice: visibility['showSalePrice'],
        showCost: visibility['showCost'],
      ));
    }

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        OutlinedButton.icon(
          onPressed: ready
              ? () => download(
                    links.file(
                      report: report,
                      format: 'xlsx',
                      language: language,
                      from: from,
                      to: to,
                      accountId: accountId,
                    ),
                  )
              : null,
          icon: const Icon(Icons.table_view_outlined, size: 18),
          label: Text(l10n.exportExcel),
        ),
        OutlinedButton.icon(
          onPressed: ready
              ? () => download(
                    links.file(
                      report: report,
                      format: 'csv',
                      language: language,
                      from: from,
                      to: to,
                      accountId: accountId,
                    ),
                  )
              : null,
          icon: const Icon(Icons.description_outlined, size: 18),
          label: Text(l10n.exportCsv),
        ),
        if (pdfReady)
          FilledButton.tonalIcon(
            onPressed: ready ? downloadPdf : null,
            icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
            label: Text(l10n.exportPdf),
          ),
        Tooltip(
          // Where the server cannot make a PDF, this button is the way to get
          // one, so the tooltip says which dialogue option saves the file.
          message: pdfReady ? l10n.printPdfHint : l10n.printHintWhenNoPdf,
          child: OutlinedButton.icon(
            onPressed: ready ? showPage : null,
            icon: const Icon(Icons.print_outlined, size: 18),
            label: Text(l10n.print),
          ),
        ),
      ],
    );
  }
}
