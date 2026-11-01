import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/json_utils.dart';

/// The packing table of one item, edited in the item form itself.
///
/// A person creating «مياه» should not have to save the item first, find it in
/// a list, and then open a second dialog to say that a carton holds twelve.
/// The base unit and every carton, pack or dozen are therefore collected here,
/// beside the item, and the whole thing is saved by one request: the server
/// writes the item and its units in a single transaction, so a refused save
/// leaves nothing half-written.
///
/// Two rules shape the screen, and both are also enforced on the server:
///
///   * a factor is always "how many base units is one of these", never a chain
///     - كرتونة = 4 دستات would drift the moment a دستة changed;
///   * the base unit's factor is 1, because it *is* what stock is counted in.
///
/// The prices are per unit and optional. A price that is left empty is not
/// invented here: the invoice suggests factor × base price at the moment of
/// use, and stores whatever the person accepts - so changing a factor later
/// never rewrites a price that was already posted.

/// What the editor hands back to the item form.
class ItemUnitsDraft {
  const ItemUnitsDraft({required this.baseUnit, required this.rows});

  /// The unit stock is counted in. Sent as the item's `unit`.
  final String baseUnit;

  /// One entry per unit, base unit first, in the shape the API expects.
  final List<Map<String, dynamic>> rows;
}

class ItemUnitsEditor extends StatefulWidget {
  const ItemUnitsEditor({
    super.key,
    required this.baseUnit,
    this.itemName,
    this.initialUnits = const [],
    this.canManageBarcodes = false,
    this.canSeeCost = false,
    this.isEdit = false,
  });

  final String baseUnit;
  final String? itemName;

  /// The units as the API returned them: `unit`, `factor`, `barcode`,
  /// `salePrice`, `purchasePrice`, `allowFraction`, `id`.
  final List<Map<String, dynamic>> initialUnits;

  final bool canManageBarcodes;
  final bool canSeeCost;

  /// On an existing item the base unit may already be part of recorded
  /// history, so the field explains what the server will answer.
  final bool isEdit;

  @override
  State<ItemUnitsEditor> createState() => _ItemUnitsEditorState();
}

class _Row {
  _Row({
    required this.isBase,
    String? id,
    String unit = '',
    String factor = '1',
    String barcode = '',
    String salePrice = '',
    String purchasePrice = '',
    bool allowFraction = true,
  })  : id = id,
        unit = TextEditingController(text: unit),
        factor = TextEditingController(text: factor),
        barcode = TextEditingController(text: barcode),
        salePrice = TextEditingController(text: salePrice),
        purchasePrice = TextEditingController(text: purchasePrice),
        allowFraction = allowFraction;

  final bool isBase;
  final String? id;
  final TextEditingController unit;
  final TextEditingController factor;
  final TextEditingController barcode;
  final TextEditingController salePrice;
  final TextEditingController purchasePrice;
  bool allowFraction;

  void dispose() {
    unit.dispose();
    factor.dispose();
    barcode.dispose();
    salePrice.dispose();
    purchasePrice.dispose();
  }
}

class _ItemUnitsEditorState extends State<ItemUnitsEditor> {
  late final TextEditingController _baseUnit;
  final List<_Row> _rows = [];
  String? _error;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String _t(String ar, String en) => _arabic ? ar : en;

  @override
  void initState() {
    super.initState();
    _baseUnit = TextEditingController(text: widget.baseUnit);

    final stored = widget.initialUnits;
    if (stored.isEmpty) {
      _rows.add(_Row(isBase: true, unit: widget.baseUnit, factor: '1'));
      return;
    }
    // The base unit first, then the packs in ascending factor order: the
    // order a person reads "one carton is twelve bottles, one box is six".
    final ordered = [...stored]..sort((a, b) {
        final fa = Decimal.tryParse(asString(a['factor']) ?? '') ?? Decimal.one;
        final fb = Decimal.tryParse(asString(b['factor']) ?? '') ?? Decimal.one;
        return fa.compareTo(fb);
      });
    for (final unit in ordered) {
      final factor = asString(unit['factor']) ?? '1';
      final isBase = unit['isBase'] == true ||
          (Decimal.tryParse(factor) ?? Decimal.one) == Decimal.one;
      _rows.add(
        _Row(
          isBase: isBase,
          id: asString(unit['id']),
          unit: text(unit, 'unit'),
          factor: isBase ? '1' : factor,
          barcode: text(unit, 'barcode'),
          salePrice: text(unit, 'salePrice'),
          purchasePrice: text(unit, 'purchasePrice'),
          allowFraction: unit['allowFraction'] != false,
        ),
      );
    }
    if (!_rows.any((row) => row.isBase)) {
      _rows.insert(0, _Row(isBase: true, unit: widget.baseUnit, factor: '1'));
    }
  }

  @override
  void dispose() {
    _baseUnit.dispose();
    for (final row in _rows) {
      row.dispose();
    }
    super.dispose();
  }

  void _addRow() {
    setState(() {
      _error = null;
      _rows.add(_Row(isBase: false, factor: ''));
    });
  }

  void _removeRow(_Row row) {
    if (row.isBase) return;
    setState(() {
      _rows.remove(row);
      row.dispose();
    });
  }

  String get _baseName {
    final typed = _baseUnit.text.trim();
    if (typed.isNotEmpty) return typed;
    final base = _rows.where((row) => row.isBase);
    return base.isEmpty ? '' : base.first.unit.text.trim();
  }

  /// The sentence the person reads before saving: `5 كراتين × 12 = 60 عبوة`.
  ///
  /// It is the same arithmetic the invoice and the stock report use, shown
  /// while the numbers are still being typed.
  String _previewFor(_Row row) {
    final unit = row.unit.text.trim();
    final factor = Decimal.tryParse(row.factor.text.trim());
    final base = _baseName;
    if (unit.isEmpty || base.isEmpty || factor == null) return '';
    if (factor.compareTo(Decimal.one) == 0) return '';
    final five = factor * Decimal.fromInt(5);
    String plain(Decimal value) {
      final fixed = value.toString();
      return fixed.endsWith('.0')
          ? fixed.substring(0, fixed.length - 2)
          : fixed;
    }

    return _t(
      '5 $unit × ${plain(factor)} = ${plain(five)} $base',
      '5 $unit × ${plain(factor)} = ${plain(five)} $base',
    );
  }

  void _submit() {
    final base = _baseName;
    if (base.isEmpty) {
      setState(() => _error = _t(
            'اكتب اسم الوحدة الأساسية.',
            'Enter the base unit.',
          ));
      return;
    }

    final seen = <String>{};
    final rows = <Map<String, dynamic>>[];
    for (final row in _rows) {
      final name = row.isBase ? base : row.unit.text.trim();
      final factorText = row.isBase ? '1' : row.factor.text.trim();

      if (name.isEmpty) {
        setState(() => _error = _t(
              'كل سطر يحتاج اسم وحدة.',
              'Every row needs a unit name.',
            ));
        return;
      }
      if (name.length > 40) {
        setState(() => _error = _t(
              'اسم الوحدة «$name» أطول من 40 حرفًا.',
              'The unit name "$name" is longer than 40 characters.',
            ));
        return;
      }
      if (!seen.add(name.toLowerCase())) {
        setState(() => _error = _t(
              'الوحدة «$name» مكررة داخل الصنف.',
              'The unit "$name" is listed twice.',
            ));
        return;
      }

      final factor = row.isBase ? Decimal.one : Decimal.tryParse(factorText);
      if (factor == null || factor <= Decimal.zero) {
        setState(() => _error = _t(
              'الوحدة «$name» تحتاج معامل تحويل أكبر من صفر.',
              'The unit "$name" needs a factor greater than zero.',
            ));
        return;
      }
      if (row.isBase && factor != Decimal.one) {
        setState(() => _error = _t(
              'معامل الوحدة الأساسية يجب أن يكون 1.',
              'The base unit factor must be 1.',
            ));
        return;
      }

      rows.add(<String, dynamic>{
        if (row.id != null && row.id!.isNotEmpty) 'id': row.id,
        'unit': row.isBase ? base : name,
        'factor': _factorText(factor),
        // Sent even when empty, because emptying the box is how a person says
        // "this unit has no price of its own"; a field the caller cannot see
        // is not sent at all, and the server leaves the stored value alone.
        if (widget.canManageBarcodes) 'barcode': row.barcode.text.trim(),
        'salePrice': row.salePrice.text.trim(),
        if (widget.canSeeCost) 'purchasePrice': row.purchasePrice.text.trim(),
        'allowFraction': row.allowFraction,
      });
    }

    Navigator.of(context).pop(
      ItemUnitsDraft(baseUnit: base, rows: rows),
    );
  }

  /// Six decimals, the scale the column keeps. Trailing zeros are dropped so a
  /// factor of twelve is sent as "12" and not "12.000000".
  String _factorText(Decimal value) {
    final fixed = value.toStringAsFixed(6);
    if (!fixed.contains('.')) return fixed;
    return fixed.replaceAll(RegExp(r'0+$'), '').replaceAll(RegExp(r'\.$'), '');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final canBarcode = widget.canManageBarcodes;
    final canCost = widget.canSeeCost;

    return AlertDialog(
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(_t('الوحدات والتعبئة والتحويل', 'Units, packing and conversion')),
          if ((widget.itemName ?? '').isNotEmpty)
            Text(
              widget.itemName!,
              style: theme.textTheme.bodySmall,
            ),
        ],
      ),
      content: SizedBox(
        width: 760,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: _baseUnit,
                decoration: InputDecoration(
                  labelText: _t('وحدة الأساس', 'Base unit'),
                  border: const OutlineInputBorder(),
                  isDense: true,
                  helperMaxLines: 3,
                  helperText: widget.isEdit
                      ? _t(
                          'لا تتغيّر وحدة الأساس بعد وجود حركات على الصنف؛ '
                              'أضف وحدة أخرى بدلاً منها. الخادم يرفض التغيير ويشرح السبب.',
                          'The base unit cannot be changed once stock is recorded; '
                              'add another unit instead. The server refuses it and explains why.',
                        )
                      : _t(
                          'الوحدة التي يُحصى بها المخزون: عبوة، متر، كيلو. '
                              'كل معامل أدناه = كم وحدة أساسية في وحدة واحدة.',
                          'The unit stock is counted in. Every factor below is '
                              '"how many base units is one of these".',
                        ),
                ),
                onChanged: (value) => setState(() {
                  for (final row in _rows) {
                    if (row.isBase) row.unit.text = value.trim();
                  }
                }),
              ),
              const SizedBox(height: AppSpacing.sm),
              Container(
                padding: const EdgeInsets.all(AppSpacing.sm),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerLow,
                  borderRadius: BorderRadius.circular(AppRadii.sm),
                ),
                child: Text(
                  _t(
                    'المخزون يُحفظ دائمًا بالوحدة الأساسية. المعامل لا يربط بين وحدتين '
                        'تعبئة، بل بالوحدة الأساسية فقط.',
                    'Stock is always kept in the base unit. A factor points at the base '
                        'unit only, never at another packing unit.',
                  ),
                  style: theme.textTheme.bodySmall,
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              Row(
                children: [
                  Expanded(
                    flex: 3,
                    child: Text(_t('الوحدة', 'Unit'), style: theme.textTheme.labelMedium),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    flex: 2,
                    child: Text(
                      _t('معامل التحويل', 'Factor'),
                      style: theme.textTheme.labelMedium,
                    ),
                  ),
                  const SizedBox(width: 6),
                  if (canBarcode)
                    Expanded(
                      flex: 3,
                      child: Text(
                        _t('باركود', 'Barcode'),
                        style: theme.textTheme.labelMedium,
                      ),
                    ),
                  const SizedBox(width: 6),
                  Expanded(
                    flex: 2,
                    child: Text(
                      _t('سعر البيع', 'Sale price'),
                      style: theme.textTheme.labelMedium,
                    ),
                  ),
                  const SizedBox(width: 6),
                  if (canCost)
                    Expanded(
                      flex: 2,
                      child: Text(
                        _t('سعر الشراء', 'Purchase price'),
                        style: theme.textTheme.labelMedium,
                      ),
                    ),
                  const SizedBox(width: 6),
                  SizedBox(
                    width: 74,
                    child: Text(
                      _t('الكسور', 'Fractions'),
                      style: theme.textTheme.labelMedium,
                      textAlign: TextAlign.center,
                    ),
                  ),
                  const SizedBox(width: 40),
                ],
              ),
              const Divider(height: 12),
              for (final row in _rows) _buildRow(row, canBarcode, canCost),
              const SizedBox(height: AppSpacing.sm),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: TextButton.icon(
                  key: const ValueKey('item-units-add-row'),
                  onPressed: _addRow,
                  icon: const Icon(Icons.add, size: 18),
                  label: Text(_t('+ إضافة وحدة', '+ Add unit')),
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: AppSpacing.sm),
                Text(
                  _error!,
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(_t('إلغاء', 'Cancel')),
        ),
        FilledButton.icon(
          key: const ValueKey('item-units-apply'),
          onPressed: _submit,
          icon: const Icon(Icons.check, size: 18),
          label: Text(_t('تم', 'Done')),
        ),
      ],
    );
  }

  Widget _buildRow(_Row row, bool canBarcode, bool canCost) {
    final preview = _previewFor(row);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        key: ObjectKey(row),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                flex: 3,
                child: TextField(
                  controller: row.unit,
                  enabled: !row.isBase,
                  decoration: InputDecoration(
                    isDense: true,
                    border: const OutlineInputBorder(),
                    hintText: _t('كرتونة', 'Carton'),
                    // The base unit's name is the field above; repeating it
                    // here would be two sources for one answer.
                    labelText: row.isBase ? _t('الأساسية', 'Base') : null,
                  ),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                flex: 2,
                child: TextField(
                  controller: row.factor,
                  enabled: !row.isBase,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                  ],
                  decoration: InputDecoration(
                    isDense: true,
                    border: const OutlineInputBorder(),
                    hintText: row.isBase ? '1' : '12',
                  ),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              const SizedBox(width: 6),
              if (canBarcode)
                Expanded(
                  flex: 3,
                  child: TextField(
                    controller: row.barcode,
                    decoration: const InputDecoration(
                      isDense: true,
                      border: OutlineInputBorder(),
                      hintText: '6221234567890',
                    ),
                  ),
                ),
              const SizedBox(width: 6),
              Expanded(
                flex: 2,
                child: TextField(
                  controller: row.salePrice,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(isDense: true, border: OutlineInputBorder()),
                ),
              ),
              const SizedBox(width: 6),
              if (canCost)
                Expanded(
                  flex: 2,
                  child: TextField(
                    controller: row.purchasePrice,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration:
                        const InputDecoration(isDense: true, border: OutlineInputBorder()),
                  ),
                ),
              const SizedBox(width: 6),
              SizedBox(
                width: 74,
                child: Tooltip(
                  message: _t(
                    'أوقفها لوحدة لا تُجزّأ: نصف كرتونة غير موجود.',
                    'Off for a unit that cannot be split: half a carton is not a thing.',
                  ),
                  child: Checkbox(
                    value: row.allowFraction,
                    onChanged: row.isBase
                        ? null
                        : (value) =>
                            setState(() => row.allowFraction = value ?? true),
                  ),
                ),
              ),
              SizedBox(
                width: 40,
                child: IconButton(
                  tooltip: row.isBase
                      ? _t('لا يمكن حذف الوحدة الأساسية', 'The base unit cannot be removed')
                      : _t('حذف', 'Remove'),
                  onPressed: row.isBase ? null : () => _removeRow(row),
                  icon: const Icon(Icons.delete_outline, size: 18),
                ),
              ),
            ],
          ),
          if (preview.isNotEmpty)
            Padding(
              padding: const EdgeInsetsDirectional.only(start: 4, top: 2),
              child: Text(
                preview,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
        ],
      ),
    );
  }
}

/// Opens the packing table and returns the draft, or null when cancelled.
Future<ItemUnitsDraft?> showItemUnitsEditor(
  BuildContext context, {
  required String baseUnit,
  String? itemName,
  List<Map<String, dynamic>> initialUnits = const [],
  bool canManageBarcodes = false,
  bool canSeeCost = false,
  bool isEdit = false,
}) {
  return showDialog<ItemUnitsDraft>(
    context: context,
    barrierDismissible: false,
    builder: (_) => ItemUnitsEditor(
      baseUnit: baseUnit,
      itemName: itemName,
      initialUnits: initialUnits,
      canManageBarcodes: canManageBarcodes,
      canSeeCost: canSeeCost,
      isEdit: isEdit,
    ),
  );
}
