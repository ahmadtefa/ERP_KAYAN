import 'dart:io';
import 'dart:ui' show AppExitResponse;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme/app_theme.dart';
import '../config/app_config.dart';
import '../../features/data/presentation/providers/data_providers.dart';
import 'local_backend.dart';

/// Whether this copy of the program owns its API server.
///
/// Only a release build on a desktop platform does. A debug build is a
/// developer's machine, where the server is already running in a terminal and
/// starting a second one would fight it for the database; a web build has no
/// processes to start at all.
bool get ownsItsBackend =>
    !kIsWeb && kReleaseMode && (Platform.isWindows || Platform.isLinux || Platform.isMacOS);

/// Starts the API server a desktop installation needs, then hands over to the
/// program.
///
/// A release build on Windows, Linux or macOS begins here: the window opens,
/// this widget starts the server, waits for it to answer, and only then builds
/// the program's own screens. Everything after that point is the same program
/// as on the web - it simply talks to an address on this machine.
class BackendGate extends StatefulWidget {
  const BackendGate({super.key, required this.child});

  final Widget child;

  @override
  State<BackendGate> createState() => _BackendGateState();
}

class _BackendGateState extends State<BackendGate> {
  LocalBackendStatus? _status;
  bool _working = false;
  AppLifecycleListener? _lifecycle;

  @override
  void initState() {
    super.initState();
    // Closing the window stops the server this copy started, so nothing is
    // left running behind a closed program. On Windows this is the polite
    // path; the window's own job object is the guarantee for the impolite one
    // (Task Manager, a crash) - see windows/runner/main.cpp.
    _lifecycle = AppLifecycleListener(
      onExitRequested: () async {
        await LocalBackend.shutdown();
        return AppExitResponse.exit;
      },
    );

    if (ownsItsBackend) {
      _start();
    } else {
      // Development, and every web build: nothing to start.
      _status = const LocalBackendStatus.unsupported();
    }
  }

  @override
  void dispose() {
    _lifecycle?.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    setState(() => _working = true);
    final status = await LocalBackend.ensureRunning(appDisplayName: 'KAYAN ERP');
    if (!mounted) return;
    setState(() {
      _status = status;
      _working = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final status = _status;

    // Not a desktop installation: straight through, exactly as before.
    if (status == null || (!status.isReady && status.problem == null)) {
      return _working ? const _Waiting() : widget.child;
    }

    if (status.needsFirstAdministrator) {
      // The database is ready and has nobody in it yet: this is a fresh
      // installation. Whoever is setting the company up chooses the first
      // administrator here, and then the program continues normally.
      return _FirstAdministrator(onCreated: _start, onStatus: (next) {
        setState(() => _status = next);
      });
    }

    if (status.isReady) {
      // The program runs against the server this machine just started. The
      // address is injected here so no screen needs to know where it came from.
      return ProviderScope(
        overrides: [
          appConfigProvider.overrideWithValue(
            AppConfig.forLocalServer(status.baseUrl!),
          ),
        ],
        child: widget.child,
      );
    }

    return _CouldNotStart(
      message: status.problem ?? 'unknown',
      logPath: status.logPath,
      databaseProblem: status.databaseProblem,
      onRetry: _start,
    );
  }
}

/// The moment between the window opening and the program being ready. It is
/// short - usually a second or two - but it is honest about what is happening,
/// because a blank window looks like a crash.
class _Waiting extends StatelessWidget {
  const _Waiting();

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      home: const Scaffold(
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 32,
                height: 32,
                child: CircularProgressIndicator(strokeWidth: 3),
              ),
              SizedBox(height: 20),
              Text('جارٍ تشغيل البرنامج…', style: TextStyle(fontSize: 16)),
              SizedBox(height: 6),
              Text('Starting KAYAN ERP…', style: TextStyle(fontSize: 13, color: Colors.grey)),
            ],
          ),
        ),
      ),
    );
  }
}

/// The first run on a machine whose database is empty.
///
/// The program creates the company's structure and its first administrator, but
/// it will not invent the credentials: they are chosen here. Nothing is
/// published, nothing is default, and no password travels inside the program.
class _FirstAdministrator extends StatefulWidget {
  const _FirstAdministrator({required this.onCreated, required this.onStatus});

  /// Runs the ordinary start again, which is what makes the program usable.
  final Future<void> Function() onCreated;

  /// Reports a failure without leaving this screen.
  final void Function(LocalBackendStatus) onStatus;

  @override
  State<_FirstAdministrator> createState() => _FirstAdministratorState();
}

class _FirstAdministratorState extends State<_FirstAdministrator> {
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _again = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _again.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    final username = _username.text.trim();
    final password = _password.text;
    if (username.length < 3) {
      setState(() => _error = 'اسم المستخدم لازم ٣ حروف على الأقل');
      return;
    }
    if (password.length < 8) {
      setState(() => _error = 'كلمة السر لازم ٨ حروف على الأقل');
      return;
    }
    if (password != _again.text) {
      setState(() => _error = 'كلمة السر والتأكيد مش زي بعض');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final status = await LocalBackend.createFirstAdministrator(
      username: username,
      password: password,
      appDisplayName: 'KAYAN ERP',
    );
    if (!mounted) return;
    if (status.isReady) {
      setState(() => _busy = false);
      await widget.onCreated();
      return;
    }
    setState(() {
      _busy = false;
      _error = status.problem ?? 'مقدرتش أعمل الحساب';
    });
    widget.onStatus(status);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      home: Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          body: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'أول تشغيل على الجهاز ده',
                      style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'First run on this machine',
                      style: TextStyle(fontSize: 13, color: Colors.grey),
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'قاعدة البيانات جاهزة ومفيهاش أي مستخدم لسه. اكتب اسم '
                      'المستخدم وكلمة السر لحساب المدير بتاع الشركة. '
                      'مفيش أي كلمة سر جاهزة جوّه البرنامج.',
                      style: TextStyle(fontSize: 14, height: 1.6),
                    ),
                    const SizedBox(height: 24),
                    TextField(
                      controller: _username,
                      enabled: !_busy,
                      decoration: const InputDecoration(
                        labelText: 'اسم المستخدم / Username',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _password,
                      enabled: !_busy,
                      obscureText: true,
                      decoration: const InputDecoration(
                        labelText: 'كلمة السر / Password',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _again,
                      enabled: !_busy,
                      obscureText: true,
                      onSubmitted: (_) => _busy ? null : _create(),
                      decoration: const InputDecoration(
                        labelText: 'تأكيد كلمة السر / Confirm',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    ],
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      onPressed: _busy ? null : _create,
                      icon: _busy
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.check),
                      label: const Text('إنشاء الحساب والبدء'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Shown when the server could not be started.
///
/// The words are in both languages on purpose: this is the one screen that
/// appears before the translation files are available, and it must be readable
/// by whoever is standing in front of the machine.
class _CouldNotStart extends StatelessWidget {
  const _CouldNotStart({
    required this.message,
    required this.logPath,
    required this.databaseProblem,
    required this.onRetry,
  });

  final String message;
  final String? logPath;
  final bool databaseProblem;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      home: Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          body: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 620),
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Icon(Icons.error_outline, size: 44, color: scheme.error),
                    const SizedBox(height: 16),
                    const Text(
                      'السيرفر المحلي ما اشتغلش',
                      style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'The local server did not start',
                      style: TextStyle(fontSize: 13, color: Colors.grey),
                    ),
                    const SizedBox(height: 20),
                    Text(message, style: const TextStyle(fontSize: 15)),
                    if (databaseProblem) ...[
                      const SizedBox(height: 12),
                      Text(
                        'قاعدة البيانات (PostgreSQL) مش شغالة أو الإعدادات غلط. '
                        'شغّل خدمة PostgreSQL، أو عدّل سطر DATABASE_URL في ملف '
                        'الإعدادات المذكور تحت، وبعدين اقفل البرنامج وافتحه تاني.',
                        style: const TextStyle(fontSize: 14),
                      ),
                    ],
                    const SizedBox(height: 20),
                    if (logPath != null)
                      SelectableText(
                        'ملف السجل / log file:\n$logPath',
                        style: const TextStyle(fontSize: 12, fontFamily: 'monospace'),
                      ),
                    const SizedBox(height: 24),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        FilledButton.icon(
                          onPressed: () => onRetry(),
                          icon: const Icon(Icons.refresh),
                          label: const Text('حاول تاني / Try again'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
