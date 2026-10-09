import '../../features/accounting/domain/entities/account_type.dart';
import '../../l10n/generated/app_localizations.dart';

/// Localized display names for [AccountType].
///
/// Kept outside the accounting feature so presentation, reports and exports
/// can all share one translation source.
extension AccountTypeLabels on AppLocalizations {
  String accountTypeLabel(AccountType type) => switch (type) {
    AccountType.asset => typeAsset,
    AccountType.liability => typeLiability,
    AccountType.equity => typeEquity,
    AccountType.revenue => typeRevenue,
    AccountType.expense => typeExpense,
  };
}
