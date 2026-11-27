/// Reviewed sentences for approval policy, approval decision and warehouse
/// refusals: what happened and how to fix it, `[Arabic, English]`.
const Map<String, List<String>> approvalWarehouseRefusals = {
  'APPROVAL_OPERATION_UNKNOWN': [
    'نوع العملية في سياسة الاعتماد غير معروف. اختر عملية من القائمة. لم يُحفظ شيء.',
    'The operation in the approval policy is not recognised. Choose an operation from the list. Nothing was saved.',
  ],
  'APPROVAL_POLICY_NAME': [
    'اسم السياسة مطلوب بالعربية والإنجليزية وبحد أقصى 120 حرفًا. صحّح الاسمين ثم احفظ. لم يُحفظ شيء.',
    'The policy name is required in Arabic and English, at most 120 characters. Correct both names and save. Nothing was saved.',
  ],
  'APPROVAL_PRIORITY_RANGE': [
    'الأولوية رقم صحيح بين 0 و100000. صحّحها ثم احفظ. لم يُحفظ شيء.',
    'Priority must be a whole number from 0 to 100000. Correct it and save. Nothing was saved.',
  ],
  'APPROVAL_TOO_MANY_LEVELS': [
    'السياسة تقبل 10 مستويات اعتماد كحد أقصى. احذف بعض المستويات ثم احفظ. لم يُحفظ شيء.',
    'A policy can have at most 10 approval levels. Remove some levels and save. Nothing was saved.',
  ],
  'APPROVAL_LEVELS_NUMBERING': [
    'أرقام المستويات يجب أن تكون متسلسلة من 1 إلى 10. رتّبها ثم احفظ. لم يُحفظ شيء.',
    'Level numbers must run in order from 1 to 10. Put them in order and save. Nothing was saved.',
  ],
  'APPROVAL_LEVEL_REPEATED': [
    'رقم مستوى مكرر في السياسة. اجعل لكل مستوى رقمًا مختلفًا. لم يُحفظ شيء.',
    'A level number is repeated in the policy. Give each level a different number. Nothing was saved.',
  ],
  'APPROVAL_LEVEL_PERMISSION': [
    'كل مستوى يحتاج صلاحية صحيحة وغير طويلة. اختر الصلاحية من القائمة. لم يُحفظ شيء.',
    'Each level needs a valid permission that is not too long. Choose the permission from the list. Nothing was saved.',
  ],
  'APPROVAL_NUMBER_INVALID': [
    'قيمة رقمية في السياسة غير صحيحة: يجب أن تكون رقمًا لا يقل عن صفر. صحّحها ثم احفظ. لم يُحفظ شيء.',
    'A number in the policy is not valid: it must be a number of zero or more. Correct it and save. Nothing was saved.',
  ],
  'APPROVAL_DECISION_UNKNOWN': [
    'القرار غير معروف. اختر موافقة أو رفض أو إرجاع. لم يُسجَّل شيء.',
    'The decision is not recognised. Choose approve, reject or return. Nothing was recorded.',
  ],
  'APPROVAL_REASON_REQUIRED': [
    'الرفض أو الإرجاع يحتاج سببًا. اكتب السبب ثم أعد المحاولة. لم يُسجَّل شيء.',
    'A rejection or return needs a reason. Write the reason and try again. Nothing was recorded.',
  ],
  'APPROVAL_REASON_LONG': [
    'السبب أطول من 2000 حرف. اختصره ثم أعد المحاولة. لم يُسجَّل شيء.',
    'The reason is longer than 2000 characters. Shorten it and try again. Nothing was recorded.',
  ],
  'APPROVAL_NO_CHAIN': [
    'هذا المستند لا يستخدم سلسلة اعتماد. لا حاجة لقرار هنا. لم يتغير شيء.',
    'This document does not use an approval chain, so no decision is needed here. Nothing changed.',
  ],
  'APPROVAL_KEY_REUSED': [
    'طلب القرار هذا استُخدم من قبل لقرار مختلف. حدّث الشاشة وأعد اتخاذ القرار. لم يُسجَّل شيء.',
    'This decision request was already used for a different decision. Reload the screen and decide again. Nothing was recorded.',
  ],
  'APPROVAL_ALREADY_DECIDED': [
    'سلسلة الاعتماد هذه حُسمت بالفعل. حدّث الشاشة لترى النتيجة. لم يتغير شيء.',
    'This approval chain has already been decided. Reload the screen to see the result. Nothing changed.',
  ],
  'APPROVAL_NO_PENDING_LEVEL': [
    'لا يوجد مستوى ينتظر قرارًا حاليًا. حدّث الشاشة لترى حالة الطلب. لم يتغير شيء.',
    'No level is waiting for a decision right now. Reload the screen to see the request state. Nothing changed.',
  ],
  'APPROVAL_LEVEL_MOVED': [
    'المستوى المنتظر تغيّر منذ فتحت الطلب. حدّث الشاشة ثم اتخذ قرارك. لم يُسجَّل شيء.',
    'The pending level changed since you opened the request. Reload the screen and then decide. Nothing was recorded.',
  ],
  'APPROVAL_LEVEL_DECIDED_ELSEWHERE': [
    'اعتمد مستخدم آخر هذا المستوى قبل لحظات. حدّث الشاشة لترى الطلب. لم يتغير شيء.',
    'Someone else decided this level a moment ago. Reload the screen to see the request. Nothing changed.',
  ],
  'WAREHOUSE_NAME_REQUIRED': [
    'اسم المستودع مطلوب. اكتبه بالعربية أو بالإنجليزية ثم احفظ. لم يُحفظ شيء.',
    'The warehouse needs a name. Write it in Arabic or English and save. Nothing was saved.',
  ],
  'WAREHOUSE_DEFAULT_KEEP': [
    'لكل فرع مستودع افتراضي ولا يُوقف. اجعل مستودعًا آخر هو الافتراضي أولًا. لم يتغير شيء.',
    'A branch must keep a default warehouse, and it cannot be deactivated. Make another warehouse the default first. Nothing changed.',
  ],
  'WAREHOUSE_MISSING': [
    'المستودع غير موجود في هذه الشركة. حدّث الشاشة واختره من القائمة. لم يُحفظ شيء.',
    'The warehouse does not exist in this company. Reload the screen and choose it from the list. Nothing was saved.',
  ],
  'WAREHOUSE_ORIGINAL_UNAVAILABLE': [
    'المستودع المسجّل في المستند الأصلي لم يعد متاحًا في هذه الشركة والفرع. راجع المستودعات أو اختر مستندًا آخر. لم يتغير شيء.',
    'The warehouse recorded on the original document is no longer available in this company and branch. Check the warehouses or choose another document. Nothing changed.',
  ],
};
