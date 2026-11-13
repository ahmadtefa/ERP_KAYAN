import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/barcode/barcode_scan.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
import '../../../../shared/widgets/item_picker_dialog.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// One line being typed into a new stock document.
///
/// The quantity is a text controller because it is typed, not chosen; the
/// chosen unit (a carton rather than the base piece) travels with it so the
/// server records the factor it converted with.
class _DraftLine {
  _DraftLine({
    required this.itemId,
    required this.itemLabel,
    required this.baseUnit,
  }) : quantity = TextEditingController(text: '1');

  final String itemId;
  final String itemLabel;
  final String baseUnit;
  final TextEditingController quantity;

  /// The packing unit counted in. Empty means the item's own base unit.
  String? unitName;

  void dispose() => quantity.dispose();
}

/// Every stock document that is not a voucher: adjustments, transfers,
/// counts, opening balances and write-offs.
///
/// This is the same endpoint the vouchers screen reads, split by the server's
/// own parameter. Vouchers are an inventory request raised by one branch and
/// fulfilled by another - they have their own list, their own detail and their
/// own creation flow, and they are deliberately not shown here. `voucherOnly`
/// is false, not missing, so the two screens cannot overlap.
final stockDocumentsProvider =
    AsyncNotifierProvider<StockDocumentsController, List<Json>>(
      StockDocumentsController.new,
    );

class StockDocumentsController extends JsonListController {
  @override
  String get resourcePath => '/inventory/stock-documents';

  @override
  Map<String, dynamic> get resourceQuery => const {'voucherOnly': 'false'};
}

/// The kinds this screen lists. Write-off is included because it is a stock
/// document; it also has its own screen, which is where it is approved.
/// The kinds this screen can create.
///
/// WRITE_OFF is deliberately absent: a write-off needs a reason and an
/// approver who is not its author, so it has its own screen (write_offs_screen)
/// rather than being one more choice in a count dialog. The filter above still
/// lists existing write-offs, because they are stock documents.
const _creatableKinds = ['ADJUSTMENT', 'TRANSFER', 'COUNT', 'OPENING'];

/// Every kind this screen lists. Write-off is included because it is a stock
/// document; it is created and approved on its own screen.
const _kinds = [..._creatableKinds, 'WRITE_OFF'];

class StockDocumentsScreen extends ConsumerStatefulWidget {
  const StockDocumentsScreen({super.key});

  @override
  ConsumerState<StockDocumentsScreen> createState() =>
      _StockDocumentsScreenState();
}

class _StockDocumentsScreenState extends ConsumerState<StockDocumentsScreen> {
  String _query = '';
  String? _kind;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String _kindLabel(String kind) {
    final arabic = _arabic;
    return switch (kind.toUpperCase()) {
      'ADJUSTMENT' => arabic ? 'تسوية' : 'Adjustment',
      'TRANSFER' => arabic ? 'تحويل' : 'Transfer',
      'COUNT' => arabic ? 'جرد' : 'Count',
      'OPENING' => arabic ? 'رصيد افتتاحي' : 'Opening',
      'WRITE_OFF' => arabic ? 'إعدام' : 'Write-off',
      _ => kind,
    };
  }

  String _statusLabel(String status) {
    final arabic = _arabic;
    return switch (status) {
      'draft' => arabic ? 'مسودة' : 'Draft',
      'posted' => arabic ? 'مُرحَّل' : 'Posted',
      'reversed' => arabic ? 'معكوس' : 'Reversed',
      _ => status,
    };
  }

  AppTone _statusTone(String status) {
    return switch (status) {
      'posted' => AppTone.success,
      'reversed' => AppTone.danger,
      _ => AppTone.neutral,
    };
  }

  /// Where the goods went. A write-off or an opening balance has no
  /// destination, so the column falls back to where they left from.
  String? _movement(Json row) {
    String name(Object? value) {
      if (value is! Map) return '';
      final json = Map<String, dynamic>.from(value);
      return localizedRecordName(json, arabic: _arabic);
    }

    final from = name(row['fromWarehouse']);
    final to = name(row['toWarehouse']);
    if (from.isEmpty && to.isEmpty) return null;
    if (to.isEmpty) return from;
    if (from.isEmpty) return '→ $to';
    return '$from → $to';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(stockDocumentsProvider);
    final canAdjust =
        ref.watch(currentUserProvider)?.can('inventory.stock.adjust') ?? false;

    return ModuleScaffold(
      title: _arabic ? 'مستندات المخزون' : 'Stock documents',
      eyebrow: _arabic ? 'المخزون' : 'Inventory',
      // A Wrap, not a Row: the header actions sit in an AppBar, which gives
      // them an unbounded width. A Row therefore reports "RenderFlex
      // overflowed" instead of moving the search box onto a second line when
      // the window is narrow. The other screens solved it the same way.
      trailing: Wrap(
        spacing: 12,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          if (canAdjust) ...[
            FilledButton.icon(
              onPressed: _createDocument,
              icon: const Icon(Icons.add_rounded, size: 18),
              label: Text(_arabic ? 'مستند جديد' : 'New document'),
            ),
          ],
          DropdownButton<String?>(
            value: _kind,
            isDense: true,
            hint: Text(_arabic ? 'كل الأنواع' : 'All kinds'),
            items: [
              DropdownMenuItem(
                value: null,
                child: Text(_arabic ? 'كل الأنواع' : 'All kinds'),
              ),
              for (final kind in _kinds)
                DropdownMenuItem(
                  value: kind,
                  child: Text(_kindLabel(kind)),
                ),
            ],
            onChanged: (value) => setState(() => _kind = value),
          ),
          IconButton(
            tooltip: _arabic ? 'تحديث' : 'Refresh',
            icon: const Icon(Icons.refresh),
            onPressed: async.isLoading
                ? null
                : () => ref.read(stockDocumentsProvider.notifier).reload(),
          ),
          SearchField(
            hint: _arabic ? 'بحث في المستندات' : 'Search documents',
            onChanged: (value) => setState(() => _query = value.trim()),
          ),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(stockDocumentsProvider.notifier).reload(),
        isEmpty: (rows) => _visible(rows).isEmpty,
        emptyMessage: _arabic
            ? 'لا توجد مستندات مخزون.'
            : 'No stock documents.',
        data: (rows) => RecordsTable(
          rows: _visible(rows),
          columns: [
            ColumnSpec(
              _arabic ? 'الرقم' : 'Number',
              value: (r) => text(r, 'documentNumber'),
              emphasise: true,
            ),
            ColumnSpec(
              _arabic ? 'التاريخ' : 'Date',
              value: (r) => text(r, 'documentDate'),
            ),
            ColumnSpec(
              _arabic ? 'النوع' : 'Kind',
              value: (r) => _kindLabel(text(r, 'kind')),
            ),
            ColumnSpec(_arabic ? 'الحركة' : 'Movement', value: _movement),
            ColumnSpec(
              _arabic ? 'الكمية' : 'Quantity',
              numeric: true,
              value: (r) => formatQuantity(asString(r['totalQuantity'])),
            ),
            ColumnSpec(
              _arabic ? 'الفرع' : 'Branch',
              value: (r) {
                final branch = r['branch'];
                if (branch is! Map) return '';
                final json = Map<String, dynamic>.from(branch);
                return localizedRecordName(json, arabic: _arabic);
              },
            ),
            ColumnSpec(
              _arabic ? 'أنشأه' : 'Raised by',
              value: (r) => text(r, 'createdByName'),
            ),
            ColumnSpec(
              l10n.status,
              value: (r) => _statusLabel(text(r, 'status')),
              tone: (r) => _statusTone(text(r, 'status')),
            ),
          ],
        ),
      ),
    );
  }

  /// Count, transfer or adjust stock from the program itself.
  ///
  /// The document is created here and posted afterwards, on the same screen:
  /// counting the shelf and writing the stock off are two separate jobs, and
  /// the ledger must only move when somebody decides it should. Every line
  /// carries the unit it was counted in, so a shelf counted in cartons and a
  /// ledger kept in pieces never drift apart.
  Future<void> _createDocument() async {
    var kind = 'COUNT';
    String? fromWarehouseId;
    String? toWarehouseId;
    final date = DateTime.now().toIso8601String().substring(0, 10);
    final notes = TextEditingController();
    final barcode = TextEditingController();
    var scanning = false;
    final lines = <_DraftLine>[];
    String? error;
    var saving = false;

    List<Json> warehouses;
    try {
      warehouses = await ref
          .read(apiClientProvider)
          .getList('/inventory/warehouses');
    } catch (_) {
      warehouses = const [];
    }
    if (!mounted || warehouses.isEmpty) {
      notes.dispose();
      barcode.dispose();
    }
    if (!mounted) return;
    if (warehouses.isEmpty) {
      // A sentence the screen wrote itself, not a server diagnostic: show it
      // as written. Routing it through the error resolver decided it was an
      // untrusted English sentence and replaced it with the generic Arabic
      // fallback, so the user was never told which warehouse was missing.
      await showAppPlainError(
        context,
        _arabic
            ? 'لا يوجد مخزن معرّف لهذا الفرع.'
            : 'This branch has no warehouse defined.',
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

    try {
      final route = DialogRoute<void>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) {
            Future<void> addLine() async {
              final item = await showItemPicker(context);
              if (item == null || !mounted) return;
              setDialogState(
                () => lines.add(
                  _DraftLine(
                    itemId: text(item, 'id'),
                    itemLabel:
                        '${text(item, 'code')} — ${localizedRecordName(item, arabic: _arabic)}',
                    baseUnit: text(item, 'unit'),
                  ),
                ),
              );
            }

            Future<void> scan(String code) async {
              if (scanning || saving || code.trim().isEmpty) return;
              scanning = true;
              try {
                final scanner = BarcodeScanner(
                  lookup: (value) => ref.read(apiClientProvider).getObject(
                    '/inventory/items/by-barcode/${Uri.encodeComponent(value)}',
                  ),
                );
                await scanner.scan(
                  code,
                  arabic: _arabic,
                  onFailure: (message) async {
                    if (dialogContext.mounted) {
                      await showAppPlainError(dialogContext, message);
                    }
                  },
                  onMatch: (match) async {
                    if (!dialogContext.mounted || saving) return;
                    if (!flag(match.item, 'isStockTracked', fallback: true)) {
                      await showAppPlainError(dialogContext, _arabic
                          ? 'هذا الصنف غير متابع مخزنيًا.'
                          : 'This item is not stock-tracked.');
                      return;
                    }
                    final baseUnit = text(match.item, 'unit');
                    final unit = match.matched == 'unit' ? match.unit : baseUnit;
                    final index = lines.indexWhere((line) =>
                      line.itemId == match.itemId &&
                      (line.unitName ?? line.baseUnit) == unit,
                    );
                    if (index >= 0) {
                      final line = lines[index];
                      final quantity = Decimal.tryParse(line.quantity.text.trim());
                      if (quantity == null || quantity < Decimal.zero) {
                        await showAppPlainError(dialogContext, _arabic
                            ? 'صحّح كمية الصنف قبل المسح مرة أخرى.'
                            : 'Correct the item quantity before scanning again.');
                        return;
                      }
                      line.quantity.text = (quantity + Decimal.one).toString();
                    } else {
                      setDialogState(() => lines.add(_DraftLine(
                        itemId: match.itemId,
                        itemLabel: '${match.itemCode} — ${localizedRecordName(match.item, arabic: _arabic)}',
                        baseUnit: baseUnit,
                      )..unitName = unit));
                    }
                    barcode.clear();
                  },
                );
              } finally {
                scanning = false;
              }
            }

            Future<void> submit() async {
              if (lines.isEmpty) {
                setDialogState(
                  () => error = _arabic
                      ? 'أضف سطرًا واحدًا على الأقل.'
                      : 'Add at least one line.',
                );
                return;
              }
              setDialogState(() {
                saving = true;
                error = null;
              });
              final navigator = Navigator.of(dialogContext);
              var closed = false;
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
                        if ((line.unitName ?? '').isNotEmpty)
                          'unitName': line.unitName,
                        if (kind == 'COUNT')
                          'countedQuantity': line.quantity.text.trim(),
                      },
                  ],
                };
                await ref
                    .read(apiClientProvider)
                    .post('/inventory/stock-documents', body: body);
                if (!mounted) return;
                closed = true;
                navigator.pop();
                showMessage(
                  context,
                  _arabic
                      ? 'تم إنشاء المستند. رحّله ليؤثر في الأرصدة.'
                      : 'The document was created. Post it to affect the balances.',
                );
                await ref.read(stockDocumentsProvider.notifier).reload();
              } catch (failure) {
                if (!closed && dialogContext.mounted) {
                  await showAppError(dialogContext, failure);
                }
              } finally {
                if (!closed && dialogContext.mounted) {
                  setDialogState(() => saving = false);
                }
              }
            }

            return AlertDialog(
              title: Text(_arabic ? 'مستند مخزني جديد' : 'New stock document'),
              content: SizedBox(
                // The dialog is as wide as the window allows, up to 840, and
                // never taller than the window. Asking for a fixed height made
                // the inner Column overflow when the dialog shrank.
                width: MediaQuery.sizeOf(context).width.clamp(320.0, 840.0),
                height: MediaQuery.sizeOf(context).height.clamp(240.0, 480.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // A row of fixed-width controls needs more room than a
                    // dialog is guaranteed; side by side they overflowed. Each
                    // one now takes the full width on its own line.
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        SizedBox(
                          width: 210,
                          child: DropdownButtonFormField<String>(
                            initialValue: kind,
                            decoration: InputDecoration(
                              labelText: _arabic ? 'نوع المستند' : 'Kind',
                              border: const OutlineInputBorder(),
                              isDense: true,
                            ),
                            items: [
                              for (final entry in _creatableKinds)
                                DropdownMenuItem(
                                  value: entry,
                                  child: Text(_kindLabel(entry)),
                                ),
                            ],
                            onChanged: (value) {
                              if (value != null) {
                                setDialogState(() => kind = value);
                              }
                            },
                          ),
                        ),
                        SizedBox(
                          width: 200,
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
                                  child: Text(
                                    localizedRecordName(warehouse, arabic: _arabic),
                                  ),
                                ),
                            ],
                            onChanged: (value) => setDialogState(() {
                              if (kind == 'TRANSFER') {
                                fromWarehouseId = value;
                              } else {
                                toWarehouseId = value;
                                fromWarehouseId = value;
                              }
                            }),
                          ),
                        ),
                        if (kind == 'TRANSFER')
                          SizedBox(
                            width: 200,
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
                                    child: Text(
                                      localizedRecordName(warehouse, arabic: _arabic),
                                    ),
                                  ),
                              ],
                              onChanged: (value) =>
                                  setDialogState(() => toWarehouseId = value),
                            ),
                          ),
                        TextButton.icon(
                          onPressed: addLine,
                          icon: const Icon(Icons.add_rounded, size: 18),
                          label: Text(_arabic ? 'إضافة سطر' : 'Add line'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    BarcodeScanField(
                      key: const ValueKey('stock-document-barcode'),
                      controller: barcode,
                      arabic: _arabic,
                      enabled: !saving,
                      compact: true,
                      onSubmitted: scan,
                    ),
                    if (error != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(
                          error!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ),
                    Expanded(
                      child: lines.isEmpty
                          ? Center(
                              child: Text(
                                _arabic
                                    ? 'لا توجد سطور بعد.'
                                    : 'No lines yet.',
                              ),
                            )
                          : ListView.separated(
                              itemCount: lines.length,
                              separatorBuilder: (_, _) =>
                                  const Divider(height: 1),
                              itemBuilder: (context, index) {
                                final line = lines[index];
                                return ListTile(
                                  dense: true,
                                  title: Text(line.itemLabel),
                                  subtitle: Text(
                                    _arabic
                                        ? 'الوحدة: ${line.unitName ?? line.baseUnit}'
                                        : 'Unit: ${line.unitName ?? line.baseUnit}',
                                  ),
                                  trailing: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      SizedBox(
                                        width: 110,
                                        child: TextField(
                                          controller: line.quantity,
                                          keyboardType:
                                              const TextInputType.numberWithOptions(
                                                decimal: true,
                                              ),
                                          decoration: InputDecoration(
                                            labelText: _arabic
                                                ? 'الكمية'
                                                : 'Quantity',
                                            isDense: true,
                                            border: const OutlineInputBorder(),
                                          ),
                                        ),
                                      ),
                                      IconButton(
                                        tooltip:
                                            _arabic ? 'حذف' : 'Remove line',
                                        icon: const Icon(
                                          Icons.delete_outline,
                                          size: 20,
                                        ),
                                        onPressed: () => setDialogState(() {
                                          lines.removeAt(index).dispose();
                                        }),
                                      ),
                                    ],
                                  ),
                                );
                              },
                            ),
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
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: saving ? null : () => Navigator.of(dialogContext).pop(),
                  child: Text(_arabic ? 'إلغاء' : 'Cancel'),
                ),
                FilledButton(
                  onPressed: saving ? null : submit,
                  child: Text(
                    saving
                        ? (_arabic ? 'جارٍ الحفظ…' : 'Saving…')
                        : (_arabic ? 'إنشاء' : 'Create'),
                  ),
                ),
              ],
            );
          },
        ),
      );
      await Navigator.of(context, rootNavigator: true).push(route);
      await route.completed;
    } finally {
      for (final line in lines) {
        line.dispose();
      }
      notes.dispose();
      barcode.dispose();
    }
  }

  List<Json> _visible(List<Json> rows) {
    var filtered = rows;
    if (_kind != null) {
      filtered = filtered
          .where((row) => text(row, 'kind').toUpperCase() == _kind)
          .toList(growable: false);
    }
    if (_query.isEmpty) return filtered;
    final needle = _query.toLowerCase();
    return filtered
        .where(
          (row) =>
              text(row, 'documentNumber').toLowerCase().contains(needle) ||
              text(row, 'createdByName').toLowerCase().contains(needle) ||
              (_movement(row) ?? '').toLowerCase().contains(needle),
        )
        .toList(growable: false);
  }
}
