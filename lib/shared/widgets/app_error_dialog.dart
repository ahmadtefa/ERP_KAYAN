import 'package:flutter/material.dart';

import '../../app/theme/design_tokens.dart';
import '../../core/error/app_error_text.dart';
import '../../core/logging/app_logger.dart';
import '../../l10n/generated/app_localizations.dart';
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
///  * never auto-dismisses — only "حسنًا" (or a tap outside / the back
///    gesture, both of which are the user's own choice) closes it;
///  * never stacks: a second error arriving while one is open is dropped
///    and logged, so the person is not asked to dismiss five identical
///    dialogs after a retry storm;
///  * never shows a stack trace, an SQL fragment or a field name from the
///    API — [AppErrorMessageResolver] decides the wording;
///  * reads right-to-left in the Arabic interface, because the whole app is
///    wrapped in a [Directionality] by the localisation delegates.
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
    final l10n = context.l10n;
    final isWarning = severity == AppErrorSeverity.warning;
    final accent = isWarning ? AppColors.warning : theme.colorScheme.error;
    final soft = isWarning ? AppColors.warningSoft : AppColors.errorSoft;

    return AlertDialog(
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
    );
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

/// True while an error dialog is on screen.
///
/// A single flag for the whole app on purpose: two errors arriving together
/// (a save failing and its list reload failing, say) must not put two
/// dialogs on top of each other.
bool _errorDialogVisible = false;

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
  if (Navigator.maybeOf(context, rootNavigator: true) == null) return;
  if (_errorDialogVisible) {
    // Dropping it is deliberate: the person is already looking at an
    // explanation, and a queue of identical dialogs is worse than one.
    _log.warning('A second error arrived while the dialog was open; dropped');
    return;
  }

  final isArabic = Localizations.localeOf(context).languageCode == 'ar';
  final resolved = AppErrorMessageResolver(
    isArabic: isArabic,
  ).resolve(error, statusCode: statusCode);
  final business = resolved.businessMessage;
  final message = business != null && business.trim().isNotEmpty
      ? business
      : defaultErrorMessage(context.l10n, resolved.reason);

  _errorDialogVisible = true;
  try {
    await showDialog<void>(
      context: context,
      // A tap outside or the back gesture closes it — both are the user's
      // decision. Nothing closes it on a timer.
      barrierDismissible: true,
      useRootNavigator: true,
      builder: (_) =>
          AppErrorDialog(message: message, severity: resolved.severity),
    );
  } finally {
    _errorDialogVisible = false;
  }
}

/// Convenience for the many call sites that already hold a message string.
Future<void> showAppErrorMessage(BuildContext context, String message) =>
    showAppError(context, message);

final _log = AppLogger.of('AppErrorDialog');
