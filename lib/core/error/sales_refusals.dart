/// Reviewed sentences for sales invoice, sales order, quotation, price list and
/// credit-approval refusals: what happened and how to fix it, `[Arabic, English]`.
const Map<String, List<String>> salesRefusals = {
  'SALES_ORDER_NO_LINES': [
    'الأمر بلا سطور. أضف سطرًا واحدًا على الأقل ثم احفظ. لم يُحفظ شيء.',
    'The order has no lines. Add at least one line and save. Nothing was saved.',
  ],
  'SALES_ORDER_NOT_EDITABLE': [
    'حالة الأمر لا تسمح بالتعديل: المسودة تُعدَّل، والمعتمد أو المنفّذ جزئيًا يُعدَّل بالتعديل الرسمي فقط. حدّث الشاشة لترى حالته. لم يتغير شيء.',
    'The order state does not allow this edit: a draft can be edited, and an approved or partly fulfilled order only through an amendment. Reload the screen to see its state. Nothing changed.',
  ],
  'SALES_ORDER_HAS_INVOICES_EDIT': [
    'على هذا الأمر فواتير سابقة فلا يُعدَّل كمسودة. استخدم التعديل الرسمي للأمر. لم يتغير شيء.',
    'This order already has invoices, so it cannot be edited as a draft. Use an order amendment. Nothing changed.',
  ],
  'SALES_ORDER_NOT_DRAFT_APPROVE': [
    'لا يُعتمد إلا الأمر في حالة مسودة. حدّث الشاشة لترى حالته. لم يتغير شيء.',
    'Only a draft order can be approved. Reload the screen to see its state. Nothing changed.',
  ],
  'SALES_ORDER_SELF_APPROVE': [
    'فصل المهام مفعّل: من أنشأ الأمر لا يعتمده. اطلب من مستخدم آخر لديه صلاحية الاعتماد. لم يتغير شيء.',
    'Segregation of duties is on: the person who raised the order cannot approve it. Ask another user who has the approval permission. Nothing changed.',
  ],
  'SALES_ORDER_APPROVED_ELSEWHERE': [
    'اعتمد مستخدم آخر هذا الأمر قبل لحظات. حدّث الشاشة لترى حالته. لم يتغير شيء.',
    'Someone else approved this order a moment ago. Reload the screen to see its state. Nothing changed.',
  ],
  'SALES_ORDER_CANCELLED': [
    'هذا الأمر ملغى بالفعل. حدّث الشاشة لترى حالته. لم يتغير شيء.',
    'This order is already cancelled. Reload the screen to see its state. Nothing changed.',
  ],
  'SALES_ORDER_HAS_INVOICES_CANCEL': [
    'على الأمر فواتير فعّالة. اعكس هذه الفواتير أولًا ثم ألغِ الأمر. لم يتغير شيء.',
    'The order has active invoices. Reverse those invoices first, then cancel the order. Nothing changed.',
  ],
  'SALES_ORDER_INVOICE_INACTIVE': [
    'الفاتورة المرتبطة بهذه العملية لم تعد فعّالة. حدّث الشاشة وابدأ فاتورة جديدة من الأمر. لم يتغير شيء.',
    'The invoice linked to this action is no longer active. Reload the screen and start a new invoice from the order. Nothing changed.',
  ],
  'SALES_ORDER_CANCELLED_INVOICE': [
    'الأمر ملغى فلا يُفوتَر. اختر أمرًا آخر أو أنشئ أمرًا جديدًا. لم يتغير شيء.',
    'A cancelled order cannot be invoiced. Choose another order or create a new one. Nothing changed.',
  ],
  'SALES_ORDER_NOT_APPROVED': [
    'اعتمد الأمر أولًا ثم أنشئ فاتورته. لم يتغير شيء.',
    'Approve the order first, then create its invoice. Nothing changed.',
  ],
  'SALES_ORDER_OVER_OUTSTANDING': [
    'الكمية المطلوبة في أحد السطور أكبر من المتبقي من الأمر. اكتب كمية أقل أو تساوي المتبقي. لم يُحفظ شيء.',
    'The quantity on a line is more than what is still outstanding on the order. Enter the outstanding quantity or less. Nothing was saved.',
  ],
  'SALES_ORDER_FULLY_INVOICED': [
    'هذا الأمر فوتر بالكامل ولا يتبقى منه شيء. لا حاجة لفاتورة أخرى. لم يتغير شيء.',
    'This order is fully invoiced and nothing is outstanding, so no further invoice is needed. Nothing changed.',
  ],
  'SALES_STATUS_UNKNOWN': [
    'الحالة المطلوبة للتصفية غير معروفة. اختر حالة من القائمة.',
    'The status you filtered by is not recognised. Choose a status from the list.',
  ],
  'SALES_CUSTOMER_MISSING': [
    'العميل المختار غير موجود في هذه الشركة. حدّث الشاشة واختر العميل من القائمة. لم يُحفظ شيء.',
    'The chosen customer does not exist in this company. Reload the screen and choose the customer from the list. Nothing was saved.',
  ],
  'SALES_ENTRY_MISSING': [
    'قيد اليومية الأصلي لهذه الفاتورة غير موجود فلا يمكن عكسها. راجع المحاسب قبل أي إجراء. لم يتغير شيء.',
    'The original journal entry of this invoice is missing, so it cannot be reversed. Check with your accountant before doing anything else. Nothing changed.',
  ],
  'SALES_HAS_RETURNS': [
    'على هذه الفاتورة مرتجعات مرحّلة. اعكس مرتجعات البيع أولًا ثم اعكس الفاتورة. لم يتغير شيء.',
    'This invoice has posted returns. Reverse the sales returns first, then reverse the invoice. Nothing changed.',
  ],
  'SALES_UNIT_SNAPSHOT': [
    'وحدات قياس الأمر لا تطابق سطور الفاتورة. حدّث الشاشة وأنشئ الفاتورة من الأمر من جديد. لم يُحفظ شيء.',
    'The order unit details do not match the invoice lines. Reload the screen and create the invoice from the order again. Nothing was saved.',
  ],
  'SALES_PERCENT_RANGE': [
    'النسبة المكتوبة خارج المسموح، يجب أن تكون بين 0 و100. صحّحها ثم احفظ. لم يُحفظ شيء.',
    'The percentage is out of range; it must be between 0 and 100. Correct it and save. Nothing was saved.',
  ],
  'SALES_NUMBER_INVALID': [
    'قيمة رقمية في الفاتورة غير صحيحة. اكتب أرقامًا فقط (مثل 150 أو 12.5) ثم احفظ. لم يُحفظ شيء.',
    'A number on the document is not valid. Enter digits only (for example 150 or 12.5) and save. Nothing was saved.',
  ],
  'SALES_DATE_INVALID': [
    'تاريخ غير صحيح. اختر التاريخ من التقويم أو اكتبه بصيغة يوم/شهر/سنة صحيحة. لم يُحفظ شيء.',
    'A date is not valid. Pick the date from the calendar or type a real date. Nothing was saved.',
  ],
  'SALES_LINE_ITEM_GONE': [
    'أحد أصناف الفاتورة لم يعد موجودًا. حدّث الشاشة واختر صنفًا آخر للسطر. لم يتغير شيء.',
    'An item on the invoice no longer exists. Reload the screen and choose another item for the line. Nothing changed.',
  ],
  'SALES_CHARGE_NO_ITEM': [
    'الرسوم الإضافية لا تُربط بصنف أو بأمر بيع. احذف الصنف من سطر الرسوم. لم يُحفظ شيء.',
    'Additional charges cannot be linked to an item or an order. Remove the item from the charge line. Nothing was saved.',
  ],
  'SALES_CHARGE_QTY_ONE': [
    'سطر الرسوم الإضافية كميته واحد ولا يقبل خصمًا. اجعل الكمية 1 وامسح الخصم. لم يُحفظ شيء.',
    'An additional charge must have quantity one and no line discount. Set the quantity to 1 and clear the discount. Nothing was saved.',
  ],
  'SALES_LINE_ITEM_OR_TEXT': [
    'أحد السطور بلا صنف وبلا وصف. اختر صنفًا أو اكتب وصفًا للسطر. لم يُحفظ شيء.',
    'A line has neither an item nor a description. Choose an item or write a description for the line. Nothing was saved.',
  ],
  'SALES_LINE_PRICE_REQUIRED': [
    'سطر بلا صنف يحتاج سعرًا. اكتب السعر في السطر أو اختر صنفًا. لم يُحفظ شيء.',
    'A line without an item needs a price. Enter the price on the line or choose an item. Nothing was saved.',
  ],
  'CREDIT_NO_PERIOD_APPROVAL': [
    'هذه الفاتورة لا تحتاج موافقة على مدة السداد. يمكنك ترحيلها مباشرة. لم يتغير شيء.',
    'This invoice does not need payment-period approval. You can post it directly. Nothing changed.',
  ],
  'CREDIT_NO_APPROVAL_NEEDED': [
    'هذه الفاتورة لا تحتاج موافقة على الحد الائتماني. يمكنك ترحيلها مباشرة. لم يتغير شيء.',
    'This invoice does not need credit-limit approval. You can post it directly. Nothing changed.',
  ],
  'PRICELIST_ITEM_MISSING': [
    'الصنف غير موجود في هذه الشركة. حدّث الشاشة واختر الصنف من القائمة. لم يُحفظ شيء.',
    'The item does not exist in this company. Reload the screen and choose the item from the list. Nothing was saved.',
  ],
  'PRICELIST_KIND_UNKNOWN': [
    'نوع قائمة الأسعار غير معروف. اختر «عملاء» أو «موردين». لم يُحفظ شيء.',
    'The price list type is not recognised. Choose "Customers" or "Suppliers". Nothing was saved.',
  ],
  'PRICELIST_CUSTOMER_MISSING': [
    'العميل غير موجود في هذه الشركة. حدّث الشاشة واختر العميل من القائمة. لم يُحفظ شيء.',
    'The customer does not exist in this company. Reload the screen and choose the customer from the list. Nothing was saved.',
  ],
  'PRICELIST_SUPPLIER_MISSING': [
    'المورد غير موجود في هذه الشركة. حدّث الشاشة واختر المورد من القائمة. لم يُحفظ شيء.',
    'The supplier does not exist in this company. Reload the screen and choose the supplier from the list. Nothing was saved.',
  ],
  'QUOTE_STATUS_UNKNOWN': [
    'حالة عرض السعر المطلوبة غير معروفة. اختر حالة من القائمة.',
    'The quotation status you asked for is not recognised. Choose a status from the list.',
  ],
  'QUOTE_CONVERTED_LOCKED': [
    'تحوّل عرض السعر إلى فاتورة فلا تتغير حالته. افتح الفاتورة للمتابعة. لم يتغير شيء.',
    'The quotation has become an invoice, so its status can no longer change. Open the invoice to continue. Nothing changed.',
  ],
  'QUOTE_ALREADY_STATUS': [
    'عرض السعر في هذه الحالة بالفعل. حدّث الشاشة لترى حالته. لم يتغير شيء.',
    'The quotation is already in this status. Reload the screen to see its state. Nothing changed.',
  ],
  'QUOTE_DRAFT_NOT_REVISED': [
    'المسودة تُعدَّل مباشرة، والمراجعة للعروض المُصدَرة فقط. عدّل المسودة بدل إنشاء مراجعة. لم يتغير شيء.',
    'A draft is edited directly; revisions are for issued quotations. Edit the draft instead of creating a revision. Nothing changed.',
  ],
  'QUOTE_FOLLOWUP_TEXT': [
    'اكتب ما دار في المتابعة قبل الحفظ. لم يُحفظ شيء.',
    'Write what was discussed before saving the follow-up. Nothing was saved.',
  ],
  'QUOTE_NOT_ACCEPTED': [
    'لا يتحول إلى فاتورة إلا عرض سعر مقبول. سجّل قرار العميل بالقبول أولًا ثم حوّله. لم يتغير شيء.',
    'Only an accepted quotation can become an invoice. Record the customer acceptance first, then convert it. Nothing changed.',
  ],
  'QUOTE_TOTALS_DIFFER': [
    'إجماليات الفاتورة تختلف عن عرض السعر المقبول. راجع الضريبة والخصومات ثم أعد التحويل. لم يتغير شيء.',
    'The invoice totals differ from the accepted quotation. Review tax and discounts, then convert again. Nothing changed.',
  ],
  'QUOTE_ISSUED_LOCKED': [
    'عرض السعر أُصدر ولا يُعدَّل. أنشئ مراجعة جديدة منه بدل التعديل. لم يتغير شيء.',
    'This quotation has been issued and can no longer be edited. Start a revision instead. Nothing changed.',
  ],
  'QUOTE_TABLE_TITLE': [
    'أحد الجداول بلا عنوان. اكتب عنوانًا للجدول ثم احفظ. لم يُحفظ شيء.',
    'A table has no title. Give the table a title and save. Nothing was saved.',
  ],
  'QUOTE_ITEM_MISSING': [
    'أحد الأصناف في العرض غير موجود. اختر الصنف من القائمة مرة أخرى. لم يُحفظ شيء.',
    'An item in the quotation does not exist. Choose the item from the list again. Nothing was saved.',
  ],
  'QUOTE_ITEM_INACTIVE': [
    'أحد الأصناف في العرض متوقف. فعّله من شاشة الأصناف أو اختر صنفًا آخر. لم يُحفظ شيء.',
    'An item in the quotation is inactive. Activate it in the items screen or choose another one. Nothing was saved.',
  ],
  'QUOTE_ITEM_OR_TEXT': [
    'أحد السطور بلا صنف وبلا وصف. اختر صنفًا أو اكتب وصفًا. لم يُحفظ شيء.',
    'A line has neither an item nor a description. Choose an item or write a description. Nothing was saved.',
  ],
  'QUOTE_BG_SIZE': [
    'ملف الخلفية فارغ أو أكبر من 5 ميجابايت. اختر ملف PDF أصغر. لم يُرفع شيء.',
    'The background file is empty or larger than 5 MB. Choose a smaller PDF. Nothing was uploaded.',
  ],
  'QUOTE_BG_NOT_PDF': [
    'الملف المختار ليس PDF. اختر ملف PDF للخلفية. لم يُرفع شيء.',
    'The chosen file is not a PDF. Choose a PDF file for the background. Nothing was uploaded.',
  ],
  'QUOTE_BG_UNREADABLE': [
    'تعذّرت قراءة ملف الخلفية، فقد يكون محميًا بكلمة مرور أو تالفًا. احفظ نسخة جديدة منه بلا حماية وأعد الرفع. لم يُرفع شيء.',
    'The background PDF could not be read; it may be password-protected or damaged. Save a fresh copy without protection and upload again. Nothing was uploaded.',
  ],
  'QUOTE_BG_PAGE': [
    'رقم الصفحة المختارة غير موجود في ملف الخلفية. اختر صفحة من الصفحات الموجودة. لم يُحفظ شيء.',
    'The chosen page does not exist in the background file. Choose one of the existing pages. Nothing was saved.',
  ],
  'QUOTE_DESIGN_INVALID': [
    'تصميم عرض السعر غير صالح. أعد فتح محرر التصميم واحفظ مرة أخرى. لم يُحفظ شيء.',
    'The quotation design is not valid. Reopen the design editor and save again. Nothing was saved.',
  ],
  'QUOTE_DESIGN_TOO_BIG': [
    'تصميم عرض السعر كبير جدًا. احذف بعض العناصر أو الصور ثم احفظ. لم يُحفظ شيء.',
    'The quotation design is too large. Remove some elements or images and save. Nothing was saved.',
  ],
};
