import 'package:flutter/material.dart';

import '../../app/theme/design_tokens.dart';

/// The header above a module screen.
///
/// One place decides how a page announces itself: an optional eyebrow (the
/// module family), the title, an optional one-line explanation, and the
/// actions that belong to the page. Every list screen uses this through
/// `ModuleScaffold`, so opening customers and opening budgets feels like the
/// same product.
class PageHeader extends StatelessWidget {
  const PageHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.eyebrow,
    this.actions = const [],
    this.leading,
    this.dense = false,
  });

  final String title;
  final String? subtitle;
  final String? eyebrow;
  final List<Widget> actions;

  /// An optional widget shown before the title — a back button, for example.
  final Widget? leading;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final hasSubtitle = subtitle != null && subtitle!.trim().isNotEmpty;
    final hasEyebrow = eyebrow != null && eyebrow!.trim().isNotEmpty;

    final titleBlock = Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        if (leading != null) ...[
          leading!,
          const SizedBox(width: AppSpacing.md),
        ],
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (hasEyebrow)
                Padding(
                  padding: const EdgeInsets.only(bottom: 3),
                  child: Text(
                    eyebrow!.toUpperCase(),
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                      letterSpacing: 1.1,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              Text(
                title,
                // The page's own name wraps rather than elides: at the
                // largest text size a long Arabic title must not become
                // "...".
                softWrap: true,
                style:
                    (dense
                            ? theme.textTheme.titleLarge
                            : theme.textTheme.headlineSmall)
                        ?.copyWith(
                          color: scheme.onSurface,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.2,
                        ),
              ),
              if (hasSubtitle)
                Padding(
                  padding: const EdgeInsets.only(top: 3),
                  child: Text(
                    subtitle!,
                    softWrap: true,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );

    final actionWrap = Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: actions,
    );

    return Container(
      color: scheme.surface,
      padding: EdgeInsets.fromLTRB(
        AppSpacing.xxl,
        dense ? AppSpacing.md : AppSpacing.lg,
        AppSpacing.xxl,
        dense ? AppSpacing.md : AppSpacing.lg,
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          // A toolbar of search plus several buttons cannot share one line on
          // a narrow window without clipping; it moves under the title there.
          if (actions.isEmpty) return titleBlock;
          if (constraints.maxWidth >= 1000) {
            return Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(child: titleBlock),
                const SizedBox(width: AppSpacing.lg),
                Flexible(child: actionWrap),
              ],
            );
          }
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              titleBlock,
              const SizedBox(height: AppSpacing.md),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: actionWrap,
              ),
            ],
          );
        },
      ),
    );
  }
}

/// A quiet breadcrumb. Only rendered when a screen actually knows its trail;
/// inventing one on every page would add noise without adding orientation.
class PageBreadcrumb extends StatelessWidget {
  const PageBreadcrumb({super.key, required this.items});

  final List<String> items;

  @override
  Widget build(BuildContext context) {
    if (items.length < 2) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final rtl = Directionality.of(context) == TextDirection.rtl;
    final children = <Widget>[];
    for (var index = 0; index < items.length; index += 1) {
      final isLast = index == items.length - 1;
      if (index > 0) {
        children.add(
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: Icon(
              rtl ? Icons.chevron_left : Icons.chevron_right,
              size: 14,
              color: AppColors.textDisabled,
            ),
          ),
        );
      }
      children.add(
        Flexible(
          child: Text(
            items[index],
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodySmall?.copyWith(
              color: isLast ? AppColors.textPrimary : AppColors.textSecondary,
              fontWeight: isLast ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
        ),
      );
    }
    return Row(mainAxisSize: MainAxisSize.min, children: children);
  }
}

/// The toolbar strip under a header: search on one side, filters and actions
/// on the other. Reused by list screens so the controls always sit on the
/// same line at the same height.
class PageToolbar extends StatelessWidget {
  const PageToolbar({
    super.key,
    this.leading,
    this.trailing,
    this.padding = const EdgeInsets.fromLTRB(
      AppSpacing.xxl,
      AppSpacing.sm,
      AppSpacing.xxl,
      AppSpacing.md,
    ),
  });

  final Widget? leading;
  final Widget? trailing;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Theme.of(context).colorScheme.surface,
      padding: padding,
      child: Row(
        children: [
          if (leading != null) Flexible(child: leading!),
          const Spacer(),
          if (trailing != null) ...[
            const SizedBox(width: AppSpacing.md),
            trailing!,
          ],
        ],
      ),
    );
  }
}
