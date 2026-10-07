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
  String get invalidCredentials => 'Invalid username or password';

  @override
  String get unexpectedError => 'An unexpected error occurred';

  @override
  String get networkError => 'Network error. Please check your connection.';

  @override
  String get loading => 'Loading...';

  @override
  String get retry => 'Retry';

  @override
  String get unbalancedEntry =>
      'Journal entry is not balanced (debits must equal credits)';
}
