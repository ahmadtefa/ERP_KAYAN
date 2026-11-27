import 'package:erp_kayan/features/parties/presentation/customer_terms.dart';
import 'package:erp_kayan/shared/widgets/form_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../widget/test_harness.dart';

void main() {
  group('twelve methods are offered, in both languages', () {
    test('every method has a label in Arabic and English', () {
      expect(termMethodCodes, hasLength(12));
      for (final code in termMethodCodes) {
        expect(termMethodLabel(code, isArabic: true), isNot(code));
        expect(termMethodLabel(code, isArabic: false), isNot(code));
      }
    });
    test('the method select lists all twelve', () {
      final method = customerTermFields(isArabic: false).firstWhere((f) => f.key == 'paymentTermMethod');
      expect(method.options.map((o) => o.value).toList(), termMethodCodes);
    });
  });

  group('installments and stages text', () {
    test('reads advance plus balance', () {
      final r = parseShares('30, 0\n70, 45', named: false, isArabic: false);
      expect(r.error, isNull);
      expect(r.value, [
        {'percent': 30, 'afterDays': 0},
        {'percent': 70, 'afterDays': 45},
      ]);
    });
    test('refuses a total other than 100, in both languages', () {
      expect(parseShares('30, 0\n60, 45', named: false, isArabic: false).error, contains('add up to exactly 100'));
      expect(parseShares('30, 0\n60, 45', named: false, isArabic: true).error, contains('100'));
    });
    test('refuses one line, a bad line and a missing stage name', () {
      expect(parseShares('100, 0', named: false, isArabic: false).error, contains('at least two'));
      expect(parseShares('abc\n50, 3', named: false, isArabic: false).error, contains('abc'));
      expect(parseShares('50, 0, \n50, 30, Done', named: true, isArabic: false).error, contains('stage name'));
    });
    test('reads stages with names, even with a comma in the name', () {
      final r = parseShares('40, 0, On order\n60, 30, On delivery, final', named: true, isArabic: false);
      expect(r.error, isNull);
      expect(r.value!.last, {'percent': 60, 'afterDays': 30, 'label': 'On delivery, final'});
    });
  });

  group('day windows text', () {
    test('reads windows that cover the whole month', () {
      final r = parseWindows('1-10, 20, 0\n11-20, 5, 1\n21-31, 15, 1', isArabic: false);
      expect(r.error, isNull);
      expect(r.value, hasLength(3));
      expect(r.value![1], {'fromDay': 11, 'toDay': 20, 'payDay': 5, 'monthOffset': 1});
    });
    test('refuses overlap, gaps and bad numbers', () {
      expect(parseWindows('1-15, 20, 0\n15-31, 5, 1', isArabic: false).error, contains('overlap'));
      expect(parseWindows('1-10, 20, 0', isArabic: false).error, contains('every day'));
      expect(parseWindows('1-31, 40, 0', isArabic: false).error, contains('not valid'));
      expect(parseWindows('1-31, 5, 2', isArabic: false).error, contains('not valid'));
    });
  });

  group('form values to the server body and back', () {
    test('a plain method sends no settings', () {
      final body = termDraftToBody({'paymentTermMethod': 'FROM_MONTH_END', 'paymentTermDays': '30', 'nameEn': 'A'});
      expect(body['paymentTermMethod'], 'FROM_MONTH_END');
      expect(body['paymentTermDays'], '30');
      expect(body['paymentTermConfig'], isNull);
      expect(body['nameEn'], 'A');
      expect(body.keys.where((k) => k.startsWith('cfg_')), isEmpty);
    });
    test('fixed day of next month', () {
      final body = termDraftToBody({'paymentTermMethod': 'FIXED_DAY_NEXT_MONTH', 'cfg_dayOfMonth': '10'});
      expect(body['paymentTermConfig'], {'dayOfMonth': 10});
    });
    test('early-payment discount 2/10 net 30', () {
      final body = termDraftToBody({
        'paymentTermMethod': 'EARLY_DISCOUNT', 'paymentTermDays': '30', 'cfg_discountPercent': '2', 'cfg_discountDays': '10',
      });
      expect(body['paymentTermConfig'], {'discountPercent': 2.0, 'discountDays': 10});
    });
    test('installments, windows, stages, weekday and penalty', () {
      expect(termDraftToBody({'paymentTermMethod': 'INSTALLMENTS', 'cfg_shares': '30, 0\n70, 45'})['paymentTermConfig'], {
        'installments': [
          {'percent': 30, 'afterDays': 0},
          {'percent': 70, 'afterDays': 45},
        ],
      });
      expect(termDraftToBody({'paymentTermMethod': 'DAY_WINDOWS', 'cfg_windows': '1-31, 5, 1'})['paymentTermConfig'], {
        'windows': [
          {'fromDay': 1, 'toDay': 31, 'payDay': 5, 'monthOffset': 1},
        ],
      });
      expect(termDraftToBody({'paymentTermMethod': 'MILESTONES', 'cfg_stages': '50, 0, A\n50, 9, B'})['paymentTermConfig'], {
        'installments': [
          {'percent': 50, 'afterDays': 0, 'label': 'A'},
          {'percent': 50, 'afterDays': 9, 'label': 'B'},
        ],
      });
      expect(termDraftToBody({'paymentTermMethod': 'WEEKLY_CUTOFF', 'cfg_weekday': '4'})['paymentTermConfig'], {'weekday': 4});
      expect(
        termDraftToBody({
          'paymentTermMethod': 'LATE_PENALTY', 'cfg_penaltyPercent': '1.5', 'cfg_penaltyPeriod': 'MONTH', 'cfg_penaltyGrace': '5',
        })['paymentTermConfig'],
        {'penalty': {'percent': 1.5, 'period': 'MONTH', 'graceDays': 5}},
      );
    });
    test('a stored customer reads back into the form fields', () {
      final initial = termInitialFrom({
        'paymentTermMethod': 'INSTALLMENTS',
        'paymentTermDays': 5,
        'paymentTermConfig': {
          'installments': [
            {'percent': 30, 'afterDays': 0},
            {'percent': 70, 'afterDays': 45},
          ],
        },
      });
      expect(initial['paymentTermMethod'], 'INSTALLMENTS');
      expect(initial['paymentTermDays'], 5);
      expect(initial['cfg_shares'], '30, 0\n70, 45');
      // and round-trips to the same body
      expect(termDraftToBody(initial)['paymentTermConfig'], {
        'installments': [
          {'percent': 30, 'afterDays': 0},
          {'percent': 70, 'afterDays': 45},
        ],
      });
    });
    test('a new customer starts with the last chosen method; unknown falls back', () {
      expect(termInitialFrom(null, defaultMethod: 'FROM_MONTH_END')['paymentTermMethod'], 'FROM_MONTH_END');
      expect(termInitialFrom(null)['paymentTermMethod'], 'FROM_INVOICE_DATE');
      expect(termInitialFrom(null, defaultMethod: 'NOPE')['paymentTermMethod'], 'FROM_INVOICE_DATE');
    });
    test('an existing customer keeps its own method, not the default', () {
      expect(
        termInitialFrom({'paymentTermMethod': 'COD_ADVANCE'}, defaultMethod: 'FROM_MONTH_END')['paymentTermMethod'],
        'COD_ADVANCE',
      );
    });
  });

  testWidgets('the form shows only the settings of the chosen method and sends them', (tester) async {
    Map<String, dynamic>? sent;
    await tester.pumpWidget(
      wrapWithApp(
        child: Scaffold(
          body: Builder(
            builder: (context) => FilledButton(
              onPressed: () => showFormSheet(
                context,
                title: 'Customer',
                fields: customerTermFields(isArabic: false),
                initial: termInitialFrom(null, defaultMethod: 'FROM_MONTH_END'),
                onSubmit: (values) async {
                  sent = termDraftToBody(values);
                },
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    // the remembered method is preselected, and only the days field is open
    expect(find.text('From the end of the invoice month'), findsOneWidget);
    expect(find.text('Number of days'), findsOneWidget);
    expect(find.text('Pay day of next month (1 to 31)'), findsNothing);
    expect(find.text('Installments: one line each, percent then days'), findsNothing);

    await tester.tap(find.text('From the end of the invoice month'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Fixed day of next month').last);
    await tester.pumpAndSettle();
    expect(find.text('Pay day of next month (1 to 31)'), findsOneWidget);

    await tester.enterText(find.widgetWithText(TextFormField, 'Number of days'), '5');
    await tester.enterText(find.widgetWithText(TextFormField, 'Pay day of next month (1 to 31)'), '10');
    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();
    expect(sent, isNotNull);
    expect(sent!['paymentTermMethod'], 'FIXED_DAY_NEXT_MONTH');
    expect(sent!['paymentTermDays'], '5');
    expect(sent!['paymentTermConfig'], {'dayOfMonth': 10});
  });
}
