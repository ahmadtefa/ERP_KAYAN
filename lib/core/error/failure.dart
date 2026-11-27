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
  const ApiFailure(
    super.message, {
    this.statusCode,
    this.code,
    this.fieldErrors = const {},
    this.creditSummary,
    this.userAction,
    this.requestId,
    this.errorField,
    this.params = const {},
    super.cause,
  });

  final int? statusCode;

  /// A validated, non-secret machine-readable reason from the server.
  final String? code;
  final Map<String, String> fieldErrors;
  final CreditSummary? creditSummary;
  final String? userAction;
  final String? requestId;

  /// The input a refusal is about (a plain identifier from the server).
  final String? errorField;

  /// Short plain values the reviewed sentence names (a line number, a unit
  /// name). Filled into `{name}` places; the server text is never shown.
  final Map<String, String> params;
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
  const SessionExpiredFailure([
    super.message = 'Session expired',
    Object? cause,
  ]) : super(cause: cause);
}

/// The account is valid but not allowed to do this. Showing "invalid
/// credentials" here would make a permission problem look like a wrong
/// password and send people to reset a password that is perfectly good.
class PermissionFailure extends Failure {
  const PermissionFailure([
    super.message = 'Permission denied',
    Object? cause,
    this.code,
    this.params = const {},
  ]) : super(cause: cause);

  /// The reviewed refusal code the server sent, when it sent one, so the app
  /// can explain which permission is missing instead of a generic refusal.
  final String? code;
  final Map<String, String> params;
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
  // The underlying FormatException is logged by the repository, where it is
  // useful; it is deliberately not carried here.
  const IncompleteSignInFailure([
    super.message = 'The sign-in answer is incomplete',
  ]);
}

/// Input validation failed before any network call was attempted.
///
/// Client-side validation is a UX convenience; the server must enforce the
/// same rules independently.
class ValidationFailure extends Failure {
  const ValidationFailure(super.message, {super.cause});
}

/// The server supplies this only when its customer-card disclosure rule allows.
/// Decimal strings preserve accounting precision and never parse English text.
class CreditSummary {
  const CreditSummary({required this.creditLimit, required this.currentBalance,
    required this.invoiceAmount, required this.projectedBalance});
  final String creditLimit;
  final String currentBalance;
  final String invoiceAmount;
  final String projectedBalance;
  static CreditSummary? fromProblem(Object? value, String? code) {
    if (code != 'CUSTOMER_CREDIT_LIMIT_EXCEEDED' || value is! Map) return null;
    const keys = ['creditLimit', 'currentBalance', 'invoiceAmount', 'projectedBalance'];
    final decimal = RegExp(r'^-?\d{1,15}(\.\d{1,4})?$');
    if (!keys.every((key) => value[key] is String && decimal.hasMatch(value[key] as String))) return null;
    return CreditSummary(creditLimit: value['creditLimit'] as String,
      currentBalance: value['currentBalance'] as String,
      invoiceAmount: value['invoiceAmount'] as String,
      projectedBalance: value['projectedBalance'] as String);
  }
}
