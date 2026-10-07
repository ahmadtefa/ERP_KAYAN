// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'KAYAN ERP';

  @override
  String get signIn => 'Sign In';

  @override
  String get signOut => 'Sign Out';

  @override
  String get username => 'Username';

  @override
  String get password => 'Password';

  @override
  String get usernameRequired => 'Username is required';

  @override
  String get passwordRequired => 'Password is required';

  @override
  String get invalidCredentials => 'Invalid username or password';

  @override
  String get unexpectedError => 'An unexpected error occurred';

  @override
  String get networkError =>
      'Cannot reach the server. Check your connection or the API address.';

  @override
  String get loading => 'Loading…';

  @override
  String get retry => 'Retry';

  @override
  String get noData => 'No data to display';

  @override
  String get welcomeBack => 'Welcome back';

  @override
  String get dashboard => 'Dashboard';

  @override
  String get chartOfAccounts => 'Chart of Accounts';

  @override
  String get journalEntries => 'Journal Entries';

  @override
  String get sales => 'Sales';

  @override
  String get purchases => 'Purchases';

  @override
  String get inventory => 'Inventory';

  @override
  String get reports => 'Reports';

  @override
  String get settings => 'Settings';

  @override
  String get language => 'Language';

  @override
  String get arabic => 'العربية';

  @override
  String get english => 'English';

  @override
  String get systemDefault => 'System default';

  @override
  String get appearance => 'Appearance';

  @override
  String get signedInAs => 'Signed in as';

  @override
  String get company => 'Company';

  @override
  String get branch => 'Branch';

  @override
  String get notAvailable => 'Not set';

  @override
  String get version => 'Version';

  @override
  String get about => 'About';

  @override
  String get aboutDescription =>
      'KAYAN ERP — cross-platform enterprise resource planning client.';

  @override
  String get quickAccess => 'Quick access';

  @override
  String get moduleComingSoon => 'This module is not available yet.';

  @override
  String get accountsTotal => 'Accounts';

  @override
  String get accountCode => 'Code';

  @override
  String get accountName => 'Account name';

  @override
  String get accountType => 'Type';

  @override
  String get typeAsset => 'Assets';

  @override
  String get typeLiability => 'Liabilities';

  @override
  String get typeEquity => 'Equity';

  @override
  String get typeRevenue => 'Revenue';

  @override
  String get typeExpense => 'Expenses';

  @override
  String get searchAccounts => 'Search by code or name';

  @override
  String get noAccounts => 'No accounts found';

  @override
  String get postable => 'Postable';

  @override
  String get grouping => 'Group';

  @override
  String get unbalancedEntry =>
      'Journal entry is not balanced (debits must equal credits)';

  @override
  String get sampleDataNotice =>
      'Development sample data — no backend is connected yet.';

  @override
  String get sampleDataDetail =>
      'These records are generated locally for interface development. They are not stored and are not a system of record.';

  @override
  String get pendingDecisions => 'Pending business decisions';
}
