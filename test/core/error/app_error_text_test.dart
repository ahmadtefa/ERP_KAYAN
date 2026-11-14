import 'package:erp_kayan/core/error/app_error_text.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:flutter_test/flutter_test.dart';

/// The screen must never show a sentence written for a programmer.
///
/// These cases are taken from what the API and the client actually produce:
/// the exact body that broke account deactivation, the validation messages
/// of the DTOs, the business rules the server enforces, and a few shapes a
/// stray exception can take.
void main() {
  const arabic = AppErrorMessageResolver(isArabic: true);
  const english = AppErrorMessageResolver(isArabic: false);

  test('licence state mismatch displays fixed guidance, never server details', () {
    const failure = ApiFailure('synthetic-private-marker', statusCode: 403, code: 'LICENSE_STATE_ID_MISMATCH');
    expect(arabic.resolve(failure).businessMessage, contains('حالة الترخيص المحمية'));
    expect(english.resolve(failure).businessMessage, contains('protected licence state'));
    expect(english.resolve(failure).businessMessage, isNot(contains('synthetic-private-marker')));
    expect(arabic.resolve(failure).reason, AppErrorReason.conflict);
  });

  test('quotation deletion conflict explains that nothing was removed', () {
    const message = 'Only a draft quotation can be deleted';
    final result = arabic.resolve(const ApiFailure(message, statusCode: 400));
    expect(result.businessMessage, contains('لم يُحذف عرض السعر'));
    expect(result.businessMessage, contains('حدّث البيانات'));
  });

  test('quotation conversion mismatch has safe actionable Arabic guidance', () {
    const message = 'Invoice totals differ from the accepted quotation; review tax and discounts before conversion';
    final result = arabic.resolve(const ApiFailure(message, statusCode: 400));
    expect(result.businessMessage, contains('لا تطابق عرض السعر'));
    expect(result.businessMessage, contains('لم تُنشأ فاتورة'));
  });

  group('technical text never reaches the screen', () {
    test('the deactivation failure that started this', () {
      final text = arabic.resolve(
        const ApiFailure('property type should not exist', statusCode: 400),
      );

      expect(text.reason, AppErrorReason.invalidInput);
      expect(text.hasBusinessMessage, isFalse);
      expect(text.businessMessage, isNull);
    });

    test('an unknown property is just as technical as a missing one', () {
      final text = arabic.resolve(
        const ApiFailure('property bogusField should not exist', statusCode: 400),
      );
      expect(text.hasBusinessMessage, isFalse);
    });

    test('a validation sentence about a boolean', () {
      final text = arabic.resolve(
        const ApiFailure('isActive must be a boolean value', statusCode: 400),
      );
      expect(text.hasBusinessMessage, isFalse);
    });

    test('a database error is not repeated to the user', () {
      final text = arabic.resolve(
        const ApiFailure(
          'PrismaClientKnownRequestError: column "name" does not exist',
          statusCode: 500,
        ),
      );
      expect(text.reason, AppErrorReason.server);
      expect(text.hasBusinessMessage, isFalse);
    });

    test('Arabic text cannot bypass technical and credential filters', () {
      for (final raw in [
        'تعذر الحفظ: Prisma SQL error',
        'فشل الاتصال postgres://db.example.invalid/synthetic',
        'فشل الطلب token=synthetic-value',
        'خطأ داخلي TypeError: undefined',
        'تفاصيل عميل اصطناعية لا يجب عرضها',
      ]) {
        final result = arabic.resolve(ApiFailure(raw, statusCode: 500));
        expect(result.reason, AppErrorReason.server);
        expect(result.hasBusinessMessage, isFalse, reason: raw);
      }
      // Technical markers are also rejected on business-error responses.
      expect(arabic.resolve('فشل الحفظ: Prisma SQL error', statusCode: 400).hasBusinessMessage, isFalse);
    });

    test('server 4xx Arabic text is not trusted merely for being Arabic', () {
      const remote = ApiFailure('بيانات خاصة اصطناعية لا تعرض', statusCode: 400);
      expect(arabic.resolve(remote).hasBusinessMessage, isFalse);
      expect(english.resolve(remote).hasBusinessMessage, isFalse);
      expect(arabic.resolve('بيانات خاصة اصطناعية لا تعرض', statusCode: 400).hasBusinessMessage, isFalse);
      expect(arabic.resolve(const ValidationFailure('اختر حسابًا أولاً')).businessMessage, 'اختر حسابًا أولاً');
    });

    test('unmapped remote English text is not displayed in English inline views', () {
      const remote = ApiFailure('Synthetic private record is not available', statusCode: 400);
      expect(english.resolve(remote).hasBusinessMessage, isFalse);
      expect(english.resolve(const ApiFailure('Account not found', statusCode: 404)).businessMessage, 'Account not found');
    });

    test('all 5xx failures use the uncertain server-result wording', () {
      for (final status in [500, 501, 503, 505, 599]) {
        final result = arabic.resolve(ApiFailure('سر مصطنع', statusCode: status));
        expect(result.reason, AppErrorReason.server);
        expect(result.hasBusinessMessage, isFalse);
      }
    });

    test('parameterised translations do not echo unknown remote tokens or paths', () {
      for (final raw in [
        'Account SYNTHETIC_PRIVATE is inactive',
        'Missing permission: SYNTHETIC_PRIVATE',
        'No backup file named "SYNTHETIC_PRIVATE" on this server.',
        'SYNTHETIC_PRIVATE is required',
        'item SYNTHETIC_PRIVATE is not stock-tracked',
      ]) {
        final result = arabic.resolve(ApiFailure(raw,statusCode:400));
        expect(result.businessMessage ?? '', isNot(contains('SYNTHETIC_PRIVATE')));
      }
      final long = arabic.resolve(ApiFailure('A' * 1025,statusCode:400));
      expect(long.hasBusinessMessage,isFalse);
    });

    test('a raw exception object is not forwarded', () {
      final text = arabic.resolve(StateError('Bad state: no element'));
      expect(text.hasBusinessMessage, isFalse);
    });

    test('a stack-trace-looking string is not forwarded', () {
      final text = arabic.resolve(
        'TypeError: Cannot read properties of undefined\n'
        '    at Object.<anonymous> (/app/dist/main.js:1:1)',
      );
      expect(text.hasBusinessMessage, isFalse);
    });
  });

  group('business reasons survive, in Arabic', () {
    test('an already depreciated period has a useful Arabic explanation', () {
      final text = arabic.resolve('Nothing to depreciate for 2024-01 — FA-M-1: already depreciated for 2024-01', statusCode: 400);
      expect(text.businessMessage, contains('سبق احتساب إهلاك'));
      expect(text.businessMessage, contains('2024-01'));
    });

    test('a grouping account refuses to be turned off', () {
      final text = arabic.resolve(
        'Deactivate active subaccounts before deactivating their parent',
        statusCode: 400,
      );

      expect(text.hasBusinessMessage, isTrue);
      expect(text.businessMessage, contains('الحسابات الفرعية'));
      expect(text.businessMessage, isNot(contains('subaccount')));
    });

    test('a missing record', () {
      final text = arabic.resolve('Account not found', statusCode: 404);

      expect(text.reason, AppErrorReason.notFound);
      expect(text.businessMessage, 'لم يتم العثور على الحساب.');
    });

    test('insufficient balance is kept as a reason', () {
      final text = arabic.resolve('Insufficient balance', statusCode: 400);
      expect(text.businessMessage, contains('الرصيد غير كافٍ'));
    });

    test('a line-level reason keeps its line number', () {
      final text = arabic.resolve(
        'Line 3: the item does not exist',
        statusCode: 400,
      );

      expect(text.businessMessage, 'السطر 3: الصنف غير موجود.');
    });

    test('a parameterised reason keeps its code', () {
      final text = arabic.resolve('Account 1104 is inactive', statusCode: 400);
      expect(text.businessMessage, 'الحساب 1104 غير نشط.');
    });

    test('a message the screen already wrote in Arabic is untouched', () {
      final text = arabic.resolve('اختر حسابًا أولاً');
      expect(text.businessMessage, 'اختر حسابًا أولاً');
    });

    test('a permission refusal names the permission', () {
      final text = arabic.resolve(
        'Missing permission: accounting.chart.manage',
        statusCode: 403,
      );
      expect(text.businessMessage, contains('صلاحية'));
      expect(text.reason, AppErrorReason.permission);
    });
  });

  group('failures are classified by kind, not by keyword', () {
    test('offline', () {
      final text = arabic.resolve(const NetworkFailure());
      expect(text.reason, AppErrorReason.network);
      expect(text.hasBusinessMessage, isFalse);
    });

    test('refused permission', () {
      final text = arabic.resolve(const PermissionFailure());
      expect(text.reason, AppErrorReason.permission);
    });

    test('ended session', () {
      final text = arabic.resolve(const SessionExpiredFailure());
      expect(text.reason, AppErrorReason.sessionExpired);
    });

    test('a conflict is a warning, not an error', () {
      final text = arabic.resolve(
        const ApiFailure(
          'This document has just been changed by someone else.',
          statusCode: 409,
        ),
      );

      expect(text.reason, AppErrorReason.conflict);
      expect(text.severity, AppErrorSeverity.warning);
      expect(text.businessMessage, contains('مستخدم آخر'));
    });

    test('every other refusal is an error', () {
      expect(
        arabic
            .resolve(const ApiFailure('x', statusCode: 500))
            .severity,
        AppErrorSeverity.error,
      );
      expect(
        arabic.resolve(const NetworkFailure()).severity,
        AppErrorSeverity.error,
      );
      expect(
        arabic
            .resolve(const ApiFailure('x', statusCode: 404))
            .severity,
        AppErrorSeverity.error,
      );
    });

    test('an empty message falls back to the status', () {
      final text = arabic.resolve('', statusCode: 422);
      expect(text.reason, AppErrorReason.invalidInput);
      expect(text.hasBusinessMessage, isFalse);
    });
  });

  group('the English interface keeps English reasons', () {
    test('a translated reason is not translated back', () {
      final text = english.resolve('Account not found', statusCode: 404);
      expect(text.businessMessage, 'Account not found');
    });

    test('a technical message is still withheld', () {
      final text = english.resolve(
        'property type should not exist',
        statusCode: 400,
      );
      expect(text.hasBusinessMessage, isFalse);
    });
  });
}
