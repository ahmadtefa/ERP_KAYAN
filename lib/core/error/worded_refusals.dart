/// Reviewed sentences (wording drafted by the second assistant, checked against
/// the agreed format and against each original sentence): what happened and how
/// to fix it, `[Arabic, English]`.
const Map<String, List<String>> wordedRefusals = {
  'APPROVALS_CHAIN_FOR_E001': [
    'تعذّر إعداد سلسلة الاعتمادات لهذه العملية. اطلب من مدير النظام مراجعة إعدادات الاعتمادات، ثم أعد المحاولة. لم يتغير شيء.',
    'The approval chain for this operation could not be set up. Ask the system administrator to review the approval settings, then try again. Nothing changed.',
  ],
  'BRANCH_WRITE_CAN_ACTIVATE_E004': [
    'السجل المطلوب غير موجود. حدّث الصفحة وتحقق من الاختيار، ثم أعد المحاولة.',
    'The requested record was not found. Refresh the page, check your selection, and try again.',
  ],
  'PERMISSIONS_CAN_ACTIVATE_E005': [
    'تعذّر التعرف على تسجيل دخولك، فلم تُنفّذ العملية. سجّل الدخول مرة أخرى ثم أعد المحاولة.',
    'Your sign-in could not be recognized, so the operation did not run. Sign in again, then try again.',
  ],
  'SUPER_ADMIN_CAN_ACTIVATE_E007': [
    'هذه العملية متاحة لمدير البرنامج فقط (حساب المسؤول الأعلى). سجّل الدخول بحساب مدير البرنامج ثم أعد المحاولة.',
    'Only the program administrator (the super admin account) can do this. Sign in with that account and try again.',
  ],
  'NORMALIZE_PICTURE_X_E011': [
    'تعذّر فتح الصورة؛ قد يكون الملف تالفًا. اختر ملف PNG أو JPEG أو WebP سليمًا ثم أعد المحاولة.',
    'The image could not be opened; the file may be damaged. Choose a valid PNG, JPEG or WebP file and try again.',
  ],
  'NORMALIZE_PICTURE_X_E013': [
    'تعذّر ضغط الصورة. اختر صورة صالحة وحاول مرة أخرى.',
    'The image could not be compressed. Choose a valid image and try again.',
  ],
  'NORMALIZE_PICTURE_X_E014': [
    'بقيت الصورة أكبر من الحجم المسموح حتى بعد الضغط. اختر صورة أصغر ثم أعد المحاولة.',
    'The image is still larger than the allowed size after compression. Choose a smaller image and try again.',
  ],
  'CHART_OF_ACCOUNTS_SUGGEST_CODE_E027': [
    'لا يمكن إنشاء حساب فرعي هنا: الحساب ذو الثمانية أرقام هو المستوى الأخير، أو لم يتبقَّ رمز متاح تحت هذا الحساب الأب. اختر حسابًا أبًا آخر أو رمزًا مختلفًا.',
    'A sub-account cannot be created here: an eight-digit account is the last level, or no code is left under this parent account. Choose another parent account or a different code.',
  ],
  'OPENING_BALANCES_REVERSE_E034': [
    'لا يمكن عكس رصيد افتتاحي إلا بعد ترحيله. رحّل الرصيد أولًا إن كنت تريد عكسه.',
    'Only a posted opening balance can be reversed. Post the balance first if you need to reverse it.',
  ],
  'BACKUP_PARSE_E038': [
    'هذا الملف هو أرشيف قاعدة البيانات وليس ملف نسخة احتياطية لبيانات الشركة. يحتوي قاعدة البيانات فقط ولا يشمل الملفات والترخيص، والاستعادة الكاملة متوقفة حاليًا لحماية البيانات. احتفظ بالملف وتواصل مع الدعم.',
    'This file is a database archive, not a company data backup file. It contains only the database and does not include files or the licence; full restore is currently disabled to protect your data. Keep the file and contact support.',
  ],
  'RESTORE_AUTHORITY_X_E093': [
    'تغيّرت صلاحية الاستعادة أثناء الانتظار. اطلب من مدير النظام إعادة منح الصلاحية، ثم أعد المحاولة. لم تتغير أي بيانات.',
    'The restore permission changed while waiting. Ask the system administrator to grant the permission again, then try again. No data was changed.',
  ],
  'SYSTEM_RESTORE_RESTORE_E100': [
    'لم تُكتب كلمة التأكيد. اكتب كلمة RESTORE لتأكيد أنك تريد استبدال كل البيانات.',
    'The confirmation word is missing. Type the word RESTORE to confirm that you want to replace all data.',
  ],
  'SYSTEM_RESTORE_RESTORE_E102': [
    'هذا الملف أرشيف قاعدة بيانات فقط وليس نسخة نظام كاملة. استخدم قسم استعادة أرشيف قاعدة البيانات.',
    'This file is a database-only archive, not a complete system backup. Use the database archive restore section instead.',
  ],
  'ITEMS_FIND_BY_BARCODE_E124': [
    'لا يوجد صنف أو وحدة تحمل هذا الباركود. تحقق من الباركود وأعد المحاولة، أو أضفه إلى الصنف أولًا.',
    'No item or unit carries this barcode. Check the barcode and try again, or add it to the item first.',
  ],
  'ITEMS_CREATE_E125': [
    'يجب إدخال اسم للصنف بالعربية أو بالإنجليزية. أدخل اسمًا، ثم أعد المحاولة.',
    'An Arabic or English item name is required. Enter a name, then try again.',
  ],
  'ITEMS_CREATE_E126': [
    'لا يمكن تعيين رصيد افتتاحي لصنف غير متتبَّع في المخزون. فعّل تتبع المخزون للصنف أو احذف الكمية الافتتاحية.',
    'Opening stock cannot be set on an item that is not tracked in stock. Enable stock tracking for the item, or remove the opening quantity.',
  ],
  'ITEMS_CREATE_E127': [
    'يجب إدخال الكمية الافتتاحية وتكلفة الوحدة الافتتاحية معًا. أدخل كليهما أو احذف كليهما.',
    'The opening quantity and the opening unit cost must be entered together. Enter both or remove both.',
  ],
  'ITEMS_CREATE_E128': [
    'اختر الفرع قبل إضافة الرصيد الافتتاحي. حدد الفرع، ثم أعد المحاولة.',
    'Select a branch before adding opening stock. Choose the branch, then try again.',
  ],
  'ITEMS_ASSERT_BASE_UNIT_MAY_CHANGE_E131': [
    'لا يمكن تغيير وحدة الأساس لصنف مسجَّلة عليه حركات ورصيد قائم، لأن ذلك سيغيّر معنى الكميات القديمة دون تغيير أرقامها. أضف وحدة تعبئة جديدة بدلًا من ذلك، أو صحّح الكميات بتسوية جرد مرحَّلة.',
    'The base unit of an item with recorded movements and existing balances cannot be changed, because it would change the meaning of old quantities without changing their numbers. Add a new packing unit instead, or correct the quantities with a posted stock adjustment.',
  ],
  'STOCK_DOCUMENTS_CREATE_E133': [
    'مستند الإعدام يتطلب سببًا. أدخل السبب قبل الحفظ.',
    'A write-off document needs a reason. Enter the reason before saving.',
  ],
  'STOCK_DOCUMENTS_CREATE_E134': [
    'مستند المخزون يحتاج سطرًا واحدًا على الأقل. أضف سطرًا، ثم أعد المحاولة.',
    'A stock document needs at least one line. Add a line, then try again.',
  ],
  'STOCK_DOCUMENTS_CREATE_E135': [
    'الإعدام يُخرج البضاعة من المخزن، لذا يجب أن تكون كميته سالبة. أدخل الكمية بالسالب، ثم أعد المحاولة.',
    'A write-off removes stock from the warehouse, so its quantity must be negative. Enter the quantity as a negative number, then try again.',
  ],
  'STOCK_DOCUMENTS_CREATE_E136': [
    'التحويل يحتاج الفرع الذي تخرج منه البضاعة. حدد فرع المصدر، ثم أعد المحاولة.',
    'A transfer needs the branch the stock leaves. Select the source branch, then try again.',
  ],
  'STOCK_DOCUMENTS_CREATE_E137': [
    'التحويل يحتاج فرعين مختلفين، أو مخزنين مختلفين في الفرع نفسه. عدّل المصدر والوجهة، ثم أعد المحاولة.',
    'A transfer needs two different branches, or two different warehouses in the same branch. Adjust the source and destination, then try again.',
  ],
  'STOCK_DOCUMENTS_CREATE_E138': [
    'التحويل يحتاج مخزنين مختلفين. اختر مخزنين مختلفين، ثم أعد المحاولة.',
    'A transfer needs two different warehouses. Select two different warehouses, then try again.',
  ],
  'STOCK_DOCUMENTS_APPROVE_E139': [
    'الاعتماد مطلوب لمستند الإعدام فقط. رحّل هذا المستند مباشرة دون اعتماد.',
    'Only a write-off needs an approval. Post this document directly without approval.',
  ],
  'STOCK_DOCUMENTS_POST_E141': [
    'رحّل شخص آخر هذا المستند للتو. حدّث الصفحة للاطلاع على أحدث نسخة.',
    'This document has just been posted by someone else. Refresh the page to see the latest version.',
  ],
  'STOCK_DOCUMENTS_POST_E142': [
    'يجب اعتماد مستند الإعدام قبل ترحيله. اعتمده أولًا، ثم رحّله.',
    'A write-off must be approved before it is posted. Approve it first, then post it.',
  ],
  'STOCK_DOCUMENTS_POST_E143': [
    'الدفعة لا تحمل الكمية المطلوبة. خفّض الكمية أو اختر دفعة أخرى، ثم أعد المحاولة.',
    'The lot does not hold enough for that quantity. Reduce the quantity or choose another lot, then try again.',
  ],
  'STOCK_DOCUMENTS_REVERSE_E144': [
    'لا يمكن عكس مستند مخزون إلا بعد ترحيله. رحّل المستند أولًا، ثم اعكسه.',
    'Only a posted stock document can be reversed. Post it first, then reverse it.',
  ],
  'STOCK_DOCUMENTS_REVERSE_E145': [
    'عدّل شخص آخر هذا المستند للتو. حدّث الصفحة، وراجع أحدث نسخة، ثم أعد المحاولة.',
    'This document has just been changed by someone else. Refresh the page, review the latest version, and try again.',
  ],
  'STOCK_DOCUMENTS_REVERSE_E146': [
    'حركات المخزون الأصلية لا تطابق المستند، فلا يمكن عكسه تلقائيًا. صحّح الوضع بتسوية مخزون يدوية بدلًا من ذلك.',
    'The original stock movements do not match the document, so it cannot be reversed automatically. Correct it with a manual stock adjustment instead.',
  ],
  'STOCK_DOCUMENTS_MOVE_LOTS_E147': [
    'تغيّرت الدفعة أثناء ترحيل التحويل. أعد المحاولة.',
    'The lot changed while the transfer was being posted. Try again.',
  ],
  'STOCK_TAKES_ADD_LOCATION_E148': [
    'لم تختر الصنف أو موقع التخزين. اختر الاثنين ثم أعد المحاولة.',
    'The item or the storage location is missing. Choose both and try again.',
  ],
  'STOCK_TAKES_RECORD_E150': [
    'الكمية المعدودة لا يمكن أن تكون سالبة. أدخل صفرًا أو رقمًا موجبًا.',
    'A counted quantity cannot be negative. Enter zero or a positive number.',
  ],
  'STOCK_BALANCES_E153': [
    'إجماليات المخزون على مستوى الفرع غير متاحة مع تقييد صلاحيات المستودعات. استخدم عرض أرصدة المستودعات بدلًا من ذلك.',
    'Branch-wide stock totals are unavailable with restricted warehouse access. Use the warehouse balance view instead.',
  ],
  'UNIT_INPUT_X_E156': [
    'يجب أن تُدخل الوحدات على هيئة قائمة. صحّح بيانات الوحدات، ثم أعد المحاولة.',
    'The units must be entered as a list. Correct the units data, then try again.',
  ],
  'UNIT_INPUT_X_E157': [
    'كل سطر وحدة يجب أن يحتوي بيانات مكتملة. راجع أسطر الوحدات وأكملها.',
    'Every unit row must contain complete data. Review the unit rows and complete them.',
  ],
  'UNIT_INPUT_X_E158': [
    'كل وحدة تحتاج اسمًا. أدخل اسمًا لكل وحدة، ثم أعد المحاولة.',
    'Every unit needs a name. Enter a name for each unit, then try again.',
  ],
  'UNIT_INPUT_X_E164': [
    'معامل الوحدة الأساسية يجب أن يكون 1. اضبطه على 1، ثم أعد المحاولة.',
    'The base unit factor must be 1. Set it to 1, then try again.',
  ],
  'WAREHOUSE_ACCESS_SET_FOR_USER_E165': [
    'لا يمكن لمسؤول الفرع إزالة آخر قيد للمستودعات. يجب أن يبقى قيد واحد على الأقل.',
    'A branch manager cannot remove the last warehouse restriction. At least one restriction must remain.',
  ],
  'INVOICE_DISCOUNT_X_E166': [
    'اختر إما خصمًا بنسبة مئوية أو خصمًا بمبلغ ثابت، لا كليهما. احذف أحدهما، ثم أعد المحاولة.',
    'Choose either a percentage discount or a fixed discount, not both. Remove one of them, then try again.',
  ],
  'INVOICE_DISCOUNT_X_E167': [
    'نسبة الخصم يجب أن تكون بين 0 و100. أدخل قيمة ضمن هذا النطاق.',
    'The discount percentage must be between 0 and 100. Enter a value in that range.',
  ],
  'INVOICE_DISCOUNT_X_E168': [
    'مبلغ الخصم لا يمكن أن يتجاوز إجمالي الفاتورة قبل الخصم. خفّض الخصم، ثم أعد المحاولة.',
    'The discount amount cannot exceed the invoice subtotal. Reduce the discount, then try again.',
  ],
  'INVOICE_DISCOUNT_X_E169': [
    'الخصم بنسبة مئوية يتطلب إجمالي غير صفري. أضف مبالغ إلى الفاتورة أولًا، أو استخدم خصمًا بمبلغ ثابت.',
    'A percentage discount requires a non-zero subtotal. Add amounts to the invoice first, or use a fixed discount.',
  ],
  'RETURNS_TAKE_BACK_FROM_RECEIPT_E177': [
    'تغيّرت الدفعة أثناء الترحيل. أعد المحاولة.',
    'The lot changed while posting. Try again.',
  ],
  'RETURNS_UNDO_RETURN_MOVEMENTS_E178': [
    'تغيّرت الدفعة أثناء العكس. أعد المحاولة.',
    'The lot changed during the reversal. Try again.',
  ],
  'RETURNS_POST_SALES_RETURN_E179': [
    'دفعة الفاتورة الأصلية لم تعد موجودة. اختر الدفعة التي سيُرجَع منها، ثم أعد المحاولة.',
    'The lot of the original invoice no longer exists. Choose the lot the return is taken from, then try again.',
  ],
  'CUSTOMER_CREDIT_APPROVE_PERIOD_E180': [
    'لا يجوز لمنشئ الفاتورة أن يوافق على تجاوزها لمدة السداد. اطلب من شخص آخر مخوَّل الموافقة.',
    'The person who created the invoice cannot approve its payment-period exception. Ask another authorized person to approve it.',
  ],
  'CUSTOMER_CREDIT_APPROVE_E181': [
    'لا يجوز لمنشئ الفاتورة أن يوافق على تجاوزها لحد الائتمان. اطلب من شخص آخر مخوَّل الموافقة.',
    'The person who created the invoice cannot approve its credit exception. Ask another authorized person to approve it.',
  ],
  'QUOTATION_BACKGROUND_MEDIA_DESTROY_E182': [
    'يجب أن يكون حجم الملف بين 1 بايت و4 ميجابايت. اختر ملفًا صالحًا بحجم أصغر.',
    'The file must be between 1 byte and 4 megabytes. Choose a valid, smaller file.',
  ],
  'QUOTATION_BACKGROUND_MEDIA_DESTROY_E183': [
    'نوع الملف غير مدعوم. اختر ملف PDF أو صورة PNG أو JPG.',
    'The file type is not supported. Choose a PDF file or a PNG or JPG image.',
  ],
  'QUOTATION_BACKGROUND_MEDIA_DESTROY_E184': [
    'تعذّرت قراءة ملف PDF؛ فقد يكون مشفرًا أو تالفًا. استخدم ملف PDF سليمًا.',
    'The PDF file could not be read; it may be encrypted or damaged. Use a valid PDF file.',
  ],
  'QUOTATION_BACKGROUND_MEDIA_DESTROY_E185': [
    'ملف PDF لا يحتوي أي صفحات. اختر ملف PDF يحتوي صفحات.',
    'The PDF file contains no pages. Choose a PDF that has pages.',
  ],
  'QUOTATION_BACKGROUND_MEDIA_DESTROY_E187': [
    'تعذّر عرض صفحة PDF. جرّب حفظها مرة أخرى من البرنامج الأصلي، أو استخدم صورة.',
    'The PDF page could not be displayed. Try saving it again from the original program, or use an image.',
  ],
  'QUOTATION_BACKGROUND_MEDIA_DESTROY_E188': [
    'تعذّرت قراءة الصورة. استخدم ملف PNG أو JPG سليمًا.',
    'The image could not be read. Use a valid PNG or JPG file.',
  ],
  'QUOTATION_BACKGROUND_MEDIA_DESTROY_E189': [
    'الصورة صغيرة جدًا لتكون خلفية. استخدم صورة بعرض 200 بكسل على الأقل.',
    'The image is too small to be a background. Use an image at least 200 pixels wide.',
  ],
  'QUOTATIONS_COLUMN_DATA_E192': [
    'يوجد عمود بلا اسم. أعطِ كل عمود اسمًا قبل الحفظ.',
    'A column has no name. Name every column before saving.',
  ],
  'QUOTATIONS_COLUMN_DATA_E194': [
    'اسم أحد الأعمدة يحتوي محرفًا غير صالح. احذف ذلك المحرف من الاسم.',
    'A column name contains an invalid character. Remove that character from the name.',
  ],
  'QUOTATIONS_COLUMN_DATA_E196': [
    'أبقِ عمودًا واحدًا ظاهرًا على الأقل. أظهر عمودًا واحدًا على الأقل.',
    'Keep at least one column visible. Show at least one column.',
  ],
  'SALES_INVOICES_REVERSE_E204': [
    'لا يمكن عكس فاتورة صنف يتطلب دفعات لأن حركات الدفعات الأصلية غير مسجلة. صحّح الوضع بمرتجع أو تسوية بدلًا من العكس.',
    'A lot-controlled invoice cannot be reversed because its original lot movements are missing. Correct it with a return or an adjustment instead.',
  ],
  'SALES_INVOICES_REVERSE_E205': [
    'إحدى الدفعات الأصلية لم تعد موجودة، فلا يمكن إعادة كميتها. اختر دفعة أخرى أو تواصل مع الدعم.',
    'An original lot no longer exists, so its quantity cannot be given back. Choose another lot or contact support.',
  ],
  'PERMISSIONS_CAN_ACTIVATE_E006': [
    'ليس لديك الصلاحية المطلوبة لتنفيذ هذا الإجراء ({permission}). اطلب من مدير النظام منح هذه الصلاحية لدورك من شاشة الأدوار والصلاحيات. لم يتغير شيء.',
    'You do not have the required permission for this action ({permission}). Ask the system administrator to grant this permission to your role from the Roles and Permissions screen. Nothing changed.',
  ],
  'STOCK_LEDGER_APPLY_BRANCH_E024': [
    'الرصيد غير كافٍ في هذا الفرع: المتاح {available} والمطلوب {requested}. خفّض الكمية أو انقل رصيدًا إلى الفرع، ثم أعد المحاولة. لم يتغير شيء.',
    'There is not enough stock in this branch: {available} available and {requested} requested. Reduce the quantity or transfer stock into the branch, then try again. Nothing changed.',
  ],
  'OPENING_BALANCES_CREATE_E031': [
    'الرصيد الافتتاحي يحتاج عددًا من الأسطر بين {minimum} و1,000 سطر. عدّل عدد الأسطر ليقع ضمن هذا الحد، ثم أعد المحاولة.',
    'An opening balance needs between {minimum} and 1,000 lines. Adjust the number of lines to fall within this range, then try again.',
  ],
  'OPENING_BALANCES_POST_E033': [
    'يوجد لهذا الفرع رصيد افتتاحي مسجل بالفعل ({documentNumber} بتاريخ {date}). إن لزم، احذف الرصيد الحالي أو اطرحه قبل ترحيل رصيد جديد، حتى لا تتضاعف بداية الدفاتر.',
    'This branch already has a posted opening balance ({documentNumber}, dated {date}). If needed, delete or reverse the existing balance before posting a new one, so the start of the books is not doubled.',
  ],
  'OPENING_BALANCES_PREPARE_LINES_E035': [
    'السطر {line}: صنف المخزون يحتاج كمية أكبر من صفر. أدخل كمية صحيحة أو احذف السطر، ثم أعد المحاولة.',
    'Line {line}: a stock item needs a quantity greater than zero. Enter a valid quantity or remove the line, then try again.',
  ],
  'FULL_BACKUP_ASSERT_CUSTOM_DUMP_E083': [
    'الملف المحدد {label} هو نسخة احتياطية لبيانات الشركة بصيغة JSON وليس أرشيف قاعدة بيانات. لاستعادته، استخدم قسم استعادة بيانات الشركة.',
    'The selected file {label} is a company data backup in JSON format, not a database archive. To restore it, use the company data restore section.',
  ],
  'FULL_BACKUP_ASSERT_CUSTOM_DUMP_E084': [
    'الملف المحدد {label} ليس أرشيفًا صالحًا لقاعدة البيانات. اختر ملف أرشيف صالحًا أُنشئ بأداة النسخ الاحتياطي.',
    'The selected file {label} is not a valid database archive. Choose a valid archive file created by the backup tool.',
  ],
  'IMPORT_UPLOAD_E116': [
    'ليس لديك صلاحية تعديل السجلات الموجودة عن طريق الاستيراد ({permission}). اطلب من مدير النظام منح هذه الصلاحية لدورك من شاشة الأدوار والصلاحيات. لم يتغير شيء.',
    'You do not have permission to modify existing records through import ({permission}). Ask the system administrator to grant this permission to your role from the Roles and Permissions screen. Nothing changed.',
  ],
  'IMPORT_ALLOWED_E117': [
    'ليس لديك صلاحية استخدام هذا الاستيراد ({permission}). اطلب من مدير النظام منح هذه الصلاحية لدورك من شاشة الأدوار والصلاحيات، ثم أعد المحاولة.',
    'You do not have permission to use this import ({permission}). Ask the system administrator to grant this permission to your role from the Roles and Permissions screen, then try again.',
  ],
  'BATCHES_ISSUE_TX_E122': [
    'الرصيد غير كافٍ في الدفعات المتاحة: ينقص {shortfall}. خفّض الكمية أو أضف رصيدًا، وإن وُجدت دفعات منتهية الصلاحية فصرفها يحتاج صلاحية. لم يُحفظ شيء.',
    'There is not enough stock in the available lots: {shortfall} short. Reduce the quantity or add stock; if some lots have expired, issuing them needs permission. Nothing was saved.',
  ],
  'ITEMS_CREATE_E129': [
    'يوجد لهذا الفرع رصيد افتتاحي بالفعل ({documentNumber}). أضف الصنف إليه بدلًا من إدخال رصيد افتتاحي هنا.',
    'This branch already has an opening balance ({documentNumber}). Add the item there instead of entering opening stock here.',
  ],
  'STOCK_DOCUMENTS_CREATE_E132': [
    'ليس لديك صلاحية تنفيذ هذا الإجراء ({permission}). اطلب من مدير النظام منح هذه الصلاحية لدورك من شاشة الأدوار والصلاحيات. لم يتغير شيء.',
    'You do not have permission to perform this action ({permission}). Ask the system administrator to grant this permission to your role from the Roles and Permissions screen. Nothing changed.',
  ],
  'STOCK_DOCUMENTS_APPROVE_E140': [
    'تم اعتماد مستند الإعدام هذا مسبقًا ({documentNumber}). لا حاجة لاعتماده مرة أخرى.',
    'This write-off was already approved ({documentNumber}). It does not need to be approved again.',
  ],
  'UNIT_INPUT_X_E159': [
    'اسم الوحدة {unit} أطول من {max} حرفًا. اختصر الاسم، ثم أعد المحاولة.',
    'The unit name {unit} is longer than {max} characters. Shorten the name, then try again.',
  ],
  'UNIT_INPUT_X_E160': [
    'الوحدة {unit} مكررة داخل الصنف نفسه. احذف التكرار، ثم أعد المحاولة.',
    'The unit {unit} is listed twice inside the same item. Remove the duplicate, then try again.',
  ],
  'UNIT_INPUT_X_E161': [
    'الوحدة {unit} تحتاج معامل تحويل. أدخل معامل التحويل، ثم أعد المحاولة.',
    'The unit {unit} needs a conversion factor. Enter the factor, then try again.',
  ],
  'UNIT_INPUT_X_E162': [
    'معامل تحويل الوحدة {unit} ليس رقمًا صالحًا. أدخل رقمًا صالحًا.',
    'The conversion factor of the unit {unit} is not a valid number. Enter a valid number.',
  ],
  'UNIT_INPUT_X_E163': [
    'معامل تحويل الوحدة {unit} يجب أن يكون أكبر من صفر. أدخل رقمًا أكبر من صفر.',
    'The conversion factor of the unit {unit} must be greater than zero. Enter a number above zero.',
  ],
  'QUOTATION_BACKGROUND_MEDIA_DESTROY_E186': [
    'الملف يحتوي {count} صفحة، والصفحة {pageNumber} غير موجودة. اختر صفحة ضمن صفحات الملف.',
    'The file has {count} pages, and page {pageNumber} does not exist. Choose a page within the file\'s pages.',
  ],
  'QUOTATIONS_COLUMN_DATA_E193': [
    'اسم أحد الأعمدة أطول من {max} حرفًا. اختصره ليصبح عنوانًا.',
    'A column name is longer than {max} characters. Shorten it to a heading.',
  ],
  'QUOTATIONS_COLUMN_DATA_E195': [
    'العمود {key} مكرر؛ فالعمود، سواء كان مدمجًا أو مخصصًا، يظهر مرة واحدة فقط. احذف التكرار.',
    'The column {key} is listed twice; a column, whether built-in or custom, may appear only once. Remove the duplicate.',
  ],
  'SALES_INVOICES_X_E197': [
    'السطر {line}: كمية الموقع غير صالحة. اكتب رقمًا أكبر من صفر.',
    'Line {line}: a location quantity is not valid. Enter a number above zero.',
  ],
  'SALES_INVOICES_X_E198': [
    'السطر {line}: كمية الموقع يجب أن تكون أكبر من صفر. احذف الموقع أو اكتب كمية.',
    'Line {line}: each location quantity must be above zero. Remove that location or enter a quantity.',
  ],
  'SALES_INVOICES_X_E199': [
    'السطر {line}: الموقع نفسه مكرر. اجمع الكميتين في صف واحد.',
    'Line {line}: the same location is listed twice. Combine the two quantities into one row.',
  ],
  'SALES_INVOICES_X_E200': [
    'السطر {line}: مجموع كميات المواقع {sum} لا يساوي كمية السطر {lineQuantity}. عدّل كميات المواقع حتى يتساوى المجموع مع كمية السطر.',
    'Line {line}: the location quantities add up to {sum} but the line quantity is {lineQuantity}. Change the location quantities so they add up to the line quantity.',
  ],
  'SALES_INVOICES_POST_E201': [
    'السطر {line}: مجموع المواقع {allocated} لا يساوي الكمية {quantity}. عدّل السطر، ثم رحّل مرة أخرى.',
    'Line {line}: the locations add up to {allocated} but the quantity is {quantity}. Edit the line, then post again.',
  ],
  'SALES_INVOICES_POST_E202': [
    'السطر {line}: حُدد موقع لكن هذا الفرع بلا مخزن. احذف المواقع من السطر، أو أضف مخزنًا للفرع.',
    'Line {line} names a location, but this branch has no warehouse. Remove the locations from the line, or add a warehouse to the branch.',
  ],
};
