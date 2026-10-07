/// Base class for all recoverable, user-presentable failures.
///
/// Failures are values, not control-flow accidents: repositories return them
/// inside a `Result`, so every caller must acknowledge the error path.
sealed class Failure implements Exception {
  const Failure(this.message, {this.cause});

  /// A human-readable, non-technical description. May be localised by the
  /// presentation layer using the failure type as a key.
  final String message;

  /// The underlying error, retained for diagnostics. Never shown to users
  /// and never logged when it may contain financial or personal data.
  final Object? cause;

  @override
  String toString() => '$runtimeType: $message';
}

/// The device could not reach the server (offline, DNS, TLS, timeout).
class NetworkFailure extends Failure {
  const NetworkFailure([super.message = 'Network unavailable', Object? cause])
      : super(cause: cause);
}

/// The server rejected the request (4xx) with a business-level reason.
class ApiFailure extends Failure {
  const ApiFailure(super.message, {this.statusCode, super.cause});

  final int? statusCode;
}

/// Authentication is missing, expired or rejected.
class AuthFailure extends Failure {
  const AuthFailure([super.message = 'Unauthorized', Object? cause])
      : super(cause: cause);
}

/// The server failed (5xx) or returned a malformed payload.
class ServerFailure extends Failure {
  const ServerFailure([super.message = 'Server error', Object? cause])
      : super(cause: cause);
}

/// Input validation failed before any network call was attempted.
///
/// Client-side validation is a UX convenience; the server must enforce the
/// same rules independently.
class ValidationFailure extends Failure {
  const ValidationFailure(super.message, {super.cause});
}
