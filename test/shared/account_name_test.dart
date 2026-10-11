import 'package:erp_kayan/shared/utils/account_name.dart';
import 'package:flutter_test/flutter_test.dart';

class _Names implements AccountNames {
  const _Names({required this.code, this.nameEn, this.nameAr});

  @override
  final String code;
  @override
  final String? nameEn;
  @override
  final String? nameAr;
}

/// The account-name rules are one function shared by every screen and every
/// exported file, so the rules live and die with these tests.
void main() {
  group('accountName', () {
    const account = _Names(
      code: '1101',
      nameEn: 'Cash on hand',
      nameAr: 'النقدية بالصندوق',
    );

    test('shows the Arabic name in Arabic', () {
      expect(accountName(account, 'ar'), 'النقدية بالصندوق');
    });

    test('shows the English name in English', () {
      expect(accountName(account, 'en'), 'Cash on hand');
    });

    test(
      'falls back to the other language when the preferred one is missing',
      () {
        const missingAr = _Names(
          code: '1101',
          nameEn: 'Cash on hand',
          nameAr: '',
        );
        const missingEn = _Names(code: '1101', nameAr: 'النقدية بالصندوق');
        expect(accountName(missingAr, 'ar'), 'Cash on hand');
        expect(accountName(missingEn, 'en'), 'النقدية بالصندوق');
      },
    );

    test('falls back to the code when both names are missing', () {
      const nameless = _Names(code: '9999', nameEn: '  ', nameAr: null);
      expect(accountName(nameless, 'ar'), '9999');
      expect(accountName(nameless, 'en'), '9999');
    });

    test('never returns an empty string', () {
      const nameless = _Names(code: '42');
      for (final lang in const ['ar', 'en']) {
        expect(accountName(nameless, lang).isNotEmpty, isTrue);
      }
    });
  });

  group('accountLabel', () {
    test('puts the code first, then the localized name', () {
      const account = _Names(
        code: '1101',
        nameEn: 'Cash on hand',
        nameAr: 'النقدية بالصندوق',
      );
      expect(accountLabel(account, 'ar'), '1101 — النقدية بالصندوق');
      expect(accountLabel(account, 'en'), '1101 — Cash on hand');
    });
  });
}
