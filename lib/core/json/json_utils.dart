/// Convenience readers for the loose maps the API returns.
///
/// Everything money-shaped arrives as a *string* on purpose, so that no
/// binary floating point ever touches an amount. These helpers keep that
/// discipline: they never call `double.parse`.
library;

typedef Json = Map<String, dynamic>;

/// A value that is either a [String], a [num] or absent.
String? asString(Object? value) {
  if (value == null) return null;
  final text = value.toString();
  return text.isEmpty ? null : text;
}

String text(Json json, String key, {String fallback = ''}) =>
    asString(json[key]) ?? fallback;

/// Keeps the amount as text so it is never parsed into a double.
String amount(Json json, String key, {String fallback = '0'}) =>
    asString(json[key]) ?? fallback;

num? asNum(Object? value) {
  if (value is num) return value;
  if (value is String) return num.tryParse(value);
  return null;
}

bool flag(Json json, String key, {bool fallback = false}) =>
    json[key] is bool ? json[key] as bool : fallback;

List<Json> listOf(Object? value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((e) => Map<String, dynamic>.from(e))
      .toList(growable: false);
}
