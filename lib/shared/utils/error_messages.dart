import 'package:flutter/widgets.dart';

import '../../core/error/failure.dart';
import '../extensions/l10n_extension.dart';

/// Maps a failure into a localized, user-safe message.
///
/// Raw exception text is never shown to end users: it can leak server
/// internals and is not translatable.
String localizedError(BuildContext context, Object error) {
  final l10n = context.l10n;
  return switch (error) {
    AuthFailure() => l10n.invalidCredentials,
    NetworkFailure() => l10n.networkError,
    ApiFailure(:final message) when message.isNotEmpty => message,
    _ => l10n.unexpectedError,
  };
}
