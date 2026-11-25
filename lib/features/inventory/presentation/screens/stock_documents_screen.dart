import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/router/draft_exit_guard.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/barcode/barcode_scan.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../core/error/failure.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/item_picker_dialog.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../accounting/presentation/screens/journal_entries_screen.dart';
import '../../../dashboard/presentation/providers/dashboard_providers.dart';
import '../providers/stock_providers.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../operations/ops_auto_create.dart';

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
  String? storageLocationId;
  String? toStorageLocationId;
  String? batchId;
  String? batchLabel;
  String? storageLocationLabel;
  String? toStorageLocationLabel;

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
const _creatableKinds = ['ADJUSTMENT', 'TRANSFER', 'COUNT'];

/// Every kind this screen lists. Write-off is included because it is a stock
/// document; it is created and approved on its own screen.
const _kinds = [..._creatableKinds, 'OPENING', 'WRITE_OFF'];

class StockDocumentsScreen extends ConsumerStatefulWidget {
  const StockDocumentsScreen({super.key, this.navigationKey});

  final ValueKey<String>? navigationKey;

  @override
  ConsumerState<StockDocumentsScreen> createState() =>
      _StockDocumentsScreenState();
}

class _StockDocumentsScreenState extends ConsumerState<StockDocumentsScreen> {
  String _query = '';
  String? _kind;

  final _exitRelay = DraftExitRelay();
  late final DraftExitGuard _exitGuard;
  bool _changingStatus = false;

  @override
  void initState() {
    super.initState();
    _exitGuard = ref.read(draftExitGuardProvider);
    opsRunAutoCreate(this, _createDocument);
    final key = widget.navigationKey;
    if (key != null) _exitGuard.register(key, _exitRelay.canLeave);
  }

  @override
  void dispose() {
    final key = widget.navigationKey;
    if (key != null) _exitGuard.unregister(key, _exitRelay.canLeave);
    super.dispose();
  }

  Future<void> _changeStatus(Json row, {required bool reverse}) async {
    if (_changingStatus) return;
    final action = reverse ? 'reverse' : 'post';
    final label = reverse
        ? (_arabic ? 'عكس' : 'Reverse')
        : (_arabic ? 'ترحيل' : 'Post');
    setState(() => _changingStatus = true);
    try {
      final confirmed = await confirmAction(
        context,
        title: label,
        message: _statusEffect(row, reverse: reverse),
        confirmLabel: label,
        destructive: reverse,
      );
      if (!confirmed || !mounted) return;
      try {
        await ref
            .read(apiClientProvider)
            .post('/inventory/stock-documents/${text(row, 'id')}/$action');
        if (mounted) {
          showMessage(
            context,
            reverse
                ? (_arabic ? 'تم عكس المستند.' : 'Document reversed.')
                : (_arabic ? 'تم ترحيل المستند.' : 'Document posted.'),
          );
        }
      } catch (error) {
        if (mounted) await showAppError(context, error);
      } finally {
        if (mounted) {
          ref.invalidate(stockListProvider);
          ref.invalidate(journalEntriesProvider);
          invalidateDashboardAndReports(ref);
          await ref.read(stockDocumentsProvider.notifier).refreshQuietly();
        }
      }
    } finally {
      if (mounted) setState(() => _changingStatus = false);
    }
  }

  /// What pressing Post or Reverse will do, in words, before it is done.
  /// Only effects the posting code already has are named: stock movements
  /// and, when the value changes, a journal entry.
  String _statusEffect(Json row, {required bool reverse}) {
    final number = text(row, 'documentNumber');
    final kind = text(row, 'kind').toUpperCase();
    if (reverse) {
      return _arabic
          ? 'عكس المستند $number يلغي أثره على الأرصدة وعلى القيد المرتبط به إن وُجد. هل تريد المتابعة؟'
          : 'Reversing $number cancels its effect on stock and on its journal entry, if it has one. Continue?';
    }
    final what = switch (kind) {
      'COUNT' => _arabic
          ? 'سيُضبط رصيد كل صنف على الكمية المعدودة ويُسجَّل الفرق.'
          : 'Each item balance will be set to the counted quantity and the difference recorded.',
      'TRANSFER' => _arabic
          ? 'ستنتقل الكميات من مخزن إلى آخر${_movement(row) == null ? '' : ' (${_movement(row)})'}.'
          : 'The quantities will move between stores${_movement(row) == null ? '' : ' (${_movement(row)})'}.',
      _ => _arabic
          ? 'ستُضاف الكميات إلى الرصيد أو تُخصم منه حسب إشارتها.'
          : 'The quantities will be added to or removed from the balance.',
    };
    // A transfer moves the same stock at the cost it already carries, so the
    // posting code makes no journal entry for it. Counts and adjustments make
    // one only when the value changes.
    final tail = kind == 'TRANSFER'
        ? (_arabic
            ? ' يتغير رصيد المخزنين، ولا يُنشأ قيد محاسبي لأن القيمة لا تتغير.'
            : ' The balances of both stores change; no journal entry is made because the value does not change.')
        : (_arabic
            ? ' يتغير الرصيد، ويُنشأ قيد محاسبي عند تغيّر القيمة.'
            : ' Stock balances change, and a journal entry is made when the value changes.');
    return _arabic
        ? 'ترحيل المستند $number: $what$tail'
        : 'Post $number: $what$tail';
  }

  String _kindHelp(String kind) {
    return switch (kind) {
      'COUNT' => _arabic
          ? 'جرد: اكتب الكمية التي عددتها فعلًا لكل صنف. عند الترحيل يُضبط الرصيد عليها ويُسجَّل الفرق.'
          : 'Count: enter the quantity you actually counted for each item. When posted, the balance is set to it and the difference is recorded.',
      'TRANSFER' => _arabic
          ? 'تحويل: ينقل الكمية من مخزن إلى مخزن آخر.'
          : 'Transfer: moves the quantity from one store to another.',
      _ => _arabic
          ? 'تسوية: اكتب الزيادة أو النقص في الرصيد (بإشارة سالبة للنقص).'
          : 'Adjustment: enter how much to add to or remove from the balance (negative to remove).',
    };
  }

  Widget _sectionTitle(BuildContext context, String title) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(
          title,
          style: Theme.of(context)
              .textTheme
              .titleSmall
              ?.copyWith(fontWeight: FontWeight.w600),
        ),
      );

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
                DropdownMenuItem(value: kind, child: Text(_kindLabel(kind))),
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
          actions: canAdjust
              ? (row) {
                  final kind = text(row, 'kind').toUpperCase();
                  final status = text(row, 'status');
                  if (!_creatableKinds.contains(kind) ||
                      (status != 'draft' && status != 'posted')) {
                    return [];
                  }
                  final reverse = status == 'posted';
                  return [
                    if (!reverse)
                      IconButton(
                        tooltip: _arabic
                            ? 'تصحيح مواقع المسودة'
                            : 'Correct draft locations',
                        icon: const Icon(Icons.edit_location_alt_outlined),
                        onPressed: _changingStatus
                            ? null
                            : () => _correctDraftLocations(row),
                      ),
                    IconButton(
                      tooltip: reverse
                          ? (_arabic ? 'عكس' : 'Reverse')
                          : (_arabic ? 'ترحيل' : 'Post'),
                      icon: Icon(
                        reverse ? Icons.undo : Icons.play_arrow_outlined,
                      ),
                      onPressed: _changingStatus
                          ? null
                          : () => _changeStatus(row, reverse: reverse),
                    ),
                  ];
                }
              : null,
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
  /// Why a typed quantity cannot be sent, or null. A count may be zero, a
  /// transfer must move something, an adjustment may add or remove (signed).
  String? _quantityError(String kind, String raw) {
    final value = double.tryParse(raw.trim());
    if (!RegExp(r'^-?\d+(\.\d+)?$').hasMatch(raw.trim()) ||
        value == null ||
        !value.isFinite) {
      return _arabic ? 'اكتب كمية رقمية.' : 'Enter a numeric quantity.';
    }
    if (kind == 'TRANSFER' && value <= 0) {
      return _arabic
          ? 'كمية التحويل يجب أن تكون أكبر من صفر.'
          : 'A transfer quantity must be greater than zero.';
    }
    if (kind == 'COUNT' && value < 0) {
      return _arabic
          ? 'الكمية المعدودة لا تكون سالبة.'
          : 'A counted quantity cannot be negative.';
    }
    if (kind == 'ADJUSTMENT' && value == 0) {
      return _arabic
          ? 'التسوية بصفر لا تغيّر شيئًا.'
          : 'An adjustment of zero changes nothing.';
    }
    return null;
  }

  Future<List<Json>?> _splitTransferLine(
    BuildContext parent,
    Json document,
    Json line,
  ) async {
    final previous = listOf(line['splits']);
    var amount1 = previous.length == 2 ? text(previous[0], 'quantity') : '';
    var amount2 = previous.length == 2 ? text(previous[1], 'quantity') : '';
    final parts = <Json>[
      for (var i = 0; i < 2; i++)
        {
          'storageLocationId': line['storageLocationId'],
          'toStorageLocationId': line['toStorageLocationId'],
          'sourceLabel': line['storageLocationCode'],
          'targetLabel': line['toStorageLocationCode'],
          if (previous.length == 2) ...previous[i],
        },
    ];
    String? error;
    try {
      return await showDialog<List<Json>>(
        context: parent,
        barrierDismissible: false,
        builder: (context) => StatefulBuilder(
          builder: (context, update) => AlertDialog(
            title: Text(_arabic ? 'تقسيم كمية السطر' : 'Split line quantity'),
            content: SizedBox(
              width: 620,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      _arabic
                          ? 'إجمالي السطر: ${line['unitQuantity'] ?? line['quantity']} ${line['unit'] ?? ""}. أدخل جزأين بنفس وحدة السطر. لا تحفظ حتى يساوي المجموع الإجمالي.'
                          : 'Line total: ${line['unitQuantity'] ?? line['quantity']} ${line['unit'] ?? ""}. Enter two parts in the same line unit. Their sum must equal the total.',
                    ),
                    for (var i = 0; i < 2; i++)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            TextButton(
                              onPressed: () async {
                                final picked = await _pickDocumentLocation(
                                  context,
                                  asString(document['fromWarehouseId']),
                                  asString(parts[i]['storageLocationId']),
                                  source: true,
                                );
                                if (picked != null && context.mounted) {
                                  update(
                                    () => parts[i].addAll({
                                      'storageLocationId': picked['id'],
                                      'sourceLabel': picked['label'],
                                      'batchId': null,
                                      'label': null,
                                    }),
                                  );
                                }
                              },
                              child: Text(
                                _arabic
                                    ? 'موقع الجزء ${i + 1}: ${parts[i]['sourceLabel'] ?? line['storageLocationCode'] ?? "بدون موقع"}'
                                    : 'Part ${i + 1} source: ${parts[i]['sourceLabel'] ?? line['storageLocationCode'] ?? "unlocated"}',
                              ),
                            ),
                            TextFormField(
                              initialValue: i == 0 ? amount1 : amount2,
                              onChanged: (value) {
                                if (i == 0) {
                                  amount1 = value;
                                } else {
                                  amount2 = value;
                                }
                              },
                              decoration: InputDecoration(
                                labelText: _arabic
                                    ? 'كمية الجزء ${i + 1}'
                                    : 'Part ${i + 1} quantity',
                              ),
                            ),
                            TextButton(
                              onPressed: () async {
                                final picked = await _pickTransferLot(
                                  context,
                                  text(line, 'itemId'),
                                  asString(document['fromWarehouseId']),
                                  asString(parts[i]['storageLocationId']),
                                  asString(parts[i]['batchId']),
                                );
                                if (picked != null && context.mounted) {
                                  update(
                                    () => parts[i].addAll({
                                      'batchId': picked['id'],
                                      'label': picked['label'],
                                    }),
                                  );
                                }
                              },
                              child: Text(
                                _arabic
                                    ? 'دفعة الجزء ${i + 1}: ${parts[i]['label'] ?? "غير محددة"}'
                                    : 'Part ${i + 1} lot: ${parts[i]['label'] ?? "not selected"}',
                              ),
                            ),
                          ],
                        ),
                      ),
                    if (error != null)
                      Text(
                        error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: Text(_arabic ? 'إلغاء' : 'Cancel'),
              ),
              FilledButton(
                onPressed: () {
                  final a = Decimal.tryParse(amount1.trim()),
                      b = Decimal.tryParse(amount2.trim()),
                      total = Decimal.tryParse(
                        '${line['unitQuantity'] ?? line['quantity']}',
                      );
                  if (a == null ||
                      b == null ||
                      a <= Decimal.zero ||
                      b <= Decimal.zero ||
                      a + b != total ||
                      parts.any((p) => p['batchId'] == null)) {
                    update(
                      () => error = _arabic
                          ? 'اختر دفعة لكل جزء وأدخل كميتين موجبتين مجموعهما يساوي كمية السطر.'
                          : 'Choose each lot and positive quantities that add up to the line total.',
                    );
                    return;
                  }
                  Navigator.pop(context, [
                    for (var i = 0; i < 2; i++)
                      {
                        ...parts[i],
                        'quantity': i == 0 ? amount1.trim() : amount2.trim(),
                      },
                  ]);
                },
                child: Text(_arabic ? 'تطبيق التقسيم' : 'Apply split'),
              ),
            ],
          ),
        ),
      );
    } finally {
      // TextFormField owns the input lifetime through the closing transition.
    }
  }

  Future<void> _correctDraftLocations(Json row) async {
    Json document;
    try {
      document = await ref
          .read(apiClientProvider)
          .getObject('/inventory/stock-documents/${text(row, 'id')}');
    } catch (error) {
      if (mounted) await showAppError(context, error);
      return;
    }
    if (!mounted) return;
    final lines = listOf(document['lines'])
        .map((line) => Map<String, dynamic>.from(line))
        .toList();
    if (text(document, 'kind').toUpperCase() == 'TRANSFER' &&
        document['toWarehouseId'] != null) {
      try {
        final targets = await ref
            .read(apiClientProvider)
            .getList(
              '/inventory/locations',
              query: {'warehouseId': document['toWarehouseId']},
            );
        for (final line in lines) {
          for (final target in targets) {
            if (target['id'] == line['toStorageLocationId']) {
              line['toStorageLocationCode'] = text(target, 'code');
            }
          }
        }
      } catch (_) {
        /* Keep the saved id and explicit unavailable label on read failure. */
      }
    }
    if (!mounted) return;
    var saving = false;
    String? failure;
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: Text(
            _arabic ? 'تصحيح مواقع المسودة' : 'Correct draft locations',
          ),
          content: SizedBox(
            width: 680,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    _arabic
                        ? 'راجع مواقع المصدر والاستلام صراحة. الإجمالي والوحدة لا يتغيران. مجموع الأجزاء يجب أن يساوي الإجمالي. الحفظ لا يرحّل المستند.'
                        : 'Review source and destination explicitly. The total and unit stay unchanged. Split parts must add up exactly. Saving does not post the document.',
                  ),
                  for (final line in lines)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${text(line, 'lineNumber')} · ${text(line, 'itemCode')} · ${text(line, 'unitQuantity')} ${text(line, 'unit')}',
                          ),
                          Wrap(
                            spacing: 8,
                            children: [
                              if (text(document, 'kind').toUpperCase() ==
                                  'TRANSFER') ...[
                                TextButton(
                                  onPressed: saving
                                      ? null
                                      : () async {
                                          final picked = await _pickTransferLot(
                                            dialogContext,
                                            text(line, 'itemId'),
                                            asString(
                                              document['fromWarehouseId'],
                                            ),
                                            asString(line['storageLocationId']),
                                            asString(line['batchId']),
                                          );
                                          if (picked != null &&
                                              dialogContext.mounted) {
                                            update(
                                              () => line.addAll({
                                                'batchId': picked['id'],
                                                'batchLabel':
                                                    picked['label'] ??
                                                    (_arabic
                                                        ? 'بدون دفعة (رصيد قديم)'
                                                        : 'No lot (legacy stock)'),
                                                'batchChanged': true,
                                                'splits': null,
                                              }),
                                            );
                                          }
                                        },
                                  child: Text(
                                    _arabic
                                        ? 'الدفعة: ${line['batchLabel'] ?? line['batchNumber'] ?? "اختر"}'
                                        : 'Lot: ${line['batchLabel'] ?? line['batchNumber'] ?? "choose"}',
                                  ),
                                ),
                                TextButton(
                                  onPressed: saving
                                      ? null
                                      : () async {
                                          final split =
                                              await _splitTransferLine(
                                                dialogContext,
                                                document,
                                                line,
                                              );
                                          if (split != null &&
                                              dialogContext.mounted) {
                                            update(
                                              () => line['splits'] = split,
                                            );
                                          }
                                        },
                                  child: Text(
                                    _arabic
                                        ? 'تقسيم كمية السطر'
                                        : 'Split line quantity',
                                  ),
                                ),
                                if (line['splits'] is List)
                                  Text(
                                    (line['splits'] as List)
                                        .map(
                                          (p) =>
                                              '${p['quantity']} × ${p['label']} [${p['sourceLabel'] ?? line['storageLocationCode'] ?? (_arabic ? "بدون موقع" : "unlocated")}]',
                                        )
                                        .join(' + '),
                                  ),
                              ],
                              TextButton(
                                onPressed: saving
                                    ? null
                                    : () async {
                                        final picked =
                                            await _pickDocumentLocation(
                                              dialogContext,
                                              asString(
                                                document[text(
                                                          document,
                                                          'kind',
                                                        ).toUpperCase() ==
                                                        'TRANSFER'
                                                    ? 'fromWarehouseId'
                                                    : 'toWarehouseId'],
                                              ),
                                              asString(
                                                line['storageLocationId'],
                                              ),
                                              source: true,
                                            );
                                        if (picked != null &&
                                            dialogContext.mounted) {
                                          update(() {
                                            line['storageLocationId'] =
                                                picked['id'];
                                            line['storageLocationCode'] =
                                                picked['code'];
                                            line['batchId'] = null;
                                            line['batchChanged'] = true;
                                            line['batchLabel'] = _arabic
                                                ? 'بدون دفعة (اختر مجددًا)'
                                                : 'No lot (choose again)';
                                            line['splits'] = null;
                                            failure = null;
                                          });
                                        }
                                      },
                                child: Text(
                                  _arabic
                                      ? 'المصدر: ${line['storageLocationId'] == null ? "بدون موقع" : text(line, 'storageLocationCode', fallback: "محدد")}'
                                      : 'Source: ${line['storageLocationId'] == null ? "unlocated" : text(line, 'storageLocationCode', fallback: "selected")}',
                                ),
                              ),
                              if (text(document, 'kind').toUpperCase() ==
                                  'TRANSFER')
                                TextButton(
                                  onPressed: saving
                                      ? null
                                      : () async {
                                          final picked =
                                              await _pickDocumentLocation(
                                                dialogContext,
                                                asString(
                                                  document['toWarehouseId'],
                                                ),
                                                asString(
                                                  line['toStorageLocationId'],
                                                ),
                                                source: false,
                                              );
                                          if (picked != null &&
                                              dialogContext.mounted) {
                                            update(() {
                                              line['toStorageLocationId'] =
                                                  picked['id'];
                                              line['toStorageLocationCode'] =
                                                  picked['code'];
                                              line['splits'] = null;
                                              failure = null;
                                            });
                                          }
                                        },
                                  child: Text(
                                    _arabic
                                        ? 'الاستلام: ${line['toStorageLocationId'] == null ? "بدون موقع" : text(line, 'toStorageLocationCode', fallback: "محدد")}'
                                        : 'Destination: ${line['toStorageLocationId'] == null ? "unlocated" : text(line, 'toStorageLocationCode', fallback: "selected")}',
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  if (failure != null)
                    Text(
                      failure!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(dialogContext),
              child: Text(_arabic ? 'إلغاء' : 'Cancel'),
            ),
            FilledButton(
              onPressed: saving
                  ? null
                  : () async {
                      update(() => saving = true);
                      try {
                        await ref
                            .read(apiClientProvider)
                            .put(
                              '/inventory/stock-documents/${text(row, 'id')}/draft-locations',
                              body: {
                                'expectedVersion': document['editVersion'],
                                'lines': [
                                  for (final line in lines)
                                    {
                                      'lineNumber': line['lineNumber'],
                                      if (line['batchChanged'] == true ||
                                          line['batchId'] != null)
                                        'batchId': line['batchId'],
                                      if (line['splits'] is List)
                                        'splits': [
                                          for (final part
                                              in line['splits'] as List)
                                            {
                                              'quantity': part['quantity'],
                                              'batchId': part['batchId'],
                                              'storageLocationId':
                                                  part['storageLocationId'],
                                              'toStorageLocationId':
                                                  part['toStorageLocationId'],
                                            },
                                        ],
                                      'storageLocationId':
                                          line['storageLocationId'],
                                      if (text(
                                            document,
                                            'kind',
                                          ).toUpperCase() ==
                                          'TRANSFER')
                                        'toStorageLocationId':
                                            line['toStorageLocationId'],
                                    },
                                ],
                              },
                            );
                        if (dialogContext.mounted) Navigator.pop(dialogContext);
                        ref.read(stockDocumentsProvider.notifier).reload();
                      } catch (error) {
                        if (dialogContext.mounted) {
                          update(() {
                            saving = false;
                            failure = error is ApiFailure
                                ? error.message
                                : error.toString();
                          });
                        }
                      }
                    },
              child: Text(_arabic ? 'حفظ المواقع' : 'Save locations'),
            ),
          ],
        ),
      ),
    );
  }

  Future<Json?> _pickTransferLot(
    BuildContext dialogContext,
    String itemId,
    String? warehouseId,
    String? locationId,
    String? selected,
  ) async {
    if (warehouseId == null) return null;
    try {
      final rows = <Json>[];
      var page = 1;
      while (true) {
        final data = await ref
            .read(apiClientProvider)
            .getObject(
              '/inventory/batches',
              query: {
                'itemId': itemId,
                'warehouseId': warehouseId,
                'page': page,
                'pageSize': 200,
              },
            );
        final part = listOf(data['items']);
        rows.addAll(
          part.where(
            (row) =>
                text(row, 'itemId') == itemId &&
                text(row, 'warehouseId') == warehouseId,
          ),
        );
        final total = int.tryParse('${data['total']}');
        if (part.isEmpty ||
            (total != null && page * 200 >= total) ||
            (total == null && part.length < 200)) {
          break;
        }
        page++;
        if (page > 100) {
          throw StateError(
            _arabic
                ? 'ضيّق اختيار الصنف والمخزن.'
                : 'Narrow the item and warehouse selection.',
          );
        }
      }
      if (!dialogContext.mounted) return null;
      Decimal available(Json row) {
        if (locationId == null) {
          return Decimal.tryParse(text(row, 'unplacedQuantity')) ??
              Decimal.zero;
        }
        return listOf(row['locations'])
            .where((l) => text(l, 'locationId') == locationId)
            .fold(
              Decimal.zero,
              (sum, l) =>
                  sum + (Decimal.tryParse(text(l, 'quantity')) ?? Decimal.zero),
            );
      }

      final choices = rows
          .where(
            (r) =>
                text(r, 'status').toUpperCase() != 'WRITTEN_OFF' &&
                available(r) > Decimal.zero &&
                (Decimal.tryParse(text(r, 'remainingQuantity')) ??
                        Decimal.zero) >
                    Decimal.zero,
          )
          .toList();
      var current = choices.any((r) => text(r, 'id') == selected)
          ? selected
          : null;
      return await showDialog<Json>(
        context: dialogContext,
        builder: (context) => StatefulBuilder(
          builder: (context, update) => AlertDialog(
            title: Text(_arabic ? 'دفعة المصدر' : 'Source lot'),
            content: SizedBox(
              width: 520,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    _arabic
                        ? 'المتاح في موقع المصدر المختار بوحدة الأساس. اختر دفعة واحدة لكل سطر. لتوزيع الكمية استخدم تقسيم السطر وحدد كمية ودفعة لكل جزء.'
                        : 'Available at the selected source location in base units. One lot per line. Use Split line and set quantity and lot for each part.',
                  ),
                  if (choices.isNotEmpty)
                    DropdownButtonFormField<String>(
                      initialValue: current,
                      isExpanded: true,
                      decoration: InputDecoration(
                        labelText: _arabic ? 'الدفعة' : 'Lot',
                      ),
                      items: [
                        for (final row in choices)
                          DropdownMenuItem(
                            value: text(row, 'id'),
                            child: Text(
                              '${text(row, 'batchNumber')} · ${available(row)} · ${text(row, 'expiryDate', fallback: '—')}',
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                      ],
                      onChanged: (value) => update(() => current = value),
                    ),
                  if (choices.isEmpty)
                    Text(
                      _arabic
                          ? 'لا توجد دفعات برصيد في هذا الموقع. راجع موقع المصدر أو صلاحية قراءة الدفعات. بدون دفعة مخصص فقط لرصيد قديم غير متتبع بدفعات؛ الخادم يتحقق عند الترحيل.'
                          : 'No lots with stock at this location. Check the source location or lot-read access. No lot is only for legacy stock without lot tracking; posting is checked by the server.',
                    ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: Text(_arabic ? 'إلغاء' : 'Cancel'),
              ),
              TextButton(
                onPressed: () =>
                    Navigator.pop(context, <String, dynamic>{'id': null}),
                child: Text(
                  _arabic ? 'بدون دفعة (رصيد قديم)' : 'No lot (legacy stock)',
                ),
              ),
              FilledButton(
                onPressed: current == null
                    ? null
                    : () => Navigator.pop(context, <String, dynamic>{
                        'id': current,
                        'label': text(
                          choices.firstWhere((r) => text(r, 'id') == current),
                          'batchNumber',
                        ),
                      }),
                child: Text(_arabic ? 'تطبيق' : 'Apply'),
              ),
            ],
          ),
        ),
      );
    } catch (error) {
      if (dialogContext.mounted) await showAppError(dialogContext, error);
      return null;
    }
  }

  Future<Json?> _pickDocumentLocation(
    BuildContext dialogContext,
    String? warehouseId,
    String? selected, {
    required bool source,
  }) async {
    if (warehouseId == null) return null;
    try {
      final rows =
          (await ref
                  .read(apiClientProvider)
                  .getList(
                    '/inventory/locations',
                    query: {'warehouseId': warehouseId},
                  ))
              .where(
                (row) =>
                    text(row, 'warehouseId') == warehouseId &&
                    (source || row['isActive'] != false),
              )
              .toList();
      if (!dialogContext.mounted) return null;
      var current = selected;
      return await showDialog<Json>(
        context: dialogContext,
        builder: (context) => StatefulBuilder(
          builder: (context, update) => AlertDialog(
            title: Text(
              source
                  ? (_arabic ? 'موقع المصدر' : 'Source location')
                  : (_arabic ? 'موقع الاستلام' : 'Destination location'),
            ),
            content: SizedBox(
              width: 480,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    _arabic
                        ? 'اختر الموقع الفعلي في المخزن المحدد. تحويل من موقع واحد لكل سطر.'
                        : 'Choose the physical location in the selected store. One source per line.',
                  ),
                  DropdownButtonFormField<String>(
                    initialValue: rows.any((row) => text(row, 'id') == current)
                        ? current
                        : null,
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: _arabic ? 'الموقع' : 'Location',
                    ),
                    items: [
                      for (final row in rows)
                        DropdownMenuItem(
                          value: text(row, 'id'),
                          child: Text(
                            '${text(row, 'code')} • ${localizedRecordName(row, arabic: _arabic)}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                    onChanged: (value) => update(() => current = value),
                  ),
                  if (selected != null &&
                      !rows.any((row) => text(row, 'id') == selected))
                    Text(
                      _arabic
                          ? 'الموقع المحفوظ غير متاح. اختر موقعًا نشطًا أو امسحه صراحة.'
                          : 'Saved location unavailable. Select an active location or clear it explicitly.',
                    ),
                  if (rows.isEmpty)
                    Text(
                      _arabic
                          ? 'لا توجد مواقع نشطة. أنشئ موقعًا ثم افتح الاختيار مجددًا.'
                          : 'No active locations. Create a location, then reopen this picker.',
                    ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: Text(_arabic ? 'إلغاء' : 'Cancel'),
              ),
              TextButton(
                onPressed: () =>
                    Navigator.pop(context, <String, dynamic>{'id': null}),
                child: Text(_arabic ? 'بدون موقع' : 'Clear location'),
              ),
              FilledButton(
                onPressed: rows.any((row) => text(row, 'id') == current)
                    ? () => Navigator.pop(context, <String, dynamic>{
                        'id': current,
                        'code': text(
                          rows.firstWhere((r) => text(r, 'id') == current),
                          'code',
                        ),
                        'label':
                            '${text(rows.firstWhere((r) => text(r, 'id') == current), 'code')} • ${localizedRecordName(rows.firstWhere((r) => text(r, 'id') == current), arabic: _arabic)}',
                      })
                    : null,
                child: Text(_arabic ? 'تطبيق' : 'Apply'),
              ),
            ],
          ),
        ),
      );
    } catch (error) {
      if (dialogContext.mounted) await showAppError(dialogContext, error);
      return null;
    }
  }

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
    // Reasons under their field: lines, fromWarehouse, toWarehouse, line.N.
    final errors = <String, String>{};
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

    final initialWarehouseId = text(defaultWarehouse, 'id');
    var confirmingExit = false;
    final navigator = Navigator.of(context, rootNavigator: true);
    late final DialogRoute<void> route;
    Future<bool> closeDraft() async {
      if (saving || confirmingExit) return false;
      final changed =
          lines.isNotEmpty ||
          notes.text.trim().isNotEmpty ||
          kind != 'COUNT' ||
          fromWarehouseId != initialWarehouseId ||
          toWarehouseId != initialWarehouseId;
      if (changed) {
        confirmingExit = true;
        try {
          if (!await confirmAction(
            context,
            title: _arabic ? 'تغييرات غير محفوظة' : 'Unsaved changes',
            message: _arabic ? 'هل تريد تجاهل المستند؟' : 'Discard this draft?',
            confirmLabel: _arabic ? 'تجاهل التغييرات' : 'Discard changes',
            destructive: true,
          )) {
            return false;
          }
        } finally {
          confirmingExit = false;
        }
      }
      if (!navigator.mounted || !route.isCurrent) return false;
      navigator.pop();
      return true;
    }

    _exitRelay.attach(closeDraft);
    try {
      route = DialogRoute<void>(
        barrierDismissible: false,
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) {
            Future<void> addLine() async {
              final item = await showItemPicker(context);
              if (item == null || !dialogContext.mounted || saving) return;
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
                  lookup: (value) => ref
                      .read(apiClientProvider)
                      .getObject(
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
                      await showAppPlainError(
                        dialogContext,
                        _arabic
                            ? 'هذا الصنف غير متابع مخزنيًا.'
                            : 'This item is not stock-tracked.',
                      );
                      return;
                    }
                    final baseUnit = text(match.item, 'unit');
                    final unit = match.matched == 'unit'
                        ? match.unit
                        : baseUnit;
                    final index = lines.indexWhere(
                      (line) =>
                          line.itemId == match.itemId &&
                          (line.unitName ?? line.baseUnit) == unit &&
                          line.batchId == null &&
                          line.storageLocationId == null,
                    );
                    if (index >= 0) {
                      final line = lines[index];
                      final quantity = Decimal.tryParse(
                        line.quantity.text.trim(),
                      );
                      if (quantity == null || quantity < Decimal.zero) {
                        await showAppPlainError(
                          dialogContext,
                          _arabic ? 'صحّح كمية الصنف قبل المسح مرة أخرى.' : 'Correct the item quantity before scanning again.',
                        );
                        return;
                      }
                      line.quantity.text = (quantity + Decimal.one).toString();
                    } else {
                      setDialogState(
                        () => lines.add(
                          _DraftLine(
                            itemId: match.itemId,
                            itemLabel:
                                '${match.itemCode} — ${localizedRecordName(match.item, arabic: _arabic)}',
                            baseUnit: baseUnit,
                          )..unitName = unit,
                        ),
                      );
                    }
                    barcode.clear();
                  },
                );
              } finally {
                scanning = false;
              }
            }

            Future<void> submit() async {
              final found = <String, String>{};
              if (lines.isEmpty) {
                found['lines'] = _arabic
                    ? 'أضف سطرًا واحدًا على الأقل.'
                    : 'Add at least one line.';
              }
              if (kind == 'TRANSFER') {
                if (fromWarehouseId == null) {
                  found['fromWarehouse'] = _arabic
                      ? 'اختر المخزن المحوِّل.'
                      : 'Choose the source store.';
                }
                if (toWarehouseId == null) {
                  found['toWarehouse'] = _arabic
                      ? 'اختر المخزن المستلم.'
                      : 'Choose the destination store.';
                } else if (fromWarehouseId == toWarehouseId) {
                  found['toWarehouse'] = _arabic
                      ? 'المخزن المستلم يجب أن يختلف عن المحوِّل.'
                      : 'The destination must differ from the source store.';
                }
              }
              for (var i = 0; i < lines.length; i++) {
                final reason = _quantityError(kind, lines[i].quantity.text);
                if (reason != null) found['line.$i'] = reason;
              }
              if (found.isNotEmpty) {
                setDialogState(() {
                  errors
                    ..clear()
                    ..addAll(found);
                  error = null;
                });
                return;
              }
              setDialogState(() {
                saving = true;
                error = null;
                errors.clear();
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
                        if (kind == 'TRANSFER' && line.batchId != null)
                          'batchId': line.batchId,
                        if (kind == 'TRANSFER' &&
                            line.storageLocationId != null)
                          'storageLocationId': line.storageLocationId,
                        if (kind == 'TRANSFER' &&
                            line.toStorageLocationId != null)
                          'toStorageLocationId': line.toStorageLocationId,
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
                  _arabic ? 'تم إنشاء المستند. رحّله ليؤثر في الأرصدة.' : 'The document was created. Post it to affect the balances.',
                );
                await ref.read(stockDocumentsProvider.notifier).reload();
              } catch (failure) {
                if (!closed &&
                    dialogContext.mounted &&
                    failure is ApiFailure &&
                    const {400, 422}.contains(failure.statusCode) &&
                    failure.fieldErrors.isNotEmpty) {
                  // Nothing was saved: reasons go under their fields.
                  final lineKey = RegExp(r'^lines\.(\d+)\.');
                  final rest = <String>[];
                  setDialogState(() {
                    errors.clear();
                    failure.fieldErrors.forEach((key, message) {
                      final m = lineKey.firstMatch(key);
                      if (m != null) {
                        errors['line.${m.group(1)}'] = message;
                      } else if (key == 'fromWarehouseId') {
                        errors['fromWarehouse'] = message;
                      } else if (key == 'toWarehouseId') {
                        errors['toWarehouse'] = message;
                      } else if (key == 'lines') {
                        errors['lines'] = message;
                      } else {
                        rest.add(message);
                      }
                    });
                    error = rest.isEmpty ? null : rest.join('\n');
                  });
                } else if (!closed && dialogContext.mounted) {
                  await showAppError(dialogContext, failure);
                }
              } finally {
                if (!closed && dialogContext.mounted) {
                  setDialogState(() => saving = false);
                }
              }
            }

            return PopScope(
              canPop: false,
              onPopInvokedWithResult: (didPop, _) {
                if (!didPop) closeDraft();
              },
              child: AlertDialog(
                title: Text(
                  _arabic ? 'مستند مخزني جديد' : 'New stock document',
                ),
                content: SizedBox(
                  // The dialog is as wide as the window allows, up to 840, and
                  // never taller than the window. Asking for a fixed height made
                  // the inner Column overflow when the dialog shrank.
                  width: MediaQuery.sizeOf(context).width.clamp(320.0, 840.0),
                  height: (MediaQuery.sizeOf(context).height * 0.85).clamp(240.0, 620.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      // A row of fixed-width controls needs more room than a
                      // dialog is guaranteed; side by side they overflowed. Each
                      // one now takes the full width on its own line.
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _sectionTitle(
                            context,
                            _arabic ? 'بيانات المستند' : 'Document details',
                          ),
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
                                  setDialogState(() {
                                    kind = value;
                                    for (final line in lines) {
                                      line.storageLocationId = null;
                                      line.storageLocationLabel = null;
                                      line.batchId = null;
                                      line.batchLabel = null;
                                      line.toStorageLocationId = null;
                                      line.toStorageLocationLabel = null;
                                    }
                                    errors.clear();
                                  });
                                }
                              },
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.only(top: 4, bottom: 10),
                            child: Text(
                              _kindHelp(kind),
                              style: Theme.of(context).textTheme.bodySmall,
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
                                errorText:
                                    errors[kind == 'TRANSFER'
                                        ? 'fromWarehouse'
                                        : 'toWarehouse'],
                              ),
                              items: [
                                for (final warehouse in warehouses)
                                  DropdownMenuItem(
                                    value: text(warehouse, 'id'),
                                    child: Text(
                                      localizedRecordName(
                                        warehouse,
                                        arabic: _arabic,
                                      ),
                                    ),
                                  ),
                              ],
                              onChanged: (value) => setDialogState(() {
                                errors.remove('fromWarehouse');
                                errors.remove('toWarehouse');
                                if (kind == 'TRANSFER') {
                                  fromWarehouseId = value;
                                  for (final line in lines) {
                                    line.storageLocationId = null;
                                    line.storageLocationLabel = null;
                                    line.batchId = null;
                                    line.batchLabel = null;
                                  }
                                } else {
                                  toWarehouseId = value;
                                  for (final line in lines) {
                                    line.toStorageLocationId = null;
                                    line.toStorageLocationLabel = null;
                                  }
                                  fromWarehouseId = value;
                                }
                              }),
                            ),
                          ),
                          if (kind == 'TRANSFER') const SizedBox(height: 10),
                          if (kind == 'TRANSFER')
                            SizedBox(
                              width: 200,
                              child: DropdownButtonFormField<String>(
                                initialValue: toWarehouseId,
                                decoration: InputDecoration(
                                  labelText: _arabic ? 'إلى مخزن' : 'To store',
                                  border: const OutlineInputBorder(),
                                  isDense: true,
                                  errorText: errors['toWarehouse'],
                                ),
                                items: [
                                  for (final warehouse in warehouses)
                                    DropdownMenuItem(
                                      value: text(warehouse, 'id'),
                                      child: Text(
                                        localizedRecordName(
                                          warehouse,
                                          arabic: _arabic,
                                        ),
                                      ),
                                    ),
                                ],
                                onChanged: (value) => setDialogState(() {
                                  errors.remove('toWarehouse');
                                  toWarehouseId = value;
                                  for (final line in lines) {
                                    line.toStorageLocationId = null;
                                    line.toStorageLocationLabel = null;
                                  }
                                }),
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: _sectionTitle(
                              context,
                              _arabic
                                  ? 'الأصناف والكميات'
                                  : 'Items and quantities',
                            ),
                          ),
                          TextButton.icon(
                            onPressed: addLine,
                            icon: const Icon(Icons.add_rounded, size: 18),
                            label: Text(_arabic ? 'إضافة سطر' : 'Add line'),
                          ),
                        ],
                      ),
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
                                  errors['lines'] ??
                                      (_arabic
                                          ? 'لا توجد سطور بعد.'
                                          : 'No lines yet.'),
                                  style: errors['lines'] == null
                                      ? null
                                      : TextStyle(
                                          color: Theme.of(context)
                                              .colorScheme
                                              .error,
                                        ),
                                ),
                              )
                            : ListView.separated(
                                itemCount: lines.length,
                                separatorBuilder: (_, _) =>
                                    const Divider(height: 1),
                                itemBuilder: (context, index) {
                                  final line = lines[index];
                                  // A plain row, not a ListTile: a quantity that shows its
                                  // reason is taller than a dense tile allows.
                                  return Padding(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 16,
                                      vertical: 6,
                                    ),
                                    child: Row(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(line.itemLabel),
                                              if (kind == 'TRANSFER')
                                                Wrap(
                                                  spacing: 8,
                                                  children: [
                                                    TextButton.icon(
                                                      icon: const Icon(
                                                        Icons.output,
                                                      ),
                                                      label: Text(
                                                        _arabic
                                                            ? 'موقع المصدر: ${line.storageLocationId == null ? "غير محدد" : line.storageLocationLabel ?? "محدد"}'
                                                            : 'Source location: ${line.storageLocationId == null ? "not selected" : line.storageLocationLabel ?? "selected"}',
                                                      ),
                                                      onPressed: saving
                                                          ? null
                                                          : () async {
                                                              final picked =
                                                                  await _pickDocumentLocation(
                                                                    dialogContext,
                                                                    fromWarehouseId,
                                                                    line.storageLocationId,
                                                                    source:
                                                                        true,
                                                                  );
                                                              if (picked !=
                                                                      null &&
                                                                  dialogContext
                                                                      .mounted) {
                                                                setDialogState(() {
                                                                  line.storageLocationId =
                                                                      picked['id']
                                                                          as String?;
                                                                  line.storageLocationLabel =
                                                                      picked['label']
                                                                          as String?;
                                                                  line.batchId =
                                                                      null;
                                                                  line.batchLabel =
                                                                      null;
                                                                });
                                                              }
                                                            },
                                                    ),
                                                    TextButton.icon(
                                                      icon: const Icon(
                                                        Icons
                                                            .inventory_2_outlined,
                                                      ),
                                                      label: Text(
                                                        _arabic
                                                            ? 'الدفعة: ${line.batchLabel ?? "غير محددة"}'
                                                            : 'Lot: ${line.batchLabel ?? "not selected"}',
                                                      ),
                                                      onPressed: saving
                                                          ? null
                                                          : () async {
                                                              final picked = await _pickTransferLot(
                                                                dialogContext,
                                                                line.itemId,
                                                                fromWarehouseId,
                                                                line.storageLocationId,
                                                                line.batchId,
                                                              );
                                                              if (picked !=
                                                                      null &&
                                                                  dialogContext
                                                                      .mounted) {
                                                                setDialogState(() {
                                                                  line.batchId =
                                                                      picked['id']
                                                                          as String?;
                                                                  line.batchLabel =
                                                                      picked['label']
                                                                          as String?;
                                                                });
                                                              }
                                                            },
                                                    ),
                                                    TextButton.icon(
                                                      icon: const Icon(
                                                        Icons.call_split,
                                                      ),
                                                      label: Text(
                                                        _arabic
                                                            ? 'تقسيم السطر'
                                                            : 'Split line',
                                                      ),
                                                      onPressed: saving
                                                          ? null
                                                          : () => setDialogState(() {
                                                              final copy =
                                                                  _DraftLine(
                                                                      itemId: line
                                                                          .itemId,
                                                                      itemLabel:
                                                                          line.itemLabel,
                                                                      baseUnit:
                                                                          line.baseUnit,
                                                                    )
                                                                    ..unitName =
                                                                        line.unitName
                                                                    ..storageLocationId =
                                                                        line.storageLocationId
                                                                    ..storageLocationLabel =
                                                                        line.storageLocationLabel
                                                                    ..toStorageLocationId =
                                                                        line.toStorageLocationId
                                                                    ..toStorageLocationLabel =
                                                                        line.toStorageLocationLabel;
                                                              copy.quantity
                                                                  .clear();
                                                              lines.insert(
                                                                index + 1,
                                                                copy,
                                                              );
                                                            }),
                                                    ),
                                                    TextButton.icon(
                                                      icon: const Icon(
                                                        Icons.input,
                                                      ),
                                                      label: Text(
                                                        _arabic
                                                            ? 'موقع الاستلام: ${line.toStorageLocationId == null ? "بدون موقع" : line.toStorageLocationLabel ?? "محدد"}'
                                                            : 'Destination location: ${line.toStorageLocationId == null ? "unlocated" : line.toStorageLocationLabel ?? "selected"}',
                                                      ),
                                                      onPressed: saving
                                                          ? null
                                                          : () async {
                                                              final picked =
                                                                  await _pickDocumentLocation(
                                                                    dialogContext,
                                                                    toWarehouseId,
                                                                    line.toStorageLocationId,
                                                                    source:
                                                                        false,
                                                                  );
                                                              if (picked !=
                                                                      null &&
                                                                  dialogContext
                                                                      .mounted) {
                                                                setDialogState(() {
                                                                  line.toStorageLocationId =
                                                                      picked['id']
                                                                          as String?;
                                                                  line.toStorageLocationLabel =
                                                                      picked['label']
                                                                          as String?;
                                                                });
                                                              }
                                                            },
                                                    ),
                                                  ],
                                                ),
                                              Text(
                                                _arabic
                                                    ? 'الوحدة: ${line.unitName ?? line.baseUnit}'
                                                    : 'Unit: ${line.unitName ?? line.baseUnit}',
                                                style: Theme.of(context)
                                                    .textTheme
                                                    .bodySmall,
                                              ),
                                            ],
                                          ),
                                        ),
                                        Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            SizedBox(
                                              width: 110,
                                              child: TextField(
                                                controller: line.quantity,
                                                onChanged: (_) {
                                                  if (errors.remove(
                                                        'line.$index',
                                                      ) !=
                                                      null) {
                                                    setDialogState(() {});
                                                  }
                                                },
                                                keyboardType:
                                                    const TextInputType.numberWithOptions(
                                                      decimal: true,
                                                    ),
                                                decoration: InputDecoration(
                                                  labelText: _arabic
                                                      ? 'الكمية'
                                                      : 'Quantity',
                                                  isDense: true,
                                                  border:
                                                      const OutlineInputBorder(),
                                                  errorText:
                                                      errors['line.$index'],
                                                  errorMaxLines: 3,
                                                ),
                                              ),
                                            ),
                                            IconButton(
                                              tooltip: _arabic
                                                  ? 'حذف'
                                                  : 'Remove line',
                                              icon: const Icon(
                                                Icons.delete_outline,
                                                size: 20,
                                              ),
                                              onPressed: () =>
                                                  setDialogState(() {
                                                    errors.removeWhere(
                                                      (k, _) =>
                                                          k.startsWith('line.'),
                                                    );
                                                    lines
                                                        .removeAt(index)
                                                        .dispose();
                                                  }),
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  );
                                },
                              ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        _arabic
                            ? 'يُحفظ كمسودة. لا تتغير الأرصدة إلا عند الترحيل من قائمة المستندات.'
                            : 'Saved as a draft. Stock balances change only when you post it from the list.',
                        style: Theme.of(context).textTheme.bodySmall,
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
                    onPressed: saving ? null : closeDraft,
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
              ),
            );
          },
        ),
      );
      await navigator.push(route);
      await route.completed;
    } finally {
      _exitRelay.detach(closeDraft);
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
