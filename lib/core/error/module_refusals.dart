import 'accounting_refusals.dart';
import 'admin_asset_refusals.dart';
import 'approval_warehouse_refusals.dart';
import 'backup_refusals.dart';
import 'inventory_refusals.dart';
import 'cash_refusals.dart';
import 'purchase_refusals.dart';
import 'return_refusals.dart';
import 'sales_refusals.dart';

/// Reviewed sentences for the refusals of serial numbers, commissions,
/// installments and withholding tax. The code picks the sentence; the server
/// text is never shown. Each is `[Arabic, English]` and says what is wrong and
/// what to do next.
const Map<String, List<String>> moduleRefusals = {
  ...accountingRefusals,
  ...adminAssetRefusals,
  ...approvalWarehouseRefusals,
  ...backupRefusals,
  ...inventoryRefusals,
  ...cashRefusals,
  ...purchaseRefusals,
  ...salesRefusals,
  ...returnRefusals,
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
  'USER_NO_BRANCH': [
    'حسابك غير مرتبط بفرع، فلا يمكن إتمام العملية. اطلب من المدير ربط حسابك بفرع ثم سجّل الدخول من جديد.',
    'Your account is not assigned to a branch, so this cannot be done. Ask an administrator to assign your account to a branch, then sign in again.',
  ],
  'CUSTOMER_MISSING': [
    'العميل المختار غير موجود. اختر العميل من القائمة أو أضفه أولًا ثم أعد المحاولة. لم يُحفظ شيء.',
    'The chosen customer does not exist. Pick the customer from the list or add them first, then try again. Nothing was saved.',
  ],
  'CUSTOMER_INACTIVE': [
    'العميل المختار متوقف. فعّله من شاشة العملاء أو اختر عميلًا آخر. لم يُحفظ شيء.',
    'The chosen customer is inactive. Activate them in the Customers screen or choose another customer. Nothing was saved.',
  ],
  'INVOICE_NOT_DRAFT_EDIT': [
    'لا يمكن تعديل الفاتورة بعد ترحيلها أو إلغائها. لتصحيحها أنشئ مرتجعًا أو إشعارًا ثم فاتورة جديدة.',
    'An invoice cannot be edited once it is posted or cancelled. To correct it, record a return or credit note and issue a new invoice.',
  ],
  'INVOICE_RETURN_NOT_EDITABLE': [
    'مستند المرتجع لا يُعدَّل من شاشة الفواتير. افتحه من شاشة المرتجعات أو أنشئ مرتجعًا جديدًا.',
    'A return document cannot be edited as a sales invoice. Open it from the Returns screen or create a new return.',
  ],
  'INVOICE_OTHER_BRANCH': [
    'هذه المسودة تتبع فرعًا آخر، ولا تُعدَّل إلا من فرعها. سجّل الدخول بحساب ذلك الفرع أو أنشئ مسودة جديدة.',
    'This draft belongs to another branch and can only be edited from that branch. Sign in with an account of that branch or create a new draft.',
  ],
  'INVOICE_CHANGED_RELOAD': [
    'الفاتورة رُحّلت أو تغيّرت بواسطة مستخدم آخر. حدّث الشاشة وراجع آخر حالة ثم أعد التعديل. لم يُحفظ تعديلك.',
    'The invoice was posted or changed by someone else. Reload the screen, check its latest state and edit again. Your change was not saved.',
  ],
  'INVOICE_NOT_DRAFT_CANCEL': [
    'لا يُلغى إلا الفاتورة المسودة. الفاتورة المرحّلة تُصحَّح بمرتجع أو إشعار دائن.',
    'Only a draft invoice can be cancelled. A posted invoice is corrected with a return or credit note.',
  ],
  'QUOTE_NOT_DRAFT_EDIT': [
    'لا يمكن تعديل عرض السعر بعد إصداره. أنشئ مراجعة جديدة منه ثم عدّلها.',
    'A quotation cannot be edited once it is issued. Create a new revision of it and edit that.',
  ],
  'QUOTE_NOT_DRAFT_ISSUE': [
    'هذا العرض صدر من قبل أو أُغلق. لا حاجة لإصداره مرة أخرى. حدّث الشاشة لترى حالته.',
    'This quotation was already issued or closed, so it cannot be issued again. Reload the screen to see its status.',
  ],
  'QUOTE_NOT_DRAFT_DELETE': [
    'لا يُحذف إلا عرض السعر المسودة. العرض الصادر يُغلق أو يُرفض بدل الحذف.',
    'Only a draft quotation can be deleted. An issued quotation is closed or rejected instead.',
  ],
  'QUOTE_ALREADY_CONVERTED': [
    'هذا العرض تحوّل إلى فاتورة بالفعل، ربما بواسطة مستخدم آخر. افتح الفاتورة من سجل الفواتير بدل التحويل مرة أخرى.',
    'This quotation was already converted to an invoice, possibly by someone else. Open that invoice from the invoices list instead of converting again.',
  ],
  'QUOTE_NO_LINES': [
    'عرض السعر بلا بنود فلا يمكن تحويله إلى فاتورة. أضف بندًا واحدًا على الأقل ثم أعد التحويل.',
    'The quotation has no lines, so it cannot be converted to an invoice. Add at least one line and convert again.',
  ],
  'CURRENCY_CODE_INVALID': [
    'رمز العملة غير صحيح. اكتب ثلاثة أحرف مثل EGP أو USD.',
    'The currency code is not valid. Enter three letters such as EGP or USD.',
  ],
  'COMMISSION_ACCOUNT_REQUIRED': [
    'اختر حساب مصروف العمولات وحساب الصرف (صندوق أو بنك أو دائنون) ثم أعد المحاولة. لم يُسجَّل صرف.',
    'Choose the commission expense account and the account it is paid from (cash, bank or payable), then try again. No payout was recorded.',
  ],
  'COMMISSION_ACCOUNT_SAME': [
    'حساب المصروف وحساب الصرف يجب أن يكونا مختلفين. اختر حسابًا آخر لأحدهما. لم يُسجَّل صرف.',
    'The expense account and the paying account must be different. Choose another account for one of them. No payout was recorded.',
  ],
  'COMMISSION_ACCOUNT_INVALID': [
    'أحد الحسابين غير صالح للقيد: المصروف يجب أن يكون حساب مصروفات، والصرف حساب صندوق أو بنك أو دائنين، وكلاهما فعّال وقابل للترحيل. اختر حسابًا صحيحًا. لم يُسجَّل صرف.',
    'One of the two accounts cannot take this entry: the expense must be an expense account, the paying account a cash, bank or payable account, and both active and postable. Choose a valid account. No payout was recorded.',
  ],
  'QUANTITY_NOT_POSITIVE': [
    'الكمية يجب أن تكون أكبر من صفر. اكتب كمية صحيحة ثم أعد المحاولة. لم يتغير شيء.',
    'The quantity must be above zero. Enter a valid quantity and try again. Nothing changed.',
  ],
  'VOUCHER_CHANGED_RELOAD': [
    'المستند تغيّر بعد أن فتحته (ربما عدّله مستخدم آخر). حدّث الشاشة وراجع آخر نسخة ثم أعد المحاولة. لم يُحفظ تعديلك.',
    'The document changed after you opened it, possibly by someone else. Reload the screen, check the latest version and try again. Your change was not saved.',
  ],
  'VOUCHER_NOT_APPROVED': [
    'لا يُرحَّل مستند المخزون قبل مراجعته واعتماده. اطلب الاعتماد من المسؤول ثم رحّله. لم يتغير شيء.',
    'A stock document cannot be posted before it is reviewed and approved. Ask the approver to approve it, then post it. Nothing changed.',
  ],
  'TRANSFER_CHANGED_RELOAD': [
    'حالة التحويل تغيّرت أثناء العملية (ربما بواسطة مستخدم آخر). حدّث الشاشة وراجع حالته الحالية ثم أعد المحاولة إن لزم. لم تُسجَّل هذه الخطوة.',
    'The transfer changed while this step was running, possibly by someone else. Reload the screen, check its current state and try again if needed. This step was not recorded.',
  ],
  'COST_CENTER_REQUIRED_ISSUE': [
    'صرف البضاعة من المخزن يحتاج مركز تكلفة. اختر مركز التكلفة في المستند ثم أعد المحاولة. لم يتغير شيء.',
    'Issuing goods from a warehouse needs a cost center. Choose the cost center on the document and try again. Nothing changed.',
  ],
  'TRANSFER_QTY_NOT_POSITIVE': [
    'كميات التحويل يجب أن تكون أكبر من صفر قبل الترحيل. صحّح الكميات أو احذف السطر الفارغ ثم أعد الترحيل. لم يتغير شيء.',
    'Transfer quantities must be above zero before posting. Correct the quantities or remove the empty line, then post again. Nothing changed.',
  ],
  'REQUEST_KEY_REUSED': [
    'هذا الطلب أُرسل من قبل بمحتوى مختلف. افتح السجل السابق لتراجعه، أو ابدأ طلبًا جديدًا. لم يُنشأ شيء جديد.',
    'This request was already sent with different content. Open the earlier record to review it, or start a new request. Nothing new was created.',
  ],
  'VOUCHER_WAREHOUSE_INVALID': [
    'مخزن المستند لا يتبع فرعك أو أنه متوقف. اختر مخزنًا فعّالًا من فرعك ثم أعد المحاولة. لم يُحفظ شيء.',
    'The document warehouse does not belong to your branch or is inactive. Choose an active warehouse of your branch and try again. Nothing was saved.',
  ],
  'TRANSIT_UNRESOLVED': [
    'ما زالت بضاعة في الطريق لم تُحسم. استلمها أو أرجعها أو اعتمد إعدامها ثم أغلق التحويل. لم يُغلق التحويل.',
    'Goods are still in transit and not settled. Receive them, return them or approve a write-off, then close the transfer. The transfer was not closed.',
  ],
  'WRITEOFF_ALREADY_APPROVED': [
    'اعتمد مستخدم آخر هذا الإعدام قبل لحظات. حدّث الشاشة وراجع حالته. لم تتكرر الموافقة.',
    'Someone else approved this write-off a moment ago. Reload the screen and check its status. Your approval was not repeated.',
  ],
  'PERIOD_CLOSED': [
    'هذه الفترة المحاسبية مغلقة ولا تقبل قيودًا جديدة. اختر تاريخًا في فترة مفتوحة، أو اطلب من المسؤول إعادة فتح الفترة. لم يُسجَّل شيء.',
    'This fiscal period is closed and takes no new entries. Choose a date in an open period, or ask an administrator to reopen it. Nothing was recorded.',
  ],
  'ALREADY_REVERSED': [
    'هذا المستند عُكس من قبل، ولا يُعكس مرتين. افتح قيد العكس من دفتر اليومية إن أردت مراجعته. لم يتغير شيء.',
    'This document was already reversed and cannot be reversed twice. Open the reversal entry in the journal to review it. Nothing changed.',
  ],
  'ONLY_POSTED_REVERSE': [
    'لا يُعكس إلا المستند المرحّل. المسودة تُعدَّل أو تُحذف بدل عكسها. لم يتغير شيء.',
    'Only a posted document can be reversed. Edit or delete a draft instead of reversing it. Nothing changed.',
  ],
  'CASH_ACCOUNT_MISSING': [
    'حساب الصندوق أو البنك المختار غير موجود. اختره من القائمة أو أضفه من شاشة الحسابات النقدية. لم يُحفظ شيء.',
    'The chosen cash or bank account does not exist. Pick it from the list or add it in the cash accounts screen. Nothing was saved.',
  ],
  'CASH_ACCOUNT_INACTIVE': [
    'حساب الصندوق أو البنك المختار متوقف. فعّله من شاشة الحسابات النقدية أو اختر حسابًا آخر. لم يُحفظ شيء.',
    'The chosen cash or bank account is inactive. Activate it in the cash accounts screen or choose another one. Nothing was saved.',
  ],
  'BRANCH_REQUIRED': [
    'اختر الفرع أولًا ثم أعد المحاولة. لم يتغير شيء.',
    'Choose a branch first and try again. Nothing changed.',
  ],
  'BRANCH_MISSING': [
    'الفرع المختار غير موجود في هذه الشركة. اختر فرعًا من القائمة. لم يُحفظ شيء.',
    'The chosen branch does not exist in this company. Pick a branch from the list. Nothing was saved.',
  ],
  'SUPPLIER_INACTIVE': [
    'المورّد المختار متوقف. فعّله من شاشة الموردين أو اختر مورّدًا آخر. لم يُحفظ شيء.',
    'The chosen supplier is inactive. Activate them in the Suppliers screen or choose another supplier. Nothing was saved.',
  ],
  'SUPPLIER_MISSING': [
    'المورّد المختار غير موجود. اختره من القائمة أو أضفه أولًا ثم أعد المحاولة. لم يُحفظ شيء.',
    'The chosen supplier does not exist. Pick them from the list or add them first, then try again. Nothing was saved.',
  ],
  'ACCOUNT_HAS_MOVEMENTS_DELETE': [
    'لا يُحذف حساب عليه حركات في الدفتر حتى تبقى السجلات السابقة مقروءة. عطّله بدل الحذف.',
    'An account with ledger movements cannot be deleted, so past records stay readable. Deactivate it instead.',
  ],
  'ACCOUNT_HAS_CHILDREN': [
    'لهذا الحساب حسابات فرعية. انقل الحسابات الفرعية أو احذفها أولًا، أو عطّل هذا الحساب بدل حذفه.',
    'This account has sub-accounts. Move or delete them first, or deactivate this account instead of deleting it.',
  ],
  'SETTLE_SALES_NEEDS_RECEIPT': [
    'فاتورة البيع تُسدَّد بسند قبض فقط. غيّر نوع السند إلى قبض ثم أعد المحاولة. لم يُحفظ شيء.',
    'A sales invoice is settled by a receipt only. Change the voucher type to receipt and try again. Nothing was saved.',
  ],
  'SETTLE_PURCHASE_NEEDS_PAYMENT': [
    'فاتورة الشراء تُسدَّد بسند صرف فقط. غيّر نوع السند إلى صرف ثم أعد المحاولة. لم يُحفظ شيء.',
    'A purchase invoice is settled by a payment only. Change the voucher type to payment and try again. Nothing was saved.',
  ],
  'DATE_RANGE_REVERSED': [
    'تاريخ النهاية قبل تاريخ البداية. صحّح التواريخ بحيث تأتي البداية أولًا ثم أعد المحاولة.',
    'The end date is before the start date. Correct the dates so the start comes first, then try again.',
  ],
  'ACCOUNT_MISSING': [
    'حساب واحد أو أكثر غير موجود في دليل الحسابات. اختر الحسابات من القائمة ثم أعد المحاولة. لم يُسجَّل شيء.',
    'One or more accounts do not exist in the chart of accounts. Choose the accounts from the list and try again. Nothing was recorded.',
  ],
  'INVOICE_NO_JOURNAL': [
    'هذه الفاتورة ليس لها قيد يومية لعكسه، فلا حاجة لعكسها. راجع حالتها في سجل الفواتير. لم يتغير شيء.',
    'This invoice has no journal entry to reverse, so there is nothing to undo. Check its status in the invoices list. Nothing changed.',
  ],
  'ORDER_REVIEW_REQUIRED': [
    'هذه الفاتورة مرتبطة بأمر بيع ولا يمكن تعديلها تلقائيًا من هنا. راجعها يدويًا مع المحاسب، أو أنشئ فاتورة جديدة من الأمر. لم يتغير شيء.',
    'This invoice is tied to a sales order and cannot be changed automatically here. Review it by hand with an accountant, or create a new invoice from the order. Nothing changed.',
  ],
  'INVOICE_NO_ORDER': [
    'هذه الفاتورة غير مرتبطة بأمر بيع، فلا يمكن تعديل توزيعها على أمر. عدّلها كفاتورة عادية. لم يتغير شيء.',
    'This invoice is not linked to a sales order, so its order allocation cannot be amended. Edit it as an ordinary invoice. Nothing changed.',
  ],
  'ORDER_NOT_AMENDABLE': [
    'أمر البيع المرتبط ملغي أو مسودة فلا يمكن التعديل عليه. افتح الأمر وراجع حالته. لم يتغير شيء.',
    'The related sales order is cancelled or a draft, so it cannot be amended. Open the order and check its status. Nothing changed.',
  ],
  'REASON_REQUIRED': [
    'اكتب سببًا مكتوبًا (3 أحرف على الأقل) ثم أعد المحاولة. لم يتغير شيء.',
    'Write a short reason (at least 3 characters) and try again. Nothing changed.',
  ],
  'FILE_REQUIRED': [
    'لم يصل أي ملف. اختر الملف ثم أعد المحاولة. لم يتغير شيء.',
    'No file was received. Choose the file and try again. Nothing changed.',
  ],
  'ADMIN_CANNOT_DEACTIVATE': [
    'لا يمكن تعطيل مدير النظام الأساسي. اترك حسابه فعّالًا أو أنشئ مديرًا آخر أولًا.',
    'The main system administrator cannot be deactivated. Keep the account active or create another administrator first.',
  ],
  'VOUCHER_NOT_WAREHOUSE': [
    'هذا المستند ليس سند مخزن، فلا تُطبَّق عليه هذه الخطوة. افتح السند من شاشته الصحيحة. لم يتغير شيء.',
    'This is not a warehouse voucher, so this step does not apply. Open it from its own screen. Nothing changed.',
  ],
  'INVOICE_NOT_DRAFT_POST': [
    'لا تُرحَّل إلا الفاتورة المسودة. هذه الفاتورة رُحّلت أو أُلغيت من قبل. حدّث الشاشة وراجع حالتها. لم يتغير شيء.',
    'Only a draft invoice can be posted. This one was already posted or cancelled. Reload the screen and check its status. Nothing changed.',
  ],
  'LINE_QTY_POSITIVE': [
    'كمية أحد السطور صفر أو أقل. اكتب كمية أكبر من صفر في كل سطر أو احذف السطر الفارغ ثم أعد المحاولة. لم يُحفظ شيء.',
    'A line quantity is zero or less. Enter a quantity above zero on every line or remove the empty line, then try again. Nothing was saved.',
  ],
  'LINE_ITEM_MISSING': [
    'أحد سطور المستند يشير إلى صنف غير موجود. اختر الصنف من القائمة في كل سطر ثم أعد المحاولة. لم يُحفظ شيء.',
    'A line points to an item that does not exist. Choose the item from the list on every line and try again. Nothing was saved.',
  ],
  'LINE_ITEM_INACTIVE': [
    'أحد سطور المستند فيه صنف متوقف. فعّل الصنف من شاشة الأصناف أو اختر صنفًا آخر ثم أعد المحاولة. لم يُحفظ شيء.',
    'A line uses an inactive item. Activate the item in the Items screen or choose another one, then try again. Nothing was saved.',
  ],
  'COST_CENTER_MISSING': [
    'مركز التكلفة في أحد السطور غير موجود. اختره من القائمة أو اتركه فارغًا ثم أعد المحاولة. لم يُحفظ شيء.',
    'A line names a cost center that does not exist. Choose it from the list or leave it empty, then try again. Nothing was saved.',
  ],
  'COST_CENTER_INACTIVE': [
    'مركز التكلفة في أحد السطور متوقف. فعّله من شاشة مراكز التكلفة أو اختر غيره ثم أعد المحاولة. لم يُحفظ شيء.',
    'A line uses an inactive cost center. Activate it in the Cost Centers screen or choose another, then try again. Nothing was saved.',
  ],
  'BACKUP_TOO_LARGE': [
    'ملف النسخة الاحتياطية أكبر من الحد المسموح. استخدم ملفًا أصغر أو نسخة أحدث ثم أعد المحاولة. لم يُستعد شيء.',
    'The backup file is larger than the allowed size. Use a smaller or a newer file and try again. Nothing was restored.',
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
  'expenseAccountId': 'حساب مصروف العمولات',
  'fundingAccountId': 'حساب الصرف',
  'direction': 'الاتجاه',
  'note': 'السبب',
  'status': 'الحالة',
};

/// One reviewed sentence per kind of field refusal. The code says what is wrong
/// with the value; the field name says where. Nothing from the server body is
/// shown.
class FieldRefusal {
  const FieldRefusal(this._ar, this._en);
  final String _ar;
  final String _en;

  String arabic(String? label) => label == null
      ? _ar.replaceAll('الحقل «{f}»', 'هذا الحقل').replaceAll('«{f}»', 'هذا الحقل')
      : _ar.replaceAll('{f}', label);

  String english(String field) => _en.replaceAll('{f}', field);
}

const Map<String, FieldRefusal> _fieldRefusals = {
  'FIELD_REQUIRED': FieldRefusal(
    'الحقل «{f}» مطلوب. اكتب قيمته ثم أعد المحاولة. لم يُحفظ شيء.',
    'The field "{f}" is required. Fill it in and try again. Nothing was saved.',
  ),
  'FIELD_POSITIVE': FieldRefusal(
    'القيمة في «{f}» يجب أن تكون أكبر من صفر. اكتب رقمًا موجبًا ثم أعد المحاولة. لم يُحفظ شيء.',
    'The value in "{f}" must be above zero. Enter a positive number and try again. Nothing was saved.',
  ),
  'FIELD_NOT_NEGATIVE': FieldRefusal(
    'القيمة في «{f}» لا يجوز أن تكون سالبة. اكتب صفرًا أو رقمًا موجبًا ثم أعد المحاولة. لم يُحفظ شيء.',
    'The value in "{f}" cannot be negative. Enter zero or a positive number and try again. Nothing was saved.',
  ),
  'FIELD_BAD_DATE': FieldRefusal(
    'التاريخ في «{f}» غير صحيح. اختر تاريخًا من المنتقي أو اكتبه بصيغة سنة-شهر-يوم ثم أعد المحاولة. لم يُحفظ شيء.',
    'The date in "{f}" is not valid. Pick a date or type it as year-month-day and try again. Nothing was saved.',
  ),
  'FIELD_BAD_NUMBER': FieldRefusal(
    'القيمة في «{f}» ليست رقمًا صحيحًا. اكتب أرقامًا فقط (مثل 150 أو 12.5) ثم أعد المحاولة. لم يُحفظ شيء.',
    'The value in "{f}" is not a valid number. Enter digits only (for example 150 or 12.5) and try again. Nothing was saved.',
  ),
};

FieldRefusal? fieldRefusal(String? code) => code == null ? null : _fieldRefusals[code];
