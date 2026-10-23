import 'package:decimal/decimal.dart';
import 'package:erp_kayan/core/json/discount_math.dart';
import 'package:flutter_test/flutter_test.dart';

/// The preview arithmetic has to match the server's, or the number on the
/// screen before saving is a promise the stored document breaks.
void main() {
  group('resolveDiscount', () {
    test('a percentage is taken from the base and rounded to four places', () {
      final discount = resolveDiscount(
        Decimal.parse('1234.5678'),
        DiscountKind.percent,
        Decimal.fromInt(10),
      );
      expect(discount.amount, Decimal.parse('123.4568'));
      expect(discount.net, Decimal.parse('1111.1110'));
      expect(discount.percent, Decimal.fromInt(10));
    });

    test('a percentage above 100 is capped, never a negative net', () {
      final discount = resolveDiscount(
        Decimal.parse('100'),
        DiscountKind.percent,
        Decimal.fromInt(250),
      );
      expect(discount.amount, Decimal.fromInt(100));
      expect(discount.net, Decimal.zero);
    });

    test('a fixed amount larger than the base is clamped to the base', () {
      final discount = resolveDiscount(
        Decimal.parse('80'),
        DiscountKind.amount,
        Decimal.fromInt(120),
      );
      expect(discount.amount, Decimal.fromInt(80));
      expect(discount.net, Decimal.zero);
    });

    test('no discount leaves the base untouched', () {
      final discount = resolveDiscount(
        Decimal.parse('50'),
        DiscountKind.none,
        null,
      );
      expect(discount.amount, Decimal.zero);
      expect(discount.net, Decimal.parse('50'));
      expect(discount.kind, DiscountKind.none);
    });
  });

  group('allocateByWeight', () {
    test('the parts add up to the whole, including awkward thirds', () {
      final shares = allocateByWeight([
        Decimal.fromInt(10),
        Decimal.fromInt(10),
        Decimal.fromInt(10),
      ], Decimal.fromInt(1));
      expect(shares.fold(Decimal.zero, (sum, part) => sum + part), Decimal.fromInt(1));
      expect(shares, [
        Decimal.parse('0.3334'),
        Decimal.parse('0.3333'),
        Decimal.parse('0.3333'),
      ]);
    });

    test('a zero-value line receives nothing', () {
      final shares = allocateByWeight([
        Decimal.fromInt(0),
        Decimal.fromInt(100),
      ], Decimal.parse('5'));
      expect(shares.first, Decimal.zero);
      expect(shares.last, Decimal.fromInt(5));
    });

    test('an empty allocation asks for no shares', () {
      expect(allocateByWeight(const [], Decimal.fromInt(5)), isEmpty);
    });
  });

  group('discount type mapping', () {
    test('round-trips the strings the API stores', () {
      expect(discountTypeOf(DiscountKind.percent), 'PERCENT');
      expect(discountTypeOf(DiscountKind.amount), 'AMOUNT');
      expect(discountTypeOf(DiscountKind.none), isNull);
      expect(discountKindOf('PERCENT'), DiscountKind.percent);
      expect(discountKindOf('AMOUNT'), DiscountKind.amount);
      expect(discountKindOf('anything else'), DiscountKind.none);
    });
  });
}
