import 'package:flutter/widgets.dart';

import '../../core/error/failure.dart';
import '../extensions/l10n_extension.dart';
import '../widgets/app_error_dialog.dart';

/// Maps a failure into a localized, user-safe message.
///
/// Raw exception text is never shown to end users: it can leak server
/// internals and is not translatable.
String localizedError(BuildContext context, Object error) {
  final l10n = context.l10n;
  return switch (error) {
    SessionExpiredFailure() => l10n.sessionExpired,
    PermissionFailure() => l10n.permissionDenied,
    AuthFailure() => l10n.invalidCredentials,
    NetworkFailure() => l10n.networkError,
    IncompleteSignInFailure() => l10n.signInIncomplete,
    // A server sentence is only kept when it says something a person can
    // act on; a validation message about a DTO field is replaced by the
    // explanation the central dialog uses, so the sign-in form cannot show
    // `property type should not exist` either.
    ApiFailure(:final message, :final statusCode) when message.isNotEmpty =>
      presentErrorText(context, message, statusCode: statusCode),
    _ => l10n.unexpectedError,
  };
}
