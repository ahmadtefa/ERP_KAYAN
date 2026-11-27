/// Reviewed sentences for inventory reports and report access, items, stock
/// takes and warehouse access: what happened and how to fix it,
/// `[Arabic, English]`.
const Map<String, List<String>> inventoryAccessRefusals = {
  'INVENTORY_EXPORT_PERMISSION': [
    'التصدير يحتاج صلاحية تصدير المخزون. اطلبها من المدير. لم يتغير شيء.',
    'Exporting needs the inventory export permission. Ask an administrator for it. Nothing changed.',
  ],
  'REPORT_OUTSIDE_WAREHOUSES': [
    'هذا التقرير خارج المخازن المخصصة لك. اختر مخزنًا من مخازنك أو اطلب توسيع الصلاحية. لم يتغير شيء.',
    'This report is outside your assigned warehouses. Choose one of your warehouses or ask for wider access. Nothing changed.',
  ],
  'INVENTORY_REPORT_PERMISSION': [
    'لا تملك صلاحية قراءة هذا التقرير. اطلبها من المدير. لم يتغير شيء.',
    'You do not have the permission to read this report. Ask an administrator for it. Nothing changed.',
  ],
  'REPORT_UNKNOWN': [
    'التقرير المطلوب غير معروف. اختره من قائمة التقارير. لم يتغير شيء.',
    'The requested report is not known. Choose it from the reports list. Nothing changed.',
  ],
  'ITEM_CARD_NEEDS_ITEM': [
    'كارت الصنف يحتاج اختيار صنف. اختر الصنف ثم أعد التشغيل. لم يتغير شيء.',
    'The item card needs an item. Choose the item and run it again. Nothing changed.',
  ],
  'STOCKDOC_OUTSIDE_WAREHOUSES': [
    'مستند المخزون هذا خارج المخازن المخصصة لك. اطلب توسيع الصلاحية أو اطلب الطباعة ممن يملكها. لم يتغير شيء.',
    'This stock document is outside your assigned warehouses. Ask for wider access or ask someone who has it to print. Nothing changed.',
  ],
  'INVENTORY_PRINT_PERMISSION': [
    'طباعة التقارير تحتاج صلاحية الطباعة. اطلبها من المدير. لم يتغير شيء.',
    'Printing reports needs the print permission. Ask an administrator for it. Nothing changed.',
  ],
  'REPORT_OUTSIDE_BRANCHES': [
    'هذا التقرير خارج الفروع المخصصة لك. اختر فرعًا من فروعك. لم يتغير شيء.',
    'This report is outside your assigned branches. Choose one of your branches. Nothing changed.',
  ],
  'REPORT_NO_BRANCH': [
    'لا يوجد فرع مخصص لحسابك. اطلب من المدير تخصيص فرع ثم أعد المحاولة. لم يتغير شيء.',
    'No branch is assigned to this account. Ask an administrator to assign a branch and try again. Nothing changed.',
  ],
  'REPORT_SELECT_BRANCH': [
    'اختر فرعًا من فروعك المخصصة لتشغيل هذا التقرير. لم يتغير شيء.',
    'Choose one of your assigned branches to run this report. Nothing changed.',
  ],
  'REPORT_NOT_NARROWABLE': [
    'تعذّر حصر هذا التقرير بأمان في نطاق صلاحياتك. اختر فرعًا أو مخزنًا محددًا من مخازنك ثم أعد التشغيل. لم يتغير شيء.',
    'This report cannot be safely narrowed to your assigned scope. Choose one specific branch or warehouse of yours and run it again. Nothing changed.',
  ],
  'REPORT_AMOUNT_INVALID': [
    'قيمة المبلغ في مرشّح التقرير غير صالحة. اكتب رقمًا صحيحًا ثم أعد التشغيل. لم يتغير شيء.',
    'The amount in a report filter is not valid. Enter a valid number and run it again. Nothing changed.',
  ],
  'REPORT_FLAG_INVALID': [
    'أحد خيارات مرشّح التقرير يجب أن يكون نعم أو لا. اختر قيمة صحيحة ثم أعد التشغيل. لم يتغير شيء.',
    'A report filter option must be yes or no. Choose a valid value and run it again. Nothing changed.',
  ],
  'BARCODE_TOO_LONG': [
    'الباركود أطول من المسموح (60 حرفًا). اكتب باركودًا أقصر ثم أعد المحاولة. لم يتغير شيء.',
    'The barcode is longer than allowed (60 characters). Enter a shorter barcode and try again. Nothing changed.',
  ],
  'REPORT_ID_INVALID': [
    'معرّف مركز التكلفة أو الفرع في المرشّح غير صالح. اخترهما من القائمة ثم أعد التشغيل. لم يتغير شيء.',
    'The cost center or branch identifier in the filter is not valid. Choose them from the list and run it again. Nothing changed.',
  ],
  'ITEM_HAS_STOCK': [
    'لا يمكن إيقاف الصنف وما زال له رصيد في المخزون. انقل الرصيد خارج المخزن أو سوّه ثم أوقفه. لم يتغير شيء.',
    'The item cannot be deactivated while it still has stock. Move the stock out or adjust it, then deactivate. Nothing changed.',
  ],
  'ITEM_PERCENT_RANGE': [
    'النسبة المئوية لا تزيد عن 100 ولا تقل عن صفر. اكتب نسبة صحيحة ثم احفظ. لم يُحفظ شيء.',
    'A percentage must be between 0 and 100. Enter a valid percentage and save. Nothing was saved.',
  ],
  'STOCKTAKE_KEY_REUSED': [
    'معرّف هذا الطلب استُخدم لجرد مختلف ولم يُنشأ شيء. راجع الجرد السابق أو ابدأ جردًا جديدًا. لم يتغير شيء.',
    'This request identifier was already used for a different count and nothing was created. Review the earlier count or start a new one. Nothing changed.',
  ],
  'STOCKTAKE_BRANCH_FORBIDDEN': [
    'هذا المخزن يتبع فرعًا لا تملك الوصول إليه. اختر مخزنًا من فرعك. لم يتغير شيء.',
    'This warehouse belongs to a branch you cannot access. Choose a warehouse of your branch. Nothing changed.',
  ],
  'STOCKTAKE_PARTIAL_NEEDS_ITEMS': [
    'الجرد الجزئي يحتاج تحديد الأصناف التي يشملها. اختر الأصناف ثم أنشئ الجرد. لم يُحفظ شيء.',
    'A partial count must name the items it covers. Choose the items and create the count. Nothing was saved.',
  ],
  'STOCKTAKE_PARTIAL_ITEMS_INVALID': [
    'الجرد الجزئي يشمل أصنافًا موجودة ومتتبَّعة مخزنيًا فقط. احذف الصنف غير المناسب ثم أعد المحاولة. لم يُحفظ شيء.',
    'A partial count can include only existing stock-tracked items. Remove the unsuitable item and try again. Nothing was saved.',
  ],
  'STOCKTAKE_ITEM_MISSING': [
    'صنف في الجرد غير موجود. حدّث الشاشة واختر الصنف من القائمة. لم يتغير شيء.',
    'A counted item does not exist. Refresh the screen and choose the item from the list. Nothing changed.',
  ],
  'STOCKTAKE_NOT_OPEN': [
    'جلسة الجرد لم تعد مفتوحة للعدّ. حدّث الشاشة وراجع حالتها. لم يتغير شيء.',
    'The count session is no longer open for counting. Refresh the screen and check its status. Nothing changed.',
  ],
  'STOCKTAKE_NOTHING_TO_RECORD': [
    'لا يوجد ما يُسجَّل. اكتب كمية عدٍّ واحدة على الأقل ثم احفظ. لم يتغير شيء.',
    'There is nothing to record. Enter at least one counted quantity and save. Nothing changed.',
  ],
  'STOCKTAKE_LINE_NOT_IN_SESSION': [
    'أحد السطور لا يخص جلسة الجرد هذه. حدّث الشاشة وأعد العدّ. لم يتغير شيء.',
    'A line does not belong to this count session. Refresh the screen and count again. Nothing changed.',
  ],
  'STOCKTAKE_UNCOUNTED_LINES': [
    'لا يمكن إنهاء الجرد وفيه سطور لم تُعدّ. اعدد السطور المتبقية ثم أنهِه. لم يتغير شيء.',
    'The count cannot be finished while some lines are uncounted. Count the remaining lines and finish. Nothing changed.',
  ],
  'STOCKTAKE_APPROVE_STAGE': [
    'لا يُعتمد الجرد إلا بعد عدّ كل سطوره وإرساله للمراجعة. أكمل العدّ وأرسله ثم اعتمده. لم يتغير شيء.',
    'A count can be approved only after every line is counted and submitted for review. Finish counting, submit it, then approve. Nothing changed.',
  ],
  'STOCKTAKE_OWN_APPROVE': [
    'لا يعتمد من فتح الجرد فروقه بنفسه. اطلب الاعتماد من مستخدم آخر. لم يتغير شيء.',
    'The person who opened a count cannot approve its differences. Ask another user to approve. Nothing changed.',
  ],
  'STOCKTAKE_APPROVED_ELSEWHERE': [
    'اعتمد مستخدم آخر هذا الجرد قبل لحظات. حدّث الشاشة وراجع حالته. لم يتغير شيء.',
    'Someone else approved this count a moment ago. Refresh the screen and check its status. Nothing changed.',
  ],
  'STOCKTAKE_POSTED_ELSEWHERE': [
    'رحّل مستخدم آخر هذا الجرد قبل لحظات. حدّث الشاشة وراجع حالته. لم يتغير شيء.',
    'Someone else posted this count a moment ago. Refresh the screen and check its status. Nothing changed.',
  ],
  'STOCKTAKE_DOC_MISMATCH': [
    'مستند الجرد الموجود لا يطابق هذا الجرد المعتمد. راجع المستند مع المحاسب قبل المتابعة. لم يتغير شيء.',
    'The existing stock-take document does not match this approved count. Review the document with an accountant before continuing. Nothing changed.',
  ],
  'STOCKTAKE_POSTED_NO_CANCEL': [
    'لا يُلغى جرد مرحّل. اعكس مستنده بدل إلغائه. لم يتغير شيء.',
    'A posted count cannot be cancelled. Reverse its document instead. Nothing changed.',
  ],
  'WH_ACCESS_WAREHOUSE_REQUIRED': [
    'كل صلاحية تحتاج مخزنًا. اختر مخزنًا لكل سطر ثم احفظ. لم يُحفظ شيء.',
    'Every grant needs a warehouse. Choose a warehouse for each row and save. Nothing was saved.',
  ],
  'WH_ACCESS_DUPLICATE': [
    'المخزن نفسه مكرر في القائمة. أبقِ سطرًا واحدًا لكل مخزن ثم احفظ. لم يُحفظ شيء.',
    'The same warehouse is listed twice. Keep one row per warehouse and save. Nothing was saved.',
  ],
  'WH_ACCESS_NOT_AVAILABLE': [
    'أحد المخازن غير متاح لك. اختر من المخازن المتاحة لك ثم احفظ. لم يُحفظ شيء.',
    'One of the warehouses is not available to you. Choose from the warehouses available to you and save. Nothing was saved.',
  ],
};
