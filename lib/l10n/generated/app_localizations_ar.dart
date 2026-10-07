// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Arabic (`ar`).
class AppLocalizationsAr extends AppLocalizations {
  AppLocalizationsAr([String locale = 'ar']) : super(locale);

  @override
  String get appTitle => 'نظام كيان';

  @override
  String get signIn => 'تسجيل الدخول';

  @override
  String get signOut => 'تسجيل الخروج';

  @override
  String get username => 'اسم المستخدم';

  @override
  String get password => 'كلمة المرور';

  @override
  String get usernameRequired => 'اسم المستخدم مطلوب';

  @override
  String get passwordRequired => 'كلمة المرور مطلوبة';

  @override
  String get welcomeBack => 'مرحباً بعودتك';

  @override
  String get dashboard => 'لوحة التحكم';

  @override
  String get chartOfAccounts => 'دليل الحسابات';

  @override
  String get journalEntries => 'القيود اليومية';

  @override
  String get sales => 'المبيعات';

  @override
  String get purchases => 'المشتريات';

  @override
  String get inventory => 'المخزون';

  @override
  String get reports => 'التقارير';

  @override
  String get settings => 'الإعدادات';

  @override
  String get language => 'اللغة';

  @override
  String get arabic => 'العربية';

  @override
  String get english => 'English';

  @override
  String get invalidCredentials => 'اسم المستخدم أو كلمة المرور غير صحيحة';

  @override
  String get unexpectedError => 'حدث خطأ غير متوقع';

  @override
  String get networkError => 'خطأ في الشبكة. يرجى التحقق من الاتصال.';

  @override
  String get loading => 'جارٍ التحميل...';

  @override
  String get retry => 'إعادة المحاولة';

  @override
  String get unbalancedEntry =>
      'القيد غير متوازن (يجب أن يتساوى المدين مع الدائن)';
}
