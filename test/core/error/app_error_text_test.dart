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
