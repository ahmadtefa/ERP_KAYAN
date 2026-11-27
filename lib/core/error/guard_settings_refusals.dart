/// Reviewed sentences for access guards, exports, cheques, setup, print and
/// company settings, licences and warehouse ledger refusals: what happened and
/// how to fix it, `[Arabic, English]`.
const Map<String, List<String>> guardSettingsRefusals = {
  'BRANCH_OUTSIDE_ASSIGNMENT': [
    'هذا الفرع خارج الفروع المخصصة لك. اختر فرعًا من فروعك. لم يُحفظ شيء.',
    'This branch is outside your assignment. Choose one of your branches. Nothing was saved.',
  ],
  'WAREHOUSE_OUTSIDE_ASSIGNMENT': [
    'هذا المخزن خارج الفروع المخصصة لك. اختر مخزنًا من فروعك. لم يُحفظ شيء.',
    'This warehouse is outside your assignment. Choose a warehouse of your branches. Nothing was saved.',
  ],
  'SUPER_ADMIN_ONLY': [
    'هذا الإجراء للمدير الأعلى للبرنامج فقط. اطلب ذلك منه. لم يتغير شيء.',
    'Only the program administrator can do this. Ask the administrator to do it. Nothing changed.',
  ],
  'PERMISSION_MISSING': [
    'لا تملك الصلاحية اللازمة لهذا الإجراء. اطلبها من المدير ثم أعد المحاولة. لم يتغير شيء.',
    'You do not have the permission this action needs. Ask an administrator for it and try again. Nothing changed.',
  ],
  'MASTER_BACKUP_TYPE_UNKNOWN': [
    'نوع نسخة البيانات الأساسية غير معروف. اختر نوعًا من القائمة. لم يتغير شيء.',
    'The master-data backup type is not known. Choose a type from the list. Nothing changed.',
  ],
  'MASTER_BACKUP_RESTORE_PERMISSION': [
    'استعادة هذا النوع تحتاج صلاحيتين معًا. اطلبهما من المدير ثم أعد المحاولة. لم يتغير شيء.',
    'Restoring this kind needs two permissions together. Ask an administrator for both and try again. Nothing changed.',
  ],
  'BUDGET_REPORT_RESTRICTED': [
    'أرقام الموازنة على مستوى الشركة لمديري الشركة والمالية فقط. اطلب التقرير منهم أو اختر فرعك. لم يتغير شيء.',
    'Company-wide budget figures are for company and finance managers only. Ask them for the report or choose your branch. Nothing changed.',
  ],
  'CREDIT_APPROVAL_UNAVAILABLE': [
    'اعتماد الائتمان غير متاح في هذا الإصدار. لم يتغير شيء.',
    'Credit approval is not available in this version. Nothing changed.',
  ],
  'CHEQUE_DIRECTION_INVALID': [
    'اتجاه الشيك يجب أن يكون مستلَمًا أو مُصدَرًا. اختر أحدهما ثم أعد المحاولة. لم يتغير شيء.',
    'The cheque direction must be received or issued. Choose one and try again. Nothing changed.',
  ],
  'CHEQUE_STATUS_INVALID': [
    'حالة الشيك المختارة غير صالحة. اخترها من القائمة ثم أعد المحاولة. لم يتغير شيء.',
    'The chosen cheque status is not valid. Choose it from the list and try again. Nothing changed.',
  ],
  'SETUP_CLOSED': [
    'التثبيت يحتوي بيانات شركة أو مستخدمين بالفعل، فالإعداد الأول مغلق. استخدم المسار المعتمد لإضافة شركة أو استعادة بيانات. لم يتغير شيء.',
    'This installation already has company or user data, so the first setup is closed. Use the approved way to add a company or restore data. Nothing changed.',
  ],
  'PRINT_SETTINGS_TOO_MANY': [
    'عدد إعدادات الطباعة في الطلب أكبر من المسموح. احفظ على دفعات أصغر. لم يُحفظ شيء.',
    'There are too many print settings in one request. Save in smaller batches. Nothing was saved.',
  ],
  'PRINT_SETTINGS_DUPLICATE': [
    'نوع الطباعة مكرر في الطلب. أبقِ إعدادًا واحدًا لكل نوع ثم احفظ. لم يُحفظ شيء.',
    'A print type is listed twice. Keep one setting per type and save. Nothing was saved.',
  ],
  'VALUATION_METHOD_UNSUPPORTED': [
    'طريقة تقييم المخزون المختارة غير مدعومة في هذا التثبيت. اختر طريقة من القائمة. لم يُحفظ شيء.',
    'The chosen stock valuation method is not supported on this installation. Choose a method from the list. Nothing was saved.',
  ],
  'VALUATION_METHOD_LOCKED': [
    'لا تتغير طريقة تقييم المخزون ما دام في المخزن رصيد، حتى لا تختلف الأرقام قبل التغيير وبعده. صفّر الرصيد أو اتركها كما هي. لم يُحفظ شيء.',
    'The valuation method cannot change while there is stock on hand, so figures before and after do not disagree. Clear the stock or leave it as it is. Nothing was saved.',
  ],
  'STOCK_SHORT_IN_WAREHOUSE': [
    'الكمية المتاحة في المخزن المختار أقل من المطلوبة. اكتب كمية أقل أو استلم الرصيد أولًا. لم يتغير شيء.',
    'The selected warehouse holds less than the quantity asked for. Enter a smaller quantity or receive the stock first. Nothing changed.',
  ],
  'LEDGER_REBUILD_NEEDS_WAREHOUSE': [
    'إعادة بناء الأرصدة تحتاج تحديد مخزن. اختر المخزن ثم أعد المحاولة. لم يتغير شيء.',
    'Rebuilding balances needs a warehouse. Choose the warehouse and try again. Nothing changed.',
  ],
  'WAREHOUSE_FIELD_REQUIRED': [
    'حقل مطلوب في بيانات المخزن ناقص. أكمل الحقول المطلوبة ثم احفظ. لم يُحفظ شيء.',
    'A required warehouse field is missing. Fill the required fields and save. Nothing was saved.',
  ],
  'AUDIT_PURGE_NOT_ALLOWED': [
    'لا يُنفَّذ تنظيف سجل التدقيق إلا من عمليات مسموح لها بذلك. نفّذه من الشاشة المعتمدة. لم يتغير شيء.',
    'An audit purge can run only from the operations allowed to do it. Run it from the approved screen. Nothing changed.',
  ],
  'USER_CHANGED_RELOAD': [
    'تغيّر المستخدم المسجَّل دخوله. حدّث الصفحة وأعد المحاولة. لم يتغير شيء.',
    'The signed-in user changed. Reload the page and try again. Nothing changed.',
  ],
  'LICENCE_SUPER_ADMIN_ONLY': [
    'تطبيق مفتاح الترخيص يغيّر التثبيت كله، فيقوم به المدير الأعلى فقط. اطلب ذلك منه. لم يتغير شيء.',
    'Applying a licence key changes the whole installation, so only a super administrator may do it. Ask one to do it. Nothing changed.',
  ],
  'LICENCE_ID_INVALID': [
    'معرّف الترخيص غير صالح. اخترْه من قائمة التراخيص ثم أعد المحاولة. لم يتغير شيء.',
    'The licence identifier is not valid. Choose it from the licences list and try again. Nothing changed.',
  ],
};
