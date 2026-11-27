/// Reviewed sentences for cash, bank, transfer and voucher refusals: what
/// happened and how to fix it, `[Arabic, English]`. The code picks the sentence.
const Map<String, List<String>> cashRefusals = {
  'RECON_VOUCHER_TAKEN': [
    'سند أو أكثر من المختارة مطابَق بالفعل في تسوية بنكية أخرى. أزلها من هذه التسوية أو افتح التسوية الأخرى. لم يُحفظ شيء.',
    'One or more of the chosen vouchers is already matched in another bank reconciliation. Remove them here or open the other reconciliation. Nothing was saved.',
  ],
  'RECON_VOUCHER_MISSING': [
    'سند أو أكثر من المختارة غير موجود في هذه الشركة. حدّث الشاشة واختر السندات من القائمة مرة أخرى. لم يُحفظ شيء.',
    'One or more of the chosen vouchers does not exist in this company. Reload the screen and choose the vouchers from the list again. Nothing was saved.',
  ],
  'RECON_VOUCHER_OTHER_ACCOUNT': [
    'أحد السندات يخص حساب خزينة أو بنك آخر. اختر سندات الحساب نفسه الذي تسوّيه. لم يُحفظ شيء.',
    'One of the vouchers belongs to a different cash or bank account. Choose vouchers of the account you are reconciling. Nothing was saved.',
  ],
  'RECON_VOUCHER_NOT_POSTED': [
    'أحد السندات غير مرحّل، ولا يُطابَق مع كشف البنك إلا السند المرحّل. رحّل السند أولًا أو أزله من المطابقة.',
    'One of the vouchers is not posted, and only posted vouchers can be matched to a bank statement. Post it first or remove it from the match.',
  ],
  'CASH_KIND_UNKNOWN': [
    'نوع الحساب غير معروف. اختر «خزينة» أو «بنك» من القائمة.',
    'The account type is not recognised. Choose "Cash" or "Bank" from the list.',
  ],
  'CASH_NAME_REQUIRED': [
    'اسم الحساب مطلوب. اكتب الاسم بالعربية أو بالإنجليزية ثم احفظ. لم يُحفظ شيء.',
    'The account needs a name. Type it in Arabic or English and save. Nothing was saved.',
  ],
  'CASH_LEDGER_LOCKED': [
    'على هذا الحساب حركات مرحّلة، فلا يمكن تغيير حسابه في الدليل المحاسبي. أنشئ حساب خزينة جديدًا بدلًا منه. لم يتغير شيء.',
    'This account already has posted movements, so its ledger account cannot be changed. Create a new cash or bank account instead. Nothing changed.',
  ],
  'TRANSFER_SAME_ACCOUNT': [
    'الحساب المحوَّل منه والمحوَّل إليه واحد. اختر حسابين مختلفين. لم يُحفظ شيء.',
    'The "from" and "to" accounts are the same. Choose two different accounts. Nothing was saved.',
  ],
  'TRANSFER_CURRENCY_MISMATCH': [
    'الحسابان بعملتين مختلفتين، والتحويل بين عملتين غير مدعوم بعد. اختر حسابين بنفس العملة. لم يُحفظ شيء.',
    'The two accounts use different currencies, and transfers between currencies are not supported yet. Choose two accounts with the same currency. Nothing was saved.',
  ],
  'TRANSFER_NOT_DRAFT': [
    'لا يُرحَّل إلا التحويل في حالة مسودة، وهذا التحويل ليس كذلك. حدّث الشاشة لترى حالته الحالية. لم يتغير شيء.',
    'Only a draft transfer can be posted, and this one is not a draft. Reload the screen to see its current state. Nothing changed.',
  ],
  'TRANSFER_ACCOUNT_REQUIRED': [
    'حساب الخزينة أو البنك في التحويل مطلوب. اختر الحسابين ثم احفظ. لم يُحفظ شيء.',
    'The cash or bank account of the transfer is required. Choose both accounts and save. Nothing was saved.',
  ],
  'TRANSFER_ACCOUNT_MISSING': [
    'أحد حسابي التحويل غير موجود. حدّث الشاشة واختر الحساب من القائمة مرة أخرى. لم يُحفظ شيء.',
    'One of the transfer accounts does not exist. Reload the screen and choose the account from the list again. Nothing was saved.',
  ],
  'TRANSFER_ACCOUNT_INACTIVE': [
    'أحد حسابي التحويل متوقف. فعّله من شاشة الخزينة والبنوك أو اختر حسابًا آخر. لم يُحفظ شيء.',
    'One of the transfer accounts is inactive. Activate it in the cash and bank screen or choose another one. Nothing was saved.',
  ],
  'VOUCHER_KIND_UNKNOWN': [
    'نوع السند غير معروف. اختر «قبض» أو «صرف».',
    'The voucher type is not recognised. Choose "Receipt" or "Payment".',
  ],
  'VOUCHER_COST_CENTER_MISSING': [
    'مركز التكلفة المختار غير موجود. اختر مركزًا من القائمة أو اتركه فارغًا. لم يُحفظ شيء.',
    'The chosen cost center does not exist. Choose one from the list or leave it empty. Nothing was saved.',
  ],
  'VOUCHER_COST_CENTER_NEEDS_COUNTER': [
    'لا يُسجَّل مركز التكلفة إلا على سند له حساب مقابل. اختر الحساب المقابل أو احذف مركز التكلفة. لم يُحفظ شيء.',
    'A cost center can only be set on a voucher that has a counter account. Choose the counter account or clear the cost center. Nothing was saved.',
  ],
  'VOUCHER_ALLOC_TOO_BIG': [
    'مجموع المبالغ الموزعة على الفواتير أكبر من مبلغ السند. قلّل المبالغ الموزعة أو ارفع مبلغ السند. لم يُحفظ شيء.',
    'The amounts allocated to invoices add up to more than the voucher amount. Lower the allocations or raise the voucher amount. Nothing was saved.',
  ],
  'VOUCHER_ALLOC_NEEDS_PARTY': [
    'لا يُوزَّع السند على فواتير إلا إذا اخترت عميلًا أو موردًا. اختر العميل أو المورد أو احذف التوزيع. لم يُحفظ شيء.',
    'A voucher can only be allocated to invoices when it names a customer or a supplier. Choose the customer or supplier or remove the allocation. Nothing was saved.',
  ],
  'VOUCHER_NOT_DRAFT': [
    'لا يُرحَّل إلا السند في حالة مسودة، وهذا السند ليس كذلك. حدّث الشاشة لترى حالته الحالية. لم يتغير شيء.',
    'Only a draft voucher can be posted, and this one is not a draft. Reload the screen to see its current state. Nothing changed.',
  ],
  'VOUCHER_POSTED_ELSEWHERE': [
    'رحّل مستخدم آخر هذا السند قبل لحظات. حدّث الشاشة لترى حالته الحالية. لم يتغير شيء.',
    'Someone else has just posted this voucher. Reload the screen to see its current state. Nothing changed.',
  ],
  'VOUCHER_ALLOC_ONE_INVOICE': [
    'كل سطر توزيع يخص فاتورة واحدة فقط. اختر فاتورة واحدة لكل سطر. لم يُحفظ شيء.',
    'Each allocation line must name exactly one invoice. Choose one invoice per line. Nothing was saved.',
  ],
  'VOUCHER_INVOICE_MISSING': [
    'إحدى الفواتير في التوزيع غير موجودة. حدّث الشاشة واختر الفاتورة من القائمة مرة أخرى. لم يُحفظ شيء.',
    'One of the invoices in the allocation does not exist. Reload the screen and choose the invoice from the list again. Nothing was saved.',
  ],
  'VOUCHER_INVOICE_NOT_POSTED': [
    'إحدى الفواتير غير مرحّلة، ولا تُسدَّد إلا الفاتورة المرحّلة. رحّل الفاتورة أولًا أو أزلها من التوزيع. لم يُحفظ شيء.',
    'One of the invoices is not posted, and only a posted invoice can be paid. Post it first or remove it from the allocation. Nothing was saved.',
  ],
  'VOUCHER_INVOICE_OTHER_PARTY': [
    'إحدى الفواتير تخص عميلًا أو موردًا غير الذي في السند. اختر فواتير الطرف نفسه. لم يُحفظ شيء.',
    'One of the invoices belongs to a different customer or supplier than the voucher. Choose invoices of the same party. Nothing was saved.',
  ],
  'VOUCHER_INVOICE_CURRENCY': [
    'إحدى الفواتير بعملة غير عملة السند. اختر فواتير بنفس عملة السند. لم يُحفظ شيء.',
    'One of the invoices is in a different currency from the voucher. Choose invoices in the voucher currency. Nothing was saved.',
  ],
  'VOUCHER_INVOICE_OVERPAID': [
    'المبلغ الموزع على إحدى الفواتير أكبر من المتبقي عليها. قلّل المبلغ إلى المتبقي أو أقل. لم يُحفظ شيء.',
    'The amount allocated to one invoice is more than what is left to pay on it. Lower it to the remaining amount or less. Nothing was saved.',
  ],
  'VOUCHER_INVOICE_REVERSED': [
    'إحدى الفواتير مُعكوسة فلا تُسدَّد. أزلها من التوزيع. لم يُحفظ شيء.',
    'One of the invoices has been reversed and cannot be paid. Remove it from the allocation. Nothing was saved.',
  ],
  'VOUCHER_NEEDS_COUNTERPART': [
    'السند يحتاج عميلًا أو موردًا أو حسابًا مقابلًا، فالمال لا بد أن يأتي من جهة. اختر واحدًا منها ثم احفظ. لم يُحفظ شيء.',
    'The voucher needs a customer, a supplier or a counter account, because the money has to come from somewhere. Choose one and save. Nothing was saved.',
  ],
  'VOUCHER_CASH_ACCOUNT_REQUIRED': [
    'اختر الخزينة أو البنك الذي تحرّك فيه المال ثم احفظ. لم يُحفظ شيء.',
    'Choose the cash or bank account the money moved through and save. Nothing was saved.',
  ],
  'VOUCHER_PARTY_BOTH': [
    'السند لعميل أو لمورد وليس لهما معًا. احذف أحدهما ثم احفظ. لم يُحفظ شيء.',
    'A voucher is for a customer or a supplier, not both. Clear one of them and save. Nothing was saved.',
  ],
};
