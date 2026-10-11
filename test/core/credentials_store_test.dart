import 'package:erp_kayan/core/storage/credentials_store.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Remembering a signer-in is a promise with rules: off by default, the
/// password never in plain preferences, everything clearable. These tests
/// are the promise.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Map<String, String> vault;

  CredentialsStore store({bool canStorePassword = true}) => CredentialsStore(
    readSecret: (key) async => vault[key],
    writeSecret: (key, value) async {
      vault[key] = value;
    },
    deleteSecret: (key) async {
      vault.remove(key);
    },
    canStorePassword: canStorePassword,
  );

  setUp(() {
    vault = <String, String>{};
    SharedPreferences.setMockInitialValues({});
  });

  test('remembers nothing until asked', () async {
    final s = store();
    expect(await s.isRemembered(), isFalse);
    expect(await s.savedUsername(), isNull);
    expect(await s.savedPassword(), isNull);
  });

  test(
    'with remember on, keeps the username and the password in the keystore',
    () async {
      final s = store();
      await s.save(remember: true, username: 'sara', password: 'p@ss');

      expect(await s.isRemembered(), isTrue);
      expect(await s.savedUsername(), 'sara');
      expect(await s.savedPassword(), 'p@ss');

      // The password must not be sitting in plain preferences.
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('login.password'), isNull);
    },
  );

  test('with remember off, stores nothing at all', () async {
    final s = store();
    await s.save(remember: false, username: 'sara', password: 'p@ss');

    expect(await s.isRemembered(), isFalse);
    expect(await s.savedUsername(), isNull);
    expect(await s.savedPassword(), isNull);
    expect(vault, isEmpty);
  });

  test(
    'on a platform without a keystore (the web), the username alone is kept',
    () async {
      final s = store(canStorePassword: false);
      await s.save(remember: true, username: 'sara', password: 'p@ss');

      expect(await s.savedUsername(), 'sara');
      expect(await s.savedPassword(), isNull);
      // And nothing anywhere claims otherwise.
      expect(vault, isEmpty);
    },
  );

  test('clear wipes the username and the keystore', () async {
    final s = store();
    await s.save(remember: true, username: 'sara', password: 'p@ss');
    await s.clear();

    expect(await s.isRemembered(), isFalse);
    expect(await s.savedUsername(), isNull);
    expect(await s.savedPassword(), isNull);
    expect(vault, isEmpty);
  });

  test('turning remember off on save also clears what was there', () async {
    final s = store();
    await s.save(remember: true, username: 'sara', password: 'p@ss');
    await s.save(remember: false, username: 'sara', password: 'p@ss');

    expect(await s.savedUsername(), isNull);
    expect(vault, isEmpty);
  });
}
