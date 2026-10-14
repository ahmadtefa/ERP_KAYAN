import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../providers/data_providers.dart';

/// Print and download one saved document (invoice, voucher, order, entry).
class DocumentExportActions extends ConsumerWidget {
  const DocumentExportActions({
    super.key,
    required this.kind,
    required this.id,
  });

  final String kind;
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final language = Localizations.localeOf(context).languageCode;
    final links = ref.read(reportLinkProvider);
    final capabilities = ref.watch(exportCapabilitiesProvider);
    final pdfReady = capabilities.asData?.value.pdfOnTheServer ?? false;
    final ready = id.isNotEmpty;

    return Wrap(
      spacing: 8,
      children: [
        OutlinedButton.icon(
          onPressed: ready
              ? () => runPrint(
                    context,
                    links.documentPrint(
                      kind: kind,
                      id: id,
                      language: language,
                    ),
                  )
              : null,
          icon: const Icon(Icons.print_outlined, size: 18),
          label: Text(l10n.print),
        ),
        if (pdfReady)
          OutlinedButton.icon(
            onPressed: ready
                ? () => runDownload(
                      context,
                      links.documentPdf(
                        kind: kind,
                        id: id,
                        language: language,
                      ),
                    )
                : null,
            icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
            label: Text(l10n.exportPdf),
          ),
        OutlinedButton.icon(
          onPressed: ready
              ? () => runDownload(
                    context,
                    links.documentFile(
                      kind: kind,
                      id: id,
                      format: 'xlsx',
                      language: language,
                    ),
                  )
              : null,
          icon: const Icon(Icons.table_view_outlined, size: 18),
          label: Text(l10n.exportExcel),
        ),
      ],
    );
  }
}
