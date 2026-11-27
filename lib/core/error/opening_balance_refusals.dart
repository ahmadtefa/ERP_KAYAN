/// Reviewed sentences for opening-balance document refusals: what happened and
/// how to fix it, `[Arabic, English]`.
const Map<String, List<String>> openingBalanceRefusals = {
  'OPENING_OTHER_BRANCH': [
    'لا يمكنك تعديل الأرصدة الافتتاحية لفرع آخر. اعمل من حساب مستخدم ذلك الفرع. لم يتغير شيء.',
    'You cannot change opening balances of another branch. Work from a user of that branch. Nothing changed.',
  ],
  'OPENING_CURRENCY_INVALID': [
    'عملة الرصيد الافتتاحي يجب أن تكون رمز عملة. اختر العملة من القائمة ثم أعد المحاولة. لم يُحفظ شيء.',
    'The opening balance currency must be a currency code. Choose the currency from the list and try again. Nothing was saved.',
  ],
  'OPENING_COST_PERMISSION': [
    'الأرصدة الافتتاحية للمخزون تحتاج صلاحية تكلفة المخزون. اطلب الصلاحية من المدير أو احذف سطور الأصناف. لم يتغير شيء.',
    'Stock opening balances need the inventory cost permission. Ask an administrator for it or remove the item lines. Nothing changed.',
  ],
  'OPENING_FINGERPRINT_INVALID': [
    'بصمة الاستيراد غير صالحة، فلم يُقبل الملف. أعد رفع الملف من شاشة الاستيراد. لم يُحفظ شيء.',
    'The import fingerprint is not valid, so the file was not accepted. Upload the file again from the import screen. Nothing was saved.',
  ],
  'OPENING_CURRENCY_MISMATCH': [
    'يجب أن يكون الرصيد الافتتاحي بعملة الشركة. اختر عملة الشركة ثم أعد المحاولة. لم يُحفظ شيء.',
    'Opening balances must use the company currency. Choose the company currency and try again. Nothing was saved.',
  ],
  'OPENING_TOTALS_RANGE': [
    'إجماليات الرصيد الافتتاحي خارج الحد المسموح. قسّم المبالغ على أكثر من مستند ثم أعد المحاولة. لم يُحفظ شيء.',
    'The opening balance totals are outside the allowed range. Split the amounts over more than one document and try again. Nothing was saved.',
  ],
  'OPENING_BRANCH_LOCKED': [
    'لا يمكن نقل رصيد افتتاحي محفوظ إلى فرع آخر. أنشئ مستندًا جديدًا في الفرع المطلوب. لم يتغير شيء.',
    'A saved opening balance cannot be moved to another branch. Create a new document in the branch you need. Nothing changed.',
  ],
  'OPENING_CHANGED_OR_NOT_DRAFT': [
    'تغيّر هذا الرصيد الافتتاحي أو لم يعد مسودة. حدّث الشاشة وافتحه من جديد. لم يتغير شيء.',
    'This opening balance changed or is no longer a draft. Refresh the screen and open it again. Nothing changed.',
  ],
  'OPENING_DELETE_NOT_DRAFT': [
    'لا يُحذف إلا الرصيد الافتتاحي الموجود وهو مسودة. افتح المستند وراجع حالته. لم يتغير شيء.',
    'Only an existing draft opening balance can be deleted. Open the document and check its status. Nothing changed.',
  ],
  'OPENING_POST_NOT_DRAFT': [
    'لا يُرحَّل إلا الرصيد الافتتاحي وهو مسودة. حدّث الشاشة وراجع حالة المستند. لم يتغير شيء.',
    'Only a draft opening balance can be posted. Refresh the screen and check the document status. Nothing changed.',
  ],
  'OPENING_CHANGED_REFRESH': [
    'تغيّر هذا الرصيد الافتتاحي منذ فتحته. حدّث المستند وراجعه ثم رحّله. لم يتغير شيء.',
    'This opening balance changed since you opened it. Refresh the document, review it and post again. Nothing changed.',
  ],
  'OPENING_BRANCH_ALREADY_POSTED': [
    'لهذا الفرع رصيد افتتاحي مرحّل بالفعل، ولا يُرحَّل ثانٍ له. أضف الأصناف إلى المستند المرحّل أو اعكسه أولًا. لم يتغير شيء.',
    'This branch already has a posted opening balance, and a second one cannot be posted. Add the items to the posted document or reverse it first. Nothing changed.',
  ],
  'OPENING_ITEM_MISSING': [
    'أحد سطور الرصيد الافتتاحي يشير إلى صنف غير موجود. اختر الصنف من القائمة ثم أعد المحاولة. لم يُحفظ شيء.',
    'An opening line points to an item that does not exist. Choose the item from the list and try again. Nothing was saved.',
  ],
  'OPENING_ITEM_NEEDS_QTY_COST': [
    'سطر الصنف يحتاج كمية وتكلفة وحدة معًا. اكتب الاثنين ثم أعد المحاولة. لم يُحفظ شيء.',
    'An item line needs both a quantity and a unit cost. Enter both and try again. Nothing was saved.',
  ],
  'OPENING_ITEM_VALUE_MISMATCH': [
    'الكمية × تكلفة الوحدة لا تساوي المدين في سطر الصنف. صحّح أحدهما حتى يتطابقا ثم أعد المحاولة. لم يُحفظ شيء.',
    'Quantity x unit cost does not equal the debit on an item line. Correct one of them so they match and try again. Nothing was saved.',
  ],
  'OPENING_ALREADY_REVERSED': [
    'هذا الرصيد الافتتاحي سبق عكسه أو تغيّر. حدّث الشاشة وراجع حالته. لم يتغير شيء.',
    'This opening balance was already reversed or changed. Refresh the screen and check its status. Nothing changed.',
  ],
  'OPENING_REVERSE_STOCK_USED': [
    'لا يمكن عكس الرصيد الافتتاحي لأن الكمية أو قيمة المخزون المتاحة أقل مما يلزم للعكس. أعد الكمية إلى المخزن أو عدّل المستندات اللاحقة ثم أعد المحاولة. لم يتغير شيء.',
    'The opening balance cannot be reversed because the available quantity or stock value is lower than the reversal needs. Return the stock or adjust the later documents and try again. Nothing changed.',
  ],
  'OPENING_LINE_ACCOUNT_MISSING': [
    'يوجد سطر بلا حساب. اختر حسابًا من دليل الحسابات لكل سطر ثم أعد المحاولة. لم يُحفظ شيء.',
    'A line has no account. Choose an account from the chart of accounts for every line and try again. Nothing was saved.',
  ],
  'OPENING_LINE_SUBJECT_AMBIGUOUS': [
    'السطر يجب أن يخص عميلًا واحدًا أو مورّدًا واحدًا أو صنفًا واحدًا فقط. أبقِ واحدًا منها ثم أعد المحاولة. لم يُحفظ شيء.',
    'A line must belong to a single customer, supplier or stock item. Keep only one of them and try again. Nothing was saved.',
  ],
  'OPENING_LINE_NO_AMOUNT': [
    'يوجد سطر بلا مدين ولا دائن. اكتب مبلغًا في أحدهما أو احذف السطر ثم أعد المحاولة. لم يُحفظ شيء.',
    'A line has neither a debit nor a credit. Enter an amount in one of them or delete the line and try again. Nothing was saved.',
  ],
  'OPENING_LINE_BOTH_SIDES': [
    'السطر الواحد لا يكون مدينًا ودائنًا معًا. اترك أحدهما فارغًا أو قسّمه إلى سطرين ثم أعد المحاولة. لم يُحفظ شيء.',
    'One line cannot be both debit and credit. Leave one empty or split it into two lines and try again. Nothing was saved.',
  ],
  'OPENING_LINE_ACCOUNT_NOT_FOUND': [
    'حساب أحد السطور غير موجود في دليل الحسابات. اختر الحساب من القائمة ثم أعد المحاولة. لم يُحفظ شيء.',
    'The account of a line does not exist in the chart of accounts. Choose the account from the list and try again. Nothing was saved.',
  ],
  'OPENING_LINE_DESIGNATED_ACCOUNT': [
    'سطر العميل أو المورّد يجب أن يُرحَّل إلى حساب العملاء أو الموردين المحدد للشركة. اختر ذلك الحساب ثم أعد المحاولة. لم يُحفظ شيء.',
    'A customer or supplier line must post to the company\'s designated receivables or payables account. Choose that account and try again. Nothing was saved.',
  ],
  'OPENING_LINE_ITEM_REPEATED': [
    'الصنف نفسه مكرر في أكثر من سطر. اجمع كميته وتكلفته في سطر واحد ثم أعد المحاولة. لم يُحفظ شيء.',
    'The same stock item is repeated on more than one line. Combine its quantity and cost into one line and try again. Nothing was saved.',
  ],
  'OPENING_LINE_VALUE_MISMATCH': [
    'الكمية × تكلفة الوحدة يجب أن تساوي المدين في سطر الصنف. صحّح القيم ثم أعد المحاولة. لم يُحفظ شيء.',
    'Quantity x unit cost must equal the debit on the item line. Correct the values and try again. Nothing was saved.',
  ],
  'OPENING_LINE_INVENTORY_ACCOUNT': [
    'رصيد الصنف الافتتاحي يُرحَّل إلى حساب المخزون فقط. اختر حساب المخزون لهذا السطر ثم أعد المحاولة. لم يُحفظ شيء.',
    'Opening stock must be posted to the inventory account. Choose the inventory account for this line and try again. Nothing was saved.',
  ],
  'OPENING_LINE_NON_STOCK_QTY': [
    'الصنف غير المخزني لا يحمل كمية أو تكلفة افتتاحية. احذفهما من السطر ثم أعد المحاولة. لم يُحفظ شيء.',
    'A non-stock item cannot carry an opening quantity or cost. Remove them from the line and try again. Nothing was saved.',
  ],
  'OPENING_LINE_CUSTOMER_MISSING': [
    'العميل المختار في أحد السطور غير موجود. اختر العميل من القائمة ثم أعد المحاولة. لم يُحفظ شيء.',
    'The customer chosen on a line does not exist. Choose the customer from the list and try again. Nothing was saved.',
  ],
  'OPENING_LINE_SUPPLIER_MISSING': [
    'المورّد المختار في أحد السطور غير موجود. اختر المورّد من القائمة ثم أعد المحاولة. لم يُحفظ شيء.',
    'The supplier chosen on a line does not exist. Choose the supplier from the list and try again. Nothing was saved.',
  ],
  'OPENING_RANGE': [
    'إحدى القيم خارج الحد المسموح. اكتب قيمة أصغر ثم أعد المحاولة. لم يُحفظ شيء.',
    'A value is outside the supported range. Enter a smaller value and try again. Nothing was saved.',
  ],
};
