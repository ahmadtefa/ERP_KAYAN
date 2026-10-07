import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/platform/browser_actions.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../providers/data_providers.dart';

/// The download and print buttons that sit above a report.
///
/// One place, used by every report, so the three ways out of a report - a
/// spreadsheet, a CSV, or paper - always look and behave the same.
///
/// The link carries the access token, because the browser fetches it in a new
/// tab and a tab cannot send an Authorization header. The server accepts a
/// token in the address on these two routes and nowhere else.
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

    Future<void> go(Future<String> link) async {
      final url = await link;
      openInNewTab(url);
    }

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        OutlinedButton.icon(
          onPressed: ready
              ? () => go(
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
              ? () => go(
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
        Tooltip(
          message: l10n.printPdfHint,
          child: FilledButton.tonalIcon(
            onPressed: ready
                ? () => go(
                      links.print(
                        report: report,
                        language: language,
                        from: from,
                        to: to,
                        accountId: accountId,
                      ),
                    )
                : null,
            icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
            label: Text(l10n.print),
          ),
        ),
      ],
    );
  }
}
