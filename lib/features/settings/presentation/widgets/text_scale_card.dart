import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/preferences/text_scale.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../providers/text_scale_provider.dart';

/// The program-wide text size: a stepper, the offered sizes, and a reset.
///
/// It is deliberately the same control everywhere - settings, not a per-screen
/// zoom - and the preview line lets a person judge the result before leaving
/// the card.
class TextScaleCard extends ConsumerWidget {
  const TextScaleCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final scale = ref.watch(effectiveTextScaleProvider);
    final controller = ref.read(textScaleControllerProvider.notifier);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.format_size_rounded, color: theme.colorScheme.primary),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(l10n.fontSize, style: theme.textTheme.titleMedium),
                ),
                Text(
                  textScalePercent(scale),
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: theme.colorScheme.primary,
                    fontWeight: FontWeight.w700,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              l10n.fontSizeDescription,
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: AppSpacing.md),
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                IconButton.outlined(
                  tooltip: l10n.fontSizeSmaller,
                  onPressed: stepTextScale(scale, -1) == null
                      ? null
                      : () => controller.step(-1),
                  icon: const Icon(Icons.remove, size: 18),
                ),
                Container(
                  constraints: const BoxConstraints(minWidth: 74),
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.md,
                    vertical: AppSpacing.sm,
                  ),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primaryContainer,
                    borderRadius: AppRadii.control,
                  ),
                  child: Text(
                    textScalePercent(scale),
                    style: theme.textTheme.titleSmall?.copyWith(
                      color: theme.colorScheme.onPrimaryContainer,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ),
                IconButton.outlined(
                  tooltip: l10n.fontSizeLarger,
                  onPressed: stepTextScale(scale, 1) == null
                      ? null
                      : () => controller.step(1),
                  icon: const Icon(Icons.add, size: 18),
                ),
                const SizedBox(width: AppSpacing.xs),
                TextButton.icon(
                  onPressed: scale == kDefaultTextScale
                      ? null
                      : () => controller.reset(),
                  icon: const Icon(Icons.restart_alt, size: 18),
                  label: Text(l10n.fontSizeReset),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            // The offered sizes, so a person can jump straight to one instead
            // of pressing + repeatedly.
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.xs,
              children: [
                for (final step in kTextScaleSteps)
                  ChoiceChip(
                    label: Text(textScalePercent(step)),
                    selected: (scale - step).abs() < 0.005,
                    onSelected: (_) => controller.set(step),
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: AppSpacing.sm,
              ),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerLow,
                border: Border.all(color: theme.colorScheme.outlineVariant),
                borderRadius: AppRadii.control,
              ),
              child: Text(
                l10n.fontSizePreview,
                style: theme.textTheme.bodyMedium,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
