import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// «إدارة المخازن» - the shelves inside each branch.
///
/// A branch is a legal place to trade from; a warehouse is a physical place
/// goods sit in. One branch can have a front store and a back store, and the
/// stock report has to be able to say which one the cartons are in - so they
/// are created, renamed, made default and switched off here rather than only
/// existing implicitly.
///
/// Two rules this screen states plainly because the server enforces them:
///
///   * a warehouse that documents name is never deleted, only switched off,
///     so a printed transfer from last year still reads correctly;
///   * a branch keeps exactly one active default, which is where a document
///     lands when it names no warehouse. Moving the default is a deliberate
///     act, and the default cannot simply be switched off.
///
/// What a warehouse holds is the second tab: the same movements the branch
/// balance is built from, grouped by shelf, with the packing breakdown
/// (5 كراتين + 4 عبوات) beside the base quantity.
class WarehousesScreen extends ConsumerStatefulWidget {
  const WarehousesScreen({super.key});

  @override
  ConsumerState<WarehousesScreen> createState() => _WarehousesScreenState();
}

class _WarehousesScreenState extends ConsumerState<WarehousesScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 2, vsync: this);

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String _t(String ar, String en) => _arabic ? ar : en;

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ModuleScaffold(
      title: _t('إدارة المخازن', 'Warehouse management'),
      subtitle: _t(
        'المخازن التي تُحفظ فيها البضاعة داخل كل فرع، وأرصدتها.',
        'The places stock is kept inside each branch, and what they hold.',
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TabBar(
            controller: _tabs,
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [
              Tab(text: _t('المخازن', 'Warehouses')),
              Tab(text: _t('أرصدة المخازن', 'Warehouse balances')),
            ],
          ),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: const [
                _WarehouseListTab(),
                _WarehouseBalanceTab(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────── the list

class _WarehouseListTab extends ConsumerStatefulWidget {
  const _WarehouseListTab();

  @override
  ConsumerState<_WarehouseListTab> createState() => _WarehouseListTabState();
}

class _WarehouseListTabState extends ConsumerState<_WarehouseListTab> {
  Future<List<Json>>? _future;
  List<Json> _branches = const [];
  String _query = '';
  bool _showInactive = true;
  bool _busy = false;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String _t(String ar, String en) => _arabic ? ar : en;

  bool get _canManage =>
      ref.read(currentUserProvider)?.can('inventory.warehouses.manage') ?? false;

  @override
  void initState() {
    super.initState();
    _future = _load();
    _loadBranches();
  }

  Future<List<Json>> _load() async {
    final client = ref.read(apiClientProvider);
    final query = <String, String>{
      if (_showInactive) 'includeInactive': 'true',
    };
    return client.getList('/inventory/warehouses', query: query);
  }

  Future<void> _loadBranches() async {
    try {
      final rows = await ref.read(apiClientProvider).getList('/company/branches');
      if (mounted) setState(() => _branches = rows);
    } catch (_) {
      // Naming the branch is a convenience; a missing list must not stop the
      // warehouses from loading.
      if (mounted) setState(() => _branches = const []);
    }
  }

  void _refresh() {
    setState(() => _future = _load());
  }

  List<Json> _filter(List<Json> rows) {
    final needle = _query.trim().toLowerCase();
    if (needle.isEmpty) return rows;
    return rows.where((row) {
      final haystack = [
        text(row, 'code'),
        text(row, 'nameAr'),
        text(row, 'nameEn'),
        text(row, 'branchNameAr'),
        text(row, 'branchNameEn'),
        text(row, 'branchCode'),
      ].join(' ').toLowerCase();
      return haystack.contains(needle);
    }).toList(growable: false);
  }

  String _branchLabel(Json row) {
    final code = text(row, 'branchCode');
    final name = _arabic
        ? text(row, 'branchNameAr').isEmpty
            ? text(row, 'branchNameEn')
            : text(row, 'branchNameAr')
        : text(row, 'branchNameEn').isEmpty
            ? text(row, 'branchNameAr')
            : text(row, 'branchNameEn');
    if (name.isEmpty && code.isEmpty) return '—';
    return code.isEmpty ? name : '$code — $name';
  }

  String _warehouseLabel(Json row) {
    final ar = text(row, 'nameAr');
    final en = text(row, 'nameEn');
    if (_arabic) return ar.isEmpty ? en : ar;
    return en.isEmpty ? ar : en;
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

  Future<void> _create() async {
    if (_branches.isEmpty) {
      showMessage(
        context,
        _t(
          'لا توجد فروع مسندة إليك، ولا يمكن إنشاء مخزن بدون فرع.',
          'No branch is assigned to you; a warehouse needs one.',
        ),
        error: true,
      );
      return;
    }
    final draft = await _showForm();
    if (draft == null || !mounted) return;
    await _run(() async {
      await ref.read(apiClientProvider).post('/inventory/warehouses', body: draft);
      if (!mounted) return;
      showMessage(context, _t('تم إنشاء المخزن.', 'The warehouse was created.'));
      _refresh();
    });
  }

  Future<void> _edit(Json row) async {
    final draft = await _showForm(existing: row);
    if (draft == null || !mounted) return;
    await _run(() async {
      await ref
          .read(apiClientProvider)
          .patch('/inventory/warehouses/${text(row, 'id')}', body: draft);
      if (!mounted) return;
      showMessage(context, _t('تم تحديث المخزن.', 'The warehouse was updated.'));
      _refresh();
    });
  }

  /// Create/edit form. A code is chosen once and then fixed: documents and
  /// reports are read by it, and renaming is the name fields' job.
  Future<Map<String, dynamic>?> _showForm({Json? existing}) async {
    final isEdit = existing != null;
    final current = existing ?? const <String, dynamic>{};
    final codeController = TextEditingController(text: text(current, 'code'));
    final nameArController = TextEditingController(text: text(current, 'nameAr'));
    final nameEnController = TextEditingController(text: text(current, 'nameEn'));
    final addressController = TextEditingController(text: text(current, 'address'));
    var branchId = text(current, 'branchId').isEmpty
        ? text(_branches.first, 'id')
        : text(current, 'branchId');
    var isDefault = current['isDefault'] == true;
    String? error;

    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: Text(
            isEdit
                ? _t('تعديل مخزن', 'Edit warehouse')
                : _t('مخزن جديد', 'New warehouse'),
          ),
          content: SizedBox(
            width: 460,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: codeController,
                  enabled: !isEdit,
                  decoration: InputDecoration(
                    labelText: _t('كود المخزن', 'Warehouse code'),
                    helperText: isEdit
                        ? _t('الكود ثابت بعد الإنشاء.', 'The code is fixed after creation.')
                        : _t(
                            'حروف وأرقام، مثل WH1 أو MAIN-STORE.',
                            'Letters and digits, such as WH1 or MAIN-STORE.',
                          ),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: nameArController,
                  textDirection: TextDirection.rtl,
                  decoration: InputDecoration(
                    labelText: _t('الاسم (عربي)', 'Name (Arabic)'),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: nameEnController,
                  textDirection: TextDirection.ltr,
                  decoration: InputDecoration(
                    labelText: _t('الاسم (إنجليزي)', 'Name (English)'),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                DropdownButtonFormField<String>(
                  initialValue: _branches.any((branch) => text(branch, 'id') == branchId)
                      ? branchId
                      : null,
                  decoration: InputDecoration(
                    labelText: _t('الفرع', 'Branch'),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                  items: [
                    for (final branch in _branches)
                      DropdownMenuItem(
                        value: text(branch, 'id'),
                        child: Text(
                          '${text(branch, 'code')} — '
                          '${_arabic ? text(branch, 'nameAr') : text(branch, 'nameEn')}',
                        ),
                      ),
                  ],
                  onChanged: (value) {
                    if (value != null) setDialogState(() => branchId = value);
                  },
                ),
                const SizedBox(height: AppSpacing.sm),
                TextField(
                  controller: addressController,
                  decoration: InputDecoration(
                    labelText: _t('العنوان', 'Address'),
                    border: const OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                CheckboxListTile(
                  value: isDefault,
                  onChanged: current['isDefault'] == true
                      ? null
                      : (value) => setDialogState(() => isDefault = value ?? false),
                  dense: true,
                  controlAffinity: ListTileControlAffinity.leading,
                  title: Text(_t('المخزن الافتراضي للفرع', 'Branch default warehouse')),
                  subtitle: Text(
                    _t(
                      'المستند الذي لا يحدد مخزنًا يُسجَّل هنا. لكل فرع مخزن افتراضي واحد.',
                      'A document that names no warehouse is posted here. One default per branch.',
                    ),
                    style: Theme.of(dialogContext).textTheme.bodySmall,
                  ),
                ),
                if (error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: AppSpacing.sm),
                    child: Text(
                      error!,
                      style: TextStyle(
                        color: Theme.of(dialogContext).colorScheme.error,
                      ),
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
              onPressed: () {
                final code = codeController.text.trim();
                final nameAr = nameArController.text.trim();
                final nameEn = nameEnController.text.trim();
                if (!isEdit && code.isEmpty) {
                  setDialogState(
                    () => error = _t('اكتب كود المخزن.', 'Enter the warehouse code.'),
                  );
                  return;
                }
                if (nameAr.isEmpty && nameEn.isEmpty) {
                  setDialogState(
                    () => error = _t(
                      'اكتب اسم المخزن بالعربي أو بالإنجليزي.',
                      'Enter the warehouse name in Arabic or English.',
                    ),
                  );
                  return;
                }
                Navigator.of(dialogContext).pop(<String, dynamic>{
                  if (!isEdit) 'code': code,
                  // Both names are sent: a warehouse printed on an Arabic
                  // document and on an English one should not read as two
                  // different stores.
                  'nameAr': nameAr.isEmpty ? nameEn : nameAr,
                  'nameEn': nameEn.isEmpty ? nameAr : nameEn,
                  'branchId': branchId,
                  'address': addressController.text.trim(),
                  if (isDefault) 'isDefault': true,
                });
              },
              child: Text(_t('حفظ', 'Save')),
            ),
          ],
        ),
      ),
    );

    codeController.dispose();
    nameArController.dispose();
    nameEnController.dispose();
    addressController.dispose();
    return result;
  }

  Future<void> _makeDefault(Json row) async {
    await _run(() async {
      await ref.read(apiClientProvider).patch(
        '/inventory/warehouses/${text(row, 'id')}',
        body: const {'isDefault': true},
      );
      if (!mounted) return;
      showMessage(
        context,
        _t('صار هذا المخزن هو الافتراضي للفرع.', 'This is now the branch default.'),
      );
      _refresh();
    });
  }

  Future<void> _deactivate(Json row) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_t('إيقاف المخزن', 'Switch the warehouse off')),
        content: Text(
          _t(
            'سيُخفى «${_warehouseLabel(row)}» من المستندات الجديدة. '
                'لا يُحذف: المستندات القديمة تظل تسمّيه، ويمكن إعادة تفعيله في أي وقت.',
            '“${_warehouseLabel(row)}” will be hidden from new documents. It is not '
                'deleted: older documents keep naming it, and it can be switched back on.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(_t('إلغاء', 'Cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(_t('إيقاف', 'Switch off')),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _run(() async {
      await ref
          .read(apiClientProvider)
          .post('/inventory/warehouses/${text(row, 'id')}/deactivate');
      if (!mounted) return;
      showMessage(context, _t('تم إيقاف المخزن.', 'The warehouse was switched off.'));
      _refresh();
    });
  }

  Future<void> _reactivate(Json row) async {
    await _run(() async {
      await ref
          .read(apiClientProvider)
          .post('/inventory/warehouses/${text(row, 'id')}/reactivate');
      if (!mounted) return;
      showMessage(context, _t('تم تفعيل المخزن.', 'The warehouse is active again.'));
      _refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
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
              SearchField(
                hint: _t('ابحث بالكود أو الاسم أو الفرع', 'Search code, name or branch'),
                onChanged: (value) => setState(() => _query = value.trim()),
              ),
              FilterChip(
                selected: _showInactive,
                label: Text(_t('إظهار غير النشط', 'Show inactive')),
                onSelected: (value) {
                  setState(() => _showInactive = value);
                  _refresh();
                },
              ),
              IconButton(
                tooltip: _t('تحديث', 'Refresh'),
                onPressed: _refresh,
                icon: const Icon(Icons.refresh),
              ),
              if (_canManage)
                FilledButton.icon(
                  key: const ValueKey('warehouse-create'),
                  onPressed: _busy ? null : _create,
                  icon: const Icon(Icons.add, size: 18),
                  label: Text(_t('مخزن جديد', 'New warehouse')),
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
                    final rows = _filter(snapshot.data ?? const <Json>[]);
                    if (rows.isEmpty) {
                      return Center(
                        child: Text(
                          _t(
                            'لا توجد مخازن بعد. لكل فرع مخزن افتراضي يُنشأ تلقائيًا عند أول حركة.',
                            'No warehouses yet. Each branch gets a default one on its first posting.',
                          ),
                        ),
                      );
                    }
                    return ListView.separated(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                      itemCount: rows.length,
                      separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.sm),
                      itemBuilder: (context, index) => _card(rows[index]),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _card(Json row) {
    final active = row['isActive'] != false;
    final isDefault = row['isDefault'] == true;
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        _warehouseLabel(row),
                        style: theme.textTheme.titleSmall,
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      Text(
                        text(row, 'code'),
                        style: theme.textTheme.bodySmall,
                      ),
                      if (isDefault) ...[
                        const SizedBox(width: AppSpacing.sm),
                        _badge(
                          _t('افتراضي', 'Default'),
                          theme.colorScheme.primaryContainer,
                        ),
                      ],
                      const SizedBox(width: AppSpacing.sm),
                      _badge(
                        active ? _t('نشط', 'Active') : _t('موقوف', 'Inactive'),
                        active
                            ? theme.colorScheme.secondaryContainer
                            : theme.colorScheme.surfaceContainerLow,
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    _branchLabel(row),
                    style: theme.textTheme.bodySmall,
                  ),
                  if (text(row, 'address').isNotEmpty)
                    Text(
                      text(row, 'address'),
                      style: theme.textTheme.bodySmall,
                    ),
                ],
              ),
            ),
            Wrap(
              spacing: AppSpacing.xs,
              children: [
                if (_canManage && !isDefault && active)
                  TextButton.icon(
                    onPressed: _busy ? null : () => _makeDefault(row),
                    icon: const Icon(Icons.star_outline, size: 18),
                    label: Text(_t('اجعل افتراضيًا', 'Make default')),
                  ),
                if (_canManage)
                  TextButton.icon(
                    onPressed: _busy ? null : () => _edit(row),
                    icon: const Icon(Icons.edit_outlined, size: 18),
                    label: Text(_t('تعديل', 'Edit')),
                  ),
                if (_canManage && active)
                  TextButton.icon(
                    // The default is the fallback every unnamed document
                    // lands in; switching it off would leave a branch with
                    // nowhere to post, so the server refuses it - the button
                    // says the same thing before the round trip.
                    onPressed: _busy || isDefault ? null : () => _deactivate(row),
                    icon: const Icon(Icons.power_settings_new_outlined, size: 18),
                    label: Text(_t('إيقاف', 'Switch off')),
                  ),
                if (_canManage && !active)
                  TextButton.icon(
                    onPressed: _busy ? null : () => _reactivate(row),
                    icon: const Icon(Icons.check_circle_outline, size: 18),
                    label: Text(_t('تفعيل', 'Switch on')),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _badge(String label, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 2),
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(AppRadii.chip),
        ),
        child: Text(label, style: Theme.of(context).textTheme.labelSmall),
      );
}

// ───────────────────────────────────────────────────────── the balances

/// What every warehouse holds, item by item.
///
/// The quantity is the stored base-unit figure; the breakdown beside it is the
/// same number rendered in the item's own units. `itemTotals` is the sum of
/// the warehouses for one item, which is what the branch balance must agree
/// with - the report is built from the same movements, so it does by
/// construction.
class _WarehouseBalanceTab extends ConsumerStatefulWidget {
  const _WarehouseBalanceTab();

  @override
  ConsumerState<_WarehouseBalanceTab> createState() =>
      _WarehouseBalanceTabState();
}

class _WarehouseBalanceTabState extends ConsumerState<_WarehouseBalanceTab> {
  Future<Json>? _future;
  String _query = '';
  String? _warehouseId;
  List<Json> _warehouses = const [];

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String _t(String ar, String en) => _arabic ? ar : en;

  bool get _canSeeCost =>
      ref.read(currentUserProvider)?.can('inventory.cost.read') ?? false;

  @override
  void initState() {
    super.initState();
    _future = _load();
    _loadWarehouses();
  }

  Future<Json> _load() async {
    return ref.read(apiClientProvider).getObject(
      '/inventory/warehouses/balance',
      query: {
        if (_query.trim().isNotEmpty) 'q': _query.trim(),
        if (_warehouseId != null) 'warehouseId': _warehouseId!,
      },
    );
  }

  Future<void> _loadWarehouses() async {
    try {
      final rows = await ref.read(apiClientProvider).getList(
            '/inventory/warehouses',
            query: const {'includeInactive': 'true'},
          );
      if (mounted) setState(() => _warehouses = rows);
    } catch (_) {
      if (mounted) setState(() => _warehouses = const []);
    }
  }

  void _refresh() {
    setState(() => _future = _load());
  }

  @override
  Widget build(BuildContext context) {
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
              SearchField(
                hint: _t('ابحث بكود الصنف أو اسمه', 'Search item code or name'),
                onChanged: (value) {
                  _query = value.trim();
                  _refresh();
                },
              ),
              DropdownButton<String?>(
                value: _warehouseId,
                hint: Text(_t('كل المخازن', 'All warehouses')),
                items: [
                  DropdownMenuItem<String?>(
                    value: null,
                    child: Text(_t('كل المخازن', 'All warehouses')),
                  ),
                  for (final warehouse in _warehouses)
                    DropdownMenuItem<String?>(
                      value: text(warehouse, 'id'),
                      child: Text(
                        '${text(warehouse, 'code')} — '
                        '${_arabic ? text(warehouse, 'nameAr') : text(warehouse, 'nameEn')}',
                      ),
                    ),
                ],
                onChanged: (value) {
                  setState(() => _warehouseId = value);
                  _refresh();
                },
              ),
              IconButton(
                tooltip: _t('تحديث', 'Refresh'),
                onPressed: _refresh,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
        ),
        Expanded(
          child: _future == null
              ? const Center(child: CircularProgressIndicator())
              : FutureBuilder<Json>(
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
                    final report = snapshot.data ?? const <String, dynamic>{};
                    final rows = (report['rows'] as List<dynamic>? ?? const [])
                        .whereType<Map>()
                        .map((value) => Map<String, dynamic>.from(value))
                        .toList(growable: false);
                    if (rows.isEmpty) {
                      return Center(
                        child: Text(
                          _t(
                            'لا توجد أرصدة في هذه المخازن حتى الآن.',
                            'These warehouses hold nothing yet.',
                          ),
                        ),
                      );
                    }
                    return Column(
                      children: [
                        Expanded(
                          // RecordsTable scrolls both ways itself; wrapping
                          // it would hand it an unbounded height.
                          child: RecordsTable(
                              rows: rows,
                              columns: [
                                  ColumnSpec(
                                    _t('كود الصنف', 'Item code'),
                                    value: (row) => text(row, 'itemCode'),
                                    emphasise: true,
                                  ),
                                  ColumnSpec(
                                    _t('الصنف', 'Item'),
                                    value: (row) => _arabic
                                        ? text(row, 'itemNameAr')
                                        : text(row, 'itemNameEn'),
                                  ),
                                  ColumnSpec(
                                    _t('الفرع', 'Branch'),
                                    value: (row) => text(row, 'branchCode'),
                                  ),
                                  ColumnSpec(
                                    _t('المخزن', 'Warehouse'),
                                    value: (row) => _arabic
                                        ? text(row, 'warehouseNameAr')
                                        : text(row, 'warehouseNameEn'),
                                  ),
                                  ColumnSpec(
                                    _t('الوحدة الأساسية', 'Base unit'),
                                    value: (row) => text(row, 'unit'),
                                  ),
                                  ColumnSpec(
                                    _t('الرصيد', 'Balance'),
                                    value: (row) => text(row, 'quantityText'),
                                    numeric: true,
                                  ),
                                  ColumnSpec(
                                    _t('التعبئة', 'Packing'),
                                    value: (row) => _breakdownOf(row),
                                  ),
                                  if (_canSeeCost)
                                    ColumnSpec(
                                      _t('متوسط التكلفة', 'Average cost'),
                                      value: (row) => text(row, 'averageCost'),
                                      numeric: true,
                                    ),
                                  if (_canSeeCost)
                                    ColumnSpec(
                                      _t('القيمة', 'Value'),
                                      value: (row) => text(row, 'value'),
                                      numeric: true,
                                    ),
                                ],
                          ),
                        ),
                        _totals(report, rows),
                      ],
                    );
                  },
                ),
        ),
      ],
    );
  }

  /// `{text, parts}` from the API; the parts are what a person reads.
  String _breakdownOf(Json row) {
    final breakdown = row['breakdown'];
    if (breakdown is Map) {
      final rendered = breakdown['text'];
      if (rendered != null && '$rendered'.trim().isNotEmpty) return '$rendered';
    }
    return text(row, 'quantityText');
  }

  Widget _totals(Json report, List<Json> rows) {
    final itemTotals = (report['itemTotals'] as List<dynamic>? ?? const [])
        .whereType<Map>()
        .map((value) => Map<String, dynamic>.from(value))
        .toList(growable: false);
    final total = report['totals'] is Map ? report['totals'] as Map : const {};
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerLow,
        border: Border(top: BorderSide(color: theme.colorScheme.outlineVariant)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              _t(
                '${rows.length} سطرًا • ${itemTotals.length} صنفًا • '
                    'مجموع المخازن هو رصيد الفرع لنفس الصنف',
                '${rows.length} row(s) • ${itemTotals.length} item(s) • '
                    'the warehouses sum to the branch balance for the same item',
              ),
              style: theme.textTheme.bodySmall,
            ),
          ),
          if (_canSeeCost && total['value'] != null)
            Text(
              '${_t('الإجمالي', 'Total')}: ${total['value']}',
              style: theme.textTheme.titleSmall,
            ),
        ],
      ),
    );
  }
}
