import 'package:flutter/material.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../shared/widgets/status_pill.dart';
import '../document/quotation_document.dart';

/// A4 paper, drawn on screen the way the server prints it.
///
/// The colours and spacing here are the same ones the HTML template uses, so
/// the in-app preview and the exported PDF show one document rather than two
/// interpretations of it. Every number comes from [QuotationDocument], which
/// copies the figures the API stored: nothing is recalculated here.
class QuotationDocumentView extends StatelessWidget {
  const QuotationDocumentView({
    super.key,
    required this.document,
    this.logoUrl,
  });

  final QuotationDocument document;
  final String? logoUrl;

  /// The reference layout is 860 points wide; narrower windows shrink the
  /// whole sheet instead of letting a column overflow.
  static const _referenceWidth = 860.0;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth.isFinite
            ? constraints.maxWidth
            : _referenceWidth;
        final scale = (width / _referenceWidth).clamp(0.72, 1.0).toDouble();
        return Directionality(
          textDirection: document.arabic
              ? TextDirection.rtl
              : TextDirection.ltr,
          child: _Sheet(document: document, logoUrl: logoUrl, scale: scale),
        );
      },
    );
  }
}

class _Sheet extends StatelessWidget {
  const _Sheet({
    required this.document,
    required this.scale,
    this.logoUrl,
  });

  final QuotationDocument document;
  final double scale;
  final String? logoUrl;

  @override
  Widget build(BuildContext context) {
    final d = document;
    return Container(
      width: double.infinity,
      constraints: BoxConstraints(minHeight: 1123 * scale),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: _Doc.line),
        borderRadius: BorderRadius.circular(2),
        boxShadow: const [
          BoxShadow(
            color: Color(0x14142B4A),
            blurRadius: 18,
            offset: Offset(0, 6),
          ),
        ],
      ),
      padding: EdgeInsets.fromLTRB(
        40 * scale,
        36 * scale,
        40 * scale,
        28 * scale,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _letterhead(),
          SizedBox(height: 20 * scale),
          _panels(),
          if (d.subject.trim().isNotEmpty) ...[
            SizedBox(height: 18 * scale),
            _subjectStrip(),
          ],
          SizedBox(height: 22 * scale),
          for (var index = 0; index < d.sections.length; index += 1)
            _section(d.sections[index], index),
          _summary(),
          if (d.terms.trim().isNotEmpty)
            _prose(d.arabic ? 'الشروط والأحكام' : 'Terms and conditions', d.terms),
          if (d.notes.trim().isNotEmpty)
            _prose(d.arabic ? 'ملاحظات' : 'Notes', d.notes),
          if (d.managerName.isNotEmpty || d.responsibleName.isNotEmpty)
            _signatures(),
          SizedBox(height: 22 * scale),
          _footer(),
        ],
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────── letterhead

  /// One row, as on the printed stationery: the company's name at the start
  /// of the line (the right in Arabic), the «عرض سعر» title in the middle,
  /// and the mark at the opposite end.
  Widget _letterhead() {
    final company = document.company;
    final mark = logoUrl == null || logoUrl!.isEmpty
        ? _monogram(company.name)
        : Image.network(
            logoUrl!,
            height: 48 * scale,
            fit: BoxFit.contain,
            errorBuilder: (context, error, stack) => _monogram(company.name),
          );

    return Container(
      padding: EdgeInsets.only(bottom: 12 * scale),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: _Doc.royal, width: 1.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  company.name,
                  style: TextStyle(
                    color: _Doc.royal,
                    fontSize: 18 * scale,
                    fontWeight: FontWeight.w700,
                    height: 1.25,
                  ),
                ),
                if (company.secondaryName.trim().isNotEmpty)
                  Padding(
                    padding: EdgeInsets.only(top: 3 * scale),
                    child: Text(
                      company.secondaryName.toUpperCase(),
                      style: TextStyle(
                        color: _Doc.muted,
                        fontSize: 7.5 * scale,
                        letterSpacing: 1.1 * scale,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: Column(
              children: [
                Text(
                  document.arabic ? 'عرض سعر' : 'QUOTATION',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: _Doc.royal,
                    fontSize: 24 * scale,
                    fontWeight: FontWeight.w700,
                    height: 1.15,
                  ),
                ),
                SizedBox(height: 2 * scale),
                Text(
                  document.arabic ? 'QUOTATION' : 'عرض سعر',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: _Doc.muted,
                    fontSize: 7.5 * scale,
                    letterSpacing: 2.4 * scale,
                  ),
                ),
                SizedBox(height: 4 * scale),
                Text(
                  document.number,
                  textAlign: TextAlign.center,
                  textDirection: TextDirection.ltr,
                  style: TextStyle(
                    color: _Doc.royalDeep,
                    fontSize: 10.5 * scale,
                    fontWeight: FontWeight.w600,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: Align(
              alignment: AlignmentDirectional.centerEnd,
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: 150 * scale),
                child: mark,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _monogram(String name) {
    final trimmed = name.trim();
    final initial = trimmed.isEmpty ? 'K' : trimmed.substring(0, 1);
    return Container(
      width: 48 * scale,
      height: 48 * scale,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: _Doc.royal,
        borderRadius: BorderRadius.circular(6 * scale),
      ),
      child: Text(
        initial,
        style: TextStyle(
          color: Colors.white,
          fontSize: 22 * scale,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }

  // ──────────────────────────────────────────────────────────────────── facts

  Widget _panels() {
    final customer = _panel(
      eyebrow: document.arabic ? 'مقدم إلى' : 'PREPARED FOR',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            document.customer.name.trim().isEmpty
                ? '—'
                : document.customer.name,
            style: TextStyle(
              fontSize: 12.5 * scale,
              fontWeight: FontWeight.w700,
              color: _Doc.ink,
            ),
          ),
          if (document.customer.code.trim().isNotEmpty) ...[
            SizedBox(height: 2 * scale),
            Text(
              '${document.arabic ? 'كود العميل' : 'Customer code'}: '
              '${document.customer.code}',
              style: TextStyle(color: _Doc.muted, fontSize: 8.5 * scale),
            ),
          ],
          SizedBox(height: 6 * scale),
          if (document.customer.phone.isNotEmpty)
            _fact(document.arabic ? 'الهاتف' : 'Phone', document.customer.phone),
          if (document.customer.email.isNotEmpty)
            _fact(document.arabic ? 'البريد' : 'Email', document.customer.email),
          if (document.customer.taxNumber.isNotEmpty)
            _fact(
              document.arabic ? 'الرقم الضريبي' : 'Tax number',
              document.customer.taxNumber,
            ),
          if (document.customer.address.isNotEmpty)
            _fact(
              document.arabic ? 'العنوان' : 'Address',
              document.customer.address,
            ),
        ],
      ),
    );

    final details = _panel(
      eyebrow: document.arabic ? 'بيانات العرض' : 'QUOTATION DETAILS',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _fact(document.arabic ? 'الرقم' : 'Number', document.number, strong: true),
          _fact(document.arabic ? 'التاريخ' : 'Date', document.date),
          if (document.validUntil.isNotEmpty)
            _fact(
              document.arabic ? 'صالح حتى' : 'Valid until',
              document.validUntil,
            ),
          _fact(document.arabic ? 'العملة' : 'Currency', document.currency),
          _fact(
            document.arabic ? 'الإصدار' : 'Version',
            '${document.version}',
          ),
          SizedBox(height: 6 * scale),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: StatusPill(
              label: _statusLabel(document.status, document.arabic),
              tone: toneForStatus(document.status),
              dense: true,
            ),
          ),
        ],
      ),
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= 560 * scale) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(flex: 11, child: customer),
              SizedBox(width: 14 * scale),
              Expanded(flex: 9, child: details),
            ],
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            customer,
            SizedBox(height: 10 * scale),
            details,
          ],
        );
      },
    );
  }

  Widget _panel({required String eyebrow, required Widget child}) {
    return Container(
      padding: EdgeInsets.all(14 * scale),
      decoration: BoxDecoration(
        color: _Doc.wash,
        border: Border.all(color: _Doc.line),
        borderRadius: BorderRadius.circular(4 * scale),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            eyebrow,
            style: TextStyle(
              color: _Doc.royal,
              fontSize: 7.5 * scale,
              fontWeight: FontWeight.w700,
              letterSpacing: 1 * scale,
            ),
          ),
          SizedBox(height: 6 * scale),
          child,
        ],
      ),
    );
  }

  Widget _fact(String label, String value, {bool strong = false}) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 1.5 * scale),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(color: _Doc.muted, fontSize: 8.5 * scale),
            ),
          ),
          SizedBox(width: 8 * scale),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: TextStyle(
                color: _Doc.ink,
                fontSize: 8.8 * scale,
                fontWeight: strong ? FontWeight.w700 : FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _subjectStrip() {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: 12 * scale,
        vertical: 8 * scale,
      ),
      decoration: BoxDecoration(
        color: _Doc.wash,
        border: BorderDirectional(
          start: BorderSide(color: _Doc.royal, width: 3 * scale),
        ),
      ),
      child: Text.rich(
        TextSpan(
          children: [
            TextSpan(
              text: '${document.arabic ? 'الموضوع' : 'Subject'}  ',
              style: TextStyle(
                color: _Doc.muted,
                fontSize: 8.5 * scale,
                fontWeight: FontWeight.w600,
              ),
            ),
            TextSpan(
              text: document.subject,
              style: TextStyle(color: _Doc.ink, fontSize: 10 * scale),
            ),
          ],
        ),
      ),
    );
  }

  // ───────────────────────────────────────────────────────────────── sections

  Widget _section(QuotationDocumentSection section, int index) {
    return Padding(
      padding: EdgeInsets.only(bottom: 20 * scale),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 22 * scale,
                height: 22 * scale,
                alignment: Alignment.center,
                decoration: const BoxDecoration(
                  color: _Doc.royal,
                  shape: BoxShape.circle,
                ),
                child: Text(
                  '${index + 1}'.padLeft(2, '0'),
                  textDirection: TextDirection.ltr,
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 8.5 * scale,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              SizedBox(width: 8 * scale),
              Expanded(
                child: Text(
                  section.title,
                  style: TextStyle(
                    color: _Doc.royal,
                    fontSize: 13.5 * scale,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: 8 * scale),
          _table(section),
        ],
      ),
    );
  }

  Widget _table(QuotationDocumentSection section) {
    final columns = section.columns;
    final style = TextStyle(fontSize: 9 * scale, color: _Doc.ink, height: 1.4);
    final headerStyle = TextStyle(
      fontSize: 8.5 * scale,
      color: Colors.white,
      fontWeight: FontWeight.w700,
      height: 1.3,
    );

    Widget cell(
      String value, {
      required int flex,
      bool numeric = false,
      bool strong = false,
      TextStyle? override,
    }) {
      return Expanded(
        flex: flex,
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: 5 * scale,
            vertical: 5 * scale,
          ),
          child: Text(
            value,
            textAlign: numeric ? TextAlign.end : TextAlign.start,
            style: (override ?? style).copyWith(
              fontWeight: strong ? FontWeight.w700 : null,
              fontFeatures: numeric
                  ? const [FontFeature.tabularFigures()]
                  : null,
            ),
          ),
        ),
      );
    }

    Widget headerRow() {
      return Container(
        color: _Doc.royal,
        child: Row(
          children: [
            _indexCell('#', width: 22 * scale, style: headerStyle),
            for (final column in columns)
              cell(
                column.label,
                flex: column.weight,
                numeric: column.numeric,
                override: headerStyle,
              ),
          ],
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: _Doc.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          headerRow(),
          Container(height: 1, color: _Doc.royalDeep),
          for (var index = 0; index < section.rows.length; index += 1)
            Container(
              color: index.isEven ? Colors.white : _Doc.rows,
              child: Container(
                decoration: const BoxDecoration(
                  border: Border(bottom: BorderSide(color: _Doc.line, width: 0.6)),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _indexCell(
                      section.rows[index].number,
                      width: 22 * scale,
                      style: style.copyWith(color: _Doc.muted),
                    ),
                    for (var columnIndex = 0;
                        columnIndex < columns.length;
                        columnIndex += 1)
                      cell(
                        section.rows[index].cell(columnIndex),
                        flex: columns[columnIndex].weight,
                        numeric: columns[columnIndex].numeric,
                        strong: columns[columnIndex].key == 'lineTotal',
                      ),
                  ],
                ),
              ),
            ),
          _totalRow(
            document.arabic ? 'إجمالي القسم' : 'Section subtotal',
            _money(section.subTotal),
            strong: true,
            shade: _Doc.wash,
          ),
          if (section.hasDiscount) ...[
            _totalRow(
              '${document.arabic ? 'خصم القسم' : 'Section discount'}'
              '${_percent(section.discountPercent)}',
              '− ${_money(section.discountAmount)}',
              shade: _Doc.rows,
            ),
            _totalRow(
              document.arabic ? 'الصافي بعد الخصم' : 'Net after discount',
              _money(section.netTotal),
              strong: true,
              shade: _Doc.wash,
            ),
          ],
        ],
      ),
    );
  }

  Widget _indexCell(String value, {required double width, TextStyle? style}) {
    return SizedBox(
      width: width,
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: 5 * scale, horizontal: 2 * scale),
        child: Text(
          value,
          textAlign: TextAlign.center,
          textDirection: TextDirection.ltr,
          style: (style ?? TextStyle(fontSize: 9 * scale, color: _Doc.ink))
              .copyWith(color: style?.color ?? _Doc.muted),
        ),
      ),
    );
  }

  Widget _totalRow(
    String label,
    String value, {
    bool strong = false,
    Color? shade,
  }) {
    return Container(
      color: shade,
      padding: EdgeInsets.symmetric(
        horizontal: 8 * scale,
        vertical: 6 * scale,
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                color: strong ? _Doc.royal : _Doc.muted,
                fontSize: 8.5 * scale,
                fontWeight: strong ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          ),
          SizedBox(width: 16 * scale),
          Text(
            value,
            textAlign: TextAlign.end,
            style: TextStyle(
              color: strong ? _Doc.royal : _Doc.ink,
              fontSize: strong ? 9.5 * scale : 9 * scale,
              fontWeight: strong ? FontWeight.w700 : FontWeight.w500,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }

  // ────────────────────────────────────────────────────────────────── summary

  /// The closing summary: every table by name with its total, the offer
  /// discount when one exists, and the stored grand total as the final row.
  /// Section rows carry the section's net — its own discount is already
  /// applied once, on the section table — so nothing is deducted twice.
  Widget _summary() {
    if (document.sections.isEmpty) return const SizedBox.shrink();
    final headerStyle = TextStyle(
      color: Colors.white,
      fontSize: 9 * scale,
      fontWeight: FontWeight.w700,
    );
    final bodyStyle = TextStyle(
      color: _Doc.ink,
      fontSize: 9.2 * scale,
      fontFeatures: const [FontFeature.tabularFigures()],
    );

    Widget head(String label, {bool numeric = false}) => Expanded(
          flex: numeric ? 3 : 7,
          child: Padding(
            padding: EdgeInsets.symmetric(vertical: 6 * scale, horizontal: 8 * scale),
            child: Text(
              label,
              textAlign: numeric ? TextAlign.end : TextAlign.start,
              style: headerStyle,
            ),
          ),
        );

    Widget cell(String value, TextStyle style, {bool numeric = false}) =>
        Expanded(
          flex: numeric ? 3 : 7,
          child: Padding(
            padding: EdgeInsets.symmetric(
              vertical: 6 * scale,
              horizontal: 8 * scale,
            ),
            child: Text(
              value,
              textAlign: numeric ? TextAlign.end : TextAlign.start,
              style: style,
            ),
          ),
        );

    final quotationDiscount = num.tryParse(document.totals.quotationDiscount) ?? 0;

    return Padding(
      padding: EdgeInsets.only(bottom: 18 * scale),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            document.arabic ? 'ملخص الجداول' : 'Tables summary',
            style: TextStyle(
              color: _Doc.royal,
              fontSize: 13.5 * scale,
              fontWeight: FontWeight.w700,
            ),
          ),
          SizedBox(height: 8 * scale),
          Container(
            decoration: BoxDecoration(border: Border.all(color: _Doc.line)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  color: _Doc.royal,
                  child: Row(
                    children: [
                      head(document.arabic ? 'البيان' : 'Description'),
                      head(
                        document.arabic ? 'إجمالي الجدول' : 'Table total',
                        numeric: true,
                      ),
                    ],
                  ),
                ),
                for (var index = 0; index < document.sections.length; index += 1)
                  Container(
                    decoration: const BoxDecoration(
                      border: Border(
                        bottom: BorderSide(color: _Doc.line, width: 0.6),
                      ),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        cell(document.sections[index].title, bodyStyle),
                        cell(
                          _money(document.sections[index].netTotal),
                          bodyStyle.copyWith(fontWeight: FontWeight.w600),
                          numeric: true,
                        ),
                      ],
                    ),
                  ),
                if (quotationDiscount > 0)
                  Container(
                    decoration: const BoxDecoration(
                      border: Border(
                        bottom: BorderSide(color: _Doc.line, width: 0.6),
                      ),
                    ),
                    child: Row(
                      children: [
                        cell(
                          document.arabic ? 'خصم العرض' : 'Quotation discount',
                          bodyStyle.copyWith(color: _Doc.muted),
                        ),
                        cell(
                          '− ${_money(document.totals.quotationDiscount)}',
                          bodyStyle.copyWith(color: _Doc.muted),
                          numeric: true,
                        ),
                      ],
                    ),
                  ),
                Container(
                  color: _Doc.royal,
                  padding: EdgeInsets.symmetric(vertical: 2 * scale),
                  child: Row(
                    children: [
                      cell(
                        document.arabic ? 'المجموع الكلي' : 'Grand total',
                        TextStyle(
                          color: Colors.white,
                          fontSize: 11 * scale,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      cell(
                        _money(document.totals.totalAmount),
                        TextStyle(
                          color: Colors.white,
                          fontSize: 12 * scale,
                          fontWeight: FontWeight.w700,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                        numeric: true,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ──────────────────────────────────────────────────── terms, signs, footer

  Widget _prose(String title, String body) {
    return Padding(
      padding: EdgeInsets.only(bottom: 16 * scale),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            title,
            style: TextStyle(
              color: _Doc.royal,
              fontSize: 11.5 * scale,
              fontWeight: FontWeight.w700,
            ),
          ),
          SizedBox(height: 5 * scale),
          Text(
            body,
            style: TextStyle(
              color: _Doc.muted,
              fontSize: 8.8 * scale,
              height: 1.55,
            ),
          ),
        ],
      ),
    );
  }

  Widget _signatures() {
    final blocks = <Widget>[
      if (document.managerName.isNotEmpty)
        _signature(
          document.arabic ? 'مدير الشركة' : 'Company manager',
          document.managerName,
        ),
      if (document.responsibleName.isNotEmpty)
        _signature(
          document.arabic ? 'المسؤول' : 'Responsible person',
          document.responsibleName,
          note: document.responsiblePhone,
        ),
    ];
    return Padding(
      padding: EdgeInsets.only(top: 12 * scale, bottom: 8 * scale),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var index = 0; index < blocks.length; index += 1) ...[
            if (index > 0) SizedBox(width: 48 * scale),
            Expanded(child: blocks[index]),
          ],
        ],
      ),
    );
  }

  Widget _signature(String label, String name, {String? note}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          height: 34 * scale,
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(color: _Doc.signature, width: 1),
            ),
          ),
        ),
        SizedBox(height: 4 * scale),
        Text(
          label,
          style: TextStyle(color: _Doc.muted, fontSize: 8 * scale),
        ),
        Text(
          name,
          style: TextStyle(
            color: _Doc.ink,
            fontSize: 9.5 * scale,
            fontWeight: FontWeight.w600,
          ),
        ),
        if (note != null && note.isNotEmpty)
          Text(
            note,
            style: TextStyle(color: _Doc.muted, fontSize: 8 * scale),
          ),
      ],
    );
  }

  Widget _footer() {
    final company = document.company;
    final contact = [
      if (company.address.isNotEmpty) company.address,
      if (company.phone.isNotEmpty) company.phone,
      if (company.email.isNotEmpty) company.email,
    ].join(' · ');

    final legal = [
      if (document.showTaxId && company.taxId.isNotEmpty)
        '${document.arabic ? 'الرقم الضريبي' : 'Tax registration'}: ${company.taxId}',
      if (company.commercialRegistration.isNotEmpty)
        '${document.arabic ? 'السجل التجاري' : 'Commercial registration'}: '
            '${company.commercialRegistration}',
      document.arabic
          ? 'هذا العرض ليس فاتورة ضريبية.'
          : 'This offer is not a tax invoice.',
    ].join(' · ');

    return Container(
      padding: EdgeInsets.only(top: 9 * scale),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: _Doc.line, width: 0.8)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            company.name,
            style: TextStyle(
              color: _Doc.royal,
              fontSize: 8.5 * scale,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (contact.isNotEmpty)
            Padding(
              padding: EdgeInsets.only(top: 2 * scale),
              child: Text(
                contact,
                style: TextStyle(color: _Doc.muted, fontSize: 7.5 * scale),
              ),
            ),
          Padding(
            padding: EdgeInsets.only(top: 2 * scale),
            child: Text(
              legal,
              style: TextStyle(color: _Doc.muted, fontSize: 7.2 * scale),
            ),
          ),
        ],
      ),
    );
  }

  String _money(String raw) {
    final value = formatAmount(raw, locale: 'en_US');
    if (value.isEmpty) return '—';
    return '$value ${document.currency}';
  }

  String _percent(String raw) {
    final value = num.tryParse(raw);
    if (value == null || value <= 0) return '';
    return ' ($value%)';
  }

  static String _statusLabel(String status, bool arabic) {
    return switch (status) {
      'draft' => arabic ? 'مسودة' : 'Draft',
      'sent' => arabic ? 'مُرسل' : 'Sent',
      'accepted' => arabic ? 'مقبول' : 'Accepted',
      'rejected' => arabic ? 'مرفوض' : 'Rejected',
      'expired' => arabic ? 'منتهي' : 'Expired',
      'converted' => arabic ? 'محوّل إلى فاتورة' : 'Converted',
      _ => status,
    };
  }
}

/// The document palette, shared with the server template (`quotation-document.ts`).
abstract final class _Doc {
  static const royal = Color(0xFF00288E);
  static const royalDeep = Color(0xFF001B60);
  static const ink = Color(0xFF0B1C30);
  static const muted = Color(0xFF444653);
  static const line = Color(0xFFD3E4FE);
  static const wash = Color(0xFFEFF4FF);
  static const rows = Color(0xFFFBFCFE);
  static const signature = Color(0xFF95A0B0);
}
