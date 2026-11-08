import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/network/api_client.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// Counting a warehouse, and the approval that turns a difference into a loss.
///
/// The backend models this as a session: it is opened, counted, approved by
/// somebody other than the person who opened it, and only then posted - which
/// is when stock and the ledger actually move. Each of those steps is a
/// different permission, so this screen shows only the step the caller is
/// allowed to take, and greys out the rest rather than offering a button that
/// can only fail.
final stockTakesProvider =
    AsyncNotifierProvider<StockTakesController, List<Json>>(
      StockTakesController.new,
    );

class StockTakesController extends JsonListController {
  @override
  String get resourcePath => '/inventory/stock-takes';
}

class StockTakesScreen extends ConsumerStatefulWidget {
  const StockTakesScreen({super.key});

  @override
  ConsumerState<StockTakesScreen> createState() => _StockTakesScreenState();
}

class _StockTakesScreenState extends ConsumerState<StockTakesScreen> {
  String _query = '';
  bool _starting = false;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String _statusLabel(String status) {
    final arabic = _arabic;
    return switch (status.toUpperCase()) {
      'DRAFT' => arabic ? 'مسودة' : 'Draft',
      'COUNTING' => arabic ? 'جارٍ العد' : 'Counting',
      'REVIEW' => arabic ? 'قيد المراجعة' : 'In review',
      'APPROVED' => arabic ? 'معتمد' : 'Approved',
      'POSTED' => arabic ? 'مُرحَّل' : 'Posted',
      'CANCELLED' => arabic ? 'ملغى' : 'Cancelled',
      _ => status,
    };
  }

  AppTone _statusTone(String status) {
    return switch (status.toUpperCase()) {
      'APPROVED' => AppTone.success,
      'POSTED' => AppTone.info,
      'CANCELLED' => AppTone.neutral,
      'REVIEW' => AppTone.warning,
      _ => AppTone.neutral,
    };
  }

  String _warehouseName(Json row) {
    return _arabic
        ? (asString(row['warehouseNameAr']) ?? '')
        : (asString(row['warehouseNameEn']) ?? '');
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(stockTakesProvider);
    final user = ref.watch(currentUserProvider);
    final canApprove = user?.can('inventory.stocktake.approve') ?? false;
    final canPost = user?.can('inventory.stocktake.post') ?? false;
    final canCreate = user?.can('inventory.stocktake.create') ?? false;

    return ModuleScaffold(
      title: _arabic ? 'الجرد' : 'Stock takes',
      eyebrow: _arabic ? 'المخزون' : 'Inventory',
      trailing: Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          SearchField(
            hint: _arabic ? 'بحث في الجرد' : 'Search counts',
            onChanged: (value) => setState(() => _query = value.trim()),
          ),
          IconButton(
            tooltip: _arabic ? 'تحديث' : 'Refresh',
            onPressed: () => ref.read(stockTakesProvider.notifier).reload(),
            icon: const Icon(Icons.refresh),
          ),
          if (canCreate)
            FilledButton.icon(
              key: const ValueKey('stock-take-new'),
              onPressed: _starting ? null : _start,
              icon: const Icon(Icons.playlist_add_check),
              label: Text(_arabic ? 'جرد جديد' : 'New count'),
            ),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(stockTakesProvider.notifier).reload(),
        isEmpty: (rows) => _visible(rows).isEmpty,
        emptyMessage: _arabic
            ? 'لا توجد عمليات جرد بعد.'
            : 'No stock takes yet.',
        data: (rows) => RecordsTable(
          rows: _visible(rows),
          columns: [
            ColumnSpec(
              _arabic ? 'الكود' : 'Code',
              value: (r) => text(r, 'code'),
              emphasise: true,
            ),
            ColumnSpec(
              _arabic ? 'المستودع' : 'Warehouse',
              value: _warehouseName,
            ),
            ColumnSpec(
              _arabic ? 'النطاق' : 'Scope',
              value: (r) => text(r, 'scope') == 'FULL'
                  ? (_arabic ? 'كامل' : 'Full')
                  : (_arabic ? 'جزئي' : 'Partial'),
            ),
            ColumnSpec(
              _arabic ? 'البنود' : 'Lines',
              numeric: true,
              value: (r) => r['lineCount'] == null
                  ? '—'
                  : asString(r['lineCount'])!,
            ),
            ColumnSpec(
              _arabic ? 'تاريخ الفتح' : 'Opened',
              value: (r) => asString(r['createdAt'])?.split('T').first ?? '—',
            ),
            ColumnSpec(
              l10n.status,
              value: (r) => _statusLabel(text(r, 'status')),
              tone: (r) => _statusTone(text(r, 'status')),
            ),
          ],
          onTap: (row) => _openSession(row),
          actions: (row) => _actions(row, canApprove, canPost),
        ),
      ),
    );
  }


  Future<void> _start() async {
    if (_starting) return;
    setState(() => _starting = true);
    try {
      final client = ref.read(apiClientProvider);
      final warehouses = await client.getList('/inventory/warehouses');
      if (!mounted) return;
      if (warehouses.isEmpty) {
        showMessage(context, _arabic ? 'لا توجد مستودعات نشطة.' : 'No active warehouses are available.', error: true);
        return;
      }
      List<Json> items = const [];
      try {
        items = await client.getList('/inventory/items', query: const {'pageSize': 500});
      } catch (_) {
        // Full counts do not need the item catalogue.
      }
      if (!mounted) return;
      var warehouseId = text(warehouses.first, 'id');
      var scope = 'FULL';
      final selected = <String>{};
      final notes = TextEditingController();
      final draft = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            title: Text(_arabic ? 'فتح جرد جديد' : 'Open a new stock take'),
            content: SizedBox(
              width: 560,
              height: 440,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: warehouseId,
                    decoration: InputDecoration(labelText: _arabic ? 'المستودع' : 'Warehouse'),
                    items: [
                      for (final warehouse in warehouses)
                        DropdownMenuItem(
                          value: text(warehouse, 'id'),
                          child: Text('${text(warehouse, 'code')} — ${_arabic ? text(warehouse, 'nameAr', fallback: text(warehouse, 'nameEn')) : text(warehouse, 'nameEn', fallback: text(warehouse, 'nameAr'))}'),
                        ),
                    ],
                    onChanged: (value) => setDialogState(() => warehouseId = value ?? warehouseId),
                  ),
                  const SizedBox(height: 12),
                  SegmentedButton<String>(
                    segments: [
                      ButtonSegment(value: 'FULL', label: Text(_arabic ? 'كامل' : 'Full')),
                      ButtonSegment(value: 'PARTIAL', label: Text(_arabic ? 'جزئي' : 'Partial')),
                    ],
                    selected: {scope},
                    onSelectionChanged: (values) => setDialogState(() => scope = values.first),
                  ),
                  const SizedBox(height: 8),
                  if (scope == 'PARTIAL')
                    Expanded(
                      child: items.isEmpty
                          ? Center(child: Text(_arabic ? 'تعذر تحميل الأصناف.' : 'No items could be loaded.'))
                          : ListView.builder(
                              itemCount: items.length,
                              itemBuilder: (context, index) {
                                final item = items[index];
                                final id = text(item, 'id');
                                return CheckboxListTile(
                                  dense: true,
                                  value: selected.contains(id),
                                  title: Text('${text(item, 'code')} — ${_arabic ? text(item, 'nameAr', fallback: text(item, 'nameEn')) : text(item, 'nameEn', fallback: text(item, 'nameAr'))}'),
                                  onChanged: (value) => setDialogState(() {
                                    if (value == true) { selected.add(id); } else { selected.remove(id); }
                                  }),
                                );
                              },
                            ),
                    )
                  else
                    const Spacer(),
                  TextField(
                    controller: notes,
                    decoration: InputDecoration(labelText: _arabic ? 'ملاحظات' : 'Notes'),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(dialogContext), child: Text(_arabic ? 'إلغاء' : 'Cancel')),
              FilledButton(
                onPressed: scope == 'PARTIAL' && selected.isEmpty ? null : () => Navigator.pop(dialogContext, {
                  'warehouseId': warehouseId,
                  'scope': scope,
                  if (scope == 'PARTIAL') 'itemIds': selected.toList(),
                  if (notes.text.trim().isNotEmpty) 'notes': notes.text.trim(),
                }),
                child: Text(_arabic ? 'فتح الجرد' : 'Open count'),
              ),
            ],
          ),
        ),
      );
      notes.dispose();
      if (draft == null || !mounted) return;
      final created = await client.post('/inventory/stock-takes', body: draft);
      await ref.read(stockTakesProvider.notifier).refreshQuietly();
      if (!mounted) return;
      showMessage(context, _arabic ? 'تم فتح الجرد وتجميد أرصدة النظام.' : 'Count opened; system quantities are frozen.');
      if (created['id'] is String) await _openSession({'id': created['id']});
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  Future<void> _openSession(Json row) async {
    final id = text(row, 'id');
    if (id.isEmpty) return;
    try {
      final session = await ref.read(apiClientProvider).getObject('/inventory/stock-takes/$id');
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => _StockTakeDetailDialog(
          session: session,
          arabic: _arabic,
          userId: ref.read(currentUserProvider)?.id ?? '',
          canCount: ref.read(currentUserProvider)?.can('inventory.stocktake.count') ?? false,
          canApprove: ref.read(currentUserProvider)?.can('inventory.stocktake.approve') ?? false,
          canPost: ref.read(currentUserProvider)?.can('inventory.stocktake.post') ?? false,
          api: ref.read(apiClientProvider),
          onChanged: () => ref.read(stockTakesProvider.notifier).refreshQuietly(),
        ),
      );
      if (mounted) await ref.read(stockTakesProvider.notifier).refreshQuietly();
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
    }
  }

  /// Only the steps the backend would accept, and only for the caller's grant.
  ///
  /// Approving is refused server-side when the same person opened the count,
  /// so the button is offered disabled with the reason on it instead of letting
  /// someone click through to an error.
  List<Widget> _actions(Json row, bool canApprove, bool canPost) {
    final status = text(row, 'status').toUpperCase();
    final openedByMe =
        text(row, 'createdBy') == ref.read(currentUserProvider)?.id;
    final actions = <Widget>[];

    if (canApprove && (status == 'COUNTING' || status == 'REVIEW')) {
      if (openedByMe) {
        actions.add(
          Tooltip(
            message: _arabic
                ? 'فتحت هذا الجرد، فلا يمكنك اعتماده'
                : 'You opened this count, so you cannot approve it',
            child: const IconButton(
              icon: Icon(Icons.verified_outlined),
              onPressed: null,
            ),
          ),
        );
      } else {
        actions.add(
          IconButton(
            tooltip: _arabic ? 'اعتماد' : 'Approve',
            icon: const Icon(Icons.verified_outlined),
            onPressed: () => _approve(row),
          ),
        );
      }
    }

    if (canPost && status == 'APPROVED') {
      actions.add(
        IconButton(
          tooltip: _arabic ? 'ترحيل' : 'Post',
          icon: const Icon(Icons.play_arrow_outlined),
          onPressed: () => _post(row),
        ),
      );
    }

    return actions;
  }

  Future<void> _approve(Json row) async {
    final confirmed = await confirmAction(
      context,
      title: _arabic ? 'اعتماد الجرد' : 'Approve the count',
      message: _arabic
          ? 'سيُعتمد الفرق في الجرد «${text(row, 'code')}». الاعتماد لا يحرّك الأرصدة بعد؛ الترحيل هو الذي يحرّكها.'
          : 'The differences in "${text(row, 'code')}" will be approved. '
                'Approving does not move stock yet; posting does.',
      confirmLabel: _arabic ? 'اعتماد' : 'Approve',
    );
    if (!confirmed || !mounted) return;
    await _send('/inventory/stock-takes/${text(row, 'id')}/approve');
  }

  Future<void> _post(Json row) async {
    final confirmed = await confirmAction(
      context,
      title: _arabic ? 'ترحيل الجرد' : 'Post the count',
      message: _arabic
          ? 'سيُرحَّل الجرد «${text(row, 'code')}» وتتحرك الأرصدة والقيود. لا يمكن التراجع.'
          : 'The count "${text(row, 'code')}" will be posted and stock and the '
                'ledger will move. This cannot be undone.',
      confirmLabel: _arabic ? 'ترحيل' : 'Post',
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    await _send('/inventory/stock-takes/${text(row, 'id')}/post');
  }

  Future<void> _send(String path) async {
    try {
      await ref.read(apiClientProvider).post(path);
      await ref.read(stockTakesProvider.notifier).refreshQuietly();
      if (!mounted) return;
      showMessage(context, _arabic ? 'تم' : 'Done');
    } catch (error) {
      if (!mounted) return;
      showMessage(context, error, error: true);
    }
  }

  List<Json> _visible(List<Json> rows) {
    if (_query.isEmpty) return rows;
    final needle = _query.toLowerCase();
    return rows
        .where(
          (row) =>
              text(row, 'code').toLowerCase().contains(needle) ||
              _warehouseName(row).toLowerCase().contains(needle),
        )
        .toList(growable: false);
  }
}


class _StockTakeDetailDialog extends StatefulWidget {
  const _StockTakeDetailDialog({
    required this.session,
    required this.arabic,
    required this.userId,
    required this.canCount,
    required this.canApprove,
    required this.canPost,
    required this.api,
    required this.onChanged,
  });

  final Json session;
  final bool arabic;
  final String userId;
  final bool canCount;
  final bool canApprove;
  final bool canPost;
  final ApiClient api;
  final Future<void> Function() onChanged;

  @override
  State<_StockTakeDetailDialog> createState() => _StockTakeDetailDialogState();
}

class _StockTakeDetailDialogState extends State<_StockTakeDetailDialog> {
  late Json _session;
  final Map<String, String> _counts = {};
  bool _busy = false;

  bool get _ar => widget.arabic;
  String _t(String ar, String en) => _ar ? ar : en;

  @override
  void initState() {
    super.initState();
    _session = widget.session;
    for (final line in listOf(_session['lines'])) {
      final value = text(line, 'countedQuantity');
      if (value.isNotEmpty) _counts[text(line, 'id')] = value;
    }
  }

  Future<void> _act(String suffix, {Object? body, String? success}) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final result = await widget.api.post('/inventory/stock-takes/${text(_session, 'id')}/$suffix', body: body);
      if (result.isNotEmpty && result.containsKey('lines')) _session = result;
      else _session = await widget.api.getObject('/inventory/stock-takes/${text(_session, 'id')}');
      await widget.onChanged();
      if (mounted) {
        setState(() {});
        if (success != null) showMessage(context, success);
      }
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save({required bool finish}) async {
    final payload = <Map<String, dynamic>>[];
    for (final line in listOf(_session['lines'])) {
      final raw = _counts[text(line, 'id')] ?? text(line, 'countedQuantity');
      if (raw.trim().isEmpty) continue;
      final value = double.tryParse(raw.trim());
      if (value == null || !value.isFinite || value < 0) {
        showMessage(context, _t('أدخل كمية صحيحة غير سالبة للصنف ${text(line, 'itemCode')}.', 'Enter a valid non-negative quantity for ${text(line, 'itemCode') }.'), error: true);
        return;
      }
      payload.add({'lineId': text(line, 'id'), 'countedQuantity': value});
    }
    if (payload.isEmpty) {
      showMessage(context, _t('أدخل كمية معدودة واحدة على الأقل.', 'Enter at least one counted quantity.'), error: true);
      return;
    }
    await _act('count', body: {'lines': payload, 'finish': finish}, success: finish ? _t('تم إنهاء العد وإرساله للمراجعة.', 'Count finished and sent for review.') : _t('تم حفظ العد.', 'Count saved.'));
  }

  @override
  Widget build(BuildContext context) {
    final status = text(_session, 'status').toUpperCase();
    final lines = listOf(_session['lines']);
    final openedByMe = text(_session, 'createdBy') == widget.userId;
    final editable = widget.canCount && (status == 'COUNTING' || status == 'REVIEW');
    return AlertDialog(
      title: Text('${text(_session, 'code')} — ${_t('تفاصيل الجرد', 'Stock take details')}'),
      content: SizedBox(
        width: 1000,
        height: 560,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(spacing: 8, runSpacing: 8, children: [
              Chip(label: Text(_t('المستودع', 'Warehouse') + ': ${_ar ? text(_session, 'warehouseNameAr', fallback: text(_session, 'warehouseNameEn')) : text(_session, 'warehouseNameEn', fallback: text(_session, 'warehouseNameAr'))}')),
              Chip(label: Text(_t('الحالة', 'Status') + ': ${text(_session, 'status')}')),
              Chip(label: Text(_t('البنود', 'Lines') + ': ${lines.length}')),
              Chip(label: Text(_t('الفروق', 'Variances') + ': ${text(_session, 'varianceCount', fallback: '0')}')),
            ]),
            const SizedBox(height: 8),
            Expanded(
              child: lines.isEmpty
                  ? Center(child: Text(_t('لا توجد بنود.', 'No lines.')))
                  : ListView.builder(
                      itemCount: lines.length,
                      itemBuilder: (context, index) {
                        final line = lines[index];
                        final id = text(line, 'id');
                        return Card(
                          child: Padding(
                            padding: const EdgeInsets.all(8),
                            child: Row(children: [
                              Expanded(flex: 4, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text('${text(line, 'itemCode')} — ${_ar ? text(line, 'itemNameAr', fallback: text(line, 'itemNameEn')) : text(line, 'itemNameEn', fallback: text(line, 'itemNameAr'))}', style: Theme.of(context).textTheme.titleSmall),
                                Text('${_t('كمية النظام', 'System')}: ${text(line, 'systemQuantity')}  •  ${_t('الدفعة', 'Batch')}: ${text(line, 'batchNumber', fallback: '—')}'),
                                Text('${_t('الفرق', 'Variance')}: ${text(line, 'varianceQuantity')}  •  ${_t('القيمة', 'Value')}: ${text(line, 'varianceValue')}'),
                              ])),
                              SizedBox(width: 150, child: TextFormField(
                                key: ValueKey('count-$id-${text(line, 'countedQuantity')}'),
                                initialValue: _counts[id] ?? text(line, 'countedQuantity'),
                                enabled: editable && !_busy,
                                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                decoration: InputDecoration(labelText: _t('الكمية المعدودة', 'Counted qty'), isDense: true),
                                onChanged: (value) => _counts[id] = value,
                              )),
                            ]),
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
      actions: [
        if (editable) OutlinedButton(onPressed: _busy ? null : () => _save(finish: false), child: Text(_t('حفظ العد', 'Save count'))),
        if (editable) FilledButton(onPressed: _busy ? null : () => _save(finish: true), child: Text(_t('إنهاء وإرسال للمراجعة', 'Finish & review'))),
        if (widget.canApprove && !openedByMe && (status == 'COUNTING' || status == 'REVIEW'))
          FilledButton.tonal(onPressed: _busy ? null : () => _act('approve', success: _t('تم اعتماد الجرد.', 'Count approved.')), child: Text(_t('اعتماد', 'Approve'))),
        if (widget.canPost && status == 'APPROVED')
          FilledButton(onPressed: _busy ? null : () => _act('post', success: _t('تم ترحيل الجرد.', 'Count posted.')), child: Text(_t('ترحيل', 'Post'))),
        if (_busy) const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
        TextButton(onPressed: _busy ? null : () => Navigator.pop(context), child: Text(_t('إغلاق', 'Close'))),
      ],
    );
  }
}
