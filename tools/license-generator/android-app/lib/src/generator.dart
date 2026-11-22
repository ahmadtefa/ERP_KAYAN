/// The licensing rules, exactly as `tools/license-generator/kayan-license.mjs`
/// implements them.
///
/// Nothing here is a new protocol: it is the same four key types, the same
/// payload fields in the same order, the same terms and seat rules, the same
/// register and the same audit lines. The point of that discipline is that a
/// key made on a phone and a key made on Windows are indistinguishable to the
/// product — the tests under `test/` compare the two byte for byte.
library;

import 'dart:convert';

import 'json_canonical.dart';
import 'keys.dart';
import 'register.dart';

const int maxTermMonths = 1200;
const List<String> keyTypes = ['ACTIVATION', 'RENEWAL', 'SEATS', 'TRANSFER'];

final RegExp machineIdPattern = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$');

final RegExp _termPattern = RegExp(
  r'^(\d{1,4})\s*(m|month|months|month|شهر|أشهر|y|year|years|سنة|سنوات)$',
);

/// A licence term: calendar months, or perpetual.
class Term {
  const Term.months(this.months) : kind = 'MONTHS';
  const Term.perpetual()
      : kind = 'PERPETUAL',
        months = null;

  final String kind;
  final int? months;

  bool get isPerpetual => kind == 'PERPETUAL';

  Map<String, dynamic> toJson() => isPerpetual
      ? <String, dynamic>{'kind': 'PERPETUAL'}
      : <String, dynamic>{'kind': 'MONTHS', 'months': months};

  /// `describeTerm` — the same bilingual wording the Windows window prints.
  String describe() {
    if (isPerpetual) return 'دائم / perpetual';
    final value = months!;
    if (value % 12 == 0) {
      return '${value ~/ 12} سنة / ${value ~/ 12} year(s)';
    }
    return '$value شهر / $value month(s)';
  }
}

/// `1m`, `6m`, `1y`, `2y`, `3y`, `P`, and the Arabic words the CLI accepts.
Term parseTerm(String? text) {
  final raw = text?.trim() ?? '';
  if (raw.isEmpty) {
    refuse('A term is required: 1m, 6m, 1y, 2y, 3y, or P for perpetual.');
  }
  final value = raw.toLowerCase();
  if (value == 'p' || value == 'perpetual' || value == 'دائم') {
    return const Term.perpetual();
  }
  final match = _termPattern.firstMatch(value);
  if (match == null) {
    refuse('I do not understand the term "$text". Use 1m, 6m, 1y, 2y, or P.');
  }
  final amount = int.parse(match.group(1)!);
  final unit = match.group(2)!;
  final months =
      unit.startsWith('y') || unit == 'سنة' || unit == 'سنوات' ? amount * 12 : amount;
  if (months < 1 || months > maxTermMonths) {
    refuse('A term must be between 1 month and $maxTermMonths months.');
  }
  return Term.months(months);
}

/// Calendar months, clamped at the end of the month: 31 January + 1 month is
/// 28 or 29 February, never 3 March.
DateTime addMonths(DateTime from, int months) {
  final source = from.toUtc();
  final day = source.day;
  final target = source.month - 1 + months;
  final year = source.year + (target ~/ 12);
  final month = target % 12;
  final lastDay = DateTime.utc(year, month + 2, 0).day;
  final clamped = day <= lastDay ? day : lastDay;
  return DateTime.utc(
    year,
    month + 1,
    clamped,
    source.hour,
    source.minute,
    source.second,
    source.millisecond,
    source.microsecond,
  );
}

/// A request code the customer's licence screen produced.
class ActivationRequest {
  ActivationRequest({
    required this.machineId,
    this.installId,
    this.appVersion,
    this.requestedAt,
    this.nonce,
  });

  final String machineId;
  final String? installId;
  final String? appVersion;
  final String? requestedAt;
  final String? nonce;
}

/// `KYNREQ1.<payload>.<10-character checksum>`: the checksum catches a code
/// that was cut in half by a chat app. It is not a signature — the code carries
/// no secret and anyone can write one; only the machine id is used.
ActivationRequest parseRequestCode(String? code) {
  final text = (code ?? '').replaceAll(RegExp(r'\s+'), '').trim();
  final parts = text.split('.');
  if (parts.length != 3 || parts[0] != requestPrefix) {
    refuse(
      'That is not an activation/transfer request code (it should start with '
      'KYNREQ1.). Ask the customer to copy the whole code from the licence '
      'screen.',
    );
  }
  final expected =
      b64url(sha256Bytes(utf8.encode('$requestPrefix.${parts[1]}'))).substring(0, 10);
  if (expected != parts[2]) {
    refuse(
      'The request code is incomplete or was altered in the message. Ask the '
      'customer to send it again, copied in one piece.',
    );
  }
  final Map<String, dynamic> request;
  try {
    request = Map<String, dynamic>.from(jsonDecode(utf8.decode(unb64url(parts[1]))) as Map);
  } catch (_) {
    refuse('The request code cannot be read.');
  }
  final machineId = request['machineId'];
  if (machineId is! String || machineId.isEmpty) {
    refuse('The request code carries no machine id.');
  }
  return ActivationRequest(
    machineId: machineId,
    installId: request['installId'] as String?,
    appVersion: request['appVersion'] as String?,
    requestedAt: request['requestedAt'] as String?,
    nonce: request['nonce'] as String?,
  );
}

/// What one issuance produced. `key` is null for a preview.
class IssueResult {
  IssueResult({
    required this.key,
    required this.payload,
    required this.licence,
    required this.preview,
  });

  final String? key;
  final Map<String, dynamic> payload;
  final Licence licence;
  final Map<String, dynamic> preview;
}

class LicenceGenerator {
  LicenceGenerator(
    this.folder, {
    String Function()? nextLicenceId,
    String Function()? nextKeyId,
  })  : _nextLicenceId = nextLicenceId ?? newLicenceId,
        _nextKeyId = nextKeyId ?? newKeyId;

  final KeyFolder folder;
  final String Function() _nextLicenceId;
  final String Function() _nextKeyId;

  // ────────────────────────────────────────────────────────────── licences

  /// Registers what the customer bought. Every key is measured against it.
  Future<({Licence licence, Term term})> createLicence({
    String? ref,
    Object? seats,
    String? term,
  }) async {
    final key = await folder.readSigningKey();
    final register = await folder.loadRegister(key);
    final seatLimit = requireSeatCount(seats, '--seats');
    final parsed = parseTerm(term);
    final now = iso(folder.now());
    final licence = Licence(
      licenseId: _nextLicenceId(),
      ref: ref == null || ref.isEmpty ? null : ref,
      seats: seatLimit,
      seatsUsed: 0,
      term: parsed.months,
      machineId: null,
      startsAt: null,
      expiresAt: null,
      status: 'registered',
      createdAt: now,
      updatedAt: now,
    );
    register.licences[licence.licenseId] = licence;
    await folder.saveRegister(key, register);
    await folder.audit({
      'action': 'licence.create',
      'licenseId': licence.licenseId,
      'seats': seatLimit,
      'term': parsed.months,
      'result': 'registered',
    });
    return (licence: licence, term: parsed);
  }

  /// `licence set`: correct what the customer's licence screen says.
  Future<Licence> setLicence({
    required String licenceId,
    String? expires,
    Object? used,
    Object? seats,
  }) async {
    final key = await folder.readSigningKey();
    final register = await folder.loadRegister(key);
    final licence = _requireLicence(register, licenceId);
    if (expires != null) {
      if (expires == 'never') {
        licence.expiresAt = null;
      } else {
        final date = parseIso(expires);
        if (date == null) refuse('The expiry must be a date, e.g. 2027-05-01.');
        licence.expiresAt = iso(date);
      }
    }
    if (used != null) {
      final value = requiredInt(used, '--used');
      if (value > licence.seats) {
        refuse(
          '--used $value is above the recorded limit ${licence.seats}; correct '
          'the seat limit first.',
        );
      }
      licence.seatsUsed = value;
    }
    if (seats != null) {
      final value = requireSeatCount(seats, '--seats');
      if (value < licence.seatsUsed) {
        refuse('--seats $value is below the ${licence.seatsUsed} seat(s) in use.');
      }
      licence.seats = value;
    }
    licence.updatedAt = iso(folder.now());
    await folder.saveRegister(key, register);
    await folder.audit({
      'action': 'licence.set',
      'licenseId': licence.licenseId,
      'seats': licence.seats,
      'seatsUsed': licence.seatsUsed,
      'expiresAt': licence.expiresAt,
      'result': 'updated',
    });
    return licence;
  }

  // ─────────────────────────────────────────────────────────────── issuing

  /// Builds and signs one key. This is the only place a key is produced.
  Future<IssueResult> issueKey({
    required String type,
    required String licenceId,
    Object? machineId,
    String? request,
    String? term,
    Object? seats,
    Object? increase,
    Object? cap,
    Object? used,
    String? note,
    bool dryRun = false,
  }) async {
    final kind = type.toUpperCase();
    if (!keyTypes.contains(kind)) {
      refuse('issue needs a type: activation, renewal, seats, or transfer.');
    }
    final signingKey = await folder.readSigningKey();
    final register = await folder.loadRegister(signingKey);
    final licence = _requireLicence(register, licenceId);
    final issuedAt = iso(folder.now());
    final base = <String, dynamic>{
      'v': 1,
      'keyId': _nextKeyId(),
      'type': kind,
      'licenseId': licence.licenseId,
      'issuedAt': issuedAt,
    };
    final noteText = _note(note);

    late final Map<String, dynamic> payload;
    if (kind == 'ACTIVATION') {
      final machine = _resolveMachine(machineId, request);
      final chosenTerm = term == null || term.trim().isEmpty
          ? _licenceTerm(licence)
          : parseTerm(term);
      final seatLimit = seats == null || seats.toString().trim().isEmpty
          ? licence.seats
          : requireSeatCount(seats, '--seats');
      if (seatLimit < licence.seatsUsed) {
        refuse(
          'This licence already records ${licence.seatsUsed} used seat(s); a '
          'limit of $seatLimit would be below them.',
        );
      }
      payload = <String, dynamic>{
        ...base,
        'machineId': machine,
        'term': chosenTerm.toJson(),
        // An activation states the limit itself; it is not an increment.
        'seats': <String, dynamic>{'mode': 'CAP', 'value': seatLimit},
        'state': null,
        'note': noteText,
      };
      if (!dryRun) {
        licence.machineId = machine;
        licence.seats = seatLimit;
        licence.status = 'active';
        licence.startsAt ??= issuedAt;
        if (!chosenTerm.isPerpetual) {
          licence.expiresAt = iso(addMonths(folder.now(), chosenTerm.months!));
          licence.term = chosenTerm.months;
        } else {
          licence.expiresAt = null;
          licence.term = null;
        }
        _markSuperseded(register, licence.licenseId, 'ACTIVATION');
      }
    } else if (kind == 'RENEWAL') {
      final chosenTerm = term == null || term.trim().isEmpty
          ? _licenceTerm(licence)
          : parseTerm(term);
      payload = <String, dynamic>{
        ...base,
        'machineId': null,
        'term': chosenTerm.toJson(),
        'seats': null,
        'state': null,
        'note': noteText,
      };
      if (!dryRun) {
        if (chosenTerm.isPerpetual) {
          licence.expiresAt = null;
          licence.term = null;
        } else {
          final now = folder.now();
          final current = parseIso(licence.expiresAt);
          final from = current != null && current.isAfter(now) ? current : now;
          licence.expiresAt = iso(addMonths(from, chosenTerm.months!));
          licence.term = chosenTerm.months;
        }
        licence.status = 'active';
      }
    } else if (kind == 'SEATS') {
      final increaseBy = increase == null || increase.toString().trim().isEmpty
          ? null
          : requiredInt(increase, '--increase');
      final newCap = cap == null || cap.toString().trim().isEmpty
          ? null
          : requireSeatCount(cap, '--cap');
      if ((increaseBy == null) == (newCap == null)) {
        refuse('A seat key needs exactly one of "increase by N" or "new cap N".');
      }
      if (increaseBy != null && increaseBy < 1) {
        refuse('An increase must be at least 1 seat.');
      }
      final next = increaseBy != null ? licence.seats + increaseBy : newCap!;
      if (next < licence.seatsUsed) {
        refuse(
          'This licence records ${licence.seatsUsed} used seat(s); a limit of '
          '$next would be below them. A seat key never takes a seat back.',
        );
      }
      payload = <String, dynamic>{
        ...base,
        'machineId': null,
        'term': null,
        'seats': <String, dynamic>{
          'mode': increaseBy != null ? 'INCREASE' : 'CAP',
          'value': increaseBy ?? newCap,
        },
        'state': null,
        'note': noteText,
      };
      if (!dryRun) licence.seats = next;
    } else {
      // TRANSFER: the register's numbers are what travels; correct them from
      // the customer's licence screen first if they disagree.
      final machine = _resolveMachine(machineId, request);
      if (licence.machineId == null) {
        refuse(
          'This licence has no machine recorded, so there is nothing to '
          'transfer from. Issue an activation key first.',
        );
      }
      if (licence.machineId == machine) {
        refuse('The licence is already recorded on that machine; nothing to transfer.');
      }
      final seatsUsed = used == null || used.toString().trim().isEmpty
          ? licence.seatsUsed
          : requiredInt(used, '--used');
      if (seatsUsed > licence.seats) {
        refuse(
          'The seats in use ($seatsUsed) are above the recorded limit '
          '${licence.seats}. Correct the licence first: a transfer cannot carry '
          'more accounts than the licence allows.',
        );
      }
      payload = <String, dynamic>{
        ...base,
        'machineId': machine,
        'term': null,
        'seats': null,
        'state': <String, dynamic>{
          'expiresAt': licence.expiresAt,
          'seatLimit': licence.seats,
          'seatsUsed': seatsUsed,
          'startsAt': licence.startsAt ?? issuedAt,
          'issuedAt': issuedAt,
        },
        'note': noteText,
      };
      if (!dryRun) {
        licence.machineId = machine;
        licence.seatsUsed = seatsUsed;
        _markSuperseded(register, licence.licenseId, 'TRANSFER');
      }
    }

    if (dryRun) {
      return IssueResult(
        key: null,
        payload: payload,
        licence: licence,
        preview: previewOf(payload),
      );
    }

    final key = await signPayload(payload, signingKey);
    // Never trust what was just written: read it back through the public key.
    final check = await readPayload(key, await signingKey.publicKeyBytes());
    if (!check.valid) {
      refuse('The key did not verify after signing; refusing to issue it.');
    }

    _recordKey(register, licence, payload, key);
    await folder.saveRegister(signingKey, register);
    await folder.audit({
      'action': 'issue',
      'type': kind,
      'keyId': payload['keyId'],
      'licenseId': payload['licenseId'],
      'machineId': payload['machineId'],
      'seats': payload['seats'],
      'term': payload['term'],
      'result': 'issued',
    });
    return IssueResult(
      key: key,
      payload: payload,
      licence: licence,
      preview: previewOf(payload),
    );
  }

  // ────────────────────────────────────────────────────────────── register

  /// `mark-used`: records that the customer applied a key. A seat is never
  /// given back here — that rule lives in the product, not in this tool.
  Future<IssuedKey> markUsed(String keyId, {String? at}) async {
    final signingKey = await folder.readSigningKey();
    final register = await folder.loadRegister(signingKey);
    final key = _findKey(register, keyId);
    if (key.status == 'revoked') {
      refuse('Key ${key.keyId} is revoked; it cannot be marked used.');
    }
    key.status = 'used';
    key.usedAt = at ?? iso(folder.now());
    final licence = register.licences[key.licenseId];
    if (licence != null && key.type == 'ACTIVATION' && key.seats != null) {
      licence.seats = (key.seats!['value'] as num).toInt();
    }
    await folder.saveRegister(signingKey, register);
    await folder.audit({
      'action': 'mark-used',
      'keyId': key.keyId,
      'licenseId': key.licenseId,
      'result': 'used',
    });
    return key;
  }

  Future<IssuedKey> revoke(String keyId, String reason) async {
    final signingKey = await folder.readSigningKey();
    final register = await folder.loadRegister(signingKey);
    final key = _findKey(register, keyId);
    if (reason.trim().isEmpty) {
      refuse('A revocation needs a reason: it is the record of why it was withdrawn.');
    }
    key.status = 'revoked';
    key.revokedAt = iso(folder.now());
    key.reason = reason.length > 300 ? reason.substring(0, 300) : reason;
    await folder.saveRegister(signingKey, register);
    await folder.audit({
      'action': 'revoke',
      'keyId': key.keyId,
      'licenseId': key.licenseId,
      'result': 'revoked',
    });
    return key;
  }

  /// Checks a key against this folder's public key, and records the check.
  Future<({Map<String, dynamic> payload, bool valid})> verifyKey(String keyText) async {
    final signingKey = await folder.readSigningKey();
    final result = await readPayload(keyText, await signingKey.publicKeyBytes());
    await folder.audit({
      'action': 'verify',
      'keyId': result.payload['keyId'],
      'licenseId': result.payload['licenseId'],
      'type': result.payload['type'],
      'result': result.valid ? 'valid' : 'INVALID',
    });
    return (payload: result.payload, valid: result.valid);
  }

  /// What the window shows: what exists, never what is secret.
  Future<FolderSnapshot> snapshot() async {
    final hasKey = folder.hasKeyPair;
    String? fingerprint;
    var licences = <Licence>[];
    var keys = <IssuedKey>[];
    if (hasKey) {
      try {
        final signingKey = await folder.readSigningKey();
        fingerprint = await signingKey.fingerprint();
        final register = await folder.loadRegister(signingKey);
        licences = register.licences.values.toList()
          ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
        keys = register.keys.reversed.toList();
      } catch (_) {
        // A folder that cannot be read is reported as "no usable key".
        fingerprint = null;
      }
    }
    return FolderSnapshot(
      home: folder.home,
      version: toolVersion,
      hasKey: hasKey && fingerprint != null,
      fingerprint: fingerprint,
      licences: licences,
      keys: keys,
      audit: await folder.readAudit(),
    );
  }

  // ───────────────────────────────────────────────────────────── internals

  Licence _requireLicence(Register register, String id) {
    final licence = register.licences[id];
    if (licence == null) refuse('There is no licence $id in the register.');
    return licence;
  }

  void _markSuperseded(Register register, String licenceId, String type) {
    for (final key in register.keys) {
      if (key.licenseId == licenceId && key.type == type && key.status == 'issued') {
        key.status = 'superseded';
        key.supersededAt = iso(folder.now());
      }
    }
  }

  void _recordKey(
    Register register,
    Licence licence,
    Map<String, dynamic> payload,
    String key,
  ) {
    register.keys.add(IssuedKey(
      keyId: payload['keyId'] as String,
      licenseId: payload['licenseId'] as String,
      type: payload['type'] as String,
      machineId: payload['machineId'] as String?,
      term: (payload['term'] as Map?)?['months'] as int?,
      seats: (payload['seats'] as Map?)?.cast<String, dynamic>(),
      issuedAt: payload['issuedAt'] as String,
      status: 'issued',
      note: payload['note'] as String?,
      // Never store the key text itself: the register travels in backups.
      fingerprint: sha256HexOfText(key).substring(0, 16),
    ));
    licence.updatedAt = iso(folder.now());
  }

  Term _licenceTerm(Licence licence) => licence.term == null
      ? const Term.perpetual()
      : Term.months(licence.term!);

  String? _note(String? text) {
    if (text == null) return null;
    return text.length > 300 ? text.substring(0, 300) : text;
  }

  String _resolveMachine(Object? machineValue, String? request) {
    final fromMachine = machineValue == null || machineValue.toString().trim().isEmpty
        ? null
        : requireMachine(machineValue.toString());
    final fromRequest = request == null || request.trim().isEmpty
        ? null
        : parseRequestCode(request).machineId;
    if (fromRequest != null && !machineIdPattern.hasMatch(fromRequest)) {
      refuse('The request code carries "$fromRequest", which is not a machine id.');
    }
    if (fromMachine != null && fromRequest != null && fromMachine != fromRequest) {
      refuse(
        'The request code is for machine $fromRequest, but the machine field '
        'says $fromMachine. Use the machine id from the request code.',
      );
    }
    final machine = fromMachine ?? fromRequest;
    if (machine == null) {
      refuse('A machine id is required (the KM-… id from the request code).');
    }
    return machine;
  }

  IssuedKey _findKey(Register register, String id) {
    for (final key in register.keys) {
      if (key.keyId == id || key.keyId.endsWith(id) || key.fingerprint == id) {
        return key;
      }
    }
    refuse('No key matching "$id" in the register.');
  }
}

class FolderSnapshot {
  FolderSnapshot({
    required this.home,
    required this.version,
    required this.hasKey,
    required this.fingerprint,
    required this.licences,
    required this.keys,
    required this.audit,
  });

  final String home;
  final String version;
  final bool hasKey;
  final String? fingerprint;
  final List<Licence> licences;
  final List<IssuedKey> keys;
  final List<Map<String, dynamic>> audit;
}

/// The machine id a key names, uppercased the way the CLI does it.
String requireMachine(String value) {
  final machineId = value.trim().toUpperCase();
  if (!machineIdPattern.hasMatch(machineId)) {
    refuse('"$value" is not a machine id. It looks like KM-XXXX-XXXX-XXXX-XXXX.');
  }
  return machineId;
}

int requiredInt(Object? value, String name) {
  if (value == null || value.toString().trim().isEmpty) {
    refuse('$name is required.');
  }
  final parsed = int.tryParse(value.toString().trim());
  if (parsed == null || parsed < 0) {
    refuse('$name must be a whole number.');
  }
  return parsed;
}

/// A seat limit of zero is not "no seats": the product reads `limit > 0`
/// before it refuses anyone, so zero would quietly mean unlimited.
int requireSeatCount(Object? value, String name) {
  final seats = requiredInt(value, name);
  if (seats < 1) {
    refuse(
      '$name must be at least 1. Zero would not mean "no users": the product '
      'reads a limit of zero as no limit at all.',
    );
  }
  return seats;
}

/// What the operator sees before signing: no key text, no signature.
Map<String, dynamic> previewOf(Map<String, dynamic> payload) => <String, dynamic>{
      'type': payload['type'],
      'keyId': payload['keyId'],
      'licenseId': payload['licenseId'],
      'machineId': payload['machineId'],
      'term': payload['term'],
      'seats': payload['seats'],
      'state': payload['state'],
      'issuedAt': payload['issuedAt'],
      'note': payload['note'],
    };

/// `KYN1.<payload>.<signature>` over exactly the payload text built above.
Future<String> signPayload(Map<String, dynamic> payload, SigningKey key) async {
  final json = payloadJson(payload);
  final signedText = '$keyPrefix.${b64url(utf8.encode(json))}';
  final signature = await key.sign(utf8.encode(signedText));
  return '$signedText.${b64url(signature)}';
}

/// Reads a key and says whether this folder's key signed it.
Future<({Map<String, dynamic> payload, bool valid})> readPayload(
  String keyText,
  List<int> publicKey,
) async {
  final text = keyText.replaceAll(RegExp(r'\s+'), '').trim();
  final parts = text.split('.');
  if (parts.length != 3 || parts[0] != keyPrefix) {
    refuse('That is not a KAYAN key (it should start with KYN1.).');
  }
  final Map<String, dynamic> payload;
  try {
    payload = Map<String, dynamic>.from(
      jsonDecode(utf8.decode(unb64url(parts[1]))) as Map,
    );
  } catch (_) {
    refuse('That key carries no readable payload.');
  }
  final valid = await verifySignature(
    utf8.encode('${parts[0]}.${parts[1]}'),
    unb64url(parts[2]),
    publicKey,
  );
  return (payload: payload, valid: valid);
}

