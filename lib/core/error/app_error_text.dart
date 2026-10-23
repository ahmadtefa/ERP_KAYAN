import 'failure.dart';

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
      final preferred = _reasonOf(error);
      final code = _statusOf(error) ?? statusCode;
      final text = _resolveText(
        error.message,
        statusCode: code,
        preferred: preferred,
      );
      final reason = text.reason;
      return AppErrorText(
        reason: reason,
        severity: _severityOf(reason),
        businessMessage: text.businessMessage,
      );
    }

    if (error is String) return _resolveText(error, statusCode: statusCode);

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
  }) {
    var text = _clean(raw);

    // "ServerFailure: no such record" -> "no such record".
    final wrapped = RegExp(r'^[A-Za-z]*Failure:\s*(.*)$').firstMatch(text);
    if (wrapped != null) text = _clean(wrapped.group(1) ?? '');

    if (text.isEmpty) {
      return _fallback(statusCode: statusCode, preferred: preferred);
    }

    // Something already written in Arabic is a business message by
    // definition; keep it verbatim.
    if (_containsArabic(text)) {
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
    if (!isArabic && _looksLikeSentence(body)) {
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
      case 500:
      case 502:
      case 503:
      case 504:
        return AppErrorReason.server;
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
    RegExp(r'must be a (string|number|boolean|uuid|date|valid)', caseSensitive: false),
    RegExp(r'must not be', caseSensitive: false),
    RegExp(r'must contain', caseSensitive: false),
    RegExp(r'is not a valid', caseSensitive: false),
    RegExp(r'invalid base64', caseSensitive: false),
    RegExp(r'\b(prisma|sql|postgres|query engine)\b', caseSensitive: false),
    RegExp(r'\bstack\b|traceback|at Object\.|at Function\.'),
    RegExp(r'\b(TypeError|ReferenceError|SyntaxError|UnhandledPromiseRejection)\b'),
    RegExp(r'\b(undefined|null|NaN|ECONNREFUSED|ETIMEDOUT|ENOTFOUND)\b'),
    RegExp(r'cannot read propert', caseSensitive: false),
    RegExp(r'\bdto\b|\bpayload\b|class-validator', caseSensitive: false),
    RegExp(r'\b(json|base64|hex digest|sha-256|encoding)\b', caseSensitive: false),
    RegExp(r'column "|table "|row \d', caseSensitive: false),
    RegExp(r'no such (column|table)', caseSensitive: false),
  ];

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
    'The account does not exist in this company': 'هذا الحساب غير موجود في هذه الشركة.',
    'The ledger account does not exist': 'حساب الأستاذ غير موجود.',
    'One or more accounts do not exist': 'حساب واحد أو أكثر غير موجود.',
    'An account cannot be its own parent': 'لا يمكن أن يكون الحساب تابعًا لنفسه.',
    'No free code left under this parent': 'لا يوجد كود متاح تحت هذا الحساب الأب.',
    'Deactivate active subaccounts before deactivating their parent':
        'عطّل الحسابات الفرعية النشطة أولاً قبل تعطيل الحساب الأب.',
    'This account already has journal movements. Its code cannot be changed — deactivate it and create a new account instead.':
        'لهذا الحساب قيود محاسبية مسجّلة، لذلك لا يمكن تغيير كوده. عطّله وأنشئ حسابًا جديدًا بدلاً منه.',
    'This account has sub-accounts, so it is a grouping account and cannot receive postings. Remove the sub-accounts first.':
        'هذا الحساب له حسابات فرعية، لذلك هو حساب تجميعي ولا يمكن الترحيل عليه. احذف الحسابات الفرعية أولاً.',
    'A grouping account cannot receive postings':
        'لا يمكن الترحيل على حساب تجميعي.',
    'This account has journal movements and cannot be deleted. Deactivate it instead so the past stays readable.':
        'لهذا الحساب قيود محاسبية مسجّلة ولا يمكن حذفه. عطّله بدلاً من ذلك حتى يبقى السجل التاريخي مقروءًا.',
    'This account has sub-accounts. Move or delete them first, or deactivate this account.':
        'لهذا الحساب حسابات فرعية. انقلها أو احذفها أولاً، أو عطّل هذا الحساب.',

    // --- journal / posting -------------------------------------------------
    'Journal entry is not balanced': 'القيد غير متوازن: مجموع المدين لا يساوي مجموع الدائن.',
    'Journal entry not found': 'لم يتم العثور على القيد.',
    'Only posted entries can be reversed': 'لا يمكن عكس قيد إلا بعد ترحيله.',
    'Only a posted journal entry can be reversed': 'لا يمكن عكس قيد إلا بعد ترحيله.',
    'This journal entry has already been reversed': 'تم عكس هذا القيد من قبل.',
    'This entry has already been reversed': 'تم عكس هذا القيد من قبل.',
    'The original journal entry has already been reversed': 'تم عكس القيد الأصلي من قبل.',
    'The original journal entry is missing': 'القيد الأصلي غير موجود.',
    'The journal entry to reverse was not found': 'لم يتم العثور على القيد المطلوب عكسه.',
    'Posting amounts cannot be negative': 'لا يمكن أن تكون مبالغ الترحيل سالبة.',
    'Amounts cannot be negative': 'لا يمكن أن تكون المبالغ سالبة.',
    'Allocation amounts must be greater than zero': 'يجب أن تكون مبالغ التوزيع أكبر من صفر.',
    'Every allocation needs a cost center': 'كل توزيع يحتاج إلى مركز تكلفة.',
    'An allocation amount is not a number': 'مبلغ التوزيع ليس رقمًا صالحًا.',
    'A cost center cannot be its own parent': 'لا يمكن أن يكون مركز التكلفة تابعًا لنفسه.',
    'Cost center not found': 'لم يتم العثور على مركز التكلفة.',
    'The cost center does not exist': 'مركز التكلفة غير موجود.',
    'The parent cost center does not exist': 'مركز التكلفة الأب غير موجود.',
    'A closed period cannot be changed': 'لا يمكن التعديل في فترة محاسبية مغلقة.',
    'This period is already closed': 'هذه الفترة مغلقة بالفعل.',
    'A period with that code already exists': 'توجد فترة محاسبية بهذا الكود بالفعل.',
    'Fiscal period not found': 'لم يتم العثور على الفترة المحاسبية.',
    'The end date must be after the start date': 'يجب أن يكون تاريخ النهاية بعد تاريخ البداية.',
    'endDate cannot be before startDate': 'لا يمكن أن يكون تاريخ النهاية قبل تاريخ البداية.',
    'periodEnd must not be before periodStart': 'لا يمكن أن تكون نهاية الفترة قبل بدايتها.',
    'periodTo must not be before periodFrom': 'لا يمكن أن تكون نهاية الفترة قبل بدايتها.',
    'to must not be before from': 'لا يمكن أن يكون "إلى" قبل "من".',
    'The end date cannot be before the start date': 'لا يمكن أن يكون تاريخ النهاية قبل تاريخ البداية.',
    'A period cannot overlap another period': 'لا يمكن أن تتداخل الفترات المحاسبية.',
    'Opening balance document not found': 'لم يتم العثور على مستند الأرصدة الافتتاحية.',
    'An opening balance needs at least two lines': 'يحتاج مستند الأرصدة الافتتاحية إلى سطرين على الأقل.',
    'Only a posted opening balance can be reversed': 'لا يمكن عكس أرصدة افتتاحية إلا بعد ترحيلها.',
    'Select the branch these opening figures belong to': 'اختر الفرع الذي تنتمي إليه هذه الأرصدة.',
    'Budget not found': 'لم يتم العثور على الموازنة.',
    'A retired budget cannot be edited': 'لا يمكن تعديل موازنة مُلغاة.',

    // --- invoices ----------------------------------------------------------
    'Sales invoice not found': 'لم يتم العثور على فاتورة البيع.',
    'Purchase invoice not found': 'لم يتم العثور على فاتورة الشراء.',
    'Return document not found': 'لم يتم العثور على مستند المرتجع.',
    'Only a draft sales invoice can be edited': 'لا يمكن تعديل فاتورة بيع إلا وهي مسودة.',
    'Only a draft purchase invoice can be edited': 'لا يمكن تعديل فاتورة شراء إلا وهي مسودة.',
    'Only a posted sales invoice can be returned': 'لا يمكن إرجاع فاتورة بيع إلا بعد ترحيلها.',
    'Only a posted purchase invoice can be returned': 'لا يمكن إرجاع فاتورة شراء إلا بعد ترحيلها.',
    'Only posted invoices can be reversed': 'لا يمكن عكس فاتورة إلا بعد ترحيلها.',
    'This invoice has already been reversed': 'تم عكس هذه الفاتورة من قبل.',
    'This invoice has no journal entry to reverse': 'لا يوجد قيد مرتبط بهذه الفاتورة لعكسه.',
    'The original sales invoice does not exist': 'فاتورة البيع الأصلية غير موجودة.',
    'The original purchase invoice does not exist': 'فاتورة الشراء الأصلية غير موجودة.',
    'The original invoice line could not be found': 'لم يتم العثور على سطر الفاتورة الأصلي.',
    'The return date cannot be before the invoice date':
        'لا يمكن أن يكون تاريخ المرتجع قبل تاريخ الفاتورة.',
    'A return needs at least one line': 'يحتاج المرتجع إلى سطر واحد على الأقل.',
    'A return must name the invoice it returns': 'يجب تحديد الفاتورة التي يعود إليها المرتجع.',
    'A return document cannot itself be returned': 'لا يمكن إرجاع مستند مرتجع.',
    'A return must be recorded in the branch that issued the original invoice':
        'يجب تسجيل المرتجع في نفس الفرع الذي صدرت منه الفاتورة الأصلية.',
    'Return documents cannot be edited as sales invoices': 'لا يمكن تعديل المرتجعات كفواتير بيع.',
    'Return documents cannot be edited as purchase invoices': 'لا يمكن تعديل المرتجعات كفواتير شراء.',
    'One sales-return item is no longer tracked in stock': 'أحد أصناف المرتجع لم يعد متتبعاً في المخزون.',
    'A sales-return item is no longer tracked in stock': 'أحد أصناف المرتجع لم يعد متتبعاً في المخزون.',
    'A purchase-return item is no longer tracked in stock': 'أحد أصناف مرتجع الشراء لم يعد متتبعاً في المخزون.',
    'Discount amount cannot exceed the invoice subtotal': 'لا يمكن أن يتجاوز الخصم إجمالي الفاتورة.',
    'discountAmount cannot exceed the invoice subtotal': 'لا يمكن أن يتجاوز الخصم إجمالي الفاتورة.',
    'Choose either a percentage discount or a fixed discount, not both':
        'اختر خصمًا بنسبة أو خصمًا بمبلغ ثابت، وليس الاثنين معًا.',
    'A percentage discount requires a non-zero subtotal':
        'الخصم بالنسبة يحتاج إلى إجمالي أكبر من صفر.',
    'discountPercent must be between 0 and 100': 'يجب أن تكون نسبة الخصم بين 0 و100.',
    'Insufficient balance': 'الرصيد غير كافٍ لإتمام العملية.',
    'Insufficient stock': 'الكمية المتاحة في المخزون غير كافية.',
    'The document has already been posted': 'تم ترحيل المستند بالفعل.',

    // --- quotations / orders ----------------------------------------------
    'Quotation not found': 'لم يتم العثور على عرض السعر.',
    'Sales order not found': 'لم يتم العثور على أمر البيع.',
    'Purchase order not found': 'لم يتم العثور على أمر الشراء.',
    'Only a draft quotation can be edited': 'لا يمكن تعديل عرض السعر إلا وهو مسودة.',
    'Only a draft quotation can be issued': 'لا يمكن إصدار عرض السعر إلا وهو مسودة.',
    'A converted quotation can no longer change status': 'عرض السعر المحوّل إلى فاتورة لا يمكنه تغيير حالته.',
    'This quotation has already been converted to an invoice': 'تم تحويل عرض السعر إلى فاتورة بالفعل.',
    'This quotation has no lines to convert': 'عرض السعر لا يحتوي على سطور لتحويلها.',
    'This quotation changed while the decision was being saved':
        'تم تعديل عرض السعر أثناء حفظ القرار. أعد تحميل الصفحة وحاول مرة أخرى.',
    'This quotation was converted by someone else a moment ago':
        'تم تحويل عرض السعر من مستخدم آخر للحظات. أعد تحميل الصفحة.',
    'A cancelled order cannot be invoiced': 'لا يمكن إصدار فاتورة لأمر بيع ملغى.',
    'Approve the order before invoicing it': 'اعتمد أمر البيع قبل إصدار الفاتورة.',
    'This order is already cancelled': 'أمر البيع ملغى بالفعل.',
    'This order is fully invoiced; nothing is outstanding':
        'أمر البيع مفوتر بالكامل ولا يوجد متبقٍ للفوترة.',
    'This order was approved by someone else a moment ago':
        'تم اعتماد أمر البيع من مستخدم آخر للحظات. أعد تحميل الصفحة.',
    'An order needs at least one line': 'يحتاج أمر البيع إلى سطر واحد على الأقل.',
    'Keep at least one column visible': 'أبقِ عمودًا واحدًا ظاهرًا على الأقل.',
    'Every quotation column needs a key': 'كل عمود في عرض السعر يحتاج إلى مفتاح.',
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
    'Choose the cash account the money moved through': 'اختر الحساب النقدي الذي مرّت منه الحركة.',
    'Only a posted voucher can be reversed': 'لا يمكن عكس سند إلا بعد ترحيله.',
    'A transfer needs two different accounts': 'يحتاج التحويل إلى حسابين مختلفين.',
    'A transfer needs two different warehouses': 'يحتاج التحويل إلى مخزنين مختلفين.',
    'A transfer needs the branch the stock leaves': 'يجب تحديد الفرع الذي يخرج منه المخزون.',
    'A voucher is against a customer or a supplier, not both':
        'السند يكون على عميل أو مورد، وليس الاثنين معًا.',
    'One or more vouchers do not exist in this company': 'سند واحد أو أكثر غير موجود في هذه الشركة.',
    'The counter account does not exist': 'الحساب المقابل غير موجود.',
    'A reconciliation is already posted for this period': 'تم ترحيل تسوية لهذه الفترة بالفعل.',
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
    'Only a posted stock document can be reversed': 'لا يمكن عكس مستند مخزون إلا بعد ترحيله.',
    'Only a posted transfer can be reversed': 'لا يمكن عكس تحويل إلا بعد ترحيله.',
    'Transfer not found': 'لم يتم العثور على التحويل.',
    'A stock document needs at least one line': 'يحتاج مستند المخزون إلى سطر واحد على الأقل.',
    'A unit cannot be its own parent': 'لا يمكن أن تكون الوحدة تابعة لنفسها.',
    'Opening quantity must be greater than zero': 'يجب أن تكون الكمية الافتتاحية أكبر من صفر.',

    // --- parties ------------------------------------------------------------
    'The customer does not exist': 'العميل غير موجود.',
    'The customer does not exist in this company': 'العميل غير موجود في هذه الشركة.',
    'The customer is inactive': 'هذا العميل غير نشط.',
    'The supplier does not exist': 'المورد غير موجود.',
    'The supplier does not exist in this company': 'المورد غير موجود في هذه الشركة.',
    'The supplier is inactive': 'هذا المورد غير نشط.',
    'The warehouse does not exist in this company': 'المخزن غير موجود في هذه الشركة.',
    'The branch does not exist in this company': 'الفرع غير موجود في هذه الشركة.',
    'One of the branches does not exist in this company': 'أحد الفروع غير موجود في هذه الشركة.',
    'The company does not exist': 'الشركة غير موجودة.',
    'Company not found': 'لم يتم العثور على الشركة.',
    'Branch not found': 'لم يتم العثور على الفرع.',
    'User not found': 'لم يتم العثور على المستخدم.',
    'Role not found': 'لم يتم العثور على الدور.',
    'A role with that code already exists': 'يوجد دور بهذا الكود بالفعل.',
    'A system role cannot be removed': 'لا يمكن حذف دور نظامي.',
    'A system role cannot be renamed': 'لا يمكن إعادة تسمية دور نظامي.',
    'One of the roles does not exist in this company': 'أحد الأدوار غير موجود في هذه الشركة.',
    'One of the permissions no longer exists': 'إحدى الصلاحيات لم تعد موجودة.',
    'The system administrator cannot be deactivated': 'لا يمكن تعطيل حساب مسؤول النظام.',
    'You cannot deactivate your own account': 'لا يمكنك تعطيل حسابك الخاص.',
    'That username is already taken': 'اسم المستخدم مستخدم بالفعل.',
    'That username is reserved': 'اسم المستخدم محجوز.',
    'Invalid username or password': 'اسم المستخدم أو كلمة المرور غير صحيحة.',
    'Invalid or expired token': 'انتهت صلاحية الجلسة. سجّل الدخول مرة أخرى.',
    'Invalid or expired refresh token': 'انتهت صلاحية الجلسة. سجّل الدخول مرة أخرى.',
    'Missing bearer token': 'انتهت صلاحية الجلسة. سجّل الدخول مرة أخرى.',
    'The signed-in user is not assigned to a branch': 'المستخدم الحالي غير مرتبط بأي فرع.',
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
    'The currency must be a three-letter code': 'يجب أن يكون رمز العملة من ثلاثة أحرف.',
    'Invalid setting value': 'قيمة الإعداد غير صالحة.',

    // --- documents, line by line -------------------------------------------
    'A sales invoice item no longer exists': 'أحد أصناف فاتورة البيع لم يعد موجودًا.',
    'A sales-return item no longer exists': 'أحد أصناف مرتجع البيع لم يعد موجودًا.',
    'A draft can only be edited from its assigned branch':
        'لا يمكن تعديل المسودة إلا من الفرع المسند إليها.',
    'A purchase invoice may contain at most 50 landed-cost charges':
        'لا يمكن أن تحتوي فاتورة الشراء على أكثر من ٥٠ بند تكلفة استيراد.',
    'A draft is edited directly; revision is for issued quotations':
        'المسودة تُعدّل مباشرة، والمراجعة تكون لعروض الأسعار الصادرة.',
    'A column key cannot contain control characters':
        'مفتاح العمود لا يمكن أن يحتوي على رموز تحكم.',
    'A ticket is required for this address': 'هذا العنوان يحتاج إلى تصريح وصول.',
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
    'code, nameEn and nameAr are required': 'الكود والاسم الإنجليزي والاسم العربي مطلوبة.',
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
    _BusinessRule(_ci(r'^Account (\S+) is inactive$'), (m) =>
        'الحساب ${m.group(1)} غير نشط.'),
    _BusinessRule(_ci(r'^Account (\S+) cannot receive postings$'), (m) =>
        'الحساب ${m.group(1)} لا يمكن الترحيل عليه.'),
    _BusinessRule(_ci(r'^Account (\S+) is a grouping account$'), (m) =>
        'الحساب ${m.group(1)} حساب تجميعي ولا يمكن الترحيل عليه.'),
    _BusinessRule(_ci(r'^Account (\S+) does not exist$'), (m) =>
        'الحساب ${m.group(1)} غير موجود.'),
    _BusinessRule(_ci(r'^Account (\S+) is (?:already )?used'),
        (m) => 'الحساب ${m.group(1)} مستخدم بالفعل.'),
    _BusinessRule(_ci(r'^Account (\S+) cannot be deleted'), (m) =>
        'لا يمكن حذف الحساب ${m.group(1)}.'),
    _BusinessRule(_ci(r'^(.+) code (\S+) is already used$'), (m) {
      final noun = _nounOrNull(m.group(1));
      return noun == null ? null : 'كود $noun رقم ${m.group(2)} مستخدم بالفعل.';
    }),
    _BusinessRule(_ci(r'^The code "(\S+)" is already used by another account in this company$'),
        (m) => 'الكود ${m.group(1)} مستخدم بالفعل في حساب آخر بهذه الشركة.'),
    _BusinessRule(_ci(r'^Cash account code (\S+) is already used$'), (m) =>
        'كود الحساب النقدي رقم ${m.group(1)} مستخدم بالفعل.'),
    _BusinessRule(_ci(r'^(.+) code (\S+) does not exist$'), (m) {
      final noun = _nounOrNull(m.group(1));
      return noun == null ? null : '$noun رقم ${m.group(2)} غير موجود.';
    }),
    _BusinessRule(_ci(r'^(.+?) (\S+) is inactive$'), (m) {
      final noun = _nounOrNull(m.group(1));
      return noun == null ? null : '$noun ${m.group(2)} غير نشط.';
    }),
    _BusinessRule(_ci(r'^Missing permission: (.+)$'), (m) =>
        'ليس لديك صلاحية «${m.group(1)}». راجع مسؤول النظام.'),
    _BusinessRule(_ci(r'^(The )?(\w+) does not exist$'), (m) {
      final noun = m.group(2) ?? '';
      final translated = _nounsAr[noun.toLowerCase()];
      return translated == null ? null : '$translated غير موجود.';
    }),
    _BusinessRule(_ci(r'^(\w+) not found$'), (m) {
      final translated = _nounsAr[m.group(1)!.toLowerCase()];
      return translated == null ? null : 'لم يتم العثور على ${translated}.';
    }),
    // Validation-shaped: "amount is required" / "amount cannot be negative".
    _BusinessRule(_ci(r'^(\w+) is required$'), (m) =>
        'الحقل «${_fieldAr(m.group(1))}» مطلوب.'),
    _BusinessRule(_ci(r'^(\w+) cannot be negative$'), (m) =>
        'لا يمكن أن يكون «${_fieldAr(m.group(1))}» سالبًا.'),
    _BusinessRule(_ci(r'^(\w+) must be greater than zero$'), (m) =>
        'يجب أن يكون «${_fieldAr(m.group(1))}» أكبر من صفر.'),
    _BusinessRule(_ci(r'^(\w+) is not a valid (number|amount|date|percentage)$'),
        (m) => 'قيمة «${_fieldAr(m.group(1))}» غير صالحة.'),
    _BusinessRule(_ci(r'^(\w+) must be a valid (date|number|amount)$'), (m) =>
        'قيمة «${_fieldAr(m.group(1))}» غير صالحة.'),
    _BusinessRule(_ci(r'^(\w+) must be (?:a )?text$'), (m) =>
        'يجب أن يكون «${_fieldAr(m.group(1))}» نصًا.'),
    _BusinessRule(_ci(r'^(\w+) must be true or false$'), (m) =>
        'قيمة «${_fieldAr(m.group(1))}» يجب أن تكون نعم أو لا.'),
    _BusinessRule(_ci(r'^(\w+) must be a UUID$'), (m) =>
        'قيمة «${_fieldAr(m.group(1))}» غير صالحة.'),
    _BusinessRule(_ci(r'^(\w+) must be between (\d+) and (\d+)$'), (m) =>
        'يجب أن تكون قيمة «${_fieldAr(m.group(1))}» بين ${m.group(2)} و${m.group(3)}.'),
    _BusinessRule(_ci(r'^(\w+) must be a whole number between (\d+) and (\d+)$'),
        (m) => 'يجب أن تكون قيمة «${_fieldAr(m.group(1))}» عددًا صحيحًا بين '
            '${m.group(2)} و${m.group(3)}.'),
    _BusinessRule(_ci(r'^(\w+) cannot be longer than (\d+) characters$'), (m) =>
        'لا يمكن أن يزيد «${_fieldAr(m.group(1))}» عن ${m.group(2)} حرفًا.'),
    _BusinessRule(_ci(r'^(\w+) cannot exceed (\d+)$'), (m) =>
        'لا يمكن أن يزيد «${_fieldAr(m.group(1))}» عن ${m.group(2)}.'),
    _BusinessRule(_ci(r'^"?from"? must not be after "?to"?$'), (_) =>
        'لا يمكن أن يكون تاريخ البداية بعد تاريخ النهاية.'),
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
        _ci(r'^The server would not send the file \(HTTP \d+\)\.$'), (_) =>
        'رفض الخادم إرسال الملف. تحقق من صلاحياتك ثم حاول مرة أخرى.'),
    // "Only a draft (order|quotation|invoice) can be (edited|issued|...)"
    _BusinessRule(
        _ci(r'^Only a (draft|posted) (\w+) can be (edited|issued|approved|reversed|posted|returned)$'),
        (m) {
      final noun = _nounOrNull(m.group(2));
      if (noun == null) return null;
      final state = m.group(1)!.toLowerCase() == 'draft' ? 'مسودة' : 'بعد ترحيله';
      final action = _actionsAr[m.group(3)!.toLowerCase()];
      if (action == null) return null;
      return 'لا يمكن $action $noun إلا وهو $state.';
    }),
    _BusinessRule(
        _ci(r'^Only a draft (\w+) can be approved \(it is \w+\)$'), (m) {
      final noun = _nounOrNull(m.group(1));
      return noun == null ? null : 'لا يمكن اعتماد $noun إلا وهو مسودة.';
    }),
    _BusinessRule(_ci(r'^(?:Line \\d+: )?item (\\S+) is not stock-tracked$'), (m) =>
        'الصنف ${m.group(1)} غير متتبع في المخزون.'),

    // ---- the same sentences the import, returns and validation paths write --
    // A date is a date: these arrive from the DTO when a date field is typed
    // wrongly, and the field name is the only useful part of the sentence.
    _BusinessRule(_ci(r'^"(\w+)" must be an ISO date or timestamp$'), (m) =>
        'يجب أن يكون «${_fieldAr(m.group(1))}» تاريخًا صالحًا.'),
    _BusinessRule(_ci(r'^(\w+) is not a (?:real )?date$'), (m) =>
        'قيمة «${_fieldAr(m.group(1))}» ليست تاريخًا صالحًا.'),
    _BusinessRule(_ci(r'^(\w+) cannot exceed (\d+) characters$'), (m) =>
        'لا يمكن أن يزيد «${_fieldAr(m.group(1))}» عن ${m.group(2)} حرفًا.'),
    _BusinessRule(
        _ci(r'^(\w+) must be a whole number of days between (\d+) and (\d+)$'),
        (m) => 'يجب أن يكون «${_fieldAr(m.group(1))}» عددًا صحيحًا من الأيام '
            'بين ${m.group(2)} و${m.group(3)}.'),
    _BusinessRule(_ci(r'^currency must be a three-letter code$'), (_) =>
        'العملة يجب أن تكون رمزًا من ثلاثة أحرف، مثل EGP.'),

    // Enumerations are identifiers, not words: say what is wrong and point at
    // the list again rather than printing "RECEIPT, PAYMENT" at a cashier.
    _BusinessRule(_ci(r'^kind must be RECEIPT or PAYMENT$'), (_) =>
        'نوع السند يجب أن يكون قبضًا أو صرفًا.'),
    _BusinessRule(_ci(r'^kind must be CASH or BANK$'), (_) =>
        'نوع الحساب يجب أن يكون نقدية أو حسابًا بنكيًا.'),
    _BusinessRule(_ci(r'^kind must be CUSTOMER or SUPPLIER$'), (_) =>
        'النوع يجب أن يكون عميلًا أو موردًا.'),
    _BusinessRule(_ci(r'^kind must be sales or purchases$'), (_) =>
        'النوع يجب أن يكون مبيعات أو مشتريات.'),
    _BusinessRule(_ci(r'^(?:kind|status|type) must be [A-Za-z, ]+$'), (_) =>
        'القيمة المحددة غير صالحة. اختر واحدة من القائمة المتاحة.'),
    _BusinessRule(
        _ci(r'^Unknown (?:voucher |stock document )?(?:kind|status)(?::| ")'),
        (_) => 'القيمة المحددة غير معروفة. أعد تحميل الصفحة واختر من القائمة.'),

    // A document line: the number is what the person needs to find the row.
    _BusinessRule(_ci(r'^Line (\d+) cannot be both a debit and a credit$'), (m) =>
        'السطر ${m.group(1)} لا يمكن أن يكون مدينًا ودائنًا في الوقت نفسه.'),
    _BusinessRule(_ci(r'^Line (\d+) needs either a debit or a credit$'), (m) =>
        'السطر ${m.group(1)} يحتاج إلى مبلغ مدين أو دائن.'),
    // "Line 3: ..." is already split into an Arabic prefix plus a body, so a
    // colon after the number never reaches these rules.
    _BusinessRule(_ci(r'^a quantity is required$'), (_) => 'الكمية مطلوبة.'),
    _BusinessRule(
        _ci(r'^a stock item needs a quantity greater than zero$'),
        (_) => 'الصنف المخزني يحتاج كمية أكبر من صفر.'),
    _BusinessRule(_ci(r'^the unit cost cannot be negative$'), (_) =>
        'تكلفة الوحدة لا يمكن أن تكون سالبة.'),
    _BusinessRule(
        _ci(r'^an invoice line may appear only once in a return$'),
        (_) => 'سطر الفاتورة لا يتكرر في المرتجع.'),
    _BusinessRule(_ci(r'^that line does not belong to the invoice$'), (_) =>
        'هذا السطر لا ينتمي إلى الفاتورة.'),
    _BusinessRule(
        _ci(r'^allocated inventory cost is below the returned invoice value$'),
        (_) => 'تكلفة المخزون المخصصة أقل من قيمة الفاتورة المرتجعة.'),
    _BusinessRule(_ci(r'^(\w+) exceeds the original line$'), (m) =>
        'الكمية في «${_fieldAr(m.group(1))}» تتجاوز الكمية الأصلية في الفاتورة.'),
    _BusinessRule(_ci(r'^(\w+) has an invalid negative amount$'), (m) =>
        'قيمة «${_fieldAr(m.group(1))}» سالبة وغير صالحة.'),
    _BusinessRule(_ci(r'^(\w+) is already fully returned or inconsistent$'), (m) =>
        'السطر في «${_fieldAr(m.group(1))}» مُرتجَع بالكامل بالفعل، أو أن بياناته غير متسقة.'),

    // A return only travels on the note that matches its direction.
    _BusinessRule(
        _ci(r'^Only a (sales credit note|purchase debit note) can be (posted|reversed) as a (?:sales|purchase) return\.?$'),
        (m) {
      final isCredit = m.group(1)!.toLowerCase() == 'sales credit note';
      final note = isCredit ? 'إشعار دائن مبيعات' : 'إشعار مدين مشتريات';
      final action = m.group(2)!.toLowerCase() == 'posted' ? 'ترحيل' : 'عكس';
      return 'لا يمكن $action المرتجع إلا من خلال $note.';
    }),
    _BusinessRule(
        _ci(r'^The source (?:sales|purchase) invoice is no longer posted; this return cannot be (posted|reversed)\.?$'),
        (m) => 'لم تعد فاتورة المصدر مُرحَّلة، لذلك لا يمكن '
            '${m.group(1)!.toLowerCase() == 'posted' ? 'ترحيل' : 'عكس'} المرتجع.'),

    // Quotation editor and cash documents.
    _BusinessRule(_ci(r'^Quotation: (?:the )?(\w+) (does not exist|is inactive)$'),
        (m) {
      final noun = _nounsAr[m.group(1)!.toLowerCase()] ?? m.group(1);
      return m.group(2)!.toLowerCase() == 'is inactive'
          ? 'العرض: $noun غير نشط.'
          : 'العرض: $noun غير موجود.';
    }),
    _BusinessRule(_ci(r'^Quotation: give either an item or a description$'), (_) =>
        'أدخل صنفًا أو وصفًا للسطر قبل الحفظ.'),
    _BusinessRule(_ci(r'^Table (\d+): give the table a title$'), (m) =>
        'الجدول ${m.group(1)}: أدخل عنوانًا للجدول.'),
    _BusinessRule(
        _ci(r'^The (\S+) cash account (does not exist|is inactive|is required)$'),
        (m) {
      final what = m.group(2)!.toLowerCase();
      final reasons = <String, String>{
        'does not exist': 'غير موجود',
        'is inactive': 'غير نشط',
        'is required': 'مطلوب',
      };
      return 'الحساب النقدي ${m.group(1)} ${reasons[what] ?? 'غير صالح'}.';
    }),
    _BusinessRule(
        _ci(r'^This company has no active branch to post the closing entry to$'),
        (_) => 'لا يوجد فرع نشط لترحيل قيد الإقفال. افتح فرعًا أولًا.'),
    _BusinessRule(_ci(r'^Order line (\d+) does not belong to this order$'), (m) =>
        'سطر الأمر ${m.group(1)} لا ينتمي إلى هذا الأمر.'),

    // Backup files: the operator needs to know which file, not why it failed.
    _BusinessRule(_ci(r'^The backup file is (empty|larger than .+?)\.?$'), (m) =>
        m.group(1)!.toLowerCase() == 'empty'
            ? 'ملف النسخة الاحتياطية فارغ.'
            : 'ملف النسخة الاحتياطية أكبر من الحد المسموح به.'),
    _BusinessRule(_ci(r'^The backup file has no tables in it\.?$'), (_) =>
        'ملف النسخة الاحتياطية لا يحتوي على جداول. تأكد أنه ملف نسخة صحيح.'),
    _BusinessRule(_ci(r'^That file is outside the backup folder\.?$'), (_) =>
        'هذا الملف خارج مجلد النسخ الاحتياطية، ولا يمكن قراءته.'),
    _BusinessRule(_ci(r'^No backup file named "(.+)" on this server\.?$'), (m) =>
        'لا توجد نسخة احتياطية باسم «${m.group(1)}» على الخادم.'),
  ];

  /// A pattern that ignores capitalisation: the API writes "The item does
  /// not exist" at the start of a sentence and "the item does not exist"
  /// after a "Line 3:" prefix.
  static RegExp _ci(String source) => RegExp(source, caseSensitive: false);

  /// The Arabic noun, or null when this dictionary has never heard of it.
  static String? _nounOrNull(String? raw) =>
      _nounsAr[(raw ?? '').trim().toLowerCase()];

  static String _fieldAr(String? raw) {
    final key = (raw ?? '').trim().toLowerCase();
    return _fieldsAr[key] ?? (raw ?? '').trim();
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
