import 'package:decimal/decimal.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/core/money/money.dart';
import 'package:erp_kayan/features/accounting/domain/entities/account_type.dart';
import 'package:erp_kayan/features/accounting/domain/entities/journal_entry.dart';
import 'package:flutter_test/flutter_test.dart';

JournalLine debit(String account, String amount) => JournalLine(
  accountId: account,
  accountType: AccountType.asset,
  debit: Money.parse(amount, 'EGP'),
);

JournalLine credit(String account, String amount) => JournalLine(
  accountId: account,
  accountType: AccountType.revenue,
  credit: Money.parse(amount, 'EGP'),
);

JournalEntry entryWith(List<JournalLine> lines, {String currency = 'EGP'}) =>
    JournalEntry(
      id: 'e1',
      companyId: 'c1',
      branchId: 'b1',
      entryNumber: 'JV-0001',
      entryDate: DateTime(2026, 1, 1),
      currency: currency,
      lines: lines,
    );

void main() {
  group('JournalLine', () {
    test('records a debit side only', () {
      final line = debit('1101', '100');
      expect(line.isDebit, isTrue);
      expect(line.isCredit, isFalse);
      expect(line.credit.isZero, isTrue);
    });

    test('rejects negative amounts', () {
      expect(
        () => JournalLine(
          accountId: '1101',
          accountType: AccountType.asset,
          debit: Money.parse('-1', 'EGP'),
        ),
        throwsA(isA<ValidationFailure>()),
      );
    });

    test('rejects a line that is both debit and credit', () {
      expect(
        () => JournalLine(
          accountId: '1101',
          accountType: AccountType.asset,
          debit: Money.parse('10', 'EGP'),
          credit: Money.parse('10', 'EGP'),
        ),
        throwsA(isA<ValidationFailure>()),
      );
    });
  });

  group('JournalEntry double-entry invariant', () {
    test('a balanced entry reports equal totals and no difference', () {
      final entry = entryWith([
        debit('1101', '500.25'),
        credit('4101', '500.25'),
      ]);
      expect(entry.totalDebit.amount, Decimal.parse('500.25'));
      expect(entry.totalCredit.amount, Decimal.parse('500.25'));
      expect(entry.difference.isZero, isTrue);
      expect(entry.isBalanced, isTrue);
    });

    test('an unbalanced entry is detected', () {
      final entry = entryWith([debit('1101', '500'), credit('4101', '499.99')]);
      expect(entry.isBalanced, isFalse);
      expect(entry.difference.amount, Decimal.parse('0.01'));
    });

    test('posting an unbalanced entry is refused', () {
      final entry = entryWith([debit('1101', '500'), credit('4101', '400')]);
      expect(entry.post, throwsA(isA<ValidationFailure>()));
    });

    test('posting a balanced entry moves it to posted', () {
      final entry = entryWith([debit('1101', '100'), credit('4101', '100')]);
      final posted = entry.post();
      expect(posted.isPosted, isTrue);
      expect(posted.isDraft, isFalse);
      expect(posted.entryNumber, entry.entryNumber);
    });

    test('accepts multiple lines that net to zero', () {
      final entry = entryWith([
        debit('1101', '300'),
        debit('5101', '200'),
        credit('4101', '500'),
      ]);
      expect(entry.isBalanced, isTrue);
    });

    test('requires at least two lines', () {
      expect(
        () => entryWith([debit('1101', '100')]),
        throwsA(isA<ValidationFailure>()),
      );
    });

    test('rejects mixed currencies in one entry', () {
      expect(
        () => entryWith([
          debit('1101', '100'),
          JournalLine(
            accountId: '4101',
            accountType: AccountType.revenue,
            credit: Money.parse('100', 'USD'),
          ),
        ]),
        throwsA(isA<ValidationFailure>()),
      );
    });

    test('rejects a line currency that differs from the entry currency', () {
      expect(
        () => entryWith([
          debit('1101', '100'),
          credit('4101', '100'),
        ], currency: 'USD'),
        throwsA(isA<ValidationFailure>()),
      );
    });
  });

  group('JournalEntry reversal', () {
    JournalEntry posted() =>
        entryWith([debit('1101', '250'), credit('4101', '250')]).post();

    test('mirrors the original entry and swaps the sides', () {
      final reversed = posted().reversal(
        id: 'e2',
        entryNumber: 'JV-0002',
        date: DateTime(2026, 2, 1),
      );

      expect(reversed.reversalOfId, 'e1');
      expect(reversed.isPosted, isTrue);
      expect(reversed.isBalanced, isTrue);
      // The original debit account now carries the credit.
      expect(reversed.lines.first.accountId, '1101');
      expect(reversed.lines.first.isCredit, isTrue);
      expect(reversed.lines.first.credit.amount, Decimal.parse('250'));
      expect(reversed.totalDebit, reversed.totalCredit);
    });

    test('a draft entry cannot be reversed', () {
      final draft = entryWith([debit('1101', '10'), credit('4101', '10')]);
      expect(
        () => draft.reversal(
          id: 'e3',
          entryNumber: 'JV-0003',
          date: DateTime(2026, 2, 2),
        ),
        throwsA(isA<ValidationFailure>()),
      );
    });
  });
}
