import 'package:intl/intl.dart';

/// Formats an amount that arrived from the API as a string.
///
/// The value is padded to four decimals, the scale the database stores, then
/// shown with the locale's grouping separators. The digits themselves are
/// never converted to a double.
String formatAmount(String? raw, {int decimals = 2, String? locale}) {
  if (raw == null || raw.isEmpty) return '';
  final negative = raw.startsWith('-');
  final digits = negative ? raw.substring(1) : raw;
  final parts = digits.split('.');
  final whole = parts.first.isEmpty ? '0' : parts.first;
  final fraction = parts.length > 1 ? parts[1] : '';

  final buffer = StringBuffer()
    ..write(negative ? '-' : '')
    ..write(_group(whole, locale));
  if (decimals > 0) {
    final kept = fraction.padRight(decimals, '0').substring(0, decimals);
    buffer..write('.')..write(kept);
  }
  return buffer.toString();
}

String _group(String digits, String? locale) {
  final pattern = locale?.startsWith('ar') ?? false
      ? NumberFormat('#,##0', 'ar_EG')
      : NumberFormat('#,##0', 'en_US');
  final value = int.tryParse(digits);
  if (value == null) return digits;
  return pattern.format(value);
}

/// Trims the four trailing zeros the API sends, so `150.0000` reads `150`.
String formatQuantity(String? raw, {int decimals = 2}) {
  if (raw == null || raw.isEmpty) return '';
  final negative = raw.startsWith('-');
  final digits = negative ? raw.substring(1) : raw;
  final parts = digits.split('.');
  var fraction = parts.length > 1 ? parts[1] : '';
  while (fraction.length > decimals && fraction.endsWith('0')) {
    fraction = fraction.substring(0, fraction.length - 1);
  }
  if (fraction.length > decimals) fraction = fraction.substring(0, decimals);
  while (fraction.isNotEmpty && fraction.endsWith('0')) {
    fraction = fraction.substring(0, fraction.length - 1);
  }
  final whole = parts.first.isEmpty ? '0' : parts.first;
  return '${negative ? '-' : ''}$whole${fraction.isEmpty ? '' : '.$fraction'}';
}
