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

/// What the shell needs to know after a start attempt.
class LocalBackendStatus {
  const LocalBackendStatus.ready(this.baseUrl)
      : problem = null,
        logPath = null,
        databaseProblem = false,
        needsFirstAdministrator = false;
  const LocalBackendStatus.failed(this.problem, {this.logPath, this.databaseProblem = false})
      : baseUrl = null,
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

/// A running server, or the reason there is not one.
class LocalBackend {
  LocalBackend._(this._process, this.port, this._log);

  final Process? _process;
  final int port;
  final IOSink? _log;

  static LocalBackend? _instance;

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
  }) async {
    try {
      return await _ensureRunning(appDisplayName);
    } on Object catch (error) {
      return LocalBackendStatus.failed('$error');
    }
  }

  static Future<LocalBackendStatus> _ensureRunning(String appDisplayName) async {
    // 1. Is a KAYAN API already answering? Then this copy does not need to
    //    start a second one, which is what keeps two windows of the program
    //    from fighting over the database.
    for (final port in candidatePorts) {
      if (await _isKayanApi(port)) {
        // The address we already started on. Keep the handle to the child:
        // replacing it here would lose the only reference to the server and
        // leave it running after the window closes.
        final running = _instance;
        if (running != null && running.port == port) {
          return LocalBackendStatus.ready(running.baseUrl);
        }
        // Someone else's copy - another window, or a development server. Use
        // it, and leave its life cycle to whoever started it.
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

    final log = await layout.openLog();
    // Who is running what, at the top of every log: the first thing a person
    // needs when reading a log from another machine.
    log.writeln('[shell] program: ${Platform.resolvedExecutable}');
    log.writeln('[shell] node: ${layout.nodeExecutable}');
    log.writeln('[shell] server: ${layout.entryPoint}');
    final settings = await RuntimeSettings.load(layout, port);

    // 2. Prepare the database first. On a machine that has never run the
    //    program this creates the database and applies the schema; on any
    //    other machine it is a couple of seconds of checking.
    //
    //    It also says whether the database is still empty. If it is, this
    //    machine has no company and no user in it yet, and there is nothing to
    //    start a server for until somebody says who the first administrator is.
    final state = await _runPreparation(layout, settings, log);
    if (state == 'empty') {
      log.writeln('[shell] the database is empty: asking who the first '
          'administrator is');
      await log.flush();
      await log.close();
      return const LocalBackendStatus.needsFirstAdministrator();
    }

    // 3. Start the server and wait until it answers.
    final process = await _spawn(layout, settings, log, port);
    if (process == null) {
      return LocalBackendStatus.failed(
        'The server would not start.',
        logPath: layout.logPath,
      );
    }

    final ready = await _waitForHealth(process, port, log);
    if (ready) {
      _instance = LocalBackend._(process, port, log);
      return LocalBackendStatus.ready(_instance!.baseUrl);
    }

    final tail = await layout.logTail();
    await _stop(process, log);
    final databaseProblem = tail.contains('DATABASE') ||
        tail.contains('database') ||
        tail.contains('P1001') ||
        tail.contains('ECONNREFUSED');
    return LocalBackendStatus.failed(
      databaseProblem
          ? 'The server started but the database did not answer.'
          : 'The server did not become ready in time.',
      logPath: layout.logPath,
      databaseProblem: databaseProblem,
    );
  }

  /// True when something at this port answers the health route the way this
  /// program's own API does.
  static Future<bool> _isKayanApi(int port) async {
    try {
      final client = HttpClient()..connectionTimeout = const Duration(seconds: 2);
      final request = await client
          .getUrl(Uri.parse('http://127.0.0.1:$port/api/v1/health'))
          .timeout(const Duration(seconds: 3));
      final response = await request.close().timeout(const Duration(seconds: 3));
      final body = await response.transform(utf8.decoder).join();
      client.close(force: true);
      return response.statusCode == 200 && body.contains('"status"');
    } on Object {
      return false;
    }
  }

  /// A port nothing is listening on, so two programs never share one.
  static Future<int?> _firstFreePort() async {
    for (final port in candidatePorts) {
      try {
        final probe = await ServerSocket.bind(InternetAddress.loopbackIPv4, port);
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
          // The desktop server is private to this machine.
          'HOST': '127.0.0.1',
          'NODE_ENV': 'production',
          // The server writes to a file, where escape sequences are noise.
          'NO_COLOR': '1',
        },
        includeParentEnvironment: true,
      );
      // Line by line, so every line in the log carries its own prefix and the
      // file stays readable with any text editor.
      process.stdout
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen((line) {
        log?.writeln('[out] ${_plain(line)}');
      });
      process.stderr
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen((line) {
        log?.writeln('[err] ${_plain(line)}');
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
  static Future<bool> _waitForHealth(Process process, int port, IOSink? log) async {
    var exited = false;
    final exit = process.exitCode.then((code) {
      exited = true;
      log?.writeln('[shell] the server exited with code $code');
      return code;
    });

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
    await exit;
    return false;
  }

  /// Creates the database and applies the schema, before the API starts.
  /// Runs the step that makes this machine's database correct, and returns what
  /// it says about the database: `ready`, `empty`, `unknown`, or null when the
  /// question could not be put (no script, or the step fell over).
  ///
  /// [firstAdministrator] is only passed when a person has just chosen the
  /// company's first username and password on the screen. It travels in the
  /// environment of the child process, never on a command line, so it is not
  /// readable by other users on the machine.
  static Future<String?> _runPreparation(
    BackendLayout layout,
    RuntimeSettings settings,
    IOSink? log, {
    ({String username, String password})? firstAdministrator,
  }) async {
    final script = File('${layout.backendDirectory}${Platform.pathSeparator}scripts'
        '${Platform.pathSeparator}prepare-database.mjs');
    if (!script.existsSync()) {
      log?.writeln('[shell] no database preparation script in this build');
      return null;
    }
    try {
      log?.writeln('[shell] preparing the database');
      final result = await Process.run(
        layout.nodeExecutable,
        [script.path],
        workingDirectory: layout.backendDirectory,
        environment: {
          ...settings.asEnvironment(settings.port),
          if (firstAdministrator != null) ...{
            'KAYAN_ADMIN_USERNAME': firstAdministrator.username,
            'KAYAN_ADMIN_PASSWORD': firstAdministrator.password,
          },
        },
        includeParentEnvironment: true,
      );
      // The credentials are in the environment, but a child process may echo
      // them; the log is a file other people can read, so it is written
      // without them.
      final output = '${result.stdout}'
          .replaceAll(RegExp(r'KAYAN_ADMIN_PASSWORD=(\S+)'), 'KAYAN_ADMIN_PASSWORD=***');
      log?.writeln('[prep] ${output.trimRight()}');
      if ('${result.stderr}'.trim().isNotEmpty) {
        log?.writeln('[prep-err] ${result.stderr}'.trimRight());
      }
      final match = RegExp(r'KAYAN-DB-STATE=(\w+)').firstMatch(output);
      final state = match?.group(1);
      log?.writeln('[shell] database state: ${state ?? 'not reported'} '
          '(exit ${result.exitCode})');
      return state;
    } on Object catch (error) {
      // Not fatal: the server reports the same problem more precisely when it
      // tries to connect.
      log?.writeln('[shell] database preparation failed: $error');
      return null;
    }
  }

  /// Creates the company's first administrator, with the credentials somebody
  /// chose on the screen, then leaves the machine ready to start.
  ///
  /// The work itself belongs to the server's own seeding program (see
  /// backend/scripts/prepare-database.mjs); this only carries the answer.
  static Future<LocalBackendStatus> createFirstAdministrator({
    required String username,
    required String password,
    required String appDisplayName,
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

    final log = await layout.openLog();
    final settings = await RuntimeSettings.load(layout, 3000);
    log.writeln('[shell] creating the first administrator: ${username.trim()}');
    final state = await _runPreparation(
      layout,
      settings,
      log,
      firstAdministrator: (username: username.trim(), password: password),
    );
    await log.flush();
    await log.close();
    if (state != 'ready') {
      return LocalBackendStatus.failed(
        'مقدرتش أعمل حساب المدير',
        logPath: layout.logPath,
        databaseProblem: state == null || state == 'unknown',
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
    }
    await log?.flush();
    await log?.close();
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
    return File('${dataDirectory.path}${Platform.pathSeparator}kayan.env');
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
    return all.length <= lines ? text : all.sublist(all.length - lines).join('\n');
  }

  /// Finds the pieces, or says which one is missing.
  static BackendLayout discover() {
    final separator = Platform.pathSeparator;
    final programDirectory = _programDirectory();
    final dataDirectory = _dataDirectory();

    final backendDirectory = Platform.environment['KAYAN_DESKTOP_BACKEND_DIR'] ??
        '$programDirectory${separator}backend';
    final node = Platform.environment['KAYAN_DESKTOP_NODE'] ?? _findNode(backendDirectory);
    // `nest build` writes the compiled server under dist/src, because the
    // TypeScript project also covers prisma/ and scripts/.
    final entry = '$backendDirectory${separator}dist${separator}src${separator}main.js';

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
    if (Platform.isMacOS && directory.contains('.app${Platform.pathSeparator}Contents')) {
      return '$directory${Platform.pathSeparator}Resources';
    }
    return directory;
  }

  /// The machine's own folder for this program, following each platform's rule.
  static Directory _dataDirectory() {
    final environment = Platform.environment;
    final home = environment['USERPROFILE'] ?? environment['HOME'] ?? Directory.current.path;
    final separator = Platform.pathSeparator;
    if (Platform.isWindows) {
      final appData = environment['APPDATA'] ?? '$home${separator}AppData${separator}Roaming';
      return Directory('$appData${separator}KAYAN-ERP');
    }
    if (Platform.isMacOS) {
      return Directory('$home${separator}Library${separator}Application Support'
          '${separator}KAYAN-ERP');
    }
    final xdg = environment['XDG_DATA_HOME'] ??
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
      '$backendDirectory$separator' 'node$separator$name',
      if (Platform.isWindows)
        '${Platform.environment['LOCALAPPDATA'] ?? ''}${separator}kayan-tools'
            '$separator' 'node$separator$name',
    ];
    for (final candidate in candidates) {
      if (File(candidate).existsSync()) return candidate;
    }
    return null;
  }

  static bool _onPath(String executable) {
    final separator = Platform.isWindows ? ';' : ':';
    final extensions = Platform.isWindows ? ['.exe', '.cmd', '.bat', ''] : [''];
    for (final directory in (Platform.environment['PATH'] ?? '').split(separator)) {
      if (directory.isEmpty) continue;
      for (final extension in extensions) {
        if (File('$directory${Platform.pathSeparator}$executable$extension').existsSync()) {
          return true;
        }
      }
    }
    return false;
  }

}

/// The settings the desktop server runs with, kept in the machine's own folder.
///
/// First run writes the file with fresh random signing secrets, so no secret
/// is ever shipped inside the program or committed to the repository. After
/// that the file belongs to whoever administers the machine, and editing it is
/// the supported way to point the program at a different database.
class RuntimeSettings {
  RuntimeSettings(this._values, this.port);

  final Map<String, String> _values;
  final int port;

  static const Map<String, String> _defaults = {
    'HOST': '127.0.0.1',
    'NODE_ENV': 'production',
    'JWT_ACCESS_TTL': '900',
    'JWT_REFRESH_TTL': '1209600',
    'DATABASE_URL':
        'postgresql://erp_app:postgres@127.0.0.1:5432/erp_kayan?schema=public',
    'ADMIN_DATABASE_URL': 'postgresql://postgres:postgres@127.0.0.1:5432/postgres',
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
    return RuntimeSettings(values, port);
  }

  /// The settings for a desktop installation, written once.
  static String _firstRunFile() {
    final random = Random.secure();
    String secret() => base64Url.encode(List<int>.generate(48, (_) => random.nextInt(256)));
    return '''
# KAYAN ERP - the settings this installation runs with.
#
# Written automatically the first time the program started, on this machine
# only. It is never part of the program's files and never leaves this computer.
#
# The one line you may need to change is DATABASE_URL: it says which PostgreSQL
# the program reads and writes. The defaults match a PostgreSQL installed on
# this machine with the setup scripts in the project.
#
# After editing, close the program completely and open it again.

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
        'HOST': _values['HOST'] ?? '127.0.0.1',
      };

  String? get databaseUrl => _values['DATABASE_URL'];
}
