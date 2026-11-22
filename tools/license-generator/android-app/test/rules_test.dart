/// The licensing rules, exercised here the way `licensing.service.spec.ts` and
/// the generator spec exercise them on the desktop: a refusal must stay a
/// refusal, and a seat must never come back.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:kayan_key_generator/src/bundle.dart';
import 'package:kayan_key_generator/src/generator.dart';
import 'package:kayan_key_generator/src/json_canonical.dart';
import 'package:kayan_key_generator/src/keys.dart';
import 'package:kayan_key_generator/src/register.dart';
import 'package:path/path.dart' as p;

import 'support/memory_key_folder.dart';

Map<String, dynamic> _golden() => Map<String, dynamic>.from(
      jsonDecode(File(p.join('test', 'goldens', 'vectors.json')).readAsStringSync()) as Map,
    );

void main() {
  late Directory home;
  late KeyFolder folder;
  late LicenceGenerator generator;
  late DateTime now;
  final golden = _golden();

  setUp(() async {
    home = Directory.systemTemp.createTempSync('kayan-rules-');
    final key = await SigningKey.fromPem(golden['keyPair']['privateKeyPem'] as String);
    File(p.join(home.path, 'public-key.pem'))
        .writeAsStringSync(golden['keyPair']['publicKeyPem'] as String);
    now = DateTime.parse('2026-03-01T09:00:00.000Z');
    folder = MemoryKeyFolder(home.path, key, clock: () => now);
    generator = LicenceGenerator(folder);
  });

  tearDown(() {
    try {
      home.deleteSync(recursive: true);
    } catch (_) {
      // A temp folder left behind is not a failure.
    }
  });

  Future<Licence> aLicence({int seats = 5, String term = '1y'}) async {
    final result = await generator.createLicence(ref: 'شركة النور', seats: seats, term: term);
    return result.licence;
  }

  group('the key format', () {
    test('a key carries the four types and verifies against this folder', () async {
      final licence = await aLicence();
      final activation = await generator.issueKey(
        type: 'ACTIVATION',
        licenceId: licence.licenseId,
        machineId: 'KM-AAAA-1111-BBBB-2222',
      );
      expect(activation.key, startsWith('KYN1.'));
      expect(activation.key!.split('.'), hasLength(3));

      final verified = await generator.verifyKey(activation.key!);
      expect(verified.valid, isTrue);
      expect(verified.payload['type'], 'ACTIVATION');
      expect(verified.payload['machineId'], 'KM-AAAA-1111-BBBB-2222');
      expect(verified.payload['seats'], {'mode': 'CAP', 'value': 5});
      expect(verified.payload['term'], {'kind': 'MONTHS', 'months': 12});
    });

    test('one character changed in the signature is refused', () async {
      final licence = await aLicence();
      final issued = await generator.issueKey(
        type: 'ACTIVATION',
        licenceId: licence.licenseId,
        machineId: 'KM-AAAA-1111-BBBB-2222',
      );
      final parts = issued.key!.split('.');
      final lead = parts[2][0] == 'A' ? 'B' : 'A';
      final tampered = '${parts[0]}.${parts[1]}.$lead${parts[2].substring(1)}';
      final verified = await generator.verifyKey(tampered);
      expect(verified.valid, isFalse);
    });

    test('a key signed by another pair is refused', () async {
      final other = await SigningKey.fromSeed(List<int>.filled(32, 7));
      final payload = <String, dynamic>{
        'v': 1,
        'keyId': 'key_0011223344556677',
        'type': 'ACTIVATION',
        'licenseId': 'lic_0011223344556677',
        'issuedAt': '2026-03-01T09:00:00.000Z',
        'machineId': 'KM-AAAA-1111-BBBB-2222',
        'term': {'kind': 'MONTHS', 'months': 12},
        'seats': {'mode': 'CAP', 'value': 5},
        'state': null,
        'note': null,
      };
      final foreign = await signPayload(payload, other);
      final verified = await generator.verifyKey(foreign);
      expect(verified.valid, isFalse);
    });

    test('text that is not a key is refused, not read', () async {
      expect(() => parseRequestCode('hello'), throwsA(isA<Refusal>()));
      await expectLater(generator.verifyKey('KYN1.abc'), throwsA(isA<Refusal>()));
    });
  });

  group('activation', () {
    test('records the machine, the limit and the expiry', () async {
      final licence = await aLicence();
      now = DateTime.parse('2026-03-01T09:00:00.000Z');
      await generator.issueKey(
        type: 'ACTIVATION',
        licenceId: licence.licenseId,
        machineId: 'KM-AAAA-1111-BBBB-2222',
      );
      final register = await folder.loadRegister(await folder.readSigningKey());
      final saved = register.licences[licence.licenseId]!;
      expect(saved.machineId, 'KM-AAAA-1111-BBBB-2222');
      expect(saved.status, 'active');
      expect(saved.startsAt, '2026-03-01T09:00:00.000Z');
      expect(saved.expiresAt, '2027-03-01T09:00:00.000Z');
    });

    test('a second activation supersedes the first, it does not stack', () async {
      final licence = await aLicence();
      await generator.issueKey(
        type: 'ACTIVATION',
        licenceId: licence.licenseId,
        machineId: 'KM-AAAA-1111-BBBB-2222',
      );
      await generator.issueKey(
        type: 'ACTIVATION',
        licenceId: licence.licenseId,
        machineId: 'KM-CCCC-3333-DDDD-4444',
      );
      final register = await folder.loadRegister(await folder.readSigningKey());
      final keys = register.keys.where((key) => key.type == 'ACTIVATION').toList();
      expect(keys, hasLength(2));
      expect(keys.first.status, 'superseded');
      expect(keys.first.supersededAt, isNotNull);
      expect(keys.last.status, 'issued');
    });

    test('a seat limit below the seats already in use is refused', () async {
      final licence = await aLicence();
      await generator.setLicence(licenceId: licence.licenseId, used: 4);
      await expectLater(
        generator.issueKey(
          type: 'ACTIVATION',
          licenceId: licence.licenseId,
          machineId: 'KM-AAAA-1111-BBBB-2222',
          seats: 3,
        ),
        throwsA(isA<Refusal>()),
      );
    });

    test('a seat limit of zero is refused: zero would mean no limit', () async {
      final licence = await aLicence();
      await expectLater(
        generator.issueKey(
          type: 'ACTIVATION',
          licenceId: licence.licenseId,
          machineId: 'KM-AAAA-1111-BBBB-2222',
          seats: 0,
        ),
        throwsA(isA<Refusal>()),
      );
    });

    test('a machine id that is not one is refused', () async {
      final licence = await aLicence();
      await expectLater(
        generator.issueKey(type: 'ACTIVATION', licenceId: licence.licenseId, machineId: 'ABC'),
        throwsA(isA<Refusal>()),
      );
    });

    test('a request code for another machine than the typed one is refused', () async {
      final licence = await aLicence();
      await expectLater(
        generator.issueKey(
          type: 'ACTIVATION',
          licenceId: licence.licenseId,
          machineId: 'KM-ZZZZ-9999-YYYY-8888',
          request: golden['requestCode'] as String,
        ),
        throwsA(isA<Refusal>()),
      );
      // …but the code on its own names the machine.
      final issued = await generator.issueKey(
        type: 'ACTIVATION',
        licenceId: licence.licenseId,
        request: golden['requestCode'] as String,
      );
      expect((issued.payload['machineId'] as String), 'KM-REQ1-AAAA-BBBB-CCCC');
    });

    test('the perpetual term keeps its meaning through an activation', () async {
      final licence = await aLicence(term: 'P');
      final issued = await generator.issueKey(
        type: 'ACTIVATION',
        licenceId: licence.licenseId,
        machineId: 'KM-AAAA-1111-BBBB-2222',
      );
      expect(issued.payload['term'], {'kind': 'PERPETUAL'});
      final register = await folder.loadRegister(await folder.readSigningKey());
      expect(register.licences[licence.licenseId]!.expiresAt, isNull);
    });
  });

  group('renewal', () {
    test('before expiry adds to the end date, after expiry starts now', () async {
      final licence = await aLicence();
      await generator.issueKey(
        type: 'ACTIVATION',
        licenceId: licence.licenseId,
        machineId: 'KM-AAAA-1111-BBBB-2222',
      );

      now = DateTime.parse('2026-06-01T00:00:00.000Z'); // still inside the year
      await generator.issueKey(type: 'RENEWAL', licenceId: licence.licenseId, term: '6m');
      var register = await folder.loadRegister(await folder.readSigningKey());
      expect(register.licences[licence.licenseId]!.expiresAt, '2027-09-01T09:00:00.000Z');

      now = DateTime.parse('2029-01-01T00:00:00.000Z'); // long past
      await generator.issueKey(type: 'RENEWAL', licenceId: licence.licenseId, term: '1m');
      register = await folder.loadRegister(await folder.readSigningKey());
      expect(register.licences[licence.licenseId]!.expiresAt, '2029-02-01T00:00:00.000Z');
    });

    test('renewing a perpetual licence keeps it perpetual', () async {
      final licence = await aLicence(term: 'P');
      await generator.issueKey(
        type: 'ACTIVATION',
        licenceId: licence.licenseId,
        machineId: 'KM-AAAA-1111-BBBB-2222',
      );
      final renewed = await generator.issueKey(
        type: 'RENEWAL',
        licenceId: licence.licenseId,
        term: 'P',
      );
      expect(renewed.payload['term'], {'kind': 'PERPETUAL'});
      final register = await folder.loadRegister(await folder.readSigningKey());
      expect(register.licences[licence.licenseId]!.expiresAt, isNull);
    });
  });

  group('seats', () {
    test('an increase is an increment, a cap is a new limit', () async {
      final licence = await aLicence(seats: 5);
      final increase = await generator.issueKey(
        type: 'SEATS',
        licenceId: licence.licenseId,
        increase: 3,
      );
      expect(increase.payload['seats'], {'mode': 'INCREASE', 'value': 3});
      var register = await folder.loadRegister(await folder.readSigningKey());
      expect(register.licences[licence.licenseId]!.seats, 8);

      final cap = await generator.issueKey(type: 'SEATS', licenceId: licence.licenseId, cap: 6);
      expect(cap.payload['seats'], {'mode': 'CAP', 'value': 6});
      register = await folder.loadRegister(await folder.readSigningKey());
      expect(register.licences[licence.licenseId]!.seats, 6);
    });

    test('a key needs exactly one of increase and cap', () async {
      final licence = await aLicence();
      await expectLater(
        generator.issueKey(type: 'SEATS', licenceId: licence.licenseId),
        throwsA(isA<Refusal>()),
      );
      await expectLater(
        generator.issueKey(type: 'SEATS', licenceId: licence.licenseId, increase: 1, cap: 9),
        throwsA(isA<Refusal>()),
      );
    });

    test('a cap below the seats in use is refused and changes nothing', () async {
      final licence = await aLicence(seats: 5);
      await generator.setLicence(licenceId: licence.licenseId, used: 4);
      await expectLater(
        generator.issueKey(type: 'SEATS', licenceId: licence.licenseId, cap: 3),
        throwsA(isA<Refusal>()),
      );
      final register = await folder.loadRegister(await folder.readSigningKey());
      expect(register.licences[licence.licenseId]!.seats, 5);
      expect(register.licences[licence.licenseId]!.seatsUsed, 4);
    });
  });

  group('transfer', () {
    Future<Licence> activated() async {
      final licence = await aLicence(seats: 5);
      await generator.issueKey(
        type: 'ACTIVATION',
        licenceId: licence.licenseId,
        machineId: 'KM-AAAA-1111-BBBB-2222',
      );
      return licence;
    }

    test('carries the term, the limit and the seats in use to the new machine', () async {
      final licence = await activated();
      await generator.setLicence(licenceId: licence.licenseId, used: 3);
      final transfer = await generator.issueKey(
        type: 'TRANSFER',
        licenceId: licence.licenseId,
        machineId: 'KM-CCCC-3333-DDDD-4444',
        used: 3,
      );
      expect(transfer.payload['machineId'], 'KM-CCCC-3333-DDDD-4444');
      expect(transfer.payload['state'], {
        'expiresAt': '2027-03-01T09:00:00.000Z',
        'seatLimit': 5,
        'seatsUsed': 3,
        'startsAt': '2026-03-01T09:00:00.000Z',
        'issuedAt': '2026-03-01T09:00:00.000Z',
      });
      final register = await folder.loadRegister(await folder.readSigningKey());
      expect(register.licences[licence.licenseId]!.machineId, 'KM-CCCC-3333-DDDD-4444');
      expect(register.licences[licence.licenseId]!.seatsUsed, 3);
    });

    test('to the machine it is already on is refused', () async {
      final licence = await activated();
      await expectLater(
        generator.issueKey(
          type: 'TRANSFER',
          licenceId: licence.licenseId,
          machineId: 'KM-AAAA-1111-BBBB-2222',
        ),
        throwsA(isA<Refusal>()),
      );
    });

    test('before any activation there is nothing to transfer', () async {
      final licence = await aLicence();
      await expectLater(
        generator.issueKey(
          type: 'TRANSFER',
          licenceId: licence.licenseId,
          machineId: 'KM-CCCC-3333-DDDD-4444',
        ),
        throwsA(isA<Refusal>()),
      );
    });

    test('more seats in use than the licence allows is refused', () async {
      final licence = await activated();
      await expectLater(
        generator.issueKey(
          type: 'TRANSFER',
          licenceId: licence.licenseId,
          machineId: 'KM-CCCC-3333-DDDD-4444',
          used: 9,
        ),
        throwsA(isA<Refusal>()),
      );
    });
  });

  group('the register', () {
    test('a key the operator withdrew cannot be marked used', () async {
      final licence = await aLicence();
      final issued = await generator.issueKey(
        type: 'ACTIVATION',
        licenceId: licence.licenseId,
        machineId: 'KM-AAAA-1111-BBBB-2222',
      );
      await generator.revoke(issued.payload['keyId'] as String, 'sent to the wrong customer');
      await expectLater(
        generator.markUsed(issued.payload['keyId'] as String),
        throwsA(isA<Refusal>()),
      );
    });

    test('a revocation without a reason is refused', () async {
      final licence = await aLicence();
      final issued = await generator.issueKey(
        type: 'ACTIVATION',
        licenceId: licence.licenseId,
        machineId: 'KM-AAAA-1111-BBBB-2222',
      );
      await expectLater(
        generator.revoke(issued.payload['keyId'] as String, '  '),
        throwsA(isA<Refusal>()),
      );
    });

    test('deleting a key row or lowering the limit never gives a seat back', () async {
      final licence = await aLicence(seats: 3);
      await generator.setLicence(licenceId: licence.licenseId, used: 3);
      await expectLater(
        generator.setLicence(licenceId: licence.licenseId, seats: 2),
        throwsA(isA<Refusal>()),
      );
      final register = await folder.loadRegister(await folder.readSigningKey());
      expect(register.licences[licence.licenseId]!.seats, 3);
      expect(register.licences[licence.licenseId]!.seatsUsed, 3);
    });

    test('two different pairs cannot share a register', () async {
      await aLicence(); // a register to try to share
      final other = await SigningKey.fromSeed(List<int>.filled(32, 9));
      final foreignHome = Directory.systemTemp.createTempSync('kayan-foreign-');
      addTearDown(() => foreignHome.deleteSync(recursive: true));
      File(p.join(foreignHome.path, 'public-key.pem')).writeAsStringSync(await other.publicKeyPem());
      for (final name in ['register.json', 'register.mac']) {
        File(p.join(foreignHome.path, name))
            .writeAsStringSync(File(p.join(home.path, name)).readAsStringSync());
      }
      final foreign = MemoryKeyFolder(foreignHome.path, other);
      final key = await foreign.readSigningKey();
      await expectLater(foreign.loadRegister(key), throwsA(isA<Refusal>()));
    });
  });

  group('moving a folder', () {
    test('a bundle without the private key imports its register and refuses keys', () async {
      final licence = await aLicence();
      final bundle = exportBundle(folder, includePrivateKey: false);
      expect(bundle, isNot(contains('BEGIN PRIVATE KEY')));

      final target = Directory.systemTemp.createTempSync('kayan-bundle-');
      addTearDown(() => target.deleteSync(recursive: true));
      final moved = KeyFolder(target.path);
      await importBundle(moved, bundle);
      expect(File(p.join(target.path, 'register.json')).existsSync(), isTrue);
      expect(File(p.join(target.path, 'private-key.pem')).existsSync(), isFalse);
      await expectLater(moved.readSigningKey(), throwsA(isA<Refusal>()));
      expect(licence.licenseId, isNotEmpty);
    });

    test('a bundle with the private key opens and can issue', () async {
      final licence = await aLicence();
      final envelope = jsonDecode(exportBundle(folder, includePrivateKey: false)) as Map<String, dynamic>;
      final files = Map<String, dynamic>.from(envelope['files'] as Map);
      files['private-key.pem'] = (await folder.readSigningKey()).privateKeyPem;
      envelope['files'] = files;
      envelope['containsPrivateKey'] = true;
      final target = Directory.systemTemp.createTempSync('kayan-bundle-full-');
      addTearDown(() => target.deleteSync(recursive: true));
      final moved = MemoryKeyFolder(target.path, null);
      await importBundle(moved, jsonEncode(envelope));
      expect(File(p.join(target.path, 'private-key.pem')).existsSync(), isFalse);
      final movedGenerator = LicenceGenerator(moved);
      final issued = await movedGenerator.issueKey(
        type: 'ACTIVATION',
        licenceId: licence.licenseId,
        machineId: 'KM-AAAA-1111-BBBB-2222',
      );
      expect(issued.key, startsWith('KYN1.'));
      final verified = await movedGenerator.verifyKey(issued.key!);
      expect(verified.valid, isTrue);
    });

    test('a bundle whose register was edited is refused before it replaces anything', () async {
      await aLicence();
      final good = exportBundle(folder, includePrivateKey: false);
      final envelope = jsonDecode(good) as Map<String, dynamic>;
      final files = Map<String, dynamic>.from(envelope['files'] as Map);
      // The synthetic private half exists only in this in-memory envelope.
      files['private-key.pem'] = (await folder.readSigningKey()).privateKeyPem;
      files['register.json'] = (files['register.json'] as String).replaceAll('"seats": 5', '"seats": 99');
      envelope['files'] = files;

      final target = Directory.systemTemp.createTempSync('kayan-bundle-bad-');
      addTearDown(() => target.deleteSync(recursive: true));
      final moved = KeyFolder(target.path);
      await expectLater(importBundle(moved, jsonEncode(envelope)), throwsA(isA<Refusal>()));
      expect(File(p.join(target.path, 'register.json')).existsSync(), isFalse);
    });
  });

  group('dates and terms', () {
    test('month arithmetic clamps at the end of the month', () {
      expect(iso(addMonths(DateTime.parse('2024-01-31T10:00:00.000Z'), 1)), '2024-02-29T10:00:00.000Z');
      expect(iso(addMonths(DateTime.parse('2023-01-31T10:00:00.000Z'), 1)), '2023-02-28T10:00:00.000Z');
      expect(iso(addMonths(DateTime.parse('2026-12-15T10:00:00.000Z'), 1)), '2027-01-15T10:00:00.000Z');
    });

    test('terms the tool understands, and the ones it refuses', () {
      expect(parseTerm('1m').toJson(), {'kind': 'MONTHS', 'months': 1});
      expect(parseTerm('2y').toJson(), {'kind': 'MONTHS', 'months': 24});
      expect(parseTerm('P').toJson(), {'kind': 'PERPETUAL'});
      expect(parseTerm('دائم').toJson(), {'kind': 'PERPETUAL'});
      expect(() => parseTerm('7w'), throwsA(isA<Refusal>()));
      expect(() => parseTerm('0m'), throwsA(isA<Refusal>()));
      expect(() => parseTerm('500y'), throwsA(isA<Refusal>()));
      expect(() => parseTerm(''), throwsA(isA<Refusal>()));
    });

    test('timestamps are written the way the product expects', () {
      final withMicroseconds = DateTime.utc(2026, 3, 1, 9, 0, 0, 123, 456);
      expect(iso(withMicroseconds), '2026-03-01T09:00:00.123Z');
    });
  });
}
