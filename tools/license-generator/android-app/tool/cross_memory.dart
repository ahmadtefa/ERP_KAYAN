// Synthetic Node/Dart signature interoperability without key files or logs.
// Input and output carry public keys and synthetic licence tokens only.
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:kayan_key_generator/src/generator.dart';
import 'package:kayan_key_generator/src/keys.dart';

Future<void> main() async {
  try {
    final input = jsonDecode(await stdin.transform(utf8.decoder).join()) as Map<String, dynamic>;
    final result = await readPayload(input['token'] as String, unb64url(input['publicRaw'] as String));
    if (!result.valid || result.payload['licenseId'] != 'lic_synthetic-1') {
      throw StateError('Node signature did not verify.');
    }
    final random = Random.secure();
    final seed = List<int>.generate(32, (_) => random.nextInt(256));
    final signing = await SigningKey.fromSeed(seed);
    final payload = <String, dynamic>{
      'v': 1,
      'keyId': 'key_synthetic-2',
      'type': 'ACTIVATION',
      'licenseId': 'lic_synthetic-2',
      'machineId': 'KM-AAAA-BBBB-CCCC',
      'issuedAt': '2026-05-01T00:00:00.000Z',
      'term': <String, dynamic>{'kind': 'MONTHS', 'months': 12},
      'seats': <String, dynamic>{'mode': 'INCREASE', 'value': 5},
      'state': null,
      'note': null,
    };
    stdout.write(jsonEncode(<String, dynamic>{
      'publicPem': await signing.publicKeyPem(),
      'token': await signPayload(payload, signing),
    }));
  } catch (_) {
    stderr.writeln('Synthetic in-memory interoperability check failed.');
    exitCode = 1;
  }
}
