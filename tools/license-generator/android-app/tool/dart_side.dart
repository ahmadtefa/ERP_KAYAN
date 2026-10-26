/// Runs the Android app's licensing code on a desktop, so CI can prove the two
/// implementations agree.
///
///     dart run tool/dart_side.dart emit   <outdir>
///     dart run tool/dart_side.dart verify <folder> <key text>
///
/// `emit` builds a key folder and one key of each type with this app's code;
/// `tool/verify_with_product.mjs` then verifies them with the product's own
/// verifier (`backend/src/modules/licensing/license-key.ts`) and with the
/// Windows generator. `verify` closes the circle: a key the Windows tool
/// issued into the folder this app made must verify here.
library;

import 'dart:convert';
import 'dart:io';

import 'package:kayan_key_generator/src/generator.dart';
import 'package:kayan_key_generator/src/register.dart';
import 'package:path/path.dart' as p;

Future<void> main(List<String> args) async {
  if (args.isEmpty) {
    stderr.writeln('usage: dart_side.dart emit <outdir> | verify <folder> <key>');
    exit(64);
  }

  switch (args.first) {
    case 'emit':
      final outdir = args[1];
      await _emit(outdir);
    case 'verify':
      final folder = KeyFolder(args[1]);
      final key = args[2];
      final signing = await folder.readSigningKey();
      final result = await readPayload(key, await signing.publicKeyBytes());
      final payload = result.payload;
      print('${result.valid ? 'VALID' : 'INVALID'} ${payload['type']} '
          '${payload['keyId']} machine=${payload['machineId'] ?? '-'} '
          'term=${jsonEncode(payload['term'])} seats=${jsonEncode(payload['seats'])}');
      exit(result.valid ? 0 : 1);
    default:
      stderr.writeln('unknown command ${args.first}');
      exit(64);
  }
}

Future<void> _emit(String outdir) async {
  final home = Directory(p.join(outdir, 'keyring'));
  if (home.existsSync()) home.deleteSync(recursive: true);
  final folder = KeyFolder(home.path);
  await folder.ensure();

  final key = await folder.createKeyPair();
  final generator = LicenceGenerator(folder);

  final licence = (await generator.createLicence(ref: 'CI cross-check', seats: 5, term: '1y')).licence;
  final perpetual = (await generator.createLicence(ref: 'CI perpetual', seats: 2, term: 'P')).licence;

  final issued = <Map<String, dynamic>>[];
  Future<void> issue(String label, Future<IssueResult> Function() call) async {
    final result = await call();
    issued.add(<String, dynamic>{
      'label': label,
      'type': result.payload['type'],
      'keyId': result.payload['keyId'],
      'key': result.key,
    });
  }

  await issue('activation', () => generator.issueKey(
        type: 'ACTIVATION',
        licenceId: licence.licenseId,
        machineId: 'KM-DART-AAAA-BBBB-CCCC',
        note: 'made on the Android code path',
      ));
  await issue('seats increase', () => generator.issueKey(
        type: 'SEATS',
        licenceId: licence.licenseId,
        increase: 3,
      ));
  await issue('renewal', () => generator.issueKey(
        type: 'RENEWAL',
        licenceId: licence.licenseId,
        term: '6m',
      ));
  await issue('transfer', () => generator.issueKey(
        type: 'TRANSFER',
        licenceId: licence.licenseId,
        machineId: 'KM-DART-DDDD-EEEE-FFFF',
        used: 2,
      ));
  await issue('perpetual activation', () => generator.issueKey(
        type: 'ACTIVATION',
        licenceId: perpetual.licenseId,
        machineId: 'KM-DART-1111-2222-3333',
      ));

  final summary = <String, dynamic>{
    'publicKeyPem': await key.publicKeyPem(),
    'publicKeyBase64Url': await key.publicKeyBase64Url(),
    'fingerprint': await key.fingerprint(),
    'licenceId': licence.licenseId,
    'perpetualLicenceId': perpetual.licenseId,
    'keys': issued,
    'folder': home.path,
  };
  File(p.join(outdir, 'dart-keys.json')).writeAsStringSync(
    const JsonEncoder.withIndent('  ').convert(summary),
  );
  print('dart side: wrote ${issued.length} keys in ${home.path}');
  print('dart side: fingerprint ${summary['fingerprint']}');
}
