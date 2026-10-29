import 'package:flutter/material.dart';

import '../../app/theme/design_tokens.dart';

/// A bordered white panel — the basic building block of every screen.
///
/// It is deliberately not a Material `Card`: no elevation, no margin and no
/// implicit padding, so a panel can sit flush inside a split layout while a
/// dialog card keeps its own spacing. The hairline border is what separates
/// it from the canvas.
class SurfaceCard extends StatelessWidget {
  const SurfaceCard({
    super.key,
    this.child,
    this.title,
    this.subtitle,
    this.trailing,
    this.icon,
    this.padding = const EdgeInsets.all(AppSpacing.lg),
    this.headerPadding,
    this.tone,
    this.onTap,
  });

  final Widget? child;
  final String? title;
  final String? subtitle;
  final Widget? trailing;
  final IconData? icon;
  final EdgeInsets padding;
  final EdgeInsets? headerPadding;
  final Color? tone;
  final VoidCallback? onTap;

  bool get _hasHeader =>
      title != null || subtitle != null || trailing != null || icon != null;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final border = scheme.brightness == Brightness.light
        ? AppColors.border
        : AppColors.darkBorder;
    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (_hasHeader)
          Padding(
            padding:
                headerPadding ??
                EdgeInsets.fromLTRB(
                  padding.left,
                  padding.top,
                  padding.right,
                  subtitle == null ? padding.top : AppSpacing.sm,
                ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (icon != null) ...[
                  Container(
                    width: 30,
                    height: 30,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: (tone ?? scheme.primary).withValues(alpha: 0.10),
                      borderRadius: BorderRadius.circular(AppRadii.md),
                    ),
                    child: Icon(
                      icon,
                      size: 16,
                      color: tone ?? scheme.primary,
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                ],
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (title != null)
                        Text(
                          title!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                            color: scheme.onSurface,
                          ),
                        ),
                      if (subtitle != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(
                            subtitle!,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                if (trailing != null) ...[
                  const SizedBox(width: AppSpacing.sm),
                  trailing!,
                ],
              ],
            ),
          ),
        if (child != null)
          Padding(
            padding: _hasHeader
                ? EdgeInsets.fromLTRB(
                    padding.left,
                    AppSpacing.md,
                    padding.right,
                    padding.bottom,
                  )
                : padding,
            child: child!,
          ),
      ],
    );

    final decorated = Container(
      decoration: BoxDecoration(
        color: scheme.surface,
        borderRadius: AppRadii.card,
        border: Border.all(color: border),
        // Fluent depth on the light canvas; on dark surfaces the hairline
        // alone carries the separation (shadows would be invisible).
        boxShadow: scheme.brightness == Brightness.light
            ? AppShadows.raised
            : AppShadows.none,
      ),
      clipBehavior: Clip.antiAlias,
      child: content,
    );

    if (onTap == null) return decorated;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: AppRadii.card,
        onTap: onTap,
        child: decorated,
      ),
    );
  }
}

/// A labelled value, for detail dialogs and summary blocks.
class LabeledValue extends StatelessWidget {
  const LabeledValue({
    super.key,
    required this.label,
    required this.value,
    this.icon,
    this.emphasise = false,
    this.maxLines = 2,
  });

  final String label;
  final String value;
  final IconData? icon;
  final bool emphasise;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 14, color: scheme.onSurfaceVariant),
            const SizedBox(width: 6),
          ],
          SizedBox(
            width: 132,
            child: Text(
              label,
              style: theme.textTheme.bodySmall?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              value,
              maxLines: maxLines,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: scheme.onSurface,
                fontWeight: emphasise ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A horizontal rule that also works as a section separator inside a card.
class CardDivider extends StatelessWidget {
  const CardDivider({super.key, this.vertical = AppSpacing.md});

  final double vertical;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: vertical),
      child: Divider(
        height: 1,
        color: Theme.of(context).colorScheme.outlineVariant,
      ),
    );
  }
}
