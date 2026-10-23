import 'package:flutter/material.dart';

import '../../app/theme/design_tokens.dart';

/// A single number that matters, with the context needed to read it.
///
/// The card is intentionally short: label, value, one caption. Decorative
/// sparklines are omitted unless there is real history behind them, because a
/// fake trend line on a financial dashboard is worse than no line at all.
class KpiCard extends StatelessWidget {
  const KpiCard({
    super.key,
    required this.label,
    required this.value,
    this.caption,
    this.icon,
    this.tone = AppTone.info,
    this.accent,
    this.trend,
    this.onTap,
    this.compact = false,
  });

  final String label;
  final String value;
  final String? caption;
  final IconData? icon;
  final AppTone tone;

  /// The product section this figure belongs to (sales, cash, parties…).
  /// When given, the icon tile wears the section colour — the same hue
  /// the navigation lights up with — so a dashboard row reads as a map of
  /// the product, not four copies of one card.
  final SectionAccent? accent;

  /// A signed percentage such as `+12.4%`; only pass real data.
  final String? trend;
  final VoidCallback? onTap;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final border = scheme.brightness == Brightness.light
        ? AppColors.border
        : AppColors.darkBorder;

    final body = Padding(
      padding: EdgeInsets.all(compact ? AppSpacing.md : AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              if (icon != null)
                Container(
                  width: compact ? 26 : 30,
                  height: compact ? 26 : 30,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: accent?.softOf(scheme.brightness) ??
                        tone.background,
                    borderRadius: BorderRadius.circular(AppRadii.md),
                  ),
                  child: Icon(
                    icon,
                    size: compact ? 14 : 16,
                    color: accent?.of(scheme.brightness) ?? tone.foreground,
                  ),
                ),
              const Spacer(),
              if (trend != null)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: tone.background,
                    borderRadius: BorderRadius.circular(AppRadii.sm),
                  ),
                  child: Text(
                    trend!,
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: tone.foreground,
                      fontWeight: FontWeight.w700,
                      fontSize: 10.5,
                    ),
                  ),
                ),
            ],
          ),
          SizedBox(height: compact ? AppSpacing.sm : AppSpacing.md),
          Text(
            label,
            // Two lines instead of an ellipsis: the card has no fixed height,
            // so a longer label at a larger text size simply makes it taller.
            maxLines: 2,
            style: theme.textTheme.bodySmall?.copyWith(
              color: scheme.onSurfaceVariant,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            value,
            maxLines: 2,
            style: (compact
                    ? theme.textTheme.titleLarge
                    : theme.textTheme.headlineSmall)
                ?.copyWith(
                  color: scheme.onSurface,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.3,
                  height: 1.15,
                ),
          ),
          if (caption != null && caption!.trim().isNotEmpty) ...[
            const SizedBox(height: 3),
            Text(
              caption!,
              maxLines: 2,
              style: theme.textTheme.labelSmall?.copyWith(
                color: scheme.onSurfaceVariant,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ],
      ),
    );

    final card = Container(
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: AppRadii.card,
        border: Border.all(color: border),
        boxShadow: scheme.brightness == Brightness.light
            ? AppShadows.raised
            : AppShadows.none,
      ),
      clipBehavior: Clip.antiAlias,
      child: body,
    );

    if (onTap == null) return card;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: AppRadii.card,
        onTap: onTap,
        child: card,
      ),
    );
  }
}

/// A compact horizontal figure used for secondary numbers that must stay
/// visible without competing with the primary KPI cards.
class StatStripItem extends StatelessWidget {
  const StatStripItem({
    super.key,
    required this.label,
    required this.value,
    this.icon,
    this.tone = AppTone.neutral,
  });

  final String label;
  final String value;
  final IconData? icon;
  final AppTone tone;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (icon != null) ...[
          Icon(icon, size: 16, color: tone.foreground),
          const SizedBox(width: AppSpacing.sm),
        ],
        // Loose, so a long label at a large text size wraps inside the strip
        // instead of running past it.
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                maxLines: 2,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 1),
              Text(
                value,
                maxLines: 2,
                style: theme.textTheme.titleSmall?.copyWith(
                  color: scheme.onSurface,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
