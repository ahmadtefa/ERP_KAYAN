/// Remembers the signer-in's username (and, where the platform can keep a
/// secret safely, the password) so the next sign-in can be quick.
///
/// The rules, chosen deliberately:
///
///  * "Remember me" is off by default — a shared office computer must not
///    remember anything unless the person at the keyboard asks for it.
///  * The username is kept in shared preferences. It is not a secret; it is
///    the same thing the person types in front of everyone.
///  * The password is NEVER written to shared preferences, local storage or
///    a settings file. On platforms with a keystore (Windows credential
///    manager, macOS/iOS keychain, Android keystore) it is kept there, the
///    same store the session tokens already use. On the web there is no such
///    store, so the password is not kept at all — only the username.
///  * Everything can be cleared in one tap from the sign-in screen.
library;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The three things the store needs from a keystore, as plain callbacks —
/// so the rules can be tested without one.
typedef SecretRead = Future<String?> Function(String key);
typedef SecretWrite = Future<void> Function(String key, String value);
typedef SecretDelete = Future<void> Function(String key);

class CredentialsStore {
  CredentialsStore({
    SecretRead? readSecret,
    SecretWrite? writeSecret,
    SecretDelete? deleteSecret,
    bool? canStorePassword,
  }) : this._(readSecret, writeSecret, deleteSecret, canStorePassword);

  CredentialsStore._(
    this._readSecret,
    this._writeSecret,
    this._deleteSecret,
    this._canStorePassword,
  );

  /// The platform keystore, used only through these three callbacks.
  final SecretRead? _readSecret;
  final SecretWrite? _writeSecret;
  final SecretDelete? _deleteSecret;

  /// Overridable for tests; decided at runtime otherwise.
  final bool? _canStorePassword;

  static const _kRemember = 'login.remember';
  static const _kUsername = 'login.username';
  static const _kPassword = 'login.password';

  static const FlutterSecureStorage _secure = FlutterSecureStorage();

  Future<String?> _keystoreRead(String key) async {
    final read = _readSecret;
    if (read != null) return read(key);
    try {
      return await _secure.read(key: key);
    } catch (_) {
      return null;
    }
  }

  Future<void> _keystoreWrite(String key, String value) async {
    final write = _writeSecret;
    if (write != null) return write(key, value);
    await _secure.write(key: key, value: value);
  }

  Future<void> _keystoreDelete(String key) async {
    final delete = _deleteSecret;
    if (delete != null) return delete(key);
    await _secure.delete(key: key);
  }

  /// Whether this platform can keep a password in a real keystore.
  ///
  /// The web cannot: a browser has no keystore a page may use for this, and
  /// local storage is open to any script. Everywhere the app runs natively,
  /// `flutter_secure_storage` is backed by the operating system's own vault.
  bool get canStorePassword =>
      _canStorePassword ??
      const bool.fromEnvironment('dart.library.js_interop') == false;

  Future<bool> isRemembered() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getBool(_kRemember) ?? false;
    } catch (_) {
      return false;
    }
  }

  Future<String?> savedUsername() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getString(_kUsername);
    } catch (_) {
      return null;
    }
  }

  /// The saved password, only ever from the keystore — never from plain
  /// preferences. Null on the web and whenever nothing was saved.
  Future<String?> savedPassword() async {
    if (!canStorePassword) return null;
    try {
      return await _keystoreRead(_kPassword);
    } catch (_) {
      return null;
    }
  }

  /// Stores what the person asked to be remembered, and forgets the rest.
  Future<void> save({
    required bool remember,
    required String username,
    String? password,
  }) async {
    final SharedPreferences prefs;
    try {
      prefs = await SharedPreferences.getInstance();
    } catch (_) {
      return;
    }
    await prefs.setBool(_kRemember, remember);
    if (!remember) {
      await _forget(prefs);
      return;
    }
    await prefs.setString(_kUsername, username);
    if (password != null && password.isNotEmpty && canStorePassword) {
      try {
        await _keystoreWrite(_kPassword, password);
      } catch (_) {
        // A keystore that refuses to write must not break the sign-in that
        // just succeeded; the username alone is remembered.
      }
    }
  }

  /// Wipes every remembered credential — the checkbox turning off does the
  /// same thing, and so does the "clear" button on the sign-in screen.
  Future<void> clear() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_kRemember, false);
      await _forget(prefs);
    } catch (_) {
      // Nothing was remembered in the first place.
    }
  }

  Future<void> _forget(SharedPreferences prefs) async {
    await prefs.remove(_kUsername);
    try {
      await _keystoreDelete(_kPassword);
    } catch (_) {
      // Nothing to delete, or the keystore is unavailable; either way the
      // plain-preferences side is already clean.
    }
  }
}
