import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/image/company_logo_url.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../features/settings/presentation/providers/text_scale_provider.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../data/presentation/providers/data_providers.dart';
import '../../../settings/presentation/providers/company_providers.dart';
import '../document/quotation_document.dart';
import '../widgets/quotation_document_view.dart';

/// A letterhead as the preview needs it: the page picture and the room the
/// artwork takes at the top and bottom of an A4 sheet, in millimetres.
class QuotationBackgroundPreview {
  const QuotationBackgroundPreview(this.bytes, {this.topMm = 0, this.bottomMm = 0});
  final Uint8List bytes;
  final double topMm;
  final double bottomMm;
}

/// The chosen letterhead of a quotation, or null when it has none or the server
/// cannot give it. The preview then simply shows no background instead of
/// failing; print and PDF are produced by the server regardless.
final quotationBackgroundPreviewProvider =
    FutureProvider.autoDispose.family<QuotationBackgroundPreview?, ({String id, bool stretch})>((ref, key) async {
  final id = key.id;
  if (id.isEmpty) return null;
  try {
    final response = await ref.read(apiClientProvider).raw.get<List<int>>(
          '/sales/quotation-backgrounds/$id/preview',
          queryParameters: {if (key.stretch) 'fit': 'stretch'},
          options: Options(responseType: ResponseType.bytes),
        );
    final data = response.data;
    if (data == null || data.isEmpty) return null;
    return QuotationBackgroundPreview(
      Uint8List.fromList(data),
      topMm: double.tryParse(response.headers.value('x-background-top-mm') ?? '') ?? 0,
      bottomMm: double.tryParse(response.headers.value('x-background-bottom-mm') ?? '') ?? 0,
    );
  } on Object {
    return null;
  }
});

/// Opens the offer as the customer will see it, without leaving the desk.
Future<void> showQuotationPreview(
  BuildContext context, {
  required Json quotation,
  required String language,
}) {
  return Navigator.of(context, rootNavigator: true).push(
    MaterialPageRoute<void>(
      builder: (context) => QuotationPreviewScreen(
        quotation: quotation,
        language: language,
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
///
/// Print and Download PDF are always on this screen. Whether this person may
/// export is the server's call - it checks `sales.quotations.export` on both
/// routes - and hiding the buttons here only ever produced a preview with
/// no way out and no explanation. A refusal now arrives as the server's own
/// sentence instead of a missing button.
class QuotationPreviewScreen extends ConsumerWidget {
  const QuotationPreviewScreen({
    super.key,
    required this.quotation,
    required this.language,
  });

  final Json quotation;
  final String language;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final id = text(quotation, 'id');
    final appConfig = ref.watch(appConfigProvider);
    final profile = ref.watch(companyProfileProvider).asData?.value ??
        const <String, dynamic>{};
    final logoUrl = companyLogoUrl(appConfig.apiBaseUrl, profile);
    final textScale = ref.watch(effectiveTextScaleProvider);
    final links = ref.read(reportLinkProvider);
    final document = QuotationDocument.fromJson(
      quotation,
      company: profile,
      language: language,
    );
    final background = ref
        .watch(quotationBackgroundPreviewProvider((
          id: document.design?.backgroundId ?? '',
          stretch: document.design?.backgroundStretch ?? false,
        )))
        .asData
        ?.value;

    // On a narrow window the two actions move below the title, where they
    // have the full width instead of squeezing the app bar.
    final compact = MediaQuery.sizeOf(context).width < 640;

    return Scaffold(
      backgroundColor: AppColors.surfaceSunken,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        title: Text(l10n.printPreview),
        actions: [
          if (!compact && id.isNotEmpty) ...[
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
                if (compact && id.isNotEmpty) ...[
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
                  textScale: textScale,
                  backgroundImage: background?.bytes,
                  backgroundTopMm: background?.topMm ?? 0,
                  backgroundBottomMm: background?.bottomMm ?? 0,
                  backgroundStretch: document.design?.backgroundStretch ?? false,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
