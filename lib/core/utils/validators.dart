import 'package:decimal/decimal.dart';

/// Pure, reusable input validators. Kept free of Flutter imports so they can
/// be unit-tested and reused by the presentation layer.
class Validators {
  Validators._();

  static final RegExp _email = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

  static bool isNotBlank(String? value) =>
      value != null && value.trim().isNotEmpty;

  static bool isEmail(String? value) =>
      isNotBlank(value) && _email.hasMatch(value!.trim());

  static bool isUsername(String? value) {
    if (!isNotBlank(value)) return false;
    return RegExp(r'^[A-Za-z0-9._-]{3,64}$').hasMatch(value!.trim());
  }

  static bool isStrongEnoughPassword(String? value) =>
      value != null && value.length >= 8;

  /// Returns a parsed decimal, or null when [value] is not a valid number.
  static Decimal? tryParseAmount(String? value) {
    if (!isNotBlank(value)) return null;
    try {
      return Decimal.parse(value!.trim());
    } on FormatException {
      return null;
    }
  }

  static bool isPositiveAmount(String? value) {
    final parsed = tryParseAmount(value);
    return parsed != null && parsed > Decimal.zero;
  }
}
