import '../../../core/json/json_utils.dart';
import '../../../shared/widgets/form_sheet.dart';

/// The customer card's payment terms: twelve ways to count the days, a free
/// number of days for all of them, and the extra settings each way needs.
///
/// The form shows flat fields (keys starting `cfg_`); the server stores one
/// settings object. [termDraftToBody] and [termInitialFrom] convert between the
/// two, and are plain functions so they can be tested without a screen.

const termMethodCodes = <String>[
  'FROM_INVOICE_DATE',
  'FROM_MONTH_END',
  'FROM_NEXT_MONTH_START',
  'FROM_DELIVERY_DATE',
  'FIXED_DAY_NEXT_MONTH',
  'EARLY_DISCOUNT',
  'COD_ADVANCE',
  'INSTALLMENTS',
  'MILESTONES',
  'DAY_WINDOWS',
  'WEEKLY_CUTOFF',
  'LATE_PENALTY',
];

/// The heading printed above the first method of each group in the dropdown.
const _methodGroupHeadings = <String, List<String>>{
  'FROM_INVOICE_DATE': ['مدة سداد بعد الفاتورة', 'Pay a number of days after the invoice'],
  'COD_ADVANCE': ['الدفع عند الاستلام أو على دفعات', 'Cash on delivery, or paid in parts'],
  'DAY_WINDOWS': ['مواعيد ثابتة وغرامات', 'Fixed dates and penalties'],
};

const _methodLabels = <String, List<String>>{
  'FROM_INVOICE_DATE': ['من تاريخ الفاتورة', 'From the invoice date'],
  'FROM_MONTH_END': ['من نهاية شهر الفاتورة', 'From the end of the invoice month'],
  'FROM_NEXT_MONTH_START': ['من أول الشهر التالي', 'From the start of next month'],
  'FROM_DELIVERY_DATE': ['من تاريخ التسليم أو الاستلام', 'From the delivery or receipt date'],
  'FIXED_DAY_NEXT_MONTH': ['يوم ثابت من الشهر التالي', 'Fixed day of next month'],
  'EARLY_DISCOUNT': ['خصم السداد المبكر (مثل 2/10 صافي 30)', 'Early-payment discount (e.g. 2/10 net 30)'],
  'COD_ADVANCE': ['دفع عند الاستلام أو مقدمًا', 'Cash on delivery or in advance'],
  'INSTALLMENTS': ['أقساط بنسب (مقدم + باقي)', 'Percentage installments (advance + balance)'],
  'DAY_WINDOWS': ['نوافذ أيام الشهر', 'Day-of-month windows'],
  'MILESTONES': ['دفعات حسب المراحل', 'Milestone (stage) payments'],
  'LATE_PENALTY': ['غرامة تأخير السداد', 'Late-payment penalty'],
  'WEEKLY_CUTOFF': ['إقفال أسبوعي', 'Weekly cutoff'],
};

String termMethodLabel(String code, {required bool isArabic}) {
  final pair = _methodLabels[code];
  if (pair == null) return code;
  return isArabic ? pair[0] : pair[1];
}

/// Outcome of reading a multi-line setting: either the value or the reason.
class TermParse<T> {
  const TermParse.ok(this.value) : error = null;
  const TermParse.fail(this.error) : value = null;
  final T? value;
  final String? error;
}

String _say(bool isArabic, String ar, String en) => isArabic ? ar : en;

List<String> _lines(String text) => text
    .split(RegExp(r'[\r\n;]+'))
    .map((l) => l.trim())
    .where((l) => l.isNotEmpty)
    .toList();

num? _number(String s) => num.tryParse(s.trim());

/// One line per share: `percent, days` (installments) or
/// `percent, days, name` (milestones).
TermParse<List<Json>> parseShares(String text, {required bool named, required bool isArabic}) {
  final out = <Json>[];
  var total = 0.0;
  for (final line in _lines(text)) {
    final parts = line.split(RegExp(r'[,،]')).map((p) => p.trim()).toList();
    final percent = parts.isNotEmpty ? _number(parts[0].replaceAll('%', '')) : null;
    final days = parts.length > 1 ? int.tryParse(parts[1]) : null;
    if (percent == null || percent <= 0 || percent > 100 || days == null || days < 0 || days > 3650) {
      return TermParse.fail(_say(isArabic,
          'السطر "$line" غير صحيح. اكتب النسبة ثم عدد الأيام${named ? ' ثم اسم المرحلة' : ''}، مثل: ${named ? '40, 0, عند الطلب' : '30, 0'}',
          'The line "$line" is not valid. Write the percent, then the days${named ? ', then the stage name' : ''}, for example: ${named ? '40, 0, On order' : '30, 0'}'));
    }
    final share = <String, dynamic>{'percent': percent, 'afterDays': days};
    if (named) {
      final name = parts.length > 2 ? parts.sublist(2).join(', ').trim() : '';
      if (name.isEmpty) {
        return TermParse.fail(_say(isArabic, 'اكتب اسم المرحلة في السطر "$line"', 'Add the stage name to the line "$line"'));
      }
      share['label'] = name;
    }
    total += percent.toDouble();
    out.add(share);
  }
  if (out.length < 2) {
    return TermParse.fail(_say(isArabic, 'اكتب سطرين على الأقل', 'Write at least two lines'));
  }
  if ((total - 100).abs() > 0.0001) {
    return TermParse.fail(_say(isArabic, 'مجموع النسب يجب أن يكون 100 بالضبط', 'The percents must add up to exactly 100'));
  }
  return TermParse.ok(out);
}

/// One line per window: `from-to, payDay, month` where month is 0 (same
/// month) or 1 (next month), e.g. `1-10, 20, 0`.
TermParse<List<Json>> parseWindows(String text, {required bool isArabic}) {
  final out = <Json>[];
  final covered = <int>{};
  for (final line in _lines(text)) {
    final parts = line.split(RegExp(r'[,،]')).map((p) => p.trim()).toList();
    final range = parts.isNotEmpty ? parts[0].split('-') : <String>[];
    final from = range.length == 2 ? int.tryParse(range[0].trim()) : null;
    final to = range.length == 2 ? int.tryParse(range[1].trim()) : null;
    final pay = parts.length > 1 ? int.tryParse(parts[1]) : null;
    final month = parts.length > 2 ? int.tryParse(parts[2]) : null;
    if (from == null || to == null || pay == null || month == null ||
        from < 1 || to > 31 || to < from || pay < 1 || pay > 31 || (month != 0 && month != 1)) {
      return TermParse.fail(_say(isArabic,
          'السطر "$line" غير صحيح. اكتب من-إلى ثم يوم السداد ثم 0 (نفس الشهر) أو 1 (الشهر التالي)، مثل: 1-10, 20, 0',
          'The line "$line" is not valid. Write from-to, the pay day, then 0 (same month) or 1 (next month), for example: 1-10, 20, 0'));
    }
    for (var d = from; d <= to; d++) {
      if (!covered.add(d)) {
        return TermParse.fail(_say(isArabic, 'النوافذ متداخلة عند اليوم $d', 'The windows overlap on day $d'));
      }
    }
    out.add({'fromDay': from, 'toDay': to, 'payDay': pay, 'monthOffset': month});
  }
  if (covered.length != 31) {
    return TermParse.fail(_say(isArabic, 'يجب أن تغطي النوافذ كل أيام الشهر من 1 إلى 31', 'The windows must cover every day of the month, 1 to 31'));
  }
  return TermParse.ok(out);
}

String _sharesText(List<dynamic> shares, {required bool named}) => shares
    .whereType<Map>()
    .map((s) => named
        ? '${_clean(s['percent'])}, ${s['afterDays']}, ${s['label'] ?? ''}'
        : '${_clean(s['percent'])}, ${s['afterDays']}')
    .join('\n');

String _windowsText(List<dynamic> windows) => windows
    .whereType<Map>()
    .map((w) => '${w['fromDay']}-${w['toDay']}, ${w['payDay']}, ${w['monthOffset']}')
    .join('\n');

String _clean(Object? n) {
  if (n is num && n == n.roundToDouble()) return n.toInt().toString();
  return n?.toString() ?? '';
}

Set<String> _only(String code) => {code};

/// The form fields for a customer's payment terms. [isArabic] picks the text.
List<FieldSpec> customerTermFields({required bool isArabic}) {
  String t(String ar, String en) => isArabic ? ar : en;
  const m = 'paymentTermMethod';
  return [
    FieldSpec(
      m,
      t('طريقة احتساب مدة السداد', 'How the payment period is counted'),
      kind: FieldKind.select,
      required: true,
      options: [for (final c in termMethodCodes) FieldOption(
          c,
          termMethodLabel(c, isArabic: isArabic),
          heading: _methodGroupHeadings[c]?[isArabic ? 0 : 1],
        )],
      helper: t('الطريقة الأخيرة المستخدمة تظهر تلقائيًا للعميل الجديد، ويمكنك تغييرها.',
          'The method you used last is offered for the next new customer. You can change it.'),
    ),
    FieldSpec(
      'paymentTermDays',
      t('عدد الأيام', 'Number of days'),
      kind: FieldKind.integer,
      minInteger: 0,
      maxInteger: 3650,
      emptyValue: '0',
      helper: t('يُضاف إلى تاريخ البداية حسب الطريقة. اتركه 0 إن لم تكن هناك مهلة.',
          'Added to the start date the method gives. Leave 0 for no extra days.'),
    ),
    FieldSpec('cfg_dayOfMonth', t('يوم السداد من الشهر التالي (1 إلى 31)', 'Pay day of next month (1 to 31)'),
        kind: FieldKind.integer, required: true, minInteger: 1, maxInteger: 31,
        showWhenField: m, showWhenValues: _only('FIXED_DAY_NEXT_MONTH')),
    FieldSpec('cfg_discountPercent', t('نسبة الخصم عند السداد المبكر %', 'Discount % for early payment'),
        kind: FieldKind.decimal, required: true,
        showWhenField: m, showWhenValues: _only('EARLY_DISCOUNT')),
    FieldSpec('cfg_discountDays', t('أيام الخصم (أقل من عدد الأيام)', 'Days the discount lasts (less than the number of days)'),
        kind: FieldKind.integer, required: true, minInteger: 0, maxInteger: 3650,
        showWhenField: m, showWhenValues: _only('EARLY_DISCOUNT')),
    FieldSpec('cfg_shares', t('الأقساط: سطر لكل قسط، النسبة ثم الأيام', 'Installments: one line each, percent then days'),
        kind: FieldKind.multiline, maxLines: 4, required: true,
        helper: t('مثال: 30, 0 (مقدم 30% اليوم) ثم 70, 45 (الباقي بعد 45 يومًا). المجموع 100.',
            'Example: 30, 0 (30% advance today) then 70, 45 (the rest after 45 days). Total 100.'),
        validator: (v) => parseShares(v, named: false, isArabic: isArabic).error,
        showWhenField: m, showWhenValues: _only('INSTALLMENTS')),
    FieldSpec('cfg_windows', t('النوافذ: من-إلى، يوم السداد، 0 أو 1', 'Windows: from-to, pay day, 0 or 1'),
        kind: FieldKind.multiline, maxLines: 4, required: true,
        helper: t('مثال: 1-10, 20, 0 (فواتير 1 إلى 10 تُسدد يوم 20 من نفس الشهر). يجب تغطية 1 إلى 31.',
            'Example: 1-10, 20, 0 (invoices of days 1 to 10 are paid on the 20th of the same month). Cover 1 to 31.'),
        validator: (v) => parseWindows(v, isArabic: isArabic).error,
        showWhenField: m, showWhenValues: _only('DAY_WINDOWS')),
    FieldSpec('cfg_stages', t('المراحل: النسبة، الأيام، اسم المرحلة', 'Stages: percent, days, stage name'),
        kind: FieldKind.multiline, maxLines: 4, required: true,
        helper: t('مثال: 40, 0, عند الطلب ثم 60, 30, عند التسليم. المجموع 100.',
            'Example: 40, 0, On order then 60, 30, On delivery. Total 100.'),
        validator: (v) => parseShares(v, named: true, isArabic: isArabic).error,
        showWhenField: m, showWhenValues: _only('MILESTONES')),
    FieldSpec('cfg_weekday', t('يوم الإقفال الأسبوعي', 'Weekly cutoff day'),
        kind: FieldKind.select, required: true,
        options: [
          for (var i = 0; i < 7; i++)
            FieldOption('$i', isArabic
                ? const ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][i]
                : const ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]),
        ],
        helper: t('فواتير الأسبوع كلها تستحق بعد عدد الأيام من أول يوم إقفال.',
            'All invoices of a week fall due the number of days after that cutoff day.'),
        showWhenField: m, showWhenValues: _only('WEEKLY_CUTOFF')),
    FieldSpec('cfg_penaltyPercent', t('نسبة الغرامة %', 'Penalty %'),
        kind: FieldKind.decimal, required: true,
        showWhenField: m, showWhenValues: _only('LATE_PENALTY')),
    FieldSpec('cfg_penaltyPeriod', t('تُحتسب عن كل', 'Charged for each'),
        kind: FieldKind.select, required: true,
        options: [FieldOption('DAY', t('يوم تأخير', 'day late')), FieldOption('MONTH', t('شهر تأخير (30 يومًا)', 'month late (30 days)'))],
        showWhenField: m, showWhenValues: _only('LATE_PENALTY')),
    FieldSpec('cfg_penaltyGrace', t('أيام السماح قبل الغرامة', 'Grace days before the penalty'),
        kind: FieldKind.integer, minInteger: 0, maxInteger: 3650, emptyValue: '0',
        showWhenField: m, showWhenValues: _only('LATE_PENALTY')),
  ];
}

/// Starting values for the form: the customer's stored terms, or for a new
/// customer the method the company chose last.
Json termInitialFrom(Json? customer, {String? defaultMethod}) {
  final method = customer?['paymentTermMethod']?.toString() ?? defaultMethod ?? 'FROM_INVOICE_DATE';
  final out = <String, dynamic>{
    'paymentTermMethod': termMethodCodes.contains(method) ? method : 'FROM_INVOICE_DATE',
    'paymentTermDays': customer?['paymentTermDays'] ?? 0,
  };
  final raw = customer?['paymentTermConfig'];
  if (raw is Map) {
    if (raw['dayOfMonth'] != null) out['cfg_dayOfMonth'] = raw['dayOfMonth'];
    if (raw['discountPercent'] != null) out['cfg_discountPercent'] = _clean(raw['discountPercent']);
    if (raw['discountDays'] != null) out['cfg_discountDays'] = raw['discountDays'];
    if (raw['weekday'] != null) out['cfg_weekday'] = raw['weekday'].toString();
    final list = raw['installments'];
    if (list is List) {
      if (method == 'MILESTONES') {
        out['cfg_stages'] = _sharesText(list, named: true);
      } else {
        out['cfg_shares'] = _sharesText(list, named: false);
      }
    }
    final windows = raw['windows'];
    if (windows is List) out['cfg_windows'] = _windowsText(windows);
    final penalty = raw['penalty'];
    if (penalty is Map) {
      out['cfg_penaltyPercent'] = _clean(penalty['percent']);
      out['cfg_penaltyPeriod'] = penalty['period']?.toString();
      out['cfg_penaltyGrace'] = penalty['graceDays'] ?? 0;
    }
  }
  return out;
}

/// Turns what the form returned into what the server expects: the flat
/// `cfg_` values become one `paymentTermConfig` object (or null when the
/// method needs none), and the `cfg_` keys are removed.
Json termDraftToBody(Json draft, {bool isArabic = false}) {
  final body = <String, dynamic>{
    for (final e in draft.entries)
      if (!e.key.startsWith('cfg_')) e.key: e.value,
  };
  final method = draft['paymentTermMethod']?.toString() ?? 'FROM_INVOICE_DATE';
  Map<String, dynamic>? config;
  switch (method) {
    case 'FIXED_DAY_NEXT_MONTH':
      config = {'dayOfMonth': int.tryParse('${draft['cfg_dayOfMonth']}')};
    case 'EARLY_DISCOUNT':
      config = {
        'discountPercent': double.tryParse('${draft['cfg_discountPercent']}'),
        'discountDays': int.tryParse('${draft['cfg_discountDays']}'),
      };
    case 'INSTALLMENTS':
      config = {'installments': parseShares('${draft['cfg_shares'] ?? ''}', named: false, isArabic: isArabic).value};
    case 'MILESTONES':
      config = {'installments': parseShares('${draft['cfg_stages'] ?? ''}', named: true, isArabic: isArabic).value};
    case 'DAY_WINDOWS':
      config = {'windows': parseWindows('${draft['cfg_windows'] ?? ''}', isArabic: isArabic).value};
    case 'WEEKLY_CUTOFF':
      config = {'weekday': int.tryParse('${draft['cfg_weekday']}')};
    case 'LATE_PENALTY':
      config = {
        'penalty': {
          'percent': double.tryParse('${draft['cfg_penaltyPercent']}'),
          'period': draft['cfg_penaltyPeriod'],
          'graceDays': int.tryParse('${draft['cfg_penaltyGrace'] ?? 0}') ?? 0,
        },
      };
    default:
      config = null;
  }
  body['paymentTermConfig'] = config;
  return body;
}
