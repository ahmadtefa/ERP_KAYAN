import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../logging/app_logger.dart';
import '../preferences/text_scale.dart';

/// The small part of the platform keystore this class needs.
///
/// Extracted so a test can present a storage that refuses to work - which is
/// exactly what a browser does when the page was not served over HTTPS - and
/// prove that a sign-in still succeeds.
abstract interface class SecureTokenBackend {
  Future<void> write(String key, String value);
  Future<String?> read(String key);
  Future<void> delete(String key);
}

/// The real keystore: Windows Credential Manager, the macOS keychain, the
/// Linux secret service, or WebCrypto in the browser.
class PlatformSecureTokenBackend implements SecureTokenBackend {
  PlatformSecureTokenBackend([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

/// Persists authentication tokens in the platform keystore and non-sensitive
/// preferences (such as the selected locale and text size) in shared
/// preferences.
///
/// Tokens are never written to shared preferences or to logs.
///
/// A browser only exposes WebCrypto - which the secure-storage plugin needs -
/// when the page is a *secure context*: HTTPS, or `localhost`. A copy of the
/// program opened over the company network at `http://192.168.1.20:3000` is
/// not one, so the plugin refuses to write. That refusal used to travel up as
/// a sign-in failure, and the person saw "an unexpected error occurred" after
/// the server had already accepted the correct password. Now the session is
/// kept in memory for the life of that page instead: the program works, and
/// the screen says plainly that the session will not survive a reload until
/// the program is served over HTTPS.
class TokenStore {
  TokenStore({FlutterSecureStorage? secureStorage, SecureTokenBackend? backend})
    : _backend = backend ?? PlatformSecureTokenBackend(secureStorage);

  final SecureTokenBackend _backend;

  static final _log = AppLogger.of('TokenStore');

  static const _kAccessToken = 'auth.access_token';
  static const _kRefreshToken = 'auth.refresh_token';
  static const _kLocale = 'app.locale';
  static const _kTextScale = 'ui.text_scale';
  static const _kRememberLogin = 'auth.remember_login';
  static const _kRememberedUsername = 'auth.remembered_username';
  static const _kRememberedPassword = 'auth.remembered_password';

  /// The tokens of the current page, kept so a refused keystore does not end
  /// a session the server has already granted.
  String? _liveAccessToken;
  String? _liveRefreshToken;
  bool _volatileSession = false;

  /// True when the session lives only in memory: it works now, and is gone
  /// after a reload. The shell shows a line explaining why.
  bool get isSessionVolatile => _volatileSession;

  Future<String?> readAccessToken() async {
    final live = _liveAccessToken;
    if (live != null && live.isNotEmpty) return live;
    return _read(_kAccessToken);
  }

  Future<String?> readRefreshToken() async {
    final live = _liveRefreshToken;
    if (live != null && live.isNotEmpty) return live;
    return _read(_kRefreshToken);
  }

  /// Stores the tokens where the platform allows it.
  ///
  /// This never throws for a storage refusal: the password was correct and the
  /// server issued a session, so a keystore problem must not be reported as a
  /// failed sign-in. The refusal is logged (without the token) and surfaced to
  /// the interface as [isSessionVolatile].
  Future<void> saveTokens({
    required String accessToken,
    String? refreshToken,
  }) async {
    _liveAccessToken = accessToken;
    if (refreshToken != null && refreshToken.isNotEmpty) {
      _liveRefreshToken = refreshToken;
    }
    try {
      await _backend.write(_kAccessToken, accessToken);
      if (refreshToken != null && refreshToken.isNotEmpty) {
        await _backend.write(_kRefreshToken, refreshToken);
      }
      _volatileSession = false;
    } catch (error) {
      _volatileSession = true;
      _log.warning(
        'The platform refused to store the session token '
        '(${error.runtimeType}). The session is kept in memory for this '
        'window only.',
      );
    }
  }

  Future<void> clear() async {
    _liveAccessToken = null;
    _liveRefreshToken = null;
    _volatileSession = false;
    await _delete(_kAccessToken);
    await _delete(_kRefreshToken);
  }

  Future<String?> readLocale() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_kLocale);
  }

  Future<void> saveLocale(String languageCode) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kLocale, languageCode);
  }

  /// The user's text size. A missing or unreadable value means the design's
  /// own size, never a crash on start-up.
  Future<double> readTextScale() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = prefs.getDouble(_kTextScale);
      return normalizeTextScale(stored ?? kDefaultTextScale);
    } catch (_) {
      return kDefaultTextScale;
    }
  }

  Future<void> saveTextScale(double scale) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_kTextScale, normalizeTextScale(scale));
  }

  Future<bool> rememberLoginEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_kRememberLogin) ?? false;
  }

  Future<String?> readRememberedUsername() async {
    if (!kIsWeb) return _read(_kRememberedUsername);
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_kRememberedUsername);
  }

  Future<String?> readRememberedPassword() async {
    // Browser storage cannot provide a trustworthy device-keystore boundary.
    if (kIsWeb) return null;
    return _read(_kRememberedPassword);
  }

  Future<void> saveRememberedLogin({
    required String username,
    required String password,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kRememberLogin, true);
    if (kIsWeb) {
      await prefs.setString(_kRememberedUsername, username);
      await _delete(_kRememberedPassword);
      return;
    }
    await _write(_kRememberedUsername, username);
    await _write(_kRememberedPassword, password);
  }

  Future<void> clearRememberedLogin() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kRememberLogin, false);
    await prefs.remove(_kRememberedUsername);
    if (!kIsWeb) {
      await _delete(_kRememberedUsername);
      await _delete(_kRememberedPassword);
    }
  }

  Future<String?> _read(String key) async {
    try {
      return await _backend.read(key);
    } catch (_) {
      // A corrupted/missing keystore entry must not crash the app.
      return null;
    }
  }

  Future<void> _write(String key, String value) async {
    try {
      await _backend.write(key, value);
    } catch (error) {
      // Remembering the login is optional; a keystore refusal must not stop
      // the person from signing in.
      _log.warning('The platform refused to store remembered credentials '
          '(${error.runtimeType}).');
    }
  }

  Future<void> _delete(String key) async {
    try {
      await _backend.delete(key);
    } catch (_) {
      // Nothing to do: the value is already unreachable.
    }
  }
}
