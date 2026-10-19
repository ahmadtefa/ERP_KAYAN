import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/error/failure.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../accounting/presentation/providers/cost_center_providers.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../providers/invoice_providers.dart';

/// One editable invoice line.
class _LineDraft {
  _LineDraft({
    String quantity = '1',
    String unitPrice = '0',
    String taxRate = '0',
  }) : quantity = TextEditingController(text: quantity),
      unitPrice = TextEditingController(text: unitPrice),
      taxRate = TextEditingController(text: taxRate);

  String? itemId;

  /// Optional cost centre for the line. Left null on a balance-sheet-only
  /// line; the server checks that the centre is one this company may use.
  String? costCenterId;
  final TextEditingController quantity;
  final TextEditingController unitPrice;
  final TextEditingController taxRate;

  void dispose() {
    quantity.dispose();
    unitPrice.dispose();
    taxRate.dispose();
  }
}

class _LandedCostDraft {
  _LandedCostDraft({String description = '', String amount = '0'})
      : description = TextEditingController(text: description),
        amount = TextEditingController(text: amount);

  final TextEditingController description;
  final TextEditingController amount;

  void dispose() {
    description.dispose();
    amount.dispose();
  }
}

/// Creates a draft sales or purchase invoice.
///
/// The screen only ever creates a draft. Posting is a separate, deliberate
/// step from the list, because posting moves stock and writes to the ledger.
class InvoiceEditorScreen extends ConsumerStatefulWidget {
  const InvoiceEditorScreen({super.key, required this.kind, this.invoiceId});

  final InvoiceKind kind;
  final String? invoiceId;

  @override
  ConsumerState<InvoiceEditorScreen> createState() =>
      _InvoiceEditorScreenState();
}

class _InvoiceEditorScreenState extends ConsumerState<InvoiceEditorScreen> {
  final _lines = <_LineDraft>[];
  String? _partyId;
  String? _supplierReference;
  String? _notes;
  String _discountMode = 'percent';
  String _discountValue = '0';
  final _discountController = TextEditingController(text: '0');
  late String _invoiceDate;
  final _landedCosts = <_LandedCostDraft>[];
  bool _saving = false;
  bool _loadingExisting = false;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _invoiceDate =
        '${now.year.toString().padLeft(4, '0')}-'
        '${now.month.toString().padLeft(2, '0')}-'
        '${now.day.toString().padLeft(2, '0')}';
    _lines.add(_LineDraft());
    if (widget.invoiceId != null) {
      _loadingExisting = true;
      _loadExisting();
    }
  }

  Future<void> _loadExisting() async {
    try {
      final invoice = await ref
          .read(apiClientProvider)
          .getObject('${widget.kind.basePath}/${widget.invoiceId}');
      if (!mounted) return;
      if (text(invoice, 'status').toLowerCase() != 'draft') {
        showMessage(context, context.l10n.onlyDraftInvoiceCanBeEdited, error: true);
        Navigator.of(context).pop();
        return;
      }
      for (final line in _lines) {
        line.dispose();
      }
      _lines.clear();
      for (final charge in _landedCosts) {
        charge.dispose();
      }
      _landedCosts.clear();
      for (final row in listOf(invoice['landedCostCharges'])) {
        _landedCosts.add(_LandedCostDraft(
          description: text(row, 'description'),
          amount: text(row, 'amount', fallback: '0'),
        ));
      }
      final legacyLandedCost = Decimal.tryParse(text(invoice, 'landedCostAmount')) ?? Decimal.zero;
      if (_landedCosts.isEmpty && legacyLandedCost > Decimal.zero) {
        _landedCosts.add(_LandedCostDraft(
          description: context.l10n.otherLandedCosts,
          amount: legacyLandedCost.toString(),
        ));
      }
      for (final row in listOf(invoice['lines'])) {
        final line = _LineDraft(
          quantity: text(row, 'quantity', fallback: '1'),
          unitPrice: text(row, 'unitPrice', fallback: '0'),
          taxRate: text(row, 'taxRate', fallback: '0'),
        )
          ..itemId = text(row, 'itemId').isEmpty ? null : text(row, 'itemId')
          ..costCenterId = text(row, 'costCenterId').isEmpty
              ? null
              : text(row, 'costCenterId');
        _lines.add(line);
      }
      if (_lines.isEmpty) _lines.add(_LineDraft());
      setState(() {
        _partyId = text(invoice, widget.kind.partyKey).isNotEmpty
            ? text(Map<String, dynamic>.from(invoice[widget.kind.partyKey] as Map), 'id')
            : null;
        _supplierReference = text(invoice, 'supplierReference').isEmpty
            ? null
            : text(invoice, 'supplierReference');
        _notes = text(invoice, 'notes').isEmpty ? null : text(invoice, 'notes');
        final discountPercent = Decimal.tryParse(text(invoice, 'discountPercent')) ?? Decimal.zero;
        final discountAmount = Decimal.tryParse(text(invoice, 'discountAmount')) ?? Decimal.zero;
        _discountMode = discountPercent > Decimal.zero ? 'percent' : 'fixed';
        _discountValue = discountPercent > Decimal.zero
            ? discountPercent.toString()
            : discountAmount.toString();
        _discountController.text = _discountValue;
        _invoiceDate = text(invoice, 'invoiceDate', fallback: _invoiceDate);
        _loadingExisting = false;
      });
    } on Failure catch (error) {
      if (mounted) {
        setState(() => _loadingExisting = false);
        showMessage(context, error.message, error: true);
      }
    }
  }

  @override
  void dispose() {
    for (final line in _lines) {
      line.dispose();
    }
    for (final charge in _landedCosts) {
      charge.dispose();
    }
    _discountController.dispose();
    super.dispose();
  }

  /// Totals computed with [Decimal], the same arithmetic the server uses, so
  /// what is previewed here is what will be stored.
  ({Decimal subTotal, Decimal discount, Decimal tax, Decimal landedCost, Decimal total}) get _totals {
    var subTotal = Decimal.zero;
    var tax = Decimal.zero;
    for (final line in _lines) {
      final quantity = Decimal.tryParse(line.quantity.text.trim());
      final price = Decimal.tryParse(line.unitPrice.text.trim());
      if (quantity == null || price == null) continue;
      final lineTotal = quantity * price;
      subTotal += lineTotal;
      final rate = Decimal.tryParse(line.taxRate.text.trim()) ?? Decimal.zero;
      // Dividing in the decimal package yields a Rational, so it is turned
      // back into a 4-decimal value before it is added up.
      tax += (lineTotal * rate / Decimal.fromInt(100))
          .toDecimal(scaleOnInfinitePrecision: 8)
          .round(scale: 4);
    }
    final enteredDiscount = Decimal.tryParse(_discountValue.trim()) ?? Decimal.zero;
    final discount = _discountMode == 'percent'
        ? (subTotal * enteredDiscount / Decimal.fromInt(100))
            .toDecimal(scaleOnInfinitePrecision: 8).round(scale: 4)
        : enteredDiscount;
    final safeDiscount = discount > subTotal ? subTotal : discount;
    final taxReduction = subTotal == Decimal.zero
        ? Decimal.zero
        : (tax * safeDiscount / subTotal)
            .toDecimal(scaleOnInfinitePrecision: 8).round(scale: 4);
    var landedCost = Decimal.zero;
    if (!widget.kind.isSales) {
      for (final charge in _landedCosts) {
        landedCost += Decimal.tryParse(charge.amount.text.trim()) ?? Decimal.zero;
      }
    }
    return (
      subTotal: subTotal,
      discount: safeDiscount,
      tax: tax - taxReduction,
      landedCost: landedCost,
      total: subTotal - safeDiscount + tax - taxReduction + landedCost,
    );
  }

  void _applyItemDefaults(_LineDraft line, Json item) {
    // An explicit rate the user typed is respected; only the empty case is
    // filled in from the item.
    if (line.taxRate.text.trim().isEmpty || line.taxRate.text.trim() == '0') {
      line.taxRate.text = formatQuantity(asString(item['taxRate']), decimals: 2);
    }
    if (widget.kind.isSales &&
        (line.unitPrice.text.trim().isEmpty ||
            line.unitPrice.text.trim() == '0')) {
      line.unitPrice.text = formatQuantity(
        asString(item['salePrice']),
        decimals: 2,
      );
    }
  }

  Future<void> _save() async {
    final l10n = context.l10n;
    if (_partyId == null) {
      showMessage(
        context,
        widget.kind.isSales ? l10n.partyRequired : l10n.supplierRequired,
        error: true,
      );
      return;
    }

    final landedCostCharges = <Json>[];
    var landedCost = Decimal.zero;
    if (!widget.kind.isSales) {
      for (final charge in _landedCosts) {
        final description = charge.description.text.trim();
        final rawAmount = charge.amount.text.trim();
        final amount = Decimal.tryParse(rawAmount);
        if (description.isEmpty &&
            (rawAmount.isEmpty || (amount != null && amount == Decimal.zero))) {
          continue;
        }
        if (description.isEmpty) {
          showMessage(context, l10n.landedCostDescriptionRequired, error: true);
          return;
        }
        if (amount == null) {
          showMessage(context, l10n.landedCostAmountInvalid, error: true);
          return;
        }
        if (amount < Decimal.zero) {
          showMessage(context, l10n.landedCostCannotBeNegative, error: true);
          return;
        }
        landedCost += amount;
        landedCostCharges.add({'description': description, 'amount': amount.toString()});
      }
    }

    final discountValue = Decimal.tryParse(_discountValue.trim()) ?? Decimal.zero;
    if (discountValue < Decimal.zero ||
        (_discountMode == 'percent' && discountValue > Decimal.fromInt(100)) ||
        (_discountMode == 'fixed' && discountValue > _totals.subTotal)) {
      showMessage(context, Localizations.localeOf(context).languageCode == 'ar'
          ? 'قيمة الخصم غير صحيحة أو تتجاوز إجمالي البنود'
          : 'Discount is invalid or exceeds the invoice subtotal', error: true);
      return;
    }

    final lines = <Json>[];
    for (final line in _lines) {
      final quantity = line.quantity.text.trim();
      final price = line.unitPrice.text.trim();
      if (quantity.isEmpty || price.isEmpty) continue;
      final parsed = Decimal.tryParse(quantity);
      if (parsed == null || parsed <= Decimal.zero) {
        showMessage(context, l10n.mustBePositive, error: true);
        return;
      }
      lines.add({
        if (line.itemId != null) 'itemId': line.itemId,
        'quantity': quantity,
        'unitPrice': price,
        if (line.taxRate.text.trim().isNotEmpty) 'taxRate': line.taxRate.text.trim(),
        if (line.costCenterId != null) 'costCenterId': line.costCenterId,
      });
    }
    if (lines.isEmpty) {
      showMessage(context, l10n.addLineFirst, error: true);
      return;
    }

    setState(() => _saving = true);
    try {
      final body = <String, dynamic>{
        'invoiceDate': _invoiceDate,
        if (widget.kind.isSales) 'customerId': _partyId,
        if (!widget.kind.isSales) 'supplierId': _partyId,
        if (!widget.kind.isSales) 'landedCostAmount': landedCost.toString(),
        if (!widget.kind.isSales) 'landedCostCharges': landedCostCharges,
        if (!widget.kind.isSales && _supplierReference != null)
          'supplierReference': _supplierReference,
        if (_notes != null && _notes!.isNotEmpty) 'notes': _notes,
        'discountPercent': _discountMode == 'percent' ? discountValue.toString() : '0',
        'discountAmount': _discountMode == 'fixed' ? discountValue.toString() : '0',
        'lines': lines,
      };
      if (widget.invoiceId != null) {
        await ref.read(apiClientProvider).put(
          '${widget.kind.basePath}/${widget.invoiceId}',
          body: body,
        );
      } else {
        await ref.read(apiClientProvider).post(widget.kind.basePath, body: body);
      }
      await ref.read(invoiceListProvider(widget.kind).notifier).reload();
      if (mounted) {
        Navigator.of(context).pop(true);
        showMessage(context, l10n.invoiceSaved);
      }
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final itemsAsync = ref.watch(activeItemsProvider);
    final partiesAsync = ref.watch(
      widget.kind.isSales ? activeCustomersProvider : activeSuppliersProvider,
    );
    // Every centre, including a deactivated one, so a draft that already
    // names a centre still shows it. The server still refuses a new posting
    // to an inactive centre, and says so.
    final costCenters = ref.watch(costCentersProvider).value ?? const <Json>[];
    final language = Localizations.localeOf(context).languageCode;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.invoiceId != null
              ? l10n.editDraftInvoice
              : widget.kind.isSales
                  ? l10n.newSalesInvoice
                  : l10n.newPurchaseInvoice,
        ),
        actions: [
          Padding(
            padding: const EdgeInsetsDirectional.only(end: 16),
            child: FilledButton.icon(
              onPressed: _saving || _loadingExisting ? null : _save,
              icon: const Icon(Icons.save_outlined),
              label: Text(l10n.save),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _Header(
            key: ValueKey('${widget.invoiceId ?? 'new'}-$_loadingExisting'),
            kind: widget.kind,
            invoiceDate: _invoiceDate,
            onDateChanged: (value) => setState(() => _invoiceDate = value),
            partyId: _partyId,
            onPartyChanged: (value) => setState(() => _partyId = value),
            supplierReference: _supplierReference,
            onSupplierReferenceChanged: (value) =>
                setState(() => _supplierReference = value),
            notes: _notes,
            onNotesChanged: (value) => setState(() => _notes = value),
            parties: partiesAsync.value ?? const [],
          ),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                flex: 2,
                child: DropdownButtonFormField<String>(
                  key: const ValueKey('invoice-discount-mode'),
                  initialValue: _discountMode,
                  decoration: InputDecoration(
                    labelText: language == 'ar' ? 'نوع الخصم' : 'Discount type',
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  items: [
                    DropdownMenuItem(value: 'percent', child: Text(language == 'ar' ? 'نسبة مئوية' : 'Percentage')),
                    DropdownMenuItem(value: 'fixed', child: Text(language == 'ar' ? 'مبلغ ثابت' : 'Fixed amount')),
                  ],
                  onChanged: (value) => setState(() => _discountMode = value ?? 'percent'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                flex: 2,
                child: TextFormField(
                  key: const ValueKey('invoice-discount-value'),
                  controller: _discountController,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: InputDecoration(
                    labelText: _discountMode == 'percent'
                        ? (language == 'ar' ? 'الخصم %' : 'Discount %')
                        : (language == 'ar' ? 'قيمة الخصم' : 'Discount amount'),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  onChanged: (value) => setState(() => _discountValue = value),
                ),
              ),
            ],
          ),
          if (!widget.kind.isSales) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: Text(l10n.landedCosts, style: Theme.of(context).textTheme.titleMedium)),
                TextButton.icon(
                  onPressed: () => setState(() => _landedCosts.add(_LandedCostDraft())),
                  icon: const Icon(Icons.add),
                  label: Text(l10n.addLandedCost),
                ),
              ],
            ),
            Text(l10n.landedCostAllocationHint, style: Theme.of(context).textTheme.bodySmall),
            for (var index = 0; index < _landedCosts.length; index++) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    flex: 3,
                    child: TextField(
                      key: ValueKey('landed-cost-description-$index'),
                      controller: _landedCosts[index].description,
                      decoration: InputDecoration(
                        labelText: l10n.description,
                        border: const OutlineInputBorder(),
                        isDense: true,
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    flex: 2,
                    child: TextField(
                      key: ValueKey('landed-cost-amount-$index'),
                      controller: _landedCosts[index].amount,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: InputDecoration(
                        labelText: l10n.amount,
                        border: const OutlineInputBorder(),
                        isDense: true,
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                  IconButton(
                    tooltip: l10n.removeLandedCost,
                    onPressed: () => setState(() => _landedCosts.removeAt(index).dispose()),
                    icon: const Icon(Icons.delete_outline),
                  ),
                ],
              ),
            ],
          ],
          const SizedBox(height: 16),
          Row(
            children: [
              Text(l10n.invoiceLines, style: Theme.of(context).textTheme.titleMedium),
              const Spacer(),
              TextButton.icon(
                onPressed: () => setState(() => _lines.add(_LineDraft())),
                icon: const Icon(Icons.add),
                label: Text(l10n.addLine),
              ),
            ],
          ),
          const SizedBox(height: 8),
          _LinesTable(
            kind: widget.kind,
            lines: _lines,
            items: itemsAsync.value ?? const [],
            costCenters: costCenters,
            language: language,
            onChanged: () => setState(() {}),
            onAdd: () => setState(() => _lines.add(_LineDraft())),
            onRemove: (index) => setState(() => _lines.removeAt(index).dispose()),
            onItemDefaults: _applyItemDefaults,
          ),
          const SizedBox(height: 16),
          _Totals(totals: _totals, showLandedCost: !widget.kind.isSales),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({
    super.key,
    required this.kind,
    required this.invoiceDate,
    required this.onDateChanged,
    required this.partyId,
    required this.onPartyChanged,
    required this.supplierReference,
    required this.onSupplierReferenceChanged,
    required this.notes,
    required this.onNotesChanged,
    required this.parties,
  });

  final InvoiceKind kind;
  final String invoiceDate;
  final ValueChanged<String> onDateChanged;
  final String? partyId;
  final ValueChanged<String?> onPartyChanged;
  final String? supplierReference;
  final ValueChanged<String?> onSupplierReferenceChanged;
  final String? notes;
  final ValueChanged<String?> onNotesChanged;
  final List<Json> parties;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: InkWell(
                    onTap: () async {
                      final now = DateTime.now();
                      final picked = await showDatePicker(
                        context: context,
                        initialDate:
                            DateTime.tryParse(invoiceDate) ?? now,
                        firstDate: DateTime(now.year - 5),
                        lastDate: DateTime(now.year + 5),
                      );
                      if (picked == null) return;
                      onDateChanged(
                        '${picked.year.toString().padLeft(4, '0')}-'
                        '${picked.month.toString().padLeft(2, '0')}-'
                        '${picked.day.toString().padLeft(2, '0')}',
                      );
                    },
                    child: InputDecorator(
                      decoration: InputDecoration(
                        labelText: l10n.invoiceDate,
                        border: const OutlineInputBorder(),
                        suffixIcon: const Icon(Icons.calendar_today_outlined),
                      ),
                      child: Text(invoiceDate),
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: partyId,
                    decoration: InputDecoration(
                      labelText: kind.isSales
                          ? l10n.selectCustomer
                          : l10n.selectSupplier,
                      border: const OutlineInputBorder(),
                    ),
                    items: [
                      for (final party in parties)
                        DropdownMenuItem(
                          value: text(party, 'id'),
                          child: Text(
                            '${text(party, 'code')} — ${text(party, 'nameEn')}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                    onChanged: onPartyChanged,
                  ),
                ),
                if (!kind.isSales) ...[
                  const SizedBox(width: 16),
                  Expanded(
                    child: TextFormField(
                      initialValue: supplierReference,
                      decoration: InputDecoration(
                        labelText: l10n.supplierReference,
                        border: const OutlineInputBorder(),
                      ),
                      onChanged: onSupplierReferenceChanged,
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 12),
            TextFormField(
              initialValue: notes,
              maxLines: 2,
              decoration: InputDecoration(
                labelText: l10n.description,
                border: const OutlineInputBorder(),
              ),
              onChanged: onNotesChanged,
            ),
          ],
        ),
      ),
    );
  }
}

/// The value the dropdown may start on. A value outside the choices would make
/// the widget assert, and the line's own value is kept in the payload anyway.
String? _costCenterChoice(List<Json> centres, String? id) {
  if (id == null || id.isEmpty) return null;
  return centres.any((center) => text(center, 'id') == id) ? id : null;
}

class _LinesTable extends StatelessWidget {
  const _LinesTable({
    required this.kind,
    required this.lines,
    required this.items,
    required this.costCenters,
    required this.language,
    required this.onChanged,
    required this.onAdd,
    required this.onRemove,
    required this.onItemDefaults,
  });

  final InvoiceKind kind;
  final List<_LineDraft> lines;
  final List<Json> items;
  final List<Json> costCenters;
  final String language;
  final VoidCallback onChanged;
  final VoidCallback onAdd;
  final void Function(int index) onRemove;
  final void Function(_LineDraft line, Json item) onItemDefaults;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          children: [
            for (var index = 0; index < lines.length; index++)
              Padding(
                key: ValueKey(lines[index]),
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      flex: 3,
                      child: DropdownButtonFormField<String>(
                        initialValue: lines[index].itemId,
                        isExpanded: true,
                        decoration: InputDecoration(
                          labelText: kind.isSales
                              ? l10n.item
                              : l10n.item,
                          isDense: true,
                          border: const OutlineInputBorder(),
                        ),
                        items: [
                          for (final item in items)
                            DropdownMenuItem(
                              value: text(item, 'id'),
                              child: Text(
                                '${text(item, 'code')} — ${text(item, 'nameEn')}',
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                        ],
                        onChanged: (value) {
                          lines[index].itemId = value;
                          final item = items.firstWhere(
                            (element) => text(element, 'id') == value,
                            orElse: () => const {},
                          );
                          if (item.isNotEmpty) {
                            onItemDefaults(lines[index], item);
                          }
                          onChanged();
                        },
                      ),
                    ),
                    if (costCenters.isNotEmpty) ...[
                      const SizedBox(width: 8),
                      Expanded(
                        flex: 3,
                        child: DropdownButtonFormField<String>(
                          initialValue: _costCenterChoice(
                            costCenters,
                            lines[index].costCenterId,
                          ),
                          isExpanded: true,
                          decoration: InputDecoration(
                            labelText: l10n.costCenter,
                            isDense: true,
                            border: const OutlineInputBorder(),
                          ),
                          items: [
                            DropdownMenuItem(
                              value: '',
                              child: Text(
                                l10n.noAllocation,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            for (final center in costCenters)
                              DropdownMenuItem(
                                value: text(center, 'id'),
                                child: Text(
                                  flag(center, 'isActive', fallback: true)
                                      ? costCenterLabel(center, language)
                                      : '${costCenterLabel(center, language)} '
                                            '(${l10n.inactive})',
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                          ],
                          onChanged: (value) {
                            lines[index].costCenterId =
                                value == null || value.isEmpty ? null : value;
                            onChanged();
                          },
                        ),
                      ),
                    ],
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 2,
                      child: TextFormField(
                        controller: lines[index].quantity,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: InputDecoration(
                          labelText: l10n.quantity,
                          isDense: true,
                          border: const OutlineInputBorder(),
                        ),
                        onChanged: (_) => onChanged(),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 2,
                      child: TextFormField(
                        key: ValueKey('invoice-line-unit-price-$index'),
                        controller: lines[index].unitPrice,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: InputDecoration(
                          labelText: l10n.unitPrice,
                          isDense: true,
                          border: const OutlineInputBorder(),
                        ),
                        onChanged: (_) => onChanged(),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 2,
                      child: TextFormField(
                        controller: lines[index].taxRate,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: InputDecoration(
                          labelText: l10n.taxRate,
                          isDense: true,
                          border: const OutlineInputBorder(),
                        ),
                        onChanged: (_) => onChanged(),
                      ),
                    ),
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 120,
                      child: _LineTotal(line: lines[index]),
                    ),
                    IconButton(
                      tooltip: l10n.removeLine,
                      icon: const Icon(Icons.delete_outline),
                      onPressed: lines.length == 1 ? null : () => onRemove(index),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _LineTotal extends StatelessWidget {
  const _LineTotal({required this.line});

  final _LineDraft line;

  @override
  Widget build(BuildContext context) {
    final quantity = Decimal.tryParse(line.quantity.text.trim());
    final price = Decimal.tryParse(line.unitPrice.text.trim());
    final text = quantity == null || price == null
        ? '—'
        : formatAmount((quantity * price).toString());
    return InputDecorator(
      decoration: const InputDecoration(
        labelText: '',
        isDense: true,
        border: OutlineInputBorder(),
      ),
      child: Text(text, textAlign: TextAlign.end),
    );
  }
}

class _Totals extends StatelessWidget {
  const _Totals({required this.totals, required this.showLandedCost});

  final ({Decimal subTotal, Decimal discount, Decimal tax, Decimal landedCost, Decimal total}) totals;
  final bool showLandedCost;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    Widget row(String label, Decimal value, {bool strong = false}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          Text(label, style: strong ? theme.textTheme.titleMedium : null),
          const SizedBox(width: 24),
          SizedBox(
            width: 160,
            child: Text(
              formatAmount(value.toString()),
              textAlign: TextAlign.end,
              style: strong
                  ? theme.textTheme.titleMedium
                  : theme.textTheme.bodyMedium,
            ),
          ),
        ],
      ),
    );

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            row(l10n.subTotal, totals.subTotal),
            if (totals.discount > Decimal.zero) row(
              Localizations.localeOf(context).languageCode == 'ar' ? 'الخصم' : 'Discount',
              totals.discount,
            ),
            row(l10n.taxAmount, totals.tax),
            if (showLandedCost) row(l10n.landedCosts, totals.landedCost),
            const Divider(),
            row(l10n.totalAmount, totals.total, strong: true),
          ],
        ),
      ),
    );
  }
}
