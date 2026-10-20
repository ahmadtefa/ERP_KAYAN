import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/image/company_logo_url.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../../../data/presentation/providers/data_providers.dart';
import '../../../settings/presentation/providers/company_providers.dart';
import '../document/quotation_document.dart';
import '../widgets/quotation_document_view.dart';

/// Opens the offer as the customer will see it, without leaving the desk.
Future<void> showQuotationPreview(
  BuildContext context, {
  required Json quotation,
  required String language,
  required bool canExport,
}) {
  return Navigator.of(context, rootNavigator: true).push(
    MaterialPageRoute<void>(
      builder: (context) => QuotationPreviewScreen(
        quotation: quotation,
        language: language,
        canExport: canExport,
      ),
    ),
  );
}

/// The quotation on A4 paper, with the two exports that produce the file.
///
/// The page is built from the same fields the server prints: the snapshot for
/// an issued offer, the live record for a draft. The print page and the PDF
/// are still produced by the server, so the browser handles the Arabic shaping
/// and the customer gets a real file, not a painted screen.
class QuotationPreviewScreen extends ConsumerWidget {
  const QuotationPreviewScreen({
    super.key,
    required this.quotation,
    required this.language,
    required this.canExport,
  });

  final Json quotation;
  final String language;
  final bool canExport;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final id = text(quotation, 'id');
    final appConfig = ref.watch(appConfigProvider);
    final profile = ref.watch(companyProfileProvider).asData?.value ??
        const <String, dynamic>{};
    final logoUrl = companyLogoUrl(appConfig.apiBaseUrl, profile);
    final links = ref.read(reportLinkProvider);
    final document = QuotationDocument.fromJson(
      quotation,
      company: profile,
      language: language,
    );

    // On a narrow window the two actions move below the title, where they
    // have the full width instead of squeezing the app bar.
    final compact = MediaQuery.sizeOf(context).width < 640;

    return Scaffold(
      backgroundColor: AppColors.surfaceSunken,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        title: Text(l10n.printPreview),
        actions: [
          if (!compact && canExport && id.isNotEmpty) ...[
            TextButton.icon(
              onPressed: () => runPrint(
                context,
                links.quotationPrint(id: id, language: language),
              ),
              icon: const Icon(Icons.print_outlined, size: 18),
              label: Text(l10n.print),
            ),
            Padding(
              padding: const EdgeInsetsDirectional.only(end: AppSpacing.sm),
              child: FilledButton.icon(
                onPressed: () => runDownload(
                  context,
                  links.quotationPdf(id: id, language: language),
                ),
                icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
                label: Text(l10n.downloadPdf),
              ),
            ),
          ],
        ],
      ),
      body: SingleChildScrollView(
        padding: EdgeInsets.all(compact ? AppSpacing.md : AppSpacing.xxl),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (compact && canExport && id.isNotEmpty) ...[
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => runPrint(
                            context,
                            links.quotationPrint(
                              id: id,
                              language: language,
                            ),
                          ),
                          icon: const Icon(Icons.print_outlined, size: 18),
                          label: Text(l10n.print),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: () => runDownload(
                            context,
                            links.quotationPdf(
                              id: id,
                              language: language,
                            ),
                          ),
                          icon: const Icon(
                            Icons.picture_as_pdf_outlined,
                            size: 18,
                          ),
                          label: Text(l10n.downloadPdf),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                ],
                QuotationDocumentView(
                  document: document,
                  logoUrl: logoUrl,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
