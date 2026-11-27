/// Reviewed sentences for permission, picture-upload, branch and print refusals:
/// what happened and how to fix it, `[Arabic, English]`.
const Map<String, List<String>> uploadPermissionRefusals = {
  'BARCODE_PERMISSION': [
    'ليس لديك صلاحية تعديل أكواد الباركود. اطلب من مدير النظام منح دورك صلاحية إدارة الباركود، أو احفظ بدون الباركود. لم يُحفظ شيء.',
    'You do not have permission to change barcodes. Ask the system administrator to give your role the barcode permission, or save without the barcode. Nothing was saved.',
  ],
  'SALE_PRICE_PERMISSION': [
    'ليس لديك صلاحية إدخال أو تعديل سعر البيع. اطلب من مدير النظام منح دورك هذه الصلاحية، أو احفظ بدون السعر. لم يُحفظ شيء.',
    'You do not have permission to enter or change the sale price. Ask the system administrator to give your role this permission, or save without the price. Nothing was saved.',
  ],
  'PURCHASE_PRICE_PERMISSION': [
    'ليس لديك صلاحية إدخال أو تعديل سعر الشراء. اطلب من مدير النظام منح دورك هذه الصلاحية، أو احفظ بدون السعر. لم يُحفظ شيء.',
    'You do not have permission to enter or change the purchase price. Ask the system administrator to give your role this permission, or save without the price. Nothing was saved.',
  ],
  'ITEM_OPENING_COST_PERMISSION': [
    'ليس لديك صلاحية إدخال تكلفة الرصيد الافتتاحي. اطلب من مدير النظام منح دورك صلاحية إدارة التكلفة، أو احفظ بدون التكلفة. لم يُحفظ شيء.',
    'You do not have permission to enter the opening balance cost. Ask the system administrator to give your role the cost permission, or save without the cost. Nothing was saved.',
  ],
  'ITEM_IMAGE_MISSING': [
    'لم تُرسل صورة. اختر ملف الصورة ثم أعد المحاولة. لم يتغير شيء.',
    'No image was sent. Choose the image file and try again. Nothing changed.',
  ],
  'CATALOGUE_VIEW_DENIED': [
    'ليس لديك صلاحية عرض أصناف أي مخزن. اطلب من مدير النظام إسناد مخزن لك. لم يتغير شيء.',
    'You do not have permission to view the items of any warehouse. Ask the system administrator to give you access to a warehouse. Nothing changed.',
  ],
  'ITEM_WH_MAX_BELOW_MIN': [
    'الحد الأقصى أقل من الحد الأدنى. اكتب حدًا أقصى أكبر من أو يساوي الحد الأدنى ثم احفظ. لم يُحفظ شيء.',
    'The maximum is below the minimum. Enter a maximum that is at least the minimum and save. Nothing was saved.',
  ],
  'ITEM_WH_REORDER_ABOVE_MAX': [
    'نقطة إعادة الطلب أعلى من الحد الأقصى. اكتب نقطة أقل من أو تساوي الحد الأقصى ثم احفظ. لم يُحفظ شيء.',
    'The reorder point is above the maximum. Enter a point at or below the maximum and save. Nothing was saved.',
  ],
  'LOGO_FORMAT': [
    'الشعار يجب أن يكون صورة PNG أو JPEG أو WebP. اختر ملفًا بهذه الصيغة ثم أعد الرفع. لم يتغير الشعار.',
    'The logo must be a PNG, JPEG or WebP image. Choose a file in one of these formats and upload again. The logo was not changed.',
  ],
  'LOGO_EMPTY': [
    'ملف الشعار فارغ. اختر ملف صورة سليمًا ثم أعد الرفع. لم يتغير الشعار.',
    'The logo file is empty. Choose a valid image file and upload again. The logo was not changed.',
  ],
  'LOGO_TOO_BIG': [
    'حجم الشعار يتجاوز الحد المسموح. اختر صورة أصغر ثم أعد الرفع. لم يتغير الشعار.',
    'The logo is larger than the allowed size. Choose a smaller image and upload again. The logo was not changed.',
  ],
  'LOGO_CONTENT_MISMATCH': [
    'محتوى الملف لا يطابق نوع الصورة. اختر ملف PNG أو JPEG أو WebP حقيقيًا ثم أعد الرفع. لم يتغير الشعار.',
    'The file content does not match its image type. Choose a real PNG, JPEG or WebP file and upload again. The logo was not changed.',
  ],
  'LOGO_WEBP_INVALID': [
    'ملف WebP غير صالح. اختر صورة أخرى أو حوّلها إلى PNG ثم أعد الرفع. لم يتغير الشعار.',
    'The WebP file is not valid. Choose another image or convert it to PNG and upload again. The logo was not changed.',
  ],
  'LOGO_DECODE': [
    'تعذّر فتح الصورة. اختر ملف PNG أو JPEG أو WebP سليمًا ثم أعد الرفع. لم يتغير الشعار.',
    'The image could not be opened. Choose a valid PNG, JPEG or WebP file and upload again. The logo was not changed.',
  ],
  'LOGO_DIMENSIONS': [
    'أبعاد الشعار غير مناسبة: يجب ألا تقل عن ٣٢ × ٣٢ بكسل، وألا تتجاوز الصورة المتحركة ١٦ مليون بكسل. اختر صورة مناسبة ثم أعد الرفع. لم يتغير الشعار.',
    'The logo size is not suitable: at least 32 x 32 pixels, and an animated image must stay under 16 million pixels. Choose a suitable image and upload again. The logo was not changed.',
  ],
  'LOGO_RESIZE': [
    'تعذّر ضغط الشعار. اختر صورة صالحة ثم أعد الرفع. لم يتغير الشعار.',
    'The logo could not be resized. Choose a valid image and upload again. The logo was not changed.',
  ],
  'LOGO_STILL_BIG': [
    'الشعار ما زال كبيرًا بعد الضغط. اختر صورة أصغر ثم أعد الرفع. لم يتغير الشعار.',
    'The logo is still too large after compression. Choose a smaller image and upload again. The logo was not changed.',
  ],
  'LOGO_FILE_MISSING': [
    'لم يتم اختيار ملف للشعار. اختر ملف الصورة ثم أعد الرفع. لم يتغير الشعار.',
    'No logo file was chosen. Choose the image file and upload again. The logo was not changed.',
  ],
  'NO_BRANCH_ASSIGNED': [
    'لا يوجد فرع مسند لحسابك. اطلب من مدير النظام إسناد فرع لك ثم أعد المحاولة. لم يتغير شيء.',
    'No branch is assigned to your account. Ask the system administrator to assign you a branch and try again. Nothing changed.',
  ],
  'BRANCH_SELECT_ASSIGNED': [
    'اختر أحد الفروع المسندة إليك ثم أعد المحاولة. لم يتغير شيء.',
    'Choose one of the branches assigned to you and try again. Nothing changed.',
  ],
  'BRANCH_ASSIGN_OUTSIDE': [
    'لا يمكنك إسناد فروع خارج الفروع المسندة إليك. اختر من فروعك فقط ثم احفظ. لم يُحفظ شيء.',
    'You can only assign branches that are assigned to you. Choose from your own branches and save. Nothing was saved.',
  ],
  'PRINT_NO_SETTINGS': [
    'لا توجد إعدادات للحفظ. غيّر إعدادًا واحدًا على الأقل ثم احفظ. لم يتغير شيء.',
    'There are no settings to save. Change at least one setting and save. Nothing changed.',
  ],
  'PRINT_UNKNOWN_TYPE': [
    'نوع الطباعة غير معروف. اختر نوعًا من القائمة ثم أعد المحاولة. لم يتغير شيء.',
    'The print type is not known. Choose a type from the list and try again. Nothing changed.',
  ],
  'PRINT_SETTING_INVALID': [
    'إعداد الطباعة غير صالح: يجب أن تكون القيمتان نعم أو لا. صحّح الإعداد ثم احفظ. لم يتغير شيء.',
    'The print setting is not valid: both values must be on or off. Correct it and save. Nothing changed.',
  ],
  'JOURNAL_STATUS_CHANGED': [
    'تغيّرت حالة القيد بواسطة عملية أخرى. حدّث الشاشة ثم أعد المحاولة. لم يتغير شيء.',
    'The journal entry status was changed by another action. Refresh the screen and try again. Nothing changed.',
  ],
};
