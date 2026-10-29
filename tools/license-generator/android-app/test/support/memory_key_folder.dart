// Test-only adapter: register files are real, but the synthetic signing key is
// held in memory and never written to a temporary key file.
import 'dart:convert';
import 'dart:io';

import 'package:kayan_key_generator/src/keys.dart';
import 'package:kayan_key_generator/src/register.dart';

class MemoryKeyFolder extends KeyFolder {
  MemoryKeyFolder(super.home, this._key, {super.clock});
  SigningKey? _key;

  @override
  bool get hasPrivateKey => _key != null;

  @override
  Future<SigningKey> readSigningKey() async {
    final key = _key;
    if (key == null || !hasPublicKey) refuse('No key pair in this test folder.');
    final publicDer = pemDecode(await File(publicKeyPath).readAsString(), 'PUBLIC KEY');
    if (base64Encode(publicDer) != base64Encode(await key.spkiDer())) {
      refuse('The test public and private keys do not belong together.');
    }
    enforceLicenceKeyPolicy(policy, await key.fingerprint());
    return key;
  }

  @override
  Future<void> writeImportedFile(String name, String contents) async {
    if (name == 'private-key.pem') {
      _key = await SigningKey.fromPem(contents);
    } else {
      await super.writeImportedFile(name, contents);
    }
  }
}
