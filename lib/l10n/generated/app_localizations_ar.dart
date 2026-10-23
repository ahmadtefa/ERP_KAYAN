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
  String get sessionExpired => 'انتهت صلاحية الجلسة. سجّل الدخول مرة أخرى للمتابعة.';

  @override
  String get permissionDenied => 'ليس لديك صلاحية لتنفيذ هذا الإجراء.';

  @override
  String get openingQuantity => 'الكمية الافتتاحية';

  @override
  String get openingUnitCost => 'تكلفة الوحدة الافتتاحية';

  @override
  String get openingStockHint =>
      'اختياري. يرحّل المخزون وقيد المخزون/حقوق الملكية مع الصنف. اتركه فارغاً لإدخال المخزون الافتتاحي لاحقاً من الأرصدة الافتتاحية.';

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
  String get openingBalancesTitle => 'الأرصدة الافتتاحية';

  @override
  String get reviewOpeningBalances => 'مراجعة الأرصدة الافتتاحية';

  @override
  String get noOpeningBalanceDocuments => 'لا توجد مسودات أرصدة افتتاحية بعد';

  @override
  String get openingBalanceDraftHint =>
      'الأرصدة المستوردة تبقى مسودات حتى تراجعها وترحّلها.';

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
  String get signInIncomplete => 'قبِل الخادم تسجيل الدخول لكنه لم يُرسل بيانات الحساب. يعني ذلك عادةً أن البرنامج والخادم بإصدارين مختلفين، أو أن تهيئة الشركة لم تكتمل. التفاصيل التقنية في سجل البرنامج.';

  @override
  String get sessionNotPersisted => 'الجلسة محفوظة في الذاكرة فقط: المتصفح لا يخزّنها على عنوان http:// غير آمن. إعادة تحميل الصفحة تسجّل الخروج. شغّل البرنامج عبر HTTPS لحفظ الجلسة.';

  @override
  String get sessionStorageLabel => 'حفظ الجلسة';

  @override
  String get sessionStorageDurable => 'محفوظة على هذا الجهاز';

  @override
  String get sessionStorageMemoryOnly => 'في الذاكرة فقط';

  @override
  String get sessionStorageMemoryHint => 'هذه الصفحة ليست عبر HTTPS، لذا يحفظ المتصفح الجلسة حتى إعادة التحميل فقط. شغّل البرنامج عبر HTTPS لبقاء المستخدمين مسجّلين.';

  @override
  String get fontSize => 'حجم الخط';

  @override
  String get fontSizeDescription => 'يطبّق على البرنامج كله: الأزرار والقوائم والشريط الجانبي والجداول ومربعات الحوار والتقارير، ويُحفظ للدخول القادم.';

  @override
  String get fontSizeSmaller => 'تصغير الخط';

  @override
  String get fontSizeLarger => 'تكبير الخط';

  @override
  String get fontSizeReset => 'الحجم الافتراضي';

  @override
  String get fontSizePreview => 'معاينة: فاتورة 1,250.00 ج.م · خصم 12.5%';

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
  String get warehouse => 'المخزن';

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

  @override
  String get customers => 'العملاء';

  @override
  String get suppliers => 'الموردون';

  @override
  String get customer => 'العميل';

  @override
  String get supplier => 'المورد';

  @override
  String get newCustomer => 'عميل جديد';

  @override
  String get newSupplier => 'مورد جديد';

  @override
  String get editCustomer => 'تعديل عميل';

  @override
  String get editSupplier => 'تعديل مورد';

  @override
  String get noCustomers => 'لا يوجد عملاء بعد';

  @override
  String get noSuppliers => 'لا يوجد موردون بعد';

  @override
  String get searchParties => 'ابحث بالكود أو الاسم';

  @override
  String get phone => 'الهاتف';

  @override
  String get email => 'البريد الإلكتروني';

  @override
  String get taxNumber => 'الرقم الضريبي';

  @override
  String get address => 'العنوان';

  @override
  String get creditLimit => 'حد الائتمان';

  @override
  String get creditLimitNote =>
      'مسجَّل للعلم فقط. تطبيقه قرار سياسة لم يُتخذ بعد.';

  @override
  String get partyInactive => 'موقوف — لا يمكن استخدامه في فواتير جديدة';

  @override
  String get items => 'الأصناف';

  @override
  String get item => 'الصنف';

  @override
  String get newItem => 'صنف جديد';

  @override
  String get editItem => 'تعديل صنف';

  @override
  String get noItems => 'لا توجد أصناف بعد';

  @override
  String get searchItems => 'ابحث بالكود أو الاسم';

  @override
  String get unit => 'الوحدة';

  @override
  String get salePrice => 'سعر البيع';

  @override
  String get costPrice => 'سعر التكلفة';

  @override
  String get isStockTracked => 'تتبع المخزون';

  @override
  String get stockTracked => 'مخزون';

  @override
  String get stockNotTracked => 'خدمة / بدون مخزون';

  @override
  String get stockTrackingDoesNotAddQuantity =>
      'تتبع المخزون لا يضيف كمية تلقائياً. أدخل الرصيد من الأرصدة الافتتاحية ثم راجع المسودة ورحّلها.';

  @override
  String get noStock => 'لا يوجد مخزون';

  @override
  String get stock => 'المخزون';

  @override
  String get stockBalances => 'أرصدة المخزون';

  @override
  String get onHand => 'المتاح';

  @override
  String get averageCost => 'متوسط التكلفة';

  @override
  String get stockValue => 'القيمة';

  @override
  String get itemLedger => 'كارت الصنف';

  @override
  String get movements => 'الحركات';

  @override
  String get direction => 'الاتجاه';

  @override
  String get movementIn => 'إضافة';

  @override
  String get movementOut => 'صرف';

  @override
  String get runningBalance => 'الرصيد الجاري';

  @override
  String get reference => 'المرجع';

  @override
  String get noMovements => 'لا توجد حركات';

  @override
  String get totalQuantity => 'إجمالي الكمية';

  @override
  String get totalValue => 'إجمالي القيمة';

  @override
  String get salesInvoices => 'فواتير البيع';

  @override
  String get purchaseInvoices => 'فواتير الشراء';

  @override
  String get newSalesInvoice => 'فاتورة بيع جديدة';

  @override
  String get newPurchaseInvoice => 'فاتورة شراء جديدة';

  @override
  String get landedCosts => 'تكاليف الشراء الإضافية';

  @override
  String get landedCostAllocationHint => 'أضف كل تكلفة للشحن أو النقل أو الجمارك أو غيرها؛ ويُوزّع الإجمالي على أصناف المخزون حسب قيمة كل بند.';

  @override
  String get landedCostCannotBeNegative => 'لا يمكن أن تكون تكاليف الشراء الإضافية سالبة';

  @override
  String get addLandedCost => 'إضافة تكلفة';

  @override
  String get removeLandedCost => 'حذف التكلفة';

  @override
  String get otherLandedCosts => 'تكاليف شراء أخرى';

  @override
  String get landedCostDescriptionRequired => 'أدخل وصفًا لكل تكلفة شراء إضافية';

  @override
  String get landedCostAmountInvalid => 'أدخل مبلغًا صحيحًا غير سالب لكل تكلفة شراء إضافية';

  @override
  String get editDraftInvoice => 'تعديل مسودة الفاتورة';

  @override
  String get onlyDraftInvoiceCanBeEdited => 'يمكن تعديل الفواتير المسودة فقط';

  @override
  String get salesReturns => 'مرتجعات المبيعات';

  @override
  String get purchaseReturns => 'مرتجعات المشتريات';

  @override
  String get newSalesReturn => 'مرتجع مبيعات جديد';

  @override
  String get newPurchaseReturn => 'مرتجع مشتريات جديد';

  @override
  String get noReturns => 'لا توجد مرتجعات بعد';

  @override
  String get returnDate => 'تاريخ المرتجع';

  @override
  String get returnReason => 'سبب المرتجع';

  @override
  String get originalInvoice => 'الفاتورة الأصلية';

  @override
  String get selectOriginalInvoice => 'اختر فاتورة مُرحّلة';

  @override
  String get remainingToReturn => 'الكمية المتبقية للمرتجع';

  @override
  String get quantityToReturn => 'الكمية المرتجعة';

  @override
  String get createReturn => 'إنشاء مرتجع';

  @override
  String get returnCreated => 'تم حفظ المرتجع كمسودة';

  @override
  String get confirmPostReturn => 'سيؤدي ترحيل المرتجع إلى تحديث المخزون ورصيد العميل أو المورد. هل تريد المتابعة؟';

  @override
  String get returnPosted => 'تم ترحيل المرتجع';

  @override
  String get returnReversed => 'تم عكس المرتجع';

  @override
  String get returnLines => 'بنود المرتجع';

  @override
  String get invoiceNumber => 'الرقم';

  @override
  String get invoiceDate => 'التاريخ';

  @override
  String get dueDate => 'تاريخ الاستحقاق';

  @override
  String get invoiceLines => 'البنود';

  @override
  String get addLine => 'أضف بند';

  @override
  String get removeLine => 'حذف';

  @override
  String get line => 'بند';

  @override
  String get description => 'الوصف';

  @override
  String get lineDescription => 'الوصف';

  @override
  String get quantity => 'الكمية';

  @override
  String get unitPrice => 'سعر الوحدة';

  @override
  String get taxRate => 'الضريبة %';

  @override
  String get lineTotal => 'إجمالي البند';

  @override
  String get subTotal => 'المجموع';

  @override
  String get taxAmount => 'الضريبة';

  @override
  String get totalAmount => 'الإجمالي';

  @override
  String get paidAmount => 'المدفوع';

  @override
  String get remaining => 'المتبقي';

  @override
  String get costOfGoods => 'تكلفة البضاعة';

  @override
  String get grossProfit => 'الربح الإجمالي';

  @override
  String get supplierReference => 'مرجع المورد';

  @override
  String get noSalesInvoices => 'لا توجد فواتير بيع';

  @override
  String get noPurchaseInvoices => 'لا توجد فواتير شراء';

  @override
  String get post => 'ترحيل';

  @override
  String get reverse => 'عكس';

  @override
  String get posted => 'مُرحَّل';

  @override
  String get draft => 'مسودة';

  @override
  String get reversed => 'معكوس';

  @override
  String get confirmPost =>
      'ترحيل المستند؟ هيتم تحديث المخزون والدفاتر ومش هينفع تعدّله بعد كده.';

  @override
  String get confirmReverse =>
      'عكس المستند؟ القيد الأصلي هيفضل في الدفاتر وقيد عكسي هيلغيه.';

  @override
  String get invoicePosted => 'تم ترحيل الفاتورة';

  @override
  String get invoiceReversed => 'تم عكس الفاتورة';

  @override
  String get invoiceSaved => 'تم حفظ المسودة';

  @override
  String get posting => 'بيترحّل…';

  @override
  String get reversing => 'بينعكس…';

  @override
  String get invoiceDetails => 'تفاصيل الفاتورة';

  @override
  String get lines => 'التفاصيل';

  @override
  String get selectCustomer => 'اختر عميل';

  @override
  String get selectSupplier => 'اختر مورد';

  @override
  String get selectItem => 'اختر صنف';

  @override
  String get search => 'بحث';

  @override
  String get actions => 'إجراءات';

  @override
  String get viewDetails => 'التفاصيل';

  @override
  String get addLineFirst => 'أضف بند واحد على الأقل';

  @override
  String get partyRequired => 'العميل مطلوب';

  @override
  String get supplierRequired => 'المورد مطلوب';

  @override
  String get trialBalance => 'ميزان المراجعة';

  @override
  String get profitAndLoss => 'الأرباح والخسائر';

  @override
  String get customerBalances => 'أرصدة العملاء';

  @override
  String get supplierBalances => 'أرصدة الموردين';

  @override
  String get accountLedger => 'كشف حساب';

  @override
  String get from => 'من';

  @override
  String get to => 'إلى';

  @override
  String get asOf => 'كما في';

  @override
  String get account => 'الحساب';

  @override
  String get opening => 'رصيد أول';

  @override
  String get closing => 'رصيد آخر';

  @override
  String get debit => 'مدين';

  @override
  String get credit => 'دائن';

  @override
  String get balance => 'الرصيد';

  @override
  String get revenue => 'إيرادات';

  @override
  String get expenses => 'مصروفات';

  @override
  String get netProfit => 'صافي الربح';

  @override
  String get totals => 'الإجماليات';

  @override
  String get difference => 'الفرق';

  @override
  String get balanced => 'الدفاتر متوازنة';

  @override
  String get outOfBalance => 'الدفاتر غير متوازنة';

  @override
  String get runReport => 'اعرض';

  @override
  String get noBalances => 'لا توجد أرصدة في هذه الفترة';

  @override
  String get accountRequired => 'اختر حساب أولاً';

  @override
  String get period => 'الفترة';

  @override
  String get allBranches => 'كل الفروع';

  @override
  String get newJournalEntry => 'قيد يومية جديد';

  @override
  String get entryNumber => 'رقم القيد';

  @override
  String get noEntries => 'لا توجد قيود بعد';

  @override
  String get postEntry => 'ترحيل';

  @override
  String get entryPosted => 'تم ترحيل القيد';

  @override
  String get entryReversed => 'تم عكس القيد';

  @override
  String get entryUnbalanced => 'المدين لازم يساوي الدائن';

  @override
  String get entryNeedsTwoLines => 'القيد يحتاج بندين على الأقل';

  @override
  String get journalDeleted => 'القيد المُرحَّل يتصحّح بالعكس، مش بالتعديل';

  @override
  String get add => 'إضافة';

  @override
  String get edit => 'تعديل';

  @override
  String get save => 'حفظ';

  @override
  String get cancel => 'إلغاء';

  @override
  String get close => 'إغلاق';

  @override
  String get deactivate => 'إيقاف';

  @override
  String get activate => 'إعادة تنشيط';

  @override
  String get active => 'نشِط';

  @override
  String get inactive => 'موقوف';

  @override
  String get confirm => 'تأكيد';

  @override
  String get searchHint => 'ابحث…';

  @override
  String get createdSuccessfully => 'تم الحفظ بنجاح';

  @override
  String get operationFailed => 'لم تكتمل العملية';

  @override
  String get requiredField => 'هذا الحقل مطلوب';

  @override
  String get invalidNumber => 'أدخل رقماً صحيحاً';

  @override
  String get mustBePositive => 'أدخل رقماً أكبر من صفر';

  @override
  String get editInline => 'تعديل';

  @override
  String get noPermission => 'ليس لديك صلاحية لعمل هذا';

  @override
  String get loading_data => 'جارٍ التحميل…';

  @override
  String get status => 'الحالة';

  @override
  String get users => 'المستخدمون';

  @override
  String get administration => 'الإدارة';

  @override
  String get auditTrail => 'سجل التدقيق';

  @override
  String get newUser => 'مستخدم جديد';

  @override
  String get editUser => 'تعديل مستخدم';

  @override
  String get usernameHelper => 'ده اسم الدخول. الاسم admin محجوز للنظام.';

  @override
  String get fullNameEn => 'الاسم بالإنجليزية';

  @override
  String get fullNameAr => 'الاسم بالعربية';

  @override
  String get passwordHelper => '١٢ حرفاً على الأقل.';

  @override
  String get changePassword => 'تغيير كلمة المرور';

  @override
  String get passwordChanged => 'تم تغيير كلمة المرور وإنهاء الجلسات القديمة.';

  @override
  String get confirmDeactivateUser =>
      'المستخدم ده مش هينفع يدخل تاني. تحب نكمل؟';

  @override
  String get searchUsers => 'ابحث عن مستخدم…';

  @override
  String get noUsers => 'مفيش مستخدمين';

  @override
  String get lastLogin => 'آخر دخول';

  @override
  String get never => 'لم يدخل بعد';

  @override
  String get superAdmin => 'مدير عام';

  @override
  String get roles => 'الأدوار';

  @override
  String get newRole => 'دور جديد';

  @override
  String get editRole => 'تعديل دور';

  @override
  String get roleCode => 'الكود';

  @override
  String get noRoles => 'مفيش أدوار';

  @override
  String get systemRole => 'نظامي';

  @override
  String get customRole => 'مخصص';

  @override
  String get deleteRole => 'حذف الدور';

  @override
  String get confirmDeleteRole => 'الدور ده هيتحذف نهائياً. تحب نكمل؟';

  @override
  String get permissions => 'الصلاحيات';

  @override
  String get setPermissions => 'تعديل الصلاحيات';

  @override
  String get selectAll => 'تحديد الكل';

  @override
  String get clearAll => 'إلغاء الكل';

  @override
  String get extraPermissions => 'صلاحيات إضافية';

  @override
  String get permissionsNote =>
      'دور نظامي: تقدر تعدّل صلاحياته، لكن مش ينفع تسمّيه من جديد ولا تحذفه.';

  @override
  String get action => 'الإجراء';

  @override
  String get entity => 'الكيان';

  @override
  String get when => 'الوقت';

  @override
  String get by => 'بواسطة';

  @override
  String get noAuditLogs => 'مفيش تسجيلات لسه';

  @override
  String get refresh => 'تحديث';

  @override
  String get fiscalPeriods => 'الفترات المالية';

  @override
  String get newPeriod => 'فترة جديدة';

  @override
  String get editPeriod => 'تعديل فترة';

  @override
  String get periodCode => 'الكود';

  @override
  String get startDate => 'من تاريخ';

  @override
  String get endDate => 'إلى تاريخ';

  @override
  String get open => 'مفتوحة';

  @override
  String get closed => 'مقفلة';

  @override
  String get closedOn => 'تاريخ الإقفال';

  @override
  String get closePeriod => 'إقفال الفترة';

  @override
  String get confirmClosePeriod =>
      'بعد الإقفال مش هينفع أي ترحيل جوه الفترة دي، لا فواتير ولا قيود يدوية. تحب نكمل؟';

  @override
  String get periodClosed => 'تم إقفال الفترة';

  @override
  String get noPeriods => 'مفيش فترات مالية لسه';

  @override
  String get dataTools => 'البيانات';

  @override
  String get importData => 'رفع بيانات من ملف';

  @override
  String get backupTitle => 'النسخ الاحتياطي والاسترجاع';

  @override
  String get exportExcel => 'إكسل';

  @override
  String get exportCsv => 'CSV';

  @override
  String get print => 'طباعة';

  @override
  String get chooseAccountFirst => 'اختر حساباً أولاً';

  @override
  String get startOver => 'من البداية';

  @override
  String get whatAreYouImporting => 'بترفع بيانات إيه؟';

  @override
  String get templateFirst => 'ابدأ من القالب';

  @override
  String get templateExplains =>
      'القالب فيه الأعمدة الصحيحة وصف مثال وشرح قصير لكل عمود.';

  @override
  String get downloadTemplate => 'تنزيل القالب';

  @override
  String get importStep1 => 'نزّل القالب';

  @override
  String get importStep2 => 'املأه واحفظه';

  @override
  String get importStep3 => 'اختر الملف واقرأه';

  @override
  String get importStep4 => 'نفّذ الاستيراد لما يظبط';

  @override
  String get chooseFile => 'اختر الملف';

  @override
  String get chooseAnotherFile => 'اختر ملفاً آخر';

  @override
  String get removeFile => 'إزالة';

  @override
  String get fileAcceptHint => 'ملف ‎.xlsx‎ أو ‎.csv‎ بحجم أقصى 10 ميجا.';

  @override
  String get readWithoutSaving => 'اقرأه من غير ما تحفظ';

  @override
  String get whatAboutExisting => 'البيانات الموجودة بالفعل يتعمل فيها إيه؟';

  @override
  String get importModeSkip => 'سيبها زي ما هي';

  @override
  String get importModeSkipHint =>
      'أي كود موجود عندك أصلاً بيتخطى وبيتعد، ومفيش أي تغيير.';

  @override
  String get importModeUpdate => 'حدّثها';

  @override
  String get importModeUpdateHint =>
      'الأعمدة اللي في الملف بتتكتب على السجل. الخانة الفاضية مش بتغيّر حاجة.';

  @override
  String get readResult => 'اللي في الملف';

  @override
  String get importResult => 'اللي تم استيراده';

  @override
  String get rowsInFile => 'صفوف في الملف';

  @override
  String get willBeAdded => 'هيتضاف';

  @override
  String get willBeUpdated => 'هيتحدّث';

  @override
  String get willBeSkipped => 'موجود بالفعل';

  @override
  String get columnsNotUnderstood => 'أعمدة مش مفهومة';

  @override
  String get rowsWithProblems => 'صفوف فيها مشاكل';

  @override
  String get row => 'صف';

  @override
  String get moreRows => 'صفوف أخرى';

  @override
  String get fixErrorsThenRetry =>
      'صحّح الصفوف دي في الملف وارفعه تاني. مفيش حاجة اتكتبت منها.';

  @override
  String get importForReal => 'نفّذ الاستيراد';

  @override
  String get importDone => 'تم الاستيراد. القوائم فيها السجلات دي دلوقتي.';

  @override
  String get takeBackup => 'خد نسخة من البيانات';

  @override
  String get takeBackupHint =>
      'ملف واحد فيه الشركة كاملة: الحسابات والأطراف والأصناف والفواتير والقيود وسجل التدقيق. انقله في أي مكان واسترجعه في أي وقت.';

  @override
  String get recordsInTotal => 'إجمالي السجلات';

  @override
  String get downloadBackup => 'تنزيل النسخة';

  @override
  String get restoreBackup => 'الاسترجاع من نسخة';

  @override
  String get restoreWarning =>
      'الاسترجاع بيستبدل كل اللي في الشركة باللي في الملف. وأي حاجة اتسجلت بعد أخذ النسخة بتضيع.';

  @override
  String get restoreChooseFile =>
      'اختر ملف نسخة احتياطية (‎.json‎) نزّلته من الشاشة دي.';

  @override
  String get chooseBackupFile => 'اختر ملف النسخة';

  @override
  String get inspectBackup => 'اقرأ الملف الأول';

  @override
  String get inBackupFile => 'اللي في الملف';

  @override
  String get inTheProgramNow => 'اللي في البرنامج دلوقتي';

  @override
  String get backupTakenAt => 'تاريخ النسخة';

  @override
  String get backupOtherCompany => 'الملف ده لشركة تانية ومش ينفع يترجع هنا.';

  @override
  String get restoreNow => 'استرجع الآن';

  @override
  String get confirmRestoreTitle => 'استبدال كل البيانات؟';

  @override
  String get confirmRestoreBody =>
      'بيانات الشركة هتتبدل باللي في الملف، ومش هينفع نرجع في الخطوة دي. تحب نكمل؟';

  @override
  String get restoreDone => 'تم الاسترجاع';

  @override
  String get printPdfHint => 'بيفتح صفحة نضيفة جاهزة للورق، تنفع مع أي طابعة.';

  @override
  String get exportPdf => 'PDF';

  @override
  String get printHintWhenNoPdf =>
      'بيفتح صفحة نضيفة للورق. من نافذة الطباعة اختار «حفظ كـ PDF» عشان تحفظها ملف PDF.';

  @override
  String get downloadList => 'تنزيل الملف';

  @override
  String get exportListHint =>
      'نزّل القائمة زي ما هي على الشاشة: إكسل أو CSV أو PDF أو ورقة للطباعة.';

  @override
  String get newAccount => 'حساب جديد';

  @override
  String get editAccount => 'تعديل الحساب';

  @override
  String get deleteAccount => 'حذف الحساب';

  @override
  String deleteAccountConfirm(Object account) {
    return 'سيتم حذف الحساب «$account» نهائياً إن لم يكن له حركات أو حسابات فرعية. متابعة؟';
  }

  @override
  String get allTypes => 'كل الأنواع';

  @override
  String get inactiveLabel => 'معطل';

  @override
  String get accountCodeHelper =>
      'اتركه فارغاً ليتم اقتراح الكود تلقائياً وفق ترقيم الدليل';

  @override
  String get nameArabic => 'الاسم بالعربية';

  @override
  String get nameEnglish => 'الاسم بالإنجليزية';

  @override
  String get parentAccount => 'الحساب الأب';

  @override
  String get parentAccountHelper => 'الحسابات الفرعية تأخذ نفس نوع الأب';

  @override
  String get noParent => 'بدون أب (حساب رئيسي)';

  @override
  String get postableHelper =>
      'الحساب التجميعي لا يقبل قيوداً؛ الحساب النهائي هو ما تُرحَّل إليه';

  @override
  String get activeAccount => 'نشط';

  @override
  String get rememberMe => 'تذكرني';

  @override
  String get rememberMeHint => 'يُحفظ اسم المستخدم فقط على الويب';

  @override
  String get clearSavedCredentials => 'مسح البيانات المحفوظة';

  @override
  String get savedCredentialsCleared => 'تم مسح البيانات المحفوظة';

  @override
  String get companySettings => 'بيانات الشركة';

  @override
  String get companyProfile => 'بيانات الشركة';

  @override
  String get companyCode => 'كود الشركة';

  @override
  String get taxId => 'الرقم الضريبي';

  @override
  String get companyLogo => 'شعار الشركة';

  @override
  String get uploadLogo => 'رفع الشعار';

  @override
  String get removeLogo => 'إزالة الشعار';

  @override
  String get logoHint => 'اختياري — PNG أو JPEG أو WebP؛ يُصغّر إلى ١٠٢٤ × ١٠٢٤ بكسل، حتى ٢ ميجابايت';

  @override
  String get logoUpdated => 'تم تحديث الشعار';

  @override
  String get logoRemoved => 'تمت إزالة الشعار';

  @override
  String get noLogo => 'لا يوجد شعار';

  @override
  String get branches => 'الفروع والوحدات';

  @override
  String get newBranch => 'وحدة جديدة';

  @override
  String get editBranch => 'تعديل الوحدة';

  @override
  String get branchCode => 'كود الوحدة';

  @override
  String get branchKind => 'نوع الوحدة';

  @override
  String get headquarters => 'مقر رئيسي';

  @override
  String get branchUnit => 'فرع';

  @override
  String get parentUnit => 'الوحدة الأب';

  @override
  String get parentUnitRequired => 'اختر المقر الرئيسي أو الوحدة الأب';

  @override
  String get deleteBranch => 'حذف الوحدة';

  @override
  String deleteBranchConfirm(Object unit) {
    return 'سيتم حذف الوحدة «$unit». الوحدات ذات الحركات لا يمكن حذفها.';
  }

  @override
  String get branchSaved => 'تم حفظ الوحدة';

  @override
  String get profileSaved => 'تم حفظ بيانات الشركة';

  @override
  String get unitType => 'النوع';

  @override
  String get fullBackupTitle => 'النسخ الاحتياطي الكامل لقاعدة البيانات';

  @override
  String get fullBackupDescription =>
      'نسخة كاملة لكل قاعدة البيانات (جميع الشركات والمستخدمين) بصيغة PostgreSQL. تعمل على الخادم نفسه الذي تستضيف القاعدة.';

  @override
  String get createFullBackup => 'إنشاء نسخة احتياطية الآن';

  @override
  String backupSavedIn(Object directory) {
    return 'مكان الحفظ: $directory';
  }

  @override
  String get backupInProgress => 'جارٍ إنشاء النسخة…';

  @override
  String get backupFiles => 'النسخ المحفوظة على الخادم';

  @override
  String get deleteBackup => 'حذف النسخة';

  @override
  String deleteBackupConfirm(Object file) {
    return 'سيتم حذف الملف «$file» من الخادم نهائياً.';
  }

  @override
  String get restoreFullDatabase => 'استعادة قاعدة البيانات كاملة';

  @override
  String get restoreFullWarning =>
      'الاستعادة الكاملة تستبدل كل البيانات الحالية. سيتم أخذ نسخة أمان تلقائياً قبل التنفيذ.';

  @override
  String get uploadDumpFile => 'رفع ملف نسخة (.dump)';

  @override
  String get orChooseServerBackup => 'أو اختر نسخة من الخادم';

  @override
  String get confirmFullRestoreTitle => 'استعادة كاملة — تأكيد صريح';

  @override
  String get confirmFullRestoreBody =>
      'اكتب كلمة RESTORE للتأكيد. سيتم استبدال كل البيانات الحالية بالبيانات الموجودة في النسخة.';

  @override
  String get restoreFullDone => 'تمت الاستعادة بنجاح';

  @override
  String get restoreFullFailed => 'فشلت الاستعادة';

  @override
  String get fullBackupUnavailable =>
      'أدوات PostgreSQL (pg_dump / pg_restore) غير موجودة على هذا الخادم';

  @override
  String get maintenanceActive =>
      'النظام في وضع الصيانة — تتم استعادة قاعدة البيانات الآن';

  @override
  String get safetyBackup => 'نسخة أمان';

  @override
  String get fullBackupKind => 'نسخة كاملة';

  @override
  String get createdAtLabel => 'تاريخ الإنشاء';

  @override
  String get sizeLabel => 'الحجم';

  @override
  String get refreshStatus => 'تحديث الحالة';

  @override
  String get companySettingsHint => 'الاسم والشعار والتواصل والفروع';

  @override
  String get downloadStarted => 'جارٍ تنزيل الملف.';

  @override
  String get downloadFailedTitle => 'تعذّر تنزيل الملف.';

  @override
  String get printOpened => 'تُفتح صفحة الطباعة في تبويب جديد.';

  @override
  String get printBlocked => 'حجب المتصفح التبويب الجديد. اسمح بالفتح في تبويب جديد لهذا العنوان ثم اضغط طباعة مرة أخرى.';

  @override
  String get resetData => 'إعادة تهيئة البرنامج';

  @override
  String get resetDataHint => 'يحذف بيانات هذه الشركة ويعيد البرنامج إلى أول تشغيل. تؤخذ نسخة احتياطية ويتم التأكد منها قبل حذف أي شيء، وتتوقف العملية إن تعذّر ذلك.';

  @override
  String get resetButton => 'إعادة تهيئة البرنامج';

  @override
  String get resetOnlyAdmins => 'لا يمكن تنفيذ هذا إلا بصلاحية مدير البرنامج.';

  @override
  String resetForCompany(Object company) {
    return 'ستتم إعادة تهيئة بيانات «$company».';
  }

  @override
  String get resetWhatIsDeleted => 'ما سيتم حذفه';

  @override
  String get resetWhatIsKept => 'ما سيبقى';

  @override
  String get resetDeletedHint => 'كل ما تحمله الشركة من سجلات: دفاترها وأطرافها ومخزونها ومستنداتها.';

  @override
  String get resetKeptAdmin => 'حساب المدير الذي تستخدمه الآن';

  @override
  String get resetKeptPermissions => 'قائمة الصلاحيات';

  @override
  String get resetKeptRoles => 'الأدوار التي يأتي بها البرنامج';

  @override
  String get resetKeptConfig => 'إعدادات الاتصال بقاعدة البيانات وإعدادات البرنامج';

  @override
  String get resetCountJournalEntries => 'قيود اليومية';

  @override
  String get resetCountAccounts => 'الحسابات';

  @override
  String get resetCountCustomers => 'العملاء';

  @override
  String get resetCountSuppliers => 'الموردون';

  @override
  String get resetCountItems => 'الأصناف';

  @override
  String get resetCountSalesInvoices => 'فواتير البيع';

  @override
  String get resetCountPurchaseInvoices => 'فواتير الشراء';

  @override
  String get resetCountStockMovements => 'حركات المخزون';

  @override
  String get resetCountFiscalPeriods => 'الفترات المالية';

  @override
  String get resetCountBranches => 'الفروع';

  @override
  String get resetCountUsers => 'المستخدمون الآخرون';

  @override
  String get resetBackupFirst => 'تؤخذ نسخة احتياطية كاملة ويتم التأكد من صحتها قبل حذف أي شيء. وإن تعذّر أخذ النسخة أو التحقق منها فلن يُحذف شيء.';

  @override
  String get resetConfirmTitle => 'لا يمكن التراجع عن هذا';

  @override
  String resetConfirmBody(Object word) {
    return 'العودة تكون فقط باستعادة النسخة التي ستؤخذ الآن. اكتب كلمة المرور وكلمة $word للمتابعة.';
  }

  @override
  String get resetPasswordLabel => 'كلمة المرور';

  @override
  String get resetPasswordHint => 'كلمة مرور الحساب الذي تستخدمه الآن، ويتحقق منها الخادم.';

  @override
  String resetWordLabel(Object word) {
    return 'اكتب $word';
  }

  @override
  String resetWrongWord(Object word) {
    return 'اكتب $word تماماً كما هي للتأكيد.';
  }

  @override
  String resetDone(Object file) {
    return 'تم حذف بيانات الشركة. تحتوي «$file» على البيانات القديمة.';
  }

  @override
  String get resetNeedsSetup => 'سيطلب البرنامج إعداده من جديد عند فتحه في المرة القادمة.';

  @override
  String get resetPreviewFailed => 'تعذّر قراءة ما ستزيله إعادة الضبط.';


  @override
  String get cashAndBanks => 'الخزائن والبنوك';

  @override
  String get newCashAccount => 'خزنة أو حساب بنكي جديد';

  @override
  String get cashAccount => 'الخزنة أو البنك';

  @override
  String get cashBox => 'خزنة';

  @override
  String get bank => 'بنك';

  @override
  String get bankName => 'اسم البنك';

  @override
  String get iban => 'رقم الحساب الدولي';

  @override
  String get ledgerAccount => 'الحساب الدفتري';

  @override
  String get noCashAccounts => 'لا توجد خزائن أو بنوك بعد';

  @override
  String get statement => 'كشف حساب';

  @override
  String get vouchers => 'سندات القبض والصرف';

  @override
  String get newVoucher => 'سند قبض أو صرف جديد';

  @override
  String get receipt => 'سند قبض';

  @override
  String get payment => 'سند صرف';

  @override
  String get voucherType => 'النوع';

  @override
  String get voucherNumber => 'الرقم';

  @override
  String get amount => 'المبلغ';

  @override
  String get noVouchers => 'لا توجد سندات بعد';

  @override
  String get transfers => 'التحويلات';

  @override
  String get newTransfer => 'تحويل جديد';

  @override
  String get fromAccount => 'من';

  @override
  String get toAccount => 'إلى';

  @override
  String get noTransfers => 'لا توجد تحويلات بعد';

  @override
  String get transferNeedsTwoAccounts => 'يحتاج التحويل إلى خزنتين أو حسابين بنكيين';

  @override
  String get party => 'الطرف';

  @override
  String get saved => 'تم الحفظ';

  @override
  String get settleOldestFirst => 'تم تخصيص المبلغ على أقدم الفواتير المفتوحة';
@override
  String get rememberLogin => 'تذكر بيانات الدخول';

@override
  String get rememberWebUsernameOnly => 'سيتم حفظ اسم المستخدم فقط في المتصفح.';

@override
  String get rememberNativeSecure => 'تُحفظ كلمة المرور في مخزن النظام الآمن.';

@override
  String get newExpenseAccount => 'حساب مصروفات جديد';

@override
  String get editExpenseAccount => 'تعديل حساب مصروفات';

@override
  String get noParentAccount => 'بدون حساب أب';

@override
  String get accountCanPost => 'قابل لاستقبال قيود يومية';

@override
  String get activateAccount => 'تفعيل الحساب';

@override
  String get deactivateAccount => 'تعطيل الحساب';

  @override
  String get demoBackupTitle => 'جرّب الشركة التجريبية';

  @override
  String get demoBackupHint =>
      'نزّل نسخة تجريبية واقعية للشركة، ثم اخترها من قسم الاستعادة. راجع المعاينة قبل استبدال أي بيانات.';

  @override
  String get downloadDemoBackup => 'تنزيل النسخة التجريبية';

  @override
  String get demoLoginHint =>
      'بعد الاستعادة، سجّل الدخول باسم admin وكلمة المرور Admin@12345.';

  @override
  String get logoInvalid =>
      'اختر صورة PNG أو JPEG أو WebP صالحة، وبأبعاد لا تقل عن ٣٢ × ٣٢ بكسل.';

  @override
  String get logoTooLarge =>
      'ما زال حجم الشعار بعد التصغير أكبر من ٢ ميجابايت. اختر صورة أبسط.';

  @override
  String get costCenters => 'مراكز التكلفة';

  @override
  String get costCenter => 'مركز التكلفة';

  @override
  String get newCostCenter => 'مركز تكلفة جديد';

  @override
  String get editCostCenter => 'تعديل مركز التكلفة';

  @override
  String get costCenterCode => 'كود مركز التكلفة';

  @override
  String get costCenterType => 'نوع مركز التكلفة';

  @override
  String get department => 'إدارة';

  @override
  String get administrativeUnit => 'وحدة إدارية';

  @override
  String get project => 'مشروع';

  @override
  String get responsiblePerson => 'المسؤول';

  @override
  String get parentCostCenter => 'مركز التكلفة الأب';

  @override
  String get searchCostCenters => 'بحث في مراكز التكلفة';

  @override
  String get noCostCenters => 'لا توجد مراكز تكلفة بعد';

  @override
  String get costCenterSaved => 'تم حفظ مركز التكلفة';

  @override
  String get costCenterDeactivated => 'تم إيقاف مركز التكلفة';

  @override
  String get confirmDeactivateCostCenter => 'الإيقاف يمنع الترحيلات الجديدة، وتبقى الحركات السابقة مرتبطة بمركزها. هل تريد المتابعة؟';

  @override
  String get deleteCostCenter => 'حذف مركز التكلفة';

  @override
  String get confirmDeleteCostCenter => 'لا يمكن حذف مركز تكلفة مستخدم. إذا كانت له حركات، فأوقفه بدلاً من حذفه. هل تريد المتابعة؟';

  @override
  String get costCenterDeleted => 'تم حذف مركز التكلفة';

  @override
  String get allParents => 'كل المراكز الأب';

  @override
  String get allStatuses => 'كل الحالات';

  @override
  String get usage => 'الاستخدام';

  @override
  String get journalLinesUsing => 'سطور القيود';

  @override
  String get allocatedLinesUsing => 'سطور موزعة';

  @override
  String get costCenterReport => 'مراكز التكلفة';

  @override
  String get ownAmount => 'خاص به';

  @override
  String get rolledUp => 'شاملاً التابعين';

  @override
  String get unallocated => 'غير موزع';

  @override
  String get transactions => 'الحركات';

  @override
  String get noTransactions => 'لا توجد حركات في هذه الفترة';

  @override
  String get drillDown => 'التفاصيل';

  @override
  String get budgets => 'الموازنات';

  @override
  String get budget => 'الموازنة';

  @override
  String get newBudget => 'موازنة جديدة';

  @override
  String get editBudget => 'تعديل الموازنة';

  @override
  String get budgetAmount => 'مبلغ الموازنة';

  @override
  String get actualAmount => 'الفعلي';

  @override
  String get variance => 'الفرق';

  @override
  String get variancePercent => 'نسبة الفرق';

  @override
  String get budgetPeriod => 'فترة الموازنة';

  @override
  String get noBudgets => 'لا توجد موازنات بعد';

  @override
  String get budgetSaved => 'تم حفظ الموازنة';

  @override
  String get retireBudget => 'إيقاف الموازنة';

  @override
  String get confirmRetireBudget => 'الموازنة الموقوفة تحتفظ بسجلها وتخرج من القائمة النشطة. هل تريد المتابعة؟';

  @override
  String get budgetReport => 'الموازنة مقابل الفعلي';

  @override
  String get favorable => 'في الاتجاه الأفضل';

  @override
  String get unfavorable => 'في الاتجاه الأسوأ';

  @override
  String get budgetRetired => 'موقوفة';

  @override
  String get allocation => 'التوزيع';

  @override
  String get allocations => 'التوزيعات';

  @override
  String get allocated => 'الموزع';

  @override
  String get sourceAmount => 'مبلغ السطر';

  @override
  String get remainingToAllocate => 'المتبقي';

  @override
  String get splitAcrossCenters => 'توزيع على مراكز التكلفة';

  @override
  String get allocationMustReconcile => 'يجب أن يساوي مجموع التوزيعات مبلغ السطر تماماً.';

  @override
  String get duplicateCostCenter => 'مركز التكلفة هذا موجود بالفعل في التوزيع.';

  @override
  String get selectCostCenter => 'اختر مركز تكلفة';

  @override
  String get noAllocation => 'بدون مركز تكلفة';

  @override
  String get costCenterInactive => 'لا يمكن ترحيل قيود جديدة إلى مركز تكلفة موقوف.';

  @override
  String get addAllocation => 'إضافة مركز تكلفة';

  @override
  String get allocationTotal => 'إجمالي الموزع';

  @override
  String get deleteRecord => 'حذف';

  @override
  String get resultLabel => 'النتيجة';
  @override
  String get @@locale => 'ar';

  @override
  String get deleteAccountConfirm => 'سيتم حذف الحساب «{account}» نهائياً إن لم يكن له حركات أو حسابات فرعية. متابعة؟';

  @override
  String get deleteBranchConfirm => 'سيتم حذف الوحدة «{unit}». الوحدات ذات الحركات لا يمكن حذفها.';

  @override
  String get deleteBackupConfirm => 'سيتم حذف الملف «{file}» من الخادم نهائياً.';

  @override
  String get resetForCompany => 'ستتم إعادة ضبط بيانات «{company}».';

  @override
  String get resetConfirmBody => 'العودة تكون فقط باستعادة النسخة التي ستؤخذ الآن. اكتب كلمة المرور وكلمة {word} للمتابعة.';

  @override
  String get resetWordLabel => 'اكتب {word}';

  @override
  String get resetWrongWord => 'اكتب {word} تماماً كما هي للتأكيد.';

  @override
  String get resetDone => 'تم حذف بيانات الشركة. تحتوي «{file}» على البيانات القديمة.';

  @override
  String get rowDensity => 'كثافة الصفوف';

  @override
  String get densityCompact => 'مضغوط';

  @override
  String get densityNormal => 'عادي';

  @override
  String get densitySpacious => 'واسع';

  @override
  String get dragColumnHint => 'اسحب حافة العمود لتوسيعه';

  @override
  String get noRecords => 'لا توجد بيانات للعرض';

  @override
  String get resizeDialog => 'تغيير الحجم';

  @override
  String get maximize => 'تكبير';

  @override
  String get restore => 'استعادة الحجم';

  @override
  String get availableInBranch => 'المتاح في الفرع';

  @override
  String get branchStockHint => 'رصيد الفرع الفعلي، وهو نفس الرصيد الذي يتحقق منه الترحيل. لا تُحفظ أرصدة على مستوى المخزن.';

  @override
  String get stockNotVisible => 'عرض الكميات يتطلب صلاحية inventory.stock.read، لذلك لا تظهر.';

  @override
  String get useItem => 'اختيار';

  @override
  String get invoiceDiscount => 'خصم الفاتورة';

  @override
  String get discountBeforeTaxHint => 'يُطبق قبل الضريبة ويُوزع على البنود';

  @override
  String get noDiscount => 'بدون خصم';

  @override
  String get discountPercent => 'نسبة مئوية';

  @override
  String get discountAmount => 'مبلغ ثابت';

  @override
  String get discountPercentValue => 'النسبة %';

  @override
  String get discountAmountValue => 'المبلغ';

  @override
  String get lineDiscount => 'خصم البند';

  @override
  String get beforeDiscount => 'قبل الخصم';

  @override
  String get lineDiscounts => 'خصومات البنود';

  @override
  String get netLine => 'صافي البند';

  @override
  String get quotations => 'عروض الأسعار';

  @override
  String get quotation => 'عرض سعر';

  @override
  String get newQuotation => 'عرض سعر جديد';

  @override
  String get editQuotation => 'تعديل عرض السعر';

  @override
  String get quotationNumber => 'رقم عرض السعر';

  @override
  String get quotationDate => 'تاريخ عرض السعر';

  @override
  String get validUntil => 'صالح حتى';

  @override
  String get sent => 'مُرسل';

  @override
  String get accepted => 'مقبول';

  @override
  String get rejected => 'مرفوض';

  @override
  String get expired => 'منتهي';

  @override
  String get converted => 'محوّل إلى فاتورة';

  @override
  String get quotationTables => 'الجداول';

  @override
  String get addTable => 'إضافة جدول';

  @override
  String get tableTitle => 'عنوان الجدول';

  @override
  String get tableDiscount => 'خصم الجدول';

  @override
  String get moveUp => 'تحريك لأعلى';

  @override
  String get moveDown => 'تحريك لأسفل';

  @override
  String get removeTable => 'حذف الجدول';

  @override
  String get addQuotationLine => 'إضافة بند';

  @override
  String get countryOfOrigin => 'بلد المنشأ';

  @override
  String get origin => 'بلد المنشأ';

  @override
  String get grossValue => 'القيمة قبل الخصم';

  @override
  String get netValue => 'القيمة الصافية';

  @override
  String get finalTotal => 'الإجمالي النهائي';

  @override
  String get totalDiscounts => 'إجمالي الخصومات';

  @override
  String get quotationDiscount => 'خصم العرض';

  @override
  String get subtotalBeforeDiscount => 'الإجمالي قبل الخصم';

  @override
  String get quotationSummary => 'الملخص';

  @override
  String get tableSubtotal => 'إجمالي الجدول';

  @override
  String get termsAndConditions => 'الشروط والأحكام';

  @override
  String get notesLabel => 'ملاحظات';

  @override
  String get managerName => 'مدير الشركة';

  @override
  String get responsibleName => 'المسؤول';

  @override
  String get responsiblePhone => 'هاتف المسؤول';

  @override
  String get followUp => 'متابعة';

  @override
  String get followUpNote => 'ما تمت مناقشته';

  @override
  String get followUpRequired => 'اكتب ما تمت مناقشته قبل حفظ المتابعة.';

  @override
  String get statusHistory => 'السجل';

  @override
  String get sendQuotation => 'إصدار وتسجيل الإرسال';

  @override
  String get acceptQuotation => 'قبول';

  @override
  String get rejectQuotation => 'رفض';

  @override
  String get reviseQuotation => 'بدء إصدار جديد';

  @override
  String get convertToInvoice => 'تحويل إلى فاتورة';

  @override
  String get convert => 'تحويل';

  @override
  String get convertedInvoice => 'الفاتورة الناتجة';

  @override
  String get conversionConfirm => 'إنشاء فاتورة بيع مسودة من عرض السعر المقبول؟ لا يتم أي ترحيل أو حركة مخزون حتى يتم ترحيل الفاتورة بشكل منفصل.';

  @override
  String get conversionTaxNote => 'إجمالي عرض السعر قبل الضريبة. تُطبق الفاتورة قواعد ضريبة الشركة، لذا قد يكون إجماليها أعلى.';

  @override
  String get noQuotations => 'لا توجد عروض أسعار بعد';

  @override
  String get printPreview => 'معاينة الطباعة';

  @override
  String get downloadPdf => 'تنزيل PDF';

  @override
  String get quotationSaved => 'تم حفظ عرض السعر';

  @override
  String get quotationSent => 'تم إصدار عرض السعر وتسجيل إرساله';

  @override
  String get quotationAccepted => 'تم قبول عرض السعر';

  @override
  String get quotationRejected => 'تم رفض عرض السعر';

  @override
  String get quotationRevised => 'تم إنشاء مسودة إصدار جديد';

  @override
  String get quotationConverted => 'تم تحويل عرض السعر إلى فاتورة مسودة';

  @override
  String get quotationDeleted => 'تم حذف مسودة عرض السعر';

  @override
  String get deleteQuotationConfirm => 'حذف مسودة عرض السعر؟ لا تُحذف عروض الأسعار الصادرة أبداً.';

  @override
  String get quotationNeedsTable => 'أضف جدولاً واحداً على الأقل يحتوي على بند واحد.';

  @override
  String get filterStatus => 'الحالة';

  @override
  String get fromDate => 'من تاريخ';

  @override
  String get toDate => 'إلى تاريخ';

  @override
  String get quotationDraftHint => 'هذه مسودة: لا يتم ترحيل أي شيء ولا يتأثر المخزون. عند الإصدار يُثبت المحتوى الذي يستلمه العميل.';

  @override
  String get optional => 'اختياري';

  @override
  String get currency => 'العملة';

  @override
  String get clear => 'مسح';

  @override
  String get quotationFilterHint => 'تصفية حسب الحالة أو العميل أو التاريخ';

  @override
  String get documentSettings => 'المستندات وعروض الأسعار';

  @override
  String get maximumDiscount => 'أقصى نسبة خصم %';

  @override
  String get showTaxIdOnQuotations => 'طباعة الرقم الضريبي على عروض الأسعار';

  @override
  String get taxIdLegalNote => 'خيار عرض فقط. لا يحذف الرقم أبداً، ولا يمكنه تجاوز أي إلزام قانوني بإظهاره.';

  @override
  String get salesManagerName => 'مدير المبيعات';

  @override
  String get salesManagerPhone => 'هاتف مدير المبيعات';

  @override
  String get settingsSaved => 'تم حفظ الإعدادات';

  @override
  String get saveSettings => 'حفظ الإعدادات';

  @override
  String get readOnlySettings => 'تعديل هذه الإعدادات يتطلب صلاحية إدارة الشركة.';

  @override
  String get invalidSetting => 'أدخل قيمة بين 0 و100.';

  @override
  String get networkAccessTitle => 'الاتصال بالشبكة والوصول عن بُعد';

  @override
  String get networkUnavailable => 'لم يستجب الخادم لتقرير الشبكة. تحقق من أنه يعمل.';

  @override
  String get lanReachable => 'متاح على الشبكة المحلية';

  @override
  String get localOnly => 'هذا الجهاز فقط';

  @override
  String get serverStatus => 'الخادم';

  @override
  String get serverReady => 'جاهز، وقاعدة البيانات تعمل';

  @override
  String get databaseDown => 'قاعدة البيانات غير متاحة';

  @override
  String get listeningOn => 'يستمع على';

  @override
  String get localAddress => 'العنوان المحلي';

  @override
  String get networkAddress => 'عنوان الشبكة';

  @override
  String get wouldBeAddress => 'العنوان في حال التفعيل';

  @override
  String get addressCopied => 'تم نسخ العنوان';

  @override
  String get copyAddress => 'نسخ العنوان';

  @override
  String get lanNotEnabledHint => 'الخادم مرتبط بهذا الجهاز فقط، لذا لا تستجيب العناوين أدناه من جهاز آخر. للسماح لأجهزة الشبكة، اضبط HOST=0.0.0.0 في ملف إعدادات التثبيت ثم أعد تشغيل البرنامج.';

  @override
  String get lanFirewallHint => 'يجب أيضاً أن يسمح جدار حماية Windows للبرنامج على الشبكات الخاصة. منفذ قاعدة البيانات (5432) لا يُفتح أبداً: الأجهزة الأخرى تصل إلى البرنامج فقط، ويجب عليها تسجيل الدخول.';

  @override
  String get publicAddressTitle => 'العنوان العام (الإنترنت)';

  @override
  String get detectPublicAddress => 'اكتشاف';

  @override
  String get publicAddressHint => 'لا يُكتشف إلا عند الضغط على «اكتشاف». وجود عنوان عام لا يعني أن الخادم يمكن الوصول إليه من الإنترنت: قد يمنع الراوتر أو مزود الخدمة الاتصالات الواردة. للاستخدام عن بُعد يُفضّل استخدام VPN أو بوابة HTTPS؛ ولا تعرض قاعدة البيانات أبداً.';

  @override
  String get publicAddressChecking => 'جارٍ الفحص…';

  @override
  String get publicAddressUnavailable => 'تعذر اكتشاف العنوان العام.';

  @override
  String get publicAddressNotProof => 'العنوان وحده لا يثبت أن الاتصالات الواردة تصل إلى هذا الجهاز.';

  @override
  String get lastChecked => 'آخر تحقق';

  @override
  String get remove => 'إزالة';

  @override
  String get termsLibrary => 'الشروط المحفوظة';

  @override
  String get insertSavedTerms => 'إدراج شروط محفوظة';

  @override
  String get saveTermsToLibrary => 'حفظ الشروط في المكتبة';

  @override
  String get termsTitle => 'عنوان الشرط';

  @override
  String get termsBody => 'نص الشروط';

  @override
  String get noSavedTerms => 'لا توجد شروط محفوظة بعد. اكتب الشروط أدناه واحفظها لإعادة استخدامها.';

  @override
  String get termsSaved => 'تم حفظ الشروط في المكتبة';

  @override
  String get manageSavedTerms => 'إدارة الشروط المحفوظة';

  @override
  String get termsInserted => 'تم إدراج الشروط المحفوظة. يمكنك تعديل هذه النسخة بحرية.';

  @override
  String get removeSavedTerm => 'إزالة هذا الشرط المحفوظ؟ تحتفظ المستندات التي استخدمته بنسختها الخاصة.';
  @override
  String get itemCode => 'كود الصنف';

  @override
  String get subject => 'الموضوع';

  @override
  String get subjectHint => 'عنوان هذا العرض، يُطبع فوق اسم العميل.';

  @override
  String get showTaxNumberOnOffer => 'طباعة الرقم الضريبي للشركة على هذا العرض';

  @override
  String get showTaxNumberOnOfferHint => 'إعداد الشركة مجرد افتراضي؛ يحتفظ كل عرض باختياره الخاص.';

  @override
  String get quotationColumns => 'أعمدة البنود';

  @override
  String get columnLayout => 'تخطيط الأعمدة';

  @override
  String get columnLayoutHint => 'اختر أعمدة هذا العرض وأعد تسميتها وترتيبها وتحديد عرضها.';

  @override
  String get columnLabelEn => 'العنوان بالإنجليزية';

  @override
  String get columnLabelAr => 'العنوان بالعربية';

  @override
  String get columnWidth => 'العرض';

  @override
  String get columnNumeric => 'رقمي';

  @override
  String get tableColumns => 'أعمدة هذا الجدول';

  @override
  String get builtinColumns => 'أعمدة جاهزة';

  @override
  String get columnType => 'نوع العمود';

  @override
  String get columnTypeText => 'نص';

  @override
  String get columnTypeNumber => 'رقم';

  @override
  String get columnTypeQuantity => 'كمية';

  @override
  String get columnTypePrice => 'سعر';

  @override
  String get columnTypePercent => 'نسبة مئوية';

  @override
  String get columnNameRequired => 'أعطِ العمود اسمًا بالعربية أو بالإنجليزية.';

  @override
  String get tablePreview => 'معاينة الجدول';

  @override
  String get addCustomColumn => 'عمود مخصص…';

  @override
  String get columnKey => 'مفتاح العمود';

  @override
  String get columnAlreadyExists => 'يوجد عمود بهذا المفتاح بالفعل.';

  @override
  String get addColumn => 'إضافة عمود';

  @override
  String get removeColumn => 'حذف العمود';

  @override
  String get columnTemplate => 'تخطيط محفوظ';

  @override
  String get templateName => 'اسم التخطيط الجديد';

  @override
  String get saveColumnTemplate => 'حفظ كتخطيط';

  @override
  String get templateSaved => 'تم حفظ التخطيط في المكتبة';

  @override
  String get keepOneColumnVisible => 'أبقِ عمودًا واحدًا ظاهرًا على الأقل.';
  @override
  String get printedOnOffer => 'مطبوع';

  @override
  String get notPrintedOnOffer => 'غير مطبوع';
  @override
  String get perWarehouse => 'المخازن';

  @override
  String get unassignedWarehouse => 'غير مُخصّص';


  @override
  String get errorDialogTitle => 'حدث خطأ';

  @override
  String get warningDialogTitle => 'تنبيه';

  @override
  String get okAction => 'حسنًا';

  @override
  String get errorGenericBody => 'لم تكتمل العملية بسبب خطأ غير متوقع. لم يُحفظ أي تغيير. حاول مرة أخرى، وإذا تكرر الخطأ فأبلغ مسؤول النظام.';

  @override
  String get errorInvalidInputBody => 'البيانات المرسلة غير صالحة، لذلك لم تُنفّذ العملية. راجع الحقول المدخلة وحاول مرة أخرى.';

  @override
  String get errorNotFoundBody => 'لم يتم العثور على السجل المطلوب. ربما حُذف أو نُقل، أو لا تملك صلاحية الوصول إليه. أعد تحميل الصفحة وحاول مرة أخرى.';

  @override
  String get errorPermissionBody => 'ليس لديك صلاحية لتنفيذ هذا الإجراء. راجع مسؤول النظام إذا كنت تحتاج إليها.';

  @override
  String get errorConflictBody => 'تم تعديل هذا السجل من مستخدم آخر أثناء عملك عليه، لذلك لم يُحفظ التغيير. أعد تحميل الصفحة لرؤية أحدث نسخة ثم كرّر المحاولة.';

  @override
  String get errorServerBody => 'حدث خطأ في الخادم أثناء تنفيذ العملية، ولم يُحفظ التغيير. حاول مرة أخرى بعد قليل، وإذا تكرر الخطأ فأبلغ مسؤول النظام.';

  @override
  String backupSavedIn(Object directory) {
    return 'مكان الحفظ: \$directory';
  }

  @override
  String get accumulatedAccount => 'حساب مجمع الإهلاك';

  @override
  String get accumulatedDepreciation => 'مجمع الإهلاك';

  @override
  String get activateAsset => 'تفعيل (ترحيل الاقتناء)';

  @override
  String get assetAccount => 'حساب الأصل';

  @override
  String get assetCategory => 'التصنيف';

  @override
  String get assetCode => 'كود الأصل';

  @override
  String get assetCost => 'التكلفة';

  @override
  String get assetDetails => 'تفاصيل الأصل';

  @override
  String get assetLocation => 'الموقع';

  @override
  String get bookValue => 'القيمة الدفترية';

  @override
  String get confirmActivateAsset => 'التفعيل يُرحّل قيد الاقتناء (مدين الأصل / دائن التمويل). متابعة؟';

  @override
  String get confirmDisposeAsset => 'الاستبعاد يخرج الأصل من الدفاتر ويُرحّل نتيجته. متابعة؟';

  @override
  String get depreciationExpenseAccount => 'حساب مصروف الإهلاك';

  @override
  String get depreciationPeriod => 'الشهر (YYYY-MM)';

  @override
  String get depreciationSchedule => 'جدول الإهلاك';

  @override
  String get disposalDate => 'تاريخ الاستبعاد';

  @override
  String get disposalProceeds => 'قيمة البيع';

  @override
  String get disposeAsset => 'استبعاد الأصل';

  @override
  String get editAsset => 'تعديل الأصل';

  @override
  String get fixedAssets => 'الأصول الثابتة';

  @override
  String get fundingAccount => 'حساب التمويل';

  @override
  String get gainLossAccount => 'حساب الربح/الخسارة';

  @override
  String get inServiceDate => 'تاريخ بدء الاستخدام';

  @override
  String get newAsset => 'أصل جديد';

  @override
  String get noAssets => 'لا توجد أصول ثابتة بعد.';

  @override
  String get proceedsAccount => 'حساب التحصيل';

  @override
  String get purchaseDate => 'تاريخ الشراء';

  @override
  String get runDepreciation => 'تشغيل الإهلاك';

  @override
  String get salvageValue => 'القيمة المتبقية';

  @override
  String get usefulLifeMonths => 'العمر الإنتاجي (شهور)';
}
