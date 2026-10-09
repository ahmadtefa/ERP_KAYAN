import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/platform/browser_actions.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../providers/data_providers.dart';

/// The way out of a list: the same four choices a report has.
///
/// One button that opens a short menu, because a list screen's header already
/// carries a search box and a "new" button, and four more buttons would push
/// the list itself off the screen. The choices are the same four everywhere, so
/// learning one screen teaches them all.
///
/// Anything on screen can leave as a file: the list's own name goes in the
/// path, and whatever the screen is filtering by goes in the query, so the file
/// holds the rows the person is looking at rather than the whole table.
class ListExportActions extends ConsumerWidget {
  const ListExportActions({
    super.key,
    required this.list,
    this.filters = const {},
    this.enabled = true,
  });

  /// The list's name in the API, e.g. `customers`.
  final String list;

  /// What the screen is currently filtering by, exactly as the API names it.
  final Map<String, String> filters;

  /// False while the screen has nothing to export yet.
  final bool enabled;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final language = Localizations.localeOf(context).languageCode;
    final links = ref.read(reportLinkProvider);

    // A PDF needs a browser on the server. Until the answer arrives the choice
    // is not offered: an option that appears and then fails is worse than one
    // that was never there.
    final capabilities = ref.watch(exportCapabilitiesProvider);
    final pdfReady = capabilities.asData?.value.pdfOnTheServer ?? false;

    Future<void> open(Future<String> link) async {
      openInNewTab(await link);
    }

    Future<void> download(String format) =>
        open(links.listFile(list: list, format: format, language: language, filters: filters));

    void print(bool auto) => open(
          links.listPrint(list: list, language: language, auto: auto, filters: filters),
        );

    return PopupMenuButton<String>(
      tooltip: l10n.exportListHint,
      enabled: enabled,
      onSelected: (choice) => switch (choice) {
        'xlsx' => download('xlsx'),
        'csv' => download('csv'),
        'pdf' => open(links.listPdf(list: list, language: language, filters: filters)),
        'print' => print(true),
        'paper' => print(false),
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
      // The trigger is drawn by hand rather than as a button, because a button
      // inside a popup menu would swallow the tap that opens the menu. It is
      // dressed the same as the buttons beside it so the header still reads as
      // one row.
      child: _Trigger(label: l10n.downloadList, enabled: enabled),
    );
  }
}

class _Trigger extends StatelessWidget {
  const _Trigger({required this.label, required this.enabled});

  final String label;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final colour = enabled ? scheme.primary : scheme.onSurface.withValues(alpha: 0.38);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
      decoration: BoxDecoration(
        border: Border.all(color: colour.withValues(alpha: 0.6)),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.download_outlined, size: 18, color: colour),
          const SizedBox(width: 8),
          Text(
            label,
            style: TextStyle(
              color: colour,
              fontWeight: FontWeight.w600,
              fontSize: 14,
            ),
          ),
          Icon(Icons.arrow_drop_down, size: 20, color: colour),
        ],
      ),
    );
  }
}
