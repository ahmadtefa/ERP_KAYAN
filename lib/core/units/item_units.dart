import 'package:decimal/decimal.dart';

import '../json/amount_format.dart';
import '../json/json_utils.dart';

/// How an item's units behave on a document, and what a typed quantity
/// becomes once it reaches the ledger.
///
/// Everything here is read from the item the API returned - its `unit` is the
/// base unit, its `units` array holds one row per conversion (factor, whether
/// a fraction of it is real, and where it may be used). Nothing is stored on
/// this side: the screens show what the server would do, using the same
/// arithmetic, so a person sees "10 كرتونة = 120 عبوة" before saving instead
/// of discovering it in the stock report afterwards.
///
/// These functions live in `core` because four screens need them (the invoice
/// editor, the stock documents screen, the stock card and the items screen),
/// and a rule that exists twice is a rule that will disagree with itself.

/// Active units a line can choose for [item], smallest factor first.
///
/// A legacy item that predates multi-unit and carries no `units` array is
/// synthesised as a single base unit, so the picker always offers the item's
/// own unit and the document stays valid. An item that has not been picked yet
/// yields an empty list and the control is disabled.
List<Json> lineUnitsOf(Json? item, {bool? forSales}) {
  if (item == null) return const <Json>[];
  final raw = item['units'];
  final stored =
      (raw is List ? raw.cast<Json>() : const <Json>[])
          .where((unit) => flag(unit, 'isActive', fallback: true))
          .where((unit) {
            // A unit can be switched off for one side of the business: a
            // supplier sells by the carton, the shop by the bottle. When the
            // caller names a side, a unit meant for the other one is not
            // offered - the server refuses it anyway, and offering it would
            // only produce an error after the line was typed.
            if (forSales == null) return true;
            return flag(
              unit,
              forSales ? 'usedInSales' : 'usedInPurchases',
              fallback: true,
            );
          })
          .toList();
  if (stored.isNotEmpty) {
    stored.sort((a, b) {
      final oa = int.tryParse(asString(a['sortOrder']) ?? '') ?? 0;
      final ob = int.tryParse(asString(b['sortOrder']) ?? '') ?? 0;
      if (oa != ob) return oa.compareTo(ob);
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
      'allowFraction': true,
      'salePrice': item['salePrice'],
      'purchasePrice': item['purchasePrice'],
    },
  ];
}

/// The unit a line names, or the item's base unit when the line names none.
Json? lineUnitOf(Json? item, String? unitName) {
  final units = lineUnitsOf(item);
  for (final unit in units) {
    if (text(unit, 'unit') == unitName) return unit;
  }
  for (final unit in units) {
    if (flag(unit, 'isBase', fallback: false)) return unit;
  }
  return units.isEmpty ? null : units.first;
}

/// Whether a quantity typed in [unit] is a whole number of it.
///
/// A carton of twenty-four bottles has no half: the shelf either has a carton
/// or it does not. The server refuses it; catching it here says so while the
/// person is still on the field instead of after Save.
bool quantityAllowedInUnit(Json? unit, String quantity) {
  if (unit == null) return true;
  if (flag(unit, 'allowFraction', fallback: true)) return true;
  final parsed = Decimal.tryParse(quantity.trim());
  if (parsed == null) return true;
  return parsed == parsed.truncate();
}

/// The unit-specific list price for [unitName] on [item], or the item's own
/// price when the unit defines none. Returns an empty string when neither is
/// set, so the caller can leave the field the user already typed alone.
String unitListPrice(Json item, String unitName, {required bool isSales}) {
  final key = isSales ? 'salePrice' : 'purchasePrice';
  final base = text(item, key);
  for (final unit in lineUnitsOf(item)) {
    if (text(unit, 'unit') == unitName) {
      final specific = text(unit, key);
      if (specific.isNotEmpty) return specific;
      // The item price is per BASE unit, so a reel of five hundred must not be
      // offered at the price of one metre. Multiplying here mirrors what the
      // server does when the price is left empty - one rule, two callers.
      final factor = Decimal.tryParse(asString(unit['factor']) ?? '');
      final price = Decimal.tryParse(base);
      if (factor == null || price == null) return base;
      // The base unit is the item price already; multiplying by one would only
      // reformat a number the person typed.
      if (factor.compareTo(Decimal.one) == 0) return base;
      return (price * factor).toStringAsFixed(2);
    }
  }
  return base;
}

/// What a typed line becomes in the unit stock is kept in.
///
/// `10` cartons of `12` bottles is `120` bottles; `0.5` of a carton is `6`.
/// Returns null when there is nothing worth saying: no item, an unreadable
/// quantity, or a line already expressed in the base unit (where the entered
/// number is the stored number, and repeating it would only add noise).
({String quantity, String unit})? unitConversionOf(
  Json? item,
  String? unitName,
  String quantityText,
) {
  if (item == null) return null;
  final entered = Decimal.tryParse(quantityText.trim());
  if (entered == null) return null;
  final unit = lineUnitOf(item, unitName);
  if (unit == null) return null;
  final factor = Decimal.tryParse(asString(unit['factor']) ?? '');
  if (factor == null || factor.compareTo(Decimal.one) == 0) return null;
  final base = entered * factor;
  // Four decimals is the scale the ledger keeps; showing more would claim a
  // precision the stored quantity does not have.
  final text = formatQuantity(base.toString(), decimals: 4);
  final baseUnit = text(item, 'unit');
  return (quantity: text, unit: baseUnit);
}

/// A short label for what the conversion is, or an empty string.
///
/// The screens still translate the sentence; this only decides the numbers and
/// the unit name, so "12" stays "12" in every language.
String unitFactorText(Json? item, String? unitName) {
  final unit = lineUnitOf(item, unitName);
  if (unit == null) return '';
  final factor = Decimal.tryParse(asString(unit['factor']) ?? '');
  if (factor == null || factor.compareTo(Decimal.one) == 0) return '';
  return formatQuantity(factor.toString(), decimals: 4);
}

/// The item's base unit name, as stored.
String baseUnitNameOf(Json? item) => item == null ? '' : text(item, 'unit');
