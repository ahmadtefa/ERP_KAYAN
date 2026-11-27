/// Reviewed sentences for user, role and notification refusals: what happened
/// and how to fix it, `[Arabic, English]`.
const Map<String, List<String>> adminSecurityRefusals = {
  'GLOBAL_ROLE_SUPER_ADMIN_ONLY': [
    'صلاحيات الأدوار العامة للنظام يغيّرها المدير الأعلى فقط. اطلب ذلك منه أو أنشئ دورًا خاصًا بالشركة. لم يتغير شيء.',
    'Only a super administrator can change the permissions of a global system role. Ask one to do it or create a company role. Nothing changed.',
  ],
  'PERMISSION_GRANT_NOT_HELD': [
    'لا يمكنك منح صلاحية لا تملكها أنت. أزل الصلاحيات الزائدة أو اطلب من مدير يملكها ثم أعد المحاولة. لم يتغير شيء.',
    'You cannot grant a permission you do not hold yourself. Remove the extra permissions or ask an administrator who holds them, then try again. Nothing changed.',
  ],
  'USER_PHOTO_MISSING': [
    'لم تُرفع صورة. اختر ملف الصورة ثم أعد المحاولة. لم يتغير شيء.',
    'No photo file was uploaded. Choose the photo file and try again. Nothing changed.',
  ],
  'USER_EMAIL_TAKEN': [
    'هذا البريد الإلكتروني مستخدم في حساب آخر. اكتب بريدًا مختلفًا أو اتركه فارغًا. لم يُحفظ شيء.',
    'That email address is already used by another account. Enter a different email address or leave it empty. Nothing was saved.',
  ],
  'USER_USERNAME_TAKEN': [
    'اسم المستخدم هذا مستخدم بالفعل. اختر اسمًا مختلفًا. لم يُحفظ شيء.',
    'That username is already taken. Choose a different username. Nothing was saved.',
  ],
  'SUPER_ADMIN_MODIFY_ONLY': [
    'حساب المدير الأعلى يعدّله مدير أعلى فقط. اطلب ذلك من مدير أعلى. لم يتغير شيء.',
    'Only a super administrator can modify a super administrator account. Ask a super administrator to do it. Nothing changed.',
  ],
  'SUPER_ADMIN_RESET_ONLY': [
    'كلمة مرور المدير الأعلى يعيد تعيينها مدير أعلى فقط. اطلب ذلك من مدير أعلى. لم يتغير شيء.',
    'Only a super administrator can reset a super administrator password. Ask a super administrator to do it. Nothing changed.',
  ],
  'SUPER_ADMIN_DEACTIVATE_ONLY': [
    'حساب المدير الأعلى يوقفه مدير أعلى فقط. اطلب ذلك من مدير أعلى. لم يتغير شيء.',
    'Only a super administrator can deactivate a super administrator account. Ask a super administrator to do it. Nothing changed.',
  ],
  'NOTIFICATION_TYPE_UNKNOWN': [
    'نوع الإشعار غير معروف. اختر نوعًا من القائمة ثم أعد المحاولة. لم يتغير شيء.',
    'The notification type is not known. Choose a type from the list and try again. Nothing changed.',
  ],
  'NOTIFICATION_DAYS_INVALID': [
    'عدد الأيام يجب أن يكون رقمًا صحيحًا بين 1 و3650. اكتب رقمًا في هذا النطاق ثم أعد المحاولة. لم يتغير شيء.',
    'The number of days must be a whole number between 1 and 3650. Enter a number in that range and try again. Nothing changed.',
  ],
  'NOTIFICATION_SEVERITY_UNKNOWN': [
    'درجة أهمية الإشعار غير معروفة. اختر درجة من القائمة ثم أعد المحاولة. لم يتغير شيء.',
    'The notification severity is not known. Choose a severity from the list and try again. Nothing changed.',
  ],
};
