/// Ed25519 signing, the PEM files around it, and the two identifiers the key
/// format uses. The Windows tool gets all of this from `node:crypto`; the
/// result here has to be the same down to the byte, because the product
/// verifies with the same curve and the fingerprint is compared by eye.
library;

import 'dart:convert';
import 'dart:math' show Random, min;
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto;
import 'package:cryptography/cryptography.dart';

import 'der.dart';

/// `KYN1` and `KYNREQ1` — from `license-key.ts`, never changed here.
const String keyPrefix = 'KYN1';
const String requestPrefix = 'KYNREQ1';

/// The tool's version, the same string the Windows tool writes into audit.log.
const String toolVersion = '1.1.0';

final Ed25519 _ed25519 = Ed25519();

/// base64url without padding, as `Buffer.toString('base64url')` writes it.
String b64url(List<int> bytes) =>
    base64Url.encode(bytes).replaceAll(RegExp(r'=+$'), '');

/// Reads base64url whether or not the sender kept the padding.
List<int> unb64url(String text) {
  final clean = text.trim();
  final padded = clean.padRight((clean.length + 3) & ~3, '=');
  return Uint8List.fromList(base64Url.decode(padded));
}

String sha256Hex(List<int> bytes) => crypto.sha256.convert(bytes).toString();

List<int> sha256Bytes(List<int> bytes) => crypto.sha256.convert(bytes).bytes;

String sha256HexOfText(String text) => sha256Hex(utf8.encode(text));

/// A random 8-byte hexadecimal identifier, the shape `newLicenceId` uses.
String randomHex8() {
  final random = Random.secure();
  return List<int>.generate(8, (_) => random.nextInt(256))
      .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();
}

String newLicenceId() => 'lic_${randomHex8()}';

String newKeyId() => 'key_${randomHex8()}';

/// The operator's signing key: 32 bytes of seed, and everything derived from
/// them. The seed is never printed, logged or copied anywhere but the key file.
class SigningKey {
  SigningKey._(this.seed, this._keyPair);

  final List<int> seed;
  final SimpleKeyPair _keyPair;
  List<int>? _publicKeyBytes;

  /// `createPrivateKey(pem)` for the PKCS#8 file the Windows tool writes.
  static Future<SigningKey> fromPem(String pem) async {
    final der = pemDecode(pem, 'PRIVATE KEY');
    final seed = ed25519SeedFromPkcs8(der);
    return fromSeed(seed);
  }

  static Future<SigningKey> fromSeed(List<int> seed) async {
    if (seed.length != 32) {
      throw const FormatException('An Ed25519 seed is 32 bytes.');
    }
    final pair = await _ed25519.newKeyPairFromSeed(seed);
    return SigningKey._(List<int>.unmodifiable(seed), pair);
  }

  /// The key file the Windows tool writes: PKCS#8, `BEGIN PRIVATE KEY`.
  String get privateKeyPem {
    final seedBytes = seed;
    final der = <int>[
      0x30, 0x2e, // SEQUENCE, 46 bytes
      0x02, 0x01, 0x00, // version 0
      0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, // AlgorithmIdentifier: Ed25519
      0x04, 0x22, 0x04, 0x20, ...seedBytes, // OCTET STRING { OCTET STRING seed }
    ];
    return pemEncode('PRIVATE KEY', der);
  }

  Future<List<int>> publicKeyBytes() async {
    return _publicKeyBytes ??= List<int>.unmodifiable(
      (await _keyPair.extractPublicKey()).bytes,
    );
  }

  Future<List<int>> spkiDer() async =>
      spkiFromEd25519PublicKey(await publicKeyBytes());

  /// The value the installer puts in `LICENSE_PUBLIC_KEY`.
  Future<String> publicKeyBase64Url() async => b64url(await spkiDer());

  /// `BEGIN PUBLIC KEY`, the file the installer reads.
  Future<String> publicKeyPem() async => pemEncode('PUBLIC KEY', await spkiDer());

  /// The first 32 hex digits of the SPKI digest, in fours — what the product's
  /// licence screen shows, so the operator can compare the two by eye.
  Future<String> fingerprint() async {
    final hex = sha256Hex(await spkiDer()).toUpperCase().substring(0, 32);
    return hex.replaceAllMapped(RegExp(r'.{4}(?=.)'), (match) => '${match[0]}-');
  }

  /// `sign(null, message, privateKey)` — Ed25519 is deterministic, so the same
  /// seed and the same text always produce the same 64 bytes.
  Future<List<int>> sign(List<int> message) async {
    final signature = await _ed25519.sign(message, keyPair: _keyPair);
    return signature.bytes;
  }
}

/// `verify(null, message, publicKey, signature)`.
Future<bool> verifySignature(
  List<int> message,
  List<int> signature,
  List<int> publicKey,
) async {
  return _ed25519.verify(
    message,
    signature: Signature(
      signature,
      publicKey: SimplePublicKey(publicKey, type: KeyPairType.ed25519),
    ),
  );
}

/// A PEM block, wrapped at 64 columns exactly as Node writes it.
String pemEncode(String label, List<int> der) {
  final text = base64.encode(der);
  final lines = <String>[];
  for (var index = 0; index < text.length; index += 64) {
    lines.add(text.substring(index, min(index + 64, text.length)));
  }
  return '-----BEGIN $label-----\n${lines.join('\n')}\n-----END $label-----\n';
}

/// The DER inside a PEM block, whatever line endings it travelled with.
List<int> pemDecode(String pem, String label) {
  final begin = '-----BEGIN $label-----';
  final end = '-----END $label-----';
  final start = pem.indexOf(begin);
  final stop = pem.indexOf(end);
  if (start < 0 || stop < 0 || stop < start) {
    throw FormatException('That text is not a $label file.');
  }
  final body = pem
      .substring(start + begin.length, stop)
      .replaceAll(RegExp(r'\s+'), '');
  return base64.decode(body);
}

/// True when the text looks like a PEM block of that kind, for early refusal
/// before anything is written to the key folder.
bool looksLikePem(String text, String label) =>
    text.contains('-----BEGIN $label-----') && text.contains('-----END $label-----');
