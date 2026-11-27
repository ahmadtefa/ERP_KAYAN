/// Reviewed sentences for company, full and master-data backup and restore
/// refusals: what happened and how to fix it, `[Arabic, English]`.
const Map<String, List<String>> backupRefusals = {
  'BACKUP_COMPANY_MISSING': [
    'الشركة غير موجودة على هذا الجهاز. سجّل الخروج وادخل من جديد ثم أعد المحاولة. لم يتغير شيء.',
    'The company was not found on this installation. Sign out, sign in again and retry. Nothing changed.',
  ],
  'BACKUP_DEMO_UNAVAILABLE': [
    'النسخة التجريبية غير متاحة أو غير صالحة في هذا التثبيت. استخدم ملف نسخة احتياطية حقيقي بدلًا منها. لم يتغير شيء.',
    'The demo backup is unavailable or not valid in this installation. Use a real backup file instead. Nothing changed.',
  ],
  'BACKUP_OTHER_COMPANY': [
    'هذه النسخة تخص شركة أخرى أو شركة غير موجودة هنا. ادخل إلى الشركة صاحبة النسخة أو على الجهاز الذي أُخذت منه ثم استعدها هناك. لم يتغير شيء.',
    'This backup belongs to another company, or to one that does not exist here. Sign in to that company or use the installation it came from, then restore it there. Nothing changed.',
  ],
  'BACKUP_MISSING_TABLES': [
    'النسخة ناقصة جداول فيها بيانات حالية للشركة، واستعادتها ستضيّع تلك البيانات. اعمل نسخة جديدة كاملة أو اختر نسخة أحدث. لم يتغير شيء.',
    'The backup is missing tables that currently hold company data, so restoring it would lose that data. Make a new complete backup or choose a newer one. Nothing changed.',
  ],
  'BACKUP_WOULD_REPLACE': [
    'الشركة فيها بيانات حاليًا، والاستعادة ستستبدلها. أكّد أنك تريد الاستبدال لتكمل، أو ألغِ العملية. لم يتغير شيء.',
    'The company already holds data, and restoring will replace it. Confirm that you want to replace it to continue, or cancel. Nothing changed.',
  ],
  'BACKUP_NOT_KAYAN': [
    'هذا الملف ليس نسخة احتياطية من البرنامج. اختر ملفًا نزّلته من شاشة النسخ الاحتياطي. لم يتغير شيء.',
    'This file is not a backup made by the program. Choose a file you downloaded from the backup screen. Nothing changed.',
  ],
  'BACKUP_NEWER_VERSION': [
    'هذه النسخة أُخذت من إصدار أحدث من البرنامج. حدّث البرنامج أولًا ثم أعد الاستعادة. لم يتغير شيء.',
    'This backup was made by a newer version of the program. Update the program first, then restore again. Nothing changed.',
  ],
  'BACKUP_TABLE_UNSUPPORTED': [
    'النسخة فيها بيانات لا يعرفها هذا الإصدار. استخدم إصدارًا مطابقًا للبرنامج. لم يتغير شيء.',
    'The backup contains data this version does not know. Use a matching version of the program. Nothing changed.',
  ],
  'BACKUP_OLD_PERMISSIONS': [
    'هذه النسخة القديمة لا تحمل رموز الصلاحيات ولا تطابق هذا الجهاز. استعدها على الجهاز الأصلي الذي أُخذت منه. لم يتغير شيء.',
    'This older backup does not carry permission codes and does not match this installation. Restore it on the original installation it came from. Nothing changed.',
  ],
  'BACKUP_FILE_INVALID': [
    'ملف النسخة الاحتياطية ناقص أو تالف أو معدَّل. نزّل نسخة جديدة سليمة من شاشة النسخ الاحتياطي واستعدها. لم يتغير شيء.',
    'The backup file is incomplete, damaged or edited. Download a fresh, intact copy from the backup screen and restore that. Nothing changed.',
  ],
  'BACKUP_NOT_JSON': [
    'تعذّرت قراءة الملف كنسخة احتياطية. قد يكون ناقصًا أو تالفًا. اختر الملف الأصلي الذي نزّلته من شاشة النسخ الاحتياطي. لم يتغير شيء.',
    'The file could not be read as a company backup. It may be incomplete or damaged. Choose the original file you downloaded from the backup screen. Nothing changed.',
  ],
  'FULL_BACKUP_FILE_MISSING': [
    'ملف النسخة الاحتياطية غير موجود على الخادم أو فارغ. اختر ملفًا من القائمة أو ارفع ملفًا آخر. لم يتغير شيء.',
    'The backup file is not on the server, or it is empty. Choose a file from the list or upload another. Nothing changed.',
  ],
  'FULL_BACKUP_UNREADABLE': [
    'تعذّرت قراءة الملف كنسخة كاملة، أو لم تنجح تجربة استعادته. قد يكون تالفًا أو من إصدار مختلف. قاعدة البيانات الحالية لم تُمسّ، فاختر نسخة أخرى. لم يتغير شيء.',
    'The file could not be read as a full backup, or its trial restore failed. It may be damaged or from a different version. The current database was not touched; choose another backup. Nothing changed.',
  ],
  'FULL_RESTORE_CONFIRM': [
    'الاستعادة الكاملة تستبدل قاعدة البيانات كلها. أكّد أنك فاهم ذلك ثم أعد الطلب. لم يتغير شيء.',
    'A full restore replaces the whole database. Confirm that you understand this, then send the request again. Nothing changed.',
  ],
  'FULL_RESTORE_CHOOSE_FILE': [
    'اختر ملف النسخة التي تريد استعادتها: ارفع ملفًا أو اختر واحدًا من الخادم. لم يتغير شيء.',
    'Choose the backup file to restore: upload one or pick one on the server. Nothing changed.',
  ],
  'FULL_RESTORE_BUSY': [
    'بدأت عملية صيانة أخرى أثناء تجربة الاستعادة. انتظر حتى تنتهي ثم أعد المحاولة. قاعدة البيانات لم تتغير.',
    'Another maintenance operation started during the restore trial. Wait until it finishes, then try again. The database was not changed.',
  ],
  'FULL_BACKUP_NAME_INVALID': [
    'اسم الملف غير صحيح أو خارج مجلد النسخ الاحتياطي. اختر ملفًا من القائمة. لم يتغير شيء.',
    'The file name is not valid or is outside the backup folder. Choose a file from the list. Nothing changed.',
  ],
  'FULL_BACKUP_EMPTY': [
    'ملف النسخة الاحتياطية فارغ. اختر ملفًا آخر. لم يتغير شيء.',
    'The backup file is empty. Choose another file. Nothing changed.',
  ],
  'MD_TOO_LARGE': [
    'القائمة أكبر من أن تُحفظ في نسخة واحدة. اعمل نسخة كاملة للشركة بدلًا منها. لم يُحفظ شيء.',
    'This list is too large for a single backup. Make a full company backup instead. Nothing was saved.',
  ],
  'MD_PREVIEW_FIRST': [
    'اعرض معاينة النسخة قبل استعادتها، ثم اضغط استعادة. لم يتغير شيء.',
    'Preview the backup before restoring it, then press restore. Nothing changed.',
  ],
  'MD_CHANGED_AFTER_PREVIEW': [
    'تغيّرت النسخة أو البيانات الحالية بعد المعاينة. اعرض المعاينة من جديد قبل الاستعادة. لم يتغير شيء.',
    'The backup or the current data changed after the preview. Preview again before restoring. Nothing changed.',
  ],
  'MD_CONFLICTS': [
    'توقفت الاستعادة بلا تغييرات لأن بعض السجلات تتعارض مع سجلات محذوفة. راجع المعاينة وأزل المتعارض ثم أعد المحاولة. لم يتغير شيء.',
    'The restore stopped without changes because some records conflict with deleted records. Check the preview, remove the conflicts and try again. Nothing changed.',
  ],
  'MD_WRONG_KIND': [
    'نوع هذه النسخة غير النوع الذي تستعيده. اختر ملفًا من النوع نفسه. لم يتغير شيء.',
    'This backup is of a different type than the one you are restoring. Choose a file of the same type. Nothing changed.',
  ],
  'MD_OTHER_COMPANY': [
    'هذه النسخة تخص شركة أخرى. ادخل إلى تلك الشركة لاستعادتها. لم يتغير شيء.',
    'This backup belongs to a different company. Sign in to that company to restore it. Nothing changed.',
  ],
  'MD_PRICES_NOT_ALLOWED': [
    'النسخة فيها أسعار ليس لك صلاحية استعادتها. اطلب الصلاحية من المدير أو استخدم نسخة بلا أسعار. لم يتغير شيء.',
    'The backup contains prices you are not allowed to restore. Ask the administrator for the permission or use a backup without prices. Nothing changed.',
  ],
  'MD_FILE_INVALID': [
    'ملف نسخة القوائم غير صالح: ليس نسخة من البرنامج أو إصداره غير مدعوم أو فيه سجل غير صحيح. اختر الملف الأصلي الذي نزّلته من البرنامج. لم يتغير شيء.',
    'The list backup file is not valid: it is not a program backup, its version is unsupported or it has a bad record. Choose the original file you downloaded from the program. Nothing changed.',
  ],
  'SYSTEM_RESTORE_RUNNING': [
    'هناك عملية استعادة أو تعافٍ تعمل الآن على قاعدة البيانات. انتظر حتى تنتهي ثم أعد المحاولة. لم يتغير شيء.',
    'A restore or recovery is already running on the database. Wait until it finishes, then try again. Nothing changed.',
  ],
};
