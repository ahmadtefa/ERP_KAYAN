import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/json/discount_math.dart';
import '../../../../core/error/failure.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/discount_kind_label.dart';
import '../../../../shared/widgets/item_picker_dialog.dart';
import '../../../accounting/presentation/providers/cost_center_providers.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../providers/invoice_providers.dart';

/// Active units a line can choose for [item], smallest factor first.
///
/// A legacy item that predates multi-unit and carries no `units` array is
/// synthesised as a single base unit, so the picker always offers the item's
/// own unit and the document stays valid. An item that has not been picked yet
/// yields an empty list and the control is disabled.
List<Json> lineUnitsOf(Json? item, {bool? forSales}) {
  if (item == null) return const <Json>[];
  final raw = item['units'];
  final stored =
      (raw is List ? raw.cast<Json>() : const <Json>[])
          .where((unit) => flag(unit, 'isActive', fallback: true))
          .where((unit) {
            // A unit can be switched off for one side of the business: a
            // supplier sells by the carton, the shop by the bottle. When the
            // caller names a side, a unit meant for the other one is not
            // offered - the server refuses it anyway, and offering it would
            // only produce an error after the line was typed.
            if (forSales == null) return true;
            return flag(
              unit,
              forSales ? 'usedInSales' : 'usedInPurchases',
              fallback: true,
            );
          })
          .toList();
  if (stored.isNotEmpty) {
    stored.sort((a, b) {
      final oa = int.tryParse(asString(a['sortOrder']) ?? '') ?? 0;
      final ob = int.tryParse(asString(b['sortOrder']) ?? '') ?? 0;
      if (oa != ob) return oa.compareTo(ob);
      final fa = Decimal.tryParse(asString(a['factor']) ?? '') ?? Decimal.one;
      final fb = Decimal.tryParse(asString(b['factor']) ?? '') ?? Decimal.one;
      return fa.compareTo(fb);
    });
    return stored;
  }
  return <Json>[
    <String, dynamic>{
      'id': null,
      'unit': text(item, 'unit'),
      'factor': '1.000000',
      'isBase': true,
      'isActive': true,
      'allowFraction': true,
      'salePrice': item['salePrice'],
      'purchasePrice': item['purchasePrice'],
    },
  ];
}

/// The unit a line names, or the item's base unit when the line names none.
Json? lineUnitOf(Json? item, String? unitName) {
  final units = lineUnitsOf(item);
  for (final unit in units) {
    if (text(unit, 'unit') == unitName) return unit;
  }
  for (final unit in units) {
    if (flag(unit, 'isBase', fallback: false)) return unit;
  }
  return units.isEmpty ? null : units.first;
}

/// Whether a quantity typed in [unit] is a whole number of it.
///
/// A carton of twenty-four bottles has no half: the shelf either has a carton
/// or it does not. The server refuses it; catching it here says so while the
/// person is still on the field instead of after Save.
bool quantityAllowedInUnit(Json? unit, String quantity) {
  if (unit == null) return true;
  if (flag(unit, 'allowFraction', fallback: true)) return true;
  final parsed = Decimal.tryParse(quantity.trim());
  if (parsed == null) return true;
  return parsed == parsed.truncate();
}

/// The unit-specific list price for [unitName] on [item], or the item's own
/// price when the unit defines none. Returns an empty string when neither is
/// set, so the caller can leave the field the user already typed alone.
String unitListPrice(Json item, String unitName, {required bool isSales}) {
  final key = isSales ? 'salePrice' : 'purchasePrice';
  final base = text(item, key);
  for (final unit in lineUnitsOf(item)) {
    if (text(unit, 'unit') == unitName) {
      final specific = text(unit, key);
      if (specific.isNotEmpty) return specific;
      // The item price is per BASE unit, so a reel of five hundred must not be
      // offered at the price of one metre. Multiplying here mirrors what the
      // server does when the price is left empty - one rule, two callers.
      final factor = Decimal.tryParse(asString(unit['factor']) ?? '');
      final price = Decimal.tryParse(base);
      if (factor == null || price == null) return base;
      // The base unit is the item price already; multiplying by one would only
      // reformat a number the person typed.
      if (factor.compareTo(Decimal.one) == 0) return base;
      return (price * factor).toStringAsFixed(2);
    }
  }
  return base;
}

/// One editable invoice line.
class _LineDraft {
  _LineDraft({
    String quantity = '1',
    String unitPrice = '0',
    String taxRate = '0',
    String discountValue = '',
  }) : quantity = TextEditingController(text: quantity),
      unitPrice = TextEditingController(text: unitPrice),
      taxRate = TextEditingController(text: taxRate),
      discountValue = TextEditingController(text: discountValue);

  String? itemId;

  /// The measurement unit the quantity is expressed in. Null on a free line
  /// without an item; the server treats a missing unit as the item's base unit
  /// and keeps legacy documents untouched.
  String? unitName;

  /// Optional cost centre for the line. Left null on a balance-sheet-only
  /// line; the server checks that the centre is one this company may use.
  String? costCenterId;
  final TextEditingController quantity;
  final TextEditingController unitPrice;
  final TextEditingController taxRate;

  /// A line discount: a percentage or a fixed amount of money. The server
  /// resolves the other representation and stores both.
  DiscountKind discountKind = DiscountKind.none;
  final TextEditingController discountValue;

  /// The line's own arithmetic, for the summary under the inputs.
  ({Decimal gross, ResolvedDiscount discount}) get pricing {
    final quantityValue = Decimal.tryParse(quantity.text.trim()) ?? Decimal.zero;
    final price = Decimal.tryParse(unitPrice.text.trim()) ?? Decimal.zero;
    final gross = quantityValue * price;
    return (
      gross: gross,
      discount: resolveDiscount(
        gross,
        discountKind,
        Decimal.tryParse(discountValue.text.trim()),
      ),
    );
  }

  void dispose() {
    quantity.dispose();
    unitPrice.dispose();
    taxRate.dispose();
    discountValue.dispose();
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
  late String _invoiceDate;
  final _landedCosts = <_LandedCostDraft>[];
  final _documentDiscount = TextEditingController();
  DiscountKind _documentDiscountKind = DiscountKind.none;
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
        // Reopen shows exactly what the user entered. A multi-unit line keeps
        // the entered quantity and its unit; a legacy row has no snapshot, so
        // it falls back to the stored base quantity with no unit selected.
        final line = _LineDraft(
          quantity: text(
            row,
            'unitQuantity',
            fallback: text(row, 'quantity', fallback: '1'),
          ),
          unitPrice: text(row, 'unitPrice', fallback: '0'),
          taxRate: text(row, 'taxRate', fallback: '0'),
        )
          ..itemId = text(row, 'itemId').isEmpty ? null : text(row, 'itemId')
          ..unitName =
              text(row, 'unitName').isEmpty ? null : text(row, 'unitName')
          ..costCenterId = text(row, 'costCenterId').isEmpty
              ? null
              : text(row, 'costCenterId');
        final discountKind = discountKindOf(text(row, 'discountType'));
        if (discountKind == DiscountKind.percent) {
          line.discountValue.text = text(row, 'discountPercent', fallback: '');
          if (line.discountValue.text == '0.0000') line.discountValue.text = '';
        } else if (discountKind == DiscountKind.amount) {
          line.discountValue.text = text(row, 'discountAmount', fallback: '');
          if (line.discountValue.text == '0.0000') line.discountValue.text = '';
        }
        line.discountKind = discountKind;
        _lines.add(line);
      }
      if (_lines.isEmpty) _lines.add(_LineDraft());
      _documentDiscountKind =
          discountKindOf(text(invoice, 'discountType'));
      _documentDiscount.text = _documentDiscountKind == DiscountKind.percent
          ? text(invoice, 'discountPercent', fallback: '')
          : text(invoice, 'discountAmount', fallback: '');
      if (_documentDiscount.text == '0.0000') _documentDiscount.text = '';
      if (_documentDiscountKind == DiscountKind.none) _documentDiscount.clear();
      setState(() {
        _partyId = text(invoice, widget.kind.partyKey).isNotEmpty
            ? text(Map<String, dynamic>.from(invoice[widget.kind.partyKey] as Map), 'id')
            : null;
        _supplierReference = text(invoice, 'supplierReference').isEmpty
            ? null
            : text(invoice, 'supplierReference');
        _notes = text(invoice, 'notes').isEmpty ? null : text(invoice, 'notes');
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
    _documentDiscount.dispose();
    super.dispose();
  }

  /// Totals computed with [Decimal], the same arithmetic the server uses, so
  /// what is previewed here is what will be stored. The document discount is
  /// spread over the net line values with the same largest-remainder method.
  ({
    Decimal gross,
    Decimal lineDiscount,
    Decimal invoiceDiscount,
    Decimal subTotal,
    Decimal tax,
    Decimal landedCost,
    Decimal total,
  }) get _totals {
    final nets = <Decimal>[];
    final rates = <Decimal>[];
    var gross = Decimal.zero;
    var lineDiscount = Decimal.zero;
    for (final line in _lines) {
      final pricing = line.pricing;
      if (line.quantity.text.trim().isEmpty || line.unitPrice.text.trim().isEmpty) {
        continue;
      }
      gross += pricing.gross;
      lineDiscount += pricing.discount.amount;
      nets.add(pricing.discount.net);
      rates.add(Decimal.tryParse(line.taxRate.text.trim()) ?? Decimal.zero);
    }
    final netBeforeDocument = nets.fold(Decimal.zero, (sum, value) => sum + value);
    final document = resolveDiscount(
      netBeforeDocument,
      _documentDiscountKind,
      Decimal.tryParse(_documentDiscount.text.trim()),
    );
    final shares = allocateByWeight(nets, document.amount);
    var subTotal = Decimal.zero;
    var tax = Decimal.zero;
    for (var index = 0; index < nets.length; index++) {
      final net = nets[index] - shares[index];
      subTotal += net;
      tax += (net * rates[index] / Decimal.fromInt(100))
          .toDecimal(scaleOnInfinitePrecision: 12)
          .round(scale: moneyScale);
    }
    var landedCost = Decimal.zero;
    if (!widget.kind.isSales) {
      for (final charge in _landedCosts) {
        landedCost += Decimal.tryParse(charge.amount.text.trim()) ?? Decimal.zero;
      }
    }
    return (
      gross: gross,
      lineDiscount: lineDiscount,
      invoiceDiscount: document.amount,
      subTotal: subTotal,
      tax: tax,
      landedCost: landedCost,
      total: subTotal + tax + landedCost,
    );
  }

  void _applyItemDefaults(_LineDraft line, Json item) {
    // An explicit rate the user typed is respected; only the empty case is
    // filled in from the item.
    if (line.taxRate.text.trim().isEmpty || line.taxRate.text.trim() == '0') {
      line.taxRate.text = formatQuantity(asString(item['taxRate']), decimals: 2);
    }
    final units = lineUnitsOf(item);
    // Default to the smallest (base) unit the first time an item is picked;
    // a reopened line keeps the unit its snapshot recorded.
    if ((line.unitName == null || line.unitName!.isEmpty) && units.isNotEmpty) {
      line.unitName = text(units.first, 'unit');
    }
    if (line.unitPrice.text.trim().isEmpty ||
        line.unitPrice.text.trim() == '0') {
      final price = unitListPrice(
        item,
        line.unitName ?? text(item, 'unit'),
        isSales: widget.kind.isSales,
      );
      if (price.isNotEmpty) {
        line.unitPrice.text = formatQuantity(price, decimals: 2);
      }
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
      final discountText = line.discountValue.text.trim();
      lines.add({
        if (line.itemId != null) 'itemId': line.itemId,
        if (line.unitName != null && line.unitName!.trim().isNotEmpty)
          'unitName': line.unitName!.trim(),
        'quantity': quantity,
        'unitPrice': price,
        if (line.taxRate.text.trim().isNotEmpty) 'taxRate': line.taxRate.text.trim(),
        if (line.costCenterId != null) 'costCenterId': line.costCenterId,
        if (line.discountKind != DiscountKind.none)
          'discountType': discountTypeOf(line.discountKind),
        if (line.discountKind == DiscountKind.percent && discountText.isNotEmpty)
          'discountPercent': discountText,
        if (line.discountKind == DiscountKind.amount && discountText.isNotEmpty)
          'discountAmount': discountText,
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
        if (_documentDiscountKind != DiscountKind.none) ...{
          'discountType': discountTypeOf(_documentDiscountKind),
          if (_documentDiscountKind == DiscountKind.percent &&
              _documentDiscount.text.trim().isNotEmpty)
            'discountPercent': _documentDiscount.text.trim(),
          if (_documentDiscountKind == DiscountKind.amount &&
              _documentDiscount.text.trim().isNotEmpty)
            'discountAmount': _documentDiscount.text.trim(),
        },
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
            discountKind: _documentDiscountKind,
            discountController: _documentDiscount,
            onDiscountKindChanged: (value) =>
                setState(() => _documentDiscountKind = value),
            onDiscountChanged: () => setState(() {}),
            parties: partiesAsync.value ?? const [],
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
    required this.discountKind,
    required this.discountController,
    required this.onDiscountKindChanged,
    required this.onDiscountChanged,
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
  final DiscountKind discountKind;
  final TextEditingController discountController;
  final ValueChanged<DiscountKind> onDiscountKindChanged;
  final VoidCallback onDiscountChanged;
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
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: 220,
                  child: DropdownButtonFormField<DiscountKind>(
                    key: const ValueKey('document-discount'),
                    initialValue: discountKind,
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: l10n.invoiceDiscount,
                      helperText: l10n.discountBeforeTaxHint,
                      border: const OutlineInputBorder(),
                    ),
                    items: [
                      for (final kind in DiscountKind.values)
                        DropdownMenuItem(
                          value: kind,
                          child: Text(discountKindLabel(context, kind)),
                        ),
                    ],
                    onChanged: (value) {
                      if (value == null) return;
                      onDiscountKindChanged(value);
                      if (value == DiscountKind.none) {
                        discountController.clear();
                      }
                    },
                  ),
                ),
                const SizedBox(width: 12),
                SizedBox(
                  width: 200,
                  child: TextField(
                    key: const ValueKey('document-discount-value'),
                    controller: discountController,
                    enabled: discountKind != DiscountKind.none,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: InputDecoration(
                      labelText: discountKind == DiscountKind.percent
                          ? l10n.discountPercentValue
                          : l10n.discountAmountValue,
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                    onChanged: (_) => onDiscountChanged(),
                  ),
                ),
              ],
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
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
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
                        key: ValueKey('item-choice-${lines[index].itemId}'),
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
                          IconButton(
                            tooltip: l10n.selectItem,
                            visualDensity: VisualDensity.compact,
                            icon: const Icon(Icons.search, size: 18),
                            onPressed: () async {
                              final picked = await showItemPicker(
                                context,
                                title: l10n.selectItem,
                              );
                              if (picked == null) return;
                              lines[index].itemId = text(picked, 'id');
                              onItemDefaults(lines[index], picked);
                              onChanged();
                            },
                          ),
                        ],
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
                      child: Builder(
                        builder: (context) {
                          Json? selected;
                          for (final candidate in items) {
                            if (text(candidate, 'id') == lines[index].itemId) {
                              selected = candidate;
                              break;
                            }
                          }
                          final units = lineUnitsOf(
                            selected,
                            forSales: kind.isSales,
                          );
                          final names = units
                              .map((unit) => text(unit, 'unit'))
                              .toList();
                          final chosen = names.contains(lines[index].unitName)
                              ? lines[index].unitName
                              : (names.isNotEmpty ? names.first : null);
                          return DropdownButtonFormField<String>(
                            key: ValueKey('line-unit-$index'),
                            initialValue: chosen,
                            isExpanded: true,
                            isDense: true,
                            decoration: InputDecoration(
                              labelText: l10n.unit,
                              isDense: true,
                              border: const OutlineInputBorder(),
                            ),
                            items: [
                              for (final unit in units)
                                DropdownMenuItem<String>(
                                  value: text(unit, 'unit'),
                                  child: Text(
                                    flag(unit, 'isBase', fallback: false)
                                        ? text(unit, 'unit')
                                        : '${text(unit, 'unit')} '
                                              '×${formatQuantity(asString(unit['factor']), decimals: 0)}',
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                            ],
                            onChanged: units.isEmpty
                                ? null
                                : (value) {
                                    if (value == null) return;
                                    lines[index].unitName = value;
                                    final current =
                                        lines[index].unitPrice.text.trim();
                                    if (current.isEmpty || current == '0') {
                                      final price = selected == null
                                          ? ''
                                          : unitListPrice(
                                              selected,
                                              value,
                                              isSales: kind.isSales,
                                            );
                                      if (price.isNotEmpty) {
                                        lines[index].unitPrice.text =
                                            formatQuantity(price, decimals: 2);
                                      }
                                    }
                                    onChanged();
                                  },
                          );
                        },
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 2,
                      child: TextFormField(
                        key: ValueKey('line-quantity-$index'),
                        controller: lines[index].quantity,
                        keyboardType: const TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        decoration: InputDecoration(
                          labelText: l10n.quantity,
                          isDense: true,
                          border: const OutlineInputBorder(),
                        ),
                        // A unit that takes whole units only says so before
                        // the document is saved, not after it is refused.
                        validator: (value) {
                          Json? itemOfLine;
                          for (final candidate in items) {
                            if (text(candidate, 'id') ==
                                lines[index].itemId) {
                              itemOfLine = candidate;
                              break;
                            }
                          }
                          final chosenUnit = lineUnitOf(
                            itemOfLine,
                            lines[index].unitName,
                          );
                          if (quantityAllowedInUnit(chosenUnit, value ?? '')) {
                            return null;
                          }
                          return l10n.unitTakesWholeNumbers(
                            text(chosenUnit ?? const <String, dynamic>{}, 'unit'),
                          );
                        },
                        onChanged: (_) => onChanged(),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      flex: 2,
                      child: TextFormField(
                        key: ValueKey('line-price-$index'),
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
                Padding(
                  padding: const EdgeInsetsDirectional.only(start: 12, top: 4),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 170,
                        child: DropdownButtonFormField<DiscountKind>(
                          key: ValueKey('line-discount-$index'),
                          initialValue: lines[index].discountKind,
                          isDense: true,
                          isExpanded: true,
                          decoration: InputDecoration(
                            labelText: l10n.lineDiscount,
                            border: const OutlineInputBorder(),
                          ),
                          items: [
                            for (final kind in DiscountKind.values)
                              DropdownMenuItem(
                                value: kind,
                                child: Text(discountKindLabel(context, kind)),
                              ),
                          ],
                          onChanged: (value) {
                            if (value == null) return;
                            lines[index].discountKind = value;
                            if (value == DiscountKind.none) {
                              lines[index].discountValue.clear();
                            }
                            onChanged();
                          },
                        ),
                      ),
                      const SizedBox(width: 8),
                      SizedBox(
                        width: 150,
                        child: TextFormField(
                          key: ValueKey('line-discount-value-$index'),
                          controller: lines[index].discountValue,
                          enabled:
                              lines[index].discountKind != DiscountKind.none,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          decoration: InputDecoration(
                            labelText: lines[index].discountKind ==
                                    DiscountKind.percent
                                ? l10n.discountPercentValue
                                : l10n.discountAmountValue,
                            isDense: true,
                            border: const OutlineInputBorder(),
                          ),
                          onChanged: (_) => onChanged(),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          '${l10n.beforeDiscount}: '
                          '${formatAmount(lines[index].pricing.gross.toString())}'
                          '  −  ${formatAmount(lines[index].pricing.discount.amount.toString())}'
                          '  =  ${l10n.netLine}: '
                          '${formatAmount(lines[index].pricing.discount.net.toString())}',
                          style: Theme.of(context).textTheme.bodySmall,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
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
    if (quantity == null || price == null) {
      return const InputDecorator(
        decoration: InputDecoration(
          labelText: '',
          isDense: true,
          border: OutlineInputBorder(),
        ),
        child: Text('—', textAlign: TextAlign.end),
      );
    }
    final pricing = line.pricing;
    final hasDiscount = pricing.discount.amount > Decimal.zero;
    return InputDecorator(
      decoration: const InputDecoration(
        labelText: '',
        isDense: true,
        border: OutlineInputBorder(),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (hasDiscount) ...[
            Text(
              formatAmount(pricing.gross.toString()),
              textAlign: TextAlign.end,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    decoration: TextDecoration.lineThrough,
                  ),
            ),
            Text(
              '− ${formatAmount(pricing.discount.amount.toString())}',
              textAlign: TextAlign.end,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const Divider(height: 4),
          ],
          Text(
            formatAmount(pricing.discount.net.toString()),
            textAlign: TextAlign.end,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ],
      ),
    );
  }
}

class _Totals extends StatelessWidget {
  const _Totals({required this.totals, required this.showLandedCost});

  final ({
    Decimal gross,
    Decimal lineDiscount,
    Decimal invoiceDiscount,
    Decimal subTotal,
    Decimal tax,
    Decimal landedCost,
    Decimal total,
  }) totals;

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
            row(l10n.beforeDiscount, totals.gross),
            if (totals.lineDiscount != Decimal.zero)
              row(l10n.lineDiscounts, totals.lineDiscount),
            if (totals.invoiceDiscount != Decimal.zero)
              row(l10n.invoiceDiscount, totals.invoiceDiscount),
            row(l10n.subTotal, totals.subTotal),
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
