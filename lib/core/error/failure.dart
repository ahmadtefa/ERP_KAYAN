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

/// The session is over: the server refused the access token and the refresh
/// token was refused too, so only a new sign-in can help. Separate from
/// [AuthFailure] because a failed sign-in shows "invalid credentials" while
/// this must say that the session ended and nothing was lost.
class SessionExpiredFailure extends Failure {
  const SessionExpiredFailure([super.message = 'Session expired', Object? cause])
    : super(cause: cause);
}

/// The account is valid but not allowed to do this. Showing "invalid
/// credentials" here would make a permission problem look like a wrong
/// password and send people to reset a password that is perfectly good.
class PermissionFailure extends Failure {
  const PermissionFailure([super.message = 'Permission denied', Object? cause])
    : super(cause: cause);
}

/// The server failed (5xx) or returned a malformed payload.
class ServerFailure extends Failure {
  const ServerFailure([super.message = 'Server error', Object? cause])
    : super(cause: cause);
}

/// The server accepted the sign-in and issued a session, but the account
/// details in its answer could not be read - typically a version mismatch
/// between the program and the API, or a company that was never finished
/// setting up. Distinct from [ServerFailure] so the screen can say what to
/// check instead of "an unexpected error occurred".
class IncompleteSignInFailure extends Failure {
  const IncompleteSignInFailure([
    // `cause` has to travel through an explicit super call, so this cannot be
    // a super parameter.
    // ignore: use_super_parameters
    String message = 'The sign-in answer is incomplete',
    Object? cause,
  ]) : super(message, cause: cause);
}

/// Input validation failed before any network call was attempted.
///
/// Client-side validation is a UX convenience; the server must enforce the
/// same rules independently.
class ValidationFailure extends Failure {
  const ValidationFailure(super.message, {super.cause});
}
