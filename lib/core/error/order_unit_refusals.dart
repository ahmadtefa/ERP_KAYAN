/// Reviewed sentences for sales-order conversion and editing and for unit
/// conversion refusals: what happened and how to fix it, `[Arabic, English]`.
const Map<String, List<String>> orderUnitRefusals = {
  'IDEMPOTENCY_KEY_INVALID': [
    'تعذّر التحقق من طلبك لأن معرّف الطلب غير صالح. أغلق الشاشة وافتحها من جديد ثم أعد المحاولة. لم يُحفظ شيء.',
    'Your request could not be checked because its request identifier is not valid. Close the screen, open it again and retry. Nothing was saved.',
  ],
  'ORDER_INVOICE_DATE_INVALID': [
    'تاريخ الفاتورة غير صالح. اختر التاريخ من التقويم ثم أعد المحاولة. لم يُحفظ شيء.',
    'The invoice date is not valid. Pick the date from the calendar and try again. Nothing was saved.',
  ],
  'ORDER_LINES_NOT_SELECTED': [
    'لم تختر أي سطر من الأمر لتحويله إلى فاتورة. اختر سطرًا واحدًا على الأقل مع كميته ثم أعد المحاولة. لم يُحفظ شيء.',
    'No order line was chosen for the invoice. Choose at least one line with its quantity and try again. Nothing was saved.',
  ],
  'ORDER_LINE_SELECTION_INVALID': [
    'اختيار سطور الأمر غير صالح. أعد اختيار السطور والكميات ثم أعد المحاولة. لم يُحفظ شيء.',
    'The chosen order lines are not valid. Choose the lines and quantities again and retry. Nothing was saved.',
  ],
  'ORDER_LINE_NOT_ON_ORDER': [
    'أحد السطور المختارة لا يخص هذا الأمر. حدّث الشاشة واختر السطور من الأمر نفسه. لم يُحفظ شيء.',
    'A chosen line does not belong to this order. Refresh the screen and choose lines from the order itself. Nothing was saved.',
  ],
  'ORDER_LINE_DUPLICATE_SELECTION': [
    'اخترت أحد سطور الأمر أكثر من مرة. اختر كل سطر مرة واحدة فقط ثم أعد المحاولة. لم يُحفظ شيء.',
    'An order line was chosen more than once. Choose each line only once and try again. Nothing was saved.',
  ],
  'ORDER_QUANTITY_NOT_POSITIVE': [
    'الكمية يجب أن تكون أكبر من صفر. اكتب كمية صحيحة في كل سطر ثم أعد المحاولة. لم يُحفظ شيء.',
    'The quantity must be greater than zero. Enter a valid quantity on each line and try again. Nothing was saved.',
  ],
  'ORDER_UNIT_SNAPSHOT_INCOMPLETE': [
    'بيانات وحدة القياس المحفوظة في هذا السطر ناقصة. راجع السطر مع المحاسب أو أنشئ الأمر من جديد. لم يتغير شيء.',
    'The saved unit data on this line is incomplete. Review the line with an accountant or create the order again. Nothing changed.',
  ],
  'ORDER_UNIT_PRECISION': [
    'لا يمكن تمثيل هذه الكمية بدقة وحدة القياس الأصلية للسطر. اختر كمية تناسب الوحدة المسجلة ثم أعد المحاولة. لم يُحفظ شيء.',
    'This quantity cannot be represented at the precision of the line\'s original unit. Choose a quantity that fits the recorded unit and try again. Nothing was saved.',
  ],
  'ORDER_UNIT_SNAPSHOT_MISMATCH': [
    'وحدة القياس في سطر الفاتورة لا تطابق وحدة سطر الأمر. راجع الوحدة مع المحاسب قبل المتابعة. لم يتغير شيء.',
    'The unit on the invoice line does not match the unit on the order line. Review the unit with an accountant before continuing. Nothing changed.',
  ],
  'ORDER_EDIT_LINES_INCOMPLETE': [
    'يجب إرسال كل سطور الأمر الحالية مرة واحدة بالضبط عند التعديل. حدّث الشاشة وأعد التعديل. لم يتغير شيء.',
    'Every current order line must be sent exactly once when editing. Refresh the screen and edit again. Nothing changed.',
  ],
  'ORDER_EDIT_LINE_INVALID': [
    'أحد سطور الأمر غير صالح أو مكرر. حدّث الشاشة وأعد التعديل. لم يتغير شيء.',
    'An order line is not valid or is duplicated. Refresh the screen and edit again. Nothing changed.',
  ],
  'ORDER_NUMBER_INVALID': [
    'إحدى القيم المكتوبة ليست رقمًا صالحًا. اكتب أرقامًا فقط ثم أعد المحاولة. لم يُحفظ شيء.',
    'One of the values is not a valid number. Enter numbers only and try again. Nothing was saved.',
  ],
  'ORDER_NUMBER_RANGE': [
    'إحدى القيم خارج الحد أو الدقة المسموحة. استخدم رقمًا أصغر وبعدد كسور أقل ثم أعد المحاولة. لم يُحفظ شيء.',
    'One of the values is outside the allowed range or precision. Use a smaller number with fewer decimals and try again. Nothing was saved.',
  ],
  'ORDER_AMOUNT_RANGE': [
    'أحد المبالغ أكبر من الحد المسموح للمبالغ. اكتب مبلغًا أقل ثم أعد المحاولة. لم يُحفظ شيء.',
    'An amount is larger than the allowed money limit. Enter a smaller amount and try again. Nothing was saved.',
  ],
  'ORDER_ALLOCATION_INCONSISTENT': [
    'توزيع الكميات على فواتير هذا الأمر غير متسق، فلا يمكن تعديله تلقائيًا. راجعه يدويًا مع المحاسب. لم يتغير شيء.',
    'The quantities allocated to this order\'s invoices are inconsistent, so it cannot be edited automatically. Review it by hand with an accountant. Nothing changed.',
  ],
  'ORDER_LINE_ALLOCATED': [
    'هذا السطر محوَّل بالفعل إلى فاتورة فلا يُعدَّل كمسودة. أنشئ فاتورة أو مرتجعًا بدل تعديله. لم يتغير شيء.',
    'This line is already invoiced, so it cannot be edited as a draft. Create an invoice or a return instead. Nothing changed.',
  ],
  'ORDER_QUANTITY_BELOW_ALLOCATED': [
    'الكمية أقل من الكمية المحوَّلة بالفعل إلى فواتير. اكتب كمية لا تقل عن المفوترة ثم أعد المحاولة. لم يتغير شيء.',
    'The quantity is lower than the quantity already invoiced. Enter a quantity not lower than the invoiced one and try again. Nothing changed.',
  ],
  'ORDER_ALLOCATED_TERMS_LOCKED': [
    'لا تُعدَّل الشروط المالية لسطر حُوِّل بالفعل إلى فاتورة (السعر والخصم والضريبة). عدّل سطرًا آخر أو أنشئ أمرًا جديدًا. لم يتغير شيء.',
    'The financial terms (price, discount, tax) of an already invoiced line cannot be changed. Edit another line or create a new order. Nothing changed.',
  ],
  'ORDER_REALLOCATION_EXCEEDS': [
    'الكمية المطلوبة أكبر من المتبقي على سطر الأمر. اكتب كمية لا تزيد عن المتبقي ثم أعد المحاولة. لم يتغير شيء.',
    'The requested quantity is more than what remains on the order line. Enter a quantity not above the remaining one and try again. Nothing changed.',
  ],
  'UNIT_NUMBER_INVALID': [
    'قيمة وحدة القياس أو معاملها ليست رقمًا صالحًا. اكتب رقمًا صحيحًا ثم أعد المحاولة. لم يُحفظ شيء.',
    'The unit value or its factor is not a valid number. Enter a valid number and try again. Nothing was saved.',
  ],
  'UNIT_FACTOR_RANGE': [
    'معامل وحدة القياس يجب أن يكون أكبر من صفر وضمن الحد المسموح. اكتب معاملًا أصغر ثم أعد المحاولة. لم يُحفظ شيء.',
    'The unit factor must be greater than zero and within the allowed limit. Enter a smaller factor and try again. Nothing was saved.',
  ],
  'UNIT_FACTOR_SCALE': [
    'معامل وحدة القياس فيه كسور أكثر من المسموح. قلّل عدد الكسور ثم أعد المحاولة. لم يُحفظ شيء.',
    'The unit factor has more decimal places than allowed. Reduce the decimals and try again. Nothing was saved.',
  ],
  'UNIT_QUANTITY_SCALE': [
    'الكمية فيها كسور أكثر من المسموح. قلّل عدد الكسور ثم أعد المحاولة. لم يُحفظ شيء.',
    'The quantity has more decimal places than allowed. Reduce the decimals and try again. Nothing was saved.',
  ],
  'UNIT_STORAGE_RANGE': [
    'الكمية أو المعامل أكبر من الحد المسموح للتخزين. اكتب قيمة أصغر ثم أعد المحاولة. لم يُحفظ شيء.',
    'The quantity or factor is larger than the allowed storage limit. Enter a smaller value and try again. Nothing was saved.',
  ],
  'UNIT_CONVERTED_SCALE': [
    'الكمية بعد التحويل إلى الوحدة الأساسية فيها كسور أكثر من المسموح. عدّل الكمية أو الوحدة ثم أعد المحاولة. لم يُحفظ شيء.',
    'The quantity converted to the base unit has more decimals than allowed. Change the quantity or unit and try again. Nothing was saved.',
  ],
  'UNIT_NOT_OF_ITEM': [
    'وحدة القياس المختارة لا تخص هذا الصنف. اختر وحدة من وحدات الصنف ثم أعد المحاولة. لم يُحفظ شيء.',
    'The chosen unit does not belong to this item. Choose one of the item\'s units and try again. Nothing was saved.',
  ],
  'UNIT_NOT_DEFINED': [
    'وحدة القياس المكتوبة غير معرّفة لهذا الصنف. اختر وحدة من القائمة أو أضفها في شاشة الصنف. لم يُحفظ شيء.',
    'The unit entered is not defined for this item. Choose a unit from the list or add it on the item screen. Nothing was saved.',
  ],
  'UNIT_INACTIVE': [
    'وحدة القياس المختارة موقوفة ولا تُستخدم في مستند جديد. اختر وحدة فعّالة أو فعّلها من شاشة الصنف. لم يُحفظ شيء.',
    'The chosen unit is inactive and cannot be used on a new document. Choose an active unit or activate it on the item screen. Nothing was saved.',
  ],
  'UNIT_LINE_PROBLEM': [
    'وحدة القياس المختارة غير مفعّلة لهذا الغرض (بيع أو شراء). اختر وحدة مفعّلة له أو فعّلها من شاشة الصنف. لم يُحفظ شيء.',
    'The chosen unit is not enabled for this purpose (sale or purchase). Choose a unit enabled for it or enable it on the item screen. Nothing was saved.',
  ],
  'UNIT_CONVERTED_ZERO': [
    'الكمية بعد التحويل إلى الوحدة الأساسية تساوي صفرًا. راجع معامل الوحدة والكمية ثم أعد المحاولة. لم يُحفظ شيء.',
    'The quantity converted to the base unit is zero. Check the unit factor and the quantity and try again. Nothing was saved.',
  ],
};
