/// The web build's answer to "start the server for me": it cannot be done.
///
/// A page in a browser cannot start a process, and it does not need to: the
/// server that delivered the page is already there. This stub therefore
/// reports `unsupported`, and the program goes straight to its normal screens.
library;

/// The outcome of asking a build to start its own server.
class LocalBackendStatus {
  const LocalBackendStatus.unsupported();

  final String? baseUrl = null;
  final String? problem = null;
  final String? logPath = null;
  final bool databaseProblem = false;

  /// A browser build never starts a server, so it never meets an empty database
  /// either - the pages it loads come from a server that is already set up.
  final bool needsFirstAdministrator = false;

  /// A browser build is never the one that starts a server, so it is never
  /// "ready" either - the program treats this as "carry on as you were".
  bool get isReady => false;
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
  }) async =>
      const LocalBackendStatus.unsupported();
}
