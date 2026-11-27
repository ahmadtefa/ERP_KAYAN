/// Reviewed sentences for stock transfers and storage locations: what
/// happened and how to fix it, `[Arabic, English]`.
const Map<String, List<String>> transferLocationRefusals = {
  'IDEMPOTENCY_HEADER_REQUIRED': [
    'الطلب بلا معرّف تكرار. أغلق الشاشة وافتحها من جديد ثم أعد المحاولة. لم يتغير شيء.',
    'The request has no repeat-protection identifier. Close the screen, open it again and retry. Nothing changed.',
  ],
  'STOCKXFER_LINE_COUNT': [
    'التحويل يحتاج من سطر إلى 500 سطر. أضف سطرًا أو قسّم التحويل ثم احفظ. لم يُحفظ شيء.',
    'A transfer needs 1 to 500 lines. Add a line or split the transfer and save. Nothing was saved.',
  ],
  'IDEMPOTENCY_KEY_REUSED_TRANSFER': [
    'معرّف هذا الطلب استُخدم لتحويل آخر. أغلق الشاشة وافتحها من جديد ثم أعد المحاولة. لم يُحفظ شيء.',
    'This request identifier was used for a different transfer. Close the screen, open it again and retry. Nothing was saved.',
  ],
  'STOCKXFER_WAREHOUSE_INVALID': [
    'مخزنا التحويل يجب أن يكونا فعّالين وتابعين لهذه الشركة. اختر مخزنين فعّالين من القائمة. لم يُحفظ شيء.',
    'The source and destination warehouses must be active warehouses of this company. Choose active warehouses from the list. Nothing was saved.',
  ],
  'STOCKXFER_SAME_WAREHOUSE': [
    'اخترت المخزن نفسه مصدرًا ووجهة. اختر مخزنين مختلفين ثم احفظ. لم يُحفظ شيء.',
    'The same warehouse is chosen as source and destination. Choose two different warehouses and save. Nothing was saved.',
  ],
  'STOCKXFER_LINE_NOT_TRACKED': [
    'أحد الأصناف غير مُتتبَّع مخزنيًا فلا يُحوَّل. احذفه من التحويل أو فعّل تتبع المخزون له. لم يُحفظ شيء.',
    'An item is not stock-tracked, so it cannot be transferred. Remove it from the transfer or turn on stock tracking for it. Nothing was saved.',
  ],
  'STOCKXFER_LINE_UNIT_MISSING': [
    'وحدة القياس المختارة غير موجودة لهذا الصنف. اختر وحدة من وحدات الصنف ثم احفظ. لم يُحفظ شيء.',
    'The chosen unit does not exist for this item. Choose one of the item\'s units and save. Nothing was saved.',
  ],
  'STOCKXFER_LINE_UNIT_INACTIVE': [
    'وحدة القياس المختارة موقوفة لهذا الصنف. اختر وحدة فعّالة أو فعّلها من شاشة الصنف. لم يُحفظ شيء.',
    'The chosen unit is inactive for this item. Choose an active unit or activate it on the item screen. Nothing was saved.',
  ],
  'STOCKXFER_LINE_QTY_INEXACT': [
    'الكمية لا تتحول إلى الوحدة الأساسية بدقة. اكتب كمية تناسب معامل الوحدة ثم احفظ. لم يُحفظ شيء.',
    'The quantity does not convert exactly to base units. Enter a quantity that fits the unit factor and save. Nothing was saved.',
  ],
  'STOCKXFER_LINE_LOT_UNAVAILABLE': [
    'دفعة المصدر غير متاحة أو كميتها غير كافية. اختر دفعة أخرى أو قلّل الكمية ثم احفظ. لم يُحفظ شيء.',
    'The source lot is unavailable or does not hold enough. Choose another lot or lower the quantity and save. Nothing was saved.',
  ],
  'STOCKXFER_LINE_LOT_REQUIRED': [
    'الصنف يُدار بالدفعات، فاختر دفعة المصدر لهذا السطر ثم احفظ. لم يُحفظ شيء.',
    'This item is lot-controlled, so choose the source lot for the line and save. Nothing was saved.',
  ],
  'STOCKXFER_OWN_REVIEW': [
    'لا يراجع طالبُ التحويل تحويلَه بنفسه. اطلب المراجعة من مستخدم آخر. لم يتغير شيء.',
    'The requester cannot review their own transfer. Ask another user to review it. Nothing changed.',
  ],
  'STOCKXFER_OWN_APPROVE': [
    'لا يعتمد طالبُ التحويل تحويلَه بنفسه. اطلب الاعتماد من مستخدم آخر. لم يتغير شيء.',
    'The requester cannot approve their own transfer. Ask another user to approve it. Nothing changed.',
  ],
  'STOCKXFER_REVIEWER_APPROVE': [
    'لا يعتمد المراجعُ التحويلَ الذي راجعه. اطلب الاعتماد من مستخدم آخر. لم يتغير شيء.',
    'The reviewer cannot also approve the transfer. Ask another user to approve it. Nothing changed.',
  ],
  'STOCKXFER_ACTOR_REQUIRED': [
    'قرار الاعتماد يحتاج مستخدمًا معرّفًا. سجّل الدخول من جديد ثم أعد المحاولة. لم يتغير شيء.',
    'An approval decision needs an identified user. Sign in again and retry. Nothing changed.',
  ],
  'STOCKXFER_REJECT_REASON': [
    'اكتب سبب الرفض ثم أعد المحاولة. لم يتغير شيء.',
    'Write the reason for rejecting and try again. Nothing changed.',
  ],
  'STOCKXFER_OWN_REJECT': [
    'لا يرفض طالبُ التحويل تحويلَه بنفسه. اطلب القرار من مستخدم آخر أو ألغِه. لم يتغير شيء.',
    'The requester cannot reject their own transfer. Ask another user to decide or cancel it. Nothing changed.',
  ],
  'STOCKXFER_RETURN_REASON': [
    'اكتب سبب الإرجاع ثم أعد المحاولة. لم يتغير شيء.',
    'Write the reason for returning and try again. Nothing changed.',
  ],
  'STOCKXFER_RETURN_STAGE': [
    'لا يمكن إرجاع التحويل في حالته الحالية. حدّث الشاشة وراجع حالته. لم يتغير شيء.',
    'The transfer cannot be returned in its current status. Refresh the screen and check its status. Nothing changed.',
  ],
  'STOCKXFER_OWN_RETURN': [
    'لا يُرجع طالبُ التحويل تحويلَه بنفسه. اطلب ذلك من مستخدم آخر. لم يتغير شيء.',
    'The requester cannot return their own transfer. Ask another user to do it. Nothing changed.',
  ],
  'IDEMPOTENCY_KEY_REUSED_QUANTITIES': [
    'معرّف الطلب استُخدم من قبل بكميات مختلفة. أغلق الشاشة وافتحها من جديد ثم أعد المحاولة. لم يتغير شيء.',
    'The request identifier was already used with different quantities. Close the screen, open it again and retry. Nothing changed.',
  ],
  'STOCKXFER_DISPATCH_STAGE': [
    'لا يمكن إرسال التحويل في حالته الحالية. حدّث الشاشة وراجع حالته. لم يتغير شيء.',
    'The transfer cannot be dispatched in its current status. Refresh the screen and check its status. Nothing changed.',
  ],
  'STOCKXFER_DISPATCH_BUSY': [
    'هناك عملية إرسال أخرى جارية لهذا التحويل. انتظر حتى تنتهي ثم أعد المحاولة. لم يتغير شيء.',
    'Another dispatch is in progress for this transfer. Wait until it finishes and try again. Nothing changed.',
  ],
  'STOCKXFER_RESERVATION_LOST': [
    'ضاع حجز الكمية أثناء العملية. حدّث الشاشة وأعد المحاولة. لم يتغير شيء.',
    'The quantity reservation was lost during the operation. Refresh the screen and try again. Nothing changed.',
  ],
  'STOCKXFER_RECEIVE_STAGE': [
    'لا يمكن استلام التحويل في حالته الحالية. حدّث الشاشة وراجع حالته. لم يتغير شيء.',
    'The transfer cannot be received in its current status. Refresh the screen and check its status. Nothing changed.',
  ],
  'STOCKXFER_RECEIVE_BUSY': [
    'هناك عملية استلام أخرى جارية لهذا التحويل. انتظر حتى تنتهي ثم أعد المحاولة. لم يتغير شيء.',
    'Another receipt is in progress for this transfer. Wait until it finishes and try again. Nothing changed.',
  ],
  'STOCKXFER_SETTLE_BEFORE_RECEIVE': [
    'استلم البضاعة المُرسَلة أولًا ثم سوِّ الفروق. لم يتغير شيء.',
    'Receive the dispatched goods first, then settle the differences. Nothing changed.',
  ],
  'STOCKXFER_LINE_UNKNOWN': [
    'أحد سطور التحويل غير معروف أو مكرر. حدّث الشاشة وأعد المحاولة. لم يتغير شيء.',
    'A transfer line is unknown or repeated. Refresh the screen and try again. Nothing changed.',
  ],
  'STOCKXFER_SETTLE_EXCEEDS': [
    'التسوية أكبر من الكمية المتبقية في الطريق. اكتب كمية لا تزيد عن المتبقية ثم أعد المحاولة. لم يتغير شيء.',
    'The settlement is more than the quantity still in transit. Enter a quantity not above what remains and try again. Nothing changed.',
  ],
  'STOCKXFER_SETTLE_REASON': [
    'اكتب سببًا لكل نقص أو تلف يُشطب. أكمل الأسباب ثم أعد المحاولة. لم يتغير شيء.',
    'A reason is required for every shortage or damage write-off. Fill in the reasons and try again. Nothing changed.',
  ],
  'STOCKXFER_SETTLE_EMPTY': [
    'اكتب الكميات المرتجعة أو المفقودة أو التالفة المراد تسويتها ثم أعد المحاولة. لم يتغير شيء.',
    'Enter the returned, missing or damaged quantities to settle and try again. Nothing changed.',
  ],
  'STOCKXFER_SETTLE_STAGE': [
    'لا يمكن تسوية التحويل في حالته الحالية. حدّث الشاشة وراجع حالته. لم يتغير شيء.',
    'The transfer cannot be settled in its current status. Refresh the screen and check its status. Nothing changed.',
  ],
  'STOCKXFER_SETTLE_CHANGED': [
    'ضاع حجز التسوية أو تغيّر. حدّث الشاشة وأعد المحاولة. لم يتغير شيء.',
    'The settlement reservation was lost or changed. Refresh the screen and try again. Nothing changed.',
  ],
  'IDEMPOTENCY_KEY_REUSED_APPROVAL': [
    'معرّف الطلب استُخدم لاعتماد تسوية مختلف. أغلق الشاشة وافتحها من جديد ثم أعد المحاولة. لم يتغير شيء.',
    'The request identifier was used for a different settlement approval. Close the screen, open it again and retry. Nothing changed.',
  ],
  'STOCKXFER_NO_PENDING_WRITEOFF': [
    'لا يوجد شطب فروق معلّق لاعتماده في هذا التحويل. حدّث الشاشة وراجع حالته. لم يتغير شيء.',
    'There is no pending write-off of differences to approve on this transfer. Refresh the screen and check its status. Nothing changed.',
  ],
  'STOCKXFER_OWN_WRITEOFF': [
    'لا يعتمد من أبلغ عن الفرق شطبَه. اطلب الاعتماد من مستخدم آخر. لم يتغير شيء.',
    'The person who reported a transfer difference cannot approve its write-off. Ask another user to approve it. Nothing changed.',
  ],
  'STOCKXFER_CLOSE_UNRECONCILED': [
    'لا يُقفل التحويل قبل تسوية الاستلام والفروق. أكمل الاستلام والتسوية ثم أقفله. لم يتغير شيء.',
    'A transfer can be closed only after receipts and differences are reconciled. Complete the receipt and settlement, then close it. Nothing changed.',
  ],
  'STOCKXFER_ACTION_UNKNOWN': [
    'الإجراء المطلوب غير معروف. اخترْه من الأزرار في شاشة التحويل. لم يتغير شيء.',
    'The requested action is not known. Choose it from the buttons on the transfer screen. Nothing changed.',
  ],
  'IDEMPOTENCY_KEY_REUSED_CANCEL': [
    'معرّف الطلب استُخدم لإلغاء مختلف. أغلق الشاشة وافتحها من جديد ثم أعد المحاولة. لم يتغير شيء.',
    'The request identifier was used for a different cancellation. Close the screen, open it again and retry. Nothing changed.',
  ],
  'STOCKXFER_CANCEL_PENDING_WRITEOFF': [
    'اعتمد شطب الفروق المعلّق أو سوِّه قبل إلغاء التحويل. لم يتغير شيء.',
    'Approve or reconcile the pending write-off before cancelling the transfer. Nothing changed.',
  ],
  'STOCKXFER_MOVEMENT_NOT_REVERSIBLE': [
    'إحدى حركات التحويل ليست في حالة تسمح بعكسها. راجع الحركة مع المحاسب. لم يتغير شيء.',
    'A transfer movement is not in a state that can be reversed. Review the movement with an accountant. Nothing changed.',
  ],
  'STOCKXFER_CANCEL_STAGE': [
    'لا يمكن إلغاء التحويل في مرحلته الحالية. حدّث الشاشة وراجع حالته. لم يتغير شيء.',
    'This transfer cannot be cancelled at its current stage. Refresh the screen and check its status. Nothing changed.',
  ],
  'IDEMPOTENCY_KEY_REUSED_ACTION': [
    'معرّف الطلب استُخدم لإجراء مختلف. أغلق الشاشة وافتحها من جديد ثم أعد المحاولة. لم يتغير شيء.',
    'The request identifier was used for a different action. Close the screen, open it again and retry. Nothing changed.',
  ],
  'STOCKXFER_STAGE_INVALID': [
    'لا يمكن نقل التحويل إلى هذه الحالة من حالته الحالية. حدّث الشاشة وراجع حالته. لم يتغير شيء.',
    'The transfer cannot move to that status from its current one. Refresh the screen and check its status. Nothing changed.',
  ],
  'STOCKXFER_TRANSIT_WAREHOUSE': [
    'تعذّر تجهيز مخزن العبور للشركة. أعد المحاولة، وإن تكرر الخطأ تواصل مع الدعم. لم يتغير شيء.',
    'The company transit warehouse could not be prepared. Try again, and if it repeats contact support. Nothing changed.',
  ],
  'STOCKXFER_NOTHING_AVAILABLE': [
    'لا توجد كميات متاحة لهذا الإجراء. حدّث الشاشة وراجع الكميات المتبقية. لم يتغير شيء.',
    'No quantities are available for this action. Refresh the screen and check the remaining quantities. Nothing changed.',
  ],
  'STOCKXFER_QTY_EXCEEDS': [
    'الكمية أكبر من المتاح لهذه المرحلة (غير المُرسَل أو الموجود في الطريق). اكتب كمية أقل ثم أعد المحاولة. لم يتغير شيء.',
    'The quantity is more than is available at this stage (undispatched or in transit). Enter a smaller quantity and try again. Nothing changed.',
  ],
  'STOCKXFER_TRANSIT_LOT': [
    'دفعة العبور غير متاحة. حدّث الشاشة وافتح التحويل من جديد. لم يتغير شيء.',
    'The transit lot is not available. Refresh the screen and open the transfer again. Nothing changed.',
  ],
  'STOCKXFER_NUMBER_INVALID': [
    'إحدى القيم يجب أن تكون أكبر من صفر. اكتب قيمة صحيحة ثم أعد المحاولة. لم يتغير شيء.',
    'A value must be greater than zero. Enter a valid value and try again. Nothing changed.',
  ],
  'STOCKXFER_DATE_INVALID': [
    'التاريخ غير صالح. اخترْه من التقويم بصيغة سنة-شهر-يوم ثم أعد المحاولة. لم يتغير شيء.',
    'The date is not valid. Pick it from the calendar in year-month-day form and try again. Nothing changed.',
  ],
  'LOCATION_VIEW_FORBIDDEN': [
    'لا تملك صلاحية عرض المواقع في هذا المخزن. اطلبها من المدير أو اختر مخزنًا آخر. لم يتغير شيء.',
    'You cannot view locations in this warehouse. Ask an administrator for access or choose another warehouse. Nothing changed.',
  ],
  'LOCATION_OTHER_BRANCH': [
    'هذا المخزن أو الموقع يتبع فرعًا آخر. اعمل من فرعه أو اختر ما يتبع فرعك. لم يتغير شيء.',
    'This warehouse or location belongs to another branch. Work from its branch or choose one in your branch. Nothing changed.',
  ],
  'LOCATION_MANAGE_FORBIDDEN': [
    'لا تملك صلاحية إدارة المواقع في هذا المخزن. اطلبها من المدير. لم يتغير شيء.',
    'You cannot manage locations in this warehouse. Ask an administrator for access. Nothing changed.',
  ],
  'LOCATION_KIND_UNKNOWN': [
    'نوع الموقع غير معروف. اختر نوعًا من القائمة ثم احفظ. لم يُحفظ شيء.',
    'The location type is not known. Choose a type from the list and save. Nothing was saved.',
  ],
  'LOCATION_OWN_PARENT': [
    'الموقع لا يحتوي نفسه. اختر موقعًا أعلى مختلفًا ثم احفظ. لم يُحفظ شيء.',
    'A location cannot contain itself. Choose a different parent location and save. Nothing was saved.',
  ],
  'LOCATION_PARENT_MISSING': [
    'الموقع الأعلى غير موجود هنا. اخترْه من القائمة ثم احفظ. لم يُحفظ شيء.',
    'The parent location does not exist here. Choose it from the list and save. Nothing was saved.',
  ],
  'LOCATION_KIND_NESTING': [
    'لا يُوضع هذا النوع من المواقع داخل النوع المختار. اختر موقعًا أعلى يناسبه ثم احفظ. لم يُحفظ شيء.',
    'This kind of location cannot be placed inside the chosen kind. Choose a parent that fits and save. Nothing was saved.',
  ],
  'LOCATION_BOTH_ACTIVE': [
    'الموقعان يجب أن يكونا فعّالين. فعّل الموقع الموقوف أو اختر آخر. لم يتغير شيء.',
    'Both locations must be active. Activate the inactive one or choose another. Nothing changed.',
  ],
  'LOCATION_MOVE_FORBIDDEN': [
    'لا تملك صلاحية نقل المخزون في هذا المخزن. اطلبها من المدير. لم يتغير شيء.',
    'You cannot move stock in this warehouse. Ask an administrator for access. Nothing changed.',
  ],
  'LOCATION_TRANSFER_GRANT': [
    'ليس لديك تصريح التحويل لهذا المخزن. اطلبه من المدير. لم يتغير شيء.',
    'You do not have the transfer grant for this warehouse. Ask an administrator for it. Nothing changed.',
  ],
  'LOCATION_MUST_BE_ACTIVE': [
    'الموقع يجب أن يكون فعّالًا. فعّله أو اختر موقعًا آخر. لم يتغير شيء.',
    'The location must be active. Activate it or choose another one. Nothing changed.',
  ],
  'LOCATION_LOT_NOT_HERE': [
    'هذه الدفعة ليست في هذا المخزن لهذا الصنف. اختر دفعة موجودة فيه ثم احفظ. لم يتغير شيء.',
    'That lot is not in this warehouse for this item. Choose a lot that is there and save. Nothing changed.',
  ],
  'STOCKXFER_REASON_REQUIRED': [
    'اكتب سبب التحويل ثم احفظ. لم يُحفظ شيء.',
    'Write the reason for the transfer and save. Nothing was saved.',
  ],
  'STOCKXFER_APPROVAL_CHAIN_ONLY': [
    'هذا التحويل يمرّ بسلسلة اعتماد: يرسله الطالب ثم يُقرَّر كل مستوى. استخدم زر الإرسال للاعتماد. لم يتغير شيء.',
    'This transfer uses an approval chain: the requester submits it, then each level is decided. Use the submit-for-approval button. Nothing changed.',
  ],
};
