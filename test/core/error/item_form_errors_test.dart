import 'package:erp_kayan/core/error/app_error_text.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:flutter_test/flutter_test.dart';

/// The server refusals of the new-item form. None of them may fall back to the
/// generic "submitted data is not valid" sentence: the user must be told which
/// field to fix.
void main() {
  String ar(String raw, [int status = 400]) =>
      const AppErrorMessageResolver(isArabic: true)
          .resolve(ApiFailure(raw, statusCode: status))
          .businessMessage ??
      '';
  String en(String raw, [int status = 400]) =>
      const AppErrorMessageResolver(isArabic: false)
          .resolve(ApiFailure(raw, statusCode: status))
          .businessMessage ??
      '';

  const cases = <String, String>{
    'Provide an Arabic or English item name': 'اسم الصنف',
    'Barcode 6221234 is already assigned to item X1': 'الباركود 6221234',
    'Barcode 6221234 is already assigned to unit BOX of item X1':
        'إحدى وحدات الصنف X1',
    'Opening stock cannot be set on an item that is not stock-tracked':
        'تتبّع المخزون',
    'openingQuantity and openingUnitCost must be given together': 'معًا',
    'Select a branch before adding opening stock': 'اختر الفرع',
    'This branch already has an opening balance (OB-000001). Add the item there instead of giving it opening stock here.':
        'OB-000001',
    "Required account 01010301 (inventory) does not exist in this company's chart of accounts":
        'حساب المخزون 01010301',
    "Required account 03010301 (openingBalanceEquity) does not exist in this company's chart of accounts":
        'حقوق الملكية',
    'taxRate cannot exceed 100': 'نسبة الضريبة',
    'taxRate cannot be negative': 'نسبة الضريبة',
    'taxRate is not a valid percentage': 'نسبة الضريبة',
  };

  test('every new-item refusal names its field in Arabic and stays readable in English', () {
    cases.forEach((raw, mustContain) {
      final status = raw.contains('already assigned') ? 409 : 400;
      expect(ar(raw, status), contains(mustContain), reason: raw);
      // The decimal field cannot produce "not a valid percentage"; English for
      // that one stays the generic sentence, as before this change.
      if (!raw.contains('valid percentage')) {
        expect(en(raw, status), isNotEmpty, reason: 'English: $raw');
      }
    });
  });

  test('an unsafe token is never echoed', () {
    final text = ar(
      'Barcode <script>alert(1)</script> is already assigned to item X1',
      409,
    );
    expect(text, isNot(contains('script')));
  });
}
