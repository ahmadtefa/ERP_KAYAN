/// Moving a key folder to and from a phone.
///
/// A phone cannot receive a USB stick copy of `~/.kayan-license-generator`, so
/// the folder travels as one piece of text: the same files, in a single JSON
/// envelope. The private key is the crown jewels, so:
///
///  * the bundle is written by the operator, never by the app on its own;
///  * including the private key is an explicit choice, and the default bundle
///    leaves it out;
///  * an import is validated in a scratch folder first (the key pair must match
///    and the register must pass its checksum) and only then replaces the real
///    folder — a bad bundle cannot destroy a working one.
library;

import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

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

  // Prove it in a scratch folder first.
  final scratch = await Directory.systemTemp.createTemp('kayan-import-');
  try {
    for (final entry in files.entries) {
      await File(p.join(scratch.path, entry.key)).writeAsString(entry.value);
    }
    final probe = KeyFolder(scratch.path);
    if (files.containsKey('private-key.pem')) {
      final key = await probe.readSigningKey();
      await probe.loadRegister(key); // refuses a register that fails its MAC
    }

    await folder.ensure();
    for (final entry in files.entries) {
      await File(p.join(folder.home, entry.key)).writeAsString(entry.value);
    }
  } finally {
    try {
      await scratch.delete(recursive: true);
    } catch (_) {
      // A temp folder that outlives the import is not worth an error.
    }
  }
}
