import 'package:flutter/material.dart';

import '../../app/theme/design_tokens.dart';
import '../../core/error/app_error_text.dart';
import '../../l10n/generated/app_localizations.dart';
import '../../l10n/generated/app_localizations_ar.dart';
import '../extensions/l10n_extension.dart';

/// The one place a system error is shown.
///
/// Errors used to arrive as a SnackBar at the bottom of the screen: it slid
/// away after four seconds, it could be queued behind a success message, and
/// it showed whatever the server had written — including sentences meant for
/// a programmer, such as `property type should not exist`. This dialog is
/// centred, waits for the person to close it, and speaks about the problem
/// in their language.
///
/// Rules it enforces:
///  * never auto-dismisses — the person must acknowledge it with "حسنًا";
///  * never stacks: errors for one navigator wait for the preceding dialog
///    to be acknowledged instead of silently losing a different failure;
///  * uses [AppErrorMessageResolver] to withhold known technical patterns and
///    server-error bodies; this is not a complete sensitive-data classifier;
///  * uses Arabic and right-to-left direction even if the surrounding screen
///    is in another language, as required for central error dialogs.
class AppErrorDialog extends StatelessWidget {
  const AppErrorDialog({
    super.key,
    required this.message,
    required this.severity,
  });

  final String message;
  final AppErrorSeverity severity;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizationsAr();
    final isWarning = severity == AppErrorSeverity.warning;
    final accent = isWarning ? AppColors.warning : theme.colorScheme.error;
    final soft = isWarning ? AppColors.warningSoft : AppColors.errorSoft;

    return Directionality(
      textDirection: TextDirection.rtl,
      child: AlertDialog(
      // The title and the action sit at the start edge, which is the right
      // edge under RTL.
      titlePadding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.lg,
        AppSpacing.lg,
        0,
      ),
      contentPadding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.sm,
      ),
      actionsPadding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        0,
        AppSpacing.md,
        AppSpacing.md,
      ),
      title: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: soft,
              borderRadius: BorderRadius.circular(AppRadii.lg),
            ),
            child: Icon(
              isWarning
                  ? Icons.warning_amber_rounded
                  : Icons.error_outline_rounded,
              color: accent,
              size: 22,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Padding(
              padding: const EdgeInsetsDirectional.only(top: 6),
              child: Text(
                isWarning ? l10n.warningDialogTitle : l10n.errorDialogTitle,
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: theme.colorScheme.onSurface,
                ),
              ),
            ),
          ),
        ],
      ),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Text(
          message,
          // Start alignment follows the ambient direction: right in Arabic,
          // left in English, without hard-coding either.
          textAlign: TextAlign.start,
          style: theme.textTheme.bodyMedium?.copyWith(
            height: 1.6,
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ),
      actions: [
        FilledButton(
          autofocus: true,
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.okAction),
        ),
      ],
    ));
  }
}

/// The default sentence for a reason when the server said nothing worth
/// keeping.
///
/// Exposed so inline failure views can say the same thing as the dialog
/// instead of inventing their own wording.
String defaultErrorMessage(AppLocalizations l10n, AppErrorReason reason) {
  switch (reason) {
    case AppErrorReason.network:
      return l10n.networkError;
    case AppErrorReason.sessionExpired:
      return l10n.sessionExpired;
    case AppErrorReason.permission:
      return l10n.errorPermissionBody;
    case AppErrorReason.notFound:
      return l10n.errorNotFoundBody;
    case AppErrorReason.conflict:
      return l10n.errorConflictBody;
    case AppErrorReason.invalidInput:
      return l10n.errorInvalidInputBody;
    case AppErrorReason.server:
      return l10n.errorServerBody;
    case AppErrorReason.unknown:
      return l10n.errorGenericBody;
  }
}

/// Turns any error into the sentence the interface should show, without
/// displaying it.
///
/// Used by inline views (a page whose list could not load) and by
/// [describeError]; action failures go through [showAppError] instead.
String presentErrorText(
  BuildContext context,
  Object? error, {
  int? statusCode,
}) {
  final isArabic = Localizations.localeOf(context).languageCode == 'ar';
  final text = AppErrorMessageResolver(
    isArabic: isArabic,
  ).resolve(error, statusCode: statusCode);
  final business = text.businessMessage;
  if (business != null && business.trim().isNotEmpty) return business;
  return defaultErrorMessage(context.l10n, text.reason);
}

/// Serialize dialogs per navigator. An Expando does not keep a disposed
/// navigator alive and a replacement navigator has its own independent queue.
final Expando<Future<void>> _errorDialogTails = Expando<Future<void>>();

/// Opens the central error dialog for [error].
///
/// [error] may be a `Failure`, a message from a repository, or the object a
/// `catch` captured. [statusCode] is only needed when the caller already
/// knows it and the error does not carry it.
Future<void> showAppError(
  BuildContext context,
  Object? error, {
  int? statusCode,
}) async {
  if (!context.mounted) return;
  // Nowhere to show it (a screen that is being torn down). Dropping it is
  // better than an exception inside an error handler.
  final navigator = Navigator.maybeOf(context, rootNavigator: true);
  if (navigator == null) return;
  final resolved = const AppErrorMessageResolver(
    isArabic: true,
  ).resolve(error, statusCode: statusCode);
  final business = resolved.businessMessage;
  final message = business != null && business.trim().isNotEmpty
      ? business
      : defaultErrorMessage(AppLocalizationsAr(), resolved.reason);

  final previous = _errorDialogTails[navigator];
  final ready = previous == null
      ? Future<void>.value()
      // The previous caller still receives its error; do not poison the queue.
      : previous.then<void>((_) {}, onError: (Object _, StackTrace _) {});
  final next = ready.then<void>((_) async {
    if (!navigator.mounted) return;
    await showDialog<void>(
      context: navigator.context,
      barrierDismissible: false,
      useRootNavigator: true,
      builder: (_) => PopScope(
        canPop: false,
        child: AppErrorDialog(message: message, severity: resolved.severity),
      ),
    );
  });
  _errorDialogTails[navigator] = next;
  try {
    await next;
  } finally {
    if (identical(_errorDialogTails[navigator], next)) {
      _errorDialogTails[navigator] = null;
    }
  }
}

/// Convenience for the many call sites that already hold a message string.
///
/// The sentence still goes through the resolver, which may reword or replace
/// it: use this for a server or exception message, not for wording the screen
/// wrote itself.
Future<void> showAppErrorMessage(BuildContext context, String message) =>
    showAppError(context, message);

/// Shows a sentence the screen wrote itself, exactly as written.
///
/// [showAppError] runs every message through the resolver. That resolver is
/// Arabic-first by design, so an English sentence the screen composed on
/// purpose - "This branch has no warehouse defined." - was classified as
/// untrusted and replaced with the generic fallback, and the user never learnt
/// what was actually missing. A message this code wrote is not a diagnostic:
/// there is nothing in it to sanitise.
Future<void> showAppPlainError(BuildContext context, String message) async {
  if (!context.mounted) return;
  final navigator = Navigator.maybeOf(context, rootNavigator: true);
  if (navigator == null) return;
  final previous = _errorDialogTails[navigator];
  final ready = previous == null
      ? Future<void>.value()
      : previous.then<void>((_) {}, onError: (Object _, StackTrace _) {});
  final next = ready.then<void>((_) async {
    if (!navigator.mounted) return;
    await showDialog<void>(
      context: navigator.context,
      barrierDismissible: false,
      useRootNavigator: true,
      builder: (_) => PopScope(
        canPop: false,
        child: AppErrorDialog(
          message: message,
          severity: AppErrorSeverity.warning,
        ),
      ),
    );
  });
  _errorDialogTails[navigator] = next;
  try {
    await next;
  } finally {
    if (identical(_errorDialogTails[navigator], next)) {
      _errorDialogTails[navigator] = null;
    }
  }
}
