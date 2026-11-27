/// Reviewed sentences for stock documents, transfers and stock vouchers: what
/// happened and how to fix it, `[Arabic, English]`.
const Map<String, List<String>> stockDocumentRefusals = {
  'STOCKDOC_KIND_UNKNOWN': [
    'نوع مستند المخزون غير معروف. اختر نوعًا من القائمة ثم أعد المحاولة. لم يتغير شيء.',
    'The stock document type is not known. Choose a type from the list and try again. Nothing changed.',
  ],
  'STOCKDOC_SEARCH_TOO_LONG': [
    'نص البحث أطول من المسموح (120 حرفًا). اكتب كلمة أقصر ثم أعد البحث. لم يتغير شيء.',
    'The search text is longer than allowed (120 characters). Type a shorter word and search again. Nothing changed.',
  ],
  'STOCKVOUCHER_KIND_UNKNOWN': [
    'نوع إذن المخزون غير معروف. اختر «استلام» أو «صرف» ثم أعد المحاولة. لم يُحفظ شيء.',
    'The stock voucher type is not known. Choose Receipt or Issue and try again. Nothing was saved.',
  ],
  'STOCKVOUCHER_COST_PERMISSION': [
    'تسجيل تكلفة الوحدة في إذن الاستلام يحتاج صلاحية قراءة التكلفة. اطلب الصلاحية من المدير أو احذف التكلفة. لم يُحفظ شيء.',
    'Recording the unit cost on a receipt needs the cost-read permission. Ask an administrator for it or remove the cost. Nothing was saved.',
  ],
  'STOCKVOUCHER_OTHER_BRANCH': [
    'إذن المخزون يخص فرع المستخدم الحالي فقط. سجّله من مستخدم الفرع المطلوب. لم يُحفظ شيء.',
    'A stock voucher must belong to the signed-in branch. Record it from a user of the branch you need. Nothing was saved.',
  ],
  'STOCKDOC_KIND_INVALID': [
    'نوع المستند يجب أن يكون تسوية أو تحويلًا أو جردًا أو إعدام أو رصيدًا افتتاحيًا. اختر نوعًا منها ثم أعد المحاولة. لم يُحفظ شيء.',
    'The document type must be adjustment, transfer, count, write-off or opening. Choose one of them and try again. Nothing was saved.',
  ],
  'STOCKVOUCHER_ADJUSTMENT_ONLY': [
    'إذن المخزون يكون تسوية فقط. اختر نوع التسوية ثم أعد المحاولة. لم يُحفظ شيء.',
    'A stock voucher can only be an adjustment. Choose the adjustment type and try again. Nothing was saved.',
  ],
  'STOCKDOC_USE_OPENING_BALANCE': [
    'الرصيد الافتتاحي للمخزون يُسجَّل في مستند رصيد افتتاحي لأنه يرحّل القيد والمخزون معًا. استخدم شاشة الأرصدة الافتتاحية. لم يُحفظ شيء.',
    'Opening stock is entered on an opening balance document because it posts the accounting and the stock together. Use the opening balances screen. Nothing was saved.',
  ],
  'STOCKVOUCHER_FIELDS_REQUIRED': [
    'إذن المخزون يحتاج مخزنًا وسببًا واسم الطرف المقابل (لا يزيد عن 200 حرف). أكمل الحقول ثم احفظ. لم يُحفظ شيء.',
    'A stock voucher needs a warehouse, a reason and a counterparty name (up to 200 characters). Fill the fields and save. Nothing was saved.',
  ],
  'IDEMPOTENCY_KEY_REUSED': [
    'معرّف هذا الطلب استُخدم من قبل لمستند آخر. أغلق الشاشة وافتحها من جديد ثم أعد المحاولة. لم يُحفظ شيء.',
    'This request identifier was already used for another document. Close the screen, open it again and retry. Nothing was saved.',
  ],
  'STOCKDOC_TARGET_BRANCH_INVALID': [
    'الفرع المستلم ليس من فروع هذه الشركة. اختر فرعًا من القائمة ثم أعد المحاولة. لم يُحفظ شيء.',
    'The receiving branch is not one of this company\'s branches. Choose a branch from the list and try again. Nothing was saved.',
  ],
  'STOCKDOC_TRANSFER_NO_COST_CENTER': [
    'تحويل المخزون لا يحمل مركز تكلفة لأنه ليس مصروفًا. أزل مركز التكلفة ثم احفظ. لم يُحفظ شيء.',
    'A stock transfer cannot carry a cost center because it is not an expense. Remove the cost center and save. Nothing was saved.',
  ],
  'STOCKDOC_COST_CENTER_INVALID': [
    'مركز التكلفة المختار غير صالح. اخترْه من القائمة أو اتركه فارغًا ثم أعد المحاولة. لم يُحفظ شيء.',
    'The chosen cost center is not valid. Choose it from the list or leave it empty and try again. Nothing was saved.',
  ],
  'STOCKVOUCHER_LINE_UNIT_COST_REQUIRED': [
    'سطر الاستلام يحتاج تكلفة الوحدة. اكتب التكلفة في كل سطر ثم احفظ. لم يُحفظ شيء.',
    'A receipt line needs a unit cost. Enter the cost on every line and save. Nothing was saved.',
  ],
  'STOCKVOUCHER_LINE_QTY_REQUIRED': [
    'يوجد سطر بلا كمية. اكتب الكمية أو احذف السطر ثم احفظ. لم يُحفظ شيء.',
    'A line has no quantity. Enter the quantity or delete the line and save. Nothing was saved.',
  ],
  'STOCKVOUCHER_RECEIPT_QTY_POSITIVE': [
    'كمية الاستلام يجب أن تكون أكبر من صفر. صحّح الكمية ثم احفظ. لم يُحفظ شيء.',
    'The receipt quantity must be above zero. Correct the quantity and save. Nothing was saved.',
  ],
  'STOCKVOUCHER_ISSUE_QTY_NEGATIVE': [
    'كمية الصرف تُسجَّل بالسالب. صحّح الكمية ثم احفظ. لم يُحفظ شيء.',
    'The issue quantity must be negative. Correct the quantity and save. Nothing was saved.',
  ],
  'STOCKDOC_TRANSFER_QTY_POSITIVE': [
    'كمية التحويل يجب أن تكون أكبر من صفر. صحّح الكمية ثم احفظ. لم يُحفظ شيء.',
    'The transfer quantity must be above zero. Correct the quantity and save. Nothing was saved.',
  ],
  'STOCKDOC_COUNT_QTY_REQUIRED': [
    'سطر الجرد يحتاج الكمية التي عُدّت فعلًا. اكتبها أو احذف السطر ثم احفظ. لم يُحفظ شيء.',
    'A count line needs the quantity that was actually counted. Enter it or delete the line and save. Nothing was saved.',
  ],
  'STOCKVOUCHER_LINE_COST_NEGATIVE': [
    'تكلفة الوحدة لا تكون سالبة. اكتب تكلفة صفر أو أكبر ثم احفظ. لم يُحفظ شيء.',
    'The unit cost cannot be negative. Enter zero or more and save. Nothing was saved.',
  ],
  'STOCKVOUCHER_LINE_VALUE_RANGE': [
    'قيمة المخزون في أحد السطور أكبر من الحد المسموح. اكتب كمية أو تكلفة أصغر ثم احفظ. لم يُحفظ شيء.',
    'The stock value of a line is above the allowed limit. Enter a smaller quantity or cost and save. Nothing was saved.',
  ],
  'STOCKVOUCHER_LINE_LOT_MISMATCH': [
    'الدفعة المختارة لا تخص هذا الصنف. اختر دفعة الصنف نفسه ثم احفظ. لم يُحفظ شيء.',
    'The chosen lot does not belong to this item. Choose a lot of the same item and save. Nothing was saved.',
  ],
  'STOCKDOC_SOURCE_BRANCH_INVALID': [
    'الفرع المُرسِل ليس من فروع هذه الشركة. اختر فرعًا من القائمة ثم أعد المحاولة. لم يُحفظ شيء.',
    'The sending branch is not one of this company\'s branches. Choose a branch from the list and try again. Nothing was saved.',
  ],
  'STOCKVOUCHER_VERSION_INVALID': [
    'رقم نسخة الإذن غير صالح. حدّث الشاشة وافتح الإذن من جديد ثم أعد المحاولة. لم يتغير شيء.',
    'The voucher version number is not valid. Refresh the screen, open the voucher again and retry. Nothing changed.',
  ],
  'STOCKVOUCHER_EDIT_NOT_DRAFT': [
    'لا يُعدَّل إلا إذن المخزون وهو مسودة. حدّث الشاشة وراجع حالته. لم يتغير شيء.',
    'Only a draft stock voucher can be edited. Refresh the screen and check its status. Nothing changed.',
  ],
  'STOCKVOUCHER_NOTES_INVALID': [
    'الملاحظات يجب أن تكون نصًا. اكتب الملاحظات كنص ثم احفظ. لم يُحفظ شيء.',
    'The notes must be text. Enter the notes as text and save. Nothing was saved.',
  ],
  'STOCKVOUCHER_LINE_COUNT': [
    'إذن المخزون يحتاج من سطر إلى 1000 سطر. أضف سطرًا أو قسّم الإذن ثم احفظ. لم يُحفظ شيء.',
    'A stock voucher needs between 1 and 1000 lines. Add a line or split the voucher and save. Nothing was saved.',
  ],
  'STOCKVOUCHER_LINE_ITEM_REQUIRED': [
    'يوجد سطر بلا صنف. اختر الصنف أو احذف السطر ثم احفظ. لم يُحفظ شيء.',
    'A line has no item. Choose the item or delete the line and save. Nothing was saved.',
  ],
  'STOCKVOUCHER_LINE_ID_INVALID': [
    'معرّف أحد السطور غير صالح أو مكرر. حدّث الشاشة وافتح الإذن من جديد. لم يتغير شيء.',
    'A line identifier is not valid or is duplicated. Refresh the screen and open the voucher again. Nothing changed.',
  ],
  'STOCKVOUCHER_LINE_UNIT_NAME_REQUIRED': [
    'عند تعديل الإذن يُكتب اسم الوحدة في كل سطر. اختر الوحدة ثم احفظ. لم يُحفظ شيء.',
    'When editing a voucher, each line must name its unit. Choose the unit and save. Nothing was saved.',
  ],
  'STOCKVOUCHER_LINE_ITEM_MISSING': [
    'صنف أحد السطور غير موجود. اختر الصنف من القائمة ثم احفظ. لم يُحفظ شيء.',
    'The item of a line does not exist. Choose the item from the list and save. Nothing was saved.',
  ],
  'STOCKVOUCHER_LINE_QTY_INVALID': [
    'كمية أحد السطور غير صالحة. اكتب رقمًا صحيحًا ثم احفظ. لم يُحفظ شيء.',
    'The quantity of a line is not valid. Enter a valid number and save. Nothing was saved.',
  ],
  'STOCKVOUCHER_LINE_UNIT_SNAPSHOT_INVALID': [
    'بيانات الوحدة المحفوظة في أحد السطور غير صالحة. اختر الوحدة من جديد في ذلك السطر ثم احفظ. لم يتغير شيء.',
    'The saved unit data of a line is not valid. Choose the unit again on that line and save. Nothing changed.',
  ],
  'STOCKVOUCHER_LINE_VALUE_INVALID': [
    'قيمة المخزون في أحد السطور غير صالحة. راجع الكمية والتكلفة ثم احفظ. لم يُحفظ شيء.',
    'The stock value of a line is not valid. Check the quantity and cost and save. Nothing was saved.',
  ],
  'STOCKVOUCHER_REVIEW_NOT_DRAFT': [
    'لا يُراجَع ولا يُعتمد إلا إذن المخزون وهو مسودة. حدّث الشاشة وراجع حالته. لم يتغير شيء.',
    'Only a draft stock voucher can be reviewed or approved. Refresh the screen and check its status. Nothing changed.',
  ],
  'STOCKVOUCHER_REVIEW_REQUIRED': [
    'يجب مراجعة إذن المخزون قبل اعتماده. اطلب المراجعة ثم اعتمده. لم يتغير شيء.',
    'The stock voucher must be reviewed before approval. Have it reviewed, then approve it. Nothing changed.',
  ],
  'WRITEOFF_APPROVE_NOT_DRAFT': [
    'لا يُعتمد إلا إعدام المخزون وهو مسودة. حدّث الشاشة وراجع حالته. لم يتغير شيء.',
    'Only a draft write-off can be approved. Refresh the screen and check its status. Nothing changed.',
  ],
  'STOCKVOUCHER_VERSION_REQUIRED': [
    'ترحيل إذن المخزون يحتاج رقم نسخته. حدّث الشاشة وافتح الإذن من جديد ثم رحّله. لم يتغير شيء.',
    'Posting a stock voucher needs its version number. Refresh the screen, open the voucher again and post it. Nothing changed.',
  ],
  'STOCKDOC_POST_NOT_DRAFT': [
    'لا يُرحَّل إلا مستند المخزون وهو مسودة. حدّث الشاشة وراجع حالته. لم يتغير شيء.',
    'Only a draft stock document can be posted. Refresh the screen and check its status. Nothing changed.',
  ],
  'STOCKDOC_TRANSFER_SHORT_STOCK': [
    'الكمية المتاحة في المخزن المُرسِل أقل من كمية التحويل. اكتب كمية أقل أو استلم الرصيد أولًا ثم أعد المحاولة. لم يتغير شيء.',
    'The sending warehouse holds less than the transfer quantity. Enter a smaller quantity or receive the stock first, then try again. Nothing changed.',
  ],
  'STOCKDOC_REVERSE_NEGATIVE_TRANSFER': [
    'لا يمكن عكس هذا التحويل تلقائيًا لأن فيه كميات سالبة. تواصل مع الدعم الفني. لم يتغير شيء.',
    'This transfer cannot be reversed automatically because it has negative quantities. Contact support. Nothing changed.',
  ],
  'STOCKDOC_REVERSE_COST_DIFFERS': [
    'لا يمكن عكس التحويل تلقائيًا لأن تكلفة حركتي الإخراج والإدخال الأصليتين مختلفة. راجع الحركتين مع المحاسب. لم يتغير شيء.',
    'The transfer cannot be reversed automatically because the costs of its original out and in movements differ. Review the two movements with an accountant. Nothing changed.',
  ],
  'STOCKDOC_SHORT_STOCK': [
    'الكمية المتاحة في المخزن أقل من المطلوب صرفه. اكتب كمية أقل أو استلم الرصيد أولًا ثم أعد المحاولة. لم يتغير شيء.',
    'The warehouse holds less than the quantity to issue. Enter a smaller quantity or receive the stock first, then try again. Nothing changed.',
  ],
  'STOCKDOC_NUMBER_INVALID': [
    'إحدى القيم ليست رقمًا صالحًا. اكتب أرقامًا فقط ثم احفظ. لم يُحفظ شيء.',
    'One of the values is not a valid number. Enter numbers only and save. Nothing was saved.',
  ],
  'STOCKDOC_NUMBER_RANGE': [
    'إحدى القيم خارج الحد أو الدقة المسموحة. اكتب رقمًا أصغر وبكسور أقل ثم احفظ. لم يُحفظ شيء.',
    'One of the values is outside the allowed range or precision. Enter a smaller number with fewer decimals and save. Nothing was saved.',
  ],
};
