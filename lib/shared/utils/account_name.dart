/// The one place that decides which account name a person sees.
///
/// Mirrors `account-name.ts` on the server, with the same rules in every
/// screen and every exported file:
///
///  - the requested language wins when the account has that name;
///  - the other language is the fallback when it does not;
///  - the account code is the last resort, so a cell is never blank.
///
/// The company typed these names. Nothing here translates them.
library;

/// The two names an account carries, as they arrive from the API.
abstract interface class AccountNames {
  String get code;
  String? get nameEn;
  String? get nameAr;
}

/// The name to show for `languageCode` ('ar' or 'en'), with the fallbacks.
String accountName(AccountNames account, String languageCode) {
  final preferred = languageCode == 'ar' ? account.nameAr : account.nameEn;
  final trimmed = preferred?.trim();
  if (trimmed != null && trimmed.isNotEmpty) return trimmed;

  final other = languageCode == 'ar' ? account.nameEn : account.nameAr;
  final otherTrimmed = other?.trim();
  if (otherTrimmed != null && otherTrimmed.isNotEmpty) return otherTrimmed;

  return account.code;
}

/// "1101 — النقدية بالصندوق", the label used in pickers and headers.
String accountLabel(AccountNames account, String languageCode) =>
    '${account.code} — ${accountName(account, languageCode)}';
