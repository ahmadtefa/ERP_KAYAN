import 'failure.dart';
import 'module_refusals.dart';
import 'not_found_entities.dart';

/// What kind of problem the user is being told about.
///
/// The kind — not the raw server sentence — decides the wording of the
/// dialog, so a technical message such as `property type should not exist`
/// can never reach the screen. The raw text is still kept on the [Failure]
/// for the logs.
enum AppErrorReason {
  /// The device could not reach the API at all.
  network,

  /// The session ended and the person has to sign in again.
  sessionExpired,

  /// The account is fine but is not allowed to do this.
  permission,

  /// The record is gone (or was never there).
  notFound,

  /// Somebody else changed the same record first.
  conflict,

  /// The submitted values are not acceptable (400/422/client validation).
  invalidInput,

  /// The server failed while working (5xx).
  server,

  /// Anything we could not classify.
  unknown,
}

/// How loudly the dialog should present itself.
///
/// A conflict is not a failure of the system — nobody typed a wrong value,
/// the world simply moved — so it is shown as a warning rather than an
/// error. Everything else is an error.
enum AppErrorSeverity { error, warning }

/// The result of translating one failure into something presentable.
class AppErrorText {
  const AppErrorText({
    required this.reason,
    required this.severity,
    this.businessMessage,
  });

  /// Which canned sentence the dialog should use.
  final AppErrorReason reason;

  final AppErrorSeverity severity;

  /// A real, business-level explanation worth showing as-is: either a
  /// server message that was translated, or one the screen wrote itself
  /// (validation like "اختر حسابًا").
  ///
  /// `null` means "no useful business reason" — the dialog then falls back
  /// to the localised sentence for [reason]. A technical message never ends
  /// up here.
  final String? businessMessage;

  bool get hasBusinessMessage =>
      businessMessage != null && businessMessage!.trim().isNotEmpty;
}

/// Turns any thrown object into an [AppErrorText].
///
/// This lives outside the widget tree on purpose: it is pure logic, it is
/// unit-tested on its own, and it can be used from repositories as well as
/// screens. It never inspects a stack trace and never forwards one.
class AppErrorMessageResolver {
  const AppErrorMessageResolver({required this.isArabic});

  /// Reviewed client-side sentences for stock document refusals. The server
  /// body is never shown for these codes: only the code selects the text, and
  /// the only server value used is a plain line number. Each sentence says
  /// what is wrong and how to fix it, and that the data is kept.
  static const _stockDocReasons = <String, List<String>>{
    'WRITE_OFF_SELF_APPROVAL': [
      'لا يمكنك اعتماد مستند إعدام أنشأته أنت. يجب أن يعتمده شخص آخر لديه صلاحية الاعتماد. المستند محفوظ كما هو.',
      'You cannot approve a write-off you created yourself. Another person with approval permission must approve it. The document is unchanged.',
    ],
    'WRITE_OFF_SELF_POST': [
      'لا يمكنك ترحيل مستند إعدام أنشأته أنت. يجب أن يرحّله شخص آخر لديه صلاحية الترحيل. المستند محفوظ كما هو.',
      'You cannot post a write-off you created yourself. Another person with posting permission must post it. The document is unchanged.',
    ],
    'WRITE_OFF_NOT_APPROVED': [
      'لا يمكن ترحيل مستند الإعدام قبل اعتماده. يجب أن يعتمده أولًا شخص آخر غير من أنشأه، ثم يُرحَّل. المستند محفوظ كما هو.',
      'A write-off cannot be posted before it is approved. A person other than its creator must approve it first, then it can be posted. The document is unchanged.',
    ],
    'STOCK_DOC_APPROVED': [
      'المستند تمت مراجعته أو اعتماده فلا تُعدَّل مواقعه. أعده للمسودة أو أنشئ مستندًا جديدًا. بياناتك محفوظة.',
      'This document was reviewed or approved, so its locations cannot be changed. Return it to draft or create a new document. Your data is kept.',
    ],
    'STOCK_DOC_LINE_UNKNOWN': [
      'السطر غير موجود في المستند أو مكرر. أعد فتح المستند وحاول مرة أخرى. لم تُحفظ التصحيحات والمسودة كما هي.',
      'The line is not in this document or is repeated. Reopen the document and try again. The correction was not saved and the draft is unchanged.',
    ],
    'STOCK_DOC_LOCATIONS_EMPTY': [
      'لم تُرسل أي أسطر لتصحيح مواقعها. اختر سطرًا واحدًا على الأقل وحاول مرة أخرى.',
      'No lines were sent to correct. Choose at least one line and try again.',
    ],
    'STOCK_DOC_LOCATION_INACTIVE': [
      'الموقع المختار غير مفعّل ولا يستقبل بضاعة. فعّل الموقع أو اختر موقعًا مفعّلًا. بياناتك محفوظة ولم يتغير أي رصيد.',
      'The chosen location is inactive and cannot receive goods. Activate it or choose an active location. Your data is kept and no balance changed.',
    ],
    'STOCK_DOC_LOCATION_INVALID': [
      'الموقع المختار ليس في مخزن المستند. اختر موقعًا من نفس المخزن. بياناتك محفوظة.',
      'The chosen location is not in the document warehouse. Pick a location of that warehouse. Your data is kept.',
    ],
    'STOCK_DOC_LOCATION_REQUIRED': [
      'الصنف مخزَّن على أكثر من موقع. اختر الموقع الذي يخرج منه الصنف في هذا السطر ثم رحّل مرة أخرى. بياناتك محفوظة ولم يتغير أي رصيد.',
      'The item is stored on several locations. Choose the location this line takes from, then post again. Your data is kept and no balance changed.',
    ],
    'STOCK_DOC_LOT_INVALID': [
      'الدفعة المختارة لا تصلح لهذا الصنف في المخزن المحوَّل منه (قد تكون مشطوبة أو محذوفة). اختر دفعة أخرى. لم تُحفظ التصحيحات والمسودة كما هي.',
      'The chosen lot cannot be used for this item in the source warehouse (it may be written off or deleted). Choose another lot. The correction was not saved and the draft is unchanged.',
    ],
    'STOCK_DOC_LOT_SHORT': [
      'الدفعة المختارة تحمل أقل من الكمية المطلوبة. خفّض الكمية أو وزّعها على دفعات أخرى. لم تُحفظ التصحيحات والمسودة كما هي.',
      'The chosen lot holds less than the quantity needed. Lower the quantity or split it over other lots. The correction was not saved and the draft is unchanged.',
    ],
    'STOCK_DOC_LOT_TRANSFER_ONLY': [
      'اختيار الدفعة وتقسيم الكمية متاحان لمستند التحويل فقط.',
      'Choosing a lot and splitting the quantity are available on a transfer document only.',
    ],
    'STOCK_DOC_NOT_DRAFT': [
      'لا يمكن تعديل مواقع مستند تم ترحيله. استخدم العكس ثم أنشئ مستندًا جديدًا.',
      'The locations of a posted document cannot be edited. Reverse it, then create a new document.',
    ],
    'STOCK_DOC_REVERSE_LOT_AMBIGUOUS': [
      'تعذر عكس المستند لأن الدفعة التي نُقلت غير محددة. لم يتغير أي رصيد. راجع المحاسب أو المدير.',
      'The document cannot be reversed because the lot that was moved cannot be identified. No balance changed. Ask the accountant or a manager.',
    ],
    'STOCK_DOC_REVERSE_LOT_COST_UNPROVABLE': [
      'تعذر عكس المستند لأن تكلفة الدفعة وقت الاستلام غير موثقة بشكل متسق (مستند قديم أو دفعة مختلفة). لم يتغير أي رصيد. راجع المحاسب أو المدير.',
      'The document cannot be reversed because the lot cost at receipt cannot be proven consistently (older document or a different lot). No balance changed. Ask the accountant or a manager.',
    ],
    'STOCK_DOC_REVERSE_LOT_SHELF_SHORT': [
      'تعذر عكس المستند لأن موقع الاستلام لم يعد يحمل الكمية. لم يتغير أي رصيد. أعد الكمية إلى موقعها أو راجع المحاسب.',
      'The document cannot be reversed because the receiving location no longer holds the quantity. No balance changed. Move the stock back or ask the accountant.',
    ],
    'STOCK_DOC_REVERSE_LOT_SHORT': [
      'تعذر عكس المستند لأن دفعة الاستلام تحمل أقل من الكمية. لم يتغير أي رصيد. أعد الكمية إلى الدفعة أو راجع المحاسب.',
      'The document cannot be reversed because the receiving lot holds less than the quantity. No balance changed. Move the stock back or ask the accountant.',
    ],
    'STOCK_DOC_REVERSE_SHELF_SHORT': [
      'تعذر عكس المستند لأن موقع الاستلام لم يعد يحمل الكمية. لم يتغير أي رصيد. أعد الكمية إلى موقعها أو راجع المحاسب.',
      'The document cannot be reversed because the receiving location no longer holds the quantity. No balance changed. Move the stock back or ask the accountant.',
    ],
    'STOCK_DOC_SHELF_SHORT': [
      'الموقع المختار يحتوي أقل من الكمية المطلوبة. اختر موقعًا آخر أو خفّض الكمية. بياناتك محفوظة ولم يتغير أي رصيد.',
      'The chosen location holds less than the quantity needed. Choose another location or lower the quantity. Your data is kept and no balance changed.',
    ],
    'STOCK_DOC_SPLIT_INVALID': [
      'التقسيم غير صحيح: أرسل من 2 إلى 20 جزءًا، لكل جزء دفعة وكمية أكبر من صفر. لم تُحفظ التصحيحات والمسودة كما هي.',
      'The split is not valid: send 2 to 20 parts, each with a lot and a quantity above zero. The correction was not saved and the draft is unchanged.',
    ],
    'STOCK_DOC_SPLIT_TOTAL': [
      'مجموع الأجزاء لا يساوي كمية السطر. عدّل الأجزاء ليصبح مجموعها مساويًا للكمية. لم تُحفظ التصحيحات والمسودة كما هي.',
      'The parts do not add up to the line quantity. Adjust them so the total equals the line quantity. The correction was not saved and the draft is unchanged.',
    ],
    'STOCK_DOC_TARGET_LOCATION_INVALID': [
      'موقع الاستلام يجب أن يكون في المخزن المحوَّل إليه وفي مستند تحويل فقط. اختر موقعًا صحيحًا. بياناتك محفوظة.',
      'The receiving location must be in the destination warehouse and only on a transfer document. Choose a valid location. Your data is kept.',
    ],
    'STOCK_DOC_TRANSFER_LOT_COVERAGE': [
      'الكمية تتوزع على أكثر من دفعة أو لا تغطيها دفعة واحدة. اختر دفعة واحدة تغطي الكمية أو قسّم السطر إلى أسطر بدفعة لكل سطر. لم يتغير أي رصيد والمسودة محفوظة.',
      'The quantity spans several lots or is not fully covered by one lot. Pick one lot that covers it, or split the line into one line per lot. No balance changed and the draft is kept.',
    ],
    'STOCK_DOC_VERSION_REQUIRED': [
      'أعد فتح المستند وحاول مرة أخرى. بياناتك محفوظة.',
      'Reopen the document and try again. Your data is kept.',
    ],
  };

  /// Reviewed sentences for location, lot and opening-stock refusals outside
  /// stock documents. Same rule: the code picks the text, the server body is
  /// never shown, only a plain line or row number is added.
  static const _locationRefusalReasons = <String, List<String>>{
    'ISSUE_ALLOCATION_DUPLICATE': [
      'هذا الموقع مذكور مرتين. ادمج الكميتين في صف واحد. بياناتك محفوظة.',
      'This location appears twice. Merge the two quantities into one row. Your data is kept.',
    ],
    'ISSUE_ALLOCATION_INVALID': [
      'اختر موقعًا وكمية أكبر من صفر في كل صف. بياناتك محفوظة.',
      'Choose a location and a quantity above zero in every row. Your data is kept.',
    ],
    'ISSUE_ALLOCATION_SUM': [
      'مجموع الكميات الموزعة لا يساوي كمية الصرف. عدّل الصفوف حتى تتطابق. بياناتك محفوظة.',
      'The split does not add up to the issued quantity. Adjust the rows so they match. Your data is kept.',
    ],
    'ISSUE_LOCATION_AMBIGUOUS': [
      'أرسل موقعًا واحدًا أو توزيعًا على مواقع، وليس الاثنين.',
      'Send either one location or a split over locations, not both.',
    ],
    'ISSUE_LOCATION_REQUIRED': [
      'الصنف مخزَّن على أكثر من موقع. اختر الموقع أو عدة مواقع بالكميات ثم اصرف مرة أخرى. بياناتك محفوظة.',
      'The item is stored on several locations. Choose the location, or several locations with quantities, then issue again. Your data is kept.',
    ],
    'ITEM_OPENING_LOCATION_INACTIVE': [
      'موقع التخزين للرصيد الافتتاحي غير مفعّل. فعّله أو اختر موقعًا مفعّلًا أو احذف الموقع. بياناتك محفوظة.',
      'The opening stock location is inactive. Activate it, choose an active location, or leave it empty. Your data is kept.',
    ],
    'ITEM_OPENING_LOCATION_NOT_FOUND': [
      'موقع التخزين للرصيد الافتتاحي غير موجود. اختر موقعًا آخر أو احذف الموقع. بياناتك محفوظة.',
      'The opening stock location does not exist. Choose another location or leave it empty. Your data is kept.',
    ],
    'ITEM_OPENING_LOCATION_WRONG_WAREHOUSE': [
      'موقع الرصيد الافتتاحي يتبع مخزنًا آخر غير مخزن الفرع. اختر موقعًا من مخزن الفرع. بياناتك محفوظة.',
      'The opening stock location belongs to a different warehouse than the branch warehouse. Choose a location of the branch warehouse. Your data is kept.',
    ],
    'ITEM_OPENING_TARGET_CHANGED': [
      'المخزن المختار للرصيد الافتتاحي لم يعد متاحًا. أعد فتح النموذج واختر من المخازن الحالية.',
      'The chosen opening stock warehouse is no longer available. Reopen the form and choose from the current warehouses.',
    ],
    'ITEM_OPENING_WAREHOUSE_INACTIVE': [
      'كل مخازن هذا الفرع غير مفعّلة فلا يمكن حفظ رصيد افتتاحي. فعّل مخزنًا للفرع أو احفظ الصنف بدون رصيد افتتاحي.',
      'All warehouses of this branch are inactive, so opening stock cannot be saved. Activate a branch warehouse or save the item without opening stock.',
    ],
    'OPENING_LOCATION_INACTIVE': [
      'موقع التخزين غير مفعّل أو محذوف. فعّله أو اختر موقعًا آخر. باقي بياناتك محفوظة.',
      'The storage location is inactive or deleted. Activate it or choose another one. The rest of your data is kept.',
    ],
    'OPENING_LOCATION_NOT_FOUND': [
      'موقع التخزين غير موجود. اختر موقعًا آخر أو احذف الموقع. باقي بياناتك محفوظة.',
      'The storage location does not exist. Choose another location or leave it empty. The rest of your data is kept.',
    ],
    'OPENING_LOCATION_WITHOUT_ITEM': [
      'موقع التخزين يخص سطر صنف فقط. احذف الموقع من هذا السطر. باقي بياناتك محفوظة.',
      'A storage location belongs only on a stock item line. Remove it from this line. The rest of your data is kept.',
    ],
    'OPENING_LOCATION_WRONG_WAREHOUSE': [
      'الموقع يتبع مخزنًا آخر غير مخزن الرصيد الافتتاحي. اختر موقعًا من نفس المخزن. باقي بياناتك محفوظة.',
      'The location belongs to a different warehouse than the opening balance warehouse. Choose a location of that warehouse. The rest of your data is kept.',
    ],
    'OPENING_LOT_CONTROLLED_ITEM': [
      'هذا الصنف يتطلب رقم دفعة أو تواريخ، والرصيد الافتتاحي لا يحمل بيانات دفعة فلا يمكن صرفه لاحقًا. احذف هذا السطر (باقي الأسطر محفوظة) واطلب من المحاسب أو المدير طريقة مناسبة لإدخال رصيده.',
      'This item requires a lot number or dates, and an opening balance carries no lot data, so the stock could not be issued later. Remove this line (the other lines are kept) and ask the accountant or an administrator for a traceable way to enter its stock.',
    ],
    'OPENING_REVERSE_ORIGIN_AMBIGUOUS': [
      'تعذر عكس الرصيد الافتتاحي لأن حركة المخزون الأصلية لا تطابق السطر بيقين. لم يتغير شيء. اطلب من المحاسب أو المدير مراجعة المخزن والموقع والتكلفة الأصلية.',
      'The opening balance cannot be reversed because the original stock movement does not match the line with certainty. Nothing was changed. Ask the accountant or an administrator to verify the original warehouse, location and cost.',
    ],
    'OPENING_REVERSE_ORIGIN_UNKNOWN': [
      'تعذر عكس الرصيد الافتتاحي لأنه لا توجد حركة مخزون أصلية مسجلة لهذا الصنف. لم يتغير شيء. اطلب من المحاسب أو المدير المراجعة.',
      'The opening balance cannot be reversed because no original stock movement is recorded for this item. Nothing was changed. Ask the accountant or an administrator to verify.',
    ],
    'OPENING_REVERSE_SHELF_SHORT': [
      'تعذر عكس الرصيد الافتتاحي لأن الموقع لا يحمل الكمية المطلوبة. أعد الكمية المنقولة إلى هذا الموقع ثم اعكس مرة أخرى. لم يتغير أي رصيد.',
      'The opening balance cannot be reversed because its location no longer holds the required quantity. Transfer the moved quantity back to that location, then reverse again. No balance changed.',
    ],
    'PURCHASE_LOCATION_INACTIVE': [
      'موقع التخزين غير مفعّل. فعّله أو اختر موقعًا آخر. بيانات الفاتورة محفوظة.',
      'The location is inactive. Activate it or choose another. The invoice data is kept.',
    ],
    'PURCHASE_LOCATION_NOT_FOUND': [
      'موقع التخزين غير موجود. اختر موقعًا آخر أو اتركه فارغًا. بيانات الفاتورة محفوظة.',
      'The storage location does not exist. Choose another location or leave it empty. The invoice data is kept.',
    ],
    'PURCHASE_LOCATION_WRONG_WAREHOUSE': [
      'الموقع يتبع مخزنًا غير مخزن الفاتورة. اختر موقعًا من مخزن الفاتورة أو غيّر مخزن الفاتورة. بيانات الفاتورة محفوظة.',
      'The location belongs to a different warehouse than the invoice. Choose a location of the invoice warehouse, or change the invoice warehouse. The invoice data is kept.',
    ],
    'PURCHASE_LOT_DETAILS_REQUIRED': [
      'بيانات الدفعة أو التواريخ المطلوبة لهذا الصنف ناقصة. أدخلها في السطر ثم رحّل من جديد. بيانات الفاتورة محفوظة.',
      'The lot or date details this item needs are missing. Enter them on the line, then post again. The invoice data is kept.',
    ],
    'PURCHASE_LOT_NEEDS_WAREHOUSE': [
      'الصنف يُستلم في دفعة لكن الفرع بلا مخزن. أضف مخزنًا للفرع أو للفاتورة ثم رحّل من جديد. بيانات الفاتورة محفوظة.',
      'The item is received into a lot but the branch has no warehouse. Add a warehouse to the branch or the invoice, then post again. The invoice data is kept.',
    ],
    'PURCHASE_RETURN_LOT_SHORT': [
      'الدفعة لم يبق منها الكمية المطلوبة للمرتجع لأن جزءًا منها بيع أو نُقل. خفّض كمية المرتجع إلى المتبقي. بيانات المرتجع محفوظة.',
      'The lot has less left to return than the quantity entered, because part of it was sold or moved. Reduce the returned quantity to what is left. The return data is kept.',
    ],
    'PURCHASE_RETURN_SHELF_SHORT': [
      'موقع الاستلام لا يحمل الكمية المطلوبة لأن البضاعة نُقلت منه. أعدها إلى هذا الموقع ثم رحّل مرة أخرى. بيانات المرتجع محفوظة.',
      'The receiving location no longer holds the quantity because the goods were moved off it. Move them back to that location, then post again. The return data is kept.',
    ],
    'PURCHASE_REVERSE_LOT_USED': [
      'تعذر عكس السطر لأن جزءًا من الدفعة بيع أو نُقل. تراجع عن تلك العمليات أولًا أو استخدم مرتجع مشتريات للكمية المتبقية.',
      'The line cannot be reversed because part of its lot was sold or moved. Undo those sales first, or use a purchase return for the remaining quantity.',
    ],
    'PURCHASE_REVERSE_SHELF_SHORT': [
      'تعذر عكس السطر لأن موقعه لا يحمل الكمية بعد نقل البضاعة منه. أعدها إلى هذا الموقع ثم اعكس مرة أخرى.',
      'The line cannot be reversed because its location no longer holds the quantity, as the goods were moved off it. Move them back to that location, then reverse again.',
    ],
    'RETURN_REVERSE_COST_MISMATCH': [
      'تعذر عكس المرتجع لأن تكلفة حركة المخزون المسجلة لا تطابق تكلفة السطر في القيد المحاسبي، وعكسه سيُخلّ بتوازن المخزون والحسابات. لم يتغير شيء. راجع المحاسب أو المدير.',
      'The return cannot be reversed because the recorded stock movement cost does not match the line cost in the accounting entry, so reversing it would put stock and accounts out of step. Nothing changed. Ask the accountant or an administrator.',
    ],
    'RETURN_REVERSE_LOT_SHORT': [
      'تعذر عكس المرتجع لأن جزءًا من الدفعة بيع أو نُقل بعد المرتجع. تراجع عن ذلك أولًا ثم اعكس المرتجع مرة أخرى.',
      'The return cannot be reversed because part of the lot was sold or moved after the return. Undo those first, then reverse the return again.',
    ],
    'RETURN_REVERSE_SHELF_SHORT': [
      'تعذر عكس المرتجع لأن الموقع الذي عادت إليه البضاعة لا يحمل الكمية بعد نقلها. أعدها إلى هذا الموقع ثم اعكس المرتجع مرة أخرى.',
      'The return cannot be reversed because the location the goods went back to no longer holds the quantity. Move them back to that location, then reverse the return again.',
    ],
    'SALES_POST_LOCATION_REQUIRED': [
      'الصنف مخزَّن على أكثر من موقع. افتح السطر وحدد الموقع والكمية ثم رحّل من جديد. بيانات الفاتورة محفوظة.',
      'The item is stored on several locations. Open the line, choose the location(s) and quantity to take from, then post again. The invoice data is kept.',
    ],
    'TRANSFER_LOCATION_REQUIRED': [
      'الدفعة مخزَّنة على أكثر من موقع. اختر الموقع الذي تخرج منه البضاعة ثم حوّل مرة أخرى. ما أدخلته محفوظ.',
      'The lot is stored on several locations. Choose the location the goods leave from, then transfer again. What you entered is kept.',
    ],
    'TRANSFER_LOCATION_SHORT': [
      'الموقع المختار لا يحمل الكمية المطلوبة من هذه الدفعة. اختر موقعًا آخر أو خفّض الكمية. ما أدخلته محفوظ.',
      'The chosen location does not hold the quantity needed of this lot. Pick another location or lower the quantity. What you entered is kept.',
    ],
    'TRANSFER_TARGET_LOCATION_INVALID': [
      'موقع الوجهة ليس موقعًا مفعّلًا في المخزن المستلم. اختر موقعًا مفعّلًا هناك أو اتركه فارغًا. ما أدخلته محفوظ.',
      'The destination location is not an active location of the receiving warehouse. Choose an active location there, or leave it empty. What you entered is kept.',
    ],
    'WRITEOFF_LOCATION_REQUIRED': [
      'الدفعة مخزَّنة على أكثر من موقع. اختر الموقع الذي يُشطب منه ثم حاول مرة أخرى. ما أدخلته محفوظ.',
      'The lot is stored on several locations. Choose the location to write off from, then try again. What you entered is kept.',
    ],
    'WRITEOFF_LOCATION_SHORT': [
      'الموقع المختار لا يحمل الكمية المطلوبة من هذه الدفعة. خفّض الكمية أو اختر موقعًا آخر.',
      'The chosen location does not hold the quantity needed of this lot. Reduce the quantity or choose another location.',
    ],
  };

  /// Backup and restore refusals that are not 400s. Each code is valid for one
  /// status only; the sentence is reviewed, the server detail is never shown
  /// (it can name files, folders and original errors).
  static const _backupRefusals = <String, ({int status, List<String> text})>{
    'BACKUP_DELETE_LAST': (status: 409, text: [
      'هذه آخر نسخة احتياطية على الخادم، وحذفها لا يترك طريقًا للرجوع. أنشئ نسخة احتياطية أخرى أولًا ثم احذف هذه.',
      'This is the last backup on the server, and deleting it would leave no way back. Create another backup first, then delete this one.',
    ]),
    'BACKUP_DELETE_IN_USE': (status: 409, text: [
      'لا يمكن حذف هذه النسخة الآن: إما أن استعادة تعمل حاليًا أو أنها نسخة الحماية التي تحتاجها استعادة متوقفة. انتظر انتهاء الاستعادة أو أنهِ الاسترداد أولًا ثم حاول مرة أخرى.',
      'This backup cannot be deleted now: a restore is running, or it is the protective copy an interrupted restore still needs. Wait for the restore to finish, or resolve the recovery first, then try again.',
    ]),
    'FULL_BACKUP_INCOMPLETE': (status: 503, text: [
      'تعذر إكمال النسخة الاحتياطية الكاملة ولم تُنشأ نسخة صالحة. بياناتك لم تتأثر. تأكد من وجود مساحة فارغة وأن أدوات النسخ الاحتياطي موجودة ثم حاول مرة أخرى، وإن تكرر الخطأ فتواصل مع الدعم.',
      'The complete backup could not be finished and no usable backup was created. Your data is not affected. Check that there is free disk space and the backup tools are installed, then try again; if it repeats, contact support.',
    ]),
    'FULL_BACKUP_FAILURE_NOT_RECORDED': (status: 503, text: [
      'النسخة الاحتياطية الكاملة غير متاحة ولم تُنشأ أي نسخة، كما تعذر تسجيل المحاولة. بياناتك لم تتأثر. حاول لاحقًا وإن تكرر الخطأ فتواصل مع الدعم.',
      'The complete backup is unavailable, no backup was created, and the attempt could not be recorded. Your data is not affected. Try again later; if it repeats, contact support.',
    ]),
    'FULL_RESTORE_UNAVAILABLE': (status: 503, text: [
      'الاستعادة الكاملة متوقفة على هذا الجهاز لحماية البيانات حتى تكتمل ضمانات الأمان. لم يتغير شيء. استخدم استعادة الشركة أو تواصل مع الدعم.',
      'Full restore is turned off on this machine to protect your data until every safeguard is in place. Nothing was changed. Use a company restore instead, or contact support.',
    ]),
    'RESTORE_FAILED_RECOVERY_FAILED': (status: 503, text: [
      'فشلت الاستعادة وفشل الاسترداد التلقائي أيضًا. لا تدخل بيانات. استعد يدويًا من نسخة الحماية الموجودة في مجلد النسخ الاحتياطية أو تواصل مع الدعم فورًا.',
      'The restore failed and the automatic recovery failed too. Do not enter data. Restore manually from the safety backup in the backup folder, or contact support right away.',
    ]),
  };

  String _stockDocContext(Map<String, String> fields) {
    final line = fields['lineNumber'];
    if (line != null && RegExp(r'^[0-9]{1,4}$').hasMatch(line)) {
      return '\n${isArabic ? 'السطر' : 'Line'}: $line';
    }
    final row = fields['row'];
    if (row != null && RegExp(r'^[0-9]{1,4}$').hasMatch(row)) {
      return '\n${isArabic ? 'الصف' : 'Row'}: $row';
    }
    return '';
  }

  static const _salesPostingReasons = <String, List<String>>{
    'SALES_POST_BRANCH_STOCK': ['لم تُرحّل الفاتورة: مخزون الفرع غير كافٍ. راجع كميات الأصناف وسجّل الاستلام الفعلي قبل الترحيل.', 'Invoice not posted: branch stock is insufficient. Review item quantities and record the actual receipt before posting.'],
    'SALES_POST_LOT_STOCK': ['لم تُرحّل الفاتورة: الدفعات المتاحة غير كافية. راجع كميات الدفعات والصلاحية في مخزن الفاتورة.', 'Invoice not posted: available lots are insufficient. Review lot quantities and expiry dates in the invoice warehouse.'],
    'SALES_POST_WAREHOUSE_STOCK': ['لم تُرحّل الفاتورة: مخزون المخزن المختار غير كافٍ. راجع المخزن والكميات.', 'Invoice not posted: stock in the selected warehouse is insufficient. Review the warehouse and quantities.'],
    'SALES_POST_ACCOUNT_MISSING': ['لم تُرحّل الفاتورة: حساب محاسبي مطلوب غير موجود. اطلب من مسؤول الحسابات مراجعة دليل الحسابات.', 'Invoice not posted: a required account is missing. Ask accounting to review the chart of accounts.'],
    'SALES_POST_ACCOUNT_UNAVAILABLE': ['لم تُرحّل الفاتورة: حساب محاسبي غير متاح للترحيل. اطلب من مسؤول الحسابات مراجعة الحسابات النشطة والقابلة للترحيل.', 'Invoice not posted: an account is unavailable for posting. Ask accounting to review active posting accounts.'],
    'SALES_POST_PERIOD_CLOSED': ['لم تُرحّل الفاتورة: تاريخها يقع في فترة محاسبية مغلقة. راجع التاريخ مع مسؤول الحسابات دون تغيير الفترات لتجاوز الرقابة.', 'Invoice not posted: its date falls in a closed fiscal period. Review the date with accounting without bypassing period controls.'],
    'SALES_POST_WAREHOUSE_REQUIRED': ['لم تُرحّل الفاتورة: صنف يحتاج دفعات ولا يوجد مخزن مناسب للفرع. راجع إعداد مخزن الفرع.', 'Invoice not posted: a lot-controlled item needs a branch warehouse. Review the branch warehouse setup.'],
    'SALES_POST_ITEM_UNAVAILABLE': ['لم تُرحّل الفاتورة: أحد الأصناف لم يعد متاحًا. افتح المسودة وراجع أصنافها.', 'Invoice not posted: an item is no longer available. Open the draft and review its items.'],
    'SALES_POST_UNBALANCED': ['لم تُرحّل الفاتورة: القيد غير متوازن. اطلب من مسؤول الحسابات مراجعة الإجماليات وإعداد الحسابات.', 'Invoice not posted: the journal does not balance. Ask accounting to review totals and account setup.'],
    'SALES_POST_STATE_CHANGED': ['تغيرت حالة الفاتورة. حدّث القائمة وتحقق من حالتها قبل أي محاولة أخرى.', 'Invoice status changed. Refresh the list and check its status before trying again.'],
    'SALES_POST_RULE_REJECTED': ['لم تُرحّل الفاتورة بسبب قاعدة عمل. احتفظ بالمسودة وأرسل رمز المساعدة للدعم؛ لا تكرر موافقة الائتمان دون معرفة السبب.', 'Invoice not posted because of a business rule. Keep the draft and report the support code; do not repeat credit approval without knowing the reason.'],
  };

  /// Refusals whose server sentence is bounded, written per language and joined
  /// by " / ": over-stock saves and cash or bank balances that would go negative.
  static const _bilingualRefusalCodes = <String>{
    'SALES_SAVE_STOCK_SHORT',
    'CASH_BALANCE_NEGATIVE',
    'CASH_SAVE_BALANCE_SHORT',
  };

  String _postingContext(Map<String, String> fields) {
    final parts = <String>[];
    void numeric(String key, String ar, String en) {
      final value=fields[key];
      if(value!=null && RegExp(r'^-?[0-9]{1,16}(?:\.[0-9]{1,4})?$').hasMatch(value)) { parts.add('${isArabic ? ar : en}: $value'); }
    }
    numeric('lineNumber','سطر الفاتورة','Invoice line');
    final item=fields['itemCode'];
    if(item!=null && RegExp(r'^[A-Za-z0-9_-]{1,64}$').hasMatch(item)) { parts.add('${isArabic ? 'كود الصنف' : 'Item code'}: $item'); }
    numeric('available','المتاح بالفرع','Available in branch');numeric('requested','المطلوب','Requested');
    numeric('accountCode','رقم الحساب','Account code');
    const accountNames=<String,List<String>>{'accountsReceivable':['العملاء','Accounts receivable'],'salesRevenue':['إيراد المبيعات','Sales revenue'],'vatPayable':['ضريبة القيمة المضافة المستحقة','VAT payable'],'inventory':['المخزون','Inventory'],'costOfGoodsSold':['تكلفة المبيعات','Cost of goods sold']};
    final account=accountNames[fields['accountKey']];if(account!=null) { parts.add(account[isArabic ? 0 : 1]); }
    return parts.isEmpty ? '' : '\n${parts.join('\n')}';
  }

  /// When false, business messages are shown in the language the server
  /// sent them in (English) instead of being translated.
  final bool isArabic;

  AppErrorText resolve(Object? error, {int? statusCode}) {
    if (error == null) {
      return _fallback(statusCode: statusCode);
    }

    // A Failure already knows what kind of problem it is — an offline device
    // has no HTTP status at all, and must still be explained as "the server
    // could not be reached" rather than "an unexpected error".
    if (error is Failure) {
      if (error is ApiFailure && error.statusCode == 503 && error.code == 'TRANSACTION_ROLLED_BACK') {
        return AppErrorText(reason: AppErrorReason.server, severity: AppErrorSeverity.warning,
          businessMessage: isArabic
            ? 'استغرقت العملية وقتًا أطول من المسموح وأُلغيت تغييراتها. حدّث المستند وتحقق من حالته قبل المحاولة مرة أخرى.'
            : 'The operation took too long and its changes were rolled back. Reload the document and check its state before trying again.');
      }

      if (error is ApiFailure && (error.statusCode == 400 || error.statusCode == 409 || error.statusCode == 404)) {
        final refusal = moduleRefusals[error.code];
        if (refusal != null) {
          final conflict = error.statusCode == 409;
          return AppErrorText(
            reason: error.statusCode == 404 ? AppErrorReason.notFound : conflict ? AppErrorReason.conflict : AppErrorReason.invalidInput,
            severity: conflict ? AppErrorSeverity.warning : AppErrorSeverity.error,
            businessMessage: refusal[isArabic ? 0 : 1],
          );
        }
        final fieldKind = error.statusCode == 400 && error.errorField != null ? fieldRefusal(error.code) : null;
        if (fieldKind != null) {
          final fieldName = error.errorField!;
          final arLabel = moduleFieldLabelsAr[fieldName] ?? _fieldLabelsAr[fieldName];
          return AppErrorText(
            reason: AppErrorReason.invalidInput,
            severity: AppErrorSeverity.error,
            businessMessage: isArabic ? fieldKind.arabic(arLabel) : fieldKind.english(fieldName),
          );
        }
        final field = error.errorField;
        if (error.statusCode == 400 && error.code == 'VALIDATION' && field != null) {
          final label = isArabic ? (moduleFieldLabelsAr[field] ?? _fieldLabelsAr[field]) : field;
          return AppErrorText(
            reason: AppErrorReason.invalidInput,
            severity: AppErrorSeverity.error,
            businessMessage: isArabic
                ? (label == null ? 'إحدى القيم المدخلة غير صالحة. راجع الحقول ثم أعد المحاولة. لم يُحفظ شيء.' : 'القيمة في «$label» غير صالحة أو ناقصة. صحّحها ثم أعد المحاولة. لم يُحفظ شيء.')
                : 'The value in "$label" is missing or not valid. Correct it and try again. Nothing was saved.',
          );
        }
      }

      if (error is ApiFailure && error.statusCode == 404) {
        final sentence = notFoundSentence(error.code, isArabic: isArabic);
        if (sentence != null) {
          return AppErrorText(reason: AppErrorReason.notFound, severity: AppErrorSeverity.error, businessMessage: sentence);
        }
      }

      if (error is ApiFailure && error.statusCode == 409 && error.code == 'CHEQUE_DUPLICATE') {
        return AppErrorText(reason: AppErrorReason.conflict, severity: AppErrorSeverity.warning,
          businessMessage: isArabic
            ? 'رقم الشيك هذا مسجّل من قبل لنفس البنك. راجع الرقم أو ألغِ الشيك القديم أولاً.'
            : 'That cheque number is already registered for this bank. Check the number, or cancel the old cheque first.');
      }
      if (error is ApiFailure && error.statusCode == 409 && error.code == 'CHEQUE_STATE') {
        return AppErrorText(reason: AppErrorReason.conflict, severity: AppErrorSeverity.warning,
          businessMessage: isArabic
            ? 'حالة الشيك لا تسمح بهذه الخطوة، أو غيّرها شخص آخر. حدّث الشاشة وراجع حالته.'
            : 'The cheque is not in a state that allows this step, or someone else changed it. Reload and check its status.');
      }
      if (error is ApiFailure && error.statusCode == 503 && error.code == 'SERVER_BUSY') {
        return AppErrorText(reason: AppErrorReason.server, severity: AppErrorSeverity.warning,
          businessMessage: isArabic
            ? 'الخادم مشغول الآن فأُلغيت العملية ولم يُحفظ شيء. انتظر لحظة ثم أعد المحاولة.'
            : 'The server is busy, so the operation was cancelled and nothing was saved. Wait a moment and try again.');
      }

      if (error is ApiFailure && error.statusCode == 400 &&
          error.code == 'STOCK_DOC_TRANSFER_LOT_REQUIRED') {
        return AppErrorText(
          reason: AppErrorReason.invalidInput,
          severity: AppErrorSeverity.warning,
          businessMessage: isArabic
              ? 'لم يُرحّل التحويل لأن دفعة المصدر غير محددة. افتح تصحيح مواقع المسودة واختر دفعة متاحة بعد اختيار موقع المصدر، أو قسّم الكمية على الدفعات ثم احفظ ورحّل. لم تتغير الأرصدة والمسودة محفوظة.'
              : 'Transfer not posted because the source lot is not selected. Open Correct draft locations and choose an available lot after selecting the source location, or split the quantity over lots, then save and post. Balances did not change and the draft is kept.',
        );
      }
      // Saving or converting a sales document above the stock on hand. The
      // server writes one bounded sentence per language, joined by " / ", and
      // names the item, the line and the amounts. It is not a diagnostic, so a
      // user who typed the lines needs to read it as written; the generic
      // fallback would hide which line to change.
      if (error is ApiFailure &&
          error.statusCode == 400 &&
          _bilingualRefusalCodes.contains(error.code)) {
        final halves = error.message.split(' / ');
        final chosen = halves.length >= 2
            ? (isArabic ? halves.first : halves.sublist(1).join(' / '))
            : error.message;
        final sentence = chosen.trim();
        if (sentence.isNotEmpty &&
            sentence.length <= 600 &&
            !_looksTechnical(sentence) &&
            !_carriesPersonalData(sentence)) {
          return AppErrorText(
            reason: AppErrorReason.invalidInput,
            severity: AppErrorSeverity.warning,
            businessMessage:
                '$sentence\n${isArabic ? 'رمز المساعدة' : 'Support code'}: ${error.code}',
          );
        }
      }
      if (error is ApiFailure) {
        final backup = _backupRefusals[error.code];
        if (backup != null && backup.status == error.statusCode) {
          return AppErrorText(
            reason: AppErrorReason.conflict,
            severity: AppErrorSeverity.warning,
            businessMessage:
                '${backup.text[isArabic ? 0 : 1]}\n${isArabic ? 'رمز المساعدة' : 'Support code'}: ${error.code}',
          );
        }
      }
      if (error is ApiFailure && error.statusCode == 400) {
        final stockDoc = _stockDocReasons[error.code] ??
            _locationRefusalReasons[error.code];
        if (stockDoc != null) {
          return AppErrorText(
            reason: AppErrorReason.invalidInput,
            severity: AppErrorSeverity.warning,
            businessMessage:
                '${stockDoc[isArabic ? 0 : 1]}${_stockDocContext(error.fieldErrors)}\n${isArabic ? 'رمز المساعدة' : 'Support code'}: ${error.code}',
          );
        }
        final postingReason = _salesPostingReasons[error.code];
        if (postingReason != null) {
          return AppErrorText(
            reason: AppErrorReason.invalidInput,
            severity: AppErrorSeverity.warning,
            businessMessage: '${postingReason[isArabic ? 0 : 1]}${_postingContext(error.fieldErrors)}\n${isArabic ? 'رمز المساعدة' : 'Support code'}: ${error.code}',
          );
        }
      }
      if (error is ApiFailure &&
          error.statusCode == 403 &&
          error.code == 'LICENSE_STATE_ID_MISMATCH') {
        return AppErrorText(
          reason: AppErrorReason.conflict,
          severity: AppErrorSeverity.warning,
          businessMessage: isArabic
              ? 'حالة الترخيص المحمية لا تطابق سجل قاعدة البيانات. احتفظ بالبيانات وتواصل مع الدعم للتحقق من النقل أو الاستعادة.'
              : 'The protected licence state does not match the database. Preserve the data and contact support for an authorised recovery or transfer.',
        );
      }
      if (error is ApiFailure &&
          error.code == 'VALIDATION_FAILED' &&
          error.fieldErrors.isNotEmpty) {
        return AppErrorText(
          reason: AppErrorReason.invalidInput,
          severity: AppErrorSeverity.warning,
          businessMessage: describeFieldErrors(
            error.fieldErrors,
            isArabic: isArabic,
          ),
        );
      }
      final preferred = _reasonOf(error);
      final code = _statusOf(error) ?? statusCode;
      final text = _resolveText(
        error.message,
        statusCode: code,
        preferred: preferred,
        untrusted: error is! ValidationFailure,
      );
      final reason = text.reason;
      return AppErrorText(
        reason: reason,
        severity: _severityOf(reason),
        businessMessage: text.businessMessage,
      );
    }

    if (error is String) {
      return _resolveText(
        error,
        statusCode: statusCode,
        untrusted: statusCode != null,
      );
    }

    // Anything else (FormatException, TypeError, ...) is by definition not
    // written for a person.
    return _fallback(statusCode: statusCode);
  }

  /// The kind of problem a typed failure represents, when the status code
  /// alone cannot say it (a dropped connection never reaches a status).
  AppErrorReason? _reasonOf(Failure failure) {
    if (failure is NetworkFailure) return AppErrorReason.network;
    if (failure is SessionExpiredFailure) return AppErrorReason.sessionExpired;
    if (failure is PermissionFailure) return AppErrorReason.permission;
    if (failure is ValidationFailure) return AppErrorReason.invalidInput;
    if (failure is ServerFailure) return AppErrorReason.server;
    // A refused sign-in is a wrong username or password, not an expired
    // session: saying "sign in again" would be nonsense on the sign-in form.
    if (failure is AuthFailure) return AppErrorReason.invalidInput;
    return null;
  }

  int? _statusOf(Failure failure) {
    if (failure is ApiFailure) return failure.statusCode;
    if (failure is PermissionFailure) return 403;
    if (failure is SessionExpiredFailure || failure is AuthFailure) return 401;
    if (failure is ValidationFailure) return 422;
    if (failure is NetworkFailure) return null;
    if (failure is ServerFailure) return 500;
    return null;
  }

  AppErrorText _fallback({int? statusCode, AppErrorReason? preferred}) {
    final reason = _reasonFor(statusCode, preferred);
    return AppErrorText(reason: reason, severity: _severityOf(reason));
  }

  /// A typed reason wins over the status: only an [ApiFailure] knows its
  /// status, and a dropped connection has none.
  static AppErrorReason _reasonFor(int? status, AppErrorReason? preferred) =>
      preferred ?? _reasonForStatus(status);

  AppErrorText _resolveText(
    String raw, {
    int? statusCode,
    AppErrorReason? preferred,
    bool untrusted = false,
  }) {
    // Do not feed unbounded remote diagnostic blobs into UI or regex rules.
    if (raw.length > 1024) {
      return _fallback(statusCode: statusCode, preferred: preferred);
    }
    var text = _clean(raw);

    // "ServerFailure: no such record" -> "no such record".
    final wrapped = RegExp(r'^[A-Za-z]*Failure:\s*(.*)$').firstMatch(text);
    if (wrapped != null) text = _clean(wrapped.group(1) ?? '');

    if (text.isEmpty) {
      return _fallback(statusCode: statusCode, preferred: preferred);
    }

    // Never relay the body of a server failure, even when it is written in
    // Arabic: arbitrary diagnostics or customer data can appear in a 5xx.
    if (statusCode != null && statusCode >= 500) {
      return _fallback(statusCode: statusCode, preferred: preferred);
    }

    // The stock allocator emits a bilingual, bounded business refusal. Its
    // shortfall is actionable during sales posting and must not disappear
    // behind the generic invalid-input sentence.
    final lotShortfall = RegExp(
      r'Not enough stock in the available lots: ([0-9]+(?:\.[0-9]{1,4})?) short\.',
    ).firstMatch(text);
    if (statusCode == 400 && lotShortfall != null && !_looksTechnical(text)) {
      final amount = lotShortfall.group(1)!;
      return _business(
        isArabic
            ? 'لا يمكن ترحيل المستند: ينقص المخزون المتاح $amount.'
            : 'Cannot post the document: available stock is short by $amount.',
        statusCode: statusCode,
        preferred: preferred,
      );
    }

    // Arabic in a server or exception message is not proof that the rest of
    // the message is safe: it can also contain a stack trace, SQL, a URL or a
    // credential assignment. Filter those before preserving a business reason.
    if (_containsArabic(text)) {
      // Local validation may be Arabic already, but a server response must
      // not become trusted just because it contains Arabic characters.
      if (untrusted || _looksTechnical(text)) {
        return _fallback(statusCode: statusCode, preferred: preferred);
      }
      final reason = _reasonFor(statusCode, preferred);
      return AppErrorText(
        reason: reason,
        severity: _severityOf(reason),
        businessMessage: text,
      );
    }

    final stripped = _stripLinePrefix(text);
    final body = stripped.body;

    // In the Arabic interface a known English rule is reworded; in the
    // English one the sentence the server wrote is already the right
    // language, and a translation would only get in the way.
    if (isArabic) {
      // 1. Exact business messages first: a human sentence always beats a
      //    keyword heuristic.
      final exact = _exactArLower[body.toLowerCase()];
      if (exact != null) {
        return _business(
          stripped.prefix == null ? exact : '${stripped.prefix}$exact',
          statusCode: statusCode,
          preferred: preferred,
        );
      }

      // 2. Parameterised business messages ("Account 1104 is inactive").
      for (final rule in _patterns) {
        final match = rule.pattern.firstMatch(body);
        if (match == null) continue;
        final translated = rule.translate(match);
        if (translated == null || translated.isEmpty) continue;
        return _business(
          stripped.prefix == null
              ? translated
              : '${stripped.prefix}$translated',
          statusCode: statusCode,
          preferred: preferred,
        );
      }
    }

    // 3. Technical text: never forwarded, in either language.
    if (_looksTechnical(body)) {
      return _fallback(statusCode: statusCode, preferred: preferred);
    }

    // 4. An unmapped but human-looking sentence. In English it is shown as
    //    written; in Arabic it is not, because an English sentence is no
    //    more readable than a generic Arabic one and it may still be a
    //    technical detail we did not recognise.
    //
    //    A rule this file knows by name is not "unrecognised": the English
    //    interface should read the server's own sentence, the same one an
    //    Arabic reader sees reworded above. Matching only the exact-phrase
    //    list left every parameterised rule ("Nothing to depreciate for
    //    2024-01 — FA-M-1: already depreciated for 2024-01") falling through
    //    to "The submitted data is not valid", which explains nothing.
    final knownRule =
        _exactArLower.containsKey(body.toLowerCase()) ||
        _patterns.any((rule) => rule.pattern.hasMatch(body));
    if (!isArabic && _looksLikeSentence(body) && (knownRule || !untrusted)) {
      final reason = _reasonFor(statusCode, preferred);
      return AppErrorText(
        reason: reason,
        severity: _severityOf(reason),
        businessMessage: body,
      );
    }

    return _fallback(statusCode: statusCode, preferred: preferred);
  }

  AppErrorText _business(
    String message, {
    int? statusCode,
    AppErrorReason? preferred,
  }) {
    final reason = _reasonFor(statusCode, preferred);
    return AppErrorText(
      reason: reason,
      severity: _severityOf(reason),
      businessMessage: message,
    );
  }

  static AppErrorSeverity _severityOf(AppErrorReason reason) =>
      reason == AppErrorReason.conflict
      ? AppErrorSeverity.warning
      : AppErrorSeverity.error;

  static AppErrorReason _reasonForStatus(int? status) {
    if (status != null && status >= 500) return AppErrorReason.server;
    switch (status) {
      case 400:
      case 422:
        return AppErrorReason.invalidInput;
      case 401:
        return AppErrorReason.sessionExpired;
      case 403:
        return AppErrorReason.permission;
      case 404:
        return AppErrorReason.notFound;
      case 409:
        return AppErrorReason.conflict;
      default:
        return AppErrorReason.unknown;
    }
  }

  static String _clean(String raw) =>
      raw.replaceAll(RegExp(r'\s+'), ' ').trim();

  static bool _containsArabic(String text) =>
      RegExp(r'[\u0600-\u06FF]').hasMatch(text);

  /// "Line 3: ..." -> ("السطر 3: ", "..."). Keeping the line number but
  /// translating the rest.
  static _LinePrefix _stripLinePrefix(String text) {
    final match = RegExp(r'^Line (\d+):\s*(.*)$').firstMatch(text);
    if (match == null) return _LinePrefix(null, text);
    return _LinePrefix('السطر ${match.group(1)}: ', match.group(2) ?? '');
  }

  /// Signatures that only a programmer can act on. None of these strings
  /// may ever reach the screen.
  static final _technicalSignatures = <RegExp>[
    RegExp(r'should not exist', caseSensitive: false),
    RegExp(r'should not be (null|empty|undefined)', caseSensitive: false),
    RegExp(
      r'must be a (string|number|boolean|uuid|date|valid)',
      caseSensitive: false,
    ),
    RegExp(r'must not be', caseSensitive: false),
    RegExp(r'must contain', caseSensitive: false),
    RegExp(r'is not a valid', caseSensitive: false),
    RegExp(r'invalid base64', caseSensitive: false),
    RegExp(r'\b(prisma|sql|postgres|query engine)\b', caseSensitive: false),
    RegExp(r'\bstack\b|traceback|at Object\.|at Function\.'),
    RegExp(
      r'\b(TypeError|ReferenceError|SyntaxError|UnhandledPromiseRejection)\b',
    ),
    RegExp(r'\b(undefined|null|NaN|ECONNREFUSED|ETIMEDOUT|ENOTFOUND)\b'),
    RegExp(r'cannot read propert', caseSensitive: false),
    RegExp(r'\bdto\b|\bpayload\b|class-validator', caseSensitive: false),
    RegExp(
      r'\b(json|base64|hex digest|sha-256|encoding)\b',
      caseSensitive: false,
    ),
    RegExp(r'column "|table "|row \d', caseSensitive: false),
    RegExp(r'no such (column|table)', caseSensitive: false),
    RegExp(r'\b(?:postgres(?:ql)?|https?)://', caseSensitive: false),
    RegExp(
      r'\b(?:password|passwd|token|secret|authorization|api[_-]?key)\s*[:=]',
      caseSensitive: false,
    ),
    RegExp(r'\bbearer\s+\S+', caseSensitive: false),
    RegExp(r'-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----', caseSensitive: false),
  ];

  /// Listed refusal sentences name items, lots and quantities. They never
  /// need an e-mail address or a long number (phone, national or card id), so
  /// a body carrying one is treated as unsafe and the generic sentence is
  /// shown instead.
  static bool _carriesPersonalData(String text) =>
      RegExp(r'[\w.+-]+@[\w-]+\.[\w.-]+').hasMatch(text) ||
      RegExp(r'(?:\d[\s-]?){10,}').hasMatch(text);

  static bool _looksTechnical(String text) =>
      _technicalSignatures.any((pattern) => pattern.hasMatch(text));

  /// A sentence a person could plausibly have written, as opposed to a
  /// token, a path or a stack frame.
  static bool _looksLikeSentence(String text) {
    if (text.length < 8 || text.length > 220) return false;
    if (!text.contains(' ')) return false;
    if (text.contains('_') || text.contains('{') || text.contains('/')) {
      return false;
    }
    return RegExp(r'^[A-Za-z\u0600-\u06FF]').hasMatch(text);
  }

  // ---------------------------------------------------------------------
  // Business messages, translated.
  //
  // The server owns these rules and writes them in English. A person using
  // the Arabic interface should read the rule, not a translated word by
  // word — so each one below is a short sentence in the same spirit.
  // ---------------------------------------------------------------------

  static const _exactAr = <String, String>{
    // --- chart of accounts -------------------------------------------------
    'Account not found': 'لم يتم العثور على الحساب.',
    'Account is inactive': 'هذا الحساب غير نشط.',
    'Account is inactive or unavailable': 'هذا الحساب غير نشط أو غير متاح.',
    'The account does not exist': 'هذا الحساب غير موجود.',
    'The account does not exist in this company':
        'هذا الحساب غير موجود في هذه الشركة.',
    'The ledger account does not exist': 'حساب الأستاذ غير موجود.',
    'One or more accounts do not exist': 'حساب واحد أو أكثر غير موجود.',
    'An account cannot be its own parent':
        'لا يمكن أن يكون الحساب تابعًا لنفسه.',
    'No free code left under this parent':
        'لا يوجد كود متاح تحت هذا الحساب الأب.',
    'Deactivate active subaccounts before deactivating their parent':
        'عطّل الحسابات الفرعية النشطة أولاً قبل تعطيل الحساب الأب.',
    'This account already has journal movements. Its code cannot be changed — deactivate it and create a new account instead.': 'لهذا الحساب قيود محاسبية مسجّلة، لذلك لا يمكن تغيير كوده. عطّله وأنشئ حسابًا جديدًا بدلاً منه.',
    'This account has sub-accounts, so it is a grouping account and cannot receive postings. Remove the sub-accounts first.': 'هذا الحساب له حسابات فرعية، لذلك هو حساب تجميعي ولا يمكن الترحيل عليه. احذف الحسابات الفرعية أولاً.',
    'A grouping account cannot receive postings':
        'لا يمكن الترحيل على حساب تجميعي.',
    'This account has journal movements and cannot be deleted. Deactivate it instead so the past stays readable.': 'لهذا الحساب قيود محاسبية مسجّلة ولا يمكن حذفه. عطّله بدلاً من ذلك حتى يبقى السجل التاريخي مقروءًا.',
    'This account has sub-accounts. Move or delete them first, or deactivate this account.':
        'لهذا الحساب حسابات فرعية. انقلها أو احذفها أولاً، أو عطّل هذا الحساب.',

    // --- journal / posting -------------------------------------------------
    'Journal entry is not balanced':
        'القيد غير متوازن: مجموع المدين لا يساوي مجموع الدائن.',
    'Journal entry not found': 'لم يتم العثور على القيد.',
    'Only posted entries can be reversed': 'لا يمكن عكس قيد إلا بعد ترحيله.',
    'Only a posted journal entry can be reversed':
        'لا يمكن عكس قيد إلا بعد ترحيله.',
    'This journal entry has already been reversed': 'تم عكس هذا القيد من قبل.',
    'This entry has already been reversed': 'تم عكس هذا القيد من قبل.',
    'The original journal entry has already been reversed':
        'تم عكس القيد الأصلي من قبل.',
    'The original journal entry is missing': 'القيد الأصلي غير موجود.',
    'The journal entry to reverse was not found':
        'لم يتم العثور على القيد المطلوب عكسه.',
    'Posting amounts cannot be negative':
        'لا يمكن أن تكون مبالغ الترحيل سالبة.',
    'Amounts cannot be negative': 'لا يمكن أن تكون المبالغ سالبة.',
    'Allocation amounts must be greater than zero':
        'يجب أن تكون مبالغ التوزيع أكبر من صفر.',
    'Every allocation needs a cost center': 'كل توزيع يحتاج إلى مركز تكلفة.',
    'An allocation amount is not a number': 'مبلغ التوزيع ليس رقمًا صالحًا.',
    'A cost center cannot be its own parent':
        'لا يمكن أن يكون مركز التكلفة تابعًا لنفسه.',
    'Cost center not found': 'لم يتم العثور على مركز التكلفة.',
    'The cost center does not exist': 'مركز التكلفة غير موجود.',
    'The parent cost center does not exist': 'مركز التكلفة الأب غير موجود.',
    'A closed period cannot be changed':
        'لا يمكن التعديل في فترة محاسبية مغلقة.',
    'Role permissions changed since they were loaded. Refresh and review them before saving.': 'تغيّرت صلاحيات الدور منذ فتحها؛ حدّث القائمة وراجع الصلاحيات قبل الحفظ.',
    'User roles changed since they were loaded. Refresh and review them before saving.': 'تغيّرت أدوار المستخدم منذ فتحها؛ حدّث القائمة وراجع الأدوار قبل الحفظ.',
    'The account parent changed since it was loaded. Refresh and review it before saving.': 'تغيّر الحساب الأب منذ فتح النموذج؛ حدّث الدليل وراجع التعديل قبل الحفظ.',
    'An account or its subaccounts have journal movements; moving them would change historical reports.': 'لا يمكن نقل الحساب أو فصله لوجود قيود عليه أو على حساباته الفرعية؛ حفاظًا على التقارير التاريخية.',
    'User permissions changed since they were loaded. Refresh and review them before saving.': 'تغيّرت صلاحيات المستخدم منذ فتحها؛ حدّث القائمة وراجع الصلاحيات قبل الحفظ.',
    'The changed dates contain posted history; the fiscal period boundaries cannot be changed.': 'تتضمن التواريخ المتغيرة حركات مُرحّلة؛ لا يمكن تعديل حدود الفترة حفاظًا على التاريخ.',
    'This period is already closed': 'هذه الفترة مغلقة بالفعل.',
    'This fiscal period overlaps another period; correct the ranges before closing.':
        'تتداخل هذه الفترة مع فترة أخرى. صحّح التواريخ قبل الإقفال.',
    'A period with that code already exists':
        'توجد فترة محاسبية بهذا الكود بالفعل.',
    'Fiscal period not found': 'لم يتم العثور على الفترة المحاسبية.',
    'The end date must be after the start date':
        'يجب أن يكون تاريخ النهاية بعد تاريخ البداية.',
    'endDate cannot be before startDate':
        'لا يمكن أن يكون تاريخ النهاية قبل تاريخ البداية.',
    'periodEnd must not be before periodStart':
        'لا يمكن أن تكون نهاية الفترة قبل بدايتها.',
    'periodTo must not be before periodFrom':
        'لا يمكن أن تكون نهاية الفترة قبل بدايتها.',
    'to must not be before from': 'لا يمكن أن يكون "إلى" قبل "من".',
    'The end date cannot be before the start date':
        'لا يمكن أن يكون تاريخ النهاية قبل تاريخ البداية.',
    'A period cannot overlap another period':
        'لا يمكن أن تتداخل الفترات المحاسبية.',
    'Opening balance document not found':
        'لم يتم العثور على مستند الأرصدة الافتتاحية.',
    'An opening balance needs at least two lines':
        'يحتاج مستند الأرصدة الافتتاحية إلى سطرين على الأقل.',
    'Only a posted opening balance can be reversed':
        'لا يمكن عكس أرصدة افتتاحية إلا بعد ترحيلها.',
    'Select the branch these opening figures belong to':
        'اختر الفرع الذي تنتمي إليه هذه الأرصدة.',
    'Budget not found': 'لم يتم العثور على الموازنة.',
    'A retired budget cannot be edited': 'لا يمكن تعديل موازنة مُلغاة.',

    // --- invoices ----------------------------------------------------------
    'Sales invoice not found': 'لم يتم العثور على فاتورة البيع.',
    'Purchase invoice not found': 'لم يتم العثور على فاتورة الشراء.',
    'Return document not found': 'لم يتم العثور على مستند المرتجع.',
    'Only a draft sales invoice can be edited':
        'لا يمكن تعديل فاتورة بيع إلا وهي مسودة.',
    'Only a draft purchase invoice can be edited':
        'لا يمكن تعديل فاتورة شراء إلا وهي مسودة.',
    'Only a posted sales invoice can be returned':
        'لا يمكن إرجاع فاتورة بيع إلا بعد ترحيلها.',
    'Only a posted purchase invoice can be returned':
        'لا يمكن إرجاع فاتورة شراء إلا بعد ترحيلها.',
    'Only posted invoices can be reversed':
        'لا يمكن عكس فاتورة إلا بعد ترحيلها.',
    'This invoice has already been reversed': 'تم عكس هذه الفاتورة من قبل.',
    'This invoice has no journal entry to reverse':
        'لا يوجد قيد مرتبط بهذه الفاتورة لعكسه.',
    'The original sales invoice does not exist':
        'فاتورة البيع الأصلية غير موجودة.',
    'The original purchase invoice does not exist':
        'فاتورة الشراء الأصلية غير موجودة.',
    'The original invoice line could not be found':
        'لم يتم العثور على سطر الفاتورة الأصلي.',
    'The return date cannot be before the invoice date':
        'لا يمكن أن يكون تاريخ المرتجع قبل تاريخ الفاتورة.',
    'A return needs at least one line': 'يحتاج المرتجع إلى سطر واحد على الأقل.',
    'A return must name the invoice it returns':
        'يجب تحديد الفاتورة التي يعود إليها المرتجع.',
    'A return document cannot itself be returned': 'لا يمكن إرجاع مستند مرتجع.',
    'A return must be recorded in the branch that issued the original invoice':
        'يجب تسجيل المرتجع في نفس الفرع الذي صدرت منه الفاتورة الأصلية.',
    'Return documents cannot be edited as sales invoices':
        'لا يمكن تعديل المرتجعات كفواتير بيع.',
    'Return documents cannot be edited as purchase invoices':
        'لا يمكن تعديل المرتجعات كفواتير شراء.',
    'One sales-return item is no longer tracked in stock':
        'أحد أصناف المرتجع لم يعد متتبعاً في المخزون.',
    'A sales-return item is no longer tracked in stock':
        'أحد أصناف المرتجع لم يعد متتبعاً في المخزون.',
    'A purchase-return item is no longer tracked in stock':
        'أحد أصناف مرتجع الشراء لم يعد متتبعاً في المخزون.',
    'Discount amount cannot exceed the invoice subtotal':
        'لا يمكن أن يتجاوز الخصم إجمالي الفاتورة.',
    'discountAmount cannot exceed the invoice subtotal':
        'لا يمكن أن يتجاوز الخصم إجمالي الفاتورة.',
    'Choose either a percentage discount or a fixed discount, not both':
        'اختر خصمًا بنسبة أو خصمًا بمبلغ ثابت، وليس الاثنين معًا.',
    'A percentage discount requires a non-zero subtotal':
        'الخصم بالنسبة يحتاج إلى إجمالي أكبر من صفر.',
    'discountPercent must be between 0 and 100':
        'يجب أن تكون نسبة الخصم بين 0 و100.',
    'Insufficient balance': 'الرصيد غير كافٍ لإتمام العملية.',
    'Insufficient stock': 'الكمية المتاحة في المخزون غير كافية.',
    'The document has already been posted': 'تم ترحيل المستند بالفعل.',

    // --- quotations / orders ----------------------------------------------
    'Quotation not found': 'لم يتم العثور على عرض السعر.',
    'Sales order not found': 'لم يتم العثور على أمر البيع.',
    'Purchase order not found': 'لم يتم العثور على أمر الشراء.',
    'Only a draft quotation can be edited':
        'لا يمكن تعديل عرض السعر إلا وهو مسودة.',
    'Only a draft quotation can be deleted':
        'لم يُحذف عرض السعر لأنه لم يعد مسودة. حدّث البيانات وحاول مرة أخرى.',
    'Only a draft quotation can be issued':
        'لا يمكن إصدار عرض السعر إلا وهو مسودة.',
    'A converted quotation can no longer change status':
        'عرض السعر المحوّل إلى فاتورة لا يمكنه تغيير حالته.',
    'This quotation has already been converted to an invoice':
        'تم تحويل عرض السعر إلى فاتورة بالفعل.',
    'This quotation has no lines to convert':
        'عرض السعر لا يحتوي على سطور لتحويلها.',
    'Invoice totals differ from the accepted quotation; review tax and discounts before conversion': 'إجماليات الفاتورة لا تطابق عرض السعر المقبول. راجع الضريبة والخصومات قبل التحويل؛ لم تُنشأ فاتورة.',
    'This quotation changed while the decision was being saved':
        'تم تعديل عرض السعر أثناء حفظ القرار. أعد تحميل الصفحة وحاول مرة أخرى.',
    'This quotation was converted by someone else a moment ago':
        'تم تحويل عرض السعر من مستخدم آخر للحظات. أعد تحميل الصفحة.',
    'A cancelled order cannot be invoiced':
        'لا يمكن إصدار فاتورة لأمر بيع ملغى.',
    'Approve the order before invoicing it':
        'اعتمد أمر البيع قبل إصدار الفاتورة.',
    'This order is already cancelled': 'أمر البيع ملغى بالفعل.',
    'This order is fully invoiced; nothing is outstanding':
        'أمر البيع مفوتر بالكامل ولا يوجد متبقٍ للفوترة.',
    'This order was approved by someone else a moment ago':
        'تم اعتماد أمر البيع من مستخدم آخر للحظات. أعد تحميل الصفحة.',
    'An order needs at least one line':
        'يحتاج أمر البيع إلى سطر واحد على الأقل.',
    'Keep at least one column visible': 'أبقِ عمودًا واحدًا ظاهرًا على الأقل.',
    'Every quotation column needs a key':
        'كل عمود في عرض السعر يحتاج إلى مفتاح.',
    'Quotation column template not found': 'لم يتم العثور على قالب الأعمدة.',
    'Quotation design template not found': 'لم يتم العثور على قالب التصميم.',
    'Quotation term not found': 'لم يتم العثور على بند عرض السعر.',
    'Write what was discussed before saving the follow-up':
        'اكتب ما تم مناقشته قبل حفظ المتابعة.',

    // --- cash ---------------------------------------------------------------
    'Cash account not found': 'لم يتم العثور على الحساب النقدي.',
    'Cash voucher not found': 'لم يتم العثور على سند الصندوق.',
    'That cash account is inactive': 'هذا الحساب النقدي غير نشط.',
    'The cash account does not exist': 'الحساب النقدي غير موجود.',
    'The cash account is inactive': 'الحساب النقدي غير نشط.',
    'The cash account is required': 'يجب اختيار الحساب النقدي.',
    'Choose the cash account the money moved through':
        'اختر الحساب النقدي الذي مرّت منه الحركة.',
    'Only a posted voucher can be reversed': 'لا يمكن عكس سند إلا بعد ترحيله.',
    'A transfer needs two different accounts':
        'يحتاج التحويل إلى حسابين مختلفين.',
    'A transfer needs two different warehouses':
        'يحتاج التحويل إلى مخزنين مختلفين.',
    'A transfer needs the branch the stock leaves':
        'يجب تحديد الفرع الذي يخرج منه المخزون.',
    'A voucher is against a customer or a supplier, not both':
        'السند يكون على عميل أو مورد، وليس الاثنين معًا.',
    'One or more vouchers do not exist in this company':
        'سند واحد أو أكثر غير موجود في هذه الشركة.',
    'The counter account does not exist': 'الحساب المقابل غير موجود.',
    'A reconciliation is already posted for this period':
        'تم ترحيل تسوية لهذه الفترة بالفعل.',
    'Reconciliation not found': 'لم يتم العثور على التسوية.',

    // --- stock --------------------------------------------------------------
    'Item not found': 'لم يتم العثور على الصنف.',
    'Item is inactive': 'هذا الصنف غير نشط.',
    'The item does not exist': 'الصنف غير موجود.',
    'The item does not exist in this company': 'الصنف غير موجود في هذه الشركة.',
    'The item is inactive': 'هذا الصنف غير نشط.',
    'The item is not stock-tracked': 'هذا الصنف غير متتبع في المخزون.',
    'Warehouse not found': 'لم يتم العثور على المخزن.',
    'Stock document not found': 'لم يتم العثور على مستند المخزون.',
    'Only a posted stock document can be reversed':
        'لا يمكن عكس مستند مخزون إلا بعد ترحيله.',
    'Only a posted transfer can be reversed':
        'لا يمكن عكس تحويل إلا بعد ترحيله.',
    'Transfer not found': 'لم يتم العثور على التحويل.',
    'A stock document needs at least one line':
        'يحتاج مستند المخزون إلى سطر واحد على الأقل.',
    'A unit cannot be its own parent': 'لا يمكن أن تكون الوحدة تابعة لنفسها.',
    'Opening quantity must be greater than zero':
        'يجب أن تكون الكمية الافتتاحية أكبر من صفر.',

    // --- parties ------------------------------------------------------------
    'The customer does not exist': 'العميل غير موجود.',
    'The customer does not exist in this company':
        'العميل غير موجود في هذه الشركة.',
    'The customer is inactive': 'هذا العميل غير نشط.',
    'The supplier does not exist': 'المورد غير موجود.',
    'The supplier does not exist in this company':
        'المورد غير موجود في هذه الشركة.',
    'The supplier is inactive': 'هذا المورد غير نشط.',
    'The warehouse does not exist in this company':
        'المخزن غير موجود في هذه الشركة.',
    'The branch does not exist in this company':
        'الفرع غير موجود في هذه الشركة.',
    'One of the branches does not exist in this company':
        'أحد الفروع غير موجود في هذه الشركة.',
    'The company does not exist': 'الشركة غير موجودة.',
    'Company not found': 'لم يتم العثور على الشركة.',
    'Branch not found': 'لم يتم العثور على الفرع.',
    'User not found': 'لم يتم العثور على المستخدم.',
    'Role not found': 'لم يتم العثور على الدور.',
    'A role with that code already exists': 'يوجد دور بهذا الكود بالفعل.',
    'A system role cannot be removed': 'لا يمكن حذف دور نظامي.',
    'A system role cannot be renamed': 'لا يمكن إعادة تسمية دور نظامي.',
    'One of the roles does not exist in this company':
        'أحد الأدوار غير موجود في هذه الشركة.',
    'One of the permissions no longer exists': 'إحدى الصلاحيات لم تعد موجودة.',
    'The system administrator cannot be deactivated':
        'لا يمكن تعطيل حساب مسؤول النظام.',
    'You cannot deactivate your own account': 'لا يمكنك تعطيل حسابك الخاص.',
    'That username is already taken': 'اسم المستخدم مستخدم بالفعل.',
    'That username is already taken. Choose a different username.':
        'اسم المستخدم مستخدم بالفعل. اختر اسم مستخدم آخر.',
    'That email address is already used by another account. Enter a different email address, or leave it empty.':
        'البريد الإلكتروني مستخدم في حساب آخر. أدخل بريدًا إلكترونيًا مختلفًا أو اتركه فارغًا.',
    'That username is reserved': 'اسم المستخدم محجوز.',
    'Invalid username or password': 'اسم المستخدم أو كلمة المرور غير صحيحة.',
    'Invalid or expired token': 'انتهت صلاحية الجلسة. سجّل الدخول مرة أخرى.',
    'Invalid or expired refresh token':
        'انتهت صلاحية الجلسة. سجّل الدخول مرة أخرى.',
    'Missing bearer token': 'انتهت صلاحية الجلسة. سجّل الدخول مرة أخرى.',
    'The signed-in user is not assigned to a branch':
        'المستخدم الحالي غير مرتبط بأي فرع.',
    'Only a super administrator can access full-database backups':
        'الوصول إلى النسخ الاحتياطية الكاملة مقتصر على المسؤول الأعلى.',
    'Only a super administrator can deactivate a super administrator account':
        'تعطيل حساب مسؤول أعلى مقتصر على مسؤول أعلى آخر.',
    'Only a super administrator can modify a super administrator account':
        'تعديل حساب مسؤول أعلى مقتصر على مسؤول أعلى آخر.',
    'Only a super administrator can reset a super administrator password':
        'تغيير كلمة مرور مسؤول أعلى مقتصر على مسؤول أعلى آخر.',

    // --- settings -----------------------------------------------------------
    'Company names cannot be blank': 'لا يمكن أن يكون اسم الشركة فارغًا.',
    'Company logo not found': 'لم يتم العثور على شعار الشركة.',
    'The currency must be a three-letter code':
        'يجب أن يكون رمز العملة من ثلاثة أحرف.',
    'Invalid setting value': 'قيمة الإعداد غير صالحة.',

    // --- documents, line by line -------------------------------------------
    'A sales invoice item no longer exists':
        'أحد أصناف فاتورة البيع لم يعد موجودًا.',
    'A sales-return item no longer exists':
        'أحد أصناف مرتجع البيع لم يعد موجودًا.',
    'A draft can only be edited from its assigned branch':
        'لا يمكن تعديل المسودة إلا من الفرع المسند إليها.',
    'A purchase invoice may contain at most 50 landed-cost charges':
        'لا يمكن أن تحتوي فاتورة الشراء على أكثر من ٥٠ بند تكلفة استيراد.',
    'A draft is edited directly; revision is for issued quotations':
        'المسودة تُعدّل مباشرة، والمراجعة تكون لعروض الأسعار الصادرة.',
    'A column key cannot contain control characters':
        'مفتاح العمود لا يمكن أن يحتوي على رموز تحكم.',
    'A ticket is required for this address':
        'هذا العنوان يحتاج إلى تصريح وصول.',
    'No principal': 'انتهت صلاحية الجلسة. سجّل الدخول مرة أخرى.',
    'Invalid posting amount': 'مبلغ الترحيل غير صالح.',

    // --- concurrency --------------------------------------------------------
    'This document has just been changed by someone else.':
        'تم تعديل هذا المستند من مستخدم آخر للتو.',
    'This document has just been posted by someone else.':
        'تم ترحيل هذا المستند من مستخدم آخر للتو.',
    'This return has just been changed by someone else.':
        'تم تعديل هذا المرتجع من مستخدم آخر للتو.',
    'This return has just been posted by someone else.':
        'تم ترحيل هذا المرتجع من مستخدم آخر للتو.',
    'This transfer has just been changed by someone else.':
        'تم تعديل هذا التحويل من مستخدم آخر للتو.',
    'This transfer has just been posted by someone else.':
        'تم ترحيل هذا التحويل من مستخدم آخر للتو.',
    'This voucher has just been changed by someone else.':
        'تم تعديل هذا السند من مستخدم آخر للتو.',
    'This voucher has just been posted by someone else.':
        'تم ترحيل هذا السند من مستخدم آخر للتو.',

    // --- downloads ----------------------------------------------------------
    'The server could not be reached.':
        'تعذّر الوصول إلى الخادم. تحقق من الاتصال ثم حاول مرة أخرى.',
    'Saving the file was cancelled.': 'أُلغي حفظ الملف.',
    'The address for this file is not valid.': 'رابط الملف غير صالح.',
    'No file was uploaded.': 'لم يتم اختيار ملف للرفع.',
    'The server sent no file. Ask the person who looks after the program to check its logs.':
        'لم يُرسل الخادم أي ملف. راجع مسؤول النظام للتحقق من سجل الخادم.',

    // --- validation the client currently surfaces as-is ---------------------
    'code, nameEn and nameAr are required':
        'الكود والاسم الإنجليزي والاسم العربي مطلوبة.',
    'Please fill in all required fields': 'يرجى إكمال جميع الحقول المطلوبة.',
    'Choose an account': 'اختر حسابًا.',
    'Enter a name': 'أدخل الاسم.',
  };

  /// Case-insensitive view of [_exactAr]: the API capitalises some
  /// sentences and lower-cases others after a "Line 3:" prefix.
  static final Map<String, String> _exactArLower = <String, String>{
    for (final entry in _exactAr.entries) entry.key.toLowerCase(): entry.value,
  };

  /// Messages with a variable inside them.
  static final List<_BusinessRule> _patterns = <_BusinessRule>[
    _BusinessRule(
      _ci(
        r'^Nothing to depreciate for (\d{4}-\d{2})\s+[—-]\s+.*already depreciated for \1(?:;.*)?$',
      ),
      (m) =>
          'لا توجد أصول مؤهلة للإهلاك في ${m.group(1)}؛ سبق احتساب إهلاك أصل واحد على الأقل لهذه الفترة.',
    ),
    _BusinessRule(
      _ci(r'^Account (\S+) is inactive$'),
      (m) => 'الحساب${_codeSuffix(m.group(1))} غير نشط.',
    ),
    _BusinessRule(
      _ci(r'^Account (\S+) cannot receive postings$'),
      (m) => 'الحساب${_codeSuffix(m.group(1))} لا يمكن الترحيل عليه.',
    ),
    _BusinessRule(
      _ci(r'^Account (\S+) is a grouping account$'),
      (m) =>
          'الحساب${_codeSuffix(m.group(1))} حساب تجميعي ولا يمكن الترحيل عليه.',
    ),
    _BusinessRule(
      _ci(r'^Account (\S+) does not exist$'),
      (m) => 'الحساب${_codeSuffix(m.group(1))} غير موجود.',
    ),
    _BusinessRule(
      _ci(r'^Account (\S+) is (?:already )?used'),
      (m) => 'الحساب${_codeSuffix(m.group(1))} مستخدم بالفعل.',
    ),
    _BusinessRule(
      _ci(r'^Account (\S+) cannot be deleted'),
      (m) => 'لا يمكن حذف الحساب${_codeSuffix(m.group(1))}.',
    ),
    _BusinessRule(_ci(r'^(.+) code (\S+) is already used$'), (m) {
      final noun = _nounOrNull(m.group(1));
      return noun == null
          ? null
          : 'كود $noun${_codeSuffix(m.group(2))} مستخدم بالفعل.';
    }),
    _BusinessRule(
      _ci(
        r'^The code "(\S+)" is already used by another account in this company$',
      ),
      (m) =>
          'الكود${_codeSuffix(m.group(1))} مستخدم بالفعل في حساب آخر بهذه الشركة.',
    ),
    _BusinessRule(
      _ci(r'^Cash account code (\S+) is already used$'),
      (m) => 'كود الحساب النقدي${_codeSuffix(m.group(1))} مستخدم بالفعل.',
    ),
    // A posting role the chart of accounts does not carry (the opening stock of
    // an item posts inventory against opening equity).
    _BusinessRule(
      _ci(
        r"^Required account (\S+) \((\w+)\) does not exist in this company's chart of accounts$",
      ),
      (m) {
        const roles = <String, String>{
          'inventory': 'المخزون',
          'openingbalanceequity': 'الأرصدة الافتتاحية (حقوق الملكية)',
          'accountsreceivable': 'العملاء',
          'accountspayable': 'الموردين',
          'salesrevenue': 'إيراد المبيعات',
          'costofgoodssold': 'تكلفة البضاعة المباعة',
        };
        final role = roles[(m.group(2) ?? '').toLowerCase()] ?? 'مطلوب للترحيل';
        return 'دليل الحسابات ينقصه حساب $role${_safeToken(m.group(1))} المطلوب لترحيل هذه العملية، فلم تُحفظ. أضف الحساب أو راجع إعداد دليل الحسابات، ثم أعد المحاولة.';
      },
    ),
    // New-item form refusals. Each names the field to fix; the figures echoed
    // are limited to short plain tokens (see _safeToken).
    _BusinessRule(
      _ci(r'^Provide an Arabic or English item name$'),
      (_) => 'اكتب اسم الصنف بالعربي أو بالإنجليزي على الأقل.',
    ),
    _BusinessRule(
      _ci(r'^Barcode (\S+) is already assigned to item (\S+)$'),
      (m) =>
          'الباركود${_safeToken(m.group(1))} مستخدم بالفعل في الصنف${_safeToken(m.group(2))}. استخدم باركودًا آخر أو اتركه فارغًا.',
    ),
    _BusinessRule(
      _ci(r'^Barcode (\S+) is already assigned to unit (.+) of item (\S+)$'),
      (m) =>
          'الباركود${_safeToken(m.group(1))} مستخدم بالفعل في إحدى وحدات الصنف${_safeToken(m.group(3))}. استخدم باركودًا آخر أو اتركه فارغًا.',
    ),
    _BusinessRule(
      _ci(
        r'^Opening stock cannot be set on an item that is not stock-tracked$',
      ),
      (_) =>
          'لا يمكن إدخال رصيد افتتاحي لصنف غير متتبع في المخزون. فعّل «تتبّع المخزون» أو امسح الكمية والتكلفة الافتتاحية. لم يُنشأ الصنف.',
    ),
    _BusinessRule(
      _ci(r'^openingQuantity and openingUnitCost must be given together$'),
      (_) =>
          'اكتب الكمية الافتتاحية وتكلفة الوحدة الافتتاحية معًا، أو اترك الاثنتين فارغتين. لم يُنشأ الصنف.',
    ),
    _BusinessRule(
      _ci(r'^Select a branch before adding opening stock$'),
      (_) => 'اختر الفرع قبل إضافة رصيد افتتاحي. لم يُنشأ الصنف.',
    ),
    _BusinessRule(
      _ci(
        r'^This branch already has an opening balance \((\S+)\)\. Add the item there instead of giving it opening stock here\.$',
      ),
      (m) =>
          'للفرع مستند رصيد افتتاحي بالفعل${_safeToken(m.group(1))}. أضف الصنف في هذا المستند بدل إدخال رصيد افتتاحي هنا، أو امسح الكمية والتكلفة الافتتاحية. لم يُنشأ الصنف.',
    ),
    _BusinessRule(
      _ci(
        r'^You may not receive stock into any active warehouse of your branch, so opening stock cannot be saved\.$',
      ),
      (_) =>
          'لا تملك صلاحية استلام مخزون في أي مخزن مفعّل بفرعك، فلا يمكن حفظ رصيد افتتاحي. احفظ الصنف بدون كمية افتتاحية أو اطلب الصلاحية من المدير. لم يُنشأ الصنف.',
    ),
    _BusinessRule(
      _ci(
        r'^All warehouses of this branch are inactive, so opening stock cannot be saved\. Activate a branch warehouse or save the item without opening stock\.$',
      ),
      (_) =>
          'كل مخازن الفرع غير مفعّلة، فلا يمكن حفظ رصيد افتتاحي. فعّل مخزنًا للفرع أو احفظ الصنف بدون كمية افتتاحية. لم يُنشأ الصنف.',
    ),
    _BusinessRule(
      _ci(
        r'^The opening stock warehouse changed since the form was opened\. Reopen the form to see the current warehouse\.$',
      ),
      (_) =>
          'مخزن الرصيد الافتتاحي تغيّر منذ فتح النموذج. أغلق النموذج وافتحه من جديد لترى المخزن الحالي. لم يُنشأ الصنف.',
    ),
    _BusinessRule(_ci(r'^(.+) code (\S+) does not exist$'), (m) {
      final noun = _nounOrNull(m.group(1));
      return noun == null ? null : '$noun${_codeSuffix(m.group(2))} غير موجود.';
    }),
    _BusinessRule(_ci(r'^(.+?) (\S+) is inactive$'), (m) {
      final noun = _nounOrNull(m.group(1));
      return noun == null ? null : '$noun${_codeSuffix(m.group(2))} غير نشط.';
    }),
    _BusinessRule(
      _ci(r'^Missing permission: (.+)$'),
      (_) => 'ليس لديك الصلاحية المطلوبة. راجع مسؤول النظام.',
    ),
    _BusinessRule(_ci(r'^(The )?(\w+) does not exist$'), (m) {
      final noun = m.group(2) ?? '';
      final translated = _nounsAr[noun.toLowerCase()];
      return translated == null ? null : '$translated غير موجود.';
    }),
    _BusinessRule(_ci(r'^(\w+) not found$'), (m) {
      final translated = _nounsAr[m.group(1)!.toLowerCase()];
      return translated == null ? null : 'لم يتم العثور على $translated.';
    }),
    // Validation-shaped: "amount is required" / "amount cannot be negative".
    _BusinessRule(
      _ci(r'^(\w+) is required$'),
      (m) => 'الحقل «${_fieldAr(m.group(1))}» مطلوب.',
    ),
    _BusinessRule(
      _ci(r'^(\w+) cannot be negative$'),
      (m) => 'لا يمكن أن يكون «${_fieldAr(m.group(1))}» سالبًا.',
    ),
    _BusinessRule(
      _ci(r'^(\w+) must be greater than zero$'),
      (m) => 'يجب أن يكون «${_fieldAr(m.group(1))}» أكبر من صفر.',
    ),
    _BusinessRule(
      _ci(r'^(\w+) is not a valid (number|amount|date|percentage)$'),
      (m) => 'قيمة «${_fieldAr(m.group(1))}» غير صالحة.',
    ),
    _BusinessRule(
      _ci(r'^(\w+) must be a valid (date|number|amount)$'),
      (m) => 'قيمة «${_fieldAr(m.group(1))}» غير صالحة.',
    ),
    _BusinessRule(
      _ci(r'^(\w+) must be (?:a )?text$'),
      (m) => 'يجب أن يكون «${_fieldAr(m.group(1))}» نصًا.',
    ),
    _BusinessRule(
      _ci(r'^(\w+) must be true or false$'),
      (m) => 'قيمة «${_fieldAr(m.group(1))}» يجب أن تكون نعم أو لا.',
    ),
    _BusinessRule(
      _ci(r'^(\w+) must be a UUID$'),
      (m) => 'قيمة «${_fieldAr(m.group(1))}» غير صالحة.',
    ),
    _BusinessRule(
      _ci(r'^(\w+) must be between (\d+) and (\d+)$'),
      (m) =>
          'يجب أن تكون قيمة «${_fieldAr(m.group(1))}» بين ${m.group(2)} و${m.group(3)}.',
    ),
    _BusinessRule(
      _ci(r'^(\w+) must be a whole number between (\d+) and (\d+)$'),
      (m) =>
          'يجب أن تكون قيمة «${_fieldAr(m.group(1))}» عددًا صحيحًا بين '
          '${m.group(2)} و${m.group(3)}.',
    ),
    _BusinessRule(
      _ci(r'^(\w+) cannot be longer than (\d+) characters$'),
      (m) =>
          'لا يمكن أن يزيد «${_fieldAr(m.group(1))}» عن ${m.group(2)} حرفًا.',
    ),
    _BusinessRule(
      _ci(r'^(\w+) cannot exceed (\d+)$'),
      (m) => 'لا يمكن أن يزيد «${_fieldAr(m.group(1))}» عن ${m.group(2)}.',
    ),
    _BusinessRule(
      _ci(r'^"?from"? must not be after "?to"?$'),
      (_) => 'لا يمكن أن يكون تاريخ البداية بعد تاريخ النهاية.',
    ),
    _BusinessRule(_ci(r'^(.+) is already posted$'), (m) {
      final noun = _nounOrNull(m.group(1));
      return noun == null ? null : 'تم ترحيل $noun بالفعل.';
    }),
    _BusinessRule(_ci(r'^(.+) is already reversed$'), (m) {
      final noun = _nounOrNull(m.group(1));
      return noun == null ? null : 'تم عكس $noun بالفعل.';
    }),
    // "This quotation is already approved": the noun and the state both
    // come from a small dictionary, so an unfamiliar pair declines the rule
    // instead of producing half-English Arabic.
    _BusinessRule(_ci(r'^(?:This |The )?(.+) is already (\w+)$'), (m) {
      final noun = _nounOrNull(m.group(1));
      final state = _statesAr[m.group(2)!.toLowerCase()];
      if (noun == null || state == null) return null;
      return '$noun $state بالفعل.';
    }),
    _BusinessRule(
      _ci(r'^The server would not send the file \(HTTP \d+\)\.$'),
      (_) => 'رفض الخادم إرسال الملف. تحقق من صلاحياتك ثم حاول مرة أخرى.',
    ),
    // "Only a draft (order|quotation|invoice) can be (edited|issued|...)"
    _BusinessRule(
      _ci(
        r'^Only a (draft|posted) (\w+) can be (edited|issued|approved|reversed|posted|returned)$',
      ),
      (m) {
        final noun = _nounOrNull(m.group(2));
        if (noun == null) return null;
        final state = m.group(1)!.toLowerCase() == 'draft'
            ? 'مسودة'
            : 'بعد ترحيله';
        final action = _actionsAr[m.group(3)!.toLowerCase()];
        if (action == null) return null;
        return 'لا يمكن $action $noun إلا وهو $state.';
      },
    ),
    _BusinessRule(_ci(r'^Only a draft (\w+) can be approved \(it is \w+\)$'), (
      m,
    ) {
      final noun = _nounOrNull(m.group(1));
      return noun == null ? null : 'لا يمكن اعتماد $noun إلا وهو مسودة.';
    }),
    _BusinessRule(
      _ci(r'^item (\S+) is not stock-tracked$'),
      (m) => 'الصنف${_codeSuffix(m.group(1))} غير متتبع في المخزون.',
    ),

    // ---- the same sentences the import, returns and validation paths write --
    // A date is a date: these arrive from the DTO when a date field is typed
    // wrongly, and the field name is the only useful part of the sentence.
    _BusinessRule(
      _ci(r'^"(\w+)" must be an ISO date or timestamp$'),
      (m) => 'يجب أن يكون «${_fieldAr(m.group(1))}» تاريخًا صالحًا.',
    ),
    _BusinessRule(
      _ci(r'^(\w+) is not a (?:real )?date$'),
      (m) => 'قيمة «${_fieldAr(m.group(1))}» ليست تاريخًا صالحًا.',
    ),
    _BusinessRule(
      _ci(r'^(\w+) cannot exceed (\d+) characters$'),
      (m) =>
          'لا يمكن أن يزيد «${_fieldAr(m.group(1))}» عن ${m.group(2)} حرفًا.',
    ),
    _BusinessRule(
      _ci(r'^(\w+) must be a whole number of days between (\d+) and (\d+)$'),
      (m) =>
          'يجب أن يكون «${_fieldAr(m.group(1))}» عددًا صحيحًا من الأيام '
          'بين ${m.group(2)} و${m.group(3)}.',
    ),
    _BusinessRule(
      _ci(r'^currency must be a three-letter code$'),
      (_) => 'العملة يجب أن تكون رمزًا من ثلاثة أحرف، مثل EGP.',
    ),

    // Enumerations are identifiers, not words: say what is wrong and point at
    // the list again rather than printing "RECEIPT, PAYMENT" at a cashier.
    _BusinessRule(
      _ci(r'^kind must be RECEIPT or PAYMENT$'),
      (_) => 'نوع السند يجب أن يكون قبضًا أو صرفًا.',
    ),
    _BusinessRule(
      _ci(r'^kind must be CASH or BANK$'),
      (_) => 'نوع الحساب يجب أن يكون نقدية أو حسابًا بنكيًا.',
    ),
    _BusinessRule(
      _ci(r'^kind must be CUSTOMER or SUPPLIER$'),
      (_) => 'النوع يجب أن يكون عميلًا أو موردًا.',
    ),
    _BusinessRule(
      _ci(r'^kind must be sales or purchases$'),
      (_) => 'النوع يجب أن يكون مبيعات أو مشتريات.',
    ),
    _BusinessRule(
      _ci(r'^(?:kind|status|type) must be [A-Za-z, ]+$'),
      (_) => 'القيمة المحددة غير صالحة. اختر واحدة من القائمة المتاحة.',
    ),
    _BusinessRule(
      _ci(r'^Unknown (?:voucher |stock document )?(?:kind|status)(?::| ")'),
      (_) => 'القيمة المحددة غير معروفة. أعد تحميل الصفحة واختر من القائمة.',
    ),

    // A document line: the number is what the person needs to find the row.
    _BusinessRule(
      _ci(r'^Line (\d+) cannot be both a debit and a credit$'),
      (m) =>
          'السطر ${m.group(1)} لا يمكن أن يكون مدينًا ودائنًا في الوقت نفسه.',
    ),
    _BusinessRule(
      _ci(r'^Line (\d+) needs either a debit or a credit$'),
      (m) => 'السطر ${m.group(1)} يحتاج إلى مبلغ مدين أو دائن.',
    ),
    // "Line 3: ..." is already split into an Arabic prefix plus a body, so a
    // colon after the number never reaches these rules.
    _BusinessRule(_ci(r'^a quantity is required$'), (_) => 'الكمية مطلوبة.'),
    _BusinessRule(
      _ci(r'^a stock item needs a quantity greater than zero$'),
      (_) => 'الصنف المخزني يحتاج كمية أكبر من صفر.',
    ),
    _BusinessRule(
      _ci(r'^the unit cost cannot be negative$'),
      (_) => 'تكلفة الوحدة لا يمكن أن تكون سالبة.',
    ),
    _BusinessRule(
      _ci(r'^an invoice line may appear only once in a return$'),
      (_) => 'سطر الفاتورة لا يتكرر في المرتجع.',
    ),
    _BusinessRule(
      _ci(r'^that line does not belong to the invoice$'),
      (_) => 'هذا السطر لا ينتمي إلى الفاتورة.',
    ),
    _BusinessRule(
      _ci(r'^allocated inventory cost is below the returned invoice value$'),
      (_) => 'تكلفة المخزون المخصصة أقل من قيمة الفاتورة المرتجعة.',
    ),
    _BusinessRule(
      _ci(r'^(\w+) exceeds the original line$'),
      (m) =>
          'الكمية في «${_fieldAr(m.group(1))}» تتجاوز الكمية الأصلية في الفاتورة.',
    ),
    _BusinessRule(
      _ci(r'^(\w+) has an invalid negative amount$'),
      (m) => 'قيمة «${_fieldAr(m.group(1))}» سالبة وغير صالحة.',
    ),
    _BusinessRule(
      _ci(r'^(\w+) is already fully returned or inconsistent$'),
      (m) =>
          'السطر في «${_fieldAr(m.group(1))}» مُرتجَع بالكامل بالفعل، أو أن بياناته غير متسقة.',
    ),

    // A return only travels on the note that matches its direction.
    _BusinessRule(
      _ci(
        r'^Only a (sales credit note|purchase debit note) can be (posted|reversed) as a (?:sales|purchase) return\.?$',
      ),
      (m) {
        final isCredit = m.group(1)!.toLowerCase() == 'sales credit note';
        final note = isCredit ? 'إشعار دائن مبيعات' : 'إشعار مدين مشتريات';
        final action = m.group(2)!.toLowerCase() == 'posted' ? 'ترحيل' : 'عكس';
        return 'لا يمكن $action المرتجع إلا من خلال $note.';
      },
    ),
    _BusinessRule(
      _ci(
        r'^The source (?:sales|purchase) invoice is no longer posted; this return cannot be (posted|reversed)\.?$',
      ),
      (m) =>
          'لم تعد فاتورة المصدر مُرحَّلة، لذلك لا يمكن '
          '${m.group(1)!.toLowerCase() == 'posted' ? 'ترحيل' : 'عكس'} المرتجع.',
    ),

    // Quotation editor and cash documents.
    _BusinessRule(
      _ci(r'^Quotation: (?:the )?(\w+) (does not exist|is inactive)$'),
      (m) {
        final noun = _nounsAr[m.group(1)!.toLowerCase()] ?? 'البيانات';
        return m.group(2)!.toLowerCase() == 'is inactive'
            ? 'العرض: $noun غير نشط.'
            : 'العرض: $noun غير موجود.';
      },
    ),
    _BusinessRule(
      _ci(r'^Quotation: give either an item or a description$'),
      (_) => 'أدخل صنفًا أو وصفًا للسطر قبل الحفظ.',
    ),
    _BusinessRule(
      _ci(r'^Table (\d+): give the table a title$'),
      (m) => 'الجدول ${m.group(1)}: أدخل عنوانًا للجدول.',
    ),
    _BusinessRule(
      _ci(r'^The (\S+) cash account (does not exist|is inactive|is required)$'),
      (m) {
        final what = m.group(2)!.toLowerCase();
        final reasons = <String, String>{
          'does not exist': 'غير موجود',
          'is inactive': 'غير نشط',
          'is required': 'مطلوب',
        };
        return 'الحساب النقدي ${reasons[what] ?? 'غير صالح'}.';
      },
    ),
    _BusinessRule(
      _ci(r'^This company has no active branch to post the closing entry to$'),
      (_) => 'لا يوجد فرع نشط لترحيل قيد الإقفال. افتح فرعًا أولًا.',
    ),
    _BusinessRule(
      _ci(r'^Order line (\d+) does not belong to this order$'),
      (m) => 'سطر الأمر ${m.group(1)} لا ينتمي إلى هذا الأمر.',
    ),

    // Backup files: the operator needs to know which file, not why it failed.
    _BusinessRule(
      _ci(r'^The backup file is (empty|larger than .+?)\.?$'),
      (m) => m.group(1)!.toLowerCase() == 'empty'
          ? 'ملف النسخة الاحتياطية فارغ.'
          : 'ملف النسخة الاحتياطية أكبر من الحد المسموح به.',
    ),
    _BusinessRule(
      _ci(r'^The backup file has no tables in it\.?$'),
      (_) =>
          'ملف النسخة الاحتياطية لا يحتوي على جداول. تأكد أنه ملف نسخة صحيح.',
    ),
    _BusinessRule(
      _ci(r'^That file is outside the backup folder\.?$'),
      (_) => 'هذا الملف خارج مجلد النسخ الاحتياطية، ولا يمكن قراءته.',
    ),
    _BusinessRule(
      _ci(r'^No backup file named "(.+)" on this server\.?$'),
      (_) => 'لم يتم العثور على ملف النسخة الاحتياطية على الخادم.',
    ),
  ];

  /// A pattern that ignores capitalisation: the API writes "The item does
  /// not exist" at the start of a sentence and "the item does not exist"
  /// after a "Line 3:" prefix.
  static RegExp _ci(String source) => RegExp(source, caseSensitive: false);

  /// The Arabic noun, or null when this dictionary has never heard of it.
  static String? _nounOrNull(String? raw) =>
      _nounsAr[(raw ?? '').trim().toLowerCase()];

  // Only short numeric codes are safe to echo from server-side patterns;
  // arbitrary tokens and file paths can contain credentials or customer data.
  static String _codeSuffix(String? raw) {
    final code = raw ?? '';
    return RegExp(r'^\d{1,12}$').hasMatch(code) ? ' $code' : '';
  }

  /// A short plain token (code, barcode, document number) is safe to echo;
  /// anything else is left out rather than risk repeating private text.
  static String _safeToken(String? raw) {
    final token = raw ?? '';
    return RegExp(r'^[A-Za-z0-9_-]{1,60}$').hasMatch(token) ? ' $token' : '';
  }

  static String _fieldAr(String? raw) {
    final key = (raw ?? '').trim().toLowerCase();
    return _fieldsAr[key] ?? 'الحقل';
  }

  static const _nounsAr = <String, String>{
    'account': 'الحساب',
    'accounts': 'الحسابات',
    'cash account': 'الحساب النقدي',
    'item': 'الصنف',
    'items': 'الأصناف',
    'customer': 'العميل',
    'supplier': 'المورد',
    'warehouse': 'المخزن',
    'branch': 'الفرع',
    'company': 'الشركة',
    'invoice': 'الفاتورة',
    'sales invoice': 'فاتورة البيع',
    'purchase invoice': 'فاتورة الشراء',
    'quotation': 'عرض السعر',
    'order': 'الأمر',
    'sales order': 'أمر البيع',
    'purchase order': 'أمر الشراء',
    'return': 'المرتجع',
    'transfer': 'التحويل',
    'voucher': 'السند',
    'journal entry': 'القيد',
    'cost center': 'مركز التكلفة',
    'fiscal period': 'الفترة المحاسبية',
    'period': 'الفترة',
    'budget': 'الموازنة',
    'role': 'الدور',
    'user': 'المستخدم',
    'price list': 'قائمة الأسعار',
    'unit': 'الوحدة',
    'category': 'الفئة',
    'reconciliation': 'التسوية',
    'stock document': 'مستند المخزون',
    'opening balance': 'الأرصدة الافتتاحية',
    'quotation term': 'بند عرض السعر',
    'quotation column template': 'قالب الأعمدة',
    'quotation design template': 'قالب التصميم',
  };

  /// What may be done to a document, for the "only a draft ..." rules.
  static const _actionsAr = <String, String>{
    'edited': 'تعديل',
    'issued': 'إصدار',
    'approved': 'اعتماد',
    'reversed': 'عكس',
    'posted': 'ترحيل',
    'returned': 'إرجاع',
  };

  /// States an account, document or request can already be in.
  static const _statesAr = <String, String>{
    'posted': 'مُرحَّل',
    'reversed': 'معكوس',
    'cancelled': 'ملغى',
    'canceled': 'ملغى',
    'approved': 'معتمد',
    'invoiced': 'مفوتر',
    'converted': 'محوَّل',
    'closed': 'مغلق',
    'issued': 'صادر',
    'active': 'نشط',
    'inactive': 'غير نشط',
    'draft': 'مسودة',
    'returned': 'مُرتجع',
    'paid': 'مدفوع',
    'void': 'ملغى',
  };

  static const _fieldsAr = <String, String>{
    'accountid': 'الحساب',
    'cashaccountid': 'الحساب النقدي',
    'costcenterid': 'مركز التكلفة',
    'code': 'الكود',
    'name': 'الاسم',
    'nameen': 'الاسم الإنجليزي',
    'namear': 'الاسم العربي',
    'amount': 'المبلغ',
    'quantity': 'الكمية',
    'price': 'السعر',
    'unitprice': 'سعر الوحدة',
    'unitcost': 'تكلفة الوحدة',
    'date': 'التاريخ',
    'from': 'تاريخ البداية',
    'to': 'تاريخ النهاية',
    'asofdate': 'تاريخ القيمة',
    'enddate': 'تاريخ النهاية',
    'startdate': 'تاريخ البداية',
    'discountpercent': 'نسبة الخصم',
    'discountamount': 'مبلغ الخصم',
    'factor': 'المعامل',
    'currency': 'العملة',
    'unit': 'الوحدة',
    'notes': 'الملاحظات',
    'kind': 'النوع',
    'status': 'الحالة',
    'paymenttermdays': 'مدة السداد',
    'openingquantity': 'الكمية الافتتاحية',
    'openingunitcost': 'تكلفة الوحدة الافتتاحية',
    'taxrate': 'نسبة الضريبة',
    'transferdate': 'تاريخ التحويل',
    'statementbalance': 'رصيد الكشف',
  };
}

/// One translation rule for a message that carries a value inside it.
class _BusinessRule {
  _BusinessRule(this.pattern, this.translate);

  final RegExp pattern;

  /// Returns null when this rule cannot say anything useful, so the next
  /// rule (or the fallback) gets a turn.
  final String? Function(Match match) translate;
}

/// "Line 3: ..." split into the localised prefix and the body.
class _LinePrefix {
  const _LinePrefix(this.prefix, this.body);

  final String? prefix;
  final String body;
}

/// The few field names a person actually sees on screen, in Arabic. A name
/// that is not here is shown as written, so nothing is hidden by a missing
/// entry.
const _fieldLabelsAr = <String, String>{
  'name': 'الاسم',
  'nameAr': 'الاسم بالعربية',
  'nameEn': 'الاسم بالإنجليزية',
  'code': 'الكود',
  'email': 'البريد الإلكتروني',
  'phone': 'الهاتف',
  'address': 'العنوان',
  'taxNumber': 'الرقم الضريبي',
  'notes': 'ملاحظات',
  'quantity': 'الكمية',
  'unitPrice': 'سعر الوحدة',
  'price': 'السعر',
  'amount': 'المبلغ',
  'discount': 'الخصم',
  'description': 'الوصف',
  'itemId': 'الصنف',
  'customerId': 'العميل',
  'supplierId': 'المورد',
  'warehouseId': 'المخزن',
  'branchId': 'الفرع',
  'accountId': 'الحساب',
  'date': 'التاريخ',
  'quotationDate': 'تاريخ العرض',
  'validUntil': 'ساري حتى',
  'invoiceDate': 'تاريخ الفاتورة',
  'dueDate': 'تاريخ الاستحقاق',
  'username': 'اسم المستخدم',
  'password': 'كلمة المرور',
  'unit': 'الوحدة',
  'subject': 'الموضوع',
  'lines': 'البنود',
  'tables': 'الجداول',
  'items': 'البنود',
  'currency': 'العملة',
  'reason': 'السبب',
};

/// One line per refused field: "الحقل: السبب". A path into a list
/// (`lines.0.quantity`) reads as "البنود (1) - الكمية".
String describeFieldErrors(
  Map<String, String> errors, {
  required bool isArabic,
}) {
  String label(String path) {
    final parts = path.split('.');
    final out = <String>[];
    for (var i = 0; i < parts.length; i++) {
      final part = parts[i];
      final index = int.tryParse(part);
      if (index != null) {
        if (out.isNotEmpty) out[out.length - 1] = '${out.last} (${index + 1})';
        continue;
      }
      out.add(isArabic ? (_fieldLabelsAr[part] ?? part) : part);
    }
    return out.join(' - ');
  }

  final header = isArabic
      ? 'راجع الحقول التالية:'
      : 'Please check these fields:';
  return [
    header,
    for (final entry in errors.entries) '• ${label(entry.key)}: ${entry.value}',
  ].join('\n');
}
