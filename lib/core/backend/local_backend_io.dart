/// Starts, watches and stops the API server that belongs to a desktop copy of
/// the program.
///
/// The whole point is that a person who installs the program never sees a
/// terminal: the shell starts the server as a private child process, waits
/// until it answers, and stops it when the window closes.
///
/// This file is the real implementation and is compiled for Windows, Linux and
/// macOS. The web build cannot own a process, so it gets the stub next to this
/// file - see local_backend.dart for how the choice is made.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'company_setup_data.dart';

/// What the shell needs to know after a start attempt.
class LocalBackendStatus {
  const LocalBackendStatus.unsupported()
    : baseUrl = null,
      problem = null,
      logPath = null,
      databaseProblem = false,
      needsFirstAdministrator = false;
  const LocalBackendStatus.ready(this.baseUrl)
    : problem = null,
      logPath = null,
      databaseProblem = false,
      needsFirstAdministrator = false;
  const LocalBackendStatus.failed(
    this.problem, {
    this.logPath,
    this.databaseProblem = false,
  }) : baseUrl = null,
       needsFirstAdministrator = false;

  /// The database answered and is up to date, but has no company and no user in
  /// it yet - a machine where the program has never been set up. Nothing is
  /// wrong: somebody has to say who the first administrator is, and that is a
  /// question for the screen, not for a log file.
  const LocalBackendStatus.needsFirstAdministrator()
    : baseUrl = null,
      problem = null,
      logPath = null,
      databaseProblem = false,
      needsFirstAdministrator = true;

  /// e.g. `http://127.0.0.1:3000/api/v1` - already the value the client wants.
  final String? baseUrl;

  /// A sentence in the user's language explaining what went wrong.
  final String? problem;

  /// Where the server's own output was written, so a person can read it or
  /// send it on.
  final String? logPath;

  /// True when the server is running but cannot reach the database, which is
  /// the one failure with an obvious fix worth spelling out.
  final bool databaseProblem;

  /// True when this machine still needs its first administrator - see
  /// [LocalBackendStatus.needsFirstAdministrator].
  final bool needsFirstAdministrator;

  bool get isReady => baseUrl != null;
}

class KayanDatabaseConfig {
  const KayanDatabaseConfig._();

  /// The port the Windows installer gives the bundled PostgreSQL service.
  ///
  /// It used to be 5433 here, the port of the older development cluster the
  /// scripts create. That made a copy of the program with no readable settings
  /// file look for a database that the shipped installer never uses - and, on
  /// a computer that still had the old cluster, quietly find the previous
  /// company in it.
  static const String host = '127.0.0.1';
  static const int port = 5432;
  static const String databaseName = 'erp_kayan';
  static const String username = 'erp_app';
  static const String adminUsername = 'postgres';
  static const String adminDatabaseName = 'postgres';

  /// A company database this product creates: the original `erp_kayan`, or the
  /// one a new company or a reset gets, `erp_kayan_<yyyyMMddHHmmss>`. Anything
  /// else on the same server belongs to somebody else.
  static final RegExp companyDatabaseName = RegExp(
    r'^erp_kayan(?:_\d{14})?$',
  );

  static bool isLocalDatabaseUrl(String? url) {
    if (url == null || url.isEmpty) return false;
    final uri = Uri.tryParse(url);
    if (uri == null) return false;
    if (uri.host != host || uri.port != port) return false;
    if (uri.pathSegments.isEmpty) return false;
    final name = uri.pathSegments.first;
    // The role is checked too: a database of the same name owned by another
    // login is not this installation's.
    final user = uri.userInfo.split(':').first;
    return user == username && companyDatabaseName.hasMatch(name);
  }

  /// The database a connection string names, or null when there is not one.
  ///
  /// The desktop shell uses it to prove the server it reached is read-ing the
  /// database its own settings name - see `_verifyServerIdentity`.
  static String? databaseNameFromUrl(String? url) {
    if (url == null || url.isEmpty) return null;
    final uri = Uri.tryParse(url);
    if (uri == null || uri.pathSegments.isEmpty) return null;
    final name = uri.pathSegments.first;
    return name.isEmpty ? null : name;
  }

  static String buildDatabaseUrl({
    required String username,
    required String password,
    String host = host,
    int portNumber = port,
    String database = databaseName,
  }) {
    final safeUsername = Uri.encodeComponent(username);
    final safePassword = Uri.encodeComponent(password);
    return 'postgresql://$safeUsername:$safePassword@$host:$portNumber/$database?schema=public';
  }

  static String buildAdminDatabaseUrl({
    required String password,
    String host = host,
    int portNumber = port,
    String database = adminDatabaseName,
  }) =>
      'postgresql://$adminUsername:${Uri.encodeComponent(password)}@$host:$portNumber/$database';

  static String startupFailureMessage({
    required bool serviceExists,
    required bool authenticationOk,
    String? settingsPath,
    String? errorCode,
  }) {
    if (!serviceExists) {
      return 'PostgreSQL is not running on $host:$port. Start the configured PostgreSQL service before starting the app.';
    }
    if (!authenticationOk) {
      final code = errorCode == null ? '' : ' ($errorCode)';
      final path = settingsPath ?? 'the desktop settings file';
      return 'PostgreSQL rejected the saved credentials$code. Check '
          'DATABASE_URL and ADMIN_DATABASE_URL in $path, then restart the app.';
    }
    return 'PostgreSQL is not reachable on $host:$port.';
  }
}

/// The temporary logo file for the current preparation call, if any. Written
/// just before the child process runs and cleared right after.
File? _logoFile;

/// A running server, or the reason there is not one.
/// Whether an owned local server may remain alive solely for diagnostics.
/// Business operations remain guarded; the shell must not treat this as ready.
bool keepServerForLicenceDiagnostics(Map<String, dynamic>? health) {
  final licence = health?['license'];
  return health?['status'] == 'ok' &&
      health?['database'] == 'up' &&
      licence is Map &&
      licence['enforcement'] == 'enforce' &&
      licence['stateError'] == 'LICENSE_STATE_DAMAGED';
}

class LocalBackend {
  LocalBackend._(this._process, this.port, this._log, [this._diagnosticOnly = false]);

  final Process? _process;
  final int port;
  final IOSink? _log;
  bool _diagnosticOnly;

  static LocalBackend? _instance;
  static Future<LocalBackendStatus>? _starting;
  static Process? _stoppingProcess;
  // A timed-out migration may still be running. Do not launch a second one
  // in this process or terminate it mid-migration.
  static Future<ProcessResult>? _preparationInFlight;
  static const _preparationPendingMessage =
      'تهيئة قاعدة البيانات ما زالت تعمل. لا تغلق البرنامج وانتظر قبل إعادة المحاولة. / '
      'Database preparation is still running. Keep this window open and retry later.';

  /// The server this copy of the program started, if it started one.
  static LocalBackend? get instance => _instance;

  /// The address the client should talk to.
  String get baseUrl => 'http://127.0.0.1:$port/api/v1';

  /// Ports tried in order. 3000 first, so a desktop copy and a development
  /// server are the same address unless something else already holds it.
  static const List<int> candidatePorts = [3000, 3001, 3002, 3003, 3010, 3020];

  /// How long to wait for the server to answer before giving up.
  static const Duration startupTimeout = Duration(seconds: 90);

  // ─────────────────────────────────────────────────────────── bringing it up

  /// Makes sure an API is reachable, starting one if necessary.
  ///
  /// Returns a ready status when the address answers, and a failed one with a
  /// readable reason otherwise. It never throws: a failure here is a message
  /// on a screen, not a crash.
  static Future<LocalBackendStatus> ensureRunning({
    required String appDisplayName,
  }) {
    return _starting ??= _startOnce(appDisplayName);
  }

  static Future<LocalBackendStatus> _startOnce(String appDisplayName) async {
    try {
      return await _ensureRunning(appDisplayName);
    } on Object catch (error) {
      return LocalBackendStatus.failed('$error');
    } finally {
      _starting = null;
    }
  }

  static Future<LocalBackendStatus> _ensureRunning(
    String appDisplayName,
  ) async {
    if (_preparationInFlight != null) {
      return const LocalBackendStatus.failed(
        _preparationPendingMessage,
        databaseProblem: true,
      );
    }
    if (_stoppingProcess != null) {
      return const LocalBackendStatus.failed(
        'تعذّر إيقاف الخادم السابق. انتظر أو تواصل مع الدعم قبل إعادة المحاولة. / '
        'The previous server has not stopped. Wait or contact support before retrying.',
      );
    }
    // 1. Is a KAYAN API already answering? Then this copy does not need to
    //    start a second one, which is what keeps two windows of the program
    //    from fighting over the database.
    for (final port in candidatePorts) {
      if (await _isKayanApi(port)) {
        final health = await _health(port);
        if (health == null) {
          return LocalBackendStatus.failed(
            'تعذّر قراءة حالة الخادم. حاول مرة أخرى. / '
            'Could not read the server health status. Please retry.',
            logPath: BackendLayout.discover().logPath,
          );
        }
        final licenceProblem = _licenceStateProblem(health);
        if (licenceProblem != null) {
          return LocalBackendStatus.failed(
            licenceProblem,
            logPath: BackendLayout.discover().logPath,
          );
        }
        // A diagnostic-only child has never passed the full database and
        // licence identity checks. After recovery, validate it before either
        // opening the app or offering first-run setup against its database.
        final running = _instance;
        if (running != null && running.port == port && running._diagnosticOnly) {
          final layout = BackendLayout.discover();
          if (layout.problem != null) {
            return LocalBackendStatus.failed(layout.problem, logPath: layout.logPath);
          }
          final settingsProblem = missingInstalledSettings(layout);
          if (settingsProblem != null) {
            return LocalBackendStatus.failed(settingsProblem, logPath: layout.logPath);
          }
          final settings = await RuntimeSettings.load(layout, port);
          final identityProblem = _verifyServerIdentity(health, settings);
          if (identityProblem != null) {
            return LocalBackendStatus.failed(identityProblem, logPath: layout.logPath);
          }
          running._diagnosticOnly = false;
        }
        // A reachable API can still be attached to a completely empty
        // database. Check its health payload before treating it as ready.
        if (health['needsSetup'] == true) {
          return const LocalBackendStatus.needsFirstAdministrator();
        }

        // Retain the handle to the child so shutdown can stop it.
        if (running != null && running.port == port) {
          return LocalBackendStatus.ready(running.baseUrl);
        }
        // Someone else's copy - another window, or a development server. It is
        // used only if it is reading this installation's database and enforcing
        // the licence this installation requires: a second server started with
        // LICENSE_ENFORCEMENT=warn is otherwise a way round the licence.
        final layoutForCheck = BackendLayout.discover();
        if (layoutForCheck.problem == null) {
          final installedProblem = missingInstalledSettings(layoutForCheck);
          if (installedProblem != null) {
            return LocalBackendStatus.failed(
              installedProblem,
              logPath: layoutForCheck.logPath,
              databaseProblem: true,
            );
          }
          final settings = await RuntimeSettings.load(layoutForCheck, port);
          final problem = _verifyServerIdentity(health, settings);
          if (problem != null) {
            return LocalBackendStatus.failed(
              problem,
              logPath: layoutForCheck.logPath,
            );
          }
        }
        _instance = LocalBackend._(null, port, null);
        return LocalBackendStatus.ready(_instance!.baseUrl);
      }
    }

    final layout = BackendLayout.discover();
    final missing = layout.problem;
    if (missing != null) {
      return LocalBackendStatus.failed(missing);
    }

    final port = await _firstFreePort();
    if (port == null) {
      return LocalBackendStatus.failed(
        'Every port this program uses is already taken '
        '(${candidatePorts.join(', ')}).',
      );
    }

    final settingsProblem = missingInstalledSettings(layout);
    if (settingsProblem != null) {
      return LocalBackendStatus.failed(
        settingsProblem,
        logPath: layout.logPath,
        databaseProblem: true,
      );
    }

    final log = await layout.openLog();
    // Who is running what, at the top of every log: the first thing a person
    // needs when reading a log from another machine.
    log.writeln('[shell] program: ${Platform.resolvedExecutable}');
    log.writeln('[shell] node: ${layout.nodeExecutable}');
    log.writeln('[shell] server: ${layout.entryPoint}');
    final settings = await RuntimeSettings.load(layout, port);

    // Packaged Windows installs ship a local PostgreSQL service. The service
    // manager's Running state does not mean PostgreSQL accepts connections yet;
    // wait on its own readiness utility before asking Prisma to migrate.
    final databaseReady = await _waitForBundledPostgres(layout, settings, log);
    if (!databaseReady) {
      await log.flush();
      await log.close();
      return LocalBackendStatus.failed(
        'The local database is not ready. Start KAYAN PostgreSQL and try again.',
        logPath: layout.logPath,
        databaseProblem: true,
      );
    }

    // 2. Prepare the database first. On a machine that has never run the
    //    program this creates the database and applies the schema; on any
    //    other machine it is a couple of seconds of checking.
    //
    //    It also says whether the database is still empty. If it is, this
    //    machine has no company and no user in it yet, and there is nothing to
    //    start a server for until somebody says who the first administrator is.
    final preparation = await _runPreparation(layout, settings, log);
    if (preparation != null && preparation.exitCode != 0) {
      await log.flush();
      await log.close();
      final authenticationProblem = _isDatabaseAuthenticationFailure(
        preparation.output,
      );
      return LocalBackendStatus.failed(
        authenticationProblem
            ? KayanDatabaseConfig.startupFailureMessage(
                serviceExists: true,
                authenticationOk: false,
                settingsPath: layout.settingsFile.path,
                errorCode: 'Prisma P1000',
              )
            : preparation.output.contains(_preparationPendingMessage)
            ? _preparationPendingMessage
            : 'Database preparation failed. See the backend log for details.',
        logPath: layout.logPath,
        databaseProblem: true,
      );
    }
    if (preparation?.state == 'empty' ||
        preparation?.state == 'incomplete') {
      // 'incomplete' = a company or users exist without the other (a
      // first setup interrupted halfway). The remedy is the same screen:
      // completing first-run setup upserts what is missing and touches
      // nothing that is already there.
      log.writeln(
        preparation?.state == 'incomplete'
            ? '[shell] the database is partly set up: asking who the '
                  'first administrator is so setup can be completed'
            : '[shell] the database is empty: asking who the first '
                  'administrator is',
      );
      await log.flush();
      await log.close();
      return const LocalBackendStatus.needsFirstAdministrator();
    }
    if (preparation?.state == 'unknown') {
      // The preparation could not determine the state (typically the
      // database did not answer its count query). That is never read as
      // "empty" - a failed question must not invite first-run setup over
      // somebody's data. Start the server and let its own precise error
      // be the one the user sees.
      log.writeln(
        '[shell] WARNING: database state is unknown; starting the server '
        'so the real error can surface',
      );
    }

    // 3. Start the server and wait until it answers.
    final process = await _spawn(layout, settings, log, port);
    if (process == null) {
      await log.flush();
      await log.close();
      return LocalBackendStatus.failed(
        'The server would not start.',
        logPath: layout.logPath,
      );
    }

    final ready = await _waitForHealth(process, port, log);
    if (ready) {
      final health = await _health(port);
      final identityProblem = _verifyServerIdentity(health, settings);
      if (identityProblem != null) {
        log.writeln('[shell] refusing to open the program: $identityProblem');
        if (keepServerForLicenceDiagnostics(health)) {
          // Keep one owned server alive so health and the explicit damaged-state
          // error remain available while the operator restores trusted state.
          // The business guard still fails closed. A retry must pass all
          // identity checks before this child can ever be treated as ready.
          _instance = LocalBackend._(process, port, log, true);
        } else {
          await _stop(process, log);
        }
        return LocalBackendStatus.failed(
          identityProblem,
          logPath: layout.logPath,
          databaseProblem: _licenceStateProblem(health) == null,
        );
      }
      log.writeln(
        '[shell] the server is reading database '
        '${health?['databaseName'] ?? 'not reported'} '
        '(settings ${settings.sourceFile?.path ?? 'none'}, generation '
        '${settings.generation ?? 'none'})',
      );
      _instance = LocalBackend._(process, port, log);
      return LocalBackendStatus.ready(_instance!.baseUrl);
    }

    final tail = await layout.logTail();
    await _stop(process, log);
    final databaseProblem = _isDatabaseProblem(tail);
    return LocalBackendStatus.failed(
      _isDatabaseAuthenticationFailure(tail)
          ? KayanDatabaseConfig.startupFailureMessage(
              serviceExists: true,
              authenticationOk: false,
              settingsPath: layout.settingsFile.path,
              errorCode: 'Prisma P1000',
            )
          : databaseProblem
          ? 'The server started but the database did not answer.'
          : 'The server did not become ready in time.',
      logPath: layout.logPath,
      databaseProblem: databaseProblem,
    );
  }

  static bool _isDatabaseAuthenticationFailure(String text) =>
      text.contains('P1000') ||
      text.toLowerCase().contains('password authentication failed');

  static bool _isDatabaseProblem(String text) =>
      text.contains('DATABASE') ||
      text.toLowerCase().contains('database') ||
      text.contains('P1000') ||
      text.contains('P1001') ||
      text.contains('ECONNREFUSED');

  /// True when something at this port answers the health route the way this
  /// program's own API does.
  static Future<bool> _isKayanApi(int port) async {
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 2);
    try {
      final request = await client
          .getUrl(Uri.parse('http://127.0.0.1:$port/api/v1/health'))
          .timeout(const Duration(seconds: 3));
      final response = await request.close().timeout(
        const Duration(seconds: 3),
      );
      final body = await response
          .transform(utf8.decoder)
          .join()
          .timeout(const Duration(seconds: 3));
      return response.statusCode == 200 && body.contains('"status"');
    } on Object {
      return false;
    } finally {
      client.close(force: true);
    }
  }

  /// The health answer of a KAYAN API, or null when it did not answer.
  ///
  /// It is the source of truth for two questions the shell asks before opening
  /// the program: whether the database still needs its first administrator
  /// (another process may have started the API first), and whether this server
  /// is reading the database and enforcing the licence this installation's
  /// settings name.
  static Future<Map<String, dynamic>?> _health(int port) async {
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 2);
    try {
      final request = await client
          .getUrl(Uri.parse('http://127.0.0.1:$port/api/v1/health'))
          .timeout(const Duration(seconds: 3));
      final response = await request.close().timeout(
        const Duration(seconds: 3),
      );
      if (response.statusCode != 200) return null;
      final body = await response
          .transform(utf8.decoder)
          .join()
          .timeout(const Duration(seconds: 3));
      final decoded = jsonDecode(body);
      return decoded is Map<String, dynamic> ? decoded : null;
    } on Object {
      return null;
    } finally {
      client.close(force: true);
    }
  }

  /// Proves that the server in front of the program is reading the database
  /// this installation's settings name, and enforcing the licence it requires.
  ///
  /// Returns a sentence for the person at the screen when it is not, or null
  /// when everything matches. Both facts are part of the public health answer,
  /// so this needs no signed-in user - which matters, because the check has to
  /// happen before the program opens.
  static String? _licenceStateProblem(Map<String, dynamic>? health) {
    final licence = health?['license'];
    if (licence is Map && licence['stateError'] == 'LICENSE_STATE_DAMAGED') {
      return 'تعذّر التحقق من ملف حالة الترخيص. احتفظ بالملف التالف وتواصل '
          'مع الدعم لاستعادة نسخة موثوقة وحديثة من الجهاز نفسه؛ لا تحذف الملف '
          'ولا تعِد التثبيت، ثم أعد المحاولة.\n'
          'The licence state cannot be verified. Preserve the damaged file and '
          'contact support to restore a current trusted backup from this '
          'installation; do not delete it or reinstall. Then retry.';
    }
    if (licence is Map &&
        licence['enforcement'] == 'enforce' &&
        licence['configured'] == false) {
      return 'تعذّر التحقق من مفتاح الترخيص العام أو أنه لا يطابق المفتاح '
          'المسجّل. احتفظ بالبيانات وتواصل مع الدعم لاستعادة المفتاح المعتمد '
          'لهذا التثبيت؛ لا تحذف حالة الترخيص.\n'
          'The licence verification key is unavailable or does not match '
          'this installation. Preserve the data and licence state and '
          'contact support to restore the approved key.';
    }
    return null;
  }

  static String? _verifyServerIdentity(
    Map<String, dynamic>? health,
    RuntimeSettings settings,
  ) {
    if (health == null) {
      return 'تعذّر قراءة حالة الخادم. حاول مرة أخرى. / '
          'Could not read the server health status. Please retry.';
    }
    final licenceProblem = _licenceStateProblem(health);
    if (licenceProblem != null) return licenceProblem;

    final expected = KayanDatabaseConfig.databaseNameFromUrl(
      settings.databaseUrl,
    );
    final actual = health['databaseName'];
    if (expected != null &&
        actual is String &&
        actual.isNotEmpty &&
        actual != expected) {
      return 'The program is connected to the database "$actual", but this '
          'installation\'s settings name "$expected". Setup did not finish '
          'switching to the company database it created, so the program was '
          'not opened. Run Repair KAYAN ERP, or run Setup again and choose '
          '"An existing company" to keep the data on this computer.';
    }

    final wanted = (settings.licenceEnforcement ?? '').toLowerCase();
    if (wanted == 'enforce') {
      final license = health['license'];
      final enforcement = license is Map ? license['enforcement'] : null;
      final configured = license is Map ? license['configured'] : null;
      if (enforcement != 'enforce' || configured != true) {
        return 'This installation requires a licence key, but the local server '
            'answered with licence enforcement "${enforcement ?? 'unknown'}" and '
            'key installed = $configured. A server that does not enforce the '
            'licence is not used: close any copy of KAYAN ERP started by hand, '
            'then open the program from its shortcut again.';
      }
    }
    return null;
  }


  /// A port nothing is listening on, so two programs never share one.
  static Future<int?> _firstFreePort() async {
    for (final port in candidatePorts) {
      try {
        final probe = await ServerSocket.bind(
          InternetAddress.loopbackIPv4,
          port,
        );
        await probe.close();
        return port;
      } on SocketException {
        continue;
      }
    }
    return null;
  }

  /// Starts the server as a child process with no window of its own.
  ///
  /// `ProcessStartMode.normal` keeps the pipes open, which is what lets the
  /// server's log be written to a file the user can read. The Windows runner
  /// allocates a hidden console for the program itself, which is what stops a
  /// console window appearing for this child - see windows/runner/main.cpp.
  static Future<Process?> _spawn(
    BackendLayout layout,
    RuntimeSettings settings,
    IOSink? log,
    int port,
  ) async {
    try {
      final process = await Process.start(
        layout.nodeExecutable,
        [layout.entryPoint],
        workingDirectory: layout.backendDirectory,
        environment: {
          ...settings.asEnvironment(port),
          // Installed Program Files is read-only for ordinary users.
          'KAYAN_BACKUP_DIR':
              settings.asEnvironment(port)['KAYAN_BACKUP_DIR'] ??
              '${layout.dataDirectory.path}${Platform.pathSeparator}backups',
          'KAYAN_UPLOAD_DIR':
              '${layout.dataDirectory.path}${Platform.pathSeparator}uploads',
          // Say where the browser client is instead of hoping the server
          // guesses it from its working directory: the address must open the
          // program, not a JSON 404.
          'KAYAN_WEB_ROOT':
              '${File(layout.backendDirectory).parent.path}'
              '${Platform.pathSeparator}build'
              '${Platform.pathSeparator}web',
          // The listening interface comes from the installation's settings
          // file, not from a literal here. The literal used to override the
          // file, so setting HOST=0.0.0.0 did nothing and a second computer on
          // the same network could never connect. The default is every
          // interface (the installation is a company server); an operator who
          // wants this copy private sets HOST=127.0.0.1 in the settings file.
          'NODE_ENV': 'production',
          // The server writes to a file, where escape sequences are noise.
          'NO_COLOR': '1',
        },
        includeParentEnvironment: true,
      );
      // Line by line, so every line in the log carries its own prefix and the
      // file stays readable with any text editor. Every line is redacted the
      // same way the preparation output is: a database driver in a bad mood
      // will happily print the whole connection string, password included,
      // and this log is a file other people may be asked to read or send.
      process.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen((line) {
            log?.writeln('[out] ${_redactSecrets(_plain(line))}');
          });
      process.stderr
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen((line) {
            log?.writeln('[err] ${_redactSecrets(_plain(line))}');
          });
      return process;
    } on Object catch (error) {
      log?.writeln('[shell] could not start the server: $error');
      return null;
    }
  }

  /// Removes colour escape sequences, for the log only.
  static String _plain(String line) =>
      line.replaceAll(RegExp(r'\x1B\[[0-9;]*[A-Za-z]'), '');

  /// Waits for a real answer from the health route, rather than guessing with
  /// a fixed delay. Gives up early if the process dies, so a broken install
  /// fails in seconds instead of after a minute and a half.
  static Future<bool> _waitForBundledPostgres(
    BackendLayout layout,
    RuntimeSettings settings,
    IOSink? log,
  ) async {
    final url = Uri.tryParse(settings.databaseUrl ?? '');
    if (url == null || !{'127.0.0.1', 'localhost', '::1'}.contains(url.host)) {
      return true;
    }
    final executable = File(
      '${layout.backendDirectory}${Platform.pathSeparator}postgres'
      '${Platform.pathSeparator}bin${Platform.pathSeparator}pg_isready.exe',
    );
    // Developer-installed PostgreSQL and non-Windows desktop builds keep their
    // existing path; only the installer ships this executable.
    if (!await executable.exists()) return true;
    final port = int.tryParse(url.port.toString()) ?? KayanDatabaseConfig.port;
    final deadline = DateTime.now().add(const Duration(seconds: 60));
    while (DateTime.now().isBefore(deadline)) {
      try {
        final probe = await Process.start(executable.path, [
          '-h',
          '127.0.0.1',
          '-p',
          '$port',
          '-U',
          'postgres',
        ], runInShell: false);
        unawaited(probe.stdout.drain<void>());
        unawaited(probe.stderr.drain<void>());
        int exitCode;
        try {
          exitCode = await probe.exitCode.timeout(const Duration(seconds: 5));
        } on TimeoutException {
          probe.kill(ProcessSignal.sigkill);
          log?.writeln('[shell] PostgreSQL readiness probe timed out');
          return false;
        }
        if (exitCode == 0) {
          log?.writeln('[shell] bundled PostgreSQL is accepting connections');
          return true;
        }
      } on Object catch (error) {
        log?.writeln('[shell] PostgreSQL readiness probe failed: $error');
        return false;
      }
      await Future<void>.delayed(const Duration(seconds: 1));
    }
    log?.writeln(
      '[shell] PostgreSQL did not become ready before the 60 second deadline',
    );
    return false;
  }

  static Future<bool> _waitForHealth(
    Process process,
    int port,
    IOSink? log,
  ) async {
    var exited = false;
    unawaited(process.exitCode.then((_) {
      // Do not write to the log here: the exit callback may run after a timed
      // out stop has closed it.
      exited = true;
    }));

    final deadline = DateTime.now().add(startupTimeout);
    while (DateTime.now().isBefore(deadline)) {
      if (exited) return false;
      if (await _isKayanApi(port)) {
        // The route answers; give the process one more moment to flush.
        await Future<void>.delayed(const Duration(milliseconds: 150));
        return true;
      }
      await Future<void>.delayed(const Duration(milliseconds: 300));
    }
    // The child may still be alive but never become healthy. Waiting for its
    // exit here would turn the startup timeout into an indefinite hang; the
    // caller stops the process after this returns.
    return false;
  }

  /// Creates the database and applies the schema, before the API starts.
  /// Returns the script's reported state, exit code and output. A missing
  /// script remains null so older packaged builds can still start the API.
  ///
  /// [firstAdministrator] is only passed when a person has just chosen the
  /// company's first username and password on the screen. It travels in the
  /// environment of the child process, never on a command line, so it is not
  /// readable by other users on the machine.
  static Future<({String? state, int exitCode, String output})?>
  _runPreparation(
    BackendLayout layout,
    RuntimeSettings settings,
    IOSink? log, {
    ({String username, String password})? firstAdministrator,
    CompanySetupData? company,
  }) async {
    final script = File(
      '${layout.backendDirectory}${Platform.pathSeparator}scripts'
      '${Platform.pathSeparator}prepare-database.mjs',
    );
    if (!script.existsSync()) {
      log?.writeln('[shell] no database preparation script in this build');
      return null;
    }
    if (_preparationInFlight != null) {
      return (state: null, exitCode: 1, output: _preparationPendingMessage);
    }
    try {
      log?.writeln('[shell] preparing the database');
      final operation = Process.run(
        layout.nodeExecutable,
        [script.path],
        workingDirectory: layout.backendDirectory,
        environment: {
          ...settings.asEnvironment(settings.port),
          if (firstAdministrator != null) ...{
            'KAYAN_ADMIN_USERNAME': firstAdministrator.username,
            'KAYAN_ADMIN_PASSWORD': firstAdministrator.password,
          },
          if (company != null) ...company.environment,
          if (_logoFile != null) 'KAYAN_COMPANY_LOGO_FILE': _logoFile!.path,
        },
        includeParentEnvironment: true,
      );
      _preparationInFlight = operation;
      unawaited(operation.then<void>((_) {
        if (identical(_preparationInFlight, operation)) {
          _preparationInFlight = null;
        }
      }, onError: (Object _, StackTrace _) {
        if (identical(_preparationInFlight, operation)) {
          _preparationInFlight = null;
        }
      }));
      final result = await operation.timeout(const Duration(minutes: 5));
      // The credentials are in the environment, but a child process may echo
      // them; the log is a file other people can read, so it is written
      // without them.
      final output = _redactSecrets('${result.stdout}');
      final errorOutput = _redactSecrets('${result.stderr}');
      log?.writeln('[prep] ${output.trimRight()}');
      if (errorOutput.trim().isNotEmpty) {
        log?.writeln('[prep-err] ${errorOutput.trimRight()}');
      }
      final match = RegExp(r'KAYAN-DB-STATE=(\w+)').firstMatch(output);
      final state = match?.group(1);
      log?.writeln(
        '[shell] database state: ${state ?? 'not reported'} '
        '(exit ${result.exitCode})',
      );
      return (
        state: state,
        exitCode: result.exitCode,
        output: '$output\n$errorOutput',
      );
    } on TimeoutException {
      // A migration can have child processes and a transaction in progress.
      // Do not kill it or start a concurrent attempt just to dismiss the UI.
      log?.writeln('[shell] database preparation exceeded the wait deadline; it is still running');
      return (state: null, exitCode: 1, output: _preparationPendingMessage);
    } on Object catch (error) {
      log?.writeln('[shell] database preparation failed: $error');
      return (state: null, exitCode: 1, output: '$error');
    }
  }

  static String _redactSecrets(String text) => text
      .replaceAll(
        RegExp(
          r'(postgres(?:ql)?://[^:/@\s]+:)[^@\s]*(@)',
          caseSensitive: false,
        ),
        r'$1***$2',
      )
      .replaceAll(RegExp(r'(KAYAN_ADMIN_PASSWORD=)\S+'), r'$1***')
      .replaceAll(
        RegExp(r'((?:DATABASE_URL|ADMIN_DATABASE_URL)=)\S+'),
        r'$1***',
      )
      // Signing secrets and bare password assignments, the same shapes the
      // Windows repair tooling strips from its own logs - one definition of
      // "never in a log" across the product.
      .replaceAll(
        RegExp(r'((?:JWT_ACCESS_SECRET|JWT_REFRESH_SECRET)=)\S+'),
        r'$1***',
      )
      .replaceAll(
        RegExp(r'([Pp]assword\s*[=:]\s*)[^\s;]+'),
        r'$1***',
      );

  /// Creates the company's first administrator, with the credentials somebody
  /// chose on the screen, then leaves the machine ready to start.
  ///
  /// The work itself belongs to the server's own seeding program (see
  /// backend/scripts/prepare-database.mjs); this only carries the answer.
  static Future<LocalBackendStatus> createFirstAdministrator({
    required String username,
    required String password,
    required String appDisplayName,
    CompanySetupData? company,
  }) async {
    if (username.trim().length < 3) {
      return const LocalBackendStatus.failed('اسم المستخدم قصير جدًا');
    }
    if (password.length < 8) {
      return const LocalBackendStatus.failed('كلمة السر قصيرة جدًا');
    }
    final layout = BackendLayout.discover();
    final missing = layout.problem;
    if (missing != null) return LocalBackendStatus.failed(missing);
    final settingsProblem = missingInstalledSettings(layout);
    if (settingsProblem != null) {
      return LocalBackendStatus.failed(
        settingsProblem,
        logPath: layout.logPath,
        databaseProblem: true,
      );
    }

    final log = await layout.openLog();
    final settings = await RuntimeSettings.load(layout, 3000);
    log.writeln('[shell] creating the first administrator: ${username.trim()}');
    // The logo travels as a file the shell writes to a temporary folder: an
    // image does not belong in an environment variable. The file lives only
    // for the length of the preparation call.
    final bytes = company?.logoBytes;
    if (company != null && bytes != null && bytes.isNotEmpty) {
      final suffix = switch ((company.logoMime ?? '').toLowerCase()) {
        'image/jpeg' => '.jpg',
        'image/webp' => '.webp',
        _ => '.png',
      };
      final temp = File(
        '${Directory.systemTemp.path}${Platform.pathSeparator}'
        'kayan-setup-logo-${DateTime.now().millisecondsSinceEpoch}$suffix',
      );
      await temp.writeAsBytes(bytes, flush: true);
      _logoFile = temp;
    }
    ({String? state, int exitCode, String output})? preparation;
    try {
      preparation = await _runPreparation(
        layout,
        settings,
        log,
        firstAdministrator: (username: username.trim(), password: password),
        company: company,
      );
    } finally {
      final logoFile = _logoFile;
      _logoFile = null;
      if (logoFile != null) {
        final pending = _preparationInFlight;
        if (pending == null) {
          try {
            await logoFile.delete();
          } catch (_) {}
        } else {
          // The preparation process may still need this file after a timeout.
          // Remove only this invocation's temporary logo once it finishes.
          Future<void> removeLogo() async {
            try {
              await logoFile.delete();
            } catch (_) {}
          }
          unawaited(pending.then<void>(
            (_) => removeLogo(),
            onError: (Object _, StackTrace _) => removeLogo(),
          ));
        }
      }
    }
    await log.flush();
    await log.close();
    if (preparation?.exitCode != 0 || preparation?.state != 'ready') {
      final authenticationProblem = _isDatabaseAuthenticationFailure(
        preparation?.output ?? '',
      );
      return LocalBackendStatus.failed(
        authenticationProblem
            ? KayanDatabaseConfig.startupFailureMessage(
                serviceExists: true,
                authenticationOk: false,
                settingsPath: layout.settingsFile.path,
                errorCode: 'Prisma P1000',
              )
            : (preparation?.output ?? '').contains(_preparationPendingMessage)
            ? _preparationPendingMessage
            : 'مقدرتش أعمل حساب المدير',
        logPath: layout.logPath,
        databaseProblem:
            preparation?.exitCode != 0 ||
            preparation?.state == null ||
            preparation?.state == 'unknown',
      );
    }
    return ensureRunning(appDisplayName: appDisplayName);
  }

  // ─────────────────────────────────────────────────────────────── shutting down

  /// Stops the server this copy started. Called when the window closes.
  static Future<void> shutdown() async {
    final running = _instance;
    _instance = null;
    final process = running?._process;
    if (process == null) return;
    await _stop(process, running!._log);
  }

  static Future<void> _stop(Process process, IOSink? log) async {
    log?.writeln('[shell] stopping the server');
    process.kill(ProcessSignal.sigterm);
    try {
      await process.exitCode.timeout(const Duration(seconds: 10));
    } on TimeoutException {
      process.kill(ProcessSignal.sigkill);
      try {
        await process.exitCode.timeout(const Duration(seconds: 5));
      } on TimeoutException {
        // Do not launch another server while this one may still be alive.
        // Keep its log open for its output and close it when it really exits.
        _stoppingProcess = process;
        log?.writeln('[shell] server did not stop after termination attempts');
        unawaited(process.exitCode.then<void>((_) async {
          if (identical(_stoppingProcess, process)) _stoppingProcess = null;
          try {
            await log?.flush().timeout(const Duration(seconds: 3));
            await log?.close().timeout(const Duration(seconds: 3));
          } on Object catch (_) {}
        }));
        return;
      }
    }
    try {
      await log?.flush().timeout(const Duration(seconds: 3));
      await log?.close().timeout(const Duration(seconds: 3));
    } on Object catch (_) {
      // Logging must not turn a stopped child into a hung application.
    }
  }
}

/// Where the pieces of a packaged copy live.
///
/// The rule is: everything the program needs sits next to the program, so the
/// folder can be copied to another machine as it is. The three environment
/// variables exist so a support engineer (or a test on a build machine) can
/// point the shell somewhere else without rebuilding it.
class BackendLayout {
  BackendLayout({
    required this.backendDirectory,
    required this.nodeExecutable,
    required this.entryPoint,
    required this.dataDirectory,
    required this.logPath,
    this.problem,
  });

  /// The folder holding `dist/`, `node_modules/` and `prisma/`.
  final String backendDirectory;

  /// The Node runtime that runs the server. Shipped with the program.
  final String nodeExecutable;

  /// `dist/main.js`, built by `nest build`.
  final String entryPoint;

  /// Where the machine's own settings and logs live. Never inside the program
  /// folder: that folder may be read-only, and it is replaced on update.
  final Directory dataDirectory;

  final String logPath;

  /// Why the packaged pieces could not be found, or null when all is well.
  final String? problem;

  File get logFile => File(logPath);

  /// Where this machine's settings live. `KAYAN_DESKTOP_SETTINGS` overrides it,
  /// which support uses to point a machine at another file, and which the
  /// checks use to try a first run without disturbing the installation that is
  /// already on this machine.
  File get settingsFile {
    final override = Platform.environment['KAYAN_DESKTOP_SETTINGS'];
    if (override != null && override.isNotEmpty) return File(override);

    final userFile = File('${dataDirectory.path}${Platform.pathSeparator}kayan.env');
    if (!Platform.isWindows) return userFile;

    final programData = Platform.environment['ProgramData'] ?? r'C:\ProgramData';
    final machineFile = File(
      '$programData${Platform.pathSeparator}KAYAN-ERP'
      '${Platform.pathSeparator}kayan.env',
    );
    if (!machineFile.existsSync()) return userFile;

    // Two copies of the settings can exist: the installer's protected one in
    // ProgramData, and a per-user copy in this profile that the program reads
    // without asking for permission. They must agree about which database the
    // company is in. The installer stamps every copy it writes with
    // KAYAN_SETTINGS_GENERATION; the newer stamp wins, and an older per-user
    // copy is brought up to date. Without this, choosing a new company (or a
    // safe reset) could leave this profile pointing at the previous company's
    // database, and the program would open showing the previous company's
    // data.
    final machineGeneration = readSettingsGeneration(machineFile);
    final userExists = userFile.existsSync();
    final userGeneration = userExists ? readSettingsGeneration(userFile) : null;
    final machineIsNewer =
        !userExists ||
        (machineGeneration != null &&
            (userGeneration == null || machineGeneration > userGeneration));
    if (!machineIsNewer) return userFile;

    try {
      final content = machineFile.readAsStringSync();
      userFile.parent.createSync(recursive: true);
      userFile.writeAsStringSync(content);
      return userFile;
    } on Object {
      // The folder may be read-only for this user. Reading the protected copy
      // in place is still better than using a stale one.
      return machineFile;
    }
  }

  /// The `KAYAN_SETTINGS_GENERATION` stamp in a settings file, if it has one.
  ///
  /// It is an integer written by the installer/repair/reset scripts, larger
  /// every time they change which database the installation uses.
  static int? readSettingsGeneration(File file) {
    try {
      for (final line in file.readAsStringSync().split('\n')) {
        final text = line.trim();
        if (!text.startsWith('KAYAN_SETTINGS_GENERATION=')) continue;
        final value = text
            .substring('KAYAN_SETTINGS_GENERATION='.length)
            .replaceAll('"', '')
            .trim();
        return int.tryParse(value);
      }
    } on Object {
      return null;
    }
    return null;
  }

  Future<IOSink> openLog() async {
    final file = logFile;
    await file.parent.create(recursive: true);
    // Keep the log of the run that failed, and start a fresh one: the useful
    // text is always the newest, and an unbounded log is a disk leak.
    if (await file.exists() && await file.length() > 2 * 1024 * 1024) {
      await file.rename('${file.path}.1');
    }
    return file.openWrite(mode: FileMode.append);
  }

  Future<String> logTail({int lines = 40}) async {
    final file = logFile;
    if (!await file.exists()) return '';
    final text = await file.readAsString();
    final all = text.split('\n');
    return all.length <= lines
        ? text
        : all.sublist(all.length - lines).join('\n');
  }

  /// Finds the pieces, or says which one is missing.
  static BackendLayout discover() {
    final separator = Platform.pathSeparator;
    final programDirectory = _programDirectory();
    final dataDirectory = _dataDirectory();

    final backendDirectory =
        Platform.environment['KAYAN_DESKTOP_BACKEND_DIR'] ??
        '$programDirectory${separator}backend';
    final node =
        Platform.environment['KAYAN_DESKTOP_NODE'] ??
        _findNode(backendDirectory);
    // `nest build` writes the compiled server under dist/src, because the
    // TypeScript project also covers prisma/ and scripts/.
    final entry =
        '$backendDirectory${separator}dist${separator}src${separator}main.js';

    final layout = BackendLayout(
      backendDirectory: backendDirectory,
      nodeExecutable: node ?? 'node',
      entryPoint: entry,
      dataDirectory: dataDirectory,
      logPath: '${dataDirectory.path}${separator}logs${separator}backend.log',
    );

    return BackendLayout(
      backendDirectory: layout.backendDirectory,
      nodeExecutable: layout.nodeExecutable,
      entryPoint: layout.entryPoint,
      dataDirectory: layout.dataDirectory,
      logPath: layout.logPath,
      problem: _check(layout, node),
    );
  }

  static String? _check(BackendLayout layout, String? node) {
    if (!Directory(layout.backendDirectory).existsSync()) {
      return 'The server files are missing from this installation '
          '(looked in ${layout.backendDirectory}).';
    }
    if (!File(layout.entryPoint).existsSync()) {
      return 'The server is not built in this installation '
          '(no ${layout.entryPoint}).';
    }
    if (node == null && !_onPath('node')) {
      return 'No Node runtime was found. Reinstall the program, or set '
          'KAYAN_DESKTOP_NODE to the Node executable.';
    }
    return null;
  }

  /// Where the executable sits. On macOS the shell is inside the bundle, and
  /// the pieces sit beside the bundle in `Contents/Resources`.
  static String _programDirectory() {
    final executable = Platform.resolvedExecutable;
    final directory = File(executable).parent.path;
    if (Platform.isMacOS &&
        directory.contains('.app${Platform.pathSeparator}Contents')) {
      return '$directory${Platform.pathSeparator}Resources';
    }
    return directory;
  }

  /// The machine's own folder for this program, following each platform's rule.
  static Directory _dataDirectory() {
    final environment = Platform.environment;
    final home =
        environment['USERPROFILE'] ??
        environment['HOME'] ??
        Directory.current.path;
    final separator = Platform.pathSeparator;
    if (Platform.isWindows) {
      final appData =
          environment['APPDATA'] ??
          '$home${separator}AppData${separator}Roaming';
      return Directory('$appData${separator}KAYAN-ERP');
    }
    if (Platform.isMacOS) {
      return Directory(
        '$home${separator}Library${separator}Application Support'
        '${separator}KAYAN-ERP',
      );
    }
    final xdg =
        environment['XDG_DATA_HOME'] ??
        [home, '.local', 'share'].join(separator);
    return Directory('$xdg${separator}KAYAN-ERP');
  }

  /// The Node runtime, in the order that keeps an installation self-contained:
  /// the copy shipped with the program, then the portable copy the setup
  /// scripts download, then whatever is on PATH.
  static String? _findNode(String backendDirectory) {
    final separator = Platform.pathSeparator;
    final name = Platform.isWindows ? 'node.exe' : 'node';
    final candidates = <String>[
      '$backendDirectory$separator'
          'node$separator$name',
      if (Platform.isWindows)
        '${Platform.environment['LOCALAPPDATA'] ?? ''}${separator}kayan-tools'
            '$separator'
            'node$separator$name',
    ];
    for (final candidate in candidates) {
      if (File(candidate).existsSync()) return candidate;
    }
    return null;
  }

  static bool _onPath(String executable) {
    final separator = Platform.isWindows ? ';' : ':';
    final extensions = Platform.isWindows ? ['.exe', '.cmd', '.bat', ''] : [''];
    for (final directory in (Platform.environment['PATH'] ?? '').split(
      separator,
    )) {
      if (directory.isEmpty) continue;
      for (final extension in extensions) {
        if (File('$directory${Platform.pathSeparator}$executable$extension')
            .existsSync()) {
          return true;
        }
      }
    }
    return false;
  }
}

/// Why this installed copy has no settings file, or null when it has one.
///
/// A run on a development machine is allowed to write a settings file from the
/// defaults; a copy that Setup installed is not. Inventing settings there would
/// mean guessing a database and a password, and guessing wrong is how a program
/// ends up looking at another company's data - or at nothing - instead of
/// saying that the installation did not finish.
String? missingInstalledSettings(BackendLayout layout) {
  if (!Platform.isWindows) return null;
  final file = layout.settingsFile;
  if (file.existsSync()) return null;
  final programData = Platform.environment['ProgramData'] ?? r'C:\ProgramData';
  final installedFolder = Directory(
    '$programData${Platform.pathSeparator}KAYAN-ERP',
  );
  if (!installedFolder.existsSync()) return null;
  return 'KAYAN ERP is installed on this computer, but the settings that say '
      'which database it uses are missing (${file.path}). Setup did not '
      'finish, so the program was not opened and no database was touched. '
      'Run Repair KAYAN ERP, or run Setup again.';
}

/// The settings the desktop server runs with, kept in the machine's own folder.
///
/// First run writes the file with fresh random signing secrets, so no secret
/// is ever shipped inside the program or committed to the repository. After
/// that the file belongs to whoever administers the machine, and editing it is
/// the supported way to point the program at a different database.
class RuntimeSettings {
  RuntimeSettings(
    this._values,
    this.port, {
    this.sourceFile,
    this.generation,
  });

  final Map<String, String> _values;
  final int port;

  /// The file these values were read from, for the log and for messages.
  final File? sourceFile;

  /// The installer's `KAYAN_SETTINGS_GENERATION` stamp, when the file has one.
  final int? generation;

  static const Map<String, String> _defaults = {
    // Reachable from the other devices on the company network by default; the
    // database itself stays on 127.0.0.1 and is never exposed by this.
    'HOST': '0.0.0.0',
    'NODE_ENV': 'production',
    'JWT_ACCESS_TTL': '900',
    'JWT_REFRESH_TTL': '1209600',
    'DATABASE_URL':
        'postgresql://erp_app:postgres@127.0.0.1:5432/erp_kayan?schema=public',
    'ADMIN_DATABASE_URL':
        'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
  };

  static Future<RuntimeSettings> load(BackendLayout layout, int port) async {
    final file = layout.settingsFile;
    if (!await file.exists()) {
      await file.parent.create(recursive: true);
      await file.writeAsString(_firstRunFile());
    }
    final values = Map<String, String>.from(_defaults);
    for (final line in (await file.readAsString()).split('\n')) {
      final text = line.trim();
      if (text.isEmpty || text.startsWith('#')) continue;
      final index = text.indexOf('=');
      if (index <= 0) continue;
      final key = text.substring(0, index).trim();
      var value = text.substring(index + 1).trim();
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      }
      if (value.isNotEmpty) values[key] = value;
    }
    return RuntimeSettings(
      values,
      port,
      sourceFile: file,
      generation: BackendLayout.readSettingsGeneration(file),
    );
  }

  /// The settings for a desktop installation, written once.
  static String _firstRunFile() {
    final random = Random.secure();
    String secret() =>
        base64Url.encode(List<int>.generate(48, (_) => random.nextInt(256)));
    return '''
# KAYAN ERP - the settings this installation runs with.
#
# Written automatically the first time the program started, on this machine
# only. It is never part of the program's files and never leaves this computer.
#
# Two lines may need changing.
#
# DATABASE_URL says which PostgreSQL the program reads and writes. The default
# matches the PostgreSQL the installer sets up on this machine.
#
# HOST decides which network interface the built-in server listens on:
#   0.0.0.0   - every interface. Other computers, phones and tablets on the
#               same network can open http://<this computer's address>:3000
#   127.0.0.1 - this computer only; nothing else can connect.
# The database itself listens on 127.0.0.1 only, in both cases, and every API
# call still needs a signed-in user. Windows Firewall may ask whether to allow
# the program; allow it for private networks only, never for public networks.
#
# After editing, close the program completely and open it again.

HOST=0.0.0.0
DATABASE_URL="${_defaults['DATABASE_URL']}"
ADMIN_DATABASE_URL="${_defaults['ADMIN_DATABASE_URL']}"
JWT_ACCESS_SECRET="${secret()}"
JWT_REFRESH_SECRET="${secret()}"
JWT_ACCESS_TTL=900
JWT_REFRESH_TTL=1209600
''';
  }

  /// The environment for the child process. The port always comes from the
  /// shell, because the shell is what picked a free one.
  Map<String, String> asEnvironment(int chosenPort) => {
    ..._values,
    'PORT': '$chosenPort',
    'HOST': _values['HOST'] ?? _defaults['HOST']!,
  };

  String? get databaseUrl => _values['DATABASE_URL'];

  /// What the installer wrote: `enforce` on a copy that must hold a licence,
  /// `warn` on a build made without a verification key.
  String? get licenceEnforcement => _values['LICENSE_ENFORCEMENT'];
}
