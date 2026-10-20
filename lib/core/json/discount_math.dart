import 'package:decimal/decimal.dart';

/// The same discount arithmetic the server performs.
///
/// This is a preview, not the authority: the server recomputes everything and
/// stores what it computed. Keeping the preview exact means the number on the
/// screen before saving is the number that will be stored, including the
/// rounding of a pro-rata document discount.
const int moneyScale = 4;
final BigInt _scale = BigInt.from(10000);

Decimal decimalOf(String? raw) =>
    Decimal.tryParse((raw ?? '').trim()) ?? Decimal.zero;

enum DiscountKind { none, percent, amount }

DiscountKind discountKindOf(String? raw) => switch (raw?.toUpperCase()) {
  'PERCENT' => DiscountKind.percent,
  'AMOUNT' => DiscountKind.amount,
  _ => DiscountKind.none,
};

String? discountTypeOf(DiscountKind kind) => switch (kind) {
  DiscountKind.percent => 'PERCENT',
  DiscountKind.amount => 'AMOUNT',
  DiscountKind.none => null,
};

class ResolvedDiscount {
  const ResolvedDiscount({
    required this.kind,
    required this.percent,
    required this.amount,
    required this.base,
    required this.net,
  });

  final DiscountKind kind;
  final Decimal percent;
  final Decimal amount;
  final Decimal base;
  final Decimal net;
}

ResolvedDiscount resolveDiscount(
  Decimal base,
  DiscountKind kind,
  Decimal? value,
) {
  if (kind == DiscountKind.none || value == null) {
    return ResolvedDiscount(
      kind: DiscountKind.none,
      percent: Decimal.zero,
      amount: Decimal.zero,
      base: base,
      net: base,
    );
  }
  if (kind == DiscountKind.percent) {
    final percent = value < Decimal.zero ? Decimal.zero : value;
    final capped = percent > Decimal.fromInt(100) ? Decimal.fromInt(100) : percent;
    final amount = (base * capped / Decimal.fromInt(100))
        .toDecimal(scaleOnInfinitePrecision: 12)
        .round(scale: moneyScale);
    final safe = amount > base ? base : amount;
    return ResolvedDiscount(
      kind: kind,
      percent: capped,
      amount: safe,
      base: base,
      net: base - safe,
    );
  }
  final amount = value.round(scale: moneyScale);
  final safe = amount < Decimal.zero
      ? Decimal.zero
      : (amount > base ? base : amount);
  final percent = base == Decimal.zero
      ? Decimal.zero
      : (safe * Decimal.fromInt(100) / base)
          .toDecimal(scaleOnInfinitePrecision: 12)
          .round(scale: moneyScale);
  return ResolvedDiscount(
    kind: kind,
    percent: percent,
    amount: safe,
    base: base,
    net: base - safe,
  );
}

/// Spreads [total] over [values] by weight, using the largest-remainder
/// method on exact ten-thousandths so the parts add up to the whole.
List<Decimal> allocateByWeight(List<Decimal> values, Decimal total) {
  if (values.isEmpty) return const [];
  final totalUnits = _units(total);
  final valueUnits = values.map(_units).toList(growable: false);
  final weight = valueUnits.fold(BigInt.zero, (sum, value) => sum + value);
  if (totalUnits == BigInt.zero) {
    return List<Decimal>.filled(values.length, Decimal.zero);
  }
  if (weight == BigInt.zero) {
    return List<Decimal>.filled(values.length, Decimal.zero);
  }
  final portions = <({int index, BigInt units, BigInt remainder})>[];
  for (var index = 0; index < valueUnits.length; index++) {
    final numerator = totalUnits * valueUnits[index];
    portions.add((
      index: index,
      units: numerator ~/ weight,
      remainder: numerator % weight,
    ));
  }
  var remaining = totalUnits -
      portions.fold(BigInt.zero, (sum, portion) => sum + portion.units);
  final byRemainder = [...portions]..sort((left, right) {
      final byValue = right.remainder.compareTo(left.remainder);
      return byValue == 0 ? left.index.compareTo(right.index) : byValue;
    });
  for (final portion in byRemainder) {
    if (remaining == BigInt.zero) break;
    if (valueUnits[portion.index] == BigInt.zero) continue;
    final position = portions.indexWhere((row) => row.index == portion.index);
    portions[position] = (
      index: portion.index,
      units: portion.units + BigInt.one,
      remainder: portion.remainder,
    );
    remaining -= BigInt.one;
  }
  return portions
      .map((portion) => _fromUnits(portion.units))
      .toList(growable: false);
}

Decimal _fromUnits(BigInt units) {
  final whole = units ~/ _scale;
  final fraction = (units % _scale).toString().padLeft(moneyScale, '0');
  return Decimal.parse('$whole.$fraction');
}

BigInt _units(Decimal value) {
  final scaled = (value * Decimal.fromInt(10000)).round(scale: 0);
  return BigInt.parse(scaled.toString());
}
