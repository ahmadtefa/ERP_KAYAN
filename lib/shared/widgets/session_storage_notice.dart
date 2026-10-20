import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme/design_tokens.dart';
import '../../features/auth/presentation/providers/auth_providers.dart';
import '../extensions/l10n_extension.dart';

/// Says, once and quietly, that this window's session will not survive a
/// reload because the platform refused to store the tokens - a browser on a
/// plain `http://` network address is the usual reason. Without the line the
/// person is signed out by the next reload and has no idea why.
class SessionStorageNotice extends ConsumerWidget {
  const SessionStorageNotice({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(volatileSessionProvider)) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final l10n = context.l10n;
    return Container(
      width: double.infinity,
      color: AppColors.warningSoft,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.sm,
      ),
      child: Row(
        children: [
          const Icon(Icons.info_outline, size: 18, color: AppColors.warning),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              l10n.sessionNotPersisted,
              style: theme.textTheme.bodySmall?.copyWith(
                color: const Color(0xFF7A4E06),
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
