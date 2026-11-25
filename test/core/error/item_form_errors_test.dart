import 'package:erp_kayan/core/error/app_error_text.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/features/inventory/domain/item_create_refusal.dart';
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

  group('opening warehouse refusals', () {
    const forbidden =
        'You may not receive stock into any active warehouse of your branch, so opening stock cannot be saved.';
    const inactive =
        'All warehouses of this branch are inactive, so opening stock cannot be saved. Activate a branch warehouse or save the item without opening stock.';
    const changed =
        'The opening stock warehouse changed since the form was opened. Reopen the form to see the current warehouse.';
    test('each has a specific Arabic message and is a definite refusal', () {
      for (final raw in [forbidden, inactive, changed]) {
        expect(
          ar(raw, raw == forbidden ? 403 : 400),
          contains('لم يُنشأ الصنف'),
        );
      }
      expect(
        isKnownItemCreateRefusal(ApiFailure(forbidden, statusCode: 403)),
        isTrue,
      );
      expect(
        isKnownItemCreateRefusal(ApiFailure(inactive, statusCode: 400)),
        isTrue,
      );
      expect(
        isKnownItemCreateRefusal(ApiFailure(changed, statusCode: 409)),
        isTrue,
      );
    });
    test('the same sentences on a 500/503 keep the duplicate-save lock', () {
      for (final status in [500, 503]) {
        expect(
          isKnownItemCreateRefusal(ApiFailure(forbidden, statusCode: status)),
          isFalse,
        );
      }
      expect(
        isKnownItemCreateRefusal(
          ApiFailure('Forbidden resource', statusCode: 403),
        ),
        isFalse,
      );
    });
  });
}
