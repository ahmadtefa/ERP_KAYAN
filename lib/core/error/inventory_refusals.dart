/// Reviewed sentences for barcode label, batch, unit and stock-movement
/// refusals: what happened and how to fix it, `[Arabic, English]`.
const Map<String, List<String>> inventoryRefusals = {
  'LABEL_BARCODE_CHARS': [
    'الباركود فيه حرف لا يمكن طباعته على الملصق (خارج حروف Code 128 المسموحة). استخدم أرقامًا وحروفًا إنجليزية ورموزًا عادية فقط. لم يُطبع شيء.',
    'The barcode has a character that cannot be printed on a label (outside the allowed Code 128 characters). Use digits, English letters and ordinary symbols only. Nothing was printed.',
  ],
  'LABEL_BARCODE_EMPTY': [
    'الملصق يحتاج باركودًا ولم يُكتب باركود. اكتب باركودًا للصنف ثم اطبع. لم يُطبع شيء.',
    'A label needs a barcode and none was given. Enter a barcode for the item and print again. Nothing was printed.',
  ],
  'LABEL_BARCODE_LONG': [
    'الباركود أطول من المسموح في الملصق (80 حرفًا). اختصره ثم اطبع. لم يُطبع شيء.',
    'The barcode is longer than a label allows (80 characters). Shorten it and print again. Nothing was printed.',
  ],
  'LABEL_SPEC_REQUIRED': [
    'لم تحدد أي وحدة للطباعة. اختر وحدة واحدة على الأقل مع عدد النسخ ثم اطبع. لم يُطبع شيء.',
    'No unit was chosen for printing. Choose at least one unit with its number of copies and print again. Nothing was printed.',
  ],
  'LABEL_SPEC_MALFORMED': [
    'تحديد الوحدة وعدد النسخ غير مفهوم. اختر الوحدة وعدد النسخ من الشاشة ثم اطبع. لم يُطبع شيء.',
    'The unit and copies choice is not understood. Pick the unit and copies on the screen and print again. Nothing was printed.',
  ],
  'LABEL_COPIES_RANGE': [
    'عدد النسخ خارج المسموح. اكتب عددًا بين 1 والحد الأقصى المعروض ثم اطبع. لم يُطبع شيء.',
    'The number of copies is out of range. Enter a number from 1 up to the maximum shown and print again. Nothing was printed.',
  ],
  'LABEL_UNIT_REPEATED': [
    'الوحدة نفسها مكررة في طلب الطباعة. اجمع نسخها في سطر واحد ثم اطبع. لم يُطبع شيء.',
    'The same unit appears twice in the print job. Combine its copies into one line and print again. Nothing was printed.',
  ],
  'LABEL_JOB_TOO_BIG': [
    'عدد الملصقات في الطلب أكثر من الحد المسموح. قسّم الطباعة على أكثر من مرة. لم يُطبع شيء.',
    'The print job has more labels than allowed. Split it into several print jobs. Nothing was printed.',
  ],
  'LABEL_ITEM_MISSING': [
    'الصنف غير موجود. حدّث الشاشة واختر الصنف من القائمة. لم يُطبع شيء.',
    'The item does not exist. Reload the screen and choose the item from the list. Nothing was printed.',
  ],
  'LABEL_UNIT_OTHER_ITEM': [
    'إحدى الوحدات المختارة لا تخص هذا الصنف. اختر وحدات الصنف نفسه. لم يُطبع شيء.',
    'One of the chosen units does not belong to this item. Choose units of the same item. Nothing was printed.',
  ],
  'LABEL_UNIT_NO_BARCODE': [
    'إحدى الوحدات بلا باركود. أضف لها باركودًا في شاشة الصنف ثم اطبع. لم يُطبع شيء.',
    'One of the units has no barcode. Add a barcode to it in the item screen and print again. Nothing was printed.',
  ],
  'BATCH_NOT_IN_WAREHOUSE': [
    'الدفعة غير موجودة في هذا المستودع. اختر دفعة من قائمة دفعات المستودع. لم يتغير شيء.',
    'The batch is not in this warehouse. Choose a batch from the warehouse batch list. Nothing changed.',
  ],
  'BATCH_NOT_IN_SOURCE': [
    'الدفعة غير موجودة في المستودع المحوَّل منه. اختر دفعة من ذلك المستودع. لم يتغير شيء.',
    'The batch is not in the source warehouse. Choose a batch from that warehouse. Nothing changed.',
  ],
  'UNIT_INACTIVE_DEFAULT': [
    'لا تكون الوحدة الموقوفة وحدة افتراضية. فعّل الوحدة أو اختر وحدة أخرى كافتراضية. لم يُحفظ شيء.',
    'An inactive unit cannot be the default unit. Activate the unit or choose another as the default. Nothing was saved.',
  ],
  'UNIT_BASE_RENAME': [
    'اسم الوحدة الأساسية لا يتغير. أضف الاسم الجديد كوحدة أخرى بدلًا من ذلك. لم يُحفظ شيء.',
    'The base unit cannot be renamed. Add the new name as another unit instead. Nothing was saved.',
  ],
  'UNIT_BASE_REMOVE': [
    'الوحدة الأساسية لا تُحذف، فالمخزون يُعدّ بها. اتركها أو غيّر الصنف. لم يتغير شيء.',
    'The base unit cannot be removed, because stock is counted in it. Keep it. Nothing changed.',
  ],
  'UNIT_BASE_DEACTIVATE': [
    'الوحدة الأساسية لا تُوقف، فالمخزون يُعدّ بها. اتركها فعّالة. لم يتغير شيء.',
    'The base unit cannot be deactivated, because stock is counted in it. Keep it active. Nothing changed.',
  ],
  'BARCODE_GENERATE_FAILED': [
    'تعذّر توليد باركود داخلي فارغ. اكتب الباركود بنفسك ثم احفظ. لم يُحفظ شيء.',
    'A free internal barcode could not be generated. Enter the barcode by hand and save. Nothing was saved.',
  ],
  'REVERSE_MOVEMENTS_AMBIGUOUS': [
    'حركات المخزون الأصلية ناقصة أو غير واضحة فلا يُعكس المستند تلقائيًا. راجع حركات المخزون مع المحاسب. لم يتغير شيء.',
    'The original stock movements are missing or unclear, so this document cannot be reversed automatically. Check the stock movements with your accountant. Nothing changed.',
  ],
};
