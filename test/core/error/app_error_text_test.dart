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
  test('missing transfer lot has fixed bilingual corrective guidance, never raw diagnostics', () {
    for (final arabic in [false, true]) {
      final text = AppErrorMessageResolver(isArabic: arabic).resolve(const ApiFailure(
        'private SQL diagnostic SELECT', statusCode: 400, code: 'STOCK_DOC_TRANSFER_LOT_REQUIRED',
      ));
      expect(text.businessMessage, contains(arabic ? 'اختر دفعة' : 'choose an available lot'));
      expect(text.businessMessage, isNot(contains('SELECT')));
      expect(text.businessMessage, contains(arabic ? 'المسودة محفوظة' : 'draft is kept'));
    }
  });

  test('typed rolled-back transaction has safe Arabic guidance, other 503 does not', () {
    const resolver=AppErrorMessageResolver(isArabic:true);
    final typed=resolver.resolve(const ApiFailure('synthetic raw',statusCode:503,code:'TRANSACTION_ROLLED_BACK'));
    expect(typed.businessMessage,contains('حدّث المستند'));
    expect(typed.businessMessage,isNot(contains('synthetic raw')));
    expect(resolver.resolve(const ApiFailure('synthetic raw',statusCode:503)).businessMessage,isNull);
  });

  test(
    'sales posting stock shortfall remains actionable in both languages',
    () {
      const failure = ApiFailure(
        'الرصيد غير كافٍ في الدفعات المتاحة: ينقص 2.0000. / Not enough stock in the available lots: 2.0000 short.',
        statusCode: 400,
      );
      expect(
        const AppErrorMessageResolver(isArabic: true)
            .resolve(failure)
            .businessMessage,
        contains('2.0000'),
      );
      expect(
        const AppErrorMessageResolver(isArabic: false)
            .resolve(failure)
            .businessMessage,
        contains('2.0000'),
      );
    },
  );
  for (final code in [
    'SALES_POST_BRANCH_STOCK', 'SALES_POST_LOT_STOCK', 'SALES_POST_WAREHOUSE_STOCK',
    'SALES_POST_ACCOUNT_MISSING', 'SALES_POST_ACCOUNT_UNAVAILABLE', 'SALES_POST_PERIOD_CLOSED',
    'SALES_POST_WAREHOUSE_REQUIRED', 'SALES_POST_ITEM_UNAVAILABLE', 'SALES_POST_UNBALANCED',
    'SALES_POST_STATE_CHANGED', 'SALES_POST_RULE_REJECTED',
  ]) {
    test('bounded actionable sales posting reason $code in both languages', () {
      for (final isArabic in [true, false]) {
        final result = AppErrorMessageResolver(isArabic: isArabic).resolve(ApiFailure('synthetic private SQL password=do-not-show', statusCode: 400, code: code));
        expect(result.businessMessage, contains(code));
        expect(result.businessMessage, isNot(contains('private')));
        expect(result.businessMessage, isNot(contains('البيانات المرسلة غير صالحة')));
      }
      final server = AppErrorMessageResolver(isArabic: false).resolve(ApiFailure('private', statusCode: 500, code: code));
      expect(server.businessMessage ?? '', isNot(contains(code)));
    });
  }
  group('stock document refusals use reviewed templates keyed by code, never the server body', () {
    const codes = <String>[
      'STOCK_DOC_APPROVED', 'STOCK_DOC_LINE_UNKNOWN', 'STOCK_DOC_LOCATIONS_EMPTY',
      'STOCK_DOC_LOCATION_INACTIVE', 'STOCK_DOC_LOCATION_INVALID', 'STOCK_DOC_LOCATION_REQUIRED',
      'STOCK_DOC_LOT_INVALID', 'STOCK_DOC_LOT_SHORT', 'STOCK_DOC_LOT_TRANSFER_ONLY',
      'STOCK_DOC_NOT_DRAFT', 'STOCK_DOC_REVERSE_LOT_AMBIGUOUS', 'STOCK_DOC_REVERSE_LOT_COST_UNPROVABLE',
      'STOCK_DOC_REVERSE_LOT_SHELF_SHORT', 'STOCK_DOC_REVERSE_LOT_SHORT', 'STOCK_DOC_REVERSE_SHELF_SHORT',
      'STOCK_DOC_SHELF_SHORT', 'STOCK_DOC_SPLIT_INVALID', 'STOCK_DOC_SPLIT_TOTAL',
      'STOCK_DOC_TARGET_LOCATION_INVALID', 'STOCK_DOC_TRANSFER_LOT_COVERAGE', 'STOCK_DOC_VERSION_REQUIRED',
    ];
    const hostile = <String>[
      'SELECT * FROM users WHERE password=hunter2 / SELECT * FROM users WHERE password=hunter2',
      'Error: at Object.<anonymous> (/srv/app/dist/main.js:10:5) / at Object.<anonymous> (/srv/app/dist/main.js:10:5)',
      'See https://internal.example/admin?token=abc123 / See https://internal.example/admin?token=abc123',
      'Lot held by Mona Hassan, 12 Tahrir St, balance 48,250 EGP / Lot held by Mona Hassan, 12 Tahrir St, balance 48,250 EGP',
      'Lot held by ahmed.salem@example.com / Lot held by ahmed.salem@example.com',
      'Ask 01012345678 about the lot / Ask 01012345678 about the lot',
      'You do not have permission to see warehouse Cairo-Private / You do not have permission to see warehouse Cairo-Private',
    ];
    for (final arabic in [false, true]) {
      final r = AppErrorMessageResolver(isArabic: arabic);
      test('every listed code shows its own reviewed sentence in the active language and a support code (arabic=$arabic)', () {
        final seen = <String>{};
        for (final code in codes) {
          final out = r.resolve(ApiFailure('body', statusCode: 400, code: code)).businessMessage!;
          expect(out, contains(code));
          expect(RegExp(r'[\u0600-\u06FF]').hasMatch(out.split('\n').first), arabic, reason: code);
          expect(seen.add(out), isTrue, reason: '$code has its own text');
        }
      });
      test('no server body text is ever shown for a listed code, whatever it contains (arabic=$arabic)', () {
        for (final code in codes) {
          for (final body in hostile) {
            final shown = r.resolve(ApiFailure(body, statusCode: 400, code: code)).businessMessage ?? '';
            for (final leak in ['hunter2', 'main.js', 'abc123', 'Mona', 'Tahrir', '48,250', 'example.com', '01012345678', 'Cairo-Private', 'permission to see']) {
              expect(shown, isNot(contains(leak)), reason: '$code leaked $leak');
            }
          }
        }
      });
      test('only a plain line number from the typed fields is added (arabic=$arabic)', () {
        final ok = r.resolve(const ApiFailure('x', statusCode: 400, code: 'STOCK_DOC_LOT_SHORT', fieldErrors: {'lineNumber': '3'})).businessMessage!;
        expect(ok, contains('3'));
        final bad = r.resolve(const ApiFailure('x', statusCode: 400, code: 'STOCK_DOC_LOT_SHORT', fieldErrors: {'lineNumber': '3 Mona Hassan', 'locationCode': 'Cairo-Private'})).businessMessage!;
        expect(bad, isNot(contains('Mona')));
        expect(bad, isNot(contains('Cairo-Private')));
      });
      test('codes still relayed from the server (cash/sales) refuse bodies carrying e-mail or long ids (arabic=$arabic)', () {
        for (final body in [
          'Cash held by ahmed.salem@example.com / Cash held by ahmed.salem@example.com',
          'Ask 01012345678 about it / Ask 01012345678 about it',
        ]) {
          final shown = r.resolve(ApiFailure(body, statusCode: 400, code: 'CASH_BALANCE_NEGATIVE')).businessMessage ?? '';
          expect(shown, isNot(contains('example.com')));
          expect(shown, isNot(contains('01012345678')));
        }
      });
      test('location, lot and opening-stock refusals use reviewed templates and never the body (arabic=$arabic)', () {
        const locationCodes = <String>[
          'ISSUE_ALLOCATION_DUPLICATE',
          'ISSUE_ALLOCATION_INVALID',
          'ISSUE_ALLOCATION_SUM',
          'ISSUE_LOCATION_AMBIGUOUS',
          'ISSUE_LOCATION_REQUIRED',
          'ITEM_OPENING_LOCATION_INACTIVE',
          'ITEM_OPENING_LOCATION_NOT_FOUND',
          'ITEM_OPENING_LOCATION_WRONG_WAREHOUSE',
          'ITEM_OPENING_TARGET_CHANGED',
          'ITEM_OPENING_WAREHOUSE_INACTIVE',
          'OPENING_LOCATION_INACTIVE',
          'OPENING_LOCATION_NOT_FOUND',
          'OPENING_LOCATION_WITHOUT_ITEM',
          'OPENING_LOCATION_WRONG_WAREHOUSE',
          'OPENING_LOT_CONTROLLED_ITEM',
          'OPENING_REVERSE_ORIGIN_AMBIGUOUS',
          'OPENING_REVERSE_ORIGIN_UNKNOWN',
          'OPENING_REVERSE_SHELF_SHORT',
          'PURCHASE_LOCATION_INACTIVE',
          'PURCHASE_LOCATION_NOT_FOUND',
          'PURCHASE_LOCATION_WRONG_WAREHOUSE',
          'PURCHASE_LOT_DETAILS_REQUIRED',
          'PURCHASE_LOT_NEEDS_WAREHOUSE',
          'PURCHASE_RETURN_LOT_SHORT',
          'PURCHASE_RETURN_SHELF_SHORT',
          'PURCHASE_REVERSE_LOT_USED',
          'PURCHASE_REVERSE_SHELF_SHORT',
          'RETURN_REVERSE_COST_MISMATCH',
          'RETURN_REVERSE_LOT_SHORT',
          'RETURN_REVERSE_SHELF_SHORT',
          'SALES_POST_LOCATION_REQUIRED',
          'TRANSFER_LOCATION_REQUIRED',
          'TRANSFER_LOCATION_SHORT',
          'TRANSFER_TARGET_LOCATION_INVALID',
          'WRITEOFF_LOCATION_REQUIRED',
          'WRITEOFF_LOCATION_SHORT',
        ];
        for (final code in locationCodes) {
          for (final body in hostile) {
            final shown = r.resolve(ApiFailure(body, statusCode: 400, code: code)).businessMessage ?? '';
            expect(shown, contains(code), reason: code);
            for (final leak in ['hunter2', 'main.js', 'abc123', 'Mona', 'Tahrir', '48,250', 'example.com', '01012345678', 'Cairo-Private', 'permission to see']) {
              expect(shown, isNot(contains(leak)), reason: '$code leaked $leak');
            }
            expect(RegExp(r'[\u0600-\u06FF]').hasMatch(shown.split('\n').first), arabic, reason: code);
          }
        }
        final row = r.resolve(const ApiFailure('x', statusCode: 400, code: 'ISSUE_ALLOCATION_SUM', fieldErrors: {'row': '2 Mona'})).businessMessage!;
        expect(row, isNot(contains('Mona')));
      });
      test('backup and restore refusals show reviewed guidance for their own status only, never the detail (arabic=$arabic)', () {
        const expected = <String, int>{
          'BACKUP_DELETE_LAST': 409, 'BACKUP_DELETE_IN_USE': 409, 'FULL_BACKUP_INCOMPLETE': 503,
          'FULL_BACKUP_FAILURE_NOT_RECORDED': 503, 'FULL_RESTORE_UNAVAILABLE': 503, 'RESTORE_FAILED_RECOVERY_FAILED': 503,
        };
        expected.forEach((code, status) {
          final shown = r.resolve(ApiFailure('C:\\Users\\Mona\\backups\\kayan.dump Original error: password=hunter2', statusCode: status, code: code)).businessMessage ?? '';
          expect(shown, contains(code), reason: code);
          expect(shown, isNot(contains('Mona')), reason: code);
          expect(shown, isNot(contains('hunter2')), reason: code);
          expect(shown, isNot(contains('kayan.dump')), reason: code);
          expect(RegExp(r'[\u0600-\u06FF]').hasMatch(shown.split('\n').first), arabic, reason: code);
          final wrong = r.resolve(ApiFailure('detail', statusCode: status == 409 ? 400 : 409, code: code)).businessMessage ?? '';
          expect(wrong, isNot(contains(code)), reason: '$code wrong status');
        });
      });
      test('an unlisted code with a readable body is not shown (arabic=$arabic)', () {
        final out = r.resolve(const ApiFailure('Line 1: something readable / Line 1: something readable', statusCode: 400, code: 'STOCK_DOC_SOMETHING_NEW'));
        expect(out.businessMessage ?? '', isNot(contains('something readable')));
      });
      test('a listed code with a 500 or 403 status uses no template and no body (arabic=$arabic)', () {
        for (final status in [500, 403]) {
          final out = r.resolve(ApiFailure('Private body / Private body', statusCode: status, code: 'STOCK_DOC_LOT_SHORT'));
          expect(out.businessMessage ?? '', isNot(contains('Private body')));
          expect(out.businessMessage ?? '', isNot(contains('STOCK_DOC_LOT_SHORT')));
        }
      });
    }
  });
  group('SALES_SAVE_STOCK_SHORT keeps the server sentence in the active language', () {
    const both = ApiFailure(
      'لم تُحفظ الفاتورة: الكمية أكبر من رصيد المخزون. ITEM-1 (سطر 1): المطلوب 41.0000 والمتاح 40.0000. / '
      'The invoice was not saved: the quantity is more than the stock on hand. ITEM-1 (line 1): requested 41.0000, available 40.0000.',
      statusCode: 400,
      code: 'SALES_SAVE_STOCK_SHORT',
    );
    test('Arabic shows the Arabic half, English the English half, both with the code', () {
      final ar = const AppErrorMessageResolver(isArabic: true).resolve(both).businessMessage!;
      final en = const AppErrorMessageResolver(isArabic: false).resolve(both).businessMessage!;
      expect(ar, contains('المطلوب 41.0000'));
      expect(ar, isNot(contains('The invoice')));
      expect(en, contains('requested 41.0000, available 40.0000'));
      expect(en, isNot(contains('لم تُحفظ')));
      expect(ar, contains('SALES_SAVE_STOCK_SHORT'));
      expect(en, contains('SALES_SAVE_STOCK_SHORT'));
    });
    for (final code in ['CASH_BALANCE_NEGATIVE', 'CASH_SAVE_BALANCE_SHORT']) {
      test('$code shows the active-language sentence with the amounts', () {
        final f = ApiFailure(
          'رصيد الخزنة أو البنك لا يمكن أن يصبح بالسالب: الرصيد 100.0000 والمطلوب 160.0000. / '
          'A cash or bank balance can never go negative: holds 100.0000 and this pays out 160.0000.',
          statusCode: 400,
          code: code,
        );
        final ar = const AppErrorMessageResolver(isArabic: true).resolve(f).businessMessage!;
        final en = const AppErrorMessageResolver(isArabic: false).resolve(f).businessMessage!;
        expect(ar, contains('160.0000'));
        expect(ar, isNot(contains('never go negative')));
        expect(en, contains('pays out 160.0000'));
        expect(en, contains(code));
      });
    }
    test('a server error with the same code is never relayed', () {
      final r = const AppErrorMessageResolver(isArabic: false).resolve(
        const ApiFailure('private SQL password=do-not-show', statusCode: 500, code: 'SALES_SAVE_STOCK_SHORT'));
      expect(r.businessMessage ?? '', isNot(contains('private')));
    });
    test('an oversized or technical body is not echoed', () {
      final big = ApiFailure('x' * 700, statusCode: 400, code: 'SALES_SAVE_STOCK_SHORT');
      expect(const AppErrorMessageResolver(isArabic: false).resolve(big).businessMessage ?? '', isNot(contains('xxxxxxxxxx')));
    });
  });
  const arabic = AppErrorMessageResolver(isArabic: true);
  const english = AppErrorMessageResolver(isArabic: false);

  test('a known depreciation refusal keeps its reason in English', () {
    const message = 'Nothing to depreciate for 2024-01 — FA-M-1: already depreciated for 2024-01';
    final result = english.resolve(const ApiFailure(message, statusCode: 400));
    expect(result.businessMessage, contains('already depreciated for 2024-01'));
    expect(result.businessMessage, isNot(contains('The submitted data is not valid')));
  });

  test(
    'licence state mismatch displays fixed guidance, never server details',
    () {
      const failure = ApiFailure(
        'synthetic-private-marker',
        statusCode: 403,
        code: 'LICENSE_STATE_ID_MISMATCH',
      );
      expect(
        arabic.resolve(failure).businessMessage,
        contains('حالة الترخيص المحمية'),
      );
      expect(
        english.resolve(failure).businessMessage,
        contains('protected licence state'),
      );
      expect(
        english.resolve(failure).businessMessage,
        isNot(contains('synthetic-private-marker')),
      );
      expect(arabic.resolve(failure).reason, AppErrorReason.conflict);
    },
  );

  test('quotation deletion conflict explains that nothing was removed', () {
    const message = 'Only a draft quotation can be deleted';
    final result = arabic.resolve(const ApiFailure(message, statusCode: 400));
    expect(result.businessMessage, contains('لم يُحذف عرض السعر'));
    expect(result.businessMessage, contains('حدّث البيانات'));
  });

  test('quotation conversion mismatch has safe actionable Arabic guidance', () {
    const message =
        'Invoice totals differ from the accepted quotation; review tax and discounts before conversion';
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
        const ApiFailure(
          'property bogusField should not exist',
          statusCode: 400,
        ),
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
      expect(
        arabic
            .resolve('فشل الحفظ: Prisma SQL error', statusCode: 400)
            .hasBusinessMessage,
        isFalse,
      );
    });

    test('server 4xx Arabic text is not trusted merely for being Arabic', () {
      const remote = ApiFailure(
        'بيانات خاصة اصطناعية لا تعرض',
        statusCode: 400,
      );
      expect(arabic.resolve(remote).hasBusinessMessage, isFalse);
      expect(english.resolve(remote).hasBusinessMessage, isFalse);
      expect(
        arabic
            .resolve('بيانات خاصة اصطناعية لا تعرض', statusCode: 400)
            .hasBusinessMessage,
        isFalse,
      );
      expect(
        arabic
            .resolve(const ValidationFailure('اختر حسابًا أولاً'))
            .businessMessage,
        'اختر حسابًا أولاً',
      );
    });

    test(
      'unmapped remote English text is not displayed in English inline views',
      () {
        const remote = ApiFailure(
          'Synthetic private record is not available',
          statusCode: 400,
        );
        expect(english.resolve(remote).hasBusinessMessage, isFalse);
        expect(
          english
              .resolve(const ApiFailure('Account not found', statusCode: 404))
              .businessMessage,
          'Account not found',
        );
      },
    );

    test('all 5xx failures use the uncertain server-result wording', () {
      for (final status in [500, 501, 503, 505, 599]) {
        final result = arabic.resolve(
          ApiFailure('سر مصطنع', statusCode: status),
        );
        expect(result.reason, AppErrorReason.server);
        expect(result.hasBusinessMessage, isFalse);
      }
    });

    test(
      'parameterised translations do not echo unknown remote tokens or paths',
      () {
        for (final raw in [
          'Account SYNTHETIC_PRIVATE is inactive',
          'Missing permission: SYNTHETIC_PRIVATE',
          'No backup file named "SYNTHETIC_PRIVATE" on this server.',
          'SYNTHETIC_PRIVATE is required',
          'item SYNTHETIC_PRIVATE is not stock-tracked',
        ]) {
          final result = arabic.resolve(ApiFailure(raw, statusCode: 400));
          expect(
            result.businessMessage ?? '',
            isNot(contains('SYNTHETIC_PRIVATE')),
          );
        }
        final long = arabic.resolve(ApiFailure('A' * 1025, statusCode: 400));
        expect(long.hasBusinessMessage, isFalse);
      },
    );

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
      final text = arabic.resolve(
        'Nothing to depreciate for 2024-01 — FA-M-1: already depreciated for 2024-01',
        statusCode: 400,
      );
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
        arabic.resolve(const ApiFailure('x', statusCode: 500)).severity,
        AppErrorSeverity.error,
      );
      expect(
        arabic.resolve(const NetworkFailure()).severity,
        AppErrorSeverity.error,
      );
      expect(
        arabic.resolve(const ApiFailure('x', statusCode: 404)).severity,
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
