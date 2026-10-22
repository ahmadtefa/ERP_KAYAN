import 'package:erp_kayan/core/storage/token_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A keystore that refuses everything, exactly as the browser plugin does when
/// the page is not a secure context (`http://` on a LAN address).
class _RefusingBackend implements SecureTokenBackend {
  int writes = 0;

  @override
  Future<void> write(String key, String value) async {
    writes += 1;
    throw UnsupportedError('FlutterSecureStorageWeb only works in secure contexts');
  }

  @override
  Future<String?> read(String key) async => null;

  @override
  Future<void> delete(String key) async => throw UnsupportedError('no storage');
}

class _MemoryBackend implements SecureTokenBackend {
  final Map<String, String> values = {};

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> delete(String key) async => values.remove(key);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('a refused keystore does not fail the sign-in', () {
    test('saving the tokens succeeds and the session works in memory', () async {
      final backend = _RefusingBackend();
      final store = TokenStore(backend: backend);

      // This is the call that used to throw and become "unexpected error".
      await store.saveTokens(accessToken: 'access-1', refreshToken: 'refresh-1');

      expect(store.isSessionVolatile, isTrue);
      expect(await store.readAccessToken(), 'access-1');
      expect(await store.readRefreshToken(), 'refresh-1');
      expect(backend.writes, 1);
    });

    test('a later sign-in replaces the in-memory session', () async {
      final store = TokenStore(backend: _RefusingBackend());
      await store.saveTokens(accessToken: 'first', refreshToken: 'r1');
      await store.saveTokens(accessToken: 'second', refreshToken: 'r2');
      expect(await store.readAccessToken(), 'second');
      expect(await store.readRefreshToken(), 'r2');
    });

    test('signing out clears the in-memory session too', () async {
      final store = TokenStore(backend: _RefusingBackend());
      await store.saveTokens(accessToken: 'access-1', refreshToken: 'refresh-1');
      await store.clear();
      expect(await store.readAccessToken(), isNull);
      expect(await store.readRefreshToken(), isNull);
      expect(store.isSessionVolatile, isFalse);
    });
  });

  group('a working keystore', () {
    test('stores the pair, and the value survives a new store', () async {
      final backend = _MemoryBackend();
      final store = TokenStore(backend: backend);
      await store.saveTokens(accessToken: 'access-1', refreshToken: 'refresh-1');

      expect(store.isSessionVolatile, isFalse);
      expect(backend.values['auth.access_token'], 'access-1');
      expect(backend.values['auth.refresh_token'], 'refresh-1');

      // A fresh instance - the program reopened - reads the same tokens.
      final reopened = TokenStore(backend: backend);
      expect(await reopened.readAccessToken(), 'access-1');
      expect(await reopened.readRefreshToken(), 'refresh-1');
      expect(reopened.isSessionVolatile, isFalse);
    });

    test('clearing removes both tokens', () async {
      final backend = _MemoryBackend();
      final store = TokenStore(backend: backend);
      await store.saveTokens(accessToken: 'a', refreshToken: 'r');
      await store.clear();
      expect(backend.values, isEmpty);
    });
  });

  group('remembered credentials survive a refused keystore', () {
    test('remembering a login never throws', () async {
      final store = TokenStore(backend: _RefusingBackend());
      // The username and the remember flag are plain preferences; only the
      // password needs the keystore.
      await store.saveRememberedLogin(username: 'admin', password: 'secret');
      expect(await store.rememberLoginEnabled(), isTrue);
    });
  });

  group('text size preference', () {
    test('is the design size until the person chooses another', () async {
      final store = TokenStore(backend: _MemoryBackend());
      expect(await store.readTextScale(), 1.0);
    });

    test('is saved and read back after a restart', () async {
      final store = TokenStore(backend: _MemoryBackend());
      await store.saveTextScale(1.25);

      final reopened = TokenStore(backend: _MemoryBackend());
      // Same preferences plug-in, so the value is shared, as it is on a device.
      expect(await reopened.readTextScale(), 1.25);
    });

    test('an out-of-range stored value is normalised on read', () async {
      SharedPreferences.setMockInitialValues({'ui.text_scale': 7.5});
      final store = TokenStore(backend: _MemoryBackend());
      expect(await store.readTextScale(), 1.4);
    });

    test('a corrupt stored type falls back to the default', () async {
      SharedPreferences.setMockInitialValues({'ui.text_scale': 'huge'});
      final store = TokenStore(backend: _MemoryBackend());
      expect(await store.readTextScale(), 1.0);
    });
  });
}
