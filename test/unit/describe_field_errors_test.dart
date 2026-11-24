import 'package:erp_kayan/core/error/app_error_text.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('lists each refused field with its reason, nested rows numbered', () {
    final text = AppErrorMessageResolver(isArabic: true).resolve(
      const ApiFailure('x', statusCode: 400, code: 'VALIDATION_FAILED', fieldErrors: {
        'customerId': 'هذا الحقل مطلوب',
        'lines.1.quantity': 'القيمة يجب ألا تقل عن 1',
      }),
    );
    expect(text.businessMessage, contains('• العميل: هذا الحقل مطلوب'));
    expect(text.businessMessage, contains('• البنود (2) - الكمية: القيمة يجب ألا تقل عن 1'));
  });
}
