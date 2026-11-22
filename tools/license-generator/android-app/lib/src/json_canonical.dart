/// The two text rules the key format depends on.
///
/// A signed key is `KYN1.<base64url(json)>.<signature>`, so the exact bytes of
/// that JSON are part of the key: a different key order or a different escape
/// would produce a different signature for the same licence. And the register
/// is authenticated with an HMAC over a *canonical* spelling of the file, so
/// the two tools must sort and indent identically or one cannot read the
/// other's register. Both rules below are copies of `JSON.stringify`,
/// `stableStringify` and `toISOString` in `tools/license-generator/kayan-license.mjs`.
library;

import 'dart:convert';

/// `new Date().toISOString()`: UTC, milliseconds, always three decimals.
String iso(DateTime value) {
  final utc = DateTime.fromMillisecondsSinceEpoch(
    value.millisecondsSinceEpoch,
    isUtc: true,
  );
  return utc.toIso8601String();
}

/// `Date.parse` — a date the operator typed, or null when it is not a date.
DateTime? parseIso(String? text) {
  if (text == null) return null;
  return DateTime.tryParse(text.trim());
}

/// JSON with the object's keys in the order they were inserted.
///
/// `jsonEncode` does exactly that for a [Map], which is why payloads are built
/// as ordered maps field by field.
String payloadJson(Object? value) => jsonEncode(value);

/// `stableStringify(value)` from the generator: keys sorted, no spaces.
String stableCompact(Object? value) => _compact(value);

/// `stableStringify(value, 2)`: keys sorted, two-space indent, one field a line.
String stablePretty(Object? value, {int space = 2}) => _pretty(value, 0, space);

String _compact(Object? value) {
  if (value == null) return 'null';
  if (value is String) return jsonEncode(value);
  if (value is num) return _number(value);
  if (value is bool) return value ? 'true' : 'false';
  if (value is List) {
    return '[${value.map(_compact).join(',')}]';
  }
  if (value is Map) {
    final keys = value.keys.map((key) => key as String).toList()..sort();
    final body = keys
        .map((key) => '${jsonEncode(key)}:${_compact(value[key])}')
        .join(',');
    return '{$body}';
  }
  throw ArgumentError('Cannot write ${value.runtimeType} as JSON.');
}

String _pretty(Object? value, int depth, int space) {
  if (value is Map && value.isNotEmpty) {
    final keys = value.keys.map((key) => key as String).toList()..sort();
    final pad = ' ' * (space * (depth + 1));
    final close = ' ' * (space * depth);
    final body = keys
        .map((key) => '$pad${jsonEncode(key)}: ${_pretty(value[key], depth + 1, space)}')
        .join(',\n');
    return '{\n$body\n$close}';
  }
  if (value is List && value.isNotEmpty) {
    final pad = ' ' * (space * (depth + 1));
    final close = ' ' * (space * depth);
    final body =
        value.map((item) => '$pad${_pretty(item, depth + 1, space)}').join(',\n');
    return '[\n$body\n$close]';
  }
  return _compact(value);
}

/// A number the way JavaScript writes it: no trailing `.0`, no exponent for
/// the sizes this tool handles.
String _number(num value) {
  if (value is int) return value.toString();
  if (value.isFinite && value == value.roundToDouble()) {
    return value.toInt().toString();
  }
  return value.toString();
}
