/// Reviewed sentences for company units, import and report refusals: what
/// happened and how to fix it, `[Arabic, English]`.
const Map<String, List<String>> companyImportReportRefusals = {
  'COMPANY_NAME_BLANK': [
    'اسم الشركة لا يُترك فارغًا. اكتب الاسم ثم احفظ. لم يُحفظ شيء.',
    'The company name cannot be blank. Enter the name and save. Nothing was saved.',
  ],
  'UNIT_HQ_NO_PARENT': [
    'المقر الرئيسي ليس له وحدة أعلى منه. اترك خانة الوحدة الأعلى فارغة. لم يُحفظ شيء.',
    'The headquarters cannot have a parent unit. Leave the parent unit empty. Nothing was saved.',
  ],
  'UNIT_HAS_CHILDREN': [
    'تحت هذه الوحدة وحدات فرعية. انقلها أو احذفها أولًا. لم يتغير شيء.',
    'This unit has sub-units under it. Move or delete them first. Nothing changed.',
  ],
  'UNIT_HAS_MOVEMENTS': [
    'على هذه الوحدة حركات محاسبية أو مخزنية، فلا تُحذف. أوقفها بدلًا من الحذف لتبقى السجلات سليمة. لم يتغير شيء.',
    'This unit already has accounting or stock movements, so it cannot be deleted. Deactivate it instead so the history stays intact. Nothing changed.',
  ],
  'UNIT_HAS_USERS': [
    'ما زال مستخدمون مرتبطين بهذه الوحدة. انقلهم إلى وحدة أخرى أولًا. لم يتغير شيء.',
    'Users are still assigned to this unit. Move them to another unit first. Nothing changed.',
  ],
  'UNIT_OWN_PARENT': [
    'لا تكون الوحدة أعلى من نفسها. اختر وحدة أخرى كوحدة أعلى. لم يُحفظ شيء.',
    'A unit cannot be its own parent. Choose another unit as the parent. Nothing was saved.',
  ],
  'UNIT_PARENT_MISSING': [
    'الوحدة الأعلى المختارة غير موجودة في هذه الشركة. اخترها من القائمة. لم يُحفظ شيء.',
    'The chosen parent unit does not exist in this company. Choose it from the list. Nothing was saved.',
  ],
  'UNIT_CYCLE': [
    'هذا الاختيار يجعل الوحدة تابعة لإحدى وحداتها الفرعية. اختر وحدة أعلى أخرى. لم يُحفظ شيء.',
    'This choice would make the unit a child of one of its own sub-units. Choose another parent. Nothing was saved.',
  ],
  'UNIT_BRANCH_NEEDS_PARENT': [
    'الفرع يحتاج وحدة أعلى منه. أنشئ المقر الرئيسي أولًا أو اختر الوحدة الأعلى بنفسك. لم يُحفظ شيء.',
    'A branch needs a parent unit. Create the headquarters first, or choose the parent yourself. Nothing was saved.',
  ],
  'IMPORT_NO_FILE': [
    'لم يصل أي ملف. اختر ملف xlsx أو csv ثم أعد المحاولة. لم يُستورد شيء.',
    'No file arrived. Choose an xlsx or csv file and try again. Nothing was imported.',
  ],
  'IMPORT_KIND_UNKNOWN': [
    'نوع الاستيراد غير معروف. اختر النوع من القائمة في شاشة الاستيراد. لم يُستورد شيء.',
    'The import type is not recognised. Choose the type from the list on the import screen. Nothing was imported.',
  ],
  'IMPORT_TAX_COLUMNS': [
    'الملف فيه أكثر من عمود لنسبة الضريبة. أبقِ عمودًا واحدًا ثم أعد الاستيراد. لم يُستورد شيء.',
    'The file has more than one tax rate column. Keep only one and import again. Nothing was imported.',
  ],
  'IMPORT_PARENT_CHANGED': [
    'تغيّر حساب أب أثناء استيراد الملف. اقرأ الملف من جديد وأعد المحاولة. لم يُستورد شيء.',
    'An account parent changed while the file was being imported. Read the file again and retry. Nothing was imported.',
  ],
  'IMPORT_PARENT_HAS_MOVEMENTS': [
    'حساب أب في الملف عليه حركات، فلا يصير حسابًا تجميعيًا. اختر أبًا آخر في الملف. لم يُستورد شيء.',
    'A parent account in the file already has movements and cannot become a grouping account. Choose another parent in the file. Nothing was imported.',
  ],
  'IMPORT_HIERARCHY': [
    'تسلسل الحسابات في الملف تغيّر أو فيه دورة غير محلولة. راجع عمود الحساب الأب وأعد الاستيراد. لم يُستورد شيء.',
    'The account hierarchy changed or contains an unresolved cycle. Check the parent account column and import again. Nothing was imported.',
  ],
  'REPORT_FILTER_UNKNOWN': [
    'قيمة الفلتر غير معروفة. اخترها من القائمة في شاشة التقرير.',
    'The filter value is not recognised. Choose it from the list on the report screen.',
  ],
  'REPORT_CONTROL_ACCOUNT_MISSING': [
    'حساب العملاء أو الموردين الرئيسي غير موجود في دليل حسابات هذه الشركة. راجع الدليل المحاسبي ثم أعد التقرير.',
    'The customer or supplier control account does not exist in this company chart of accounts. Check the chart and run the report again.',
  ],
  'REPORT_DATE_INVALID': [
    'التاريخ غير صحيح. اختر تاريخًا حقيقيًا من التقويم ثم أعد التقرير.',
    'The date is not valid. Pick a real date from the calendar and run the report again.',
  ],
  'REPORT_ACCOUNT_MISSING': [
    'الحساب غير موجود في هذه الشركة. اخترْه من الدليل المحاسبي ثم أعد التقرير.',
    'The account does not exist in this company. Choose it from the chart of accounts and run the report again.',
  ],
};
