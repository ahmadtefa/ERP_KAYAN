import 'package:logging/logging.dart';

/// Central logging entry point.
///
/// Financial data, credentials and tokens must never be logged.
class AppLogger {
  AppLogger._();

  static bool _initialised = false;

  static void init({bool verbose = false}) {
    if (_initialised) return;
    _initialised = true;
    Logger.root.level = verbose ? Level.ALL : Level.INFO;
    Logger.root.onRecord.listen((record) {
      // ignore: avoid_print
      print('[${record.level.name}] ${record.loggerName}: ${record.message}');
    });
  }

  static Logger of(String name) => Logger(name);
}
