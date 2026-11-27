/// Reviewed sentences for lot and storage-location refusals: what happened and
/// how to fix it, `[Arabic, English]`.
const Map<String, List<String>> lotLocationRefusals = {
  'LOT_RECEIVE_QTY': [
    'الكمية المستلمة يجب أن تكون أكبر من صفر. اكتب كمية صحيحة ثم احفظ. لم يُحفظ شيء.',
    'The received quantity must be greater than zero. Enter a valid quantity and save. Nothing was saved.',
  ],
  'LOT_COST_NEGATIVE': [
    'تكلفة الوحدة لا تكون سالبة. اكتب صفرًا أو أكثر ثم احفظ. لم يُحفظ شيء.',
    'The unit cost cannot be negative. Enter zero or more and save. Nothing was saved.',
  ],
  'LOT_EXPIRY_LOCKED': [
    'هذه الدفعة مسجلة بتاريخ صلاحية آخر ولا يمكن تغييره. استخدم التاريخ المسجل أو أنشئ دفعة جديدة. لم يُحفظ شيء.',
    'This lot is already recorded with a different expiry date that cannot be changed. Use the recorded date or create a new lot. Nothing was saved.',
  ],
  'LOT_ISSUE_QTY': [
    'الكمية المصروفة يجب أن تكون أكبر من صفر. اكتب كمية صحيحة ثم احفظ. لم يتغير شيء.',
    'The issued quantity must be greater than zero. Enter a valid quantity and save. Nothing changed.',
  ],
  'LOT_ISSUE_WAREHOUSE': [
    'الصرف يحتاج تحديد المخزن. اختر المخزن ثم أعد المحاولة. لم يتغير شيء.',
    'A warehouse is required to issue stock. Choose the warehouse and try again. Nothing changed.',
  ],
  'LOT_NO_BRANCH_WAREHOUSE': [
    'الصنف يُدار بالدفعات ولا يوجد مخزن للفرع لصرفها منه. أضف مخزنًا للفرع ثم أعد المحاولة. لم يتغير شيء.',
    'This item is lot-controlled but the branch has no warehouse to issue the lot from. Add a warehouse to the branch and try again. Nothing changed.',
  ],
  'LOT_MISSING_OR_EMPTY': [
    'الدفعة المختارة غير موجودة أو رصيدها صفر. اختر دفعة أخرى ثم أعد المحاولة. لم يتغير شيء.',
    'The chosen lot does not exist or is empty. Choose another lot and try again. Nothing changed.',
  ],
  'LOT_NONE_AVAILABLE': [
    'الصنف يُدار بالدفعات ولا توجد دفعة متاحة للصرف. استلم دفعة أولًا ثم أعد المحاولة. لم يتغير شيء.',
    'This item is lot-controlled and no lot is available to issue from. Receive a lot first and try again. Nothing changed.',
  ],
  'LOT_LOCATION_SHORT': [
    'الموقع المختار لا يحوي الكمية المطلوبة من هذا الصنف. اختر موقعًا آخر أو قلّل الكمية. لم يتغير شيء.',
    'The chosen location does not hold the requested quantity of this item. Choose another location or lower the quantity. Nothing changed.',
  ],
  'LOT_EXPIRED_ONLY': [
    'الكمية المطلوبة موجودة في دفعات منتهية الصلاحية فقط، وصرفها يحتاج اعتمادًا مسجّلًا بصلاحية خاصة. اطلب الاعتماد من المدير أو قلّل الكمية. لم يتغير شيء.',
    'The requested quantity is available only in expired lots, and issuing them needs a recorded approval with the special permission. Ask a manager to approve or lower the quantity. Nothing changed.',
  ],
  'LOT_CHANGED_ISSUING': [
    'تغيّر رصيد الدفعة أثناء الصرف. أعد المحاولة. لم يتغير شيء.',
    'The lot balance changed while issuing. Try again. Nothing changed.',
  ],
  'LOT_WAREHOUSE_SHORT': [
    'الرصيد في هذا المخزن أقل من المطلوب. قلّل الكمية أو استلم رصيدًا أولًا. لم يتغير شيء.',
    'The stock in this warehouse is less than requested. Lower the quantity or receive stock first. Nothing changed.',
  ],
  'LOT_WRITEOFF_QTY': [
    'كمية الإعدام يجب أن تكون أكبر من صفر. اكتب كمية صحيحة ثم احفظ. لم يتغير شيء.',
    'The written-off quantity must be above zero. Enter a valid quantity and save. Nothing changed.',
  ],
  'LOT_WRITEOFF_REASON': [
    'اكتب سبب الإعدام ثم احفظ. لم يتغير شيء.',
    'Write the reason for the write-off and save. Nothing changed.',
  ],
  'LOT_WRITEOFF_SHORT': [
    'الدفعة تحتوي أقل من كمية الإعدام. قلّل الكمية ثم أعد المحاولة. لم يتغير شيء.',
    'The lot holds less than the write-off quantity. Lower the quantity and try again. Nothing changed.',
  ],
  'LOT_ALREADY_WRITTEN_OFF': [
    'هذه الدفعة أُعدمت بالفعل. حدّث الشاشة وراجع حالتها. لم يتغير شيء.',
    'This lot has already been written off. Refresh the screen and check its status. Nothing changed.',
  ],
  'LOT_CHANGED_WRITING_OFF': [
    'تغيّرت الدفعة أثناء الإعدام. أعد المحاولة. لم يتغير شيء.',
    'The lot changed while it was being written off. Try again. Nothing changed.',
  ],
  'LOT_TRANSFER_QTY': [
    'كمية التحويل يجب أن تكون أكبر من صفر. اكتب كمية صحيحة ثم احفظ. لم يتغير شيء.',
    'The transfer quantity must be above zero. Enter a valid quantity and save. Nothing changed.',
  ],
  'LOT_TRANSFER_SAME_WAREHOUSE': [
    'لا يمكن التحويل إلى نفس المخزن. اختر مخزنًا مختلفًا ثم أعد المحاولة. لم يتغير شيء.',
    'A lot cannot be moved to the same warehouse. Choose a different warehouse and try again. Nothing changed.',
  ],
  'LOT_TRANSFER_OTHER_BRANCH': [
    'التحويل بين فرعين مختلفين لا يتم من هنا. استخدم شاشة تحويلات المخزون. لم يتغير شيء.',
    'A move between two branches cannot be done here. Use the stock transfers screen. Nothing changed.',
  ],
  'LOT_TRANSFER_SHORT': [
    'الدفعة تحتوي أقل من كمية التحويل. قلّل الكمية ثم أعد المحاولة. لم يتغير شيء.',
    'The lot holds less than the transfer quantity. Lower the quantity and try again. Nothing changed.',
  ],
  'LOT_CHANGED_TRANSFERRING': [
    'تغيّرت الدفعة أثناء التحويل. أعد المحاولة. لم يتغير شيء.',
    'The lot changed during the transfer. Try again. Nothing changed.',
  ],
  'LOT_WAREHOUSE_OTHER_BRANCH': [
    'هذا المخزن يتبع فرعًا غير مسند إليك. اختر مخزنًا من فرعك. لم يتغير شيء.',
    'This warehouse belongs to a branch you are not assigned to. Choose a warehouse of your branch. Nothing changed.',
  ],
  'LOCATION_NOT_IN_WAREHOUSE': [
    'موقع التخزين ليس في هذا المخزن. اختر موقعًا من المخزن نفسه ثم أعد المحاولة. لم يتغير شيء.',
    'The storage location is not in this warehouse. Choose a location of the same warehouse and try again. Nothing changed.',
  ],
  'LOCATION_PARENT_NOT_HERE': [
    'الموقع الأعلى ليس في هذا المخزن. اخترْه من نفس المخزن ثم احفظ. لم يُحفظ شيء.',
    'The parent location is not in this warehouse. Choose one from the same warehouse and save. Nothing was saved.',
  ],
  'LOCATION_KIND_NOT_INSIDE': [
    'هذا النوع من المواقع لا يوضع داخل النوع المختار. اختر موقعًا أعلى يناسبه ثم احفظ. لم يُحفظ شيء.',
    'This kind of location cannot be placed inside the chosen kind. Choose a parent that fits and save. Nothing was saved.',
  ],
  'LOCATION_KIND_NEEDS_PARENT': [
    'هذا النوع من المواقع يجب أن يكون داخل نوع محدد. اختر الموقع الأعلى المناسب ثم احفظ. لم يُحفظ شيء.',
    'This kind of location must sit inside a specific kind. Choose the right parent and save. Nothing was saved.',
  ],
  'LOCATION_MOVE_INTO_SELF': [
    'هذا النقل يجعل الموقع داخل نفسه. اختر موقعًا أعلى مختلفًا. لم يتغير شيء.',
    'That move would place a location inside itself. Choose a different parent. Nothing changed.',
  ],
  'LOCATION_HAS_CHILDREN': [
    'لا يُحذف موقع فيه مواقع فرعية. انقل المواقع الفرعية أولًا ثم احذفه. لم يتغير شيء.',
    'A location that holds sub-locations cannot be deleted. Move them first, then delete it. Nothing changed.',
  ],
  'LOCATION_HAS_STOCK': [
    'لا يُحذف موقع فيه رصيد. انقل الرصيد أولًا ثم احذفه. لم يتغير شيء.',
    'A location that still holds stock cannot be deleted. Move the stock first, then delete it. Nothing changed.',
  ],
  'LOCATION_SAME_SOURCE_DEST': [
    'موقع المصدر والوجهة هو نفسه. اختر موقعين مختلفين ثم أعد المحاولة. لم يتغير شيء.',
    'The source and destination locations are the same. Choose two different locations and try again. Nothing changed.',
  ],
  'LOCATION_DIFFERENT_WAREHOUSES': [
    'الموقعان في مخزنين مختلفين. استخدم تحويل الدفعات بين المخازن. لم يتغير شيء.',
    'The two locations are in different warehouses. Use a lot transfer between warehouses. Nothing changed.',
  ],
  'LOCATION_SHORT': [
    'الموقع يحوي أقل من الكمية المطلوبة. قلّل الكمية أو اختر موقعًا آخر. لم يتغير شيء.',
    'The location holds less than the requested quantity. Lower the quantity or choose another location. Nothing changed.',
  ],
  'LOCATION_UNLOCATED_SHORT': [
    'الكمية التي بلا موقع أقل من المطلوبة. قلّل الكمية ثم أعد المحاولة. لم يتغير شيء.',
    'The quantity without a location is less than requested. Lower the quantity and try again. Nothing changed.',
  ],
  'LOCATION_CORRECTION_REASON': [
    'اكتب سبب التصحيح (3 أحرف على الأقل) ثم احفظ. لم يتغير شيء.',
    'Write the reason for this correction (at least 3 characters) and save. Nothing changed.',
  ],
  'LOCATION_NO_DEFICIT': [
    'لا يوجد عجز في الكمية التي بلا موقع لهذا الصنف، فلا حاجة للتصحيح. راجع الأرصدة. لم يتغير شيء.',
    'There is no deficit in the quantity without a location for this item, so no correction is needed. Check the balances. Nothing changed.',
  ],
  'LOCATION_CORRECTION_MAX': [
    'كمية التصحيح أكبر من الحد المسموح (العجز أو رصيد الموقع). اكتب كمية أقل ثم أعد المحاولة. لم يتغير شيء.',
    'The correction quantity is above the allowed maximum (the deficit or the shelf balance). Enter a smaller quantity and try again. Nothing changed.',
  ],
};
