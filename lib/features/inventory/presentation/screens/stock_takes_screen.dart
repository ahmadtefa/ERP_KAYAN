import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// «الجرد» - counting a store, and the approval that makes the difference real.
///
/// Three acts, three permissions, and the screen keeps them apart on purpose:
/// a session is opened (which freezes what the system believes right now), the
/// shelves are counted, and somebody *else* signs the difference. Posting turns
/// the signed difference into one adjustment document and its journal entry.
///
/// The freeze is why a receipt posted mid-count cannot quietly move the target:
/// the figures compared against are the ones written when the doors were shut.
class StockTakesScreen extends ConsumerStatefulWidget {
  const StockTakesScreen({super.key});

  @override
  ConsumerState<StockTakesScreen> createState() => _StockTakesScreenState();
}

class _StockTakesScreenState extends ConsumerState<StockTakesScreen> {
  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  @override
  Widget build(BuildContext context) {
    return ModuleScaffold(
      title: _t('الجرد', 'Stock takes'),
      subtitle: _t(
        'عدّ المخزون على الطبيعة، والفروق لا تصبح حركة إلا بعد اعتمادها من شخص آخر.',
        'Count what is on the shelves. A difference becomes a movement only after somebody else approves it.',
      ),
      body: const _StockTakeBody(),
    );
  }
}

String _statusLabel(String status, bool arabic) {
  switch (status) {
    case 'COUNTING':
      return arabic ? 'جارٍ العد' : 'Counting';
    case 'REVIEW':
      return arabic ? 'مراجعة' : 'In review';
    case 'APPROVED':
      return arabic ? 'معتمد' : 'Approved';
    case 'POSTED':
      return arabic ? 'مُرحّل' : 'Posted';
    case 'CANCELLED':
      return arabic ? 'ملغي' : 'Cancelled';
    default:
      return status;
  }
}

AppTone _statusTone(String status) {
  switch (status) {
    case 'POSTED':
      return AppTone.success;
    case 'APPROVED':
      return AppTone.info;
    case 'CANCELLED':
      return AppTone.neutral;
    case 'REVIEW':
      return AppTone.warning;
    default:
      return AppTone.neutral;
  }
}

class _StockTakeBody extends ConsumerStatefulWidget {
  const _StockTakeBody();

  @override
  ConsumerState<_StockTakeBody> createState() => _StockTakeBodyState();
}

class _StockTakeBodyState extends ConsumerState<_StockTakeBody> {
  List<Json> _warehouses = const [];
  List<Json> _sessions = const [];
  Json? _open;
  String _status = '';
  String? _warehouseId;
  String _query = '';
  bool _loading = true;
  bool _busy = false;
  String? _error;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  bool _can(String permission) =>
      ref.read(currentUserProvider)?.can(permission) ?? false;

  String get _userId => ref.read(currentUserProvider)?.id ?? '';

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    final client = ref.read(apiClientProvider);
    try {
      final warehouses = await client.getList('/inventory/warehouses');
      if (mounted) setState(() => _warehouses = warehouses);
    } on Failure {
      // A list of warehouses is a filter; the sessions still load without it.
    }
    await _loadSessions();
  }

  Future<void> _loadSessions() async {
    if (mounted) setState(() => _loading = true);
    try {
      final rows = await ref.read(apiClientProvider).getList('/inventory/stock-takes', query: {
        if (_status.isNotEmpty) 'status': _status,
        'warehouseId': ?_warehouseId,
        'pageSize': 200,
      });
      if (!mounted) return;
      setState(() {
        _sessions = rows;
        _error = null;
      });
    } on Failure catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openSession(String id) async {
    setState(() => _busy = true);
    try {
      final data = await ref.read(apiClientProvider).getObject('/inventory/stock-takes/$id');
      if (!mounted) return;
      setState(() => _open = data);
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _closeSession() => setState(() => _open = null);

  Future<void> _start() async {
    if (_warehouses.isEmpty) {
      showMessage(context, _t('لا يوجد مخزن لجرده.', 'There is no warehouse to count.'), error: true);
      return;
    }
    List<Json> items = const [];
    try {
      items = await ref
          .read(apiClientProvider)
          .getList('/inventory/items', query: {'pageSize': 500});
    } on Failure {
      // A partial count needs a list of items; a full count does not.
    }
    if (!mounted) return;

    var warehouseId = text(_warehouses.first, 'id');
    var scope = 'FULL';
    var selected = <String>{};
    final notesController = TextEditingController();

    final draft = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: Text(_t('جرد جديد', 'New stock take')),
          content: SizedBox(
            width: 520,
            height: 460,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                DropdownButtonFormField<String>(
                  initialValue: warehouseId,
                  decoration: InputDecoration(
                    labelText: _t('المخزن', 'Warehouse'),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  items: [
                    for (final warehouse in _warehouses)
                      DropdownMenuItem(
                        value: text(warehouse, 'id'),
                        child: Text(
                          '${text(warehouse, 'code')} — ${_arabic ? text(warehouse, 'nameAr') : text(warehouse, 'nameEn')}',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                  onChanged: (value) => setDialogState(() => warehouseId = value ?? warehouseId),
                ),
                const SizedBox(height: AppSpacing.sm),
                SegmentedButton<String>(
                  segments: [
                    ButtonSegment(value: 'FULL', label: Text(_t('كامل', 'Full'))),
                    ButtonSegment(value: 'PARTIAL', label: Text(_t('جزئي', 'Partial'))),
                  ],
                  selected: {scope},
                  onSelectionChanged: (value) => setDialogState(() => scope = value.first),
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  _t(
                    'الجرد الكامل يجمّد كل ما في المخزن. الجزئي يُجمّد الأصناف المختارة فقط.',
                    'A full count freezes everything in the warehouse; a partial one freezes only the items you choose.',
                  ),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                if (scope == 'PARTIAL') ...[
                  const SizedBox(height: AppSpacing.sm),
                  Expanded(
                    child: items.isEmpty
                        ? Text(
                            _t(
                              'لا توجد أصناف يمكن اختيارها.',
                              'There are no items to choose from.',
                            ),
                          )
                        : ListView.builder(
                            itemCount: items.length,
                            itemBuilder: (context, index) {
                              final item = items[index];
                              final id = text(item, 'id');
                              return CheckboxListTile(
                                dense: true,
                                value: selected.contains(id),
                                title: Text(
                                  '${text(item, 'code')} — ${_arabic ? text(item, 'nameAr') : text(item, 'nameEn')}',
                                  overflow: TextOverflow.ellipsis,
                                ),
                                onChanged: (value) => setDialogState(() {
                                  if (value == true) {
                                    selected.add(id);
                                  } else {
                                    selected.remove(id);
                                  }
                                }),
                              );
                            },
                          ),
                  ),
                ] else
                  const Spacer(),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: notesController,
                  decoration: InputDecoration(
                    labelText: _t('ملاحظات', 'Notes'),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: Text(_t('إلغاء', 'Cancel')),
            ),
            FilledButton(
              key: const ValueKey('stock-take-start'),
              onPressed: () {
                if (scope == 'PARTIAL' && selected.isEmpty) {
                  showMessage(
                    dialogContext,
                    _t(
                      'اختر صنفًا واحدًا على الأقل للجرد الجزئي.',
                      'Choose at least one item for a partial count.',
                    ),
                    error: true,
                  );
                  return;
                }
                Navigator.of(dialogContext).pop({
                  'warehouseId': warehouseId,
                  'scope': scope,
                  if (scope == 'PARTIAL') 'itemIds': selected.toList(growable: false),
                  if (notesController.text.trim().isNotEmpty)
                    'notes': notesController.text.trim(),
                });
              },
              child: Text(_t('فتح الجرد', 'Open the count')),
            ),
          ],
        ),
      ),
    );
    if (draft == null || !mounted) return;

    await _run(() async {
      final session = await ref.read(apiClientProvider).post('/inventory/stock-takes', body: draft);
      if (!mounted) return;
      showMessage(
        context,
        _t(
          'فُتح الجرد وجُمّدت الكميات. اطبع الأصناف وابدأ العد.',
          'The count is open and the quantities are frozen. Print the list and start counting.',
        ),
      );
      await _loadSessions();
      final id = session['id'];
      if (id is String) await _openSession(id);
    });
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } catch (error) {
      if (mounted) {
        showMessage(context, '${_t('تعذر تنفيذ العملية', 'Action failed')}: $error', error: true);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _counted(List<Map<String, dynamic>> lines, {required bool finish}) async {
    final open = _open;
    if (open == null) return;
    await _run(() async {
      final session = await ref.read(apiClientProvider).post(
        '/inventory/stock-takes/${text(open, 'id')}/count',
        body: {'lines': lines, 'finish': finish},
      );
      if (!mounted) return;
      setState(() => _open = session);
      showMessage(
        context,
        finish
            ? _t('حُفظ العد وأُرسل للمراجعة.', 'The count was saved and sent for review.')
            : _t('حُفظ العد.', 'The count was saved.'),
      );
      await _loadSessions();
    });
  }

  Future<void> _approve() async {
    final open = _open;
    if (open == null) return;
    await _run(() async {
      final session =
          await ref.read(apiClientProvider).post('/inventory/stock-takes/${text(open, 'id')}/approve');
      if (!mounted) return;
      setState(() => _open = session);
      showMessage(context, _t('اعتُمدت الفروق.', 'The difference was approved.'));
      await _loadSessions();
    });
  }

  Future<void> _post() async {
    final open = _open;
    if (open == null) return;
    await _run(() async {
      final session =
          await ref.read(apiClientProvider).post('/inventory/stock-takes/${text(open, 'id')}/post');
      if (!mounted) return;
      setState(() => _open = session);
      showMessage(
        context,
        _t(
          'رُحّل الجرد: مستند تسوية وقيد محاسبي.',
          'The count was posted: one adjustment document and its journal entry.',
        ),
      );
      await _loadSessions();
    });
  }

  Future<void> _cancel() async {
    final open = _open;
    if (open == null) return;
    final reasonController = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_t('إلغاء الجرد', 'Cancel the count')),
        content: TextField(
          controller: reasonController,
          decoration: InputDecoration(
            labelText: _t('السبب (يُسجَّل)', 'Reason (recorded)'),
            border: const OutlineInputBorder(),
            isDense: true,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(_t('رجوع', 'Back')),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(reasonController.text.trim()),
            child: Text(_t('إلغاء الجرد', 'Cancel the count')),
          ),
        ],
      ),
    );
    if (reason == null || !mounted) return;
    await _run(() async {
      final session = await ref.read(apiClientProvider).post(
        '/inventory/stock-takes/${text(open, 'id')}/cancel',
        body: {if (reason.isNotEmpty) 'reason': reason},
      );
      if (!mounted) return;
      setState(() => _open = session);
      await _loadSessions();
    });
  }

  String _warehouseLabel(Json row) {
    final ar = text(row, 'warehouseNameAr');
    final en = text(row, 'warehouseNameEn');
    final code = text(row, 'warehouseCode');
    final name = _arabic ? (ar.isEmpty ? en : ar) : (en.isEmpty ? ar : en);
    if (code.isEmpty && name.isEmpty) return '—';
    return code.isEmpty ? name : '$code — $name';
  }

  List<Json> _filter(List<Json> rows) {
    final needle = _query.toLowerCase();
    if (needle.isEmpty) return rows;
    return rows.where((row) {
      final haystack = [
        text(row, 'code'),
        _warehouseLabel(row),
        text(row, 'status'),
      ].join(' ').toLowerCase();
      return haystack.contains(needle);
    }).toList(growable: false);
  }

  @override
  Widget build(BuildContext context) {
    final open = _open;
    if (open != null) return _detail(open);
    return _list();
  }

  Widget _list() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.sm,
          ),
          child: Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              SizedBox(
                width: 200,
                child: DropdownButtonFormField<String>(
                  initialValue: _status,
                  decoration: InputDecoration(
                    labelText: _t('الحالة', 'Status'),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  items: [
                    DropdownMenuItem(value: '', child: Text(_t('الكل', 'All'))),
                    for (final value in const ['COUNTING', 'REVIEW', 'APPROVED', 'POSTED', 'CANCELLED'])
                      DropdownMenuItem(value: value, child: Text(_statusLabel(value, _arabic))),
                  ],
                  onChanged: (value) {
                    setState(() => _status = value ?? '');
                    _loadSessions();
                  },
                ),
              ),
              SizedBox(
                width: 240,
                child: DropdownButtonFormField<String>(
                  initialValue: _warehouseId ?? '',
                  decoration: InputDecoration(
                    labelText: _t('المخزن', 'Warehouse'),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  items: [
                    DropdownMenuItem(value: '', child: Text(_t('كل المخازن', 'All warehouses'))),
                    for (final warehouse in _warehouses)
                      DropdownMenuItem(
                        value: text(warehouse, 'id'),
                        child: Text(text(warehouse, 'code')),
                      ),
                  ],
                  onChanged: (value) {
                    setState(() => _warehouseId = (value == null || value.isEmpty) ? null : value);
                    _loadSessions();
                  },
                ),
              ),
              SearchField(
                hint: _t('ابحث برقم الجرد', 'Search by count number'),
                onChanged: (value) => setState(() => _query = value.trim()),
              ),
              IconButton(
                tooltip: _t('تحديث', 'Refresh'),
                onPressed: _loadSessions,
                icon: const Icon(Icons.refresh),
              ),
              if (_can('inventory.stocktake.create'))
                FilledButton.icon(
                  key: const ValueKey('stock-take-new'),
                  onPressed: _busy ? null : _start,
                  icon: const Icon(Icons.playlist_add_check, size: 18),
                  label: Text(_t('جرد جديد', 'New count')),
                ),
              if (_busy)
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : Builder(
                  builder: (context) {
                    final rows = _filter(_sessions);
                    if (rows.isEmpty) {
                      return Center(
                        child: Text(
                          _t(
                            'لا توجد جلسات جرد. ابدأ جردًا ليجمّد البرنامج الكميات الحالية ويُقارن بها العد.',
                            'No counts yet. Start one so the program freezes today’s quantities to compare against.',
                          ),
                        ),
                      );
                    }
                    return RecordsTable(
                      rows: rows,
                      onTap: (row) => _openSession(text(row, 'id')),
                      columns: [
                        ColumnSpec(
                          _t('رقم الجرد', 'Count'),
                          value: (row) => text(row, 'code'),
                        ),
                        ColumnSpec(
                          _t('المخزن', 'Warehouse'),
                          flex: 2,
                          value: _warehouseLabel,
                        ),
                        ColumnSpec(
                          _t('النوع', 'Scope'),
                          value: (row) => text(row, 'scope') == 'PARTIAL'
                              ? _t('جزئي', 'Partial')
                              : _t('كامل', 'Full'),
                        ),
                        ColumnSpec(
                          _t('الحالة', 'Status'),
                          value: (row) => _statusLabel(text(row, 'status'), _arabic),
                          tone: (row) => _statusTone(text(row, 'status')),
                        ),
                        ColumnSpec(
                          _t('الأصناف', 'Lines'),
                          numeric: true,
                          value: (row) => text(row, 'lineCount', fallback: '—'),
                        ),
                        ColumnSpec(
                          _t('التاريخ', 'Opened'),
                          value: (row) => text(row, 'createdAt').isEmpty
                              ? '—'
                              : text(row, 'createdAt').split('T').first,
                        ),
                      ],
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _detail(Json session) {
    final status = text(session, 'status');
    final lines = listOf(session['lines']);
    final createdBy = text(session, 'createdBy');
    final startedByMe = createdBy.isNotEmpty && createdBy == _userId;
    final canApprove = _can('inventory.stocktake.approve');
    final canPost = _can('inventory.stocktake.post');
    final canCount = _can('inventory.stocktake.count');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.sm,
          ),
          child: Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              TextButton.icon(
                onPressed: _closeSession,
                icon: const Icon(Icons.arrow_back, size: 18),
                label: Text(_t('كل الجلسات', 'All counts')),
              ),
              Chip(label: Text('${text(session, 'code')} · ${_warehouseLabel(session)}')),
              Chip(
                label: Text(_statusLabel(status, _arabic)),
                backgroundColor: _statusTone(status).background,
              ),
              Chip(
                label: Text(
                  _t(
                    'جُمّد في ${text(session, 'frozenAt').isEmpty ? '—' : text(session, 'frozenAt').split('T').first}',
                    'Frozen ${text(session, 'frozenAt').isEmpty ? '—' : text(session, 'frozenAt').split('T').first}',
                  ),
                ),
              ),
              Chip(
                label: Text(
                  _t(
                    'فروق: ${text(session, 'varianceCount', fallback: '0')} بقيمة ${text(session, 'varianceValue', fallback: '0.0000')}',
                    'Differences: ${text(session, 'varianceCount', fallback: '0')} worth ${text(session, 'varianceValue', fallback: '0.0000')}',
                  ),
                ),
              ),
              if (canApprove && (status == 'COUNTING' || status == 'REVIEW'))
                FilledButton.icon(
                  key: const ValueKey('stock-take-approve'),
                  onPressed: _busy || startedByMe ? null : _approve,
                  icon: const Icon(Icons.verified_outlined, size: 18),
                  label: Text(
                    startedByMe
                        ? _t('يعتمده شخص آخر', 'Somebody else must approve')
                        : _t('اعتماد الفروق', 'Approve the difference'),
                  ),
                ),
              if (canPost && status == 'APPROVED')
                FilledButton.icon(
                  key: const ValueKey('stock-take-post'),
                  onPressed: _busy ? null : _post,
                  icon: const Icon(Icons.post_add, size: 18),
                  label: Text(_t('ترحيل التسوية', 'Post the adjustment')),
                ),
              if (_can('inventory.stocktake.create') &&
                  (status == 'COUNTING' || status == 'REVIEW'))
                OutlinedButton.icon(
                  onPressed: _busy ? null : _cancel,
                  icon: const Icon(Icons.cancel_outlined, size: 18),
                  label: Text(_t('إلغاء الجرد', 'Cancel')),
                ),
              if (_busy)
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
        ),
        if (startedByMe && (status == 'COUNTING' || status == 'REVIEW'))
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Text(
              _t(
                'أنت من فتح هذا الجرد، فلا يمكنك اعتماد فروقه. سلّمه لمن يراجع المخزون.',
                'You opened this count, so you cannot approve its difference. Hand it to whoever reviews the stock.',
              ),
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        if (status == 'POSTED')
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Text(
              _t(
                'مُرحّل: مستند التسوية ${text(session, 'documentId').isEmpty ? '—' : text(session, 'documentId')}',
                'Posted: adjustment document ${text(session, 'documentId').isEmpty ? '—' : text(session, 'documentId')}',
              ),
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        const SizedBox(height: AppSpacing.sm),
        Expanded(
          child: lines.isEmpty
              ? Center(child: Text(_t('لا توجد أسطر في هذا الجرد.', 'This count has no lines.')))
              : _CountPanel(
                  session: session,
                  lines: lines,
                  editable: canCount && (status == 'COUNTING' || status == 'REVIEW'),
                  onSave: _counted,
                ),
        ),
      ],
    );
  }
}

/// The lines of a count, with a box for the counted quantity beside the figure
/// the program froze. Typing only what differs is the normal case: a shop with
/// four hundred lines and three discrepancies should not have to re-enter the
/// other three hundred and ninety-seven.
class _CountPanel extends StatefulWidget {
  const _CountPanel({
    required this.session,
    required this.lines,
    required this.editable,
    required this.onSave,
  });

  final Json session;
  final List<Json> lines;
  final bool editable;
  final Future<void> Function(List<Map<String, dynamic>> lines, {required bool finish}) onSave;

  @override
  State<_CountPanel> createState() => _CountPanelState();
}

class _CountPanelState extends State<_CountPanel> {
  final Map<String, String> _entries = {};

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  @override
  void initState() {
    super.initState();
    for (final line in widget.lines) {
      final counted = text(line, 'countedQuantity');
      if (counted.isNotEmpty) _entries[text(line, 'id')] = counted;
    }
  }

  Future<void> _save({required bool finish}) async {
    final payload = <Map<String, dynamic>>[];
    for (final line in widget.lines) {
      final value = _entries[text(line, 'id')];
      if (value == null || value.trim().isEmpty) continue;
      final parsed = double.tryParse(value.trim());
      if (parsed == null) {
        showMessage(
          context,
          _t('الكمية المعدودة رقم: ${text(line, 'itemCode')}', 'The counted quantity is a number: ${text(line, 'itemCode')}'),
          error: true,
        );
        return;
      }
      payload.add({
        'lineId': text(line, 'id'),
        'countedQuantity': parsed,
      });
    }
    if (payload.isEmpty) {
      showMessage(context, _t('لم تُدخل أي كمية معدودة.', 'No counted quantity was entered.'), error: true);
      return;
    }
    await widget.onSave(payload, finish: finish);
    if (!mounted) return;
    if (finish) setState(() => _entries.clear());
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.editable)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Wrap(
              spacing: AppSpacing.sm,
              children: [
                FilledButton.tonalIcon(
                  key: const ValueKey('stock-take-save'),
                  onPressed: () => _save(finish: false),
                  icon: const Icon(Icons.save_outlined, size: 18),
                  label: Text(_t('حفظ العد', 'Save the count')),
                ),
                FilledButton.icon(
                  key: const ValueKey('stock-take-finish'),
                  onPressed: () => _save(finish: true),
                  icon: const Icon(Icons.done_all, size: 18),
                  label: Text(_t('إنهاء العد وإرساله للمراجعة', 'Finish and send for review')),
                ),
              ],
            ),
          ),
        const SizedBox(height: AppSpacing.sm),
        Expanded(
          child: RecordsTable(
            rows: widget.lines,
            columns: [
              ColumnSpec(
                _t('الصنف', 'Item'),
                flex: 3,
                value: (row) =>
                    '${text(row, 'itemCode')} — ${_arabic ? text(row, 'itemNameAr') : text(row, 'itemNameEn')}',
              ),
              ColumnSpec(
                _t('الدفعة', 'Lot'),
                value: (row) => text(row, 'batchNumber', fallback: '—'),
              ),
              ColumnSpec(
                _t('كمية النظام', 'System'),
                numeric: true,
                value: (row) => text(row, 'systemQuantity'),
              ),
              ColumnSpec(
                _t('العدّ', 'Counted'),
                numeric: true,
                value: (row) {
                  final value = _entries[text(row, 'id')];
                  if (value != null) return value;
                  final counted = text(row, 'countedQuantity');
                  return counted.isEmpty ? '—' : counted;
                },
              ),
              ColumnSpec(
                _t('الفرق', 'Variance'),
                numeric: true,
                emphasise: true,
                value: (row) => text(row, 'varianceQuantity'),
                tone: (row) {
                  final variance = double.tryParse(text(row, 'varianceQuantity', fallback: '0')) ?? 0;
                  if (variance == 0) return AppTone.neutral;
                  return variance < 0 ? AppTone.danger : AppTone.warning;
                },
              ),
              ColumnSpec(
                _t('قيمة الفرق', 'Value'),
                numeric: true,
                value: (row) => text(row, 'varianceValue'),
              ),
            ],
            actions: widget.editable
                ? (row) => [
                    SizedBox(
                      width: 120,
                      child: TextFormField(
                        initialValue: _entries[text(row, 'id')] ?? text(row, 'countedQuantity'),
                        key: ValueKey('count-${text(row, 'id')}'),
                        keyboardType: const TextInputType.numberWithOptions(decimal: true),
                        decoration: InputDecoration(
                          hintText: _t('العدد', 'Count'),
                          border: const OutlineInputBorder(),
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.sm,
                            vertical: AppSpacing.xs,
                          ),
                        ),
                        onChanged: (value) => _entries[text(row, 'id')] = value,
                      ),
                    ),
                  ]
                : null,
          ),
        ),
      ],
    );
  }
}
