/// The proof that this is the same generator, not a second one.
///
/// `test/goldens/vectors.json` was produced by the Windows tool
/// (`tools/license-generator/kayan-license.mjs`) with a frozen clock. This test
/// replays the same steps through the Dart implementation and insists on the
/// same bytes: the same signed keys, the same `register.json`, the same
/// `register.mac`, the same `audit.log`. Ed25519 is deterministic, so a
/// one-character difference anywhere — a field in a different order, a space
/// in the JSON, a different date format — fails here rather than at a
/// customer's desk.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:kayan_key_generator/src/generator.dart';
import 'package:kayan_key_generator/src/json_canonical.dart';
import 'package:kayan_key_generator/src/keys.dart';
import 'package:kayan_key_generator/src/register.dart';
import 'package:path/path.dart' as p;

import 'support/memory_key_folder.dart';

Map<String, dynamic> _golden() {
  final file = File(p.join('test', 'goldens', 'vectors.json'));
  if (!file.existsSync()) {
    // Loading happens before any test starts, where expect() is not allowed.
    throw StateError('the golden vectors are missing at ${file.path}');
  }
  return Map<String, dynamic>.from(jsonDecode(file.readAsStringSync()) as Map);
}

void main() {
  final golden = _golden();
  final steps = (golden['steps'] as List).cast<Map<String, dynamic>>();

  test('the signing key derives the same public key and fingerprint', () async {
    final key = await SigningKey.fromPem(golden['keyPair']['privateKeyPem'] as String);
    final pair = golden['keyPair'] as Map<String, dynamic>;
    expect(await key.publicKeyPem(), pair['publicKeyPem']);
    expect(await key.publicKeyBase64Url(), pair['spkiBase64url']);
    expect(await key.fingerprint(), pair['fingerprint']);
  });

  test('terms and month arithmetic match the Windows tool', () {
    for (final entry in (golden['terms'] as List).cast<Map<String, dynamic>>()) {
      expect(
        parseTerm(entry['text'] as String).toJson(),
        entry['term'],
        reason: 'term "${entry['text']}"',
      );
    }
    for (final entry in (golden['monthCases'] as List)) {
      final row = entry as List;
      final from = DateTime.parse(row[0] as String);
      final months = (row[1] as num).toInt();
      expect(iso(addMonths(from, months)), row[2], reason: '${row[0]} + $months');
    }
  });

  test('the request code is read exactly as the product writes it', () {
    final request = parseRequestCode(golden['requestCode'] as String);
    expect(request.machineId, 'KM-REQ1-AAAA-BBBB-CCCC');
    expect(request.installId, 'inst-9f2c');
    expect(request.appVersion, '0.2.0');
    expect(request.requestedAt, '2026-02-28T18:30:00.000Z');
    expect(request.nonce, 'n-77aa');

    // One character removed from the checksum: refused before anything else.
    final broken = golden['requestCode'] as String;
    expect(
      () => parseRequestCode(broken.substring(0, broken.length - 1)),
      throwsA(isA<Refusal>()),
    );
  });

  test('every step produces the same bytes as the Windows tool', () async {
    final home = Directory.systemTemp.createTempSync('kayan-android-golden-');
    addTearDown(() {
      try {
        home.deleteSync(recursive: true);
      } catch (_) {
        // A left-over temp directory is not a test failure.
      }
    });

    final syntheticKey = await SigningKey.fromPem(golden['keyPair']['privateKeyPem'] as String);
    File(p.join(home.path, 'public-key.pem'))
        .writeAsStringSync(golden['keyPair']['publicKeyPem'] as String);

    // The identifiers came from the Windows run; the test replays them so the
    // comparison is about the rules, not about random numbers.
    final licenceIds = steps
        .where((step) => step['action'] == 'createLicence')
        .map((step) => step['licenseId'] as String)
        .toList();
    final keyIds = steps
        .where((step) => step['action'] == 'issueKey')
        .map((step) => step['keyId'] as String)
        .toList();

    var now = DateTime.parse('2026-03-01T09:00:00.000Z');
    final folder = MemoryKeyFolder(home.path, syntheticKey, clock: () => now);
    final generator = LicenceGenerator(
      folder,
      nextLicenceId: () => licenceIds.removeAt(0),
      nextKeyId: () => keyIds.removeAt(0),
    );

    for (final step in steps) {
      now = DateTime.parse(step['clock'] as String);
      final label = step['label'] as String;
      final input = (step['input'] as Map?)?.cast<String, dynamic>() ?? const {};
      switch (step['action']) {
        case 'createLicence':
          final result = await generator.createLicence(
            ref: input['ref'] as String?,
            seats: input['seats'],
            term: input['term'] as String?,
          );
          expect(result.licence.licenseId, step['licenseId'], reason: label);
        case 'issueKey':
          final result = await generator.issueKey(
            type: input['type'] as String,
            licenceId: input['licenceId'] as String,
            machineId: input['machineId'],
            request: input['request'] as String?,
            term: input['term'] as String?,
            seats: input['seats'],
            increase: input['increase'],
            cap: input['cap'],
            used: input['used'],
            note: input['note'] as String?,
          );
          expect(result.payload['keyId'], step['keyId'], reason: label);
          expect(result.key, step['key'], reason: label);
        case 'markUsed':
          final key = await generator.markUsed(step['keyId'] as String);
          expect(key.status, 'used', reason: label);
        case 'revokeKey':
          final key = await generator.revoke(step['keyId'] as String, step['reason'] as String);
          expect(key.status, 'revoked', reason: label);
        case 'verifyKey':
          final result = await generator.verifyKey(step['key'] as String);
          expect(result.valid, isTrue, reason: label);
        default:
          fail('unknown step action ${step['action']}');
      }
    }

    expect(
      File(p.join(home.path, 'register.json')).readAsStringSync(),
      golden['registerText'],
      reason: 'the register file differs from the one the Windows tool wrote',
    );
    expect(
      File(p.join(home.path, 'register.mac')).readAsStringSync().trim(),
      golden['registerMac'],
      reason: 'the register checksum differs',
    );
    expect(
      File(p.join(home.path, 'audit.log')).readAsStringSync(),
      golden['auditText'],
      reason: 'the audit log differs',
    );

    // Identifiers are drawn from the golden file; if a rule consumed one
    // without producing a key, the queues would still hold it.
    expect(licenceIds, isEmpty);
    expect(keyIds, isEmpty);
  });

  test('the register the Windows tool wrote opens here and re-seals identically', () async {
    final home = Directory.systemTemp.createTempSync('kayan-android-open-');
    addTearDown(() => home.deleteSync(recursive: true));
    final syntheticKey = await SigningKey.fromPem(golden['keyPair']['privateKeyPem'] as String);
    File(p.join(home.path, 'public-key.pem'))
        .writeAsStringSync(golden['keyPair']['publicKeyPem'] as String);
    File(p.join(home.path, 'register.json'))
        .writeAsStringSync(golden['registerText'] as String);
    File(p.join(home.path, 'register.mac'))
        .writeAsStringSync('${golden['registerMac']}\n');

    final folder = MemoryKeyFolder(home.path, syntheticKey);
    final key = await folder.readSigningKey();
    final register = await folder.loadRegister(key);
    expect(register.licences, hasLength(2));
    expect(register.keys, hasLength(9));

    await folder.saveRegister(key, register);
    expect(File(p.join(home.path, 'register.json')).readAsStringSync(), golden['registerText']);
    expect(
      File(p.join(home.path, 'register.mac')).readAsStringSync(),
      golden['registerMac'],
    );
  });

  test('a register edited by hand is refused, not trusted', () async {
    final home = Directory.systemTemp.createTempSync('kayan-android-tamper-');
    addTearDown(() => home.deleteSync(recursive: true));
    final syntheticKey = await SigningKey.fromPem(golden['keyPair']['privateKeyPem'] as String);
    File(p.join(home.path, 'public-key.pem'))
        .writeAsStringSync(golden['keyPair']['publicKeyPem'] as String);
    final registerText = golden['registerText'] as String;
    File(p.join(home.path, 'register.json'))
        .writeAsStringSync(registerText.replaceFirst('"seatsUsed": 4', '"seatsUsed": 1'));
    File(p.join(home.path, 'register.mac'))
        .writeAsStringSync('${golden['registerMac']}\n');

    final folder = MemoryKeyFolder(home.path, syntheticKey);
    final key = await folder.readSigningKey();
    await expectLater(folder.loadRegister(key), throwsA(isA<Refusal>()));
  });
}
