import 'dart:convert';

import 'package:decimal/decimal.dart';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/json/discount_math.dart';
import '../../../../core/error/failure.dart';
import '../../../../shared/barcode/barcode_scan.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/discount_kind_label.dart';
import '../../../../shared/widgets/item_picker_dialog.dart';
import '../../../inventory/data/item_image_data_source.dart';
import '../../../inventory/presentation/widgets/item_picture.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
import '../../../accounting/presentation/providers/cost_center_providers.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../providers/invoice_providers.dart';

/// An automatic price may follow a changed unit; a price typed by the user
/// (including an explicit zero) must not be silently replaced.
bool maySuggestUnitPrice(
  String current, {
  required bool automatic,
  required bool edited,
}) =>
    automatic || (!edited && (current.trim().isEmpty || current.trim() == '0'));

Json? itemForInvoiceLine(List<Json> items, String? itemId) {
  for (final item in items) {
    if (text(item, 'id') == itemId) return item;
  }
  return null;
}

/// One editable invoice line.
class _LineDraft {
  _LineDraft({
    String quantity = '1',
    String unitPrice = '0',
    String taxRate = '',
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
  bool taxRateEdited = false;
  bool unitPriceAutomatic = false;
  bool unitPriceEdited = false;

  /// A line discount: a percentage or a fixed amount of money. The server
  /// resolves the other representation and stores both.
  DiscountKind discountKind = DiscountKind.none;
  final TextEditingController discountValue;

  /// The line's own arithmetic, for the summary under the inputs.
  ({Decimal gross, ResolvedDiscount discount}) get pricing {
    final quantityValue =
        Decimal.tryParse(quantity.text.trim()) ?? Decimal.zero;
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

/// The routed invoice list owns the navigation guard; an imperative editor
/// temporarily attaches its own confirmation while it is on top.
class InvoiceDraftExitRelay {
  Future<bool> Function()? _guard;
  void attach(Future<bool> Function() guard) {
    _guard = guard;
  }

  void detach(Future<bool> Function() guard) {
    if (_guard == guard) _guard = null;
  }

  Future<bool> canLeave() => _guard?.call() ?? Future.value(true);
}

/// Creates a draft sales or purchase invoice.
///
/// The screen only ever creates a draft. Posting is a separate, deliberate
/// step from the list, because posting moves stock and writes to the ledger.
class InvoiceEditorScreen extends ConsumerStatefulWidget {
  const InvoiceEditorScreen({
    super.key,
    required this.kind,
    this.invoiceId,
    this.exitRelay,
  });

  final InvoiceKind kind;
  final String? invoiceId;
  final InvoiceDraftExitRelay? exitRelay;

  @override
  ConsumerState<InvoiceEditorScreen> createState() =>
      _InvoiceEditorScreenState();
}

class _InvoiceEditorScreenState extends ConsumerState<InvoiceEditorScreen> {
  final _lines = <_LineDraft>[];

  /// Small pictures for the items this invoice can name, so a line shows the
  /// same picture as the catalogue. Absent means "no picture".
  Map<String, Uint8List> _itemPictures = const {};
  String _itemPicturesKey = '';

  String? _partyId;
  String? _supplierReference;
  String? _notes;
  late String _invoiceDate;
  final _landedCosts = <_LandedCostDraft>[];
  final _documentDiscount = TextEditingController();
  DiscountKind _documentDiscountKind = DiscountKind.none;
  bool _saving = false;
  bool _loadingExisting = false;
  bool _loadFailed = false;
  bool _confirmingExit = false;
  late String _savedSnapshot;

  /// The invoice-level scan box, and what the last accepted scan was.
  ///
  /// The guard lives on the document rather than on a line because a scan adds
  /// a line: there is no line to hold the state until the scan has succeeded.
  final _barcode = TextEditingController();
  String? _lastScanCode;
  DateTime? _lastScanAt;
  bool _scanInFlight = false;

  String _snapshot() => jsonEncode({
    'party': _partyId,
    'reference': _supplierReference,
    'notes': _notes,
    'date': _invoiceDate,
    'discountKind': _documentDiscountKind.name,
    'discount': _documentDiscount.text,
    'costs': [
      for (final cost in _landedCosts)
        [cost.description.text, cost.amount.text],
    ],
    'lines': [
      for (final line in _lines)
        [
          line.itemId,
          line.unitName,
          line.costCenterId,
          line.quantity.text,
          line.unitPrice.text,
          line.taxRate.text,
          line.taxRateEdited,
          line.discountKind.name,
          line.discountValue.text,
        ],
    ],
  });

  Future<bool> _confirmExit() async {
    if (_saving || _loadingExisting || _confirmingExit) return false;
    if (_snapshot() == _savedSnapshot) return true;
    _confirmingExit = true;
    try {
      final ar = Localizations.localeOf(context).languageCode == 'ar';
      final leave = await confirmAction(
        context,
        title: ar ? 'تغييرات غير محفوظة' : 'Unsaved changes',
        message: ar
            ? 'الخروج دون حفظ الفاتورة؟'
            : 'Leave without saving the invoice?',
        confirmLabel: ar ? 'خروج' : 'Discard',
        destructive: true,
      );
      return leave && mounted;
    } finally {
      _confirmingExit = false;
    }
  }

  Future<void> _close() async {
    if (await _confirmExit() && mounted) Navigator.of(context).pop();
  }

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _invoiceDate =
        '${now.year.toString().padLeft(4, '0')}-'
        '${now.month.toString().padLeft(2, '0')}-'
        '${now.day.toString().padLeft(2, '0')}';
    _lines.add(_LineDraft());
    _savedSnapshot = _snapshot();
    widget.exitRelay?.attach(_confirmExit);
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
        await showAppError(context, context.l10n.onlyDraftInvoiceCanBeEdited);
        if (mounted) Navigator.of(context).pop();
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
        _landedCosts.add(
          _LandedCostDraft(
            description: text(row, 'description'),
            amount: text(row, 'amount', fallback: '0'),
          ),
        );
      }
      final legacyLandedCost =
          Decimal.tryParse(text(invoice, 'landedCostAmount')) ?? Decimal.zero;
      if (_landedCosts.isEmpty && legacyLandedCost > Decimal.zero) {
        _landedCosts.add(
          _LandedCostDraft(
            description: context.l10n.otherLandedCosts,
            amount: legacyLandedCost.toString(),
          ),
        );
      }
      for (final row in listOf(invoice['lines'])) {
        // Reopen shows exactly what the user entered. A multi-unit line keeps
        // the entered quantity and its unit; a legacy row has no snapshot, so
        // it falls back to the stored base quantity with no unit selected.
        final line =
            _LineDraft(
                quantity: text(
                  row,
                  'unitQuantity',
                  fallback: text(row, 'quantity', fallback: '1'),
                ),
                unitPrice: text(row, 'unitPrice', fallback: '0'),
                taxRate: text(row, 'taxRate', fallback: ''),
              )
              ..itemId = text(row, 'itemId').isEmpty
                  ? null
                  : text(row, 'itemId')
              ..unitName = text(row, 'unitName').isEmpty
                  ? null
                  : text(row, 'unitName')
              ..unitPriceEdited = true
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
      _documentDiscountKind = discountKindOf(text(invoice, 'discountType'));
      _documentDiscount.text = _documentDiscountKind == DiscountKind.percent
          ? text(invoice, 'discountPercent', fallback: '')
          : text(invoice, 'discountAmount', fallback: '');
      if (_documentDiscount.text == '0.0000') _documentDiscount.text = '';
      if (_documentDiscountKind == DiscountKind.none) _documentDiscount.clear();
      setState(() {
        _partyId = text(invoice, widget.kind.partyKey).isNotEmpty
            ? text(
                Map<String, dynamic>.from(invoice[widget.kind.partyKey] as Map),
                'id',
              )
            : null;
        _supplierReference = text(invoice, 'supplierReference').isEmpty
            ? null
            : text(invoice, 'supplierReference');
        _notes = text(invoice, 'notes').isEmpty ? null : text(invoice, 'notes');
        _invoiceDate = text(invoice, 'invoiceDate', fallback: _invoiceDate);
        _loadingExisting = false;
      });
      _savedSnapshot = _snapshot();
    } catch (error) {
      if (mounted) {
        setState(() {
          _loadingExisting = false;
          _loadFailed = true;
        });
        showAppError(context, error);
      }
    }
  }

  @override
  void dispose() {
    widget.exitRelay?.detach(_confirmExit);
    for (final line in _lines) {
      line.dispose();
    }
    for (final charge in _landedCosts) {
      charge.dispose();
    }
    _documentDiscount.dispose();
    _barcode.dispose();
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
  })
  get _totals {
    final nets = <Decimal>[];
    final rates = <Decimal>[];
    var gross = Decimal.zero;
    var lineDiscount = Decimal.zero;
    for (final line in _lines) {
      final pricing = line.pricing;
      if (line.quantity.text.trim().isEmpty ||
          line.unitPrice.text.trim().isEmpty) {
        continue;
      }
      gross += pricing.gross;
      lineDiscount += pricing.discount.amount;
      nets.add(pricing.discount.net);
      rates.add(Decimal.tryParse(line.taxRate.text.trim()) ?? Decimal.zero);
    }
    final netBeforeDocument = nets.fold(
      Decimal.zero,
      (sum, value) => sum + value,
    );
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
        landedCost +=
            Decimal.tryParse(charge.amount.text.trim()) ?? Decimal.zero;
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

  /// Fetches the pictures for the items this invoice can name, once.
  ///
  /// The key is the sorted ids, so a rebuild, a keystroke or a row edit does
  /// not re-request them. A failure leaves the pictures empty: an invoice must
  /// still be written when a thumbnail cannot be fetched.
  void _loadItemPictures(List<Json> items) {
    final ids = [
      for (final item in items)
        if (text(item, 'id').isNotEmpty) text(item, 'id'),
    ]..sort();
    final key = ids.join(',');
    if (key == _itemPicturesKey) return;
    _itemPicturesKey = key;
    if (ids.isEmpty) return;
    ItemImageDataSource(ref.read(apiClientProvider))
        .thumbnails(ids)
        .then<void>((pictures) {
          if (!mounted || _itemPicturesKey != key) return;
          setState(() => _itemPictures = pictures);
        }, onError: (Object _) {
          // A thumbnail that cannot be fetched is not worth a dialog: the
          // picker still lists every item, just without pictures.
        });
  }

  /// Adds what a scanned label stands for to the invoice.
  ///
  /// The rules, in the order they matter:
  ///   * one scan is ONE of the unit the label identifies - never its factor.
  ///     A carton label whose factor is 24 adds one carton, and the quantity
  ///     box reads 1; the server multiplies by 24 exactly once when the
  ///     invoice is saved. Writing 24 here would store 576 pieces.
  ///   * scanning the same item and unit again adds one more of it, so two
  ///     scans of a carton give 2 cartons.
  ///   * scanning a different item - or the same item in a different unit -
  ///     starts a new line at 1 instead of overwriting the line above.
  ///   * the unit the label names wins over the default sale/purchase unit,
  ///     because the label is more specific than the catalogue default; when
  ///     the label is the item's own barcode the default unit for this
  ///     document decides.
  ///   * a failed lookup changes nothing: no line is added, no quantity is
  ///     touched, and the operator's other input stays exactly as typed.
  Future<void> _scanInvoiceBarcode(String rawCode) async {
    final code = rawCode.trim();
    if (code.isEmpty || _saving || _loadingExisting) return;
    if (isRepeatScan(
      lastCode: _lastScanCode,
      lastAt: _lastScanAt,
      code: code,
      inFlight: _scanInFlight,
    )) {
      // The scanner fired again for the same physical press. Clear the box so
      // the next scan starts clean, but do not add a second carton.
      _barcode.clear();
      return;
    }
    _scanInFlight = true;
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    try {
      final scanner = BarcodeScanner(
        lookup: (value) => ref
            .read(apiClientProvider)
            .getObject(
              '/inventory/items/by-barcode/${Uri.encodeComponent(value)}',
            ),
      );
      final match = await scanner.scan(
        code,
        arabic: arabic,
        onMatch: (match) async {
          if (!mounted) return;
          setState(() {
            _addScannedLine(match, isSales: widget.kind.isSales);
            _barcode.clear();
          });
        },
        // The wording of both failure sentences lives in the shared helper, so
        // every screen says the same thing about the same label. It is shown
        // as written because this screen composed it on purpose.
        onFailure: (message) async {
          if (!mounted) return;
          await showAppPlainError(context, message);
        },
      );
      if (match == null) return;
      // Remembered only now: a failed lookup must stay retryable by scanning
      // the same label again immediately.
      _lastScanCode = code;
      _lastScanAt = DateTime.now();
    } finally {
      _scanInFlight = false;
    }
  }

  /// Puts one scanned [match] on the invoice: an existing line for the same
  /// item and unit gains one, otherwise the empty line (or a new one) is used.
  void _addScannedLine(BarcodeMatch match, {required bool isSales}) {
    // Which unit this scan adds, decided once for every screen that scans.
    final unit = defaultScannedUnit(match, isSales: isSales);
    // A line the operator has not touched is reused rather than left behind as
    // an empty first row: the invoice would otherwise start with a gap every
    // time the first thing that happens is a scan.
    var index = _lines.indexWhere(
      (line) => line.itemId == match.itemId && line.unitName == unit,
    );
    // A line that already names this item in another unit is a scan of a
    // different thing (six pieces on one line, two cartons on the next), so it
    // is left alone. Only a line carrying nothing at all is reused.
    if (index < 0) {
      final blank = _lines.indexWhere((line) => _lineIsEmpty(line));
      if (blank >= 0) {
        index = blank;
      } else {
        _lines.add(_LineDraft());
        index = _lines.length - 1;
      }
    }
    final line = _lines[index];
    final sameSelection = line.itemId == match.itemId && line.unitName == unit;
    final current = sameSelection
        ? Decimal.tryParse(line.quantity.text.trim())
        : null;
    // The item and unit are assigned before the quantity, so the price helper
    // below prices the chosen unit rather than whatever the line held a moment
    // ago. The box itself holds the CHOSEN unit: `quantityAfterScan` adds one
    // to the number already there, and never multiplies by the factor.
    line.itemId = match.itemId;
    line.unitName = unit;
    line.quantity.text = plainQuantity(
      quantityAfterScan(current: current, sameSelection: sameSelection),
    );
    // The price follows the unit that was just selected, through the same
    // helper the manual path uses: a scanned carton and a hand-typed carton
    // must cost the same, and a price the operator typed themselves is never
    // replaced. The unit is passed in already set, so the helper prices the
    // scanned unit rather than falling back to the document default.
    _applyItemDefaults(line, match.item);
    // `_applyItemDefaults` honours a unit already on the line, so the scan's
    // choice survives it. This restores it anyway if a future change there
    // starts preferring the catalogue default: the scanned unit is the truth.
    line.unitName = unit;
  }

  /// True when a line is still the untouched draft `_LineDraft()` builds: no
  /// item, the default quantity of 1, no price of its own and no discount.
  ///
  /// A scan reuses such a line instead of leaving an empty row above the one it
  /// just filled. Anything an operator typed disqualifies it, so a scan can
  /// never take over a line somebody was working on.
  bool _lineIsEmpty(_LineDraft line) {
    if (line.itemId != null ||
        line.unitPriceEdited ||
        line.taxRateEdited ||
        line.discountKind != DiscountKind.none ||
        line.costCenterId != null) {
      return false;
    }
    final quantity = line.quantity.text.trim();
    final price = line.unitPrice.text.trim();
    return (quantity.isEmpty || quantity == '1') &&
        (price.isEmpty || price == '0');
  }

  void _applyItemDefaults(_LineDraft line, Json item) {
    // The visible blank rate means zero, not an omitted server default.
    // Never replace the entered or blank rate when selecting an item.
    final units = lineUnitsOf(item);
    final scannedUnit = text(item, '_scannedUnitName');
    if (scannedUnit.isNotEmpty &&
        units.any((unit) => text(unit, 'unit') == scannedUnit)) {
      line.unitName = scannedUnit;
    } else if ((line.unitName == null || line.unitName!.isEmpty) &&
        units.isNotEmpty) {
      line.unitName = defaultLineUnit(item, isSales: widget.kind.isSales);
    }
    if (maySuggestUnitPrice(
      line.unitPrice.text,
      automatic: line.unitPriceAutomatic,
      edited: line.unitPriceEdited,
    )) {
      final price = unitListPrice(
        item,
        line.unitName ?? text(item, 'unit'),
        isSales: widget.kind.isSales,
      );
      line.unitPrice.text = formatQuantity(price, decimals: 4);
      line.unitPriceAutomatic = true;
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
        landedCostCharges.add({
          'description': description,
          'amount': amount.toString(),
        });
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
        // The form always shows a tax field: blank or whitespace is an
        // explicit zero, whereas omitting the API field has distinct meaning.
        'taxRate': line.taxRate.text.trim().isEmpty
            ? '0'
            : line.taxRate.text.trim(),
        if (line.costCenterId != null) 'costCenterId': line.costCenterId,
        if (line.discountKind != DiscountKind.none)
          'discountType': discountTypeOf(line.discountKind),
        if (line.discountKind == DiscountKind.percent &&
            discountText.isNotEmpty)
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
        await ref
            .read(apiClientProvider)
            .put('${widget.kind.basePath}/${widget.invoiceId}', body: body);
      } else {
        await ref
            .read(apiClientProvider)
            .post(widget.kind.basePath, body: body);
      }
      await ref.read(invoiceListProvider(widget.kind).notifier).reload();
      if (mounted) {
        Navigator.of(context).pop(true);
        showMessage(context, l10n.invoiceSaved);
      }
    } on Failure catch (e) {
      if (mounted) showMessage(context, e, error: true);
    } catch (error) {
      if (mounted) showAppError(context, error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final itemsAsync = ref.watch(activeItemsProvider);
    // Fetching the thumbnails here keeps it next to the watch that supplies
    // the catalogue; the loader itself does nothing on a rebuild with the
    // same items.
    _loadItemPictures(itemsAsync.value ?? const []);
    final partiesAsync = ref.watch(
      widget.kind.isSales ? activeCustomersProvider : activeSuppliersProvider,
    );
    // Every centre, including a deactivated one, so a draft that already
    // names a centre still shows it. The server still refuses a new posting
    // to an inactive centre, and says so.
    final costCenters = ref.watch(costCentersProvider).value ?? const <Json>[];
    final language = Localizations.localeOf(context).languageCode;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _close();
      },
      child: Scaffold(
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
                onPressed: _saving || _loadingExisting || _loadFailed
                    ? null
                    : _save,
                icon: const Icon(Icons.save_outlined),
                label: Text(l10n.save),
              ),
            ),
          ],
        ),
        body: _loadFailed
            ? Center(
                child: OutlinedButton.icon(
                  icon: const Icon(Icons.refresh),
                  label: Text(l10n.retry),
                  onPressed: () {
                    setState(() {
                      _loadFailed = false;
                      _loadingExisting = true;
                    });
                    _loadExisting();
                  },
                ),
              )
            : IgnorePointer(
                ignoring: _loadingExisting || _saving,
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _Header(
                      key: ValueKey(
                        '${widget.invoiceId ?? 'new'}-$_loadingExisting',
                      ),
                      kind: widget.kind,
                      invoiceDate: _invoiceDate,
                      onDateChanged: (value) =>
                          setState(() => _invoiceDate = value),
                      partyId: _partyId,
                      onPartyChanged: (value) =>
                          setState(() => _partyId = value),
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
                          Expanded(
                            child: Text(
                              l10n.landedCosts,
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                          ),
                          TextButton.icon(
                            onPressed: () => setState(
                              () => _landedCosts.add(_LandedCostDraft()),
                            ),
                            icon: const Icon(Icons.add),
                            label: Text(l10n.addLandedCost),
                          ),
                        ],
                      ),
                      Text(
                        l10n.landedCostAllocationHint,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      for (
                        var index = 0;
                        index < _landedCosts.length;
                        index++
                      ) ...[
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
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                      decimal: true,
                                    ),
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
                              onPressed: () => setState(
                                () => _landedCosts.removeAt(index).dispose(),
                              ),
                              icon: const Icon(Icons.delete_outline),
                            ),
                          ],
                        ),
                      ],
                    ],
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Text(
                          l10n.invoiceLines,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const Spacer(),
                        TextButton.icon(
                          onPressed: () =>
                              setState(() => _lines.add(_LineDraft())),
                          icon: const Icon(Icons.add),
                          label: Text(l10n.addLine),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    // A scanner types into a field and presses Enter. The box
                    // sits directly above the lines it adds, so what a scan did
                    // is visible without looking anywhere else on the screen.
                    SizedBox(
                      width: 420,
                      child: BarcodeScanField(
                        key: const ValueKey('invoice-barcode'),
                        controller: _barcode,
                        arabic: Localizations.localeOf(context).languageCode == 'ar',
                        label: Localizations.localeOf(context).languageCode == 'ar'
                            ? 'امسح الباركود لإضافة صنف'
                            : 'Scan a barcode to add an item',
                        enabled: !_saving && !_loadingExisting,
                        onSubmitted: _scanInvoiceBarcode,
                      ),
                    ),
                    const SizedBox(height: 8),
                    _LinesTable(
                      kind: widget.kind,
                      lines: _lines,
                      items: itemsAsync.value ?? const [],
                      pictures: _itemPictures,
                      costCenters: costCenters,
                      language: language,
                      onChanged: () => setState(() {}),
                      onAdd: () => setState(() => _lines.add(_LineDraft())),
                      onRemove: (index) =>
                          setState(() => _lines.removeAt(index).dispose()),
                      onItemDefaults: _applyItemDefaults,
                    ),
                    const SizedBox(height: 16),
                    _Totals(
                      totals: _totals,
                      showLandedCost: !widget.kind.isSales,
                    ),
                  ],
                ),
              ),
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
                        initialDate: DateTime.tryParse(invoiceDate) ?? now,
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
                      // Preserve an existing draft selection if a source refresh
                      // deactivates/removes it. It remains visible but cannot be
                      // newly selected; the server still validates on save/post.
                      if (partyId != null &&
                          !parties.any((party) => text(party, 'id') == partyId))
                        DropdownMenuItem(
                          value: partyId,
                          enabled: false,
                          child: Text(
                            Localizations.localeOf(context).languageCode == 'ar'
                                ? 'الطرف المحدد غير متاح'
                                : 'Selected party unavailable',
                          ),
                        ),
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
    required this.pictures,
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

  /// Small pictures by item id; an absent entry means the item has none.
  final Map<String, Uint8List> pictures;
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
                                  key: ValueKey(
                                    'item-choice-${lines[index].itemId}',
                                  ),
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
                                        // The field is expanded, so the item
                                        // is laid out within its width. The
                                        // fixed thumbnail and the gap are
                                        // subtracted first and the name takes
                                        // what is left, ellipsised - without a
                                        // flexible child this row overflows.
                                        child: Row(
                                          children: [
                                            ItemThumbnail(
                                              bytes:
                                                  pictures[text(item, 'id')],
                                              size: 24,
                                            ),
                                            const SizedBox(width: 8),
                                            Flexible(
                                              child: Text(
                                                '${text(item, 'code')} — ${text(item, 'nameEn')}',
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                  ],
                                  onChanged: (value) {
                                    if (lines[index].itemId != value) {
                                      lines[index].unitName = null;
                                    }
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
                                  final itemId = text(picked, 'id');
                                  if (lines[index].itemId != itemId) {
                                    lines[index].unitName = null;
                                  }
                                  lines[index].itemId = itemId;
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
                                    value == null || value.isEmpty
                                    ? null
                                    : value;
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
                                if (text(candidate, 'id') ==
                                    lines[index].itemId) {
                                  selected = candidate;
                                  break;
                                }
                              }
                              final units = lineUnitsOf(selected);
                              final names = units
                                  .map((unit) => text(unit, 'unit'))
                                  .toList();
                              final chosen =
                                  names.contains(lines[index].unitName)
                                  ? lines[index].unitName
                                  : (names.isNotEmpty
                                        ? defaultLineUnit(
                                            selected!,
                                            isSales: kind.isSales,
                                          )
                                        : null);
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
                                                  '×${formatQuantity(asString(unit['factor']), decimals: 6)}',
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                ],
                                onChanged: units.isEmpty
                                    ? null
                                    : (value) {
                                        if (value == null) return;
                                        lines[index].unitName = value;
                                        final line = lines[index];
                                        if (maySuggestUnitPrice(
                                          line.unitPrice.text,
                                          automatic: line.unitPriceAutomatic,
                                          edited: line.unitPriceEdited,
                                        )) {
                                          final price = selected == null
                                              ? ''
                                              : unitListPrice(
                                                  selected,
                                                  value,
                                                  isSales: kind.isSales,
                                                );
                                          line.unitPrice.text = formatQuantity(
                                            price,
                                            decimals: 4,
                                          );
                                          line.unitPriceAutomatic = true;
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
                            onChanged: (_) => onChanged(),
                          ),
                        ),
                        const SizedBox(width: 8),
                        // What the quantity above means in base units. Shown,
                        // never posted: the server multiplies by the factor
                        // once, and a second multiplication here would store a
                        // carton of 24 as 576 pieces. The line is absent for a
                        // base-unit line, where the two numbers are identical.
                        SizedBox(
                          width: 150,
                          child: _LineBaseEquivalent(
                            key: ValueKey('line-base-equivalent-$index'),
                            item: itemForInvoiceLine(items, lines[index].itemId),
                            unitName: lines[index].unitName,
                            quantity: lines[index].quantity,
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
                            onChanged: (_) {
                              lines[index].unitPriceAutomatic = false;
                              lines[index].unitPriceEdited = true;
                              onChanged();
                            },
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          flex: 2,
                          child: TextFormField(
                            key: ValueKey('line-tax-rate-$index'),
                            controller: lines[index].taxRate,
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            decoration: InputDecoration(
                              labelText: l10n.taxRate,
                              isDense: true,
                              border: const OutlineInputBorder(),
                            ),
                            onChanged: (_) {
                              lines[index].taxRateEdited = true;
                              onChanged();
                            },
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
                          onPressed: lines.length == 1
                              ? null
                              : () => onRemove(index),
                        ),
                      ],
                    ),
                    // The item, unit and quantity in one sentence, under the
                    // controls that hold them. A scanned label changes three
                    // fields at once, and this is the line that says which
                    // three, in the reader's own language.
                    Padding(
                      padding: const EdgeInsetsDirectional.only(
                        start: 12,
                        top: 6,
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: _LineScanSummary(
                              key: ValueKey('line-scan-summary-$index'),
                              item: itemForInvoiceLine(items, lines[index].itemId),
                              unitName: lines[index].unitName,
                              quantity: lines[index].quantity,
                              language: language,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsetsDirectional.only(
                        start: 12,
                        top: 4,
                      ),
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
                                    child: Text(
                                      discountKindLabel(context, kind),
                                    ),
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
                                  lines[index].discountKind !=
                                  DiscountKind.none,
                              keyboardType:
                                  const TextInputType.numberWithOptions(
                                    decimal: true,
                                  ),
                              decoration: InputDecoration(
                                labelText:
                                    lines[index].discountKind ==
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

/// "مياه — 1 كرتونة": the item, the unit and the quantity, in the reader's
/// language, in one glance.
///
/// Built only from what the row already holds, so it can never disagree with
/// the fields above it. It listens to the quantity box, so it follows typing as
/// well as a scan.
class _LineScanSummary extends StatelessWidget {
  const _LineScanSummary({
    super.key,
    required this.item,
    required this.unitName,
    required this.quantity,
    required this.language,
  });

  final Json? item;
  final String? unitName;
  final TextEditingController quantity;
  final String language;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<TextEditingValue>(
      valueListenable: quantity,
      builder: (context, value, _) {
        final current = item;
        final qty = value.text.trim();
        if (current == null || qty.isEmpty) return const SizedBox.shrink();
        final arabic = language == 'ar';
        final name = arabic
            ? text(current, 'nameAr', fallback: text(current, 'nameEn'))
            : text(current, 'nameEn', fallback: text(current, 'nameAr'));
        final unit = (unitName == null || unitName!.isEmpty)
            ? text(current, 'unit')
            : unitName!;
        return Align(
          alignment: AlignmentDirectional.centerStart,
          // A single sentence, so an Arabic reader and an English one both read
          // it in the direction their locale gives them. The base equivalent is
          // its own line further along the row, so it is not repeated here.
          child: Text(
            '$name — $qty $unit',
            style: Theme.of(context).textTheme.bodySmall,
            overflow: TextOverflow.ellipsis,
            maxLines: 2,
          ),
        );
      },
    );
  }
}

/// The base-unit equivalent of a line's quantity, next to the box that holds
/// the chosen unit's figure.
///
/// It listens to the quantity controller, so typing 2 next to "carton x24"
/// immediately reads "= 48 piece" without a rebuild of the whole table. An
/// item or unit without a known factor shows nothing rather than a guess: a
/// wrong equivalent is worse than none, because the operator would trust it.
class _LineBaseEquivalent extends StatelessWidget {
  const _LineBaseEquivalent({
    super.key,
    required this.item,
    required this.unitName,
    required this.quantity,
  });

  final Json? item;
  final String? unitName;
  final TextEditingController quantity;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<TextEditingValue>(
      valueListenable: quantity,
      builder: (context, value, _) {
        final equivalent = baseEquivalentLabel(
          item: item,
          unitName: unitName,
          quantityText: value.text,
        );
        if (equivalent == null) {
          return const SizedBox.shrink();
        }
        return Align(
          alignment: AlignmentDirectional.centerStart,
          child: Text(
            '= $equivalent',
            style: Theme.of(context).textTheme.bodySmall,
            overflow: TextOverflow.ellipsis,
          ),
        );
      },
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
              style: Theme.of(context).textTheme.bodySmall
                  ?.copyWith(decoration: TextDecoration.lineThrough),
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
  })
  totals;

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
