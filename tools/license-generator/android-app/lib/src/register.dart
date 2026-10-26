/// The operator's key folder: two PEM files, a register and an audit log.
///
/// The files are the ones `tools/license-generator/kayan-license.mjs` writes,
/// with the same names and the same bytes — the register is pretty-printed
/// with sorted keys and sealed with an HMAC derived from the private key, so a
/// folder made on a phone opens in the Windows tool and the other way round.
library;

import 'dart:convert';
import 'dart:io';
import 'dart:math' show Random;

import 'package:crypto/crypto.dart' as crypto;
import 'package:path/path.dart' as p;

import 'json_canonical.dart';
import 'keys.dart';

/// A rule said no. The message is meant to be shown to the operator.
class Refusal implements Exception {
  Refusal(this.message);
  final String message;
  @override
  String toString() => message;
}

Never refuse(String message) => throw Refusal(message);

const int registerVersion = 1;

/// One licence as the operator records it.
class Licence {
  Licence({
    required this.licenseId,
    required this.ref,
    required this.seats,
    required this.seatsUsed,
    required this.term,
    required this.machineId,
    required this.startsAt,
    required this.expiresAt,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
  });

  factory Licence.fromJson(Map<String, dynamic> json) => Licence(
        licenseId: json['licenseId'] as String,
        ref: json['ref'] as String?,
        seats: (json['seats'] as num).toInt(),
        seatsUsed: (json['seatsUsed'] as num?)?.toInt() ?? 0,
        term: (json['term'] as num?)?.toInt(),
        machineId: json['machineId'] as String?,
        startsAt: json['startsAt'] as String?,
        expiresAt: json['expiresAt'] as String?,
        status: json['status'] as String? ?? 'registered',
        createdAt: json['createdAt'] as String? ?? '',
        updatedAt: json['updatedAt'] as String? ?? '',
      );

  String licenseId;
  String? ref;
  int seats;
  int seatsUsed;

  /// Months, or null for perpetual — the same convention as the register.
  int? term;
  String? machineId;
  String? startsAt;
  String? expiresAt;
  String status;
  String createdAt;
  String updatedAt;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'licenseId': licenseId,
        'ref': ref,
        'seats': seats,
        'seatsUsed': seatsUsed,
        'term': term,
        'machineId': machineId,
        'startsAt': startsAt,
        'expiresAt': expiresAt,
        'status': status,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };
}

/// One key that was issued, as remembered. It never holds the key text itself.
class IssuedKey {
  IssuedKey({
    required this.keyId,
    required this.licenseId,
    required this.type,
    required this.machineId,
    required this.term,
    required this.seats,
    required this.issuedAt,
    required this.status,
    required this.note,
    required this.fingerprint,
    this.usedAt,
    this.supersededAt,
    this.revokedAt,
    this.reason,
  });

  factory IssuedKey.fromJson(Map<String, dynamic> json) => IssuedKey(
        keyId: json['keyId'] as String,
        licenseId: json['licenseId'] as String,
        type: json['type'] as String,
        machineId: json['machineId'] as String?,
        term: (json['term'] as num?)?.toInt(),
        seats: json['seats'] == null
            ? null
            : Map<String, dynamic>.from(json['seats'] as Map),
        issuedAt: json['issuedAt'] as String? ?? '',
        status: json['status'] as String? ?? 'issued',
        note: json['note'] as String?,
        fingerprint: json['fingerprint'] as String? ?? '',
        usedAt: json['usedAt'] as String?,
        supersededAt: json['supersededAt'] as String?,
        revokedAt: json['revokedAt'] as String?,
        reason: json['reason'] as String?,
      );

  String keyId;
  String licenseId;
  String type;
  String? machineId;
  int? term;
  Map<String, dynamic>? seats;
  String issuedAt;
  String status;
  String? note;
  String fingerprint;
  String? usedAt;
  String? supersededAt;
  String? revokedAt;
  String? reason;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'keyId': keyId,
        'licenseId': licenseId,
        'type': type,
        'machineId': machineId,
        'term': term,
        'seats': seats,
        'issuedAt': issuedAt,
        'status': status,
        'note': note,
        'fingerprint': fingerprint,
        if (usedAt != null) 'usedAt': usedAt,
        if (supersededAt != null) 'supersededAt': supersededAt,
        if (revokedAt != null) 'revokedAt': revokedAt,
        if (reason != null) 'reason': reason,
      };
}

class Register {
  Register({
    required this.createdAt,
    Map<String, Licence>? licences,
    List<IssuedKey>? keys,
  })  : licences = licences ?? <String, Licence>{},
        keys = keys ?? <IssuedKey>[];

  factory Register.fromJson(Map<String, dynamic> json) {
    final licences = <String, Licence>{};
    final raw = json['licences'];
    if (raw is Map) {
      for (final entry in raw.entries) {
        licences[entry.key as String] =
            Licence.fromJson(Map<String, dynamic>.from(entry.value as Map));
      }
    }
    final keys = <IssuedKey>[];
    final rawKeys = json['keys'];
    if (rawKeys is List) {
      for (final item in rawKeys) {
        keys.add(IssuedKey.fromJson(Map<String, dynamic>.from(item as Map)));
      }
    }
    return Register(
      createdAt: json['createdAt'] as String? ?? '',
      licences: licences,
      keys: keys,
    );
  }

  String createdAt;
  final Map<String, Licence> licences;
  final List<IssuedKey> keys;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'v': registerVersion,
        'createdAt': createdAt,
        'licences': <String, dynamic>{
          for (final entry in licences.entries) entry.key: entry.value.toJson(),
        },
        'keys': keys.map((key) => key.toJson()).toList(),
      };
}

/// Where the key folder lives. On a phone this is the app's own storage, which
/// no other app can read; on a desktop test run it is any directory.
class KeyFolder {
  KeyFolder(this.home, {DateTime Function()? clock})
      : _clock = clock ?? (() => DateTime.now().toUtc());

  final String home;
  final DateTime Function() _clock;

  String get privateKeyPath => p.join(home, 'private-key.pem');
  String get publicKeyPath => p.join(home, 'public-key.pem');
  String get registerPath => p.join(home, 'register.json');
  String get registerMacPath => p.join(home, 'register.mac');
  String get auditPath => p.join(home, 'audit.log');

  bool get hasPrivateKey => File(privateKeyPath).existsSync();
  bool get hasPublicKey => File(publicKeyPath).existsSync();
  bool get hasKeyPair => hasPrivateKey && hasPublicKey;
  bool get exists => Directory(home).existsSync();

  DateTime now() => _clock();

  Future<void> ensure() async {
    final directory = Directory(home);
    if (!directory.existsSync()) {
      await directory.create(recursive: true);
    }
  }

  /// Reads the pair, and refuses a pair that does not belong together: a key
  /// signed by the private half of another pair would not verify in the
  /// product, and the operator would only find out at the customer's desk.
  Future<SigningKey> readSigningKey() async {
    if (!hasKeyPair) {
      refuse('No key pair in this folder. Import the signing key first.');
    }
    final privateText = await File(privateKeyPath).readAsString();
    final publicDer = pemDecode(
      await File(publicKeyPath).readAsString(),
      'PUBLIC KEY',
    );
    final SigningKey key;
    try {
      key = await SigningKey.fromPem(privateText);
    } on FormatException catch (error) {
      refuse('The private key cannot be read: ${error.message}');
    }
    final derived = await key.spkiDer();
    if (!_sameBytes(derived, publicDer)) {
      refuse(
        'The private and public keys in this folder do not belong together. '
        'Restore both from the same backup; a key issued with the wrong pair '
        'would not verify in the product.',
      );
    }
    return key;
  }

  /// Writes a key pair and an empty register. Only used when the operator
  /// deliberately creates the first pair (the folder is empty).
  Future<SigningKey> createKeyPair() async {
    if (hasPrivateKey) {
      refuse(
        'A signing key already exists in this folder. Creating another would '
        'invalidate every key already issued. Back this folder up instead.',
      );
    }
    await ensure();
    final source = Random.secure();
    final random = List<int>.generate(32, (_) => source.nextInt(256));
    final key = await SigningKey.fromSeed(random);
    await _write(privateKeyPath, key.privateKeyPem);
    await _write(publicKeyPath, await key.publicKeyPem());
    final register = Register(createdAt: iso(now()));
    await saveRegister(key, register);
    await audit({
      'action': 'init',
      'result': 'created',
    });
    return key;
  }

  /// Writes the pair the operator brought (a pasted `private-key.pem`), and
  /// refuses — putting the folder back as it was — if the register here
  /// belongs to a different key.
  Future<void> writeKeyPair(SigningKey key) async {
    await ensure();
    final oldPrivate = hasPrivateKey ? await File(privateKeyPath).readAsString() : null;
    final oldPublic = hasPublicKey ? await File(publicKeyPath).readAsString() : null;
    await _write(privateKeyPath, key.privateKeyPem);
    await _write(publicKeyPath, await key.publicKeyPem());
    try {
      if (File(registerPath).existsSync()) {
        await loadRegister(key);
      } else {
        await saveRegister(key, Register(createdAt: iso(now())));
      }
    } catch (_) {
      if (oldPrivate == null) {
        await File(privateKeyPath).delete();
      } else {
        await _write(privateKeyPath, oldPrivate);
      }
      if (oldPublic == null) {
        await File(publicKeyPath).delete();
      } else {
        await _write(publicKeyPath, oldPublic);
      }
      rethrow;
    }
  }

  Future<Register> loadRegister(SigningKey key) async {
    if (!File(registerPath).existsSync()) {
      return Register(createdAt: iso(now()));
    }
    if (!File(registerMacPath).existsSync()) {
      refuse(
        'The register has no checksum file beside it (register.mac). Restore '
        'the backup of the key folder.',
      );
    }
    final Map<String, dynamic> json;
    try {
      json = Map<String, dynamic>.from(
        jsonDecode(await File(registerPath).readAsString()) as Map,
      );
    } on FormatException {
      refuse('The register file is not readable JSON. Restore it from backup.');
    }
    final expected = _registerMac(key, json);
    final actual = (await File(registerMacPath).readAsString()).trim();
    if (!_sameText(actual, expected)) {
      refuse(
        'The register failed its integrity check: it was edited by hand, or it '
        'belongs to a different key pair. Restore it from the backup.',
      );
    }
    final version = (json['v'] as num?)?.toInt();
    if (version != registerVersion) {
      refuse(
        'The register uses format $version; this tool reads $registerVersion.',
      );
    }
    return Register.fromJson(json);
  }

  Future<void> saveRegister(SigningKey key, Register register) async {
    await ensure();
    final json = register.toJson();
    await _write(registerPath, stablePretty(json));
    await _write(registerMacPath, _registerMac(key, json));
  }

  /// The register's checksum: HMAC-SHA256 under a key derived from the private
  /// key, over the canonical spelling of the register.
  String _registerMac(SigningKey key, Map<String, dynamic> json) {
    final macKey = crypto.sha256.convert(utf8.encode(key.privateKeyPem)).bytes;
    final hmac = crypto.Hmac(crypto.sha256, macKey);
    return hmac.convert(utf8.encode(stableCompact(json))).toString();
  }

  Future<void> audit(Map<String, dynamic> entry) async {
    try {
      await ensure();
      final line = <String, dynamic>{
        'at': iso(now()),
        'tool': 'kayan-license/$toolVersion',
        ...entry,
      };
      await File(auditPath).writeAsString(
        '${jsonEncode(line)}\n',
        mode: FileMode.append,
        flush: true,
      );
    } catch (_) {
      // A log that cannot be written must never stop a key being issued.
    }
  }

  Future<List<Map<String, dynamic>>> readAudit({int limit = 50}) async {
    try {
      final file = File(auditPath);
      if (!file.existsSync()) return const [];
      final lines = (await file.readAsString())
          .split('\n')
          .where((line) => line.trim().isNotEmpty)
          .toList();
      return lines.skip(lines.length > limit ? lines.length - limit : 0).map((line) {
        try {
          return Map<String, dynamic>.from(jsonDecode(line) as Map);
        } catch (_) {
          return <String, dynamic>{'at': null, 'action': 'unreadable audit line'};
        }
      }).toList();
    } catch (_) {
      return const [];
    }
  }

  Future<void> _write(String path, String contents) async {
    // Android keeps every app's files in a directory no other app can read;
    // that sandbox, not a file mode, is what protects the private key here.
    await File(path).writeAsString(contents, flush: true);
  }

}

bool _sameBytes(List<int> left, List<int> right) {
  if (left.length != right.length) return false;
  var difference = 0;
  for (var index = 0; index < left.length; index++) {
    difference |= left[index] ^ right[index];
  }
  return difference == 0;
}

bool _sameText(String left, String right) {
  if (left.length != right.length) return false;
  var difference = 0;
  for (var index = 0; index < left.length; index++) {
    difference |= left.codeUnitAt(index) ^ right.codeUnitAt(index);
  }
  return difference == 0;
}
