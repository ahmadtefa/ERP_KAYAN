/// The five fundamental account classifications of double-entry accounting.
///
/// [normalBalance] determines whether an increase is recorded as a debit or
/// a credit. This drives balance calculation and reporting sign conventions.
enum AccountType {
  asset(sign: 1),
  liability(sign: -1),
  equity(sign: -1),
  revenue(sign: -1),
  expense(sign: 1);

  const AccountType({required this.sign});

  /// +1 when the account increases with a debit, -1 when it increases with
  /// a credit.
  final int sign;

  bool get increasesWithDebit => sign == 1;
}
