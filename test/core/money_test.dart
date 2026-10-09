import 'package:decimal/decimal.dart';
import 'package:erp_kayan/core/money/money.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Money', () {
    test('adds amounts of the same currency exactly', () {
      final a = Money.parse('10.10', 'EGP');
      final b = Money.parse('20.20', 'EGP');
      expect((a + b).amount, Decimal.parse('30.30'));
    });

    test(
      'avoids the binary floating point error that double would produce',
      () {
        // 0.1 + 0.2 == 0.30000000000000004 with doubles.
        final result = Money.parse('0.1', 'EGP') + Money.parse('0.2', 'EGP');
        expect(result.amount, Decimal.parse('0.3'));
        expect(result.toString(), '0.30 EGP');
      },
    );

    test('subtracts and negates', () {
      final balance = Money.parse('100', 'EGP') - Money.parse('250.75', 'EGP');
      expect(balance.amount, Decimal.parse('-150.75'));
      expect(balance.isNegative, isTrue);
      expect((-balance).amount, Decimal.parse('150.75'));
      expect(balance.abs().amount, Decimal.parse('150.75'));
    });

    test('multiplies by a decimal factor', () {
      final line = Money.parse('99.99', 'EGP') * Decimal.parse('3');
      expect(line.amount, Decimal.parse('299.97'));
    });

    test('rounds half up to the requested scale', () {
      expect(
        Money.parse('1.005', 'EGP').rounded().amount,
        Decimal.parse('1.01'),
      );
      expect(
        Money.parse('1.004', 'EGP').rounded().amount,
        Decimal.parse('1.00'),
      );
      expect(
        Money.parse('2.345', 'EGP').rounded(1).amount,
        Decimal.parse('2.3'),
      );
    });

    test('rejects arithmetic across currencies', () {
      expect(
        () => Money.parse('10', 'EGP') + Money.parse('10', 'USD'),
        throwsA(isA<ArgumentError>()),
      );
      expect(
        () => Money.parse('10', 'EGP').compareTo(Money.parse('10', 'USD')),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('compares and tests zero', () {
      expect(Money.zero('EGP').isZero, isTrue);
      expect(
        Money.parse('2', 'EGP').compareTo(Money.parse('10', 'EGP')),
        lessThan(0),
      );
    });

    test('value equality includes the currency', () {
      expect(Money.parse('5.00', 'EGP'), Money.parse('5', 'EGP'));
      expect(Money.parse('5', 'EGP'), isNot(Money.parse('5', 'USD')));
    });
  });
}
