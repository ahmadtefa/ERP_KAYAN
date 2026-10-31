/// The web build's answer to "start the server for me": it cannot be done.
///
/// A page in a browser cannot start a process, and it does not need to: the
/// server that delivered the page is already there. This stub therefore
/// reports `unsupported`, and the program goes straight to its normal screens.
library;

import 'company_setup_data.dart';

/// The outcome of asking a build to start its own server.
///
/// Structurally identical to the desktop implementation's class - same
/// constructors, same fields - because code above this layer (the gate,
/// its tests) is written once against this type and is analyzed against
/// whichever variant the current target resolves. Only the behaviour
/// differs: on the web [LocalBackend] only ever returns
/// [LocalBackendStatus.unsupported].
class LocalBackendStatus {
  const LocalBackendStatus.unsupported()
    : baseUrl = null,
      problem = null,
      logPath = null,
      databaseProblem = false,
      needsFirstAdministrator = false,
      licenceWarning = null;
  const LocalBackendStatus.ready(this.baseUrl, {this.licenceWarning})
    : problem = null,
      logPath = null,
      databaseProblem = false,
      needsFirstAdministrator = false;
  const LocalBackendStatus.failed(
    this.problem, {
    this.logPath,
    this.databaseProblem = false,
  }) : baseUrl = null,
       needsFirstAdministrator = false,
       licenceWarning = null;

  /// Present for shape parity with the desktop class. A browser build
  /// never starts a server, so it never meets an empty database either -
  /// the pages it loads come from a server that is already set up.
  const LocalBackendStatus.needsFirstAdministrator()
    : baseUrl = null,
      problem = null,
      logPath = null,
      databaseProblem = false,
      needsFirstAdministrator = true,
      licenceWarning = null;

  /// e.g. `http://127.0.0.1:3000/api/v1` - already the value the client wants.
  final String? baseUrl;

  /// A sentence in the user's language explaining what went wrong.
  final String? problem;

  /// Where the server's own output was written, so a person can read it or
  /// send it on.
  final String? logPath;

  /// True when the server is running but cannot reach the database.
  final bool databaseProblem;

  /// True when this machine still needs its first administrator.
  final bool needsFirstAdministrator;

  /// Present for shape parity with the desktop class: a browser build never
  /// starts a server, so nothing here can be missing a licence key.
  final String? licenceWarning;

  bool get isReady => baseUrl != null;
}

/// Present so the two builds share one shape. On the web there is nothing to
/// start and nothing to stop.
class LocalBackend {
  static LocalBackend? get instance => null;

  static String get baseUrl => '';

  static Future<LocalBackendStatus> ensureRunning({
    required String appDisplayName,
  }) async =>
      const LocalBackendStatus.unsupported();

  static Future<void> shutdown() async {}

  /// Nothing to create on the web: the server that delivered this page is
  /// already somebody's running installation.
  static Future<LocalBackendStatus> createFirstAdministrator({
    required String username,
    required String password,
    required String appDisplayName,
    CompanySetupData? company,
  }) async =>
      const LocalBackendStatus.unsupported();
}
