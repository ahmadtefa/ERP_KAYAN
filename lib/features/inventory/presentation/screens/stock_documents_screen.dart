import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../../../../shared/widgets/item_picker_dialog.dart';
import '../../../../shared/widgets/page_header.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../data/presentation/providers/data_providers.dart';
import '../../../data/presentation/widgets/print_visibility_prompt.dart';

/// A line being typed into a new stock document.
class _DraftLine {
  _DraftLine({
    required this.itemId,
    required this.itemLabel,
    required this.baseUnit,
    String quantity = '1',
    this.unitName,
  }) : quantity = TextEditingController(text: quantity);

  final String itemId;
  final String itemLabel;
  final String baseUnit;
  final TextEditingController quantity;

  /// The packing unit the person counted in. Empty means the item's base unit.
  String? unitName;

  void dispose() => quantity.dispose();
}

/// The warehouse's own paper: counting, transferring and adjusting stock.
///
/// Every document here records the unit it was written in, its factor and the
/// base quantity the ledger keeps, so a shelf counted in cartons and a ledger
/// kept in pieces never drift apart. The document is created first and posted
/// afterwards - counting is one job, writing stock off is another - and each
/// sheet prints under the company's saved price policy like every other print.
class StockDocumentsScreen extends ConsumerStatefulWidget {
  const StockDocumentsScreen({super.key});

  @override
  ConsumerState<StockDocumentsScreen> createState() => _StockDocumentsScreenState();
}

class _StockDocumentsScreenState extends ConsumerState<StockDocumentsScreen> {
  Future<List<Json>>? _future;
  String _kind = '';

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Json>> _load() {
    return ref.read(apiClientProvider).getList(
      '/inventory/stock-documents',
      query: {
        if (_kind.isNotEmpty) 'kind': _kind,
        'pageSize': '50',
      },
    );
  }

  void _refresh() {
    setState(() => _future = _load());
  }

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String get _language => Localizations.localeOf(context).languageCode;

  static const _kinds = <String, Map<String, String>>{
    'COUNT': {'ar': 'جرد فعلي', 'en': 'Physical count'},
    'ADJUSTMENT': {'ar': 'تسوية مخزون', 'en': 'Stock adjustment'},
    'TRANSFER': {'ar': 'تحويل مخزون', 'en': 'Stock transfer'},
    'OPENING': {'ar': 'مخزون افتتاحي', 'en': 'Opening stock'},
  };

  String _kindLabel(String kind) {
    // The API answers in lower case; the catalogue above is in the domain's
    // own upper case.
    final labels = _kinds[kind.toUpperCase()];
    if (labels == null) return kind;
    return (_arabic ? labels['ar'] : labels['en']) ?? kind;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final canAdjust = ref.watch(currentUserProvider)?.can('inventory.stock.adjust') ?? false;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PageHeader(
          title: _arabic ? 'المستندات المخزنية' : 'Stock documents',
          subtitle: _arabic
              ? 'الجرد الفعلي والتحويل بين المخازن والتسويات، بوحدات التعبئة ومعاملاتها.'
              : 'Physical counts, transfers between stores and adjustments, in packing '
                    'units with their factors.',
        ),
        Container(height: 1, color: Theme.of(context).colorScheme.outlineVariant),
        Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              FilledButton.icon(
                key: const ValueKey('stock-document-new'),
                onPressed: canAdjust ? _createDocument : null,
                icon: const Icon(Icons.add, size: 18),
                label: Text(_arabic ? 'مستند جديد' : 'New document'),
              ),
              OutlinedButton.icon(
                key: const ValueKey('stock-take-variance-open'),
                onPressed: _openVariance,
                icon: const Icon(Icons.difference_outlined, size: 18),
                label: Text(_arabic ? 'فروق الجرد' : 'Stock-take differences'),
              ),
              OutlinedButton.icon(
                onPressed: () => _printReport('valuation', typeKey: 'inventory-valuation'),
                icon: const Icon(Icons.price_check_outlined, size: 18),
                label: Text(_arabic ? 'تقييم المخزون (طباعة)' : 'Valuation (print)'),
              ),
              OutlinedButton.icon(
                onPressed: () => _printReport('slow-moving', typeKey: 'slow-moving'),
                icon: const Icon(Icons.hourglass_bottom_outlined, size: 18),
                label: Text(_arabic ? 'المخزون الراكد (طباعة)' : 'Slow-moving (print)'),
              ),
              OutlinedButton.icon(
                onPressed: () => _printReport('reorder', typeKey: 'reorder'),
                icon: const Icon(Icons.shopping_cart_checkout_outlined, size: 18),
                label: Text(_arabic ? 'حدود إعادة الطلب (طباعة)' : 'Reorder (print)'),
              ),
              DropdownButton<String>(
                value: _kind,
                hint: Text(_arabic ? 'كل الأنواع' : 'All kinds'),
                items: [
                  DropdownMenuItem(value: '', child: Text(_arabic ? 'كل الأنواع' : 'All kinds')),
                  for (final entry in _kinds.entries)
                    DropdownMenuItem(
                      value: entry.key,
                      child: Text((_arabic ? entry.value['ar'] : entry.value['en']) ?? entry.key),
                    ),
                ],
                onChanged: (value) {
                  setState(() {
                    _kind = value ?? '';
                    _future = _load();
                  });
                },
              ),
              IconButton(
                tooltip: l10n.refresh,
                onPressed: _refresh,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
        ),
        Expanded(
          child: _future == null
              ? const Center(child: CircularProgressIndicator())
              : FutureBuilder<List<Json>>(
                  future: _future,
                  builder: (context, snapshot) {
                    if (snapshot.connectionState != ConnectionState.done) {
                      return const Center(child: CircularProgressIndicator());
                    }
                    if (snapshot.hasError) {
                      return Center(
                        child: Padding(
                          padding: const EdgeInsets.all(AppSpacing.lg),
                          child: Text('${snapshot.error}'),
                        ),
                      );
                    }
                    final rows = snapshot.data ?? const <Json>[];
                    if (rows.isEmpty) {
                      return Center(
                        child: Text(
                          _arabic
                              ? 'لا توجد مستندات مخزنية بعد.'
                              : 'There are no stock documents yet.',
                        ),
                      );
                    }
                    return ListView.separated(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                      itemCount: rows.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 8),
                      itemBuilder: (context, index) => _documentCard(rows[index], canAdjust),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _documentCard(Json row, bool canAdjust) {
    final id = text(row, 'id');
    final kind = text(row, 'kind');
    // The API answers in lower case.
    final status = text(row, 'status').toLowerCase();
    final posted = status == 'posted';
    final canSeeCost = ref.watch(currentUserProvider)?.can('inventory.cost.read') ?? false;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${text(row, 'documentNumber')} — ${_kindLabel(kind)}',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${text(row, 'documentDate')} • ${text(row, 'lineCount').isEmpty ? '0' : text(row, 'lineCount')} '
                    '${_arabic ? 'سطر' : 'line(s)'} • ${posted ? (_arabic ? 'مُرحّل' : 'posted') : (_arabic ? 'مسودة' : 'draft')}'
                    '${canSeeCost ? '' : ' • ${_arabic ? 'بدون تكلفة' : 'no cost'}'}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            Wrap(
              spacing: 4,
              children: [
                if (!posted)
                  TextButton.icon(
                    onPressed: canAdjust ? () => _postDocument(id) : null,
                    icon: const Icon(Icons.check, size: 18),
                    label: Text(_arabic ? 'ترحيل' : 'Post'),
                  ),
                IconButton(
                  tooltip: _arabic ? 'طباعة' : 'Print',
                  onPressed: () => _printDocument(id, pdf: false),
                  icon: const Icon(Icons.print_outlined),
                ),
                IconButton(
                  tooltip: _arabic ? 'تنزيل PDF' : 'Download PDF',
                  onPressed: () => _printDocument(id, pdf: true),
                  icon: const Icon(Icons.picture_as_pdf_outlined),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _postDocument(String id) async {
    try {
      await ref.read(apiClientProvider).post('/inventory/stock-documents/$id/post');
      if (!mounted) return;
      showMessage(context, _arabic ? 'تم ترحيل المستند.' : 'The document was posted.');
      _refresh();
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } catch (error) {
      if (mounted) showMessage(context, '${_arabic ? 'تعذر الترحيل' : 'Could not post'}: $error', error: true);
    }
  }

  Future<void> _printDocument(String id, {required bool pdf}) async {
    final visibility = await promptPriceVisibility(
      context,
      ref,
      typeKey: 'stock-document',
      arabic: _arabic,
    );
    if (visibility == null || !mounted) return;
    final links = ref.read(reportLinkProvider);
    if (pdf) {
      await runDownload(
        context,
        links.stockDocumentPdf(
          id: id,
          language: _language,
          showSalePrice: visibility.showSalePrice,
          showCost: visibility.showCost,
        ),
      );
    } else {
      await runPrint(
        context,
        links.stockDocumentPrint(
          id: id,
          language: _language,
          showSalePrice: visibility.showSalePrice,
          showCost: visibility.showCost,
        ),
      );
    }
  }

  Future<void> _printReport(String report, {required String typeKey}) async {
    final visibility = await promptPriceVisibility(
      context,
      ref,
      typeKey: typeKey,
      arabic: _arabic,
    );
    if (visibility == null || !mounted) return;
    await runPrint(
      context,
      ref.read(reportLinkProvider).inventoryReportPrint(
        report: report,
        language: _language,
        showSalePrice: visibility.showSalePrice,
        showCost: visibility.showCost,
      ),
    );
  }

  /// The sheet a store manager signs: book figure, counted figure, difference.
  Future<void> _openVariance() async {
    List<Json> rows = const [];
    Json totals = const {};
    String? error;

    try {
      final report = await ref.read(apiClientProvider).getObject(
        '/inventory/reports/stock-take-variance',
      );
      rows = (report['rows'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .toList(growable: false);
      totals = Map<String, dynamic>.from(report['totals'] as Map? ?? const {});
    } catch (failure) {
      error = '$failure';
    }
    if (!mounted) return;

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => Builder(
        builder: (dialogContext) {
          return AlertDialog(
            title: Text(_arabic ? 'فروق الجرد' : 'Stock-take differences'),
            content: SizedBox(
              width: 860,
              height: 460,
              child: error != null
                  ? Text(error!)
                  : rows.isEmpty
                  ? Text(_arabic ? 'لا توجد فروق مسجلة.' : 'No counted differences recorded.')
                  : SingleChildScrollView(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          for (final row in rows)
                            ListTile(
                              dense: true,
                              title: Text(
                                '${text(row, 'documentNumber')} • ${text(row, 'itemCode')} '
                                '${text(row, 'itemNameEn')}',
                              ),
                              subtitle: Text(
                                '${_arabic ? 'الدفتر' : 'Book'} ${formatQuantity(asString(row['systemQuantity']))}'
                                ' → ${_arabic ? 'المجرود' : 'Counted'} '
                                '${formatQuantity(asString(row['countedQuantity']))}'
                                ' • ${_arabic ? 'الفرق' : 'Difference'} '
                                '${formatQuantity(asString(row['varianceQuantity']))}'
                                '${text(row, 'unitName').isEmpty ? '' : ' (${text(row, 'unitName')} × ${asString(row['unitFactor'])})'}',
                              ),
                            ),
                          const Divider(),
                          ListTile(
                            dense: true,
                            title: Text(
                              '${_arabic ? 'كمية النقص' : 'Shortage quantity'} '
                              '${formatQuantity(asString(totals['shortageQuantity']))} — '
                              '${_arabic ? 'كمية الزيادة' : 'Surplus quantity'} '
                              '${formatQuantity(asString(totals['surplusQuantity']))}',
                            ),
                            subtitle: Text(
                              _arabic
                                  ? 'النقص والزيادة منفصلان ولا يُدمجان في صافٍ واحد.'
                                  : 'Shortages and surpluses are kept apart, never netted.',
                            ),
                          ),
                        ],
                      ),
                    ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: Text(context.l10n.close),
              ),
              OutlinedButton.icon(
                onPressed: () async {
                  Navigator.of(dialogContext).pop();
                  final visibility = await promptPriceVisibility(
                    context,
                    ref,
                    typeKey: 'stock-take-variance',
                    arabic: _arabic,
                  );
                  if (visibility == null || !mounted) return;
                  await runPrint(
                    context,
                    ref.read(reportLinkProvider).inventoryReportPrint(
                      report: 'stock-take-variance',
                      language: _language,
                      showSalePrice: visibility.showSalePrice,
                      showCost: visibility.showCost,
                    ),
                  );
                },
                icon: const Icon(Icons.print_outlined, size: 18),
                label: Text(_arabic ? 'طباعة' : 'Print'),
              ),
            ],
          );
        },
      ),
    );
  }

  // ------------------------------------------------------------------ create

  Future<void> _createDocument() async {
    String kind = 'COUNT';
    String? fromWarehouseId;
    String? toWarehouseId;
    String date = DateTime.now().toIso8601String().substring(0, 10);
    final notes = TextEditingController();
    final lines = <_DraftLine>[];
    List<Json> warehouses = const [];
    String? error;
    var saving = false;

    try {
      warehouses = await ref.read(apiClientProvider).getList('/inventory/warehouses');
    } catch (_) {
      warehouses = const [];
    }
    if (!mounted) return;
    if (warehouses.isEmpty) {
      showMessage(
        context,
        _arabic ? 'لا يوجد مخزن معرّف لهذا الفرع.' : 'This branch has no warehouse defined.',
        error: true,
      );
      return;
    }
    // The branch's default store is the common case; a transfer needs two.
    final defaultWarehouse = warehouses.firstWhere(
      (row) => row['isDefault'] == true,
      orElse: () => warehouses.first,
    );
    toWarehouseId = text(defaultWarehouse, 'id');
    fromWarehouseId = text(defaultWarehouse, 'id');

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) {
          Future<void> addLine() async {
            final item = await showItemPicker(context);
            if (item == null) return;
            setDialogState(() {
              lines.add(
                _DraftLine(
                  itemId: text(item, 'id'),
                  itemLabel: '${text(item, 'code')} — ${text(item, 'nameEn')}',
                  baseUnit: text(item, 'unit'),
                ),
              );
            });
          }

          Future<void> submit() async {
            if (lines.isEmpty) {
              setDialogState(() => error =
                  _arabic ? 'أضف سطرًا واحدًا على الأقل.' : 'Add at least one line.');
              return;
            }
            setDialogState(() {
              saving = true;
              error = null;
            });
            try {
              final body = <String, dynamic>{
                'kind': kind,
                'documentDate': date,
                if (notes.text.trim().isNotEmpty) 'notes': notes.text.trim(),
                if (kind == 'TRANSFER') ...{
                  'fromWarehouseId': fromWarehouseId,
                  'toWarehouseId': toWarehouseId,
                } else
                  'toWarehouseId': toWarehouseId,
                'lines': [
                  for (final line in lines)
                    {
                      'itemId': line.itemId,
                      'quantity': line.quantity.text.trim(),
                      if ((line.unitName ?? '').isNotEmpty) 'unitName': line.unitName,
                      if (kind == 'COUNT') 'countedQuantity': line.quantity.text.trim(),
                    },
                ],
              };
              await ref.read(apiClientProvider).post('/inventory/stock-documents', body: body);
              if (!mounted) return;
              Navigator.of(dialogContext).pop();
              showMessage(
                context,
                _arabic
                    ? 'تم إنشاء المستند. رحّله ليؤثر في الأرصدة.'
                    : 'The document was created. Post it to affect the balances.',
              );
              _refresh();
            } on Failure catch (failure) {
              if (mounted) setDialogState(() => error = failure.message);
            } catch (failure) {
              if (mounted) setDialogState(() => error = '$failure');
            } finally {
              if (mounted) setDialogState(() => saving = false);
            }
          }

          return AlertDialog(
            title: Text(_arabic ? 'مستند مخزني جديد' : 'New stock document'),
            content: SizedBox(
              width: 760,
              height: 520,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Wrap(
                    spacing: 12,
                    runSpacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      SizedBox(
                        width: 200,
                        child: DropdownButtonFormField<String>(
                          initialValue: kind,
                          decoration: InputDecoration(
                            labelText: _arabic ? 'نوع المستند' : 'Kind',
                            border: const OutlineInputBorder(),
                            isDense: true,
                          ),
                          items: [
                            for (final entry in _kinds.entries)
                              DropdownMenuItem(
                                value: entry.key,
                                child: Text((_arabic ? entry.value['ar'] : entry.value['en']) ?? entry.key),
                              ),
                          ],
                          onChanged: (value) {
                            if (value != null) setDialogState(() => kind = value);
                          },
                        ),
                      ),
                      SizedBox(
                        width: 190,
                        child: DropdownButtonFormField<String>(
                          initialValue: fromWarehouseId,
                          decoration: InputDecoration(
                            labelText: kind == 'TRANSFER'
                                ? (_arabic ? 'من مخزن' : 'From store')
                                : (_arabic ? 'المخزن' : 'Store'),
                            border: const OutlineInputBorder(),
                            isDense: true,
                          ),
                          items: [
                            for (final warehouse in warehouses)
                              DropdownMenuItem(
                                value: text(warehouse, 'id'),
                                child: Text(text(warehouse, 'nameEn')),
                              ),
                          ],
                          onChanged: (value) => setDialogState(() => fromWarehouseId = value),
                        ),
                      ),
                      if (kind == 'TRANSFER')
                        SizedBox(
                          width: 190,
                          child: DropdownButtonFormField<String>(
                            initialValue: toWarehouseId,
                            decoration: InputDecoration(
                              labelText: _arabic ? 'إلى مخزن' : 'To store',
                              border: const OutlineInputBorder(),
                              isDense: true,
                            ),
                            items: [
                              for (final warehouse in warehouses)
                                DropdownMenuItem(
                                  value: text(warehouse, 'id'),
                                  child: Text(text(warehouse, 'nameEn')),
                                ),
                            ],
                            onChanged: (value) => setDialogState(() => toWarehouseId = value),
                          ),
                        ),
                      SizedBox(
                        width: 150,
                        child: TextFormField(
                          initialValue: date,
                          decoration: InputDecoration(
                            labelText: _arabic ? 'التاريخ' : 'Date',
                            border: const OutlineInputBorder(),
                            isDense: true,
                          ),
                          onChanged: (value) => date = value.trim(),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: notes,
                    decoration: InputDecoration(
                      labelText: _arabic ? 'ملاحظات' : 'Notes',
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Row(children: [
                    Expanded(
                      child: Text(
                        _arabic
                            ? 'الكمية تُدخل بالوحدة المختارة، ويُخزَّن معها معامل التحويل والكمية بالأساس.'
                            : 'The quantity is entered in the chosen unit; its factor and the '
                                  'base quantity are stored with it.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                    TextButton.icon(
                      onPressed: addLine,
                      icon: const Icon(Icons.add, size: 18),
                      label: Text(_arabic ? 'إضافة صنف' : 'Add item'),
                    ),
                  ]),
                  const Divider(),
                  Expanded(
                    child: lines.isEmpty
                        ? Center(
                            child: Text(
                              _arabic ? 'لم تُضف أصناف بعد.' : 'No items added yet.',
                            ),
                          )
                        : ListView.separated(
                            itemCount: lines.length,
                            separatorBuilder: (_, _) => const Divider(height: 1),
                            itemBuilder: (context, index) {
                              final line = lines[index];
                              return Row(
                                children: [
                                  Expanded(child: Text(line.itemLabel)),
                                  SizedBox(
                                    width: 120,
                                    child: TextField(
                                      controller: line.quantity,
                                      decoration: InputDecoration(
                                        labelText: _arabic ? 'الكمية' : 'Quantity',
                                        isDense: true,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  SizedBox(
                                    width: 130,
                                    child: _UnitField(
                                      itemId: line.itemId,
                                      baseUnit: line.baseUnit,
                                      value: line.unitName,
                                      arabic: _arabic,
                                      onChanged: (unit) =>
                                          setDialogState(() => line.unitName = unit),
                                    ),
                                  ),
                                  IconButton(
                                    tooltip: _arabic ? 'حذف' : 'Remove',
                                    onPressed: () => setDialogState(() {
                                      lines.removeAt(index).dispose();
                                    }),
                                    icon: const Icon(Icons.delete_outline),
                                  ),
                                ],
                              );
                            },
                          ),
                  ),
                  if (error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        error!,
                        style: TextStyle(color: Theme.of(context).colorScheme.error),
                      ),
                    ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: saving ? null : () => Navigator.of(dialogContext).pop(),
                child: Text(context.l10n.cancel),
              ),
              FilledButton.icon(
                key: const ValueKey('stock-document-submit'),
                onPressed: saving ? null : submit,
                icon: saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.save_outlined, size: 18),
                label: Text(_arabic ? 'حفظ' : 'Save'),
              ),
            ],
          );
        },
      ),
    );
    notes.dispose();
    for (final line in lines) {
      line.dispose();
    }
  }
}

/// The unit a line is written in: the item's base unit plus every packing unit
/// it has. Loading them is per item and only when the row exists, so the form
/// stays quick on a long list.
class _UnitField extends ConsumerStatefulWidget {
  const _UnitField({
    required this.itemId,
    required this.baseUnit,
    required this.value,
    required this.arabic,
    required this.onChanged,
  });

  final String itemId;
  final String baseUnit;
  final String? value;
  final bool arabic;
  final ValueChanged<String?> onChanged;

  @override
  ConsumerState<_UnitField> createState() => _UnitFieldState();
}

class _UnitFieldState extends ConsumerState<_UnitField> {
  Future<List<Json>>? _units;

  @override
  void initState() {
    super.initState();
    _units = _load();
  }

  Future<List<Json>> _load() async {
    try {
      final response = await ref
          .read(apiClientProvider)
          .getObject('/inventory/items/${widget.itemId}/units');
      return (response['items'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .toList(growable: false);
    } catch (_) {
      return const [];
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Json>>(
      future: _units,
      builder: (context, snapshot) {
        final units = snapshot.data ?? const <Json>[];
        return DropdownButtonFormField<String>(
          initialValue: widget.value ?? widget.baseUnit,
          decoration: InputDecoration(
            labelText: widget.arabic ? 'الوحدة' : 'Unit',
            isDense: true,
            border: const OutlineInputBorder(),
          ),
          items: [
            DropdownMenuItem(value: widget.baseUnit, child: Text(widget.baseUnit)),
            for (final unit in units)
              if (text(unit, 'unit') != widget.baseUnit && unit['isActive'] != false)
                DropdownMenuItem(
                  value: text(unit, 'unit'),
                  child: Text(
                    '${text(unit, 'unit')} × ${asString(unit['factor'])}',
                  ),
                ),
          ],
          onChanged: widget.onChanged,
        );
      },
    );
  }
}
