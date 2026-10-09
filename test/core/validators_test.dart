import 'package:decimal/decimal.dart';
import 'package:erp_kayan/core/utils/validators.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Validators', () {
    test('isNotBlank rejects empty and whitespace', () {
      expect(Validators.isNotBlank(null), isFalse);
      expect(Validators.isNotBlank('   '), isFalse);
      expect(Validators.isNotBlank('a'), isTrue);
    });

    test('isEmail accepts valid addresses only', () {
      expect(Validators.isEmail('user@example.com'), isTrue);
      expect(Validators.isEmail('user@example'), isFalse);
      expect(Validators.isEmail('nope'), isFalse);
    });

    test('isUsername enforces a safe character set and length', () {
      expect(Validators.isUsername('accountant.01'), isTrue);
      expect(Validators.isUsername('ab'), isFalse);
      expect(Validators.isUsername('bad name'), isFalse);
      expect(Validators.isUsername("o'brien"), isFalse);
    });

    test('password policy requires at least 8 characters', () {
      expect(Validators.isStrongEnoughPassword('12345678'), isTrue);
      expect(Validators.isStrongEnoughPassword('1234567'), isFalse);
    });

    test('tryParseAmount parses decimals and rejects junk', () {
      expect(Validators.tryParseAmount('1,234'), isNull);
      expect(Validators.tryParseAmount('1234.56'), Decimal.parse('1234.56'));
      expect(Validators.tryParseAmount(''), isNull);
      expect(Validators.tryParseAmount(null), isNull);
    });

    test('isPositiveAmount rejects zero and negatives', () {
      expect(Validators.isPositiveAmount('0.01'), isTrue);
      expect(Validators.isPositiveAmount('0'), isFalse);
      expect(Validators.isPositiveAmount('-5'), isFalse);
      expect(Validators.isPositiveAmount('abc'), isFalse);
    });
  });
}
