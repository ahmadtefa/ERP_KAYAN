// Real register and widget coverage with a synthetic signing key held only in
// memory. Temporary files contain public/register data, never a private key.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kayan_key_generator/main.dart';
import 'package:kayan_key_generator/src/bundle.dart';
import 'package:kayan_key_generator/src/generator.dart';
import 'package:kayan_key_generator/src/keys.dart';
import 'package:kayan_key_generator/src/register.dart';

import 'support/memory_key_folder.dart';

void main() {
  late Directory home;
  late SigningKey key;
  late MemoryKeyFolder folder;

  setUp(() async {
    home = await Directory.systemTemp.createTemp('kayan-memory-register-');
    key = await SigningKey.fromSeed(List<int>.generate(32, (index) => index + 1));
    folder = MemoryKeyFolder(home.path, key);
    await File(folder.publicKeyPath).writeAsString(await key.publicKeyPem());
  });

  tearDown(() async {
    await home.delete(recursive: true);
  });

  test('register is authenticated, rejects tampering and an unrelated key', () async {
    final generator = LicenceGenerator(folder);
    final created = await generator.createLicence(ref: 'Synthetic company', seats: 5, term: '1y');
    final loaded = await folder.loadRegister(key);
    expect(loaded.licences[created.licence.licenseId]?.seats, 5);
    final other = await SigningKey.fromSeed(List<int>.filled(32, 64));
    await expectLater(folder.loadRegister(other), throwsA(isA<Refusal>()));
    final data = await File(folder.registerPath).readAsString();
    await File(folder.registerPath).writeAsString(data.replaceFirst('Synthetic company', 'Tampered company'));
    await expectLater(folder.loadRegister(key), throwsA(isA<Refusal>()));
    expect(File(folder.privateKeyPath).existsSync(), isFalse);
  });

  test('public bundle validates the existing in-memory key and MAC before writing', () async {
    final generator = LicenceGenerator(folder);
    await generator.createLicence(ref: 'Synthetic company', seats: 5, term: '1y');
    final original = await File(folder.registerPath).readAsString();
    final envelope = jsonDecode(exportBundle(folder, includePrivateKey: false)) as Map<String, dynamic>;
    final files = Map<String, dynamic>.from(envelope['files'] as Map);
    files['register.json'] = original.replaceFirst('Synthetic company', 'Tampered company');
    envelope['files'] = files;
    await expectLater(importBundle(folder, jsonEncode(envelope)), throwsA(isA<Refusal>()));
    expect(await File(folder.registerPath).readAsString(), original);
    final other = await SigningKey.fromSeed(List<int>.filled(32, 64));
    final mismatch = jsonDecode(exportBundle(folder, includePrivateKey: false)) as Map<String, dynamic>;
    final mismatchFiles = Map<String, dynamic>.from(mismatch['files'] as Map);
    mismatchFiles['private-key.pem'] = other.privateKeyPem;
    mismatch['files'] = mismatchFiles;
    await expectLater(importBundle(folder, jsonEncode(mismatch)), throwsA(isA<Refusal>()));
    expect(await File(folder.registerPath).readAsString(), original);
    expect(File(folder.privateKeyPath).existsSync(), isFalse);
    await importBundle(folder, exportBundle(folder, includePrivateKey: false));
    expect((await folder.loadRegister(key)).licences, hasLength(1));
  });

  testWidgets('issue window shows the synthetic licence and fingerprint', (tester) async {
    final state = OperatorState(folder);
    await tester.runAsync(() async {
      await state.generator.createLicence(ref: 'Synthetic company', seats: 5, term: '1y');
      await state.refresh();
    });
    await tester.pumpWidget(KayanKeyGeneratorApp(state: state));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('مولّد مفاتيح كيان'), findsOneWidget);
    expect(find.textContaining((await key.fingerprint()).substring(0, 9)), findsWidgets);
    expect(find.textContaining('Synthetic company'), findsWidgets);
    expect(find.byType(Scaffold), findsWidgets);
    expect(File(folder.privateKeyPath).existsSync(), isFalse);
  });
}
