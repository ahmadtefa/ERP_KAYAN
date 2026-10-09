import '../../../../core/error/failure.dart';
import '../../../../core/money/money.dart';
import 'account_type.dart';

/// A single debit or credit line of a [JournalEntry].
///
/// A line carries exactly one sided amount: either [debit] or [credit],
/// never both, and never a negative value.
class JournalLine {
  JournalLine({
    required this.accountId,
    required this.accountType,
    Money? debit,
    Money? credit,
    this.description,
    this.costCenterId,
  }) : debit = debit ?? Money.zero(_currencyOf(debit, credit)),
       credit = credit ?? Money.zero(_currencyOf(debit, credit)) {
    if (this.debit.isNegative || this.credit.isNegative) {
      throw const ValidationFailure('Journal line amounts cannot be negative');
    }
    if (this.debit.isPositive && this.credit.isPositive) {
      throw const ValidationFailure(
        'A journal line cannot be both a debit and a credit',
      );
    }
  }

  final String accountId;
  final AccountType accountType;
  final Money debit;
  final Money credit;
  final String? description;
  final String? costCenterId;

  String get currency => debit.currency;

  bool get isDebit => debit.isPositive;
  bool get isCredit => credit.isPositive;

  /// The line amount expressed with its natural sign, used for netting.
  Money get signedAmount => isDebit ? debit : (isCredit ? -credit : debit);

  static String _currencyOf(Money? a, Money? b) {
    final currency = a?.currency ?? b?.currency;
    if (currency == null) {
      throw const ValidationFailure('Journal line requires a currency');
    }
    return currency;
  }

  @override
  String toString() =>
      'Line(account: $accountId, debit: $debit, credit: $credit)';
}

/// Status of a journal entry within the posting lifecycle.
enum JournalEntryStatus { draft, posted, reversed }

/// An accounting journal entry that must satisfy the double-entry invariant:
/// total debits must equal total credits, in a single currency.
class JournalEntry {
  JournalEntry({
    required this.id,
    required this.companyId,
    required this.branchId,
    required this.entryNumber,
    required this.entryDate,
    required List<JournalLine> lines,
    this.description,
    this.status = JournalEntryStatus.draft,
    this.currency = 'EGP',
    this.reversalOfId,
  }) : lines = List.unmodifiable(lines) {
    if (this.lines.length < 2) {
      throw const ValidationFailure(
        'A journal entry requires at least two lines',
      );
    }
    final currencies = this.lines.map((l) => l.currency).toSet();
    if (currencies.length != 1) {
      throw const ValidationFailure(
        'All lines of a journal entry must share one currency',
      );
    }
    if (currencies.single != currency) {
      throw ValidationFailure(
        'Entry currency $currency does not match line currency '
        '${currencies.single}',
      );
    }
  }

  final String id;
  final String companyId;
  final String branchId;
  final String entryNumber;
  final DateTime entryDate;
  final String? description;
  final JournalEntryStatus status;
  final String currency;
  final String? reversalOfId;
  final List<JournalLine> lines;

  Money get totalDebit =>
      lines.fold(Money.zero(currency), (sum, line) => sum + line.debit);

  Money get totalCredit =>
      lines.fold(Money.zero(currency), (sum, line) => sum + line.credit);

  Money get difference => totalDebit - totalCredit;

  /// The double-entry invariant. Evaluated at the entry's rounding scale so
  /// that sub-cent representation noise cannot mask a real imbalance.
  bool get isBalanced => difference.rounded().isZero;

  bool get isPosted => status == JournalEntryStatus.posted;
  bool get isDraft => status == JournalEntryStatus.draft;

  /// Creates a reversal entry that mirrors [this] and swaps debit/credit.
  JournalEntry reversal({
    required String id,
    required String entryNumber,
    required DateTime date,
  }) {
    if (!isPosted) {
      throw const ValidationFailure('Only posted entries can be reversed');
    }
    return JournalEntry(
      id: id,
      companyId: companyId,
      branchId: branchId,
      entryNumber: entryNumber,
      entryDate: date,
      description: 'Reversal of $entryNumber',
      currency: currency,
      status: JournalEntryStatus.posted,
      reversalOfId: this.id,
      lines: lines
          .map(
            (l) => JournalLine(
              accountId: l.accountId,
              accountType: l.accountType,
              debit: l.credit.isPositive ? l.credit : null,
              credit: l.debit.isPositive ? l.debit : null,
              description: l.description,
              costCenterId: l.costCenterId,
            ),
          )
          .toList(),
    );
  }

  /// Guards the transition draft -> posted.
  JournalEntry post() {
    if (!isBalanced) {
      throw ValidationFailure(
        'Cannot post an unbalanced entry: debits $totalDebit vs '
        'credits $totalCredit',
      );
    }
    return JournalEntry(
      id: id,
      companyId: companyId,
      branchId: branchId,
      entryNumber: entryNumber,
      entryDate: entryDate,
      description: description,
      currency: currency,
      status: JournalEntryStatus.posted,
      reversalOfId: reversalOfId,
      lines: lines,
    );
  }

  @override
  String toString() =>
      'JournalEntry($entryNumber, ${status.name}, debit: $totalDebit, '
      'credit: $totalCredit, balanced: $isBalanced)';
}
