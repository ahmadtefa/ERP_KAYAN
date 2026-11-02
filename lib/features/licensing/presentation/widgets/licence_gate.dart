import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../data/licence_data_source.dart';
import '../providers/licence_providers.dart';

/// Stands between a business screen and a licence that has stopped working.
///
/// The server is the authority: every business endpoint already answers 403
/// when the licence is expired, so this widget is not what protects the books.
/// It is what stops the program from looking broken - a dozen screens failing
/// one by one - and puts the explanation and the key entry in their place.
///
/// Three rules:
///  * only a server that says `blocked: true` blocks anything; an unreachable
///    server never does;
///  * the licence screen, the backup screen and settings stay reachable, so an
///    expired licence can never make the data unsaveable;
///  * the block is a widget, not a redirect, so signing out and back in still
///    lands where the person was.
class LicenceGate extends ConsumerWidget {
  const LicenceGate({
    super.key,
    required this.currentPath,
    required this.child,
  });

  final String currentPath;
  final Widget child;

  /// Screens that must keep working while the licence is expired.
  static const alwaysOpen = <String>{
    AppRoutes.licence,
    AppRoutes.settings,
    AppRoutes.backup,
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (alwaysOpen.contains(currentPath)) return child;

    final status = ref.watch(licenceStatusProvider).value;
    if (status == null || !status.blocked) return child;

    return _BlockedView(status: status);
  }
}

class _BlockedView extends StatelessWidget {
  const _BlockedView({required this.status});

  final LicenceStatus status;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final suspended = status.state == 'SUSPENDED';
    // A missing or invalid verification key is not an expiry: no renewal key
    // can be applied until the approved key is back, and the reason has to say
    // so. The server still refuses every business route on its own.
    final keyMissing = !status.configured;

    return SingleChildScrollView(
      padding: AppSpacing.pagePadding,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 720),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: AppSpacing.xxl),
              Icon(
                keyMissing
                    ? Icons.key_off_outlined
                    : (suspended ? Icons.access_time : Icons.lock_clock),
                size: 56,
                color: theme.colorScheme.error,
              ),
              const SizedBox(height: AppSpacing.lg),
              Text(
                keyMissing
                    ? l10n.licenceKeyMissingTitle
                    : l10n.licenceBlockedTitle,
                textAlign: TextAlign.center,
                style: theme.textTheme.headlineSmall,
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                keyMissing
                    ? l10n.licenceKeyMissingBody
                    : (suspended
                          ? l10n.licenceSuspendedBody
                          : l10n.licenceBlockedBody),
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyLarge,
              ),
              const SizedBox(height: AppSpacing.xl),
              FilledButton.icon(
                onPressed: () => context.go(AppRoutes.licence),
                icon: const Icon(Icons.vpn_key_outlined),
                label: Text(l10n.licenceOpenLicence),
              ),
              const SizedBox(height: AppSpacing.md),
              OutlinedButton.icon(
                onPressed: () => context.go(AppRoutes.backup),
                icon: const Icon(Icons.backup_outlined),
                label: Text(l10n.licenceOpenBackup),
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                l10n.licenceBackupStillAvailable,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
