import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:kayan_key_generator/src/keys.dart';
import 'package:kayan_key_generator/src/register.dart';
import 'package:path/path.dart' as p;

void main() {
  test('production policy accepts only the approved public fingerprint', () {
    expect(() => enforceLicenceKeyPolicy(
      LicenceKeyPolicy.production, approvedProductionFingerprint), returnsNormally);
    expect(() => enforceLicenceKeyPolicy(
      LicenceKeyPolicy.production, '0000-0000-0000-0000-0000-0000-0000-0000'),
      throwsA(isA<Refusal>()));
  });

  test('test-only policy refuses the production fingerprint', () {
    expect(() => enforceLicenceKeyPolicy(
      LicenceKeyPolicy.testOnly, approvedProductionFingerprint), throwsA(isA<Refusal>()));
    expect(() => enforceLicenceKeyPolicy(
      LicenceKeyPolicy.testOnly, '0000-0000-0000-0000-0000-0000-0000-0000'), returnsNormally);
  });

  test('production rejects a synthetic key before creating or writing the folder', () async {
    final parent = Directory.systemTemp.createTempSync('kayan-policy-');
    addTearDown(() => parent.deleteSync(recursive: true));
    final dir = p.join(parent.path, 'not-created');
    final folder = KeyFolder(dir, policy: LicenceKeyPolicy.production);
    final synthetic = await SigningKey.fromSeed(List<int>.filled(32, 23));
    await expectLater(folder.writeKeyPair(synthetic), throwsA(isA<Refusal>()));
    await expectLater(folder.createKeyPair(), throwsA(isA<Refusal>()));
    expect(Directory(dir).existsSync(), isFalse);
  });
}
