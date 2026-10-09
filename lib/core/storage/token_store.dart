import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Persists authentication tokens in the platform keystore and non-sensitive
/// preferences (such as the selected locale) in shared preferences.
///
/// Tokens are never written to shared preferences or to logs.
class TokenStore {
  TokenStore({FlutterSecureStorage? secureStorage})
    : _secure = secureStorage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _secure;

  static const _kAccessToken = 'auth.access_token';
  static const _kRefreshToken = 'auth.refresh_token';
  static const _kLocale = 'app.locale';
  static const _kRememberLogin = 'auth.remember_login';
  static const _kRememberedUsername = 'auth.remembered_username';
  static const _kRememberedPassword = 'auth.remembered_password';

  Future<String?> readAccessToken() => _read(_kAccessToken);
  Future<String?> readRefreshToken() => _read(_kRefreshToken);

  Future<void> saveTokens({
    required String accessToken,
    String? refreshToken,
  }) async {
    await _secure.write(key: _kAccessToken, value: accessToken);
    if (refreshToken != null) {
      await _secure.write(key: _kRefreshToken, value: refreshToken);
    }
  }

  Future<void> clear() async {
    await _secure.delete(key: _kAccessToken);
    await _secure.delete(key: _kRefreshToken);
  }

  Future<String?> readLocale() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_kLocale);
  }

  Future<void> saveLocale(String languageCode) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kLocale, languageCode);
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
      await _secure.delete(key: _kRememberedPassword);
      return;
    }
    await _secure.write(key: _kRememberedUsername, value: username);
    await _secure.write(key: _kRememberedPassword, value: password);
  }

  Future<void> clearRememberedLogin() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kRememberLogin, false);
    await prefs.remove(_kRememberedUsername);
    if (!kIsWeb) {
      await _secure.delete(key: _kRememberedUsername);
      await _secure.delete(key: _kRememberedPassword);
    }
  }

  Future<String?> _read(String key) async {
    try {
      return await _secure.read(key: key);
    } catch (_) {
      // A corrupted/missing keystore entry must not crash the app.
      return null;
    }
  }
}
