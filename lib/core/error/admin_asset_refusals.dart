/// Reviewed sentences for role, user and fixed-asset refusals: what happened
/// and how to fix it, `[Arabic, English]`.
const Map<String, List<String>> adminAssetRefusals = {
  'ROLE_CODE_FORMAT': [
    'رمز الدور يتكون من 2 إلى 40 حرفًا إنجليزيًا كبيرًا أو أرقامًا أو _ أو -. صحّحه ثم احفظ. لم يُحفظ شيء.',
    'A role code is 2 to 40 capital letters, digits, underscores or hyphens. Correct it and save. Nothing was saved.',
  ],
  'ROLE_CODE_RESERVED': [
    'هذا الرمز محجوز للنظام. اختر رمزًا آخر. لم يُحفظ شيء.',
    'That role code is reserved by the system. Choose another code. Nothing was saved.',
  ],
  'ROLE_CODE_DUPLICATE': [
    'يوجد دور بنفس الرمز. اختر رمزًا مختلفًا. لم يُحفظ شيء.',
    'A role with that code already exists. Choose a different code. Nothing was saved.',
  ],
  'ROLE_COPY_MISSING': [
    'الدور المطلوب نسخه غير موجود. حدّث الشاشة واختره من القائمة. لم يُحفظ شيء.',
    'The role to copy was not found. Reload the screen and choose it from the list. Nothing was saved.',
  ],
  'ROLE_SYSTEM_RENAME': [
    'أدوار النظام لا يُغيَّر اسمها. أنشئ دورًا جديدًا باسمك. لم يتغير شيء.',
    'A system role cannot be renamed. Create a new role with your own name. Nothing changed.',
  ],
  'ROLE_ADMIN_DISABLE': [
    'دور مدير النظام لا يُعطَّل. اتركه فعّالًا. لم يتغير شيء.',
    'The system administrator role cannot be disabled. Leave it active. Nothing changed.',
  ],
  'PERMISSION_UNKNOWN': [
    'صلاحية أو أكثر غير موجودة في النظام. حدّث الشاشة واختر الصلاحيات من القائمة. لم يُحفظ شيء.',
    'One or more permissions do not exist in the system. Reload the screen and choose permissions from the list. Nothing was saved.',
  ],
  'ROLE_PERMS_CHANGED': [
    'تغيّرت صلاحيات الدور منذ فتحت الشاشة. حدّث الشاشة وراجع ثم أعد الحفظ. لم يُحفظ شيء.',
    'The role permissions changed since you opened the screen. Reload, review and save again. Nothing was saved.',
  ],
  'ROLE_SYSTEM_REMOVE': [
    'أدوار النظام لا تُحذف. أوقفها إن لزم. لم يتغير شيء.',
    'A system role cannot be removed. Deactivate it if needed. Nothing changed.',
  ],
  'ROLE_IN_USE': [
    'ما زال مستخدمون يحملون هذا الدور. انقلهم إلى دور آخر ثم احذفه. لم يتغير شيء.',
    'Users still hold this role. Move them to another role first, then remove it. Nothing changed.',
  ],
  'USER_NAME_RESERVED': [
    'اسم المستخدم هذا محجوز للنظام. اختر اسمًا آخر. لم يُحفظ شيء.',
    'That username is reserved by the system. Choose another username. Nothing was saved.',
  ],
  'USER_EXTRA_PERMS_FORMAT': [
    'قائمة الصلاحيات الإضافية أو المرفوضة وصلت بصيغة غير صحيحة. أعد فتح الشاشة وأعد المحاولة. لم يُحفظ شيء.',
    'The extra or denied permission list arrived in a wrong format. Reopen the screen and try again. Nothing was saved.',
  ],
  'USER_EXPECTED_PERMS': [
    'بيانات الصلاحيات ناقصة. أعد فتح الشاشة وأعد المحاولة. لم يُحفظ شيء.',
    'The permission data is incomplete. Reopen the screen and try again. Nothing was saved.',
  ],
  'USER_ROLES_CHANGED': [
    'تغيّرت أدوار المستخدم منذ فتحت الشاشة. حدّث الشاشة وراجع ثم أعد الحفظ. لم يُحفظ شيء.',
    'The user roles changed since you opened the screen. Reload, review and save again. Nothing was saved.',
  ],
  'USER_PERMS_CHANGED': [
    'تغيّرت صلاحيات المستخدم منذ فتحت الشاشة. حدّث الشاشة وراجع ثم أعد الحفظ. لم يُحفظ شيء.',
    'The user permissions changed since you opened the screen. Reload, review and save again. Nothing was saved.',
  ],
  'USER_SELF_DEACTIVATE': [
    'لا يمكنك إيقاف حسابك أنت. اطلب من مدير آخر إيقافه إن لزم. لم يتغير شيء.',
    'You cannot deactivate your own account. Ask another administrator if it is needed. Nothing changed.',
  ],
  'USER_ROLE_MISSING': [
    'دور أو أكثر غير موجود في هذه الشركة. حدّث الشاشة واختر الأدوار من القائمة. لم يُحفظ شيء.',
    'One of the roles does not exist in this company. Reload the screen and choose roles from the list. Nothing was saved.',
  ],
  'PERMISSION_GONE': [
    'إحدى الصلاحيات لم تعد موجودة. حدّث الشاشة واختر من القائمة الحالية. لم يُحفظ شيء.',
    'One of the permissions no longer exists. Reload the screen and choose from the current list. Nothing was saved.',
  ],
  'USER_BRANCH_MISSING': [
    'فرع أو أكثر غير موجود في هذه الشركة. حدّث الشاشة واختر الفروع من القائمة. لم يُحفظ شيء.',
    'One of the branches does not exist in this company. Reload the screen and choose branches from the list. Nothing was saved.',
  ],
  'ASSET_PURCHASE_LINE_MISSING': [
    'سطر فاتورة الشراء المربوط بالأصل غير موجود. اختر السطر من الفاتورة مرة أخرى. لم يُحفظ شيء.',
    'The purchase invoice line for the asset does not exist. Choose the line from the invoice again. Nothing was saved.',
  ],
  'ASSET_LINE_OTHER_INVOICE': [
    'سطر الشراء يخص فاتورة غير المذكورة. اختر الفاتورة والسطر المتوافقين. لم يُحفظ شيء.',
    'The purchase line belongs to a different invoice than the one given. Choose a matching invoice and line. Nothing was saved.',
  ],
  'ASSET_LINE_COST_USED': [
    'تكلفة سطر الشراء رُسملت في أصول أخرى ولا يكفي ما تبقى. قلّل التكلفة أو اختر سطرًا آخر. لم يُحفظ شيء.',
    'The cost of the purchase line is already capitalised in other assets and what is left is not enough. Lower the cost or choose another line. Nothing was saved.',
  ],
  'ASSET_QTY_POSITIVE': [
    'الكمية المرسملة من سطر الشراء يجب أن تكون أكبر من صفر. صحّحها ثم احفظ. لم يُحفظ شيء.',
    'The quantity capitalised from a purchase line must be above zero. Correct it and save. Nothing was saved.',
  ],
  'ASSET_LINE_QTY_USED': [
    'كمية سطر الشراء (بعد المرتجعات) رُسملت في أصول أخرى ولا يكفي ما تبقى. قلّل الكمية أو اختر سطرًا آخر. لم يُحفظ شيء.',
    'The quantity of the purchase line (after returns) is already capitalised in other assets and what is left is not enough. Lower the quantity or choose another line. Nothing was saved.',
  ],
  'ASSET_CODE_DUPLICATE': [
    'يوجد أصل بنفس الرمز. اكتب رمزًا مختلفًا. لم يُحفظ شيء.',
    'An asset with that code already exists. Use a different code. Nothing was saved.',
  ],
  'ASSET_STATUS_UNKNOWN': [
    'حالة الأصل المطلوبة غير معروفة. اختر حالة من القائمة.',
    'The asset status you asked for is not recognised. Choose a status from the list.',
  ],
  'ASSET_NOT_DRAFT_EDIT': [
    'لا يُعدَّل إلا الأصل في حالة مسودة. الأصل المفعّل يُصحَّح بالاستبعاد أو بقيد يومية. لم يتغير شيء.',
    'Only a draft asset can be edited. An active asset is corrected through disposal or a journal entry. Nothing changed.',
  ],
  'ASSET_NOT_DRAFT_DELETE': [
    'لا يُحذف إلا الأصل في حالة مسودة. الأصل المسجّل يخرج بالاستبعاد. لم يتغير شيء.',
    'Only a draft asset can be deleted. An asset on the books leaves through disposal. Nothing changed.',
  ],
  'ASSET_NOT_DRAFT_ACTIVATE': [
    'لا يُفعَّل إلا الأصل في حالة مسودة، وهذا ليس كذلك. حدّث الشاشة لترى حالته. لم يتغير شيء.',
    'Only a draft asset can be activated, and this one is not a draft. Reload the screen to see its state. Nothing changed.',
  ],
  'ASSET_INVOICE_MISSING': [
    'فاتورة الشراء المربوطة بالأصل لم تعد موجودة فلا يُفعَّل عليها. اختر فاتورة أخرى أو أزل الربط. لم يتغير شيء.',
    'The purchase invoice linked to the asset no longer exists, so it cannot be activated against it. Choose another invoice or remove the link. Nothing changed.',
  ],
  'ASSET_INVOICE_NOT_POSTED': [
    'فاتورة الشراء لم تُرحَّل بعد. رحّلها أولًا، لأن التفعيل الآن يسجّل التكلفة مرتين. لم يتغير شيء.',
    'The purchase invoice is not posted yet. Post it first, because activating now would record the cost twice. Nothing changed.',
  ],
  'ASSET_INVENTORY_ACCOUNT': [
    'هذا الأصل جاء من فاتورة شراء مدينت حساب المخزون بالفعل. فعّله على حساب المخزون بدل حساب آخر. لم يتغير شيء.',
    'This asset came from a purchase invoice that already debited the inventory account. Activate it against the inventory account instead. Nothing changed.',
  ],
  'ASSET_NO_ISSUE_QTY': [
    'الأصل مربوط بسطر شراء لكن بلا كمية تُصرف من المخزون. اكتب الكمية ثم أعد المحاولة. لم يتغير شيء.',
    'The asset is linked to a purchase line but has no quantity to issue from stock. Enter the quantity and try again. Nothing changed.',
  ],
  'ASSET_NO_STOCK_ITEM': [
    'سطر الشراء المربوط ليس فيه صنف مخزني يُصرف. اختر سطرًا فيه صنف مخزني. لم يتغير شيء.',
    'The linked purchase line has no stocked item to issue. Choose a line with a stocked item. Nothing changed.',
  ],
  'ASSET_STOCK_SHORT': [
    'رصيد المخزون لا يكفي لرسملة الأصل من المخزن. أدخل البضاعة أو قلّل الكمية. لم يتغير شيء.',
    'There is not enough stock to capitalise the asset from stock. Bring the stock in or lower the quantity. Nothing changed.',
  ],
  'DEPRECIATION_NOTHING': [
    'لا يوجد ما يُهلك في هذه الفترة. راجع الأصول وتواريخ تفعيلها. لم يُسجَّل شيء.',
    'There is nothing to depreciate in this period. Check the assets and their activation dates. Nothing was recorded.',
  ],
  'DEPRECIATION_ALREADY': [
    'إهلاك هذه الفترة سُجّل من قبل لأصل أو أكثر من المختارة. اختر فترة أخرى أو أصولًا أخرى. لم يُسجَّل شيء.',
    'Depreciation for this period was already recorded for at least one of these assets. Choose another period or other assets. Nothing was recorded.',
  ],
  'ASSET_PROCEEDS_NEGATIVE': [
    'متحصلات الاستبعاد لا تكون سالبة. اكتب صفرًا أو مبلغًا موجبًا. لم يُحفظ شيء.',
    'Disposal proceeds cannot be negative. Enter zero or a positive amount. Nothing was saved.',
  ],
  'ASSET_PROCEEDS_ACCOUNT': [
    'اختر الحساب الذي استلم المتحصلات (خزينة أو بنك أو ذمم مدينة) ثم احفظ. لم يُحفظ شيء.',
    'Choose the account that received the proceeds (cash, bank or receivable) and save. Nothing was saved.',
  ],
  'ASSET_NOT_ACTIVE_DISPOSE': [
    'لا يُستبعد إلا الأصل المفعّل. حدّث الشاشة لترى حالته. لم يتغير شيء.',
    'Only an active asset can be disposed of. Reload the screen to see its state. Nothing changed.',
  ],
  'ASSET_DISPOSED_ELSEWHERE': [
    'استُبعد هذا الأصل بطلب آخر قبل لحظات. حدّث الشاشة لترى حالته. لم يتغير شيء.',
    'This asset was disposed of by another request a moment ago. Reload the screen to see its state. Nothing changed.',
  ],
  'ASSET_NO_BRANCH': [
    'حسابك غير مربوط بفرع فلا يملك أصولًا أو دورات إهلاك. اطلب من المدير ربطك بفرع. لم يُحفظ شيء.',
    'Your account is not assigned to a branch, so it cannot own assets or depreciation runs. Ask the administrator to assign you to a branch. Nothing was saved.',
  ],
  'ASSET_ACCOUNT_MISSING': [
    'أحد الحسابات المحاسبية للأصل غير موجود في هذه الشركة. اختر الحساب من الدليل المحاسبي. لم يُحفظ شيء.',
    'One of the asset ledger accounts does not exist in this company. Choose the account from the chart of accounts. Nothing was saved.',
  ],
};
