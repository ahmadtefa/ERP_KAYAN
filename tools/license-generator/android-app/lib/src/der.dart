/// Just enough DER to read an Ed25519 private key and write its public key.
///
/// The Windows tool lets Node do this (`createPrivateKey`, `export({format:
/// 'der'})`). Dart has no such helper, and the shapes involved are fixed by
/// RFC 8410: a PKCS#8 private key is a SEQUENCE holding the 32-byte seed, and
/// a SubjectPublicKeyInfo is a SEQUENCE holding the 32-byte public key. Doing
/// it here keeps the key files byte-identical to the ones the Windows tool
/// writes, so one backup opens on either tool.
library;

/// One tag-length-value, as found in a DER buffer.
class _Tlv {
  _Tlv(this.tag, this.start, this.length);

  final int tag;
  final int start; // first byte of the value
  final int length; // bytes of value
  int get end => start + length;
}

_Tlv _readTlv(List<int> bytes, int offset) {
  if (offset + 2 > bytes.length) {
    throw const FormatException('The key file ends in the middle of a field.');
  }
  final tag = bytes[offset];
  var cursor = offset + 1;
  var length = bytes[cursor++];
  if (length & 0x80 != 0) {
    final count = length & 0x7f;
    if (count == 0 || count > 4 || cursor + count > bytes.length) {
      throw const FormatException('The key file has an unreadable length.');
    }
    length = 0;
    for (var i = 0; i < count; i++) {
      length = (length << 8) | bytes[cursor++];
    }
  }
  if (cursor + length > bytes.length) {
    throw const FormatException('The key file is shorter than it says it is.');
  }
  return _Tlv(tag, cursor, length);
}

/// The 32-byte Ed25519 seed inside a PKCS#8 (or the inner, unwrapped) key.
///
/// Node writes `PrivateKeyInfo { version, AlgorithmIdentifier(1.3.101.112),
/// OCTET STRING { OCTET STRING seed } }`. RFC 8410 also allows the public key
/// to follow inside the outer OCTET STRING, so this walks the structure rather
/// than slicing fixed offsets.
List<int> ed25519SeedFromPkcs8(List<int> der) {
  final outer = _readTlv(der, 0);
  if (outer.tag != 0x30) {
    throw const FormatException('That is not a PKCS#8 private key.');
  }
  var cursor = outer.start;
  while (cursor < outer.end) {
    final field = _readTlv(der, cursor);
    if (field.tag == 0x04) {
      final value = der.sublist(field.start, field.end);
      if (value.length == 32) return value;
      // The outer OCTET STRING usually wraps one more: OCTET STRING (32).
      final inner = _readTlv(value, 0);
      if (inner.tag == 0x04 && inner.length == 32 && inner.end <= value.length) {
        return value.sublist(inner.start, inner.end);
      }
      throw const FormatException(
        'The private key does not hold a 32-byte Ed25519 seed.',
      );
    }
    // Skip the version and the algorithm identifier.
    if (field.tag == 0x02 || field.tag == 0x30) {
      cursor = field.end;
      continue;
    }
    throw const FormatException(
      'The private key is not an Ed25519 key (unexpected field).',
    );
  }
  throw const FormatException('The private key holds no key material.');
}

/// `SubjectPublicKeyInfo` for an Ed25519 key, exactly as Node exports it.
List<int> spkiFromEd25519PublicKey(List<int> publicKey) {
  if (publicKey.length != 32) {
    throw const FormatException('An Ed25519 public key is 32 bytes.');
  }
  const algorithm = <int>[
    0x30, 0x05, // SEQUENCE, 5 bytes: the algorithm identifier
    0x06, 0x03, 0x2b, 0x65, 0x70, // OID 1.3.101.112 = Ed25519
  ];
  final bitString = <int>[0x03, 0x21, 0x00, ...publicKey]; // BIT STRING, 0 unused
  final content = <int>[...algorithm, ...bitString];
  return <int>[0x30, content.length, ...content];
}

/// The 32-byte public key inside a `SubjectPublicKeyInfo`.
List<int> ed25519PublicKeyFromSpki(List<int> der) {
  final outer = _readTlv(der, 0);
  if (outer.tag != 0x30) {
    throw const FormatException('That is not a SubjectPublicKeyInfo.');
  }
  var cursor = outer.start;
  while (cursor < outer.end) {
    final field = _readTlv(der, cursor);
    if (field.tag == 0x03) {
      final value = der.sublist(field.start, field.end);
      if (value.isEmpty || value.first != 0x00 || value.length != 33) {
        throw const FormatException('The public key is not a plain Ed25519 key.');
      }
      return value.sublist(1);
    }
    cursor = field.end;
  }
  throw const FormatException('The public key file holds no key.');
}
