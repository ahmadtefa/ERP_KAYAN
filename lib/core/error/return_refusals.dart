/// Reviewed sentences for sales and purchase return refusals: what happened
/// and how to fix it, `[Arabic, English]`.
const Map<String, List<String>> returnRefusals = {
  'RETURN_INVOICE_MISSING': [
    'الفاتورة الأصلية للمرتجع غير موجودة. اختر الفاتورة من القائمة مرة أخرى. لم يُحفظ شيء.',
    'The original invoice of the return does not exist. Choose the invoice from the list again. Nothing was saved.',
  ],
  'RETURN_INVOICE_NOT_POSTED': [
    'لا يُرتجع إلا من فاتورة مرحّلة. رحّل الفاتورة أولًا أو اختر فاتورة مرحّلة. لم يُحفظ شيء.',
    'Only a posted invoice can be returned against. Post the invoice first or choose a posted one. Nothing was saved.',
  ],
  'RETURN_OF_RETURN': [
    'المستند المختار مرتجع بالفعل، ولا يُرتجع المرتجع. اختر الفاتورة الأصلية. لم يُحفظ شيء.',
    'The chosen document is already a return and a return cannot be returned. Choose the original invoice. Nothing was saved.',
  ],
  'RETURN_OTHER_BRANCH': [
    'يُسجَّل المرتجع في الفرع الذي أصدر الفاتورة الأصلية. سجّله من مستخدم ذلك الفرع. لم يُحفظ شيء.',
    'A return must be recorded in the branch that issued the original invoice. Record it from a user of that branch. Nothing was saved.',
  ],
  'RETURN_NO_LINES': [
    'المرتجع بلا سطور. اختر سطرًا واحدًا على الأقل ثم احفظ. لم يُحفظ شيء.',
    'The return has no lines. Choose at least one line and save. Nothing was saved.',
  ],
  'RETURN_DATE_BEFORE_INVOICE': [
    'تاريخ المرتجع قبل تاريخ الفاتورة. اختر تاريخًا في يوم الفاتورة أو بعده. لم يُحفظ شيء.',
    'The return date is before the invoice date. Choose a date on or after the invoice date. Nothing was saved.',
  ],
  'RETURN_LINE_NOT_ON_INVOICE': [
    'أحد سطور المرتجع لا يخص الفاتورة. اختر السطور من الفاتورة نفسها. لم يُحفظ شيء.',
    'A return line does not belong to the invoice. Choose lines from the invoice itself. Nothing was saved.',
  ],
  'RETURN_LINE_REPEATED': [
    'سطر الفاتورة نفسه ظهر مرتين في المرتجع. اجمع الكميتين في سطر واحد. لم يُحفظ شيء.',
    'The same invoice line appears twice in the return. Combine the quantities into one line. Nothing was saved.',
  ],
  'RETURN_OVER_RETURNABLE': [
    'الكمية المرتجعة أكبر من المتبقي القابل للإرجاع من هذا السطر، أو رُدّ السطر بالكامل. اكتب كمية أقل أو تساوي المتبقي. لم يُحفظ شيء.',
    'The returned quantity is more than what is still returnable on this line, or the line is already fully returned. Enter the remaining quantity or less. Nothing was saved.',
  ],
  'RETURN_PRICE_MISMATCH': [
    'سعر سطر المرتجع لا يطابق سعر الفاتورة الأصلية أو سعرها بعد الخصم. استخدم سعر الفاتورة الأصلية. لم يُحفظ شيء.',
    'The return line price does not match the original invoice price or its discounted price. Use the original invoice price. Nothing was saved.',
  ],
  'RETURN_WRONG_DOCUMENT_KIND': [
    'هذا المستند ليس من النوع الذي تتعامل معه هذه الخطوة. افتح المرتجع من شاشته الصحيحة (مبيعات أو مشتريات). لم يتغير شيء.',
    'This document is not of the type this step works with. Open the return from its own screen (sales or purchases). Nothing changed.',
  ],
  'RETURN_NOT_DRAFT': [
    'لا يُرحَّل إلا المرتجع في حالة مسودة، وهذا ليس كذلك. حدّث الشاشة لترى حالته. لم يتغير شيء.',
    'Only a draft return can be posted, and this one is not a draft. Reload the screen to see its state. Nothing changed.',
  ],
  'RETURN_NO_INVOICE': [
    'المرتجع غير مربوط بفاتورة. اختر الفاتورة التي يُرتجع منها ثم احفظ. لم يتغير شيء.',
    'The return is not linked to an invoice. Choose the invoice it returns and save. Nothing changed.',
  ],
  'RETURN_SOURCE_NOT_POSTED': [
    'الفاتورة الأصلية لم تعد مرحّلة فلا يُرحَّل المرتجع. راجع حالة الفاتورة أولًا. لم يتغير شيء.',
    'The source invoice is no longer posted, so the return cannot be posted. Check the invoice state first. Nothing changed.',
  ],
  'RETURN_CHANGED_ELSEWHERE': [
    'غيّر مستخدم آخر هذا المرتجع قبل لحظات. حدّث الشاشة لترى حالته الحالية. لم يتغير شيء.',
    'Someone else has just changed this return. Reload the screen to see its current state. Nothing changed.',
  ],
  'RETURN_ITEM_GONE': [
    'أحد أصناف المرتجع لم يعد موجودًا أو لم يعد مُتتبَّعًا في المخزون. راجع الصنف في شاشة الأصناف. لم يتغير شيء.',
    'An item of the return no longer exists or is no longer tracked in stock. Check the item in the items screen. Nothing changed.',
  ],
  'RETURN_COST_BELOW_INVOICE': [
    'تكلفة المخزون الموزعة أقل من قيمة الفاتورة المرتجعة. راجع حركة المخزون لهذا الصنف قبل المتابعة. لم يتغير شيء.',
    'The allocated inventory cost is below the value of the returned invoice. Check the stock movements of this item before continuing. Nothing changed.',
  ],
  'RETURN_STOCK_SHORT': [
    'الكمية المتاحة في المخزون أقل من المطلوبة لهذه الخطوة. أدخل البضاعة للمخزن أو قلّل الكمية. لم يتغير شيء.',
    'The quantity available in stock is less than this step needs. Bring the stock in or lower the quantity. Nothing changed.',
  ],
  'RETURN_STOCK_VALUE_SHORT': [
    'قيمة المخزون الحالية أقل من التكلفة المطلوب عكسها. راجع حركات المخزون وقيمته لهذا الصنف. لم يتغير شيء.',
    'The current stock value is less than the cost to reverse. Check the stock movements and value of this item. Nothing changed.',
  ],
  'RETURN_NOT_POSTED_REVERSE': [
    'لا يُعكس إلا المرتجع المرحّل. حدّث الشاشة لترى حالته. لم يتغير شيء.',
    'Only a posted return can be reversed. Reload the screen to see its state. Nothing changed.',
  ],
  'RETURN_QUANTITY_INVALID': [
    'كمية سطر المرتجع غير صحيحة، يجب أن تكون أكبر من صفر. صحّحها ثم احفظ. لم يُحفظ شيء.',
    'A return line quantity is not valid; it must be greater than zero. Correct it and save. Nothing was saved.',
  ],
  'RETURN_UNIT_MISMATCH': [
    'وحدة القياس في سطر المرتجع لا تطابق وحدة المستند الأصلي. استخدم وحدة السطر الأصلي نفسها. لم يُحفظ شيء.',
    'The unit on a return line does not match the original document unit. Use the same unit as the original line. Nothing was saved.',
  ],
  'RETURN_NUMBER_INVALID': [
    'قيمة رقمية في المرتجع غير صحيحة. اكتب أرقامًا فقط (مثل 150 أو 12.5) ثم احفظ. لم يُحفظ شيء.',
    'A number in the return is not valid. Enter digits only (for example 150 or 12.5) and save. Nothing was saved.',
  ],
};
