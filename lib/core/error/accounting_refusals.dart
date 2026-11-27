/// Reviewed sentences for budgets, fiscal periods, journal entries, chart of
/// accounts, cost centers and posting refusals: what happened and how to fix it.
const Map<String, List<String>> accountingRefusals = {
  'BUDGET_RETIRED': [
    'الموازنة موقوفة ولا تُعدَّل. أنشئ موازنة جديدة بدلًا منها. لم يتغير شيء.',
    'A retired budget cannot be edited. Create a new budget instead. Nothing changed.',
  ],
  'BUDGET_TYPE_UNKNOWN': [
    'نوع الموازنة غير معروف. اختر قسمًا أو وحدة إدارية أو مشروعًا من القائمة. لم يُحفظ شيء.',
    'The budget type is not recognised. Choose department, administrative unit or project from the list. Nothing was saved.',
  ],
  'BUDGET_COMPANY_MISSING': [
    'الشركة غير موجودة. سجّل الخروج ثم ادخل من جديد وأعد المحاولة. لم يُحفظ شيء.',
    'The company does not exist. Sign out, sign in again and retry. Nothing was saved.',
  ],
  'BUDGET_COST_CENTER_MISSING': [
    'مركز التكلفة المختار ليس من هذه الشركة. اختر مركزًا من القائمة. لم يُحفظ شيء.',
    'The chosen cost center is not in this company. Choose one from the list. Nothing was saved.',
  ],
  'BUDGET_ACCOUNT_MISSING': [
    'الحساب المختار ليس من هذه الشركة. اختر حسابًا من الدليل المحاسبي. لم يُحفظ شيء.',
    'The chosen account is not in this company. Choose an account from the chart of accounts. Nothing was saved.',
  ],
  'BUDGET_DUPLICATE': [
    'توجد موازنة بنفس مركز التكلفة والحساب والفترة. عدّل الموجودة بدل إنشاء أخرى. لم يُحفظ شيء.',
    'A budget for this cost center, account and period already exists. Edit that one instead of creating another. Nothing was saved.',
  ],
  'BUDGET_AMOUNT_INVALID': [
    'مبلغ الموازنة يجب أن يكون رقمًا أكبر من صفر وبحد أقصى أربع خانات عشرية. صحّحه ثم احفظ. لم يُحفظ شيء.',
    'The budget amount must be a number above zero with at most four decimal places. Correct it and save. Nothing was saved.',
  ],
  'BUDGET_CURRENCY_INVALID': [
    'رمز العملة يجب أن يكون ثلاثة أحرف (مثل EGP). صحّحه ثم احفظ. لم يُحفظ شيء.',
    'The currency must be a three-letter code (for example EGP). Correct it and save. Nothing was saved.',
  ],
  'BUDGET_CURRENCY_COMPANY': [
    'الموازنة تُحفظ بعملة الشركة فقط، فالبرنامج لا يحوّل بين العملات هنا. اختر عملة الشركة. لم يُحفظ شيء.',
    'A budget is kept in the company currency only; there is no currency conversion here. Choose the company currency. Nothing was saved.',
  ],
  'BUDGET_DATE_INVALID': [
    'التاريخ غير صحيح. اختر تاريخًا حقيقيًا من التقويم. لم يُحفظ شيء.',
    'The date is not valid. Pick a real date from the calendar. Nothing was saved.',
  ],
  'BUDGET_NOTES_LONG': [
    'الملاحظات أطول من 500 حرف. اختصرها ثم احفظ. لم يُحفظ شيء.',
    'The notes are longer than 500 characters. Shorten them and save. Nothing was saved.',
  ],
  'PERIOD_CODE_DUPLICATE': [
    'توجد فترة مالية بنفس الرمز. اكتب رمزًا مختلفًا. لم يُحفظ شيء.',
    'A fiscal period with that code already exists. Use a different code. Nothing was saved.',
  ],
  'PERIOD_CLOSED_EDIT': [
    'الفترة المالية مقفلة ولا تُعدَّل. افتحها أولًا إن كان لديك صلاحية ذلك. لم يتغير شيء.',
    'A closed fiscal period cannot be changed. Reopen it first if you have permission. Nothing changed.',
  ],
  'PERIOD_HAS_HISTORY': [
    'في الفترة قيود مرحّلة، فلا تُغيَّر حدودها. أنشئ فترة جديدة بدل تعديل التواريخ. لم يتغير شيء.',
    'The period contains posted entries, so its boundaries cannot be changed. Create a new period instead of changing the dates. Nothing changed.',
  ],
  'PERIOD_OVERLAP': [
    'هذه الفترة تتداخل مع فترة أخرى. صحّح التواريخ حتى لا تتداخل الفترات ثم أعد القفل. لم يتغير شيء.',
    'This fiscal period overlaps another one. Correct the dates so periods do not overlap, then close again. Nothing changed.',
  ],
  'PERIOD_HAS_DRAFTS': [
    'توجد مستندات مسودة داخل هذه الفترة. رحّلها أو احذفها ثم أعد القفل. لم يتغير شيء.',
    'There are draft documents inside this period. Post or delete them, then close again. Nothing changed.',
  ],
  'YEAR_CLOSE_NO_BRANCH': [
    'لا يوجد فرع فعّال لترحيل قيد الإقفال عليه. فعّل فرعًا من شاشة الفروع ثم أعد المحاولة. لم يتغير شيء.',
    'There is no active branch to post the closing entry to. Activate a branch in the branches screen and try again. Nothing changed.',
  ],
  'JOURNAL_USER_NO_BRANCH': [
    'حسابك غير مربوط بفرع. اطلب من المدير ربطك بفرع ثم أعد المحاولة. لم يُحفظ شيء.',
    'Your account is not assigned to a branch. Ask the administrator to assign you to a branch and try again. Nothing was saved.',
  ],
  'JOURNAL_ACCOUNT_GROUPING': [
    'أحد الحسابات حساب تجميعي له حسابات فرعية ولا تُرحَّل عليه قيود. اختر حسابًا فرعيًا. لم يُحفظ شيء.',
    'One of the accounts is a grouping account with sub-accounts and cannot receive entries. Choose a sub-account. Nothing was saved.',
  ],
  'JOURNAL_ACCOUNT_INACTIVE': [
    'أحد الحسابات متوقف. فعّله من الدليل المحاسبي أو اختر حسابًا آخر. لم يُحفظ شيء.',
    'One of the accounts is inactive. Activate it in the chart of accounts or choose another. Nothing was saved.',
  ],
  'JOURNAL_CONTROL_ACCOUNT': [
    'لا تُرحَّل قيود يدوية مباشرة على حساب العملاء أو الموردين الرئيسي. استخدم مستندات العميل أو المورد ليبقى كشف الحساب سليمًا. لم يتغير شيء.',
    'Manual entries cannot post directly to a customer or supplier control account. Use the customer or supplier documents so the sub-ledger stays correct. Nothing changed.',
  ],
  'JOURNAL_NOT_POSTABLE_STATE': [
    'لا يُرحَّل إلا القيد المسودة أو المعتمد، وحالة هذا القيد لا تسمح. حدّث الشاشة لترى حالته. لم يتغير شيء.',
    'Only a draft or approved entry can be posted, and this entry is in another state. Reload the screen to see its state. Nothing changed.',
  ],
  'JOURNAL_NEEDS_APPROVAL': [
    'الشركة تشترط اعتماد القيود اليدوية قبل الترحيل. أرسل القيد للاعتماد أولًا. لم يتغير شيء.',
    'The company requires manual entries to be approved before posting. Submit the entry for approval first. Nothing changed.',
  ],
  'JOURNAL_SEPARATION': [
    'فصل المهام مفعّل: لا يعتمد القيد أو يرحّله من أنشأه أو اعتمده. اطلب من مستخدم آخر لديه الصلاحية. لم يتغير شيء.',
    'Separation of duties is on: the person who wrote or approved an entry cannot approve or post it. Ask another user who has the permission. Nothing changed.',
  ],
  'JOURNAL_UNBALANCED': [
    'القيد غير متوازن، فمجموع المدين لا يساوي مجموع الدائن. صحّح المبالغ حتى يتساويا. لم يُحفظ شيء.',
    'The entry is not balanced: total debit does not equal total credit. Correct the amounts so they match. Nothing was saved.',
  ],
  'JOURNAL_TWO_LINES': [
    'القيد يحتاج سطرين على الأقل. أضف السطر الناقص ثم احفظ. لم يُحفظ شيء.',
    'A journal entry needs at least two lines. Add the missing line and save. Nothing was saved.',
  ],
  'JOURNAL_LINE_AMOUNT': [
    'أحد السطور مبلغه غير صحيح: لكل سطر مدين أو دائن واحد موجب، وليس الاثنين. صحّح السطر ثم احفظ. لم يُحفظ شيء.',
    'A line amount is not valid: each line needs one positive debit or credit, not both. Correct the line and save. Nothing was saved.',
  ],
  'JOURNAL_ACCOUNT_UNAVAILABLE': [
    'حساب أو أكثر غير متاح أو لا يقبل قيودًا. اختر حسابات فعّالة وفرعية. لم يُحفظ شيء.',
    'One or more accounts are unavailable or cannot receive entries. Choose active, postable accounts. Nothing was saved.',
  ],
  'JOURNAL_STATE_NOT_ALLOWED': [
    'هذا الإجراء غير مسموح في حالة القيد الحالية. حدّث الشاشة لترى حالته واختر الإجراء المناسب. لم يتغير شيء.',
    'This action is not allowed in the entry current state. Reload the screen to see its state and pick a suitable action. Nothing changed.',
  ],
  'JOURNAL_COST_CENTER_SPLIT': [
    'السطر الواحد إما له مركز تكلفة واحد أو موزَّع على عدة مراكز، وليس الاثنين. اختر أحدهما. لم يُحفظ شيء.',
    'A line has either one cost center or a split between several, not both. Choose one of them. Nothing was saved.',
  ],
  'ACCOUNT_LAST_LEVEL': [
    'حساب من 8 أرقام هو آخر مستوى ولا تُضاف تحته حسابات فرعية. اختر حسابًا أعلى كأب. لم يُحفظ شيء.',
    'An 8-digit account is the last level and cannot have sub-accounts. Choose a higher account as the parent. Nothing was saved.',
  ],
  'ACCOUNT_NO_FREE_CODE': [
    'لا يوجد رمز فارغ تحت هذا الحساب الأب. اختر أبًا آخر أو اكتب رمزًا يدويًا. لم يُحفظ شيء.',
    'No free code is left under this parent. Choose another parent or enter a code by hand. Nothing was saved.',
  ],
  'ACCOUNT_NAME_REQUIRED': [
    'اسم الحساب مطلوب. اكتبه بالعربية أو بالإنجليزية ثم احفظ. لم يُحفظ شيء.',
    'The account needs a name. Write it in Arabic or English and save. Nothing was saved.',
  ],
  'ACCOUNT_PARENT_CHANGED': [
    'تغيّر الحساب الأب منذ فتحت الشاشة. حدّث الشاشة وراجع ثم أعد الحفظ. لم يُحفظ شيء.',
    'The account parent changed since you opened the screen. Reload, review and save again. Nothing was saved.',
  ],
  'ACCOUNT_OWN_PARENT': [
    'لا يكون الحساب أبًا لنفسه. اختر حسابًا آخر كأب. لم يُحفظ شيء.',
    'An account cannot be its own parent. Choose another account as the parent. Nothing was saved.',
  ],
  'ACCOUNT_ACTIVE_CHILDREN': [
    'للحساب حسابات فرعية فعّالة. أوقف الفرعية أولًا ثم أوقف الأب. لم يتغير شيء.',
    'The account has active sub-accounts. Deactivate the sub-accounts first, then the parent. Nothing changed.',
  ],
  'ACCOUNT_CODE_LOCKED_CHILDREN': [
    'للحساب حسابات فرعية تبدأ برمزه، فلا يُغيَّر رمزه. أنشئ حسابًا جديدًا بالرمز المطلوب. لم يتغير شيء.',
    'The account has sub-accounts whose codes start with its code, so its code cannot be changed. Create a new account with the code you want. Nothing changed.',
  ],
  'ACCOUNT_CODE_LOCKED_MOVEMENTS': [
    'على الحساب حركات قيود، فلا يُغيَّر رمزه. أوقفه وأنشئ حسابًا جديدًا. لم يتغير شيء.',
    'The account already has journal movements, so its code cannot be changed. Deactivate it and create a new account. Nothing changed.',
  ],
  'ACCOUNT_GROUPING': [
    'للحساب حسابات فرعية فهو حساب تجميعي ولا تُرحَّل عليه قيود. انقل الحسابات الفرعية أولًا. لم يتغير شيء.',
    'The account has sub-accounts, so it is a grouping account and cannot receive entries. Move the sub-accounts first. Nothing changed.',
  ],
  'ACCOUNT_MOVE_HISTORY': [
    'على الحساب أو حساباته الفرعية حركات، ونقلها يغيّر التقارير القديمة. اترك الحساب مكانه وأنشئ حسابًا جديدًا. لم يتغير شيء.',
    'The account or its sub-accounts have movements, and moving them would change old reports. Keep the account where it is and create a new one. Nothing changed.',
  ],
  'ACCOUNT_PARENT_MISSING': [
    'الحساب الأب غير موجود في هذه الشركة. اختر أبًا من الدليل. لم يُحفظ شيء.',
    'The parent account does not exist in this company. Choose a parent from the chart. Nothing was saved.',
  ],
  'ACCOUNT_PARENT_INACTIVE': [
    'الحساب الأب متوقف. فعّله أولًا ثم أضف الحساب الفرعي. لم يُحفظ شيء.',
    'The parent account is inactive. Activate it first, then add the sub-account. Nothing was saved.',
  ],
  'ACCOUNT_PARENT_TYPE': [
    'نوع الحساب الفرعي يجب أن يطابق نوع أبيه. غيّر النوع أو اختر أبًا من النوع نفسه. لم يُحفظ شيء.',
    'A sub-account must have the same type as its parent. Change the type or choose a parent of the same type. Nothing was saved.',
  ],
  'ACCOUNT_CYCLE': [
    'هذا الاختيار يجعل الحساب فرعًا من نفسه. اختر أبًا آخر. لم يُحفظ شيء.',
    'This choice would make the account a branch of itself. Choose another parent. Nothing was saved.',
  ],
  'POSTING_NEEDS_BOTH_SIDES': [
    'القيد يحتاج طرفًا مدينًا وآخر دائنًا. راجع المستند وأعد الترحيل. لم يُرحَّل شيء.',
    'A posting needs at least one debit and one credit. Check the document and post again. Nothing was posted.',
  ],
  'POSTING_ALREADY_POSTED': [
    'هذا المستند رُحِّل من قبل بقيد يومية. حدّث الشاشة لترى حالته. لم يتغير شيء.',
    'This document has already been posted as a journal entry. Reload the screen to see its state. Nothing changed.',
  ],
  'POSTING_ENTRY_MISSING': [
    'قيد اليومية المطلوب عكسه غير موجود. حدّث الشاشة وراجع المحاسب. لم يتغير شيء.',
    'The journal entry to reverse was not found. Reload the screen and check with your accountant. Nothing changed.',
  ],
  'POSTING_NOT_POSTED_REVERSE': [
    'لا يُعكس إلا القيد المرحّل. حدّث الشاشة لترى حالته. لم يتغير شيء.',
    'Only a posted journal entry can be reversed. Reload the screen to see its state. Nothing changed.',
  ],
  'POSTING_AMOUNT_INVALID': [
    'أحد مبالغ الترحيل غير صحيح أو سالب. راجع المبالغ في المستند وأعد الترحيل. لم يُرحَّل شيء.',
    'A posting amount is invalid or negative. Check the amounts on the document and post again. Nothing was posted.',
  ],
  'CC_TYPE_UNKNOWN': [
    'نوع مركز التكلفة غير معروف. اختر نوعًا من القائمة. لم يُحفظ شيء.',
    'The cost center type is not recognised. Choose a type from the list. Nothing was saved.',
  ],
  'CC_HAS_CHILDREN': [
    'تحت المركز مراكز فرعية. انقلها أو أوقفها أولًا. لم يتغير شيء.',
    'The cost center has child centers. Move or deactivate them first. Nothing changed.',
  ],
  'CC_IN_USE': [
    'المركز مستخدم في قيود أو توزيعات فلا يُحذف. أوقفه بدلًا من حذفه. لم يتغير شيء.',
    'The cost center is used in journal lines or allocations, so it cannot be deleted. Deactivate it instead. Nothing changed.',
  ],
  'CC_OWN_PARENT': [
    'لا يكون المركز أبًا لنفسه. اختر مركزًا آخر كأب. لم يُحفظ شيء.',
    'A cost center cannot be its own parent. Choose another center as the parent. Nothing was saved.',
  ],
  'CC_PARENT_MISSING': [
    'مركز التكلفة الأب غير موجود. اختر أبًا من القائمة. لم يُحفظ شيء.',
    'The parent cost center does not exist. Choose a parent from the list. Nothing was saved.',
  ],
  'CC_PARENT_INACTIVE': [
    'مركز التكلفة الأب متوقف. فعّله أو اختر أبًا آخر. لم يُحفظ شيء.',
    'The parent cost center is inactive. Activate it or choose another parent. Nothing was saved.',
  ],
  'CC_CYCLE': [
    'هذا النقل يجعل المركز فرعًا من أحد فروعه. اختر أبًا آخر. لم يتغير شيء.',
    'This move would make the center a branch of one of its own descendants. Choose another parent. Nothing changed.',
  ],
  'CC_TOO_DEEP': [
    'عدد مستويات مراكز التكلفة تجاوز الحد المسموح. اختر أبًا في مستوى أعلى. لم يُحفظ شيء.',
    'Cost centers are nested too deeply. Choose a parent at a higher level. Nothing was saved.',
  ],
  'CC_ALLOC_NEEDS_CENTER': [
    'كل توزيع يحتاج مركز تكلفة. اختر المركز في كل سطر توزيع. لم يُحفظ شيء.',
    'Every allocation needs a cost center. Choose the center on each allocation line. Nothing was saved.',
  ],
  'CC_ALLOC_REPEATED': [
    'نفس المركز ظهر مرتين في سطر واحد. اجمع المبلغين في توزيع واحد. لم يُحفظ شيء.',
    'The same cost center appears twice in one line. Combine the two amounts into one allocation. Nothing was saved.',
  ],
  'CC_ALLOC_AMOUNT': [
    'مبلغ توزيع غير صحيح: يجب أن يكون رقمًا أكبر من صفر بعدد خانات عشرية مسموح. صحّحه ثم احفظ. لم يُحفظ شيء.',
    'An allocation amount is not valid: it must be a number above zero with an allowed number of decimals. Correct it and save. Nothing was saved.',
  ],
  'CC_MISSING': [
    'مركز تكلفة أو أكثر غير موجود في هذه الشركة. اختر المراكز من القائمة. لم يُحفظ شيء.',
    'One or more cost centers do not exist in this company. Choose the centers from the list. Nothing was saved.',
  ],
};
