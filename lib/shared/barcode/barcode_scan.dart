import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';

import '../../core/error/failure.dart';
import '../../core/json/discount_math.dart' show moneyScale;
import '../../core/json/json_utils.dart';

/// Active units a line can choose for [item], smallest factor first.
///
/// A legacy item that predates multi-unit and carries no `units` array is
/// synthesised as a single base unit, so a document line always offers the
/// item's own unit and stays valid. An item that has not been picked yet yields
/// an empty list and the control is disabled.
List<Json> lineUnitsOf(Json? item) {
  if (item == null) return const <Json>[];
  final raw = item['units'];
  final stored = (raw is List ? raw.cast<Json>() : const <Json>[])
      .where((unit) => flag(unit, 'isActive', fallback: true))
      .toList();
  if (stored.isNotEmpty) {
    stored.sort((a, b) {
      final fa = Decimal.tryParse(asString(a['factor']) ?? '') ?? Decimal.one;
      final fb = Decimal.tryParse(asString(b['factor']) ?? '') ?? Decimal.one;
      return fa.compareTo(fb);
    });
    return stored;
  }
  return <Json>[
    <String, dynamic>{
      'id': null,
      'unit': text(item, 'unit'),
      'factor': '1.000000',
      'isBase': true,
      'isActive': true,
      'salePrice': item['salePrice'],
      'purchasePrice': item['purchasePrice'],
    },
  ];
}

String defaultLineUnit(Json item, {required bool isSales}) {
  final units = lineUnitsOf(item);
  final preferredKey = isSales ? 'isDefaultSale' : 'isDefaultPurchase';
  for (final unit in units) {
    if (flag(unit, preferredKey)) return text(unit, 'unit');
  }
  final base = text(item, 'unit');
  return units.any((unit) => text(unit, 'unit') == base)
      ? base
      : (units.isEmpty ? base : text(units.first, 'unit'));
}

/// The unit-specific list price, or the base-unit price converted once into
/// the chosen unit. An unknown/invalid unit or missing cost stays empty.
String unitListPrice(Json item, String unitName, {required bool isSales}) {
  final key = isSales ? 'salePrice' : 'purchasePrice';
  for (final unit in lineUnitsOf(item)) {
    if (text(unit, 'unit') == unitName) {
      final specific = text(unit, key);
      if (specific.isNotEmpty) return specific;
      final basePrice = Decimal.tryParse(text(item, key));
      if (basePrice == null) return '';
      final parsedFactor = Decimal.tryParse(text(unit, 'factor'));
      final factor =
          parsedFactor ?? (unitName == text(item, 'unit') ? Decimal.one : null);
      if (factor == null || factor <= Decimal.zero) return '';
      return (basePrice * factor).round(scale: moneyScale).toString();
    }
  }
  return unitName == text(item, 'unit') ? text(item, key) : '';
}

/// The unit a scan of [match] must be added in.
///
/// A unit's own barcode names the unit itself, and that label is more specific
/// than any catalogue default - scanning a carton code adds a carton even when
/// the item's default selling unit is a piece, because the operator pointed the
/// scanner at a carton.
///
/// The item's own barcode names no unit, so the document decides: a sales
/// invoice starts on the default SELLING unit and a purchase invoice on the
/// default PURCHASING unit. That is what makes an item whose carton is marked
/// "default sale unit" arrive as one carton from its shelf label.
String defaultScannedUnit(BarcodeMatch match, {required bool isSales}) {
  if (match.matched == 'unit' && match.unit.isNotEmpty) return match.unit;
  return defaultLineUnit(match.item, isSales: isSales);
}

/// One scanned barcode, understood.
///
/// This is the *answer* to a scan, not the scanning itself: the endpoint
/// (`GET /inventory/items/by-barcode/:code`) already decided which item and
/// which unit the label belongs to, and how many base units one scan stands
/// for. Everything here is derived from that answer without asking the server
/// again, so the three screens that accept a scan - a stock voucher, a sales or
/// purchase invoice, and a stock take - cannot disagree about what a label
/// means.
class BarcodeMatch {
  BarcodeMatch({
    required this.code,
    required this.item,
    required this.unit,
    required this.factor,
    required this.matched,
  });

  /// The code exactly as scanned, for error messages and the repeat guard.
  final String code;

  /// The item the code resolved to, as the API returned it. It carries the
  /// item's `units` table, so a screen can show the base equivalent and the
  /// default unit without a second request.
  final Json item;

  /// The unit the label itself identifies. One scan of this code means one of
  /// this unit - NOT its factor in base units.
  final String unit;

  /// How many base units one [unit] holds. Used to *show* an equivalent and to
  /// choose which column a count belongs in. Never multiplied into the posted
  /// quantity: the server owns that conversion, and doing it here as well
  /// stores the factor squared (a carton of 24 would become 576 pieces).
  final Decimal factor;

  /// `'item'` when the item's own barcode was scanned, `'unit'` when the unit's.
  final String matched;

  String get itemId => text(item, 'id');
  String get itemCode => text(item, 'code');

  /// The item name in the reader's language, falling back to the other one so
  /// a half-translated catalogue never leaves a blank line.
  String itemName(String languageCode) {
    final arabic = languageCode == 'ar';
    final preferred = arabic ? 'nameAr' : 'nameEn';
    final other = arabic ? 'nameEn' : 'nameAr';
    return text(item, preferred, fallback: text(item, other));
  }

  bool get isBaseUnit => factor == Decimal.one;

  /// Turns a raw `by-barcode` response into a match, or throws when the server
  /// answered with something this screen cannot act on.
  ///
  /// An empty body, a missing item or a missing unit is a *failed read*, not a
  /// successful scan of "nothing": the caller must keep the operator's input
  /// and say the label did not read, rather than silently adding a blank line.
  static BarcodeMatch fromResponse(String code, Object? payload) {
    if (payload is! Map) {
      throw const FormatException('Barcode result is not an object');
    }
    final body = Map<String, dynamic>.from(payload);
    final rawItem = body['item'];
    if (rawItem is! Map) {
      throw const FormatException('Barcode result has no item');
    }
    final item = Map<String, dynamic>.from(rawItem);
    if (text(item, 'id').isEmpty) {
      throw const FormatException('Barcode result has no item id');
    }
    // The unit may legitimately be absent for a legacy item that never had a
    // packing table; the item's own unit is then the base unit.
    final unit = text(
      body,
      'unit',
      fallback: text(item, 'unit'),
    ).trim();
    // A base-unit scan is the ONE case where factor 1 is the truth: the server
    // sends `matched: 'item'` or a factor of exactly 1 for a label that means
    // the item itself. For a non-base unit the factor is what the whole
    // conversion rests on, so a missing or unusable factor is a broken
    // response, not a licence to assume 1. Assuming 1 there would silently
    // turn "one carton" into "one piece" - a 24-fold error nobody sees until
    // the shelf is wrong.
    final matched = text(body, 'matched', fallback: 'item');
    final rawFactor = text(body, 'factor').trim();
    final factor = _resolveFactor(code, rawFactor, matched);
    final resolvedUnit = unit.isEmpty ? text(item, 'unit') : unit;
    if (resolvedUnit.isEmpty) {
      throw FormatException(
        'Barcode $code resolved to an item with no unit; a scan cannot mean nothing',
      );
    }
    // A non-base unit must actually belong to the item it came with. A server
    // that names a unit the item's own packing table does not contain has sent
    // two contradictory facts; the screen cannot pick one of them.
    if (matched == 'unit' && factor != Decimal.one) {
      final known = factorOfUnit(item, resolvedUnit);
      if (known == null) {
        throw FormatException(
          'Barcode $code says unit "$resolvedUnit" but the item does not list it',
        );
      }
      if (known != factor) {
        throw FormatException(
          'Barcode $code says unit "$resolvedUnit" has factor $factor, '
          'but the item says $known',
        );
      }
    }
    return BarcodeMatch(
      code: code,
      item: item,
      unit: resolvedUnit,
      factor: factor,
      matched: matched,
    );
  }

  /// The conversion factor a scan means, or a [FormatException] when the
  /// response does not justify one.
  ///
  /// Factor 1 is never a *default*. It is accepted only when the response
  /// actually says so - the item's own barcode, or an explicit `1` - because a
  /// missing factor on a carton label is exactly the case where guessing
  /// "1" would under-count the shelf by the packing size.
  static Decimal _resolveFactor(String code, String rawFactor, String matched) {
    final isBaseScan = matched == 'item';
    if (rawFactor.isEmpty) {
      if (isBaseScan) return Decimal.one;
      throw FormatException(
        'Barcode $code names a unit but carries no conversion factor',
      );
    }
    final parsed = Decimal.tryParse(rawFactor);
    if (parsed == null) {
      throw FormatException(
        'Barcode $code carries a conversion factor that is not a number: "$rawFactor"',
      );
    }
    if (!parsed.isFinite || parsed <= Decimal.zero) {
      throw FormatException(
        'Barcode $code carries a conversion factor that must be greater than zero, got "$rawFactor"',
      );
    }
    return parsed;
  }
}

/// What a scan does to the number already in a quantity box.
///
/// Two rules, both learned from the operator's hands rather than from the
/// screen:
///   * a scan of the same item in the same unit is another copy - scan a carton
///     twice, count two cartons - so it adds one;
///   * a scan of a different item or unit is a different thing, so it starts at
///     one instead of inheriting the previous figure.
///
/// The box always holds a number in the *selected* unit. Returning the base
/// quantity here is what would double-convert every carton.
Decimal quantityAfterScan({Decimal? current, required bool sameSelection}) {
  if (!sameSelection) return Decimal.one;
  final value = current ?? Decimal.zero;
  return value > Decimal.zero ? value + Decimal.one : Decimal.one;
}

/// The number a `Decimal` should be written back into a text box as: plain
/// digits, with the trailing zeros a parsed `1.000000` carries removed, so the
/// operator does not see formatting they did not type.
String plainQuantity(Decimal value) {
  final rounded = value.round(scale: 4);
  var written = rounded.toString();
  if (!written.contains('.')) return written;
  written = written.replaceFirst(RegExp(r'0+$'), '');
  return written.endsWith('.')
      ? written.substring(0, written.length - 1)
      : written;
}

/// The conversion factor of [unitName] on [item], or null when the item does
/// not describe that unit.
///
/// Only ever used to *show* an equivalent. Applying it to a posted quantity is
/// the double conversion the whole barcode design exists to prevent.
Decimal? factorOfUnit(Json? item, String? unitName) {
  if (item == null) return null;
  final name = (unitName ?? '').trim();
  if (name.isEmpty) return null;
  final raw = item['units'];
  if (raw is List) {
    for (final row in raw) {
      if (row is! Map) continue;
      final unit = Map<String, dynamic>.from(row);
      if (text(unit, 'unit') != name) continue;
      final factor = Decimal.tryParse(text(unit, 'factor').trim());
      if (factor != null && factor > Decimal.zero) return factor;
    }
  }
  // A legacy item without a units table behaves as its own base unit, and an
  // unknown unit has no factor at all - guessing one would be a silent
  // conversion.
  return name == text(item, 'unit') ? Decimal.one : null;
}

/// "1 carton = 24 piece", or null when there is nothing to add.
///
/// Shown under the line so the operator can see what the stock will actually
/// move, while the quantity box keeps holding the cartons they scanned. Null
/// for the base unit, because there the quantity already is the base quantity
/// and repeating it would read as two different numbers.
String? baseEquivalentLabel({
  required Json? item,
  required String? unitName,
  required String quantityText,
}) {
  final quantity = Decimal.tryParse(quantityText.trim());
  final factor = factorOfUnit(item, unitName);
  if (quantity == null || quantity <= Decimal.zero) return null;
  if (factor == null || factor == Decimal.one) return null;
  final base = plainQuantity(quantity * factor);
  final baseUnit = text(item!, 'unit', fallback: 'unit');
  return '${quantityText.trim()} $unitName = $base $baseUnit';
}

/// Whether a scanned code is a repeat of the one this box just accepted.
///
/// A scanner fires the same label many times for one physical press - the
/// keyboard wedge repeats its keystrokes, and the same field is submitted twice.
/// Without this guard one press becomes five cartons. The window is short on
/// purpose: an operator really may scan the same label again a moment later to
/// add a second carton, and the accepted code is therefore forgotten as soon as
/// it is accepted for a *different* code or after the window passes.
///
/// [inFlight] is separate and stricter: while the lookup for one scan is still
/// out, a second submit must not start a second request, whatever the code.
bool isRepeatScan({
  required String? lastCode,
  required DateTime? lastAt,
  required String code,
  required bool inFlight,
  DateTime? now,
  Duration window = const Duration(milliseconds: 800),
}) {
  if (inFlight) return true;
  if (lastCode == null || lastAt == null || lastCode != code) return false;
  return (now ?? DateTime.now()).difference(lastAt) < window;
}

/// The sentence to show when a code is not in the catalogue, or null when the
/// failure is something else.
///
/// A 404 here means exactly one thing: no item of this company and no unit of
/// one carries the label. The generic "record not found" would leave the
/// operator wondering whether the scanner read the label at all, so the
/// message names the code and says what to do next. A permission or network
/// failure is passed through untouched - it must never be reported as a bad
/// label.
String? unknownBarcodeMessage(
  Object error,
  String code, {
  required bool arabic,
}) {
  final missing = error is ApiFailure
      ? error.statusCode == 404
      : error.toString().contains('404');
  if (!missing) return null;
  return arabic
      ? 'لا يوجد صنف أو وحدة بهذا الباركود: $code. تحقق من الملصق أو ابحث عن الصنف يدويًا.'
      : 'No item or unit carries the barcode $code. Check the label or search for the item by name.';
}

/// A read that produced nothing usable - a truncated response, a missing item,
/// not a "no such barcode" answer. The operator is told the label did not read
/// and their input stays where it was.
String unreadableBarcodeMessage(String code, {required bool arabic}) => arabic
    ? 'لم تُقرأ نتيجة صالحة للباركود: $code. أعد المحاولة أو أدخل الصنف يدويًا.'
    : 'The barcode $code did not return a usable item. Scan it again or enter the item by hand.';

/// The sentence for a response that arrived but cannot be trusted.
///
/// This is deliberately NOT "scan it again". The label was read and the server
/// answered; the answer itself is incomplete or contradictory - a missing
/// conversion factor, a factor that disagrees with the item's packing table, a
/// unit the item does not have. Scanning again produces the same broken answer,
/// so telling the operator to retry would leave them in a loop. Saying the item
/// data is incomplete, and offering the way out, is the honest sentence.
String invalidBarcodeDataMessage(String code, {required bool arabic}) => arabic
    ? 'بيانات الباركود $code غير مكتملة أو غير متوافقة مع بيانات الصنف (وحدة أو معامل تحويل). لم تُضف أي كمية. أدخل الصنف يدويًا وأبلغ المسؤول عن بيانات الصنف.'
    : 'The barcode $code carries incomplete or contradictory data (a unit or conversion factor). Nothing was added. Enter the item by hand and report the item data to an administrator.';

/// The shared "scan, then tell the user what happened" path used by every
/// screen that accepts a barcode.
///
/// The lookup itself lives here so that a scan means the same request with the
/// same parsing everywhere, and so the two failure sentences are produced in
/// one place. The caller supplies what to do with a *successful* match; it is
/// not called at all when the lookup failed, which is what keeps the screen's
/// current input intact after a bad read.
class BarcodeScanner {
  BarcodeScanner({required this.lookup});

  /// Performs the HTTP call. Injected so each screen passes its own client and
  /// a test can answer without a server.
  final Future<Object?> Function(String code) lookup;

  /// Resolves [rawCode] and hands the match to [onMatch].
  ///
  /// Returns the match on success and null on failure. On failure [onFailure]
  /// is called with a sentence that is safe to show, because deciding the
  /// wording here is what stops three screens from inventing three different
  /// ones.
  Future<BarcodeMatch?> scan(
    String rawCode, {
    required Future<void> Function(BarcodeMatch match) onMatch,
    required Future<void> Function(String message) onFailure,
    required bool arabic,
  }) async {
    final code = rawCode.trim();
    if (code.isEmpty) return null;
    final BarcodeMatch match;
    try {
      final payload = await lookup(code);
      match = BarcodeMatch.fromResponse(code, payload);
    } catch (error) {
      final unknown = unknownBarcodeMessage(error, code, arabic: arabic);
      // A FormatException is the response that arrived and cannot be trusted,
      // which is a different instruction to the operator than a read that
      // produced nothing: retrying will not help, so do not say "scan again".
      final message = unknown ??
          (error is FormatException
              ? invalidBarcodeDataMessage(code, arabic: arabic)
              : unreadableBarcodeMessage(code, arabic: arabic));
      await onFailure(message);
      return null;
    }
    await onMatch(match);
    return match;
  }
}

/// The scan field itself, so the three screens show the same control with the
/// same label and the same submission behaviour instead of three copies that
/// drift apart.
class BarcodeScanField extends StatelessWidget {
  const BarcodeScanField({
    super.key,
    required this.controller,
    required this.onSubmitted,
    required this.arabic,
    this.enabled = true,
    this.autofocus = false,
    this.label,
    this.compact = false,
  });

  final TextEditingController controller;
  final ValueChanged<String> onSubmitted;
  final bool arabic;
  final bool enabled;
  final bool autofocus;

  /// Overrides the default label when the screen has a narrower meaning, such
  /// as "scan to add an item" on an invoice.
  final String? label;

  /// Dense decoration for a row inside a table rather than a card of its own.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    // The widget's own key identifies the scan box; the field inside it must
    // NOT carry the same key, or two elements would answer `find.byKey` and a
    // test could not say which one it touched.
    return TextFormField(
      controller: controller,
      enabled: enabled,
      autofocus: autofocus,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        labelText:
            label ?? (arabic ? 'مسح باركود الصنف أو الوحدة' : 'Scan item or unit barcode'),
        prefixIcon: const Icon(Icons.qr_code_scanner, size: 18),
        isDense: compact,
        border: const OutlineInputBorder(),
      ),
      onFieldSubmitted: onSubmitted,
    );
  }
}
