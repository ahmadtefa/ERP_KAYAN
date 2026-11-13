/// Moving a key folder to and from a phone.
///
/// A phone cannot receive a USB stick copy of `~/.kayan-license-generator`, so
/// the folder travels as one piece of text: the same files, in a single JSON
/// envelope. The private key is the crown jewels, so:
///
///  * the bundle is written by the operator, never by the app on its own;
///  * including the private key is an explicit choice, and the default bundle
///    leaves it out;
///  * an import is validated in memory first (the key pair must match and the
///    register must pass its checksum when a signing key is available), before
///    any writes to the operator's folder.
library;

import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import 'keys.dart';
import 'register.dart';

const String bundleFormat = 'kayan-license-folder/1';

const List<String> folderFiles = <String>[
  'private-key.pem',
  'public-key.pem',
  'register.json',
  'register.mac',
  'audit.log',
];

/// The whole key folder as one line of text the operator can carry.
String exportBundle(KeyFolder folder, {required bool includePrivateKey}) {
  final files = <String, String>{};
  for (final name in folderFiles) {
    if (name == 'private-key.pem' && !includePrivateKey) continue;
    final file = File(p.join(folder.home, name));
    if (!file.existsSync()) continue;
    files[name] = file.readAsStringSync();
  }
  return const JsonEncoder.withIndent('  ').convert(<String, dynamic>{
    'format': bundleFormat,
    'exportedAt': DateTime.now().toUtc().toIso8601String(),
    'containsPrivateKey': includePrivateKey,
    'files': files,
  });
}

/// Writes the bundle into the folder, but only after proving it is sound.
Future<void> importBundle(KeyFolder folder, String text) async {
  final Map<String, dynamic> envelope;
  try {
    envelope = Map<String, dynamic>.from(jsonDecode(text.trim()) as Map);
  } catch (_) {
    refuse('That is not a key-folder bundle (it should be the JSON the tool exported).');
  }
  if (envelope['format'] != bundleFormat) {
    refuse('This bundle is in format ${envelope['format']}; this tool reads $bundleFormat.');
  }
  final rawFiles = envelope['files'];
  if (rawFiles is! Map || rawFiles.isEmpty) {
    refuse('The bundle carries no files.');
  }
  final files = <String, String>{};
  for (final entry in rawFiles.entries) {
    final name = entry.key as String;
    if (!folderFiles.contains(name)) {
      refuse('The bundle contains "$name", which is not part of a key folder.');
    }
    files[name] = entry.value as String;
  }
  if (!files.containsKey('register.json') || !files.containsKey('register.mac')) {
    refuse('The bundle has no register with its checksum; it cannot be trusted.');
  }

  // Validate the supplied material in memory; never copy a private key to a
  // scratch directory. Preserve an existing pair rather than replacing it.
  if (!files.containsKey('public-key.pem')) {
    refuse('The bundle must include its public key.');
  }
  final publicDer = pemDecode(files['public-key.pem']!, 'PUBLIC KEY');
  final incomingFingerprint = fingerprintOfSpki(publicDer);
  enforceLicenceKeyPolicy(folder.policy, incomingFingerprint);
  SigningKey? signing;
  if (files.containsKey('private-key.pem')) {
    signing = await SigningKey.fromPem(files['private-key.pem']!);
    enforceLicenceKeyPolicy(folder.policy, await signing.fingerprint());
    if (base64Encode(await signing.spkiDer()) != base64Encode(publicDer)) {
      refuse('The bundle private and public keys do not belong together.');
    }
  }
  if (folder.hasPublicKey && !folder.hasKeyPair) {
    final existingDer = pemDecode(await File(folder.publicKeyPath).readAsString(), 'PUBLIC KEY');
    if (base64Encode(publicDer) != base64Encode(existingDer)) {
      refuse('The bundle public key differs from the existing key.');
    }
  }
  if (folder.hasKeyPair) {
    final existing = await folder.readSigningKey();
    if (base64Encode(publicDer) != base64Encode(await existing.spkiDer())) {
      refuse('The bundle public key differs from the existing key.');
    }
    signing ??= existing;
  }
  if (signing != null) {
    folder.validateRegisterText(signing, files['register.json']!, files['register.mac']!);
  }
  // Without any private key a public-only bundle has no verifiable MAC; this
  // import does not assert authenticity and cannot issue licence keys.
  await folder.ensure();
  for (final entry in files.entries) {
    await folder.writeImportedFile(entry.key, entry.value);
  }
}
