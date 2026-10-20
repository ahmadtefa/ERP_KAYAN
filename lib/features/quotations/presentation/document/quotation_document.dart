import 'package:flutter/material.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';

/// تنسيق عنصر واحد من عناصر عرض السعر (حجم الخط، سمكه، لونه، محاذاته).
///
/// القيم المخزنة مضاعفات أو أوصاف تُطبّق في المعاينة وPDF والطباعة.
class QuotationDocumentElementStyle {
  const QuotationDocumentElementStyle({
    this.fontSizeMultiplier = 1.0,
    this.fontWeight,
    this.color,
    this.fontFamily,
    this.backgroundColor,
    this.lineHeight,
    this.textAlign,
    this.borderColor,
  });

  /// مضاعف لحجم الخط الأساسي للعنصر (1.0 = الحجم الافتراضي).
  final double fontSizeMultiplier;
  /// سمك الخط (اختياري).
  final FontWeight? fontWeight;
  /// لون النص (اختياري).
  final String? color;
  /// A locally installed font family; no web font download is required.
  final String? fontFamily;
  final String? backgroundColor;
  final double? lineHeight;
  final String? textAlign;
  final String? borderColor;

  /// ينشئ نسخة من هذا النمط مع تعديلات جزئية.
  QuotationDocumentElementStyle copyWith({
    double? fontSizeMultiplier,
    FontWeight? fontWeight,
    String? color,
    String? fontFamily,
    String? backgroundColor,
    double? lineHeight,
    String? textAlign,
    String? borderColor,
  }) {
    return QuotationDocumentElementStyle(
      fontSizeMultiplier: fontSizeMultiplier ?? this.fontSizeMultiplier,
      fontWeight: fontWeight ?? this.fontWeight,
      color: color ?? this.color,
      fontFamily: fontFamily ?? this.fontFamily,
      backgroundColor: backgroundColor ?? this.backgroundColor,
      lineHeight: lineHeight ?? this.lineHeight,
      textAlign: textAlign ?? this.textAlign,
      borderColor: borderColor ?? this.borderColor,
    );
  }
}

/// أنماط جميع عناصر عرض السعر، مخزنة كجزء من القالب أو العرض.
class QuotationDocumentDesign {
  const QuotationDocumentDesign({
    this.title,
    this.company,
    this.customer,
    this.sectionTitle,
    this.tableHeader,
    this.tableCell,
    this.totalsLabel,
    this.totalsValue,
    this.finalTotal,
    this.footer,
    this.header,
    this.headerText,
    this.footerText,
    this.showHeader = true,
    this.showFooter = true,
  });

  final QuotationDocumentElementStyle? title;
  final QuotationDocumentElementStyle? company;
  final QuotationDocumentElementStyle? customer;
  final QuotationDocumentElementStyle? sectionTitle;
  final QuotationDocumentElementStyle? tableHeader;
  final QuotationDocumentElementStyle? tableCell;
  final QuotationDocumentElementStyle? totalsLabel;
  final QuotationDocumentElementStyle? totalsValue;
  final QuotationDocumentElementStyle? finalTotal;
  final QuotationDocumentElementStyle? footer;
  final QuotationDocumentElementStyle? header;
  final String? headerText;
  final String? footerText;
  final bool showHeader;
  final bool showFooter;

  /// الأنماط الافتراضية (بدون تجاوزات).
  static QuotationDocumentDesign defaultDesign() => const QuotationDocumentDesign();

  /// يدمج هذا التصميم مع آخر (القيم في [other] تغلب).
  QuotationDocumentDesign merge(QuotationDocumentDesign other) {
    return QuotationDocumentDesign(
      title: other.title ?? title,
      company: other.company ?? company,
      customer: other.customer ?? customer,
      sectionTitle: other.sectionTitle ?? sectionTitle,
      tableHeader: other.tableHeader ?? tableHeader,
      tableCell: other.tableCell ?? tableCell,
      totalsLabel: other.totalsLabel ?? totalsLabel,
      totalsValue: other.totalsValue ?? totalsValue,
      finalTotal: other.finalTotal ?? finalTotal,
      footer: other.footer ?? footer,
      header: other.header ?? header,
      headerText: other.headerText ?? headerText,
      footerText: other.footerText ?? footerText,
      showHeader: other.showHeader,
      showFooter: other.showFooter,
    );
  }

  /// يقرأ التصميم من خريطة JSON (مثلاً من contentSnapshot أو القالب).
  factory QuotationDocumentDesign.fromJson(Json? raw) {
    if (raw == null) return defaultDesign();
    QuotationDocumentElementStyle? styleOf(String key) {
      final v = raw[key];
      if (v is! Map) return null;
      return QuotationDocumentElementStyle(
        fontSizeMultiplier:
            (v['fontSizeMultiplier'] as num?)?.toDouble() ?? 1.0,
        fontWeight: _fontWeightOf(v['fontWeight']),
        color: v['color'] as String?,
        fontFamily: v['fontFamily'] as String?,
        backgroundColor: v['backgroundColor'] as String?,
        lineHeight: (v['lineHeight'] as num?)?.toDouble(),
        textAlign: v['textAlign'] as String?,
        borderColor: v['borderColor'] as String?,
      );
    }
    return QuotationDocumentDesign(
      title: styleOf('title'),
      company: styleOf('company'),
      customer: styleOf('customer'),
      sectionTitle: styleOf('sectionTitle'),
      tableHeader: styleOf('tableHeader'),
      tableCell: styleOf('tableCell'),
      totalsLabel: styleOf('totalsLabel'),
      totalsValue: styleOf('totalsValue'),
      finalTotal: styleOf('finalTotal'),
      footer: styleOf('footer'),
      header: styleOf('header'),
      headerText: raw['headerText'] as String?,
      footerText: raw['footerText'] as String?,
      showHeader: raw['showHeader'] != false,
      showFooter: raw['showFooter'] != false,
    );
  }

  /// يكتب التصميم إلى خريطة JSON للتخزين.
  Map<String, dynamic> toJson() {
    final result = <String, dynamic>{};
    void set(String key, QuotationDocumentElementStyle? s) {
      if (s == null) return;
      result[key] = {
        'fontSizeMultiplier': s.fontSizeMultiplier,
        if (s.fontWeight != null) 'fontWeight': s.fontWeight.toString().split('.').last,
        if (s.color != null) 'color': s.color,
        if (s.fontFamily != null) 'fontFamily': s.fontFamily,
        if (s.backgroundColor != null) 'backgroundColor': s.backgroundColor,
        if (s.lineHeight != null) 'lineHeight': s.lineHeight,
        if (s.textAlign != null) 'textAlign': s.textAlign,
        if (s.borderColor != null) 'borderColor': s.borderColor,
      };
    }
    set('title', title);
    set('company', company);
    set('customer', customer);
    set('sectionTitle', sectionTitle);
    set('tableHeader', tableHeader);
    set('tableCell', tableCell);
    set('totalsLabel', totalsLabel);
    set('totalsValue', totalsValue);
    set('finalTotal', finalTotal);
    set('footer', footer);
    set('header', header);
    if (headerText != null && headerText!.trim().isNotEmpty) result['headerText'] = headerText;
    if (footerText != null && footerText!.trim().isNotEmpty) result['footerText'] = footerText;
    if (!showHeader) result['showHeader'] = false;
    if (!showFooter) result['showFooter'] = false;
    return result;
  }
}

FontWeight? _fontWeightOf(dynamic v) {
  if (v is! String) return null;
  return switch (v.split('.').last) {
    'w100' => FontWeight.w100,
    'w200' => FontWeight.w200,
    'w300' => FontWeight.w300,
    'w400' => FontWeight.w400,
    'w500' => FontWeight.w500,
    'w600' => FontWeight.w600,
    'w700' => FontWeight.w700,
    'w800' => FontWeight.w800,
    'w900' => FontWeight.w900,
    _ => null,
  };
}

/// One printed line, already resolved for the reader's language.
class QuotationDocumentRow {
  const QuotationDocumentRow({
    required this.number,
    required this.cells,
  });

  final String number;

  /// One value per visible column, in the quotation's own order.
  final List<String> cells;

  String cell(int index) =>
      index >= 0 && index < cells.length ? cells[index] : '';
}

class QuotationDocumentColumn {
  const QuotationDocumentColumn({
    required this.key,
    required this.label,
    required this.numeric,
    required this.weight,
  });

  final String key;
  final String label;
  final bool numeric;

  /// The relative width the offer stored, 1..6.
  final int weight;
}

class QuotationDocumentSection {
  const QuotationDocumentSection({
    required this.title,
    required this.rows,
    required this.columns,
    required this.subTotal,
    required this.discountAmount,
    required this.discountPercent,
    required this.netTotal,
  });

  final String title;
  final List<QuotationDocumentRow> rows;
  final List<QuotationDocumentColumn> columns;
  final String subTotal;
  final String discountAmount;
  final String discountPercent;
  final String netTotal;

  bool get hasDiscount => (num.tryParse(discountAmount) ?? 0) > 0;
}

class QuotationDocumentTotals {
  const QuotationDocumentTotals({
    required this.subTotal,
    required this.discountTotal,
    required this.tableDiscountTotal,
    required this.quotationDiscount,
    required this.totalAmount,
    this.taxRate = '',
    this.taxAmount = '',
  });

  final String subTotal;
  final String discountTotal;
  final String tableDiscountTotal;
  final String quotationDiscount;
  final String totalAmount;
  /// The company's VAT rate in force when the offer was prepared, in percent.
  final String taxRate;
  /// VAT charged exactly once on the discounted net value.
  final String taxAmount;

  bool get hasTax => (num.tryParse(taxAmount) ?? 0) > 0;
}

class QuotationDocumentParty {
  const QuotationDocumentParty({
    required this.name,
    required this.code,
    this.phone = '',
    this.email = '',
    this.taxNumber = '',
    this.address = '',
  });

  final String name;
  final String code;
  final String phone;
  final String email;
  final String taxNumber;
  final String address;
}

class QuotationDocumentCompany {
  const QuotationDocumentCompany({
    required this.name,
    required this.secondaryName,
    this.address = '',
    this.phone = '',
    this.email = '',
    this.taxId = '',
    this.commercialRegistration = '',
  });

  final String name;
  final String secondaryName;
  final String address;
  final String phone;
  final String email;
  final String taxId;
  final String commercialRegistration;
}

/// Everything the printed quotation shows, in the reader's language.
///
/// Built from the quotation exactly as the API returns it. Money values and
/// section totals are copied from the server: this class never adds a second
/// calculation engine, it only decides how to present the numbers it was
/// given.
class QuotationDocument {
  const QuotationDocument({
    required this.number,
    required this.date,
    required this.validUntil,
    required this.currency,
    required this.status,
    required this.version,
    required this.subject,
    required this.customer,
    required this.company,
    required this.sections,
    required this.totals,
    required this.terms,
    required this.notes,
    required this.managerName,
    required this.responsibleName,
    required this.responsiblePhone,
    required this.showTaxId,
    required this.arabic,
    this.design,
  });

  final String number;
  final String date;
  final String validUntil;
  final String currency;
  final String status;
  final int version;
  final String subject;
  final QuotationDocumentParty customer;
  final QuotationDocumentCompany company;
  final List<QuotationDocumentSection> sections;
  final QuotationDocumentTotals totals;
  final String terms;
  final String notes;
  final String managerName;
  final String responsibleName;
  final String responsiblePhone;
  final bool showTaxId;
  final bool arabic;
  /// تصميم العناصر (حجم الخط، سمكه، لونه، محاذاته) المخزّن مع القالب أو العرض.
  final QuotationDocumentDesign? design;

  bool get hasAnySection => sections.isNotEmpty;

  /// The API's two shapes: an issued offer carries `contentSnapshot`, a draft
  /// does not. The snapshot wins when it exists, because that is the text the
  /// customer actually received and the same one the server prints.
  factory QuotationDocument.fromJson(
    Json quotation, {
    required Json company,
    required String language,
  }) {
    final arabic = language == 'ar';
    final snapshotRaw = quotation['contentSnapshot'];
    final snapshot = snapshotRaw is Map
        ? Map<String, dynamic>.from(snapshotRaw)
        : const <String, dynamic>{};
    final source = snapshot.isNotEmpty && listOf(snapshot['tables']).isNotEmpty
        ? snapshot
        : quotation;

    final customerRaw = source['customer'] is Map
        ? Map<String, dynamic>.from(source['customer'] as Map)
        : (quotation['customer'] is Map
              ? Map<String, dynamic>.from(quotation['customer'] as Map)
              : const <String, dynamic>{});
    final snapshotCompany = snapshot['company'] is Map
        ? Map<String, dynamic>.from(snapshot['company'] as Map)
        : const <String, dynamic>{};

    String pick(Json map, String en, String ar, {String fallback = ''}) {
      final valueEn = text(map, en);
      final valueAr = text(map, ar);
      if (arabic) {
        if (valueAr.isNotEmpty) return valueAr;
        if (valueEn.isNotEmpty) return valueEn;
      } else {
        if (valueEn.isNotEmpty) return valueEn;
        if (valueAr.isNotEmpty) return valueAr;
      }
      return fallback;
    }

    final rawColumns = listOf(source['columns']);
    final columns = _columns(
      rawColumns.isEmpty ? listOf(quotation['columns']) : rawColumns,
      language,
    );
    final rawTables = listOf(source['tables']);
    final sections = <QuotationDocumentSection>[];
    for (final rawTable in rawTables) {
      final table = Map<String, dynamic>.from(rawTable);
      final rawLines = listOf(table['lines']);
      final rows = <QuotationDocumentRow>[];
      for (var index = 0; index < rawLines.length; index += 1) {
        final line = Map<String, dynamic>.from(rawLines[index]);
        rows.add(
          QuotationDocumentRow(
            number: text(line, 'lineNumber').isEmpty
                ? '${index + 1}'
                : text(line, 'lineNumber'),
            cells: [for (final column in columns) _cell(line, column.key)],
          ),
        );
      }
      sections.add(
        QuotationDocumentSection(
          title: text(table, 'title'),
          rows: rows,
          columns: columns,
          subTotal: text(table, 'subTotal'),
          discountAmount: text(table, 'discountAmount'),
          discountPercent: text(table, 'discountPercent'),
          netTotal: text(table, 'netTotal', fallback: '0'),
        ),
      );
    }

    final totalsRaw = source['totals'] is Map
        ? Map<String, dynamic>.from(source['totals'] as Map)
        : const <String, dynamic>{};
    final tableDiscount = sections.fold<double>(
      0,
      (sum, section) => sum + (num.tryParse(section.discountAmount) ?? 0),
    );
    final discountTotal = text(
      totalsRaw,
      'discountTotal',
      fallback: text(quotation, 'discountTotal'),
    );
    final quotationDiscount = (num.tryParse(discountTotal) ?? 0) - tableDiscount;
    final subTotal = text(
      totalsRaw,
      'subTotal',
      fallback: text(quotation, 'subTotal'),
    );
    final totalAmount = text(
      totalsRaw,
      'totalAmount',
      fallback: text(quotation, 'totalAmount'),
    );

    final profile = company.isEmpty
        ? snapshotCompany
        : Map<String, dynamic>.from(company);

    return QuotationDocument(
      number: text(source, 'quotationNumber', fallback: text(quotation, 'quotationNumber')),
      date: text(source, 'quotationDate', fallback: text(quotation, 'quotationDate')),
      validUntil: text(source, 'validUntil', fallback: text(quotation, 'validUntil')),
      currency: text(source, 'currency', fallback: text(quotation, 'currency')),
      status: text(source, 'status', fallback: text(quotation, 'status')).toLowerCase(),
      version: asNum(source['version'])?.toInt() ?? 1,
      subject: text(source, 'subject', fallback: text(quotation, 'subject')),
      customer: QuotationDocumentParty(
        name: pick(customerRaw, 'nameEn', 'nameAr'),
        code: text(customerRaw, 'code'),
        phone: text(customerRaw, 'phone'),
        email: text(customerRaw, 'email'),
        taxNumber: text(customerRaw, 'taxNumber'),
        address: text(customerRaw, 'address'),
      ),
      company: QuotationDocumentCompany(
        name: pick(snapshotCompany, 'nameEn', 'nameAr', fallback: pick(profile, 'nameEn', 'nameAr')),
        secondaryName: arabic
            ? text(snapshotCompany, 'nameEn').ifEmpty(text(profile, 'nameEn'))
            : text(snapshotCompany, 'nameAr').ifEmpty(text(profile, 'nameAr')),
        address: arabic
            ? text(snapshotCompany, 'addressAr').ifEmpty(
                text(snapshotCompany, 'address').ifEmpty(
                  text(profile, 'addressAr').ifEmpty(text(profile, 'address')),
                ),
              )
            : text(snapshotCompany, 'address').ifEmpty(
                text(snapshotCompany, 'addressAr').ifEmpty(
                  text(profile, 'address').ifEmpty(text(profile, 'addressAr')),
                ),
              ),
        phone: text(snapshotCompany, 'phone').ifEmpty(text(profile, 'phone')),
        email: text(snapshotCompany, 'email').ifEmpty(text(profile, 'email')),
        taxId: text(snapshotCompany, 'taxId').ifEmpty(text(profile, 'taxId')),
        commercialRegistration: text(snapshotCompany, 'commercialRegistration')
            .ifEmpty(text(profile, 'commercialRegistration')),
      ),
      sections: sections,
      totals: QuotationDocumentTotals(
        subTotal: subTotal,
        discountTotal: discountTotal,
        tableDiscountTotal: tableDiscount.toStringAsFixed(2),
        quotationDiscount: quotationDiscount < 0
            ? '0'
            : quotationDiscount.toStringAsFixed(2),
        totalAmount: totalAmount,
        taxRate: text(totalsRaw, 'taxRate', fallback: text(quotation, 'taxRate')),
        taxAmount: text(totalsRaw, 'taxAmount', fallback: text(quotation, 'taxAmount')),
      ),
      terms: text(source, 'terms', fallback: text(quotation, 'terms')),
      notes: text(source, 'notes', fallback: text(quotation, 'notes')),
      managerName: text(source, 'managerName', fallback: text(quotation, 'managerName')),
      responsibleName: text(source, 'responsibleName', fallback: text(quotation, 'responsibleName')),
      responsiblePhone: text(
        source,
        'responsiblePhone',
        fallback: text(quotation, 'responsiblePhone'),
      ),
      showTaxId: source['showTaxId'] != false,
      arabic: arabic,
      design: QuotationDocumentDesign.fromJson(source['design']),
    );
  }

  static List<QuotationDocumentColumn> _columns(
    List<Json> raw,
    String language,
  ) {
    final result = <QuotationDocumentColumn>[];
    final seen = <String>{};
    for (final entry in raw) {
      final key = text(entry, 'key');
      if (key.isEmpty || seen.contains(key)) continue;
      if (entry['visible'] == false) continue;
      seen.add(key);
      final override = language == 'ar'
          ? text(entry, 'labelAr')
          : text(entry, 'labelEn');
      final weight = asNum(entry['width'])?.toInt() ?? 2;
      final builtIn = _labels[key];
      result.add(
        QuotationDocumentColumn(
          key: key,
          label: override.isNotEmpty
              ? override
              : (builtIn != null ? builtIn[language == 'ar' ? 1 : 0] : key),
          numeric: entry['numeric'] == true
              ? true
              : (builtIn != null ? _numeric.contains(key) : false),
          weight: weight.clamp(1, 6).toInt(),
        ),
      );
    }
    if (result.isNotEmpty) return result;

    // The same six columns every offer printed before layouts existed.
    const standard = [
      ('description', 4),
      ('countryOfOrigin', 2),
      ('unit', 1),
      ('quantity', 1),
      ('unitPrice', 2),
      ('lineTotal', 2),
    ];
    for (final entry in standard) {
      result.add(
        QuotationDocumentColumn(
          key: entry.$1,
          label: _labels[entry.$1]![language == 'ar' ? 1 : 0],
          numeric: _numeric.contains(entry.$1),
          weight: entry.$2,
        ),
      );
    }
    return result;
  }

  static String _cell(Json line, String key) {
    switch (key) {
      case 'description':
        return text(line, 'description');
      case 'itemCode':
        return text(line, 'itemCode').ifEmpty('—');
      case 'countryOfOrigin':
        return text(line, 'countryOfOrigin').ifEmpty('—');
      case 'unit':
        return text(line, 'unit');
      case 'quantity':
        return formatQuantity(text(line, 'quantity'));
      case 'unitPrice':
        return formatAmount(text(line, 'unitPrice'));
      case 'lineTotal':
        return formatAmount(text(line, 'lineTotal'));
      default:
        // User-defined column: read its stored value from customValues.
        final custom = line['customValues'];
        if (custom is Map) {
          final value = custom[key];
          if (value != null) return value.toString();
        }
        return '';
    }
  }

  static const _numeric = {'quantity', 'unitPrice', 'lineTotal'};

  /// Header labels shared with the backend's `COLUMN_LABELS`.
  static const _labels = <String, List<String>>{
    'itemCode': ['Item code', 'كود الصنف'],
    'description': ['Description', 'الوصف'],
    'countryOfOrigin': ['Country of origin', 'بلد المنشأ'],
    'unit': ['Unit', 'الوحدة'],
    'quantity': ['Qty', 'الكمية'],
    'unitPrice': ['Unit price', 'سعر الوحدة'],
    'lineTotal': ['Total', 'الإجمالي'],
  };
}

extension _EmptyFallback on String {
  String ifEmpty(String fallback) => trim().isEmpty ? fallback : this;
}
