/// Reviewed sentences for purchase invoice and purchase order refusals:
/// what happened and how to fix it, `[Arabic, English]`.
const Map<String, List<String>> purchaseRefusals = {
  'PURCHASE_STATUS_UNKNOWN': [
    'الحالة المطلوبة للتصفية غير معروفة. اختر حالة من القائمة.',
    'The status you filtered by is not recognised. Choose a status from the list.',
  ],
  'PURCHASE_RETURN_NOT_EDITABLE': [
    'هذا مستند مرتجع ولا يُعدَّل من شاشة فواتير الشراء. افتحه من شاشة المرتجعات. لم يتغير شيء.',
    'This is a return document and cannot be edited as a purchase invoice. Open it in the returns screen. Nothing changed.',
  ],
  'PURCHASE_NOT_DRAFT_EDIT': [
    'لا تُعدَّل إلا فاتورة الشراء في حالة مسودة. حدّث الشاشة لترى حالتها، أو اعكسها وأنشئ فاتورة جديدة. لم يتغير شيء.',
    'Only a draft purchase invoice can be edited. Reload the screen to see its state, or reverse it and create a new invoice. Nothing changed.',
  ],
  'PURCHASE_OTHER_BRANCH_EDIT': [
    'هذه المسودة تتبع فرعًا آخر ولا يعدّلها إلا مستخدم هذا الفرع. اطلب من مستخدم الفرع تعديلها. لم يتغير شيء.',
    'This draft belongs to another branch and only a user of that branch can edit it. Ask a user of that branch to edit it. Nothing changed.',
  ],
  'PURCHASE_CHANGED_RELOAD': [
    'تغيّرت الفاتورة بواسطة مستخدم آخر. حدّث الشاشة ثم أعد تعديلك. لم يُحفظ تعديلك.',
    'The invoice was changed by someone else. Reload the screen and make your edit again. Your edit was not saved.',
  ],
  'PURCHASE_NOT_DRAFT_CANCEL': [
    'لا يُلغى إلا الفاتورة في حالة مسودة. إن كانت مرحّلة فاعكسها بدلًا من الإلغاء. لم يتغير شيء.',
    'Only a draft invoice can be cancelled. If it is posted, reverse it instead. Nothing changed.',
  ],
  'PURCHASE_LINE_NO_ITEM': [
    'أحد سطور الفاتورة بلا صنف فلا يمكن ترحيله أو إرجاعه للمخزون. اختر الصنف في السطر أو احذف السطر. لم يتغير شيء.',
    'A line of the invoice has no item, so it cannot be posted to or returned from stock. Choose the item on the line or delete the line. Nothing changed.',
  ],
  'PURCHASE_ENTRY_MISSING': [
    'قيد اليومية الأصلي لهذه الفاتورة غير موجود فلا يمكن عكسها. راجع المحاسب قبل أي إجراء. لم يتغير شيء.',
    'The original journal entry of this invoice is missing, so it cannot be reversed. Check with your accountant before doing anything else. Nothing changed.',
  ],
  'PURCHASE_HAS_RETURNS': [
    'على هذه الفاتورة مرتجعات مرحّلة. اعكس مرتجعات الشراء أولًا ثم اعكس الفاتورة. لم يتغير شيء.',
    'This invoice has posted returns. Reverse the purchase returns first, then reverse the invoice. Nothing changed.',
  ],
  'PURCHASE_STOCK_ALREADY_USED': [
    'لا يمكن عكس هذه الفاتورة لأن جزءًا من بضاعتها بيع أو نُقل، والعكس سيجعل رصيد المخزون سالبًا. أعد البضاعة للمخزن أو أنشئ مرتجعًا بدل العكس. لم يتغير شيء.',
    'This invoice cannot be reversed because part of its stock has been sold or moved, which would make the stock balance negative. Bring the stock back or make a return instead. Nothing changed.',
  ],
  'PURCHASE_TOO_MANY_CHARGES': [
    'عدد بنود تكاليف الشحن والجمارك أكثر من الحد (50). ادمج بعض البنود ثم احفظ. لم يُحفظ شيء.',
    'There are more shipping and customs charges than the limit (50). Combine some of them and save. Nothing was saved.',
  ],
  'PURCHASE_CHARGE_DESCRIPTION': [
    'وصف أحد بنود التكلفة فارغ أو أطول من 120 حرفًا. اكتب وصفًا من 1 إلى 120 حرفًا. لم يُحفظ شيء.',
    'The description of a cost charge is empty or longer than 120 characters. Write a description of 1 to 120 characters. Nothing was saved.',
  ],
  'PURCHASE_CHARGES_MISMATCH': [
    'إجمالي التكاليف الإضافية لا يساوي مجموع البنود المسمّاة. صحّح الإجمالي أو البنود حتى يتطابقا. لم يُحفظ شيء.',
    'The total of the extra costs does not equal the sum of the named charges. Correct the total or the charges so they match. Nothing was saved.',
  ],
  'PURCHASE_UNIT_SNAPSHOT': [
    'وحدات قياس الأمر لا تطابق سطور الفاتورة. حدّث الشاشة وأنشئ الفاتورة من الأمر من جديد. لم يُحفظ شيء.',
    'The order unit details do not match the invoice lines. Reload the screen and create the invoice from the order again. Nothing was saved.',
  ],
  'PURCHASE_PRICE_REQUIRED': [
    'أحد السطور بلا سعر شراء، وليس للصنف سعر محفوظ. اكتب سعر الشراء في السطر ثم احفظ. لم يُحفظ شيء.',
    'A line has no purchase price and the item has no saved price. Enter the purchase price on the line and save. Nothing was saved.',
  ],
  'PURCHASE_PERCENT_RANGE': [
    'النسبة المكتوبة خارج المسموح، يجب أن تكون بين 0 و100. صحّحها ثم احفظ. لم يُحفظ شيء.',
    'The percentage is out of range; it must be between 0 and 100. Correct it and save. Nothing was saved.',
  ],
  'PURCHASE_NUMBER_INVALID': [
    'قيمة رقمية في الفاتورة غير صحيحة. اكتب أرقامًا فقط (مثل 150 أو 12.5) ثم احفظ. لم يُحفظ شيء.',
    'A number on the document is not valid. Enter digits only (for example 150 or 12.5) and save. Nothing was saved.',
  ],
  'PURCHASE_DATE_INVALID': [
    'تاريخ غير صحيح. اختر التاريخ من التقويم أو اكتبه بصيغة يوم/شهر/سنة صحيحة. لم يُحفظ شيء.',
    'A date is not valid. Pick the date from the calendar or type a real date. Nothing was saved.',
  ],
  'PURCHASE_SUPPLIER_MISSING': [
    'المورد المختار غير موجود في هذه الشركة. حدّث الشاشة واختر المورد من القائمة. لم يُحفظ شيء.',
    'The chosen supplier does not exist in this company. Reload the screen and choose the supplier from the list. Nothing was saved.',
  ],
  'PURCHASE_ORDER_NO_LINES': [
    'الأمر بلا سطور. أضف سطرًا واحدًا على الأقل ثم احفظ. لم يُحفظ شيء.',
    'The order has no lines. Add at least one line and save. Nothing was saved.',
  ],
  'PURCHASE_ORDER_NOT_EDITABLE': [
    'حالة الأمر لا تسمح بالتعديل: المسودة تُعدَّل، والمعتمد أو المنفّذ جزئيًا يُعدَّل بالتعديل الرسمي فقط. حدّث الشاشة لترى حالته. لم يتغير شيء.',
    'The order state does not allow this edit: a draft can be edited, and an approved or partly fulfilled order only through an amendment. Reload the screen to see its state. Nothing changed.',
  ],
  'PURCHASE_ORDER_HAS_INVOICES_EDIT': [
    'على هذا الأمر فواتير سابقة فلا يُعدَّل كمسودة. استخدم التعديل الرسمي للأمر. لم يتغير شيء.',
    'This order already has invoices, so it cannot be edited as a draft. Use an order amendment. Nothing changed.',
  ],
  'PURCHASE_ORDER_NOT_DRAFT_APPROVE': [
    'لا يُعتمد إلا الأمر في حالة مسودة. حدّث الشاشة لترى حالته. لم يتغير شيء.',
    'Only a draft order can be approved. Reload the screen to see its state. Nothing changed.',
  ],
  'PURCHASE_ORDER_SELF_APPROVE': [
    'فصل المهام مفعّل: من أنشأ الأمر لا يعتمده. اطلب من مستخدم آخر لديه صلاحية الاعتماد. لم يتغير شيء.',
    'Segregation of duties is on: the person who raised the order cannot approve it. Ask another user who has the approval permission. Nothing changed.',
  ],
  'PURCHASE_ORDER_APPROVED_ELSEWHERE': [
    'اعتمد مستخدم آخر هذا الأمر قبل لحظات. حدّث الشاشة لترى حالته. لم يتغير شيء.',
    'Someone else approved this order a moment ago. Reload the screen to see its state. Nothing changed.',
  ],
  'PURCHASE_ORDER_CANCELLED': [
    'هذا الأمر ملغى بالفعل. حدّث الشاشة لترى حالته. لم يتغير شيء.',
    'This order is already cancelled. Reload the screen to see its state. Nothing changed.',
  ],
  'PURCHASE_ORDER_HAS_INVOICES_CANCEL': [
    'على الأمر فواتير فعّالة. اعكس هذه الفواتير أولًا ثم ألغِ الأمر. لم يتغير شيء.',
    'The order has active invoices. Reverse those invoices first, then cancel the order. Nothing changed.',
  ],
  'PURCHASE_ORDER_INVOICE_INACTIVE': [
    'الفاتورة المرتبطة بهذه العملية لم تعد فعّالة. حدّث الشاشة وابدأ فاتورة جديدة من الأمر. لم يتغير شيء.',
    'The invoice linked to this action is no longer active. Reload the screen and start a new invoice from the order. Nothing changed.',
  ],
  'PURCHASE_ORDER_CANCELLED_INVOICE': [
    'الأمر ملغى فلا يُفوتَر. اختر أمرًا آخر أو أنشئ أمرًا جديدًا. لم يتغير شيء.',
    'A cancelled order cannot be invoiced. Choose another order or create a new one. Nothing changed.',
  ],
  'PURCHASE_ORDER_NOT_APPROVED': [
    'اعتمد الأمر أولًا ثم أنشئ فاتورته. لم يتغير شيء.',
    'Approve the order first, then create its invoice. Nothing changed.',
  ],
  'PURCHASE_ORDER_OVER_OUTSTANDING': [
    'الكمية المطلوبة في أحد السطور أكبر من المتبقي من الأمر. اكتب كمية أقل أو تساوي المتبقي. لم يُحفظ شيء.',
    'The quantity on a line is more than what is still outstanding on the order. Enter the outstanding quantity or less. Nothing was saved.',
  ],
  'PURCHASE_ORDER_FULLY_INVOICED': [
    'هذا الأمر فوتر بالكامل ولا يتبقى منه شيء. لا حاجة لفاتورة أخرى. لم يتغير شيء.',
    'This order is fully invoiced and nothing is outstanding, so no further invoice is needed. Nothing changed.',
  ],
};
