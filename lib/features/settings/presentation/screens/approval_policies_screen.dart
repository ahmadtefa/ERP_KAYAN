import 'package:flutter/material.dart';
import '../../../../core/error/failure.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// Configuring the approval chains.
///
/// This screen exists because the alternative — a policy that only the seed
/// script can write — means a company's own rules are really ours. The person
/// who owns the process has to be able to say "purchases over 50,000 need the
/// financial manager and then me" without a developer.
///
/// Two things it deliberately refuses to do:
///
/// * It never offers the screen to somebody who can approve but not configure.
///   Deciding a level and widening the rule that governs your own authority are
///   different powers, and holding the first must not imply the second.
/// * It does not pretend every operation is configurable. It asks the server
///   which ones are, so an operation nothing enforces is never listed here as
///   though something did.
class ApprovalPoliciesScreen extends ConsumerStatefulWidget {
  const ApprovalPoliciesScreen({super.key, this.navigationKey});
  final ValueKey<String>? navigationKey;

  @override
  ConsumerState<ApprovalPoliciesScreen> createState() =>
      _ApprovalPoliciesScreenState();
}

class _ApprovalPoliciesScreenState extends ConsumerState<ApprovalPoliciesScreen> {
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _policies = const [];
  List<String> _operations = const [];
  List<Map<String, dynamic>> _warehouses = const [];
  List<Map<String, dynamic>> _branches = const [];

  bool get _ar => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _ar ? ar : en;

  @override
  void initState() {
    super.initState();
    _load();
  }

  bool get _canRead =>
      ref.read(currentUserProvider)?.can('admin.approvals.read') ?? false;
  bool get _canManage =>
      ref.read(currentUserProvider)?.can('admin.approvals.manage') ?? false;

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = ref.read(apiClientProvider);
      final operations = await api.getObject('/admin/approvals/operations');
      final policies = await api.getObject('/admin/approvals/policies');
      // The conditions name real warehouses and branches, not raw ids: an id
      // is a fact only a database should have to read. A failure to load them
      // must not stop the policies themselves from showing, so each is guarded
      // on its own.
      var warehouses = <Map<String, dynamic>>[];
      var branches = <Map<String, dynamic>>[];
      try {
        warehouses = await api.getList('/inventory/warehouses');
      } catch (_) {
        warehouses = const [];
      }
      try {
        branches = await api.getList('/company/branches');
      } catch (_) {
        branches = const [];
      }
      if (!mounted) return;
      setState(() {
        _operations = (operations['items'] as List? ?? const [])
            .map((e) => '$e')
            .toList(growable: false);
        _policies = (policies['items'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList(growable: false);
        _warehouses = warehouses;
        _branches = branches;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_canRead) {
      return ModuleScaffold(
        title: _t('سياسات الموافقات', 'Approval policies'),
        body: _Notice(
          icon: Icons.lock_outline,
          text: _t(
            'لا تملك صلاحية عرض سياسات الموافقات.',
            'You do not have permission to view approval policies.',
          ),
        ),
      );
    }
    return ModuleScaffold(
      title: _t('سياسات الموافقات', 'Approval policies'),
      subtitle: _t(
        'من يجب أن يعتمد ماذا، وبأي ترتيب، وبأي شروط',
        'Who must approve what, in which order, and under which conditions',
      ),
      actions: [
        IconButton(
          onPressed: _loading ? null : _load,
          icon: const Icon(Icons.refresh),
          tooltip: _t('تحديث', 'Refresh'),
        ),
        if (_canManage)
          FilledButton.icon(
            onPressed: () => _openEditor(null),
            icon: const Icon(Icons.add),
            label: Text(_t('سياسة جديدة', 'New policy')),
          ),
      ],
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _Notice(
                  icon: Icons.error_outline,
                  text: _error!,
                  action: TextButton(
                    onPressed: _load,
                    child: Text(_t('إعادة المحاولة', 'Try again')),
                  ),
                )
              : _policies.isEmpty
                  ? _Notice(
                      icon: Icons.rule,
                      text: _t(
                        'لا توجد سياسات بعد. الشركة تعمل بالمسار القديم: مراجعة ثم اعتماد واحد. '
                            'أضف سياسة لتصبح الموافقات متعددة المستويات وبشروط.',
                        'There are no policies yet, so the company follows the legacy path: '
                            'one review and one approval. Add a policy to require ordered, '
                            'conditional approvals.',
                      ),
                    )
                  : ListView.separated(
                      itemCount: _policies.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 8),
                      itemBuilder: (context, index) => _PolicyCard(
                        ar: _ar,
                        policy: _policies[index],
                        warehouseName: _warehouseName,
                        branchName: _branchName,
                        canManage: _canManage,
                        onEdit: () => _openEditor(_policies[index]),
                        onDelete: () => _delete(_policies[index]),
                      ),
                    ),
    );
  }

  String? _warehouseName(String? id) {
    if (id == null) return null;
    for (final row in _warehouses) {
      if (row['id'] == id) {
        return '${_ar ? (row['nameAr'] ?? row['nameEn']) : (row['nameEn'] ?? row['nameAr'])}';
      }
    }
    return id;
  }

  String? _branchName(String? id) {
    if (id == null) return null;
    for (final row in _branches) {
      if (row['id'] == id) {
        return '${_ar ? (row['nameAr'] ?? row['nameEn']) : (row['nameEn'] ?? row['nameAr'])}';
      }
    }
    return id;
  }

  Future<void> _delete(Map<String, dynamic> policy) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(_t('حذف السياسة', 'Delete policy')),
        content: Text(
          _t(
            'سيُلغى هذا الإعداد وتعود المستندات المطابقة إلى المسار القديم. '
                'قرارات الاعتماد المسجّلة تبقى في السجل.',
            'This setting is removed and matching documents fall back to the legacy path. '
                'Recorded approval decisions stay in the history.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(_t('إلغاء', 'Cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(_t('حذف', 'Delete')),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref
          .read(apiClientProvider)
          .delete('/admin/approvals/policies/${policy['id']}');
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString())));
      }
    }
  }

  Future<void> _openEditor(Map<String, dynamic>? existing) async {
    final saved = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _PolicyEditorDialog(
        ar: _ar,
        existing: existing,
        operations: _operations,
        warehouses: _warehouses,
        branches: _branches,
      ),
    );
    if (saved == true) await _load();
  }
}

/// STOCK_TRANSFER -> Stock transfer. The server owns the codes; a reader
/// should not have to see them.
String _operationLabel(String code) {
  final words = code.replaceAll('_', ' ').trim().toLowerCase();
  if (words.isEmpty) return code;
  return '${words[0].toUpperCase()}${words.substring(1)}';
}

class _PolicyCard extends StatelessWidget {
  const _PolicyCard({
    required this.ar,
    required this.policy,
    required this.warehouseName,
    required this.branchName,
    required this.canManage,
    required this.onEdit,
    required this.onDelete,
  });

  final bool ar;
  final Map<String, dynamic> policy;
  final String? Function(String?) warehouseName;
  final String? Function(String?) branchName;
  final bool canManage;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  String t(String a, String e) => ar ? a : e;

  @override
  Widget build(BuildContext context) {
    final levels = (policy['levels'] as List? ?? const [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList()
      ..sort((a, b) => (a['level'] as num).compareTo(b['level'] as num));
    final conditions = <String>[];
    if (policy['branchId'] != null) {
      conditions.add('${t('الفرع: ', 'Branch: ')}${branchName('${policy['branchId']}') ?? ''}');
    }
    if (policy['sourceWarehouseId'] != null) {
      conditions.add(
          '${t('من مخزن: ', 'From: ')}${warehouseName('${policy['sourceWarehouseId']}') ?? ''}');
    }
    if (policy['destinationWarehouseId'] != null) {
      conditions.add(
          '${t('إلى مخزن: ', 'To: ')}${warehouseName('${policy['destinationWarehouseId']}') ?? ''}');
    }
    if (policy['minimumAmount'] != null) {
      conditions.add('${t('قيمة ≥ ', 'Value ≥ ')}${policy['minimumAmount']}');
    }
    if (policy['minimumQuantity'] != null) {
      conditions.add('${t('كمية ≥ ', 'Quantity ≥ ')}${policy['minimumQuantity']}');
    }
    final active = policy['isActive'] != false;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Wrap(
                    spacing: 8,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(
                        '${ar ? (policy['nameAr'] ?? policy['nameEn']) : (policy['nameEn'] ?? policy['nameAr'])}',
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      Chip(
                        visualDensity: VisualDensity.compact,
                        label: Text(_operationLabel('${policy['operation']}')),
                      ),
                      if (!active)
                        Chip(
                          visualDensity: VisualDensity.compact,
                          label: Text(t('موقوفة', 'Inactive')),
                        ),
                      Chip(
                        visualDensity: VisualDensity.compact,
                        label: Text(
                          t('الأولوية ${policy['priority']}', 'Priority ${policy['priority']}'),
                        ),
                      ),
                    ],
                  ),
                ),
                if (canManage) ...[
                  IconButton(
                    onPressed: onEdit,
                    icon: const Icon(Icons.edit_outlined),
                    tooltip: t('تعديل', 'Edit'),
                  ),
                  IconButton(
                    onPressed: onDelete,
                    icon: const Icon(Icons.delete_outline),
                    tooltip: t('حذف', 'Delete'),
                  ),
                ],
              ],
            ),
            if (conditions.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                conditions.join(' · '),
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            const SizedBox(height: 8),
            Text(t('المسار', 'Path'), style: Theme.of(context).textTheme.labelMedium),
            const SizedBox(height: 4),
            for (final level in levels)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 10,
                      child: Text(
                        '${level['level']}',
                        style: const TextStyle(fontSize: 10),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '${ar ? (level['nameAr'] ?? level['nameEn']) : (level['nameEn'] ?? level['nameAr'])}'
                        ' · ${level['permission']}'
                        '${level['roleCode'] != null ? ' · ${level['roleCode']}' : ''}',
                        style: Theme.of(context).textTheme.bodySmall,
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

/// The editor. It holds the levels in a list the person can reorder, because
/// "level 1 then level 2" is the substance of the rule, and a form that cannot
/// express the order would only be describing it.
class _PolicyEditorDialog extends ConsumerStatefulWidget {
  const _PolicyEditorDialog({
    required this.ar,
    required this.existing,
    required this.operations,
    required this.warehouses,
    required this.branches,
  });

  final bool ar;
  final Map<String, dynamic>? existing;
  final List<String> operations;
  final List<Map<String, dynamic>> warehouses;
  final List<Map<String, dynamic>> branches;

  @override
  ConsumerState<_PolicyEditorDialog> createState() => _PolicyEditorDialogState();
}

class _LevelDraft {
  _LevelDraft({
    this.nameAr = '',
    this.nameEn = '',
    this.permission = '',
    this.roleCode = '',
    this.optional = false,
  });

  String nameAr;
  String nameEn;
  String permission;
  String roleCode;
  bool optional;
}

class _PolicyEditorDialogState extends ConsumerState<_PolicyEditorDialog> {
  late final TextEditingController _nameAr;
  late final TextEditingController _nameEn;
  late final TextEditingController _priority;
  late final TextEditingController _minimumAmount;
  late final TextEditingController _minimumQuantity;
  late String _operation;
  String? _branchId;
  String? _sourceWarehouseId;
  String? _destinationWarehouseId;
  late List<_LevelDraft> _levels;
  bool _saving = false;
  String? _error;
  /// Reasons under the field they are about: name, priority, minimumAmount,
  /// minimumQuantity, level.N.name, level.N.permission. Editing clears its own.
  final Map<String, String> _errors = {};
  void _clear(String key) {
    if (_errors.remove(key) != null) setState(() {});
  }

  static final _decimal = RegExp(r'^\d+(\.\d+)?$');

  bool get _ar => widget.ar;
  String t(String a, String e) => _ar ? a : e;

  @override
  void initState() {
    super.initState();
    final existing = widget.existing;
    _nameAr = TextEditingController(text: '${existing?['nameAr'] ?? ''}');
    _nameEn = TextEditingController(text: '${existing?['nameEn'] ?? ''}');
    _priority = TextEditingController(text: '${existing?['priority'] ?? 100}');
    _minimumAmount =
        TextEditingController(text: '${existing?['minimumAmount'] ?? ''}');
    _minimumQuantity =
        TextEditingController(text: '${existing?['minimumQuantity'] ?? ''}');
    _operation = '${existing?['operation'] ?? (widget.operations.isNotEmpty ? widget.operations.first : 'STOCK_TRANSFER')}';
    _branchId = existing?['branchId'] as String?;
    _sourceWarehouseId = existing?['sourceWarehouseId'] as String?;
    _destinationWarehouseId = existing?['destinationWarehouseId'] as String?;
    final levels = (existing?['levels'] as List? ?? const [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList()
      ..sort((a, b) => (a['level'] as num).compareTo(b['level'] as num));
    _levels = levels.isEmpty
        ? [
            _LevelDraft(
              nameAr: 'اعتماد مدير المخزن',
              nameEn: 'Warehouse manager approval',
              permission: 'inventory.transfer.approve',
            ),
          ]
        : levels
            .map((e) => _LevelDraft(
                  nameAr: '${e['nameAr'] ?? ''}',
                  nameEn: '${e['nameEn'] ?? ''}',
                  permission: '${e['permission'] ?? ''}',
                  roleCode: '${e['roleCode'] ?? ''}',
                  optional: e['optional'] == true,
                ))
            .toList();
  }

  @override
  void dispose() {
    _nameAr.dispose();
    _nameEn.dispose();
    _priority.dispose();
    _minimumAmount.dispose();
    _minimumQuantity.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(
        widget.existing == null
            ? t('سياسة موافقات جديدة', 'New approval policy')
            : t('تعديل السياسة', 'Edit policy'),
      ),
      content: SizedBox(
        width: 760,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text(
                    _error!,
                    style: TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ),
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _operation,
                      decoration: InputDecoration(labelText: t('نوع العملية', 'Operation')),
                      items: widget.operations
                          .map((operation) => DropdownMenuItem(
                                value: operation,
                                child: Text(_operationLabel(operation)),
                              ))
                          .toList(),
                      onChanged: (value) =>
                          setState(() => _operation = value ?? _operation),
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    width: 140,
                    child: TextField(
                      controller: _priority,
                      keyboardType: TextInputType.number,
                      onChanged: (_) => _clear('priority'),
                      decoration: InputDecoration(
                        labelText: t('الأولوية', 'Priority'),
                        helperText: t('الأصغر أولًا', 'Lower wins'),
                        errorText: _errors['priority'],
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _nameAr,
                      onChanged: (_) => _clear('name'),
                      decoration: InputDecoration(
                        labelText: t('الاسم بالعربية', 'Name (Arabic)'),
                        errorText: _errors['name'],
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      controller: _nameEn,
                      onChanged: (_) => _clear('name'),
                      decoration: InputDecoration(labelText: t('الاسم بالإنجليزية', 'Name (English)')),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Text(t('الشروط — اتركها فارغة لتسري على كل المستندات',
                  'Conditions — leave empty to apply to every document'),
                  style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _dropdown<String?>(
                    label: t('الفرع', 'Branch'),
                    value: _branchId,
                    items: [
                      DropdownMenuItem(value: null, child: Text(t('أي فرع', 'Any branch'))),
                      ...widget.branches.map(
                        (row) => DropdownMenuItem(
                          value: '${row['id']}',
                          child: Text(
                            '${_ar ? (row['nameAr'] ?? row['nameEn']) : (row['nameEn'] ?? row['nameAr'])}',
                          ),
                        ),
                      ),
                    ],
                    onChanged: (value) => setState(() => _branchId = value),
                  ),
                  _dropdown<String?>(
                    label: t('من مخزن', 'From warehouse'),
                    value: _sourceWarehouseId,
                    items: [
                      DropdownMenuItem(value: null, child: Text(t('أي مخزن', 'Any warehouse'))),
                      ...widget.warehouses.map(
                        (row) => DropdownMenuItem(
                          value: '${row['id']}',
                          child: Text(
                            '${_ar ? (row['nameAr'] ?? row['nameEn']) : (row['nameEn'] ?? row['nameAr'])}',
                          ),
                        ),
                      ),
                    ],
                    onChanged: (value) => setState(() => _sourceWarehouseId = value),
                  ),
                  _dropdown<String?>(
                    label: t('إلى مخزن', 'To warehouse'),
                    value: _destinationWarehouseId,
                    items: [
                      DropdownMenuItem(value: null, child: Text(t('أي مخزن', 'Any warehouse'))),
                      ...widget.warehouses.map(
                        (row) => DropdownMenuItem(
                          value: '${row['id']}',
                          child: Text(
                            '${_ar ? (row['nameAr'] ?? row['nameEn']) : (row['nameEn'] ?? row['nameAr'])}',
                          ),
                        ),
                      ),
                    ],
                    onChanged: (value) =>
                        setState(() => _destinationWarehouseId = value),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _minimumAmount,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      onChanged: (_) => _clear('minimumAmount'),
                      decoration: InputDecoration(
                        errorText: _errors['minimumAmount'],
                        labelText: t('الحد الأدنى للقيمة', 'Minimum value'),
                        helperText: t(
                          'يسري عندما تبلغ قيمة البضاعة هذا الحد أو تتجاوزه',
                          'Applies when the goods are worth at least this',
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      controller: _minimumQuantity,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      onChanged: (_) => _clear('minimumQuantity'),
                      decoration: InputDecoration(
                        errorText: _errors['minimumQuantity'],
                        labelText: t('الحد الأدنى للكمية', 'Minimum quantity'),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      t('مستويات الاعتماد بالترتيب', 'Approval levels, in order'),
                      style: Theme.of(context).textTheme.labelLarge,
                    ),
                  ),
                  TextButton.icon(
                    onPressed: () => setState(() => _levels.add(_LevelDraft())),
                    icon: const Icon(Icons.add),
                    label: Text(t('إضافة مستوى', 'Add level')),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              for (var index = 0; index < _levels.length; index++)
                _levelRow(index),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.pop(context, false),
          child: Text(t('إلغاء', 'Cancel')),
        ),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(t('حفظ', 'Save')),
        ),
      ],
    );
  }

  Widget _dropdown<T>({
    required String label,
    required T value,
    required List<DropdownMenuItem<T>> items,
    required ValueChanged<T?> onChanged,
  }) {
    return SizedBox(
      width: 220,
      child: DropdownButtonFormField<T>(
        initialValue: value,
        isExpanded: true,
        decoration: InputDecoration(labelText: label),
        items: items,
        onChanged: onChanged,
      ),
    );
  }

  Widget _levelRow(int index) {
    final level = _levels[index];
    return Card(
      key: ObjectKey(level),
      margin: const EdgeInsets.symmetric(vertical: 4),
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(radius: 12, child: Text('${index + 1}')),
                const SizedBox(width: 8),
                Text(t('المستوى ${index + 1}', 'Level ${index + 1}'),
                    style: Theme.of(context).textTheme.labelMedium),
                const Spacer(),
                IconButton(
                  onPressed: index == 0
                      ? null
                      : () => setState(() {
                            _errors.removeWhere((k, _) => k.startsWith('level.'));
                            final moved = _levels.removeAt(index);
                            _levels.insert(index - 1, moved);
                          }),
                  icon: const Icon(Icons.arrow_upward, size: 18),
                  tooltip: t('أعلى', 'Move up'),
                ),
                IconButton(
                  onPressed: index == _levels.length - 1
                      ? null
                      : () => setState(() {
                            _errors.removeWhere((k, _) => k.startsWith('level.'));
                            final moved = _levels.removeAt(index);
                            _levels.insert(index + 1, moved);
                          }),
                  icon: const Icon(Icons.arrow_downward, size: 18),
                  tooltip: t('أسفل', 'Move down'),
                ),
                IconButton(
                  onPressed: _levels.length == 1
                      ? null
                      : () => setState(() {
                            _errors.removeWhere((k, _) => k.startsWith('level.'));
                            _levels.removeAt(index);
                          }),
                  icon: const Icon(Icons.close, size: 18),
                  tooltip: t('حذف المستوى', 'Remove level'),
                ),
              ],
            ),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    initialValue: level.nameAr,
                    decoration: InputDecoration(
                      labelText: t('اسم المستوى بالعربية', 'Level name (Arabic)'),
                      errorText: _errors['level.$index.name'],
                    ),
                    onChanged: (value) {
                      level.nameAr = value;
                      _clear('level.$index.name');
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextFormField(
                    initialValue: level.nameEn,
                    decoration: InputDecoration(labelText: t('اسم المستوى بالإنجليزية', 'Level name (English)')),
                    onChanged: (value) {
                      level.nameEn = value;
                      _clear('level.$index.name');
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    initialValue: level.permission,
                    decoration: InputDecoration(
                      labelText: t('الصلاحية المطلوبة', 'Required permission'),
                      helperText: 'e.g. inventory.transfer.approve',
                      errorText: _errors['level.$index.permission'],
                    ),
                    onChanged: (value) {
                      level.permission = value;
                      _clear('level.$index.permission');
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextFormField(
                    initialValue: level.roleCode,
                    decoration: InputDecoration(
                      labelText: t('الدور (اختياري)', 'Role (optional)'),
                      helperText: t('يُشترط أيضًا', 'Also required'),
                      errorText: _errors['level.$index.roleCode'],
                    ),
                    onChanged: (value) {
                      level.roleCode = value;
                      _clear('level.$index.roleCode');
                    },
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _save() async {
    final nameAr = _nameAr.text.trim();
    final nameEn = _nameEn.text.trim();
    final found = <String, String>{};
    if (nameAr.isEmpty && nameEn.isEmpty) {
      found['name'] = t('الاسم مطلوب', 'A name is required');
    }
    final priority = _priority.text.trim();
    if (priority.isNotEmpty && int.tryParse(priority) == null) {
      found['priority'] = t('اكتب رقمًا صحيحًا', 'Enter a whole number');
    }
    for (final entry in {
      'minimumAmount': _minimumAmount,
      'minimumQuantity': _minimumQuantity,
    }.entries) {
      final value = entry.value.text.trim();
      if (value.isNotEmpty && !_decimal.hasMatch(value)) {
        found[entry.key] = t(
          'اكتب رقمًا صحيحًا أو عشريًا بدون سالب',
          'Enter a number, zero or more',
        );
      }
    }
    for (var index = 0; index < _levels.length; index++) {
      final level = _levels[index];
      if (level.permission.trim().isEmpty) {
        found['level.$index.permission'] = t(
          'اكتب الصلاحية التي تحدد من يعتمد هذا المستوى',
          'Name the permission that decides who approves this level',
        );
      }
      if (level.nameAr.trim().isEmpty && level.nameEn.trim().isEmpty) {
        found['level.$index.name'] = t('اسم المستوى مطلوب', 'The level name is required');
      }
    }
    if (found.isNotEmpty) {
      setState(() {
        _errors
          ..clear()
          ..addAll(found);
        _error = null;
      });
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
      _errors.clear();
    });
    final body = <String, dynamic>{
      'operation': _operation,
      'nameAr': nameAr.isEmpty ? nameEn : nameAr,
      'nameEn': nameEn.isEmpty ? nameAr : nameEn,
      'priority': int.tryParse(_priority.text.trim()) ?? 100,
      'branchId': _branchId,
      'sourceWarehouseId': _sourceWarehouseId,
      'destinationWarehouseId': _destinationWarehouseId,
      // An empty box means "no threshold", which is different from a threshold
      // of zero: zero would match every document and read as a condition.
      'minimumAmount': _minimumAmount.text.trim().isEmpty
          ? null
          : _minimumAmount.text.trim(),
      'minimumQuantity': _minimumQuantity.text.trim().isEmpty
          ? null
          : _minimumQuantity.text.trim(),
      'levels': [
        for (var index = 0; index < _levels.length; index++)
          {
            'level': index + 1,
            'nameAr': _levels[index].nameAr.trim().isEmpty
                ? _levels[index].nameEn.trim()
                : _levels[index].nameAr.trim(),
            'nameEn': _levels[index].nameEn.trim().isEmpty
                ? _levels[index].nameAr.trim()
                : _levels[index].nameEn.trim(),
            'permission': _levels[index].permission.trim(),
            'roleCode': _levels[index].roleCode.trim().isEmpty
                ? null
                : _levels[index].roleCode.trim(),
            'optional': _levels[index].optional,
          },
      ],
    };
    try {
      final api = ref.read(apiClientProvider);
      final existing = widget.existing;
      if (existing == null) {
        await api.post('/admin/approvals/policies', body: body);
      } else {
        await api.patch('/admin/approvals/policies/${existing['id']}', body: body);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      if (e is ApiFailure &&
          const {400, 422}.contains(e.statusCode) &&
          e.fieldErrors.isNotEmpty) {
        // Nothing was saved: reasons go under their fields, input is kept.
        final levelKey = RegExp(r'^levels\.(\d+)\.(nameAr|nameEn|permission|roleCode)$');
        final rest = <String>[];
        setState(() {
          _saving = false;
          _errors.clear();
          e.fieldErrors.forEach((key, message) {
            final match = levelKey.firstMatch(key);
            if (match != null) {
              final sourceField = match.group(2)!;
              final field = sourceField == 'nameAr' || sourceField == 'nameEn'
                  ? 'name' : sourceField;
              _errors['level.${match.group(1)}.$field'] = message;
            } else if (key == 'nameAr' || key == 'nameEn') {
              _errors['name'] = message;
            } else if (const {'priority', 'minimumAmount', 'minimumQuantity'}.contains(key)) {
              _errors[key] = message;
            } else {
              rest.add(message);
            }
          });
          _error = rest.isEmpty ? null : rest.join('\n');
        });
      } else {
        setState(() {
          _saving = false;
          _error = e is Failure ? e.message : e.toString();
        });
      }
    }
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.text, this.action});
  final IconData icon;
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 40, color: Theme.of(context).colorScheme.outline),
            const SizedBox(height: 12),
            Text(text, textAlign: TextAlign.center),
            if (action != null) ...[const SizedBox(height: 8), action!],
          ],
        ),
      ),
    );
  }
}
