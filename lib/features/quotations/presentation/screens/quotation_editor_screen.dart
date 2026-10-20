import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/discount_math.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/item_picker_dialog.dart';
import '../../../../shared/widgets/page_header.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../../shared/widgets/discount_kind_label.dart';
import '../document/quotation_document.dart';
import '../providers/quotation_providers.dart';

class _QLineDraft {
  _QLineDraft({
    this.itemId,
    String description = '',
    String origin = '',
    String unit = '',
    String quantity = '1',
    String unitPrice = '0',
    Map<String, String>? customValues,
  }) : description = TextEditingController(text: description),
       origin = TextEditingController(text: origin),
       unit = TextEditingController(text: unit),
       quantity = TextEditingController(text: quantity),
       unitPrice = TextEditingController(text: unitPrice),
       customValues = customValues ?? {},
       customValueControllers = {};

  String? itemId;
  final TextEditingController description;
  final TextEditingController origin;
  final TextEditingController unit;
  final TextEditingController quantity;
  final TextEditingController unitPrice;
  /// Values for user-defined columns, keyed by the column's key.
  final Map<String, String> customValues;
  /// Controllers for custom value fields, created lazily and disposed with
  /// the line draft.
  final Map<String, TextEditingController> customValueControllers;

  Decimal get lineTotal {
    final qty = Decimal.tryParse(quantity.text.trim()) ?? Decimal.zero;
    final price = Decimal.tryParse(unitPrice.text.trim()) ?? Decimal.zero;
    return (qty * price).round(scale: moneyScale);
  }

  TextEditingController customValueController(String key, String initial) {
    return customValueControllers.putIfAbsent(
      key,
      () => TextEditingController(text: initial),
    );
  }

  void dispose() {
    description.dispose();
    origin.dispose();
    unit.dispose();
    quantity.dispose();
    unitPrice.dispose();
    for (final c in customValueControllers.values) {
      c.dispose();
    }
  }
}

/// One line column as this offer prints it. The key names a line field; the
/// labels override the built-in text, and a hidden column is kept so it can be
/// turned back on without rebuilding the layout.
class _QColumnDraft {
  _QColumnDraft({
    required this.key,
    String labelEn = '',
    String labelAr = '',
    this.visible = true,
    this.width = 2,
    this.numeric = false,
  }) : labelEn = TextEditingController(text: labelEn),
       labelAr = TextEditingController(text: labelAr);

  final String key;
  final TextEditingController labelEn;
  final TextEditingController labelAr;
  bool visible;
  int width;
  /// Whether the column holds a monetary quantity. User-defined columns
  /// default to text unless the user marks them numeric.
  bool numeric;

  _QColumnDraft copy() => _QColumnDraft(
    key: key,
    labelEn: labelEn.text,
    labelAr: labelAr.text,
    visible: visible,
    width: width,
    numeric: numeric,
  );

  void dispose() {
    labelEn.dispose();
    labelAr.dispose();
  }
}

class _QTableDraft {
  _QTableDraft({String title = ''})
    : title = TextEditingController(text: title),
      discountValue = TextEditingController(),
      lines = [_QLineDraft()];

  final TextEditingController title;
  DiscountKind discountKind = DiscountKind.none;
  final TextEditingController discountValue;
  final List<_QLineDraft> lines;
  final List<_QColumnDraft> columns = [];

  Decimal get gross => lines.fold(Decimal.zero, (sum, line) => sum + line.lineTotal);

  ResolvedDiscount get discount => resolveDiscount(
    gross,
    discountKind,
    Decimal.tryParse(discountValue.text.trim()),
  );

  Decimal get net => discount.net;

  void dispose() {
    title.dispose();
    discountValue.dispose();
    for (final line in lines) {
      line.dispose();
    }
    for (final column in columns) {
      column.dispose();
    }
    columns.clear();
  }
}

/// Creates or edits a draft quotation with any number of titled tables.
///
/// The screen never posts anything: quotations have no ledger or stock effect.
/// Issuing the offer and converting it to an invoice are separate actions in
/// the detail dialog, each with its own permission and confirmation.
class QuotationEditorScreen extends ConsumerStatefulWidget {
  const QuotationEditorScreen({super.key, this.quotationId});

  final String? quotationId;

  @override
  ConsumerState<QuotationEditorScreen> createState() =>
      _QuotationEditorScreenState();
}

class _QuotationEditorScreenState extends ConsumerState<QuotationEditorScreen> {
  final _tables = <_QTableDraft>[];
  final _subject = TextEditingController();
  final _columns = <_QColumnDraft>[];
  QuotationDocumentDesign _design = QuotationDocumentDesign.defaultDesign();
  bool _showTaxId = true;
  final _discountValue = TextEditingController();
  final _terms = TextEditingController();
  final _notes = TextEditingController();
  final _managerName = TextEditingController();
  final _responsibleName = TextEditingController();
  final _responsiblePhone = TextEditingController();
  DiscountKind _discountKind = DiscountKind.none;
  String? _customerId;
  String _currency = 'EGP';
  late String _date;
  String? _validUntil;
  bool _saving = false;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _date = '${now.year.toString().padLeft(4, '0')}-'
        '${now.month.toString().padLeft(2, '0')}-'
        '${now.day.toString().padLeft(2, '0')}';
    _columns.addAll(_standardColumns());
    final firstTable = _QTableDraft();
    firstTable.columns.addAll(_columnsFrom(_columnBody()));
    _tables.add(firstTable);
    if (widget.quotationId != null) {
      _loading = true;
      _load();
    }
  }

  Future<void> _load() async {
    try {
      final quotation = await ref
          .read(apiClientProvider)
          .getObject('/sales/quotations/${widget.quotationId}');
      if (!mounted) return;
      for (final table in _tables) {
        table.dispose();
      }
      _tables.clear();
      for (final tableRow in listOf(quotation['tables'])) {
        final table = _QTableDraft(title: text(tableRow, 'title'));
        table.columns.addAll(_columnsFrom(tableRow['columns'] ?? quotation['columns']));
        table.discountKind = discountKindOf(text(tableRow, 'discountType'));
        table.discountValue.text = table.discountKind == DiscountKind.percent
            ? text(tableRow, 'discountPercent', fallback: '')
            : text(tableRow, 'discountAmount', fallback: '');
        if (table.discountValue.text == '0.0000') table.discountValue.clear();
        for (final line in table.lines) {
          line.dispose();
        }
        table.lines.clear();
        for (final row in listOf(tableRow['lines'])) {
          final rawCustom = row['customValues'];
          final customValues = <String, String>{};
          if (rawCustom is Map) {
            rawCustom.forEach((k, v) {
              customValues[k.toString()] = v.toString();
            });
          }
          table.lines.add(
            _QLineDraft(
              itemId: text(row, 'itemId').isEmpty ? null : text(row, 'itemId'),
              description: text(row, 'description'),
              origin: text(row, 'countryOfOrigin'),
              unit: text(row, 'unit'),
              quantity: text(row, 'quantity', fallback: '1'),
              unitPrice: text(row, 'unitPrice', fallback: '0'),
              customValues: customValues,
            ),
          );
        }
        if (table.lines.isEmpty) table.lines.add(_QLineDraft());
        _tables.add(table);
      }
      if (_tables.isEmpty) {
        final table = _QTableDraft();
        table.columns.addAll(_columnsFrom(quotation['columns']));
        _tables.add(table);
      }
      _discountKind = discountKindOf(text(quotation, 'discountType'));
      _discountValue.text = _discountKind == DiscountKind.percent
          ? text(quotation, 'discountPercent', fallback: '')
          : text(quotation, 'discountAmount', fallback: '');
      if (_discountValue.text == '0.0000') _discountValue.clear();
      if (_discountKind == DiscountKind.none) _discountValue.clear();
      _terms.text = text(quotation, 'terms');
      _notes.text = text(quotation, 'notes');
      _subject.text = text(quotation, 'subject');
      _showTaxId = quotation['showTaxId'] != false;
      for (final column in _columns) {
        column.dispose();
      }
      _columns
        ..clear()
        ..addAll(_columnsFrom(quotation['columns']));
      _managerName.text = text(quotation, 'managerName');
      _responsibleName.text = text(quotation, 'responsibleName');
      _responsiblePhone.text = text(quotation, 'responsiblePhone');
      setState(() {
        _customerId = text(
          Map<String, dynamic>.from(quotation['customer'] as Map? ?? const {}),
          'id',
        );
        if (_customerId!.isEmpty) _customerId = null;
        _currency = text(quotation, 'currency', fallback: 'EGP');
        _date = text(quotation, 'quotationDate', fallback: _date);
        final valid = text(quotation, 'validUntil');
        _validUntil = valid.isEmpty ? null : valid;
        final rawDesign = quotation['design'];
        if (rawDesign is Map) {
          _design = QuotationDocumentDesign.fromJson(
            rawDesign as Map<String, dynamic>,
          );
        }
        _loading = false;
      });
    } on Failure catch (error) {
      if (!mounted) return;
      setState(() => _loading = false);
      showMessage(context, error.message, error: true);
    }
  }

  /// The column catalogue, in the order the picker offers it.
  static const _columnKeys = [
    'itemCode',
    'description',
    'countryOfOrigin',
    'unit',
    'quantity',
    'unitPrice',
    'lineTotal',
  ];

  /// The six columns every offer printed before layouts were configurable.
  List<_QColumnDraft> _standardColumns() => [
    for (final entry in const [
      ('description', 4, false),
      ('countryOfOrigin', 2, false),
      ('unit', 1, false),
      ('quantity', 1, true),
      ('unitPrice', 2, true),
      ('lineTotal', 2, true),
    ])
      _QColumnDraft(key: entry.$1, width: entry.$2, numeric: entry.$3),
  ];

  /// Reads the stored layout. Any key is accepted — built-in keys and
  /// user-defined keys alike. An offer saved before this feature has none, so
  /// it starts from the standard six rather than from an empty table.
  List<_QColumnDraft> _columnsFrom(Object? raw) {
    final rows = listOf(raw);
    if (rows.isEmpty) return _standardColumns();
    return [
      for (final row in rows)
        if (text(row, 'key').isNotEmpty)
          _QColumnDraft(
            key: text(row, 'key'),
            labelEn: text(row, 'labelEn'),
            labelAr: text(row, 'labelAr'),
            visible: row['visible'] != false,
            width: (asNum(row['width']) ?? 2).toInt(),
            numeric: row['numeric'] == true,
          ),
    ];
  }

  String _columnName(String key) {
    final l10n = context.l10n;
    return switch (key) {
      'itemCode' => l10n.itemCode,
      'description' => l10n.description,
      'countryOfOrigin' => l10n.countryOfOrigin,
      'unit' => l10n.unit,
      'quantity' => l10n.quantity,
      'unitPrice' => l10n.unitPrice,
      _ => l10n.lineTotal,
    };
  }

  /// The offer's layout as it will be stored: order, labels, visibility.
  List<Map<String, dynamic>> _columnBody() => _columnBodyFor(_columns);

  List<Map<String, dynamic>> _columnBodyFor(List<_QColumnDraft> source) => [
    for (final column in source)
      {
        'key': column.key,
        if (column.labelEn.text.trim().isNotEmpty)
          'labelEn': column.labelEn.text.trim(),
        if (column.labelAr.text.trim().isNotEmpty)
          'labelAr': column.labelAr.text.trim(),
        'visible': column.visible,
        'width': column.width,
        if (column.numeric) 'numeric': true,
      },
  ];

  /// Copies a saved entry's text onto this quotation. The copy is what the
  /// document stores, so editing the library later cannot rewrite it.
  void _insertSavedTerm(Json term) {
    final body = text(term, 'body');
    if (body.isEmpty) return;
    setState(() => _terms.text = body);
    showMessage(context, context.l10n.termsInserted);
  }

  Future<void> _saveTermsToLibrary() async {
    final l10n = context.l10n;
    final body = _terms.text.trim();
    if (body.isEmpty) {
      showMessage(context, l10n.termsBody, error: true);
      return;
    }
    final titleController = TextEditingController();
    final title = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.saveTermsToLibrary),
        content: TextField(
          controller: titleController,
          autofocus: true,
          decoration: InputDecoration(
            labelText: l10n.termsTitle,
            border: const OutlineInputBorder(),
          ),
          onSubmitted: (value) => Navigator.of(dialogContext).pop(value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(titleController.text),
            child: Text(l10n.save),
          ),
        ],
      ),
    );
    if (title == null || title.trim().isEmpty || !mounted) return;
    try {
      await ref.read(apiClientProvider).post(
        '/sales/quotation-terms',
        body: {'title': title.trim(), 'body': body},
      );
      ref.invalidate(quotationTermsProvider);
      if (mounted) showMessage(context, l10n.termsSaved);
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    }
  }

  Future<void> _openTermsLibrary() async {
    await showDialog<void>(
      context: context,
      builder: (_) => _QuotationTermsDialog(onUse: _insertSavedTerm),
    );
  }

  @override
  void dispose() {
    for (final table in _tables) {
      table.dispose();
    }
    _discountValue.dispose();
    _subject.dispose();
    for (final column in _columns) {
      column.dispose();
    }
    _terms.dispose();
    _notes.dispose();
    _managerName.dispose();
    _responsibleName.dispose();
    _responsiblePhone.dispose();
    super.dispose();
  }

  List<Decimal> get _tableNets =>
      _tables.map((table) => table.net).toList(growable: false);

  ResolvedDiscount get _documentDiscount {
    final base = _tableNets.fold(Decimal.zero, (sum, net) => sum + net);
    return resolveDiscount(
      base,
      _discountKind,
      Decimal.tryParse(_discountValue.text.trim()),
    );
  }

  Future<void> _pickDate({required bool validUntil}) async {
    final current = validUntil ? _validUntil : _date;
    final picked = await showDatePicker(
      context: context,
      initialDate: current == null ? DateTime.now() : DateTime.parse(current),
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked == null || !mounted) return;
    final iso = '${picked.year.toString().padLeft(4, '0')}-'
        '${picked.month.toString().padLeft(2, '0')}-'
        '${picked.day.toString().padLeft(2, '0')}';
    setState(() {
      if (validUntil) {
        _validUntil = iso;
      } else {
        _date = iso;
      }
    });
  }

  /// A dropdown may only start on a value it lists. A customer that has since
  /// been deactivated keeps its quotation working without a change.
  String? _choice(List<Json> rows, String? id) {
    if (id == null || id.isEmpty) return null;
    return rows.any((row) => text(row, 'id') == id) ? id : null;
  }

  void _applyItem(_QLineDraft line, Json item, String language) {
    final name = language == 'ar' && text(item, 'nameAr').isNotEmpty
        ? text(item, 'nameAr')
        : text(item, 'nameEn');
    if (line.description.text.trim().isEmpty) line.description.text = name;
    if (line.unit.text.trim().isEmpty) line.unit.text = text(item, 'unit');
    if (line.origin.text.trim().isEmpty) {
      // Only ever the item's own registered origin; never guessed.
      line.origin.text = text(item, 'countryOfOrigin');
    }
    if (line.unitPrice.text.trim().isEmpty ||
        line.unitPrice.text.trim() == '0') {
      line.unitPrice.text = formatQuantity(text(item, 'salePrice'), decimals: 2);
    }
  }

  Future<void> _save() async {
    final l10n = context.l10n;
    if (_customerId == null) {
      showMessage(context, l10n.selectCustomer, error: true);
      return;
    }
    final tables = <Json>[];
    for (final table in _tables) {
      final title = table.title.text.trim();
      if (title.isEmpty) {
        showMessage(context, l10n.tableTitle, error: true);
        return;
      }
      final lines = <Json>[];
      for (final line in table.lines) {
        final quantity = line.quantity.text.trim();
        final parsed = Decimal.tryParse(quantity);
        if (line.description.text.trim().isEmpty && line.itemId == null) continue;
        if (parsed == null || parsed <= Decimal.zero) {
          showMessage(context, l10n.mustBePositive, error: true);
          return;
        }
        lines.add({
          'itemId': ?line.itemId,
          'description': line.description.text.trim(),
          'countryOfOrigin': line.origin.text.trim(),
          'unit': line.unit.text.trim(),
          'quantity': quantity,
          'unitPrice': line.unitPrice.text.trim().isEmpty
              ? '0'
              : line.unitPrice.text.trim(),
          if (line.customValues.isNotEmpty)
            'customValues': line.customValues,
        });
      }
      if (lines.isEmpty) {
        showMessage(context, l10n.quotationNeedsTable, error: true);
        return;
      }
      final discountText = table.discountValue.text.trim();
      tables.add({
        'title': title,
        'columns': _columnBodyFor(table.columns.isEmpty ? _columns : table.columns),
        'discountType': ?discountTypeOf(table.discountKind),
        if (table.discountKind == DiscountKind.percent &&
            discountText.isNotEmpty)
          'discountPercent': discountText,
        if (table.discountKind == DiscountKind.amount && discountText.isNotEmpty)
          'discountAmount': discountText,
        'lines': lines,
      });
    }
    if (tables.isEmpty) {
      showMessage(context, l10n.quotationNeedsTable, error: true);
      return;
    }

    if (_tables.any((table) =>
        !(table.columns.isEmpty ? _columns : table.columns)
            .any((column) => column.visible))) {
      showMessage(context, l10n.keepOneColumnVisible, error: true);
      return;
    }

    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        'quotationDate': _date,
        'validUntil': ?_validUntil,
        'customerId': _customerId,
        'currency': _currency,
        'terms': _terms.text.trim(),
        'notes': _notes.text.trim(),
        'subject': _subject.text.trim(),
        'showTaxId': _showTaxId,
        'columns': _columnBody(),
        if (_design.toJson().isNotEmpty) 'design': _design.toJson(),
        'discountType': ?discountTypeOf(_discountKind),
        if (_discountKind == DiscountKind.percent &&
            _discountValue.text.trim().isNotEmpty)
          'discountPercent': _discountValue.text.trim(),
        if (_discountKind == DiscountKind.amount &&
            _discountValue.text.trim().isNotEmpty)
          'discountAmount': _discountValue.text.trim(),
        'managerName': _managerName.text.trim(),
        'responsibleName': _responsibleName.text.trim(),
        'responsiblePhone': _responsiblePhone.text.trim(),
        'tables': tables,
      };
      if (widget.quotationId == null) {
        await ref.read(apiClientProvider).post('/sales/quotations', body: body);
      } else {
        await ref
            .read(apiClientProvider)
            .put('/sales/quotations/${widget.quotationId}', body: body);
      }
      ref.invalidate(quotationsProvider);
      if (mounted) {
        showMessage(context, l10n.quotationSaved);
        context.go(AppRoutes.quotations);
      }
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final language = Localizations.localeOf(context).languageCode;
    // Inactive records are included so an old quotation can still be opened
    // without the dropdown asserting on a value it no longer offers.
    final customers = ref.watch(customersProvider).value ?? const <Json>[];
    final items = ref.watch(itemsProvider).value ?? const <Json>[];
    final savedTerms = ref.watch(quotationTermsProvider).value ?? const <Json>[];

    // The screen lives inside the application shell, which already draws the
    // window chrome. A second AppBar would put two titles on one page, so the
    // editor uses the same header band as every list screen.
    return Scaffold(
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          PageHeader(
            dense: true,
            title: widget.quotationId == null
                ? l10n.newQuotation
                : l10n.editQuotation,
            actions: [
              FilledButton.icon(
                onPressed: _saving || _loading ? null : _save,
                icon: const Icon(Icons.save_outlined, size: 17),
                label: Text(l10n.save),
              ),
            ],
          ),
          Container(
            height: 1,
            color: Theme.of(context).colorScheme.outlineVariant,
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : ListView(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    children: [
                Text(
                  l10n.quotationDraftHint,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      children: [
                        Wrap(
                          spacing: 12,
                          runSpacing: 12,
                          children: [
                            SizedBox(
                              width: 300,
                              child: DropdownButtonFormField<String>(
                                initialValue: _choice(customers, _customerId),
                                isExpanded: true,
                                decoration: InputDecoration(
                                  labelText: l10n.customer,
                                  border: const OutlineInputBorder(),
                                  isDense: true,
                                ),
                                items: [
                                  for (final customer in customers)
                                    DropdownMenuItem(
                                      value: text(customer, 'id'),
                                      child: Text(
                                        '${text(customer, 'code')} — '
                                        '${text(customer, 'nameEn')}',
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                ],
                                onChanged: (value) =>
                                    setState(() => _customerId = value),
                              ),
                            ),
                            SizedBox(
                              width: 180,
                              child: OutlinedButton.icon(
                                onPressed: () => _pickDate(validUntil: false),
                                icon: const Icon(Icons.event),
                                label: Text('${l10n.quotationDate}: $_date'),
                              ),
                            ),
                            SizedBox(
                              width: 200,
                              child: OutlinedButton.icon(
                                onPressed: () => _pickDate(validUntil: true),
                                icon: const Icon(Icons.event_available),
                                label: Text(
                                  _validUntil == null
                                      ? l10n.validUntil
                                      : '${l10n.validUntil}: $_validUntil',
                                ),
                              ),
                            ),
                            SizedBox(
                              width: 120,
                              child: TextFormField(
                                initialValue: _currency,
                                decoration: InputDecoration(
                                  labelText: l10n.currency,
                                  border: const OutlineInputBorder(),
                                  isDense: true,
                                ),
                                onChanged: (value) =>
                                    setState(() => _currency = value.toUpperCase()),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _terms,
                          minLines: 2,
                          maxLines: 6,
                          decoration: InputDecoration(
                            labelText: l10n.termsAndConditions,
                            border: const OutlineInputBorder(),
                          ),
                        ),
                        Wrap(
                          spacing: 8,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            PopupMenuButton<Json>(
                              tooltip: l10n.insertSavedTerms,
                              enabled: savedTerms.isNotEmpty,
                              onSelected: _insertSavedTerm,
                              itemBuilder: (context) => [
                                for (final term in savedTerms)
                                  PopupMenuItem<Json>(
                                    value: term,
                                    child: ListTile(
                                      dense: true,
                                      contentPadding: EdgeInsets.zero,
                                      title: Text(text(term, 'title')),
                                      subtitle: Text(
                                        text(term, 'body'),
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                  ),
                              ],
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 10,
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Icon(Icons.playlist_add, size: 18),
                                    const SizedBox(width: 6),
                                    Text(l10n.insertSavedTerms),
                                  ],
                                ),
                              ),
                            ),
                            TextButton.icon(
                              onPressed: _saveTermsToLibrary,
                              icon: const Icon(Icons.bookmark_add_outlined, size: 18),
                              label: Text(l10n.saveTermsToLibrary),
                            ),
                            TextButton.icon(
                              onPressed: _openTermsLibrary,
                              icon: const Icon(Icons.library_books_outlined, size: 18),
                              label: Text(l10n.manageSavedTerms),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        TextField(
                          controller: _notes,
                          minLines: 1,
                          maxLines: 4,
                          decoration: InputDecoration(
                            labelText: l10n.notesLabel,
                            helperText: l10n.optional,
                            border: const OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          key: const ValueKey('quotation-subject'),
                          controller: _subject,
                          maxLength: 200,
                          decoration: InputDecoration(
                            labelText: l10n.subject,
                            helperText: l10n.subjectHint,
                            border: const OutlineInputBorder(),
                            isDense: true,
                          ),
                        ),
                        SwitchListTile(
                          key: const ValueKey('quotation-show-tax-number'),
                          contentPadding: EdgeInsets.zero,
                          value: _showTaxId,
                          onChanged: (value) =>
                              setState(() => _showTaxId = value),
                          title: Text(l10n.showTaxNumberOnOffer),
                          subtitle: Text(l10n.showTaxNumberOnOfferHint),
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 12,
                          runSpacing: 12,
                          children: [
                            SizedBox(
                              width: 220,
                              child: TextField(
                                controller: _managerName,
                                decoration: InputDecoration(
                                  labelText: l10n.managerName,
                                  border: const OutlineInputBorder(),
                                  isDense: true,
                                ),
                              ),
                            ),
                            SizedBox(
                              width: 220,
                              child: TextField(
                                controller: _responsibleName,
                                decoration: InputDecoration(
                                  labelText: l10n.responsibleName,
                                  border: const OutlineInputBorder(),
                                  isDense: true,
                                ),
                              ),
                            ),
                            SizedBox(
                              width: 200,
                              child: TextField(
                                controller: _responsiblePhone,
                                decoration: InputDecoration(
                                  labelText: l10n.responsiblePhone,
                                  border: const OutlineInputBorder(),
                                  isDense: true,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                _designCard(context),
                _columnsCard(context),
                const SizedBox(height: 12),
                for (var index = 0; index < _tables.length; index++)
                  _tableCard(index, language, items),
                Center(
                  child: TextButton.icon(
                    onPressed: () =>
                        setState(() {
                      final table = _QTableDraft();
                      table.columns.addAll(_columnsFrom(_columnBody()));
                      _tables.add(table);
                    }),
                    icon: const Icon(Icons.add),
                    label: Text(l10n.addTable),
                  ),
                ),
                const SizedBox(height: 8),
                _summary(context),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  Widget _designCard(BuildContext context) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            const Icon(Icons.palette_outlined),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(arabic ? 'تنسيق عناصر عرض السعر' : 'Quotation element styling',
                      style: Theme.of(context).textTheme.titleSmall),
                  const SizedBox(height: 4),
                  Text(
                    arabic ? 'حجم الخط وسمكه ولونه ونوعه لكل عنصر بشكل مستقل'
                        : 'Set font size, weight, colour and family for each element',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            OutlinedButton.icon(
              key: const ValueKey('edit-quotation-design'),
              onPressed: _editDesign,
              icon: const Icon(Icons.tune, size: 18),
              label: Text(arabic ? 'تخصيص التصميم' : 'Customize'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _editDesign() async {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final elements = <({String key, String ar, String en})>[
      (key: 'company', ar: 'اسم الشركة', en: 'Company name'),
      (key: 'title', ar: 'عنوان العرض', en: 'Quotation title'),
      (key: 'customer', ar: 'بيانات العميل', en: 'Customer details'),
      (key: 'sectionTitle', ar: 'عناوين الجداول', en: 'Table titles'),
      (key: 'tableHeader', ar: 'رؤوس الأعمدة', en: 'Table headers'),
      (key: 'tableCell', ar: 'خلايا الجداول', en: 'Table cells'),
      (key: 'totalsLabel', ar: 'عناوين الإجماليات', en: 'Totals labels'),
      (key: 'totalsValue', ar: 'قيم الإجماليات', en: 'Totals values'),
      (key: 'finalTotal', ar: 'الإجمالي النهائي', en: 'Grand total'),
      (key: 'header', ar: 'رأس العرض', en: 'Header'),
      (key: 'footer', ar: 'تذييل العرض', en: 'Footer'),
    ];
    final working = Map<String, dynamic>.from(_design.toJson());
    final colorController = TextEditingController();
    final backgroundController = TextEditingController();
    final borderController = TextEditingController();
    var palette = 'blue';
    final headerTextController = TextEditingController(text: _design.headerText ?? '');
    final footerTextController = TextEditingController(text: _design.footerText ?? '');
    var selected = 'company';
    var multiplier = 1.0;
    var weight = 'w600';
    var family = 'Tahoma';
    var lineHeight = 1.3;
    var textAlign = 'start';
    var showHeader = _design.showHeader;
    var showFooter = _design.showFooter;

    void loadElement(String key) {
      final raw = working[key];
      final style = raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
      multiplier = (style['fontSizeMultiplier'] as num?)?.toDouble() ?? 1.0;
      weight = (style['fontWeight'] as String?)?.split('.').last ?? 'w600';
      family = style['fontFamily'] as String? ?? 'Tahoma';
      lineHeight = (style['lineHeight'] as num?)?.toDouble() ?? 1.3;
      textAlign = style['textAlign'] as String? ?? 'start';
      colorController.text = style['color'] as String? ?? '#1e60aa';
      backgroundController.text = style['backgroundColor'] as String? ?? '';
      borderController.text = style['borderColor'] as String? ?? ''; 
    }
    loadElement(selected);

    try {
      final saved = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            title: Text(arabic ? 'تخصيص تصميم العرض' : 'Customize quotation design'),
            content: SizedBox(
              width: 520,
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    DropdownButtonFormField<String>(
                      initialValue: palette,
                      decoration: InputDecoration(
                        labelText: arabic ? 'قالب الألوان الجاهز' : 'Colour preset',
                        border: const OutlineInputBorder(),
                      ),
                      items: [
                        DropdownMenuItem(value: 'blue', child: Text(arabic ? 'أزرق احترافي' : 'Professional blue')),
                        DropdownMenuItem(value: 'green', child: Text(arabic ? 'أخضر شركات' : 'Business green')),
                        DropdownMenuItem(value: 'burgundy', child: Text(arabic ? 'عنابي' : 'Burgundy')),
                        DropdownMenuItem(value: 'graphite', child: Text(arabic ? 'رمادي فحمي' : 'Graphite')),
                      ],
                      onChanged: (value) {
                        if (value == null) return;
                        final primary = switch (value) {
                          'green' => '#18794e',
                          'burgundy' => '#8b1e3f',
                          'graphite' => '#374151',
                          _ => '#1e60aa',
                        };
                        for (final key in ['company', 'title', 'customer', 'sectionTitle', 'totalsLabel', 'totalsValue', 'header', 'footer']) {
                          final raw = working[key];
                          final style = raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
                          style['color'] = primary;
                          working[key] = style;
                        }
                        final headerRaw = working['tableHeader'];
                        final headerStyle = headerRaw is Map ? Map<String, dynamic>.from(headerRaw) : <String, dynamic>{};
                        headerStyle['color'] = '#ffffff';
                        headerStyle['backgroundColor'] = primary;
                        working['tableHeader'] = headerStyle;
                        final totalRaw = working['finalTotal'];
                        final totalStyle = totalRaw is Map ? Map<String, dynamic>.from(totalRaw) : <String, dynamic>{};
                        totalStyle['color'] = '#ffffff';
                        totalStyle['backgroundColor'] = primary;
                        working['finalTotal'] = totalStyle;
                        setDialogState(() {
                          palette = value;
                          loadElement(selected);
                        });
                      },
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: selected,
                      isExpanded: true,
                      decoration: InputDecoration(
                        labelText: arabic ? 'العنصر المطلوب تنسيقه' : 'Element to style',
                        border: const OutlineInputBorder(),
                      ),
                      items: [
                        for (final item in elements)
                          DropdownMenuItem(value: item.key, child: Text(arabic ? item.ar : item.en)),
                      ],
                      onChanged: (value) {
                        if (value == null) return;
                        setDialogState(() {
                          selected = value;
                          loadElement(value);
                        });
                      },
                    ),
                    const SizedBox(height: 16),
                    Text('${arabic ? 'حجم الخط: ' : 'Font size: '}${(multiplier * 100).round()}%'),
                    Slider(
                      value: multiplier.clamp(0.7, 1.6).toDouble(),
                      min: 0.7,
                      max: 1.6,
                      divisions: 18,
                      onChanged: (value) => setDialogState(() => multiplier = value),
                    ),
                    DropdownButtonFormField<String>(
                      initialValue: weight,
                      decoration: InputDecoration(
                        labelText: arabic ? 'سمك الخط' : 'Font weight',
                        border: const OutlineInputBorder(),
                      ),
                      items: [
                        DropdownMenuItem(value: 'w400', child: Text(arabic ? 'عادي' : 'Regular')),
                        DropdownMenuItem(value: 'w500', child: Text(arabic ? 'متوسط' : 'Medium')),
                        DropdownMenuItem(value: 'w600', child: Text(arabic ? 'شبه عريض' : 'Semi-bold')),
                        DropdownMenuItem(value: 'w700', child: Text(arabic ? 'عريض' : 'Bold')),
                        DropdownMenuItem(value: 'w800', child: Text(arabic ? 'عريض جدًا' : 'Extra bold')),
                      ],
                      onChanged: (value) => setDialogState(() => weight = value ?? 'w600'),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: family,
                      decoration: InputDecoration(
                        labelText: arabic ? 'نوع الخط' : 'Font family',
                        border: const OutlineInputBorder(),
                      ),
                      items: const [
                        DropdownMenuItem(value: 'Tahoma', child: Text('Tahoma')),
                        DropdownMenuItem(value: 'Arial', child: Text('Arial')),
                        DropdownMenuItem(value: 'Segoe UI', child: Text('Segoe UI')),
                      ],
                      onChanged: (value) => setDialogState(() => family = value ?? 'Tahoma'),
                    ),
                    const SizedBox(height: 12),
                    Text('${arabic ? 'تباعد الأسطر' : 'Line spacing'}: ${lineHeight.toStringAsFixed(1)}'),
                    Slider(
                      value: lineHeight.clamp(1.0, 2.0).toDouble(),
                      min: 1.0,
                      max: 2.0,
                      divisions: 10,
                      onChanged: (value) => setDialogState(() => lineHeight = value),
                    ),
                    DropdownButtonFormField<String>(
                      initialValue: textAlign,
                      decoration: InputDecoration(
                        labelText: arabic ? 'محاذاة النص' : 'Text alignment',
                        border: const OutlineInputBorder(),
                      ),
                      items: [
                        DropdownMenuItem(value: 'start', child: Text(arabic ? 'بداية السطر' : 'Start')),
                        DropdownMenuItem(value: 'center', child: Text(arabic ? 'توسيط' : 'Center')),
                        DropdownMenuItem(value: 'end', child: Text(arabic ? 'نهاية السطر' : 'End')),
                        DropdownMenuItem(value: 'justify', child: Text(arabic ? 'ضبط النص' : 'Justify')),
                      ],
                      onChanged: (value) => setDialogState(() => textAlign = value ?? 'start'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: colorController,
                      decoration: InputDecoration(
                        labelText: arabic ? 'لون النص (HEX)' : 'Text colour (HEX)',
                        hintText: '#1e60aa',
                        border: const OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: backgroundController,
                      decoration: InputDecoration(
                        labelText: arabic ? 'لون الخلفية (HEX)' : 'Background colour (HEX)',
                        hintText: '#eff4ff',
                        border: const OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: borderController,
                      decoration: InputDecoration(
                        labelText: arabic ? 'لون الحدود (HEX)' : 'Border colour (HEX)',
                        hintText: '#d1d5db',
                        border: const OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 16),
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      value: showHeader,
                      title: Text(arabic ? 'إظهار رأس العرض' : 'Show custom header'),
                      onChanged: (value) => setDialogState(() => showHeader = value ?? true),
                    ),
                    TextField(
                      controller: headerTextController,
                      minLines: 1,
                      maxLines: 3,
                      decoration: InputDecoration(
                        labelText: arabic ? 'نص رأس العرض' : 'Header text',
                        border: const OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 8),
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      value: showFooter,
                      title: Text(arabic ? 'إظهار تذييل العرض' : 'Show custom footer'),
                      onChanged: (value) => setDialogState(() => showFooter = value ?? true),
                    ),
                    TextField(
                      controller: footerTextController,
                      minLines: 1,
                      maxLines: 3,
                      decoration: InputDecoration(
                        labelText: arabic ? 'نص تذييل العرض' : 'Footer text',
                        border: const OutlineInputBorder(),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: Text(arabic ? 'إلغاء' : 'Cancel'),
              ),
              FilledButton(
                onPressed: () {
                  working['headerText'] = headerTextController.text.trim();
                  working['footerText'] = footerTextController.text.trim();
                  working['showHeader'] = showHeader;
                  working['showFooter'] = showFooter;
                  final colour = colorController.text.trim();
                  working[selected] = {
                    'fontSizeMultiplier': multiplier,
                    'fontWeight': weight,
                    'fontFamily': family,
                    if (colour.startsWith('#') && colour.length == 7) 'color': colour,
                    if (backgroundController.text.trim().startsWith('#') && backgroundController.text.trim().length == 7) 'backgroundColor': backgroundController.text.trim(),
                    'lineHeight': lineHeight,
                    'textAlign': textAlign,
                    if (borderController.text.trim().startsWith('#') && borderController.text.trim().length == 7) 'borderColor': borderController.text.trim(),
                  };
                  Navigator.of(dialogContext).pop(true);
                },
                child: Text(arabic ? 'حفظ التنسيق' : 'Save style'),
              ),
            ],
          ),
        ),
      );
      if (saved == true && mounted) {
        setState(() => _design = QuotationDocumentDesign.fromJson(working));
      }
    } finally {
      colorController.dispose();
      backgroundController.dispose();
      borderController.dispose();
      headerTextController.dispose();
      footerTextController.dispose();
    }
  }

  /// The line columns this offer prints, and the button that changes them.
  Widget _columnsCard(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final language = Localizations.localeOf(context).languageCode;
    final visible = _columns.where((column) => column.visible).toList();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.quotationColumns, style: theme.textTheme.titleSmall),
                  const SizedBox(height: 4),
                  Text(
                    visible.isEmpty
                        ? l10n.keepOneColumnVisible
                        : visible
                              .map(
                                (column) =>
                                    '${_columnLabel(column, language)} '
                                    '(${column.width})',
                              )
                              .join(' · '),
                    style: theme.textTheme.bodySmall,
                  ),
                  const SizedBox(height: 2),
                  Text(l10n.columnLayoutHint, style: theme.textTheme.bodySmall),
                ],
              ),
            ),
            const SizedBox(width: 8),
            OutlinedButton.icon(
              key: const ValueKey('edit-columns'),
              onPressed: _editColumns,
              icon: const Icon(Icons.view_column_outlined, size: 18),
              label: Text(l10n.columnLayout),
            ),
          ],
        ),
      ),
    );
  }

  /// The label the offer prints for a column: its own text when set, the
  /// built-in translation otherwise.
  String _columnLabel(_QColumnDraft column, String language) {
    final override = language == 'ar' ? column.labelAr.text : column.labelEn.text;
    if (override.trim().isNotEmpty) return override.trim();
    return _columnName(column.key);
  }

  /// Changes the layout on a working copy, so Cancel really cancels. A saved
  /// template is a starting point; the offer keeps its own copy of whatever
  /// was applied.
  Future<void> _editColumns({List<_QColumnDraft>? target}) async {
    final targetColumns = target ?? _columns;
    final l10n = context.l10n;
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final available = [
      ...?ref.read(quotationColumnTemplatesProvider).value,
    ];
    final working = [for (final column in targetColumns) column.copy()];
    final templateName = TextEditingController();
    String? templateId;
    String templateDisplayName = '';
    Map<String, dynamic>? templateDesign;
    try {
      final saved = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) {
            return AlertDialog(
              title: Text(l10n.columnLayout),
              content: SizedBox(
                width: 760,
                height: 560,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: DropdownButtonFormField<String>(
                            key: const ValueKey('column-template'),
                            initialValue: templateId,
                            isExpanded: true,
                            decoration: InputDecoration(
                              labelText: l10n.columnTemplate,
                              border: const OutlineInputBorder(),
                              isDense: true,
                            ),
                            items: [
                              for (final template in available)
                                DropdownMenuItem(
                                  value: text(template, 'id'),
                                  child: Text(
                                    text(template, 'name'),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                            ],
                            onChanged: available.isEmpty
                                ? null
                                : (value) {
                                    if (value == null) return;
                                    final template = available.firstWhere(
                                      (row) => text(row, 'id') == value,
                                      orElse: () => const {},
                                    );
                                    if (template.isEmpty) return;
                                    for (final column in working) {
                                      column.dispose();
                                    }
                                    working
                                      ..clear()
                                      ..addAll(_columnsFrom(template['columns']));
                                    final rawDesign = template['design'];
                                    templateDesign = rawDesign is Map
                                        ? Map<String, dynamic>.from(rawDesign)
                                        : null;
                                    setDialogState(() {
                                      templateId = value;
                                      templateDisplayName = text(template, 'name');
                                    });
                                  },
                          ),
                        ),
                        const SizedBox(width: 8),
                        PopupMenuButton<String>(
                          key: const ValueKey('add-column'),
                          tooltip: l10n.addColumn,
                          onSelected: (key) {
                            if (key == '_custom') {
                              _addCustomColumnDialog(setDialogState, working);
                              return;
                            }
                            setDialogState(() {
                              if (!working.any((c) => c.key == key)) {
                                working.add(_QColumnDraft(key: key));
                              }
                            });
                          },
                          itemBuilder: (context) => [
                            for (final key in _columnKeys)
                              if (!working.any((column) => column.key == key))
                                PopupMenuItem(
                                  value: key,
                                  child: Text(_columnName(key)),
                                ),
                            const PopupMenuItem(
                              value: '_custom',
                              child: Text('أعمدة مخصصة / Custom column…'),
                            ),
                          ],
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 12,
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.add, size: 18),
                                const SizedBox(width: 4),
                                Text(l10n.addColumn),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Expanded(
                      child: working.isEmpty
                          ? Center(child: Text(l10n.keepOneColumnVisible))
                          : ListView.separated(
                              itemCount: working.length,
                              separatorBuilder: (_, _) =>
                                  const Divider(height: 12),
                              itemBuilder: (context, index) {
                                final column = working[index];
                                return Row(
                                  children: [
                                    Checkbox(
                                      key: ValueKey(
                                        'column-visible-${column.key}',
                                      ),
                                      value: column.visible,
                                      onChanged: (value) => setDialogState(
                                        () => column.visible = value ?? true,
                                      ),
                                    ),
                                    Expanded(
                                      child: Text(
                                        _columnName(column.key),
                                        style: Theme.of(
                                          context,
                                        ).textTheme.bodyMedium,
                                      ),
                                    ),
                                    SizedBox(
                                      width: 130,
                                      child: TextField(
                                        key: ValueKey(
                                          'column-label-en-${column.key}',
                                        ),
                                        controller: column.labelEn,
                                        decoration: InputDecoration(
                                          labelText: l10n.columnLabelEn,
                                          border: const OutlineInputBorder(),
                                          isDense: true,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    SizedBox(
                                      width: 130,
                                      child: TextField(
                                        key: ValueKey(
                                          'column-label-ar-${column.key}',
                                        ),
                                        controller: column.labelAr,
                                        decoration: InputDecoration(
                                          labelText: l10n.columnLabelAr,
                                          border: const OutlineInputBorder(),
                                          isDense: true,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    SizedBox(
                                      width: 78,
                                      child: DropdownButtonFormField<int>(
                                        key: ValueKey(
                                          'column-width-${column.key}',
                                        ),
                                        initialValue: column.width,
                                        decoration: InputDecoration(
                                          labelText: l10n.columnWidth,
                                          border: const OutlineInputBorder(),
                                          isDense: true,
                                        ),
                                        items: [
                                          for (var width = 1; width <= 6; width++)
                                            DropdownMenuItem(
                                              value: width,
                                              child: Text('$width'),
                                            ),
                                        ],
                                        onChanged: (value) => setDialogState(
                                          () => column.width = value ?? 2,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Checkbox(
                                      key: ValueKey(
                                        'column-numeric-${column.key}',
                                      ),
                                      value: column.numeric,
                                      onChanged: (value) => setDialogState(
                                        () => column.numeric = value ?? false,
                                      ),
                                    ),
                                    SizedBox(
                                      width: 60,
                                      child: Text(
                                        l10n.columnNumeric,
                                        style: Theme.of(context)
                                            .textTheme
                                            .bodySmall,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                    IconButton(
                                      key: ValueKey('column-up-${column.key}'),
                                      tooltip: l10n.moveUp,
                                      onPressed: index == 0
                                          ? null
                                          : () => setDialogState(() {
                                              final moved = working.removeAt(
                                                index,
                                              );
                                              working.insert(index - 1, moved);
                                            }),
                                      icon: const Icon(
                                        Icons.arrow_upward,
                                        size: 18,
                                      ),
                                    ),
                                    IconButton(
                                      key: ValueKey(
                                        'column-down-${column.key}',
                                      ),
                                      tooltip: l10n.moveDown,
                                      onPressed: index == working.length - 1
                                          ? null
                                          : () => setDialogState(() {
                                              final moved = working.removeAt(
                                                index,
                                              );
                                              working.insert(index + 1, moved);
                                            }),
                                      icon: const Icon(
                                        Icons.arrow_downward,
                                        size: 18,
                                      ),
                                    ),
                                    IconButton(
                                      key: ValueKey(
                                        'column-delete-${column.key}',
                                      ),
                                      tooltip: l10n.removeColumn,
                                      onPressed: working.length == 1
                                          ? null
                                          : () => setDialogState(
                                              () => working
                                                  .removeAt(index)
                                                  .dispose(),
                                            ),
                                      icon: const Icon(
                                        Icons.delete_outline,
                                        size: 18,
                                      ),
                                    ),
                                  ],
                                );
                              },
                            ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            key: const ValueKey('column-template-name'),
                            controller: templateName,
                            decoration: InputDecoration(
                              labelText: l10n.templateName,
                              border: const OutlineInputBorder(),
                              isDense: true,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        OutlinedButton.icon(
                          key: const ValueKey('save-column-template'),
                          onPressed: () async {
                            final name = templateName.text.trim();
                            if (name.isEmpty) {
                              showMessage(
                                dialogContext,
                                l10n.templateName,
                                error: true,
                              );
                              return;
                            }
                            final saved = await _saveColumnTemplate(
                              name,
                              working,
                              design: templateDesign ?? _design.toJson(),
                            );
                            if (saved != null && dialogContext.mounted) {
                              setDialogState(() {
                                available.add(saved);
                                templateName.clear();
                              });
                            }
                          },
                          icon: const Icon(Icons.bookmark_add_outlined, size: 18),
                          label: Text(l10n.saveColumnTemplate),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        OutlinedButton.icon(
                          key: const ValueKey('update-column-template'),
                          onPressed: templateId == null ? null : () async {
                            final name = templateName.text.trim().isEmpty ? templateDisplayName : templateName.text.trim();
                            try {
                              await ref.read(apiClientProvider).put(
                                '/sales/quotation-column-templates/$templateId',
                                body: {
                                  'name': name,
                                  'design': templateDesign ?? _design.toJson(),
                                  'columns': [for (final column in working) {
                                    'key': column.key,
                                    if (column.labelEn.text.trim().isNotEmpty) 'labelEn': column.labelEn.text.trim(),
                                    if (column.labelAr.text.trim().isNotEmpty) 'labelAr': column.labelAr.text.trim(),
                                    'visible': column.visible,
                                    'width': column.width,
                                    'numeric': column.numeric,
                                  }],
                                },
                              );
                              ref.invalidate(quotationColumnTemplatesProvider);
                              if (dialogContext.mounted) showMessage(dialogContext, l10n.templateSaved);
                            } on Failure catch (error) {
                              if (dialogContext.mounted) showMessage(dialogContext, error.message, error: true);
                            }
                          },
                          icon: const Icon(Icons.save_outlined, size: 18),
                          label: Text(l10n.save),
                        ),
                        OutlinedButton.icon(
                          key: const ValueKey('duplicate-column-template'),
                          onPressed: templateId == null ? null : () async {
                            final base = templateName.text.trim().isEmpty ? templateDisplayName : templateName.text.trim();
                            final duplicateName = '$base - Copy';
                            final savedTemplate = await _saveColumnTemplate(
                              duplicateName,
                              working,
                              design: templateDesign ?? _design.toJson(),
                            );
                            if (savedTemplate != null && dialogContext.mounted) {
                              setDialogState(() {
                                available.add(savedTemplate);
                                templateId = text(savedTemplate, 'id');
                                templateDisplayName = text(savedTemplate, 'name');
                                templateName.text = templateDisplayName;
                              });
                            }
                          },
                          icon: const Icon(Icons.copy_outlined, size: 18),
                          label: Text(arabic ? 'نسخ القالب' : 'Duplicate'),
                        ),
                        OutlinedButton.icon(
                          key: const ValueKey('delete-column-template'),
                          onPressed: templateId == null ? null : () async {
                            final confirm = await showDialog<bool>(
                              context: dialogContext,
                              builder: (confirmContext) => AlertDialog(
                                title: Text(arabic ? 'حذف القالب؟' : 'Delete template?'),
                                content: Text(templateDisplayName),
                                actions: [
                                  TextButton(onPressed: () => Navigator.pop(confirmContext, false), child: Text(l10n.cancel)),
                                  FilledButton(onPressed: () => Navigator.pop(confirmContext, true), child: Text(arabic ? 'حذف' : 'Delete')),
                                ],
                              ),
                            );
                            if (confirm != true || templateId == null) return;
                            try {
                              await ref.read(apiClientProvider).delete('/sales/quotation-column-templates/$templateId');
                              ref.invalidate(quotationColumnTemplatesProvider);
                              setDialogState(() {
                                available.removeWhere((item) => text(item, 'id') == templateId);
                                templateId = null;
                                templateDisplayName = '';
                                templateDesign = null;
                                templateName.clear();
                              });
                            } on Failure catch (error) {
                              if (dialogContext.mounted) showMessage(dialogContext, error.message, error: true);
                            }
                          },
                          icon: const Icon(Icons.delete_outline, size: 18),
                          label: Text(arabic ? 'حذف' : 'Delete'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(false),
                  child: Text(l10n.cancel),
                ),
                FilledButton(
                  key: const ValueKey('save-columns'),
                  onPressed: () => Navigator.of(dialogContext).pop(true),
                  child: Text(l10n.save),
                ),
              ],
            );
          },
        ),
      );
      if (saved != true) return;
      for (final column in targetColumns) {
        column.dispose();
      }
      setState(() {
        targetColumns
          ..clear()
          ..addAll(working);
        if (target == null && templateDesign != null) {
          _design = QuotationDocumentDesign.fromJson(templateDesign);
        }
      });
      // The copies handed to the screen are now owned by it.
      working.clear();
    } finally {
      for (final column in working) {
        column.dispose();
      }
      templateName.dispose();
    }
  }

  /// Opens a dialog that lets the user define a new column with a free-text
  /// key and label. The column is added to [working] when the user saves.
  void _addCustomColumnDialog(
    void Function(void Function()) setDialogState,
    List<_QColumnDraft> working,
  ) {
    final keyController = TextEditingController();
    final labelEnController = TextEditingController();
    final labelArController = TextEditingController();
    final l10n = context.l10n;
    showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.addCustomColumn),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: keyController,
              autofocus: true,
              decoration: InputDecoration(
                labelText: l10n.columnKey,
                border: const OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: labelEnController,
              decoration: InputDecoration(
                labelText: l10n.columnLabelEn,
                border: const OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: labelArController,
              decoration: InputDecoration(
                labelText: l10n.columnLabelAr,
                border: const OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () {
              final key = keyController.text.trim();
              if (key.isEmpty) {
                showMessage(
                  dialogContext,
                  l10n.columnKey,
                  error: true,
                );
                return;
              }
              if (working.any((c) => c.key == key)) {
                showMessage(
                  dialogContext,
                  l10n.columnAlreadyExists,
                  error: true,
                );
                return;
              }
              setDialogState(() {
                working.add(_QColumnDraft(
                  key: key,
                  labelEn: labelEnController.text.trim(),
                  labelAr: labelArController.text.trim(),
                ));
              });
              keyController.dispose();
              labelEnController.dispose();
              labelArController.dispose();
              Navigator.of(dialogContext).pop(true);
            },
            child: Text(l10n.add),
          ),
        ],
      ),
    );
  }

  Future<Json?> _saveColumnTemplate(
    String name,
    List<_QColumnDraft> columns, {
    Map<String, dynamic>? design,
  }) async {
    final l10n = context.l10n;
    try {
      final created = await ref
          .read(apiClientProvider)
          .post(
            '/sales/quotation-column-templates',
            body: {
              'name': name,
              'design': ?design,
              'columns': [
                for (final column in columns)
                  {
                    'key': column.key,
                    if (column.labelEn.text.trim().isNotEmpty)
                      'labelEn': column.labelEn.text.trim(),
                    if (column.labelAr.text.trim().isNotEmpty)
                      'labelAr': column.labelAr.text.trim(),
                    'visible': column.visible,
                    'width': column.width,
                  },
              ],
            },
          );
      ref.invalidate(quotationColumnTemplatesProvider);
      if (mounted) showMessage(context, l10n.templateSaved);
      return created;
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
      return null;
    }
  }

  Widget _tableCard(int index, String language, List<Json> items) {
    final l10n = context.l10n;
    final table = _tables[index];
    return Card(
      key: ValueKey('quotation-table-$index'),
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  flex: 2,
                  child: TextField(
                    key: ValueKey('quotation-table-title-$index'),
                    controller: table.title,
                    decoration: InputDecoration(
                      labelText: l10n.tableTitle,
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                IconButton(
                  tooltip: l10n.moveUp,
                  onPressed: index == 0
                      ? null
                      : () => setState(() {
                          final moved = _tables.removeAt(index);
                          _tables.insert(index - 1, moved);
                        }),
                  icon: const Icon(Icons.arrow_upward, size: 18),
                ),
                IconButton(
                  tooltip: l10n.moveDown,
                  onPressed: index == _tables.length - 1
                      ? null
                      : () => setState(() {
                          final moved = _tables.removeAt(index);
                          _tables.insert(index + 1, moved);
                        }),
                  icon: const Icon(Icons.arrow_downward, size: 18),
                ),
                IconButton(
                  tooltip: l10n.removeTable,
                  onPressed: _tables.length == 1
                      ? null
                      : () => setState(() => _tables.removeAt(index).dispose()),
                  icon: const Icon(Icons.delete_outline, size: 18),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: OutlinedButton.icon(
                key: ValueKey('edit-table-columns-$index'),
                onPressed: () => _editColumns(target: table.columns),
                icon: const Icon(Icons.view_column_outlined, size: 18),
                label: Text(Localizations.localeOf(context).languageCode == 'ar'
                    ? 'أعمدة هذا الجدول'
                    : 'Columns for this table'),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                SizedBox(
                  width: 180,
                  child: DropdownButtonFormField<DiscountKind>(
                    key: ValueKey('quotation-table-discount-$index'),
                    initialValue: table.discountKind,
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: l10n.tableDiscount,
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                    items: [
                      for (final kind in DiscountKind.values)
                        DropdownMenuItem(
                          value: kind,
                          child: Text(discountKindLabel(context, kind)),
                        ),
                    ],
                    onChanged: (value) => setState(() {
                      table.discountKind = value ?? DiscountKind.none;
                      if (table.discountKind == DiscountKind.none) {
                        table.discountValue.clear();
                      }
                    }),
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: 160,
                  child: TextField(
                    key: ValueKey('quotation-table-discount-value-$index'),
                    controller: table.discountValue,
                    enabled: table.discountKind != DiscountKind.none,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: InputDecoration(
                      labelText: table.discountKind == DiscountKind.percent
                          ? l10n.discountPercentValue
                          : l10n.discountAmountValue,
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                const SizedBox(width: 16),
                Text(
                  '${l10n.tableSubtotal}: '
                  '${formatAmount(table.gross.toString())}  •  '
                  '${l10n.netValue}: ${formatAmount(table.net.toString())}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
            const Divider(height: 24),
            for (var lineIndex = 0;
                lineIndex < table.lines.length;
                lineIndex++)
              _lineRow(
                index,
                table,
                table.lines[lineIndex],
                lineIndex,
                language,
                items,
              ),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton.icon(
                onPressed: () =>
                    setState(() => table.lines.add(_QLineDraft())),
                icon: const Icon(Icons.add, size: 18),
                label: Text(l10n.addQuotationLine),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _lineRow(
    int tableIndex,
    _QTableDraft table,
    _QLineDraft line,
    int index,
    String language,
    List<Json> items,
  ) {
    final l10n = context.l10n;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                flex: 3,
                child: Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        key: ValueKey('quotation-item-${line.itemId ?? 'null'}'),
                        initialValue: line.itemId,
                        isExpanded: true,
                        decoration: InputDecoration(
                          labelText: l10n.item,
                          border: const OutlineInputBorder(),
                          isDense: true,
                        ),
                        items: [
                          for (final item in items)
                            DropdownMenuItem(
                              value: text(item, 'id'),
                              child: Text(
                                '${text(item, 'code')} — '
                                '${text(item, 'nameEn')}',
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                        ],
                        onChanged: (value) {
                          setState(() {
                            line.itemId = value;
                            final item = items.firstWhere(
                              (row) => text(row, 'id') == value,
                              orElse: () => const {},
                            );
                            if (item.isNotEmpty) {
                              _applyItem(line, item, language);
                            }
                          });
                        },
                      ),
                    ),
                    IconButton(
                      tooltip: l10n.selectItem,
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(Icons.search, size: 18),
                      onPressed: () async {
                        final picked = await showItemPicker(
                          context,
                          title: l10n.selectItem,
                        );
                        if (picked == null || !mounted) return;
                        setState(() {
                          line.itemId = text(picked, 'id');
                          _applyItem(line, picked, language);
                        });
                      },
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                flex: 3,
                child: TextField(
                  controller: line.description,
                  decoration: InputDecoration(
                    labelText: l10n.description,
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              IconButton(
                tooltip: l10n.removeLine,
                onPressed: table.lines.length == 1
                    ? null
                    : () => setState(() => table.lines.removeAt(index).dispose()),
                icon: const Icon(Icons.delete_outline, size: 18),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              _smallField(line.origin, l10n.countryOfOrigin, width: 140),
              const SizedBox(width: 8),
              _smallField(line.unit, l10n.unit, width: 90),
              const SizedBox(width: 8),
              _smallField(
                line.quantity,
                l10n.quantity,
                width: 100,
                numeric: true,
                fieldKey: ValueKey('quotation-qty-$tableIndex-$index'),
              ),
              const SizedBox(width: 8),
              _smallField(
                line.unitPrice,
                l10n.unitPrice,
                width: 130,
                numeric: true,
                fieldKey: ValueKey('quotation-price-$tableIndex-$index'),
              ),
              const SizedBox(width: 16),
              Text(
                '${l10n.lineTotal}: '
                '${formatAmount(line.lineTotal.toString())}',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
          ),
          // حقول الأعمدة المخصصة التي ليست من المفاتيح المضمّنة.
          if (_customColumnKeysFor(table).isNotEmpty) ...[
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                for (final column in _customColumnKeysFor(table))
                  SizedBox(
                    width: 150,
                    child: TextField(
                      key: ValueKey(
                        'quotation-custom-${column.key}-$tableIndex-$index',
                      ),
                      controller: _customValueController(line, column.key),
                      decoration: InputDecoration(
                        labelText: language == 'ar'
                            ? column.labelAr.text.trim().isNotEmpty
                                ? column.labelAr.text
                                : column.key
                            : column.labelEn.text.trim().isNotEmpty
                                ? column.labelEn.text
                                : column.key,
                        border: const OutlineInputBorder(),
                        isDense: true,
                      ),
                      onChanged: (value) =>
                          line.customValues[column.key] = value,
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  /// Visible user-defined columns for this table; legacy/empty layouts
  /// inherit the quotation-level layout.
  List<_QColumnDraft> _customColumnKeysFor(_QTableDraft table) =>
      (table.columns.isEmpty ? _columns : table.columns)
          .where((c) => c.visible && !_builtinColumnKeys.contains(c.key))
          .toList();

  /// المفاتيح المضمّنة التي لها حقول خاصة بها في السطر.
  static const _builtinColumnKeys = {
    'itemCode',
    'description',
    'countryOfOrigin',
    'unit',
    'quantity',
    'unitPrice',
    'lineTotal',
  };

  /// يعيد المتحكم في حقل قيمة العمود المخصص لسطر معين، ينشئه عند الحاجة.
  TextEditingController _customValueController(
    _QLineDraft line,
    String key,
  ) {
    final initial = line.customValues[key] ?? '';
    return line.customValueController(key, initial);
  }

  Widget _smallField(
    TextEditingController controller,
    String label, {
    required double width,
    bool numeric = false,
    Key? fieldKey,
  }) {
    return SizedBox(
      width: width,
      child: TextField(
        key: fieldKey,
        controller: controller,
        keyboardType: numeric
            ? const TextInputType.numberWithOptions(decimal: true)
            : null,
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          isDense: true,
        ),
        onChanged: (_) => setState(() {}),
      ),
    );
  }

  Widget _summary(BuildContext context) {
    final l10n = context.l10n;
    final document = _documentDiscount;
    final shares = allocateByWeight(_tableNets, document.amount);
    final gross = _tables.fold(Decimal.zero, (sum, table) => sum + table.gross);
    final tableDiscounts =
        _tables.fold(Decimal.zero, (sum, table) => sum + table.discount.amount);
    final finalTotal = document.net;
    final theme = Theme.of(context);

    Widget row(List<String> cells, {bool strong = false, bool header = false}) {
      final style = header
          ? theme.textTheme.labelLarge
          : strong
          ? theme.textTheme.titleMedium
          : theme.textTheme.bodyMedium;
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            for (var index = 0; index < cells.length; index++)
              Expanded(
                flex: index == 0 ? 3 : 2,
                child: Text(
                  cells[index],
                  textAlign: index == 0 ? TextAlign.start : TextAlign.end,
                  style: style,
                ),
              ),
          ],
        ),
      );
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.quotationSummary, style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            row(
              [
                l10n.quotationTables,
                l10n.grossValue,
                l10n.tableDiscount,
                l10n.netValue,
              ],
              header: true,
            ),
            const Divider(height: 8),
            for (var index = 0; index < _tables.length; index++)
              row([
                '${index + 1}. ${_tables[index].title.text.trim().isEmpty ? l10n.tableTitle : _tables[index].title.text.trim()}',
                formatAmount(_tables[index].gross.toString()),
                formatAmount(_tables[index].discount.amount.toString()),
                formatAmount(_tables[index].net.toString()),
              ]),
            const Divider(),
            row([
              l10n.subtotalBeforeDiscount,
              '',
              '',
              formatAmount(gross.toString()),
            ]),
            row([
              l10n.totalDiscounts,
              '',
              '',
              formatAmount(
                (tableDiscounts + document.amount).toString(),
              ),
            ]),
            if (document.amount > Decimal.zero)
              row([
                l10n.quotationDiscount,
                document.kind == DiscountKind.percent
                    ? '${l10n.discountPercent} ${document.percent}%'
                    : l10n.discountAmount,
                '',
                '− ${formatAmount(document.amount.toString())}',
              ]),
            const Divider(),
            row([
              l10n.finalTotal,
              '',
              '',
              formatAmount(finalTotal.toString()),
            ], strong: true),
            if (shares.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  l10n.discountBeforeTaxHint,
                  style: theme.textTheme.bodySmall,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The saved-terms manager. Deleting an entry only removes it from the picker:
/// every quotation keeps its own copy of the text it was issued with.
class _QuotationTermsDialog extends ConsumerWidget {
  const _QuotationTermsDialog({required this.onUse});

  final void Function(Json term) onUse;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final terms = ref.watch(quotationTermsProvider);
    return AlertDialog(
      title: Text(l10n.manageSavedTerms),
      content: SizedBox(
        width: 560,
        height: 380,
        child: terms.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => Text(error is Failure ? error.message : '$error'),
          data: (rows) {
            if (rows.isEmpty) return Center(child: Text(l10n.noSavedTerms));
            return ListView.separated(
              itemCount: rows.length,
              separatorBuilder: (context, index) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final term = rows[index];
                return ListTile(
                  title: Text(text(term, 'title')),
                  subtitle: Text(
                    text(term, 'body'),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      TextButton(
                        onPressed: () {
                          Navigator.of(context).pop();
                          onUse(term);
                        },
                        child: Text(l10n.insertSavedTerms),
                      ),
                      IconButton(
                        tooltip: l10n.remove,
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () async {
                          final ok = await showDialog<bool>(
                            context: context,
                            builder: (confirm) => AlertDialog(
                              title: Text(l10n.remove),
                              content: Text(l10n.removeSavedTerm),
                              actions: [
                                TextButton(
                                  onPressed: () => Navigator.of(confirm).pop(false),
                                  child: Text(l10n.cancel),
                                ),
                                FilledButton(
                                  onPressed: () => Navigator.of(confirm).pop(true),
                                  child: Text(l10n.remove),
                                ),
                              ],
                            ),
                          );
                          if (ok != true) return;
                          try {
                            await ref
                                .read(apiClientProvider)
                                .delete('/sales/quotation-terms/${text(term, 'id')}');
                            ref.invalidate(quotationTermsProvider);
                          } on Failure catch (error) {
                            if (context.mounted) {
                              showMessage(context, error.message, error: true);
                            }
                          }
                        },
                      ),
                    ],
                  ),
                );
              },
            );
          },
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.close),
        ),
      ],
    );
  }
}
