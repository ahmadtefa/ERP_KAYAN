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
  'DISCOUNT_NOT_FINITE': [
    'قيمة الخصم ليست رقمًا صحيحًا. اكتب رقمًا عاديًا في خانة الخصم، ثم أعد المحاولة. لم يُحفظ شيء.',
    'The discount value is not a valid number. Enter a normal number in the discount field, then try again. Nothing was saved.',
  ],
  'DISCOUNT_BASE_NEGATIVE': [
    'لا يمكن حساب الخصم لأن القيمة التي يُحسب عليها سالبة. راجع الكميات والأسعار في المستند، ثم أعد المحاولة. لم يُحفظ شيء.',
    'The discount cannot be calculated because the value it applies to is negative. Check the quantities and prices on the document, then try again. Nothing was saved.',
  ],
  'DISCOUNT_TYPE_UNKNOWN': [
    'نوع الخصم غير معروف. اختر نسبة مئوية أو مبلغًا ثابتًا من قائمة نوع الخصم، ثم أعد المحاولة. لم يُحفظ شيء.',
    'The discount type is not known. Choose a percentage or a fixed amount from the discount type list, then try again. Nothing was saved.',
  ],
  'DISCOUNT_PERCENT_NEGATIVE': [
    'نسبة الخصم لا يمكن أن تكون سالبة. اكتب نسبة من 0 إلى 100، ثم أعد المحاولة. لم يُحفظ شيء.',
    'The discount percentage cannot be negative. Enter a percentage from 0 to 100, then try again. Nothing was saved.',
  ],
  'DISCOUNT_PERCENT_OVER_100': [
    'نسبة الخصم لا يمكن أن تتجاوز 100. اكتب نسبة من 0 إلى 100، ثم أعد المحاولة. لم يُحفظ شيء.',
    'The discount percentage cannot be more than 100. Enter a percentage from 0 to 100, then try again. Nothing was saved.',
  ],
  'DISCOUNT_LARGER_THAN_VALUE': [
    'الخصم أكبر من القيمة التي يُطبَّق عليها. خفّض الخصم أو راجع الأسعار، ثم أعد المحاولة. لم يُحفظ شيء.',
    'The discount is larger than the value it applies to. Lower the discount or check the prices, then try again. Nothing was saved.',
  ],
  'DISCOUNT_AMOUNT_NEGATIVE': [
    'مبلغ الخصم لا يمكن أن يكون سالبًا. اكتب مبلغًا من صفر فأكثر، ثم أعد المحاولة. لم يُحفظ شيء.',
    'The discount amount cannot be negative. Enter an amount of zero or more, then try again. Nothing was saved.',
  ],
  'DISCOUNT_AMOUNT_OVER_VALUE': [
    'مبلغ الخصم {amount} أكبر من القيمة التي يُطبَّق عليها وهي {value}. خفّض مبلغ الخصم إلى {value} أو أقل، ثم أعد المحاولة. لم يُحفظ شيء.',
    'The discount amount {amount} is larger than the value it applies to, which is {value}. Lower the discount to {value} or less, then try again. Nothing was saved.',
  ],
  'DISCOUNT_OVER_LIMIT': [
    'نسبة الخصم {percent}% أعلى من الحد الأقصى المسموح للشركة وهو {maximum}%. خفّض الخصم إلى {maximum}% أو أقل، أو اطلب من مدير النظام رفع الحد، ثم أعد المحاولة. لم يُحفظ شيء.',
    'The discount of {percent}% is above the maximum the company allows, which is {maximum}%. Lower the discount to {maximum}% or less, or ask the system administrator to raise the limit, then try again. Nothing was saved.',
  ],
  'DATABASE_BARRIER_BUSY': [
    'الخادم مشغول بعملية أخرى في هذه اللحظة. انتظر قليلًا ثم أعد المحاولة. لم يُحفظ شيء.',
    'The server is busy with another operation right now. Wait a moment, then try again. Nothing was saved.',
  ],
  'STOCKTAKE_NOT_COUNTING': [
    'هذا الجرد لم يعد مفتوحًا للعد، فلم تُحفظ الأرقام التي أدخلتها. أعد فتح العد أو ابدأ جردًا جديدًا، ثم أعد إدخال الأرقام.',
    'This count is no longer open for counting, so the figures you entered were not saved. Reopen the count or start a new one, then enter the figures again.',
  ],
  'STOCKTAKE_ALREADY_APPROVED': [
    'هذا الجرد معتمد من قبل ولا يمكن اعتماده مرة ثانية. حدّث الصفحة لرؤية حالته الحالية. لم يتغير شيء.',
    'This count was already approved and cannot be approved again. Refresh the page to see its current status. Nothing changed.',
  ],
  'STOCKTAKE_ALREADY_POSTED': [
    'هذا الجرد مُرحَّل من قبل ولا يمكن ترحيله مرة ثانية. حدّث الصفحة لرؤية حالته الحالية. لم يتغير شيء.',
    'This count was already posted and cannot be posted again. Refresh the page to see its current status. Nothing changed.',
  ],
  'STOCKTAKE_POST_STAGE': [
    'لا يُرحَّل الجرد إلا بعد اعتماده. اعتمد الجرد أولًا من شخص لديه صلاحية الاعتماد، ثم رحّله. لم يتغير شيء.',
    'A count can be posted only after it is approved. Have a person with approval permission approve it first, then post it. Nothing changed.',
  ],
  'PURCHASE_REVERSE_LOT_CHANGED': [
    'تغيّرت دفعة المخزون أثناء عكس الفاتورة، فلم يكتمل العكس. أعد المحاولة بعد لحظات، وإن تكرر ذلك فتأكد أن لا أحد يعدّل نفس الدفعة. لم يتغير شيء.',
    'The stock lot changed while the invoice was being reversed, so the reversal did not finish. Try again in a moment, and if it keeps happening make sure nobody else is editing the same lot. Nothing changed.',
  ],
  'COMPLETE_BACKUP_VERIFY_FAILED': [
    'النسخة الاحتياطية كُتبت لكنها لم تجتز الفحص، فحُذف الملف حتى لا يُعتمد عليه خطأً. أعد إنشاء النسخة، وتأكد من وجود مساحة كافية على القرص. لم يتغير شيء آخر.',
    'The backup was written but did not pass its check, so the file was removed to prevent it from being used by mistake. Create the backup again, and make sure the disk has enough free space. Nothing else was changed.',
  ],
  'COMPLETE_BACKUP_FOLDER_UNREADABLE': [
    'تعذّرت قراءة مجلد النسخ الاحتياطية. تأكد أن المجلد موجود وأن حساب تشغيل البرنامج يملك صلاحية قراءته، ثم حدّث الصفحة.',
    'The backup folder could not be read. Check that the folder exists and that the program account has permission to read it, then refresh the page.',
  ],
  'COMPLETE_BACKUP_FILE_UNREADABLE': [
    'تعذّرت قراءة ملف النسخة الاحتياطية {name}. تأكد أن الملف موجود وغير مفتوح في برنامج آخر، ثم أعد المحاولة. لم تتغير قاعدة البيانات.',
    'The backup file {name} could not be read. Check that the file exists and is not open in another program, then try again. The database was not changed.',
  ],
  'COMPLETE_BACKUP_FILE_NOT_DELETED': [
    'تعذّر حذف ملف النسخة الاحتياطية {name}. تأكد أن الملف غير مفتوح في برنامج آخر وأن البرنامج يملك صلاحية الحذف، ثم أعد المحاولة.',
    'The backup file {name} could not be deleted. Check that the file is not open in another program and that the program has permission to delete it, then try again.',
  ],
  'RESTORE_ARCHIVE_NOT_VERIFIED': [
    'الملف المختار لم يجتز فحص الاستعادة، فقد يكون تالفًا أو ناقصًا أو ليس نسخة كاملة من هذا البرنامج. اختر ملفًا آخر أو أنشئ نسخة جديدة. لم يتغير شيء.',
    'The chosen file did not pass the restore check, so it may be damaged, incomplete, or not a complete backup from this program. Choose another file or create a new backup. Nothing was changed.',
  ],
  'RESTORE_SCRATCH_DB_FAILED': [
    'تعذّرت تجربة الاستعادة لأن خادم قاعدة البيانات لا يستطيع إنشاء قاعدة تجريبية. امنح حساب قاعدة البيانات صلاحية إنشاء قواعد البيانات، ثم أعد المحاولة. لم يتغير شيء.',
    'The restore could not be rehearsed because the database server cannot create a scratch database. Give the database account permission to create databases, then try again. Nothing was changed.',
  ],
  'RESTORE_SAFETY_BACKUP_FAILED': [
    'أُوقفت الاستعادة قبل استبدال أي شيء لأن نسخة الأمان لم تُكتب. تأكد من وجود مساحة كافية في مجلد النسخ الاحتياطية، ثم أعد المحاولة. بياناتك الحالية كما هي.',
    'The restore was stopped before anything was replaced because the safety backup could not be written. Make sure the backup folder has enough free space, then try again. Your current data is untouched.',
  ],
  'COSTCENTER_ALLOC_MISMATCH': [
    'توزيع مراكز التكلفة لا يساوي مبلغ السطر: مبلغ السطر {lineAmount} والموزَّع {allocated} والفرق {difference}. عدّل نسب أو مبالغ التوزيع حتى يصبح مجموعها مساويًا لمبلغ السطر، ثم أعد المحاولة. لم يُحفظ شيء.',
    'The cost center allocation does not equal the line amount: the line amount is {lineAmount}, the allocated amount is {allocated}, and the difference is {difference}. Adjust the allocation so it adds up to the line amount, then try again. Nothing was saved.',
  ],
  'JOURNAL_CREATE_UNBALANCED': [
    'القيد غير متوازن: إجمالي المدين {totalDebit} وإجمالي الدائن {totalCredit} والفرق {difference}. عدّل الأسطر حتى يتساوى المدين والدائن، ثم احفظ. لم يُحفظ القيد.',
    'The journal entry is not balanced: total debit is {totalDebit}, total credit is {totalCredit}, and the difference is {difference}. Adjust the lines so debit equals credit, then save. The entry was not saved.',
  ],
  'OPENING_BALANCE_UNBALANCED': [
    'الأرصدة الافتتاحية غير متوازنة: إجمالي المدين {totalDebit} وإجمالي الدائن {totalCredit} والفرق {difference}. صحّح الأرصدة، أو اختر ترحيل الفرق إلى حساب حقوق الملكية للأرصدة الافتتاحية، ثم أعد المحاولة. لم يُحفظ شيء.',
    'The opening balances are not balanced: total debit is {totalDebit}, total credit is {totalCredit}, and the difference is {difference}. Correct the balances, or choose to post the difference to the opening-balance equity account, then try again. Nothing was saved.',
  ],
  'POSTING_UNBALANCED': [
    'لم يُرحَّل المستند لأن القيد الناتج غير متوازن: إجمالي المدين {totalDebit} وإجمالي الدائن {totalCredit} والفرق {difference}. راجع الإجماليات وإعداد الحسابات، أو اطلب المساعدة من مسؤول الحسابات، ثم أعد المحاولة. لم يتغير شيء.',
    'The document was not posted because its journal entry does not balance: total debit is {totalDebit}, total credit is {totalCredit}, and the difference is {difference}. Review the totals and account setup, or ask the accountant for help, then try again. Nothing changed.',
  ],
  'YEAR_END_BLOCKED': [
    'لا يمكن إقفال السنة الآن لأن هناك أمورًا لم تُنجز بعد. افتح معاينة الإقفال وعالج كل بند ظاهر فيها، ثم أعد محاولة الإقفال. لم يتغير شيء.',
    'The year cannot be closed yet because some items are still open. Open the closing preview, resolve each item listed there, then try closing again. Nothing changed.',
  ],
  'ACCOUNT_CODE_FORMAT': [
    'رمز الحساب غير مطابق لنظام الترميز: يجب أن يكون أرقامًا فقط من 2 أو 4 أو 6 أو 8 خانات، وكل مستوى يضيف خانتين إلى رمز الحساب الأب. صحّح الرمز، ثم احفظ. لم يُحفظ الحساب.',
    'The account code does not follow the numbering scheme: it must be digits only, with 2, 4, 6 or 8 digits, and each level adds two digits to its parent code. Correct the code, then save. The account was not saved.',
  ],
  'ACCOUNT_TOP_LEVEL_NO_PARENT': [
    'الحساب ذو الخانتين حساب رئيسي ولا يكون له حساب أب. أزل الحساب الأب أو اجعل الرمز أطول، ثم احفظ. لم يُحفظ الحساب.',
    'A 2-digit account is a top-level account and cannot have a parent. Remove the parent or use a longer code, then save. The account was not saved.',
  ],
  'ACCOUNT_PARENT_REQUIRED': [
    'الحساب ذو {digits} خانات يحتاج إلى حساب أب رمزه هو أول {parentDigits} خانات من رمزه. اختر الحساب الأب، ثم احفظ. لم يُحفظ الحساب.',
    'An account with {digits} digits needs a parent account whose code is the first {parentDigits} digits of its code. Choose the parent account, then save. The account was not saved.',
  ],
  'ACCOUNT_PARENT_MISMATCH': [
    'الرمز {code} يجب أن يبدأ برمز الحساب الأب ويضيف خانتين فقط، والحساب الأب المختار رمزه {parent}. صحّح الرمز أو اختر الحساب الأب المناسب، ثم احفظ. لم يُحفظ الحساب.',
    'The code {code} must start with its parent account code and add exactly two digits, and the chosen parent has the code {parent}. Correct the code or choose the right parent, then save. The account was not saved.',
  ],
  'ACCOUNT_POSTABLE_LEVEL': [
    'الحساب ذو الثماني خانات فقط هو الذي يقبل القيود، أما الأقصر فهو حساب إجمالي. اختر رمزًا من 8 خانات أو أوقف خيار قبول القيود، ثم احفظ. لم يُحفظ الحساب.',
    'Only an 8-digit account can receive entries; shorter codes are totals. Use an 8-digit code or turn off the option to receive entries, then save. The account was not saved.',
  ],
  'ACCOUNT_EXPECTED_PARENT_ONLY': [
    'لم يكتمل طلب تغيير الحساب الأب. حدّث الصفحة ثم أعد اختيار الحساب الأب الجديد، وإن تكرر ذلك فأبلغ مدير النظام. لم يتغير شيء.',
    'The request to change the parent account was incomplete. Refresh the page and choose the new parent again, and if it keeps happening tell the system administrator. Nothing changed.',
  ],
  'LOT_NUMBER_REQUIRED': [
    'هذا الصنف يتطلب رقم دفعة ولم يُدخل رقمها. اكتب رقم الدفعة، ثم أعد المحاولة. لم يُحفظ شيء.',
    'This item requires a lot number and none was entered. Enter the lot number, then try again. Nothing was saved.',
  ],
  'LOT_PRODUCTION_DATE_REQUIRED': [
    'هذا الصنف يتطلب تاريخ إنتاج ولم يُدخل. اكتب تاريخ الإنتاج، ثم أعد المحاولة. لم يُحفظ شيء.',
    'This item requires a production date and none was entered. Enter the production date, then try again. Nothing was saved.',
  ],
  'LOT_EXPIRY_DATE_REQUIRED': [
    'هذا الصنف يتطلب تاريخ صلاحية ولم يُدخل. اكتب تاريخ الصلاحية، ثم أعد المحاولة. لم يُحفظ شيء.',
    'This item requires an expiry date and none was entered. Enter the expiry date, then try again. Nothing was saved.',
  ],
  'LOT_EXPIRY_BEFORE_PRODUCTION': [
    'تاريخ الصلاحية يسبق تاريخ الإنتاج. راجع التاريخين وصحّح الخطأ، ثم أعد المحاولة. لم يُحفظ شيء.',
    'The expiry date is before the production date. Check both dates and correct the mistake, then try again. Nothing was saved.',
  ],
  'WITHHOLDING_RATE_FORMAT': [
    'نسبة الخصم من المنبع ليست رقمًا مقبولًا. اكتب رقمًا مثل 1 أو 5 أو 0.5، ثم أعد المحاولة. لم يُحفظ شيء.',
    'The withholding rate is not an accepted number. Enter a number such as 1, 5 or 0.5, then try again. Nothing was saved.',
  ],
  'WITHHOLDING_RATE_RANGE': [
    'نسبة الخصم من المنبع يجب أن تكون أكبر من صفر ولا تزيد على 100. اكتب نسبة ضمن هذا النطاق، ثم أعد المحاولة. لم يُحفظ شيء.',
    'The withholding rate must be above zero and no more than 100. Enter a rate in that range, then try again. Nothing was saved.',
  ],
  'WITHHOLDING_AMOUNT_NOT_POSITIVE': [
    'مبلغ السند يجب أن يكون أكبر من صفر حتى يُحسب عليه الخصم من المنبع. اكتب مبلغًا صحيحًا، ثم أعد المحاولة. لم يُحفظ شيء.',
    'The voucher amount must be above zero for withholding to be calculated. Enter a valid amount, then try again. Nothing was saved.',
  ],
  'IMPORT_FILE_UNREADABLE': [
    'تعذّرت قراءة الملف المرفوع. تأكد أنه ملف إكسل بصيغة xlsx أو ملف CSV سليم، ثم ارفعه من جديد. لم يُستورد شيء.',
    'The uploaded file could not be read. Check that it is a valid xlsx or CSV file, then upload it again. Nothing was imported.',
  ],
  'IMPORT_NOT_XLSX': [
    'تعذّرت قراءة الملف كمصنف إكسل. إن كان محفوظًا بصيغة xls فافتحه واحفظه بصيغة xlsx أولًا، ثم ارفعه من جديد. لم يُستورد شيء.',
    'The file could not be read as an Excel workbook. If it was saved as .xls, open it and save it as .xlsx first, then upload it again. Nothing was imported.',
  ],
  'IMPORT_NO_SHEETS': [
    'مصنف الإكسل لا يحتوي على أي ورقة. أضف ورقة بالبيانات أو ابدأ من النموذج الموجود في هذه الشاشة، ثم ارفعه من جديد. لم يُستورد شيء.',
    'The workbook has no sheets. Add a sheet with the data or start from the template on this screen, then upload it again. Nothing was imported.',
  ],
  'IMPORT_EMPTY_FILE': [
    'الملف فارغ. أضف البيانات أو ابدأ من النموذج الموجود في هذه الشاشة، ثم ارفعه من جديد. لم يُستورد شيء.',
    'The file is empty. Add the data or start from the template on this screen, then upload it again. Nothing was imported.',
  ],
  'IMPORT_NO_HEADERS': [
    'لا توجد في الملف عناوين أعمدة يمكن قراءتها. ابدأ من النموذج الموجود في هذه الشاشة ثم ارفع الملف من جديد. لم يُستورد شيء.',
    'The file has no readable column headers. Start from the template on this screen, then upload the file again. Nothing was imported.',
  ],
  'IMPORT_NO_CODE_COLUMN': [
    'الملف لا يحتوي على عمود «{column}»، ولا يمكن مطابقة أي صف بسجله بدونه. أضف العمود أو استخدم النموذج الموجود في هذه الشاشة، ثم ارفع الملف من جديد. لم يُستورد شيء.',
    'The file has no "{column}" column, and without it a row cannot be matched to its record. Add the column or use the template on this screen, then upload the file again. Nothing was imported.',
  ],
  'PICTURE_BAD_TYPE': [
    'نوع ملف {subjectAr} غير مقبول. اختر ملف صورة بصيغة PNG أو JPEG أو WebP، ثم أعد الرفع. لم يتغير شيء.',
    'The {subjectEn} file type is not accepted. Choose an image file in PNG, JPEG or WebP format, then upload again. Nothing was changed.',
  ],
  'PICTURE_EMPTY': [
    'ملف {subjectAr} فارغ. اختر ملف صورة سليمًا ثم أعد الرفع. لم يتغير شيء.',
    'The {subjectEn} file is empty. Choose a valid image file, then upload again. Nothing was changed.',
  ],
  'PICTURE_TOO_BIG': [
    'حجم ملف {subjectAr} يتجاوز {maxMb} ميجابايت. اختر صورة أصغر ثم أعد الرفع. لم يتغير شيء.',
    'The {subjectEn} file is larger than {maxMb} MB. Choose a smaller image, then upload again. Nothing was changed.',
  ],
  'PICTURE_BAD_SIZE': [
    'أبعاد {subjectAr} غير مناسبة: يجب ألا تقل عن 32 × 32 بكسل، ولا تكون متحركة، ولا تتجاوز الحد المسموح. اختر صورة مناسبة ثم أعد الرفع. لم يتغير شيء.',
    'The {subjectEn} size is not suitable: it must be at least 32 × 32 pixels, not animated, and within the pixel limit. Choose a suitable image, then upload again. Nothing was changed.',
  ],
  'WAREHOUSE_ACCESS_DENIED': [
    'لا تملك صلاحية {actionAr} هذا المخزن. اطلب من مدير النظام منحك صلاحية الوصول إلى هذا المخزن، أو استخدم مخزنًا مصرّحًا لك به. لم يتغير شيء.',
    'You do not have permission to {actionEn} this warehouse. Ask the system administrator to give you access to this warehouse, or use a warehouse you are allowed to use. Nothing was changed.',
  ],
  'LANDED_LINE_NEGATIVE': [
    'قيمة أحد أسطر الفاتورة سالبة، فلا يمكن توزيع تكاليف الشحن والجمارك عليها. راجع الكميات والأسعار والخصومات في الأسطر، ثم أعد المحاولة. لم يُحفظ شيء.',
    'The value of one invoice line is negative, so the shipping and customs costs cannot be spread over the lines. Check the quantities, prices and discounts on the lines, then try again. Nothing was saved.',
  ],
  'LANDED_COST_NEGATIVE': [
    'تكاليف الشحن والجمارك لا يمكن أن تكون سالبة. اكتب مبلغًا من صفر فأكثر، ثم أعد المحاولة. لم يُحفظ شيء.',
    'Shipping and customs costs cannot be negative. Enter an amount of zero or more, then try again. Nothing was saved.',
  ],
  'LANDED_NO_LINES': [
    'لا يمكن توزيع تكاليف الشحن والجمارك لأن الفاتورة بلا أسطر. أضف سطرًا واحدًا على الأقل، أو اجعل التكاليف صفرًا، ثم أعد المحاولة. لم يُحفظ شيء.',
    'Shipping and customs costs cannot be spread because the invoice has no lines. Add at least one line, or set the costs to zero, then try again. Nothing was saved.',
  ],
  'LANDED_NO_LINE_VALUE': [
    'لا يمكن توزيع تكاليف الشحن والجمارك لأن قيمة أسطر الفاتورة صفر. أدخل أسعارًا وكميات للأسطر، أو اجعل التكاليف صفرًا، ثم أعد المحاولة. لم يُحفظ شيء.',
    'Shipping and customs costs cannot be spread because the invoice lines have a total value of zero. Enter prices and quantities on the lines, or set the costs to zero, then try again. Nothing was saved.',
  ],
  'LANDED_ALLOCATION_FAILED': [
    'تعذّر توزيع تكاليف الشحن والجمارك على أسطر الفاتورة. راجع مبلغ التكاليف وأسطر الفاتورة، ثم أعد المحاولة. لم يُحفظ شيء.',
    'The shipping and customs costs could not be spread over the invoice lines. Check the cost amount and the invoice lines, then try again. Nothing was saved.',
  ],
  'APPROVAL_LEVEL_PERMISSION': [
    'هذا المستوى من الاعتماد يتطلب الصلاحية {permission} وليست لديك. اطلب من مدير النظام منح دورك هذه الصلاحية، أو اطلب من شخص لديه الصلاحية أن يعتمد. لم يتغير شيء.',
    'This approval level requires the permission {permission}, which you do not have. Ask the system administrator to give your role this permission, or ask a person who has it to approve. Nothing changed.',
  ],
  'APPROVAL_LEVEL_ROLE': [
    'هذا المستوى من الاعتماد مخصص للدور {role} فقط وليس هذا دورك. اطلب من صاحب هذا الدور أن يعتمد، أو اطلب من مدير النظام مراجعة سلسلة الاعتماد. لم يتغير شيء.',
    'This approval level is only for the role {role}, and that is not your role. Ask a person with that role to approve, or ask the system administrator to review the approval chain. Nothing changed.',
  ],
  'APPROVAL_SELF_DECISION': [
    'لا يمكنك اتخاذ قرار في طلب اعتماد أنشأته أنت. اطلب من شخص آخر لديه صلاحية الاعتماد أن يقرر. لم يتغير شيء.',
    'You cannot decide on an approval request you created yourself. Ask another person with approval permission to decide. Nothing changed.',
  ],
  'APPROVAL_ALREADY_DECIDED': [
    'سبق أن اتخذت قرارك في هذا المستوى من الاعتماد ولا يمكن تكراره. حدّث الصفحة لرؤية الحالة الحالية. لم يتغير شيء.',
    'You have already decided on this approval level and cannot decide again. Refresh the page to see the current status. Nothing changed.',
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
  'AUDITED_SUPER_ADMIN_CAN_ACTIVATE_E003': [
    'تعذّر تسجيل فحص الوصول، فلم تُنفّذ العملية. أعد المحاولة، وإن استمرت المشكلة فتواصل مع الدعم. لم يتغير شيء.',
    'The access check could not be recorded, so the operation did not run. Try again, and contact support if the problem continues. No changes were made.',
  ],
  'DATABASE_BARRIER_GET_POOL_E015': [
    'تنسيق صيانة قاعدة البيانات غير متاح حاليًا، فلم تُنفّذ العملية. انتظر قليلًا ثم أعد المحاولة، وتواصل مع الدعم إن استمرت المشكلة.',
    'Database maintenance coordination is unavailable, so the operation did not run. Wait a moment and try again; contact support if the problem continues.',
  ],
  'DATABASE_BARRIER_ADMIT_E016': [
    'الخادم بصدد التوقف، فلم تُنفّذ العملية. أعد المحاولة بعد قليل.',
    'The server is shutting down, so the operation did not run. Try again in a moment.',
  ],
  'DATABASE_BARRIER_ADMIT_E018': [
    'قاعدة البيانات في وضع الصيانة أو تتطلب استردادًا. انتظر حتى تنتهي الصيانة أو يتم الاسترداد، ثم أعد المحاولة.',
    'The database is under maintenance or needs recovery. Wait for maintenance or recovery to finish, then try again.',
  ],
  'DATABASE_BARRIER_ADMIT_E019': [
    'قاعدة البيانات في وضع الصيانة أو تتطلب استردادًا. انتظر حتى تنتهي الصيانة أو يتم الاسترداد، ثم أعد المحاولة.',
    'The database is under maintenance or needs recovery. Wait for maintenance or recovery to finish, then try again.',
  ],
  'MAINTENANCE_WAIT_FOR_BUSINESS_REQUESTS_E022': [
    'لم تنتهِ الطلبات السابقة قبل الموعد النهائي للاستعادة، فتوقفت الاستعادة. راجع حالة الاستعادة، ثم أعد المحاولة. لم تتغير قاعدة البيانات.',
    'The previous requests did not finish before the restore deadline, so the restore stopped. Check the restore status, then try again. The database was not changed.',
  ],
  'MAINTENANCE_INTERCEPT_E023': [
    'قاعدة البيانات في وضع الصيانة، والقراءة والكتابة متوقفتان الآن. راجع حالة الاستعادة قبل إعادة المحاولة.',
    'The database is in maintenance mode, and reads and writes are blocked. Check the restore status before trying again.',
  ],
  'BACKUP_WRITE_SAFETY_BACKUP_E039': [
    'نسخة الأمان الخاصة بالشركة أكبر من حد الاستعادة المسموح، فلم تُنفَّذ الاستعادة. تواصل مع الدعم. لم تتغير قاعدة البيانات.',
    'The company safety backup is larger than the allowed restore limit, so the restore did not run. Contact support. The database was not changed.',
  ],
  'BACKUP_WRITE_SAFETY_BACKUP_E040': [
    'تعذّر إنشاء نسخة الأمان والتحقق منها، فتوقفت العملية. أعد المحاولة، وتواصل مع الدعم إن استمرت المشكلة. لم تتغير قاعدة البيانات.',
    'The safety backup could not be created and verified, so the operation stopped. Try again, and contact support if the problem continues. The database was not changed.',
  ],
  'BACKUP_READ_LEGACY_LOGO_E041': [
    'تعذّر تضمين شعار الشركة القديم في النسخة. أعد رفع الشعار ثم أعد المحاولة.',
    'The old company logo could not be included in the backup. Upload the logo again and try again.',
  ],
  'BACKUP_RESTORE_E042': [
    'عملية صيانة أخرى قيد التنفيذ حاليًا، فلم تبدأ الاستعادة. انتظر حتى تنتهي ثم أعد المحاولة. لم تتغير قاعدة البيانات.',
    'Another maintenance operation is running, so the restore did not start. Wait for it to finish, then try again. The database was not changed.',
  ],
  'BACKUP_ASSERT_NO_INTERRUPTED_SYSTEM_RESTORE_E043': [
    'تعذّر التحقق من سجل الاستعادة. راجع حالة الاستعادة وعالجها أولًا، ثم أعد محاولة استعادة بيانات الشركة.',
    'The restore record cannot be verified. Review the restore status and resolve it first, then try restoring the company data again.',
  ],
  'BACKUP_ASSERT_NO_INTERRUPTED_SYSTEM_RESTORE_E044': [
    'هناك استعادة سابقة توقفت ولم يتم استردادها. نفّذ خيار الاسترداد من شاشة الاستعادة، ثم أعد محاولة استعادة بيانات الشركة.',
    'A previous restore was interrupted and needs recovery first. Run the recovery option from the restore screen, then try restoring the company data again.',
  ],
  'BACKUP_LOCK_BUSINESS_TABLES_E045': [
    'تعذّر قفل قاعدة بيانات الشركة لعدم العثور على جداول العمل. تأكد من اختيار قاعدة البيانات الصحيحة، وتواصل مع الدعم.',
    'The company database could not be locked because no business tables were found. Make sure the correct database is selected, and contact support.',
  ],
  'FULL_BACKUP_CREATE_FULL_E048': [
    'لا يمكن بدء النسخ الاحتياطي أثناء تنفيذ استعادة أو أثناء وضع الصيانة. انتظر حتى تنتهي العملية، ثم أعد المحاولة.',
    'A backup cannot start while a restore is running or the database is in maintenance mode. Wait for it to finish, then try again.',
  ],
  'FULL_BACKUP_DUMP_E049': [
    'تعذّر إنشاء النسخة الاحتياطية لأن أدوات قاعدة البيانات على هذا الجهاز أبلغت عن مشكلة. أعد المحاولة، وتواصل مع الدعم إن استمرت المشكلة. لم يتغير شيء.',
    'The backup could not be created because the database tools on this machine reported a problem. Try again, and contact support if the problem continues. Nothing was changed.',
  ],
  'FULL_BACKUP_RESTORE_E058': [
    'هناك استعادة أخرى قيد التنفيذ، أو قاعدة البيانات في وضع الصيانة. انتظر حتى تنتهي، ثم أعد المحاولة.',
    'Another restore is already running, or the database is in maintenance mode. Wait for it to finish, then try again.',
  ],
  'FULL_BACKUP_RESTORE_E059': [
    'هناك نسخة احتياطية قيد التنفيذ حاليًا، فلم تبدأ الاستعادة. انتظر حتى تنتهي، ثم أعد المحاولة.',
    'A backup is running, so the restore did not start. Wait for it to finish, then try again.',
  ],
  'FULL_BACKUP_RESTORE_E060': [
    'تعذّر التحقق من سجل الاستعادة. راجع حالة الاستعادة وعالجها، ثم أعد المحاولة.',
    'The restore record cannot be verified. Review the restore status and resolve it, then try again.',
  ],
  'FULL_BACKUP_RESTORE_E061': [
    'هناك استعادة سابقة توقفت ويجب استردادها أولًا. نفّذ خيار الاسترداد، ثم أعد المحاولة.',
    'A previous restore was interrupted and must be recovered first. Run the recovery option, then try again.',
  ],
  'FULL_BACKUP_PERFORM_RESTORE_E062': [
    'تعذّر التحقق من إعدادات اتصال أدوات النسخ الاحتياطي. راجع الإعدادات، ثم أعد المحاولة. لم تتغير قاعدة البيانات الحالية.',
    'The backup tool connection settings cannot be verified. Review the settings, then try again. The current database was not changed.',
  ],
  'FULL_BACKUP_PERFORM_RESTORE_E064': [
    'تعذّر إنشاء قاعدة البيانات التجريبية للاستعادة. أعد المحاولة، وتواصل مع الدعم إن استمرت المشكلة. لم تتغير قاعدة البيانات الحالية.',
    'The rehearsal database for the restore could not be created. Try again, and contact support if the problem continues. The current database was not changed.',
  ],
  'FULL_BACKUP_PERFORM_RESTORE_E065': [
    'تعذّر حذف قاعدة البيانات التجريبية للاستعادة. تواصل مع الدعم لإزالة النسخة التجريبية. لم تتغير قاعدة البيانات الحالية.',
    'The rehearsal database for the restore could not be removed. Contact support to remove the rehearsal copy. The current database was not changed.',
  ],
  'FULL_BACKUP_PERFORM_RESTORE_E067': [
    'اكتملت الاستعادة لكن البيانات لم تجتز الفحوصات اللاحقة، فأُعيدت البيانات تلقائيًا من نسخة الأمان. البيانات عادت إلى حالتها السابقة. أعد المحاولة أو تواصل مع الدعم.',
    'The restore finished, but the data did not pass the post-restore checks, so the data was put back automatically from the safety backup. The data is back to its previous state. Try again or contact support.',
  ],
  'FULL_BACKUP_PERFORM_RESTORE_E068': [
    'تعذّر إصلاح الصلاحيات بعد الاستعادة، وما يزال النظام في وضع الصيانة. لا تُدخل بيانات، وتواصل مع الدعم.',
    'Access permissions could not be repaired after the restore, and the system is still in maintenance mode. Do not enter data, and contact support.',
  ],
  'FULL_BACKUP_PERFORM_RESTORE_E069': [
    'تعذّر تسوية الترخيص بعد الاستعادة، وما يزال النظام في وضع الصيانة. لا تُدخل بيانات، وتواصل مع الدعم.',
    'The licence could not be reconciled after the restore, and the system is still in maintenance mode. Do not enter data, and contact support.',
  ],
  'FULL_BACKUP_PERFORM_RESTORE_E070': [
    'تعذّر تسجيل تدقيق الاستعادة، وما يزال النظام في وضع الصيانة. لا تُدخل بيانات، وتواصل مع الدعم.',
    'The restore audit could not be recorded, and the system is still in maintenance mode. Do not enter data, and contact support.',
  ],
  'FULL_BACKUP_RECOVER_DUMP_JOURNAL_E071': [
    'سجل الاسترداد هذا يخص قاعدة بيانات أخرى. تأكد من أنك تعمل على قاعدة البيانات الصحيحة، وتواصل مع الدعم. لم تتغير أي بيانات.',
    'This recovery record belongs to a different database. Make sure you are working on the correct database, and contact support. No data was changed.',
  ],
  'FULL_BACKUP_RECOVER_DUMP_JOURNAL_E072': [
    'سجل الاسترداد لا يحتوي نسخة أمان، فلا يمكن التراجع عن الاستعادة المتوقفة تلقائيًا. لا تُدخل بيانات، وتواصل مع الدعم.',
    'The recovery record has no safety backup, so the interrupted restore cannot be rolled back automatically. Do not enter data, and contact support.',
  ],
  'FULL_BACKUP_REQUIRE_TOOLS_E074': [
    'هذا الجهاز لا تتوفر فيه أدوات النسخ الاحتياطي لقاعدة البيانات، فلا يمكن إنشاء النسخ الكاملة أو استعادتها هنا. ثبّت أدوات عميل قاعدة البيانات، ثم أعد المحاولة.',
    'This machine does not have the database backup tools, so full backups cannot be created or restored here. Install the database client tools, then try again.',
  ],
  'FULL_BACKUP_REQUIRE_DATABASE_E075': [
    'الخادم لا يعرف قاعدة البيانات التي سينسخها لأن عنوان قاعدة البيانات غير مضبوط. اضبط عنوان قاعدة البيانات، ثم أعد تشغيل الخادم.',
    'The server does not know which database to back up because the database address is not set. Set the database address, then restart the server.',
  ],
  'FULL_BACKUP_REQUIRE_DATABASE_E076': [
    'تعذّرت قراءة عنوان قاعدة البيانات الذي بدأ به الخادم. صحّح العنوان، ثم أعد تشغيل الخادم. لم يتغير شيء.',
    'The database address the server was started with cannot be read. Correct the address, then restart the server. Nothing was changed.',
  ],
  'FULL_BACKUP_REQUIRE_DATABASE_E077': [
    'عنوان قاعدة البيانات لا يحدد اسم قاعدة بيانات. أضف اسم قاعدة البيانات إلى العنوان، ثم أعد تشغيل الخادم. لم يتغير شيء.',
    'The database address does not name a database. Add the database name to the address, then restart the server. Nothing was changed.',
  ],
  'FULL_BACKUP_REQUIRE_DATABASE_E078': [
    'اسم قاعدة البيانات غير واضح لأدوات النسخ الاحتياطي. استخدم اسمًا بسيطًا بلا محارف خاصة، ثم أعد تشغيل الخادم. لم يتغير شيء.',
    'The database name is unclear to the backup tools. Use a simple name without special characters, then restart the server. Nothing was changed.',
  ],
  'FULL_BACKUP_VALIDATE_AND_DESCRIBE_E080': [
    'أداة النسخ الاحتياطي لم تنشئ أي ملف. أعد محاولة النسخ، وتواصل مع الدعم إن استمرت المشكلة. لم تتغير قاعدة البيانات.',
    'The backup tool did not create a file. Try the backup again, and contact support if the problem continues. The database was not changed.',
  ],
  'FULL_BACKUP_VALIDATE_AND_DESCRIBE_E082': [
    'أنشأت أداة النسخ الاحتياطي ملفًا ليس أرشيفًا صالحًا لقاعدة البيانات، فحُذف الملف. أعد المحاولة، وتواصل مع الدعم إن استمرت المشكلة. لم تتغير قاعدة البيانات.',
    'The backup tool created a file that is not a valid database archive, so the file was discarded. Try again, and contact support if the problem continues. The database was not changed.',
  ],
  'BACKUP_DEST_NOT_ABSOLUTE': [
    'لم يُكتب مسار مجلد كامل للنسخ الاحتياطي. اكتب المسار الكامل للمجلد، مثل D:\\Backups، ثم اضغط فحص المجلد.',
    'A full folder path was not entered for the backup copies. Type the full path of the folder, for example D:\\Backups, then press Check folder.',
  ],
  'BACKUP_DEST_INSIDE_PROGRAM': [
    'المجلد المختار داخل مجلدات البرنامج أو يحتويها، فلن تنجو النسخة إن تلف البرنامج. اختر مجلدًا خارج مجلد البرنامج، يفضّل على قرص آخر.',
    'The chosen folder is inside, or contains, the program folders, so the copy would not survive if the program were damaged. Choose a folder outside the program folder, preferably on another disk.',
  ],
  'BACKUP_DEST_CANNOT_CREATE': [
    'تعذّر إنشاء المجلد المختار أو الوصول إليه. تأكد أن المسار صحيح وأن القرص أو المجلد المشترك متصل، ثم أعد المحاولة.',
    'The chosen folder could not be created or reached. Check that the path is correct and that the disk or shared folder is connected, then try again.',
  ],
  'BACKUP_DEST_NOT_WRITABLE': [
    'لا يستطيع البرنامج الكتابة في المجلد المختار. امنح حساب تشغيل البرنامج صلاحية الكتابة في المجلد أو اختر مجلدًا آخر، ثم أعد الفحص.',
    'The program cannot write to the chosen folder. Give the program account permission to write to the folder, or choose another folder, then check again.',
  ],
  'BACKUP_START_HOUR_INVALID': [
    'ساعة بدء النسخ الاحتياطي غير صحيحة. اختر ساعة من 0 إلى 23، ثم احفظ الإعدادات.',
    'The backup start hour is not valid. Choose an hour from 0 to 23, then save the settings.',
  ],
  'COMPLETE_BACKUP_CREATE_E085': [
    'هذا الجهاز لا تتوفر فيه أدوات النسخ الاحتياطي لقاعدة البيانات، فلا يمكن إنشاء نسخة كاملة هنا. ثبّت أدوات عميل قاعدة البيانات، ثم أعد المحاولة. لم يتغير شيء.',
    'This machine does not have the database backup tools, so a complete backup cannot be created here. Install the database client tools, then try again. Nothing was changed.',
  ],
  'RESTORE_LOCK_X_E094': [
    'تعذّر قفل الاستعادة لأن عنوان قاعدة البيانات غير مضبوط. اضبط عنوان قاعدة البيانات، ثم أعد تشغيل الخادم.',
    'The restore cannot be locked because the database address is not set. Set the database address, then restart the server.',
  ],
  'RESTORE_LOCK_X_E095': [
    'هناك استعادة سابقة توقفت وتحتاج استردادًا أولًا. نفّذ خيار الاسترداد، ثم أعد المحاولة.',
    'A previous restore was interrupted and needs recovery first. Run the recovery option, then try again.',
  ],
  'RESTORE_LOCK_X_E096': [
    'تعذّر قفل قاعدة البيانات بأمان للاستعادة أو الاسترداد. انتظر قليلًا ثم أعد المحاولة، وتواصل مع الدعم إن استمرت المشكلة. لم تتغير أي بيانات.',
    'The database could not be safely locked for the restore or recovery. Wait a moment and try again, and contact support if the problem continues. No data was changed.',
  ],
  'RESTORE_STATE_START_E097': [
    'هناك استعادة أخرى تحتاج استردادًا أولًا. أكمل ذلك الاسترداد، ثم أعد المحاولة.',
    'A different restore needs recovery first. Complete that recovery, then try again.',
  ],
  'RESTORE_STATE_FINISH_E098': [
    'مالك الاستعادة المسجَّل لا يطابق. تواصل مع الدعم قبل إعادة المحاولة. لم تتغير أي بيانات.',
    'The recorded restore owner does not match. Contact support before trying again. No data was changed.',
  ],
  'SYSTEM_RESTORE_STATUS_E099': [
    'تعذّرت قراءة سجل الاستعادة. راجع حالة الاستعادة قبل متابعة العمليات.',
    'The restore record cannot be read. Review the restore status before resuming operations.',
  ],
  'SYSTEM_RESTORE_RESTORE_E103': [
    'هناك استعادة سابقة توقفت ويجب استردادها أولًا. نفّذ خيار الاسترداد، ثم أعد المحاولة.',
    'A previous restore was interrupted and must be recovered first. Run the recovery option, then try again.',
  ],
  'SYSTEM_RESTORE_RESTORE_E107': [
    'تعذّر التحقق من سجل الاستعادة، وما يزال النظام في وضع الصيانة. لا تُدخل بيانات، وتواصل مع الدعم.',
    'The restore record cannot be verified, and the system is still in maintenance mode. Do not enter data, and contact support.',
  ],
  'SYSTEM_RESTORE_RESTORE_E108': [
    'سجل أمان الاستعادة مفقود أو غير مكتمل، وما يزال النظام في وضع الصيانة. لا تُدخل بيانات، وتواصل مع الدعم.',
    'The restore safety record is missing or incomplete, and the system is still in maintenance mode. Do not enter data, and contact support.',
  ],
  'SYSTEM_RESTORE_RESUME_RECOVERY_E110': [
    'سجل الاسترداد هذا يخص قاعدة بيانات أخرى. تأكد من أنك تعمل على قاعدة البيانات الصحيحة، وتواصل مع الدعم. لم تتغير أي بيانات.',
    'This recovery record belongs to a different database. Make sure you are working on the correct database, and contact support. No data was changed.',
  ],
  'SYSTEM_RESTORE_RESUME_RECOVERY_E111': [
    'استعادة متوقفة ربما غيّرت بيانات دون تسجيل نسخة أمان، وما يزال النظام في وضع الصيانة. لا تُدخل بيانات، وتواصل مع الدعم.',
    'An interrupted restore may have changed data and no safety backup is recorded; the system is still in maintenance mode. Do not enter data, and contact support.',
  ],
  'SYSTEM_RESTORE_RESUME_RECOVERY_E112': [
    'الاسترداد من أرشيف قاعدة البيانات غير متاح، وما يزال النظام في وضع الصيانة. لا تُدخل بيانات، وتواصل مع الدعم.',
    'Recovery from a database archive is unavailable, and the system is still in maintenance mode. Do not enter data, and contact support.',
  ],
  'PDF_RENDER_E114': [
    'هذا الخادم لا يحتوي متصفحًا، فلا يستطيع إنشاء ملف PDF بنفسه. استخدم زر الطباعة واختر "حفظ بتنسيق PDF"؛ فالنتيجة هي الملف نفسه.',
    'This server has no browser, so it cannot create a PDF by itself. Use the print button and choose "Save as PDF"; the result is the same file.',
  ],
  'PDF_RENDER_E115': [
    'تعذّر تحويل التقرير إلى ملف PDF على هذا الجهاز. استخدم زر الطباعة واختر "حفظ بتنسيق PDF".',
    'The report could not be turned into a PDF on this machine. Use the print button and choose "Save as PDF".',
  ],
  'BACKUP_INSERT_TABLE_E046': [
    'تعذّرت استعادة الجدول {table} لأن معالج بياناته غير متاح. تواصل مع الدعم. لم يتغير شيء.',
    'The table {table} could not be restored because its data handler is unavailable. Contact support. Nothing was changed.',
  ],
  'BACKUP_INSERT_TABLE_E047': [
    'عدد الصفوف المستعادة للجدول {table} لا يطابق قاعدة البيانات. تواصل مع الدعم. لم يتغير شيء.',
    'The number of restored rows for the table {table} did not match the database. Contact support. Nothing was changed.',
  ],
  'FULL_BACKUP_LIST_E050': [
    'تعذّرت قراءة مجلد النسخ الاحتياطية ({reason}). تأكد من وجود المجلد ومن قدرة البرنامج على الوصول إليه، ثم أعد المحاولة.',
    'The backup folder could not be read ({reason}). Make sure the folder exists and the program can access it, then try again.',
  ],
  'FULL_BACKUP_READ_E051': [
    'تعذّرت قراءة ملف النسخة الاحتياطية {name}؛ قد يكون تالفًا أو لا يستطيع البرنامج الوصول إليه ({reason}). اختر نسخة أخرى أو تواصل مع الدعم. لم تتغير قاعدة البيانات.',
    'The backup file {name} could not be read; it may be damaged or the program cannot access it ({reason}). Choose another backup or contact support. The database was not changed.',
  ],
  'FULL_BACKUP_VERIFY_E052': [
    'تعذّرت إعادة قراءة ملف النسخة الاحتياطية {name} للتحقق منه ({reason}). أعد المحاولة، واستخدم نسخة أخرى إن استمرت المشكلة. لم يتغير شيء.',
    'The backup file {name} could not be re-read for checking ({reason}). Try again, and use another backup if the problem continues. Nothing was changed.',
  ],
  'FULL_BACKUP_VERIFY_E053': [
    'الملف {name} ليس أرشيفًا صالحًا لقاعدة البيانات. اختر ملف نسخة احتياطية صالحًا. لم يتغير شيء.',
    'The file {name} is not a valid database archive. Choose a valid backup file. Nothing was changed.',
  ],
  'FULL_BACKUP_VERIFY_E054': [
    'تعذّرت قراءة ملف النسخة الاحتياطية {name}؛ قد يكون تالفًا أو أُنشئ بإصدار أحدث من قاعدة البيانات. استخدم ملفًا آخر أو تواصل مع الدعم. لم يتغير شيء.',
    'The backup file {name} could not be read; it may be damaged or created with a newer database version. Use another file or contact support. Nothing was changed.',
  ],
  'FULL_BACKUP_VERIFY_E055': [
    'ملف النسخة الاحتياطية {name} لا يحتوي أي بيانات قاعدة بيانات. اختر ملف نسخة احتياطية صالحًا. لم يتغير شيء.',
    'The backup file {name} contains no database data. Choose a valid backup file. Nothing was changed.',
  ],
  'FULL_BACKUP_VERIFY_E056': [
    'ملف النسخة الاحتياطية {name} يحتوي بيانات تعذّرت قراءتها. اختر ملفًا آخر أو تواصل مع الدعم. لم يتغير شيء.',
    'The backup file {name} contains data that could not be read. Choose another file or contact support. Nothing was changed.',
  ],
  'FULL_BACKUP_REMOVE_E057': [
    'تعذّر حذف ملف النسخة الاحتياطية {name} ({reason}). تأكد من أن الملف غير مستخدم من برنامج آخر، ثم أعد المحاولة. لم يتغير أي شيء آخر.',
    'The backup file {name} could not be deleted ({reason}). Make sure it is not in use by another program, then try again. Nothing else was changed.',
  ],
  'FULL_BACKUP_PERFORM_RESTORE_E063': [
    'تعذّرت كتابة الملف المرفوع في مجلد النسخ الاحتياطية ({reason}). غيّر إعداد مجلد النسخ الاحتياطية إلى مجلد يمكن للبرنامج الكتابة فيه، ثم أعد المحاولة.',
    'The uploaded file could not be written to the backup folder ({reason}). Change the backup folder setting to a folder the program can write to, then try again.',
  ],
  'FULL_BACKUP_PERFORM_RESTORE_E066': [
    'فشلت الاستعادة في منتصفها، وأُعيدت البيانات تلقائيًا من نسخة الأمان {safety}. البيانات عادت إلى حالتها السابقة. تواصل مع الدعم مع ذكر تفاصيل المشكلة.',
    'The restore failed part way through, and the data was put back automatically from the safety backup {safety}. The data is back to its previous state. Contact support with the problem details.',
  ],
  'FULL_BACKUP_RECOVER_FROM_E073': [
    'فشلت الاستعادة وفشل معها الاسترداد التلقائي، وما يزال النظام في وضع الصيانة. استعد البيانات يدويًا من ملف نسخة الأمان {name}.',
    'The restore and the automatic recovery both failed, and the system is still in maintenance mode. Restore the data manually from the safety backup file {name}.',
  ],
  'FULL_BACKUP_ENSURE_BACKUP_DIR_E079': [
    'تعذّرت كتابة النسخ الاحتياطية في المجلد ({reason}). غيّر إعداد مجلد النسخ الاحتياطية إلى مجلد يمكن للبرنامج الكتابة فيه، ثم أعد المحاولة.',
    'Backups cannot be written to the folder ({reason}). Change the backup folder setting to a folder the program can write to, then try again.',
  ],
  'FULL_BACKUP_VALIDATE_AND_DESCRIBE_E081': [
    'تعذّرت إعادة قراءة ملف النسخة الاحتياطية {name} للتحقق منه ({reason}). أعد المحاولة، واستخدم نسخة أخرى إن استمرت المشكلة. لم تتغير قاعدة البيانات.',
    'The backup file {name} could not be re-read for checking ({reason}). Try again, and use another backup if the problem continues. The database was not changed.',
  ],
  'SYSTEM_RESTORE_RESTORE_E101': [
    'استعادة سابقة توقفت عند مرحلة "{phase}" ولم تُعالج. نفّذ خيار استكمال الاسترداد أولًا حتى تُعاد نسخة الأمان، ثم أعد المحاولة. لم يتغير شيء.',
    'An earlier restore stopped at the stage "{phase}" and has not been resolved. Run the resume recovery option first so the safety backup is put back, then try again. Nothing was changed.',
  ],
  'SYSTEM_RESTORE_RESTORE_E109': [
    'لم تكتمل الاستعادة، وأُعيدت البيانات السابقة تلقائيًا من نسخة الأمان {backup}، ولم تُفقد أي بيانات. ما يزال النظام في وضع الصيانة؛ تواصل مع الدعم.',
    'The restore did not finish, and the previous data was put back automatically from the safety backup {backup}; no data was lost. The system is still in maintenance mode; contact support.',
  ],
};
