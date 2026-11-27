/// Reviewed sentences for the refusals of serial numbers, commissions,
/// installments and withholding tax. The code picks the sentence; the server
/// text is never shown. Each is `[Arabic, English]` and says what is wrong and
/// what to do next.
const Map<String, List<String>> moduleRefusals = {
  'SERIAL_DUPLICATE': [
    'رقم تسلسلي أو أكثر مسجّل من قبل لنفس الصنف. راجع الأرقام وأزل المكرر ثم أعد المحاولة. لم يُحفظ شيء.',
    'One or more serial numbers are already registered for this item. Check the list, remove the repeats and try again. Nothing was saved.',
  ],
  'SERIAL_NOT_FOUND': [
    'رقم تسلسلي أو أكثر غير مسجّل لهذا الصنف. سجّلها أولًا ثم اربطها بالفاتورة. لم يتغير شيء.',
    'One or more serial numbers are not registered for this item. Register them first, then assign them to the invoice. Nothing changed.',
  ],
  'SERIAL_STATE': [
    'حالة الرقم التسلسلي لا تسمح بهذه الخطوة (مباع أو مُعدَم مثلًا). راجع سجل الرقم ثم اختر الخطوة المناسبة. لم يتغير شيء.',
    'The serial number is not in a state that allows this step (for example it is already sold or scrapped). Check its history and pick the right step. Nothing changed.',
  ],
  'SERIAL_TOO_MANY': [
    'عدد الأرقام أكبر من الكمية المتبقية في الفاتورة لهذا الصنف. قلّل عدد الأرقام أو راجع الفاتورة. لم يتغير شيء.',
    'There are more serial numbers than the quantity left on the invoice for this item. Use fewer numbers or check the invoice. Nothing changed.',
  ],
  'SERIAL_INVOICE_NOT_POSTED': [
    'تُربط الأرقام التسلسلية بفاتورة بيع مرحّلة فقط. رحّل الفاتورة أولًا أو اختر فاتورة مرحّلة.',
    'Serial numbers are assigned to a posted sales invoice only. Post the invoice first or choose a posted one.',
  ],
  'SERIAL_ITEM_NOT_ON_INVOICE': [
    'الفاتورة المختارة ليس فيها سطر لهذا الصنف. اختر الفاتورة الصحيحة أو الصنف الصحيح.',
    'The chosen invoice has no line for this item. Choose the right invoice or the right item.',
  ],
  'REP_DUPLICATE': [
    'يوجد مندوب بنفس الاسم. اختر اسمًا مختلفًا أو عدّل المندوب الموجود.',
    'A rep with that name already exists. Use a different name or edit the existing rep.',
  ],
  'REP_NOT_FOUND': [
    'تعذر العثور على المندوب. ربما حُذف أو غيّره مستخدم آخر. حدّث الشاشة واختره من القائمة مرة أخرى.',
    'The rep could not be found. It may have been changed by someone else. Reload the screen and choose it from the list again.',
  ],
  'REP_INACTIVE': [
    'هذا المندوب متوقف. فعّله من تبويب المندوبين أو اختر مندوبًا آخر.',
    'This rep is inactive. Activate the rep in the Reps view or choose another one.',
  ],
  'COMMISSION_EXISTS': [
    'هذا المستند له عمولة مسجّلة بالفعل. إن أردت تغيير المندوب فأزل العمولة الحالية أولًا (إن لم تُصرف).',
    'This document already has a commission. To change the rep, take the current commission off first (if it was not paid out).',
  ],
  'COMMISSION_NOT_FOUND': [
    'تعذر العثور على العمولة. ربما أُزيلت. حدّث الشاشة وراجع القائمة.',
    'The commission could not be found. It may have been removed. Reload the screen and check the list.',
  ],
  'COMMISSION_PAID': [
    'هذه العمولة صُرفت بالفعل فلا يمكن إزالتها. لتصحيحها سجّل إشعار دائن للمرتجع إن لزم.',
    'This commission was already paid out, so it cannot be removed. If a sale is returned, record a credit note.',
  ],
  'COMMISSION_HAS_RETURN': [
    'يوجد مرتجع لهذه الفاتورة عليه عمولة. أزل عمولة المرتجع أولًا ثم أزل عمولة الفاتورة.',
    'A return of this invoice carries a commission. Take the return commission off first, then this one.',
  ],
  'COMMISSION_DOC_NOT_POSTED': [
    'تُسجَّل العمولة على مستند مرحّل فقط. رحّل المستند أولًا.',
    'A commission is set on a posted document only. Post the document first.',
  ],
  'COMMISSION_DEBIT_NOTE': [
    'إشعارات المدين لا تحمل عمولة. اختر فاتورة أو إشعار دائن.',
    'Debit notes do not carry a commission. Choose an invoice or a credit note.',
  ],
  'COMMISSION_CREDIT_NO_ORIGINAL': [
    'إشعار الدائن هذا لا يحدد الفاتورة التي يرتجعها فلا يُعرف المندوب. اربطه بفاتورته الأصلية أولًا.',
    'This credit note does not name the invoice it returns, so the rep is unknown. Link it to its original invoice first.',
  ],
  'COMMISSION_ORIGINAL_UNASSIGNED': [
    'الفاتورة الأصلية للمرتجع ليس لها عمولة فلا يوجد ما يُخصم. اربط الفاتورة الأصلية بمندوب أولًا إن لزم.',
    'The invoice this credit note returns has no commission, so there is nothing to take back. Put the original invoice under a rep first if needed.',
  ],
  'COMMISSION_NOTHING_TO_PAY': [
    'لا توجد عمولات مستحقة في هذه الفترة لهذا المندوب. غيّر الفترة أو المندوب.',
    'There are no due commissions for this rep in that period. Change the period or the rep.',
  ],
  'COMMISSION_RETURNS_CANCEL': [
    'المرتجعات تلغي عمولة هذه الفترة فلا يوجد ما يُصرف. وسّع الفترة لتشمل مبيعات أكثر.',
    'Returns cancel the commission for that period, so there is nothing to pay. Widen the period to include more sales.',
  ],
  'INVOICE_NOT_FOUND': [
    'تعذر العثور على فاتورة البيع. ربما حُذفت. حدّث الشاشة واختر الفاتورة مرة أخرى.',
    'The sales invoice could not be found. It may have been deleted. Reload the screen and choose it again.',
  ],
  'PLAN_NOT_FOUND': [
    'ليس لهذه الفاتورة خطة تقسيط. أنشئ خطة أولًا.',
    'This invoice has no installment plan. Create a plan first.',
  ],
  'INSTALLMENT_INVOICE_NOT_POSTED': [
    'خطة التقسيط تخص فاتورة بيع مرحّلة فقط. رحّل الفاتورة أولًا.',
    'An installment plan belongs to a posted sales invoice only. Post the invoice first.',
  ],
  'INSTALLMENT_NO_AMOUNT': [
    'الفاتورة ليس فيها مبلغ يُقسَّط. اختر فاتورة بإجمالي أكبر من صفر.',
    'The invoice has no amount to split. Choose an invoice with a total above zero.',
  ],
  'INSTALLMENT_DOWN_TOO_BIG': [
    'الدفعة المقدمة يجب أن تكون أقل من إجمالي الفاتورة. خفّضها ثم أعد المحاولة.',
    'The down payment must be less than the invoice total. Lower it and try again.',
  ],
  'INSTALLMENT_FIRST_BEFORE_INVOICE': [
    'تاريخ أول قسط يسبق تاريخ الفاتورة. اختر تاريخًا في يوم الفاتورة أو بعده.',
    'The first installment date is before the invoice date. Choose the invoice date or a later one.',
  ],
  'INSTALLMENT_TOO_MANY': [
    'عدد الأقساط كبير بالنسبة لهذا المبلغ فيصير القسط أقل من قرش. قلّل عدد الأقساط.',
    'There are too many installments for this amount, so each would be under one piaster. Use fewer installments.',
  ],
  'WITHHOLDING_RATE_DUPLICATE': [
    'يوجد نسبة بنفس الكود. اختر كودًا مختلفًا.',
    'A rate with that code already exists. Choose a different code.',
  ],
  'WITHHOLDING_RATE_IN_USE': [
    'استُخدمت هذه النسبة في سندات فلا يمكن تغييرها. أضف نسبة جديدة بدلًا من التعديل.',
    'This rate was already used on vouchers, so it cannot be changed. Add a new rate instead.',
  ],
  'WITHHOLDING_VOUCHER_POSTED': [
    'السند مرحّل فلا يمكن تغيير ضريبة الخصم عليه. اعكس السند ثم أنشئ سندًا جديدًا إن لزم.',
    'The voucher is posted, so its withholding can no longer change. Reverse it and create a new voucher if needed.',
  ],
  'WITHHOLDING_ACCOUNT_NOT_POSTABLE': [
    'هذا الحساب لا يستقبل قيودًا (غير فرعي أو غير مفعّل). اختر حسابًا فرعيًا مفعّلًا.',
    'This account cannot receive postings (not a detail account or not active). Choose an active detail account.',
  ],
  'WITHHOLDING_ACCOUNT_TYPE': [
    'نوع الحساب لا يناسب اتجاه الضريبة: الخصم من الموردين حساب التزامات، والخصم عند العملاء حساب أصول. اختر الحساب المناسب.',
    'The account type does not fit the tax direction: tax withheld from suppliers goes to a liability account and tax withheld by customers to an asset account. Choose the right account.',
  ],
  'WITHHOLDING_RATE_INACTIVE': [
    'هذه النسبة متوقفة. فعّلها من شاشة الضريبة أو اختر نسبة أخرى.',
    'This rate is inactive. Activate it in the withholding screen or choose another rate.',
  ],
  'WITHHOLDING_RATE_DIRECTION': [
    'اتجاه النسبة لا يناسب السند: الدفع لمورد يحتاج نسبة خصم من الموردين، والقبض من عميل يحتاج نسبة خصم عند العملاء. اختر نسبة مناسبة.',
    'The rate direction does not fit the voucher: a payment to a supplier needs a rate for tax withheld from suppliers, and a receipt from a customer a rate for tax withheld by customers. Choose a fitting rate.',
  ],
  'WITHHOLDING_TAX_ZERO': [
    'عند هذه النسبة تصبح الضريبة على المبلغ صفرًا. استخدم نسبة أعلى أو لا تضف ضريبة لهذا السند.',
    'At this rate the tax on this amount rounds to zero. Use a higher rate or leave the tax off this voucher.',
  ],
  'WITHHOLDING_TAX_TOO_BIG': [
    'الضريبة لا يمكن أن تساوي مبلغ السند أو تزيد عنه. اختر نسبة أقل.',
    'The tax cannot be as large as the voucher amount. Choose a lower rate.',
  ],
  'WITHHOLDING_NO_CASH_LINE': [
    'السند ليس فيه سطر خزينة أو بنك لتعديله. راجع السند وأضف حساب الخزينة أو البنك.',
    'The voucher has no cash or bank line to adjust. Check the voucher and add its cash or bank account.',
  ],
  'WITHHOLDING_NOT_APPLICABLE': [
    'ضريبة الخصم تخص دفعة لمورد أو قبضًا من عميل فقط. اختر سندًا من هذين النوعين.',
    'Withholding applies to a payment to a supplier or a receipt from a customer only. Choose a voucher of one of those kinds.',
  ],
};

/// Arabic names of the inputs these refusals point at, for the generic
/// "check this field" sentence.
const Map<String, String> moduleFieldLabelsAr = {
  'serials': 'الأرقام التسلسلية',
  'serial': 'الرقم التسلسلي',
  'warrantyMonths': 'مدة الضمان',
  'warrantyEndingInDays': 'أيام انتهاء الضمان',
  'salesInvoiceId': 'فاتورة البيع',
  'invoiceId': 'فاتورة البيع',
  'repId': 'المندوب',
  'ratePercent': 'نسبة العمولة أو الضريبة',
  'from': 'من تاريخ',
  'to': 'إلى تاريخ',
  'downPayment': 'الدفعة المقدمة',
  'count': 'عدد الأقساط',
  'intervalMonths': 'الفاصل بين الأقساط',
  'firstDue': 'تاريخ أول قسط',
  'rateId': 'نسبة الضريبة',
  'direction': 'الاتجاه',
  'note': 'السبب',
  'status': 'الحالة',
};
