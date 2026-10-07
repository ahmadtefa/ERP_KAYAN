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
  String get invalidCredentials => 'اسم المستخدم أو كلمة المرور غير صحيحة';

  @override
  String get unexpectedError => 'حدث خطأ غير متوقع';

  @override
  String get networkError =>
      'تعذّر الوصول إلى الخادم. تحقق من الاتصال أو من عنوان الواجهة البرمجية.';

  @override
  String get loading => 'جارٍ التحميل…';

  @override
  String get retry => 'إعادة المحاولة';

  @override
  String get noData => 'لا توجد بيانات للعرض';

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
  String get systemDefault => 'لغة النظام';

  @override
  String get appearance => 'المظهر';

  @override
  String get signedInAs => 'مسجّل الدخول باسم';

  @override
  String get company => 'الشركة';

  @override
  String get branch => 'الفرع';

  @override
  String get notAvailable => 'غير محدد';

  @override
  String get version => 'الإصدار';

  @override
  String get about => 'حول النظام';

  @override
  String get aboutDescription =>
      'نظام كيان — عميل تخطيط موارد المؤسسات متعدد المنصات.';

  @override
  String get quickAccess => 'وصول سريع';

  @override
  String get moduleComingSoon => 'هذه الوحدة غير متاحة بعد.';

  @override
  String get accountsTotal => 'الحسابات';

  @override
  String get accountCode => 'الرمز';

  @override
  String get accountName => 'اسم الحساب';

  @override
  String get accountType => 'النوع';

  @override
  String get typeAsset => 'الأصول';

  @override
  String get typeLiability => 'الالتزامات';

  @override
  String get typeEquity => 'حقوق الملكية';

  @override
  String get typeRevenue => 'الإيرادات';

  @override
  String get typeExpense => 'المصروفات';

  @override
  String get searchAccounts => 'البحث بالرمز أو الاسم';

  @override
  String get noAccounts => 'لا توجد حسابات';

  @override
  String get postable => 'قابل للترحيل';

  @override
  String get grouping => 'تجميعي';

  @override
  String get unbalancedEntry =>
      'القيد غير متوازن (يجب أن يتساوى المدين مع الدائن)';

  @override
  String get sampleDataNotice =>
      'بيانات تجريبية للتطوير — لا يوجد اتصال بخادم بعد.';

  @override
  String get sampleDataDetail =>
      'هذه السجلات مُولّدة محلياً لتطوير الواجهة، ولا يتم حفظها ولا تُعد مصدراً للحقيقة.';

  @override
  String get pendingDecisions => 'قرارات عمل معلّقة';
}
