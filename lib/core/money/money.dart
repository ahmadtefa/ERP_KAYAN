import 'package:decimal/decimal.dart';

/// Immutable monetary value.
///
/// Amounts are stored as [Decimal] — never `double`/`float` — so that
/// financial calculations are exact. The currency code is carried alongside
/// the amount to prevent accidental cross-currency arithmetic.
class Money implements Comparable<Money> {
  Money(this.amount, this.currency);

  Money.zero(this.currency) : amount = Decimal.zero;

  factory Money.parse(String amount, String currency) =>
      Money(Decimal.parse(amount), currency);

  /// Convenience constructor for whole-unit amounts.
  factory Money.units(int amount, String currency) =>
      Money(Decimal.fromInt(amount), currency);

  final Decimal amount;
  final String currency;

  /// Standard monetary scale for presentation and storage.
  static const int defaultScale = 2;

  /// Rounds to [scale] decimal places using half-up rounding — the rounding
  /// rule used by Egyptian VAT and most ledger systems.
  Money rounded([int scale = defaultScale]) =>
      Money(amount.round(scale: scale), currency);

  Money operator +(Money other) {
    _assertSameCurrency(other);
    return Money(amount + other.amount, currency);
  }

  Money operator -(Money other) {
    _assertSameCurrency(other);
    return Money(amount - other.amount, currency);
  }

  Money operator -() => Money(-amount, currency);

  Money operator *(Decimal factor) => Money(amount * factor, currency);

  bool get isZero => amount == Decimal.zero;
  bool get isNegative => amount < Decimal.zero;
  bool get isPositive => amount > Decimal.zero;

  Money abs() => isNegative ? -this : this;

  void _assertSameCurrency(Money other) {
    if (currency != other.currency) {
      throw ArgumentError(
        'Cannot combine amounts in different currencies: '
        '$currency vs ${other.currency}',
      );
    }
  }

  @override
  int compareTo(Money other) {
    _assertSameCurrency(other);
    return amount.compareTo(other.amount);
  }

  @override
  bool operator ==(Object other) =>
      other is Money && other.currency == currency && other.amount == amount;

  @override
  int get hashCode => Object.hash(amount, currency);

  @override
  String toString() => '${amount.toStringAsFixed(defaultScale)} $currency';
}
