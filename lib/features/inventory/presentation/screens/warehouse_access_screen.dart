import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// «صلاحيات المخازن» - who may enter which room, and what they may do there.
///
/// The server already refuses the wrong person: a grant list that does not
/// contain a warehouse is a warehouse whose requests are refused, and an empty
/// list means "no restriction, every warehouse of their branches". This screen
/// is the only way to write those rows, because a permission nobody can grant
/// is a permission that does not exist for the people who need it.
///
/// Seven rights, because the jobs are seven: look, receive, issue, transfer,
/// count, approve, and see what the goods cost. The last one is separate on
/// purpose - a storekeeper may need to move goods without ever learning what
/// the company paid for them.
class WarehouseAccessScreen extends ConsumerStatefulWidget {
  const WarehouseAccessScreen({super.key});

  @override
  ConsumerState<WarehouseAccessScreen> createState() =>
      _WarehouseAccessScreenState();
}

/// One grantable right: the JSON key the API stores it under, and its two
/// names. Keeping the wire name beside the label is what stops a checkbox from
/// writing a column the server never reads.
class _Right {
  const _Right(this.key, this.ar, this.en, this.icon);

  final String key;
  final String ar;
  final String en;
  final IconData icon;
}

const List<_Right> _rights = [
  _Right('canView', 'عرض', 'View', Icons.visibility_outlined),
  _Right('canReceive', 'استلام', 'Receive', Icons.move_to_inbox_outlined),
  _Right('canIssue', 'صرف', 'Issue', Icons.outbox_outlined),
  _Right('canTransfer', 'تحويل', 'Transfer', Icons.swap_horiz),
  _Right('canCount', 'جرد', 'Count', Icons.fact_check_outlined),
  _Right('canApprove', 'اعتماد', 'Approve', Icons.verified_outlined),
  _Right('canSeeCost', 'رؤية التكلفة', 'See cost', Icons.price_change_outlined),
];

class _WarehouseAccessScreenState extends ConsumerState<WarehouseAccessScreen> {
  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  @override
  Widget build(BuildContext context) {
    return ModuleScaffold(
      title: _t('صلاحيات المخازن', 'Warehouse permissions'),
      subtitle: _t(
        'من يدخل أي مخزن، وماذا يفعل فيه: عرض، استلام، صرف، تحويل، جرد، اعتماد، ورؤية التكلفة.',
        'Who may enter which warehouse, and what they may do there: view, receive, issue, transfer, '
            'count, approve, and see what it cost.',
      ),
      body: const _AccessBody(),
    );
  }
}

class _AccessBody extends ConsumerStatefulWidget {
  const _AccessBody();

  @override
  ConsumerState<_AccessBody> createState() => _AccessBodyState();
}

class _AccessBodyState extends ConsumerState<_AccessBody> {
  List<Json> _users = const [];
  String? _selectedUserId;
  List<Json> _warehouses = const [];

  /// warehouseId → right key → granted. Built from the server's answer every
  /// time a person is opened, so the screen never shows a stale tick.
  final Map<String, Map<String, bool>> _draft = {};

  bool _restricted = false;
  bool _loading = true;
  bool _busy = false;
  Json? _profile;
  String? _error;
  String _query = '';

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  bool _can(String permission) =>
      ref.read(currentUserProvider)?.can(permission) ?? false;

  bool get _mayManage => _can('inventory.warehouse.access.manage');
  bool get _mayRead => _can('inventory.warehouse.access.read');

  @override
  void initState() {
    super.initState();
    _loadUsers();
  }

  String _userName(Json user) {
    final ar = text(user, 'fullNameAr');
    final en = text(user, 'fullNameEn');
    final name = _arabic ? (ar.isEmpty ? en : ar) : (en.isEmpty ? ar : en);
    final username = text(user, 'username');
    return name.isEmpty ? username : '$name ($username)';
  }

  String _warehouseName(Json warehouse) {
    final ar = text(warehouse, 'nameAr');
    final en = text(warehouse, 'nameEn');
    final name = _arabic ? (ar.isEmpty ? en : ar) : (en.isEmpty ? ar : en);
    final code = text(warehouse, 'code');
    return code.isEmpty ? name : '$code — $name';
  }

  Future<void> _loadUsers() async {
    if (!_mayRead) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = _t(
            'إدارة صلاحيات المخازن تحتاج صلاحية عرض صلاحيات المخازن.',
            'Reading warehouse rights needs the warehouse-access read permission.',
          );
        });
      }
      return;
    }
    try {
      final rows = await ref
          .read(apiClientProvider)
          .getList('/admin/users', query: {'pageSize': 200});
      if (!mounted) return;
      setState(() {
        _users = rows;
        _loading = false;
      });
      if (rows.isNotEmpty) await _open(text(rows.first, 'id'));
    } on Failure catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.message;
      });
    }
  }

  Future<void> _open(String userId) async {
    setState(() {
      _selectedUserId = userId;
      _busy = true;
      _error = null;
    });
    try {
      final data = await ref
          .read(apiClientProvider)
          .getObject('/inventory/warehouse-access/$userId');
      if (!mounted) return;
      final warehouses = listOf(data['warehouses']);
      final grants = listOf(data['grants']);
      final draft = <String, Map<String, bool>>{};
      for (final warehouse in warehouses) {
        final id = text(warehouse, 'id');
        draft[id] = {
          for (final right in _rights) right.key: false,
        };
      }
      for (final grant in grants) {
        final id = text(grant, 'warehouseId');
        final row = draft[id];
        if (row == null) continue;
        for (final right in _rights) {
          row[right.key] = flag(grant, right.key);
        }
      }
      setState(() {
        _warehouses = warehouses;
        _restricted = flag(data, 'restricted');
        _draft
          ..clear()
          ..addAll(draft);
        _profile = data['user'] is Map
            ? Map<String, dynamic>.from(data['user'] as Map)
            : null;
      });
    } on Failure catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save() async {
    final userId = _selectedUserId;
    if (userId == null) return;
    final grants = <Json>[];
    for (final entry in _draft.entries) {
      final ticked = entry.value.entries.where((row) => row.value).toList();
      if (ticked.isEmpty) continue;
      grants.add({
        'warehouseId': entry.key,
        for (final row in ticked) row.key: true,
      });
    }
    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .put('/inventory/warehouse-access/$userId', body: {'grants': grants});
      if (!mounted) return;
      showMessage(
        context,
        grants.isEmpty
            ? _t(
                'حُفظ: لا قيود على هذا المستخدم، فيعمل في كل مخازن فروعه.',
                'Saved: no restriction, so they work in every warehouse of their branches.',
              )
            : _t(
                'حُفظت صلاحيات المخازن.',
                'Warehouse permissions saved.',
              ),
      );
      await _open(userId);
    } on Failure catch (error) {
      if (mounted) showMessage(context, error.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _rightCell(String warehouseId, _Right right) {
    final checked = _draft[warehouseId]?[right.key] ?? false;
    return Tooltip(
      message: _arabic ? right.ar : right.en,
      child: Checkbox(
        key: ValueKey('grant-$warehouseId-${right.key}'),
        value: checked,
        onChanged: _mayManage
            ? (value) => setState(() {
                _draft[warehouseId] ??= {
                  for (final item in _rights) item.key: false,
                };
                _draft[warehouseId]![right.key] = value ?? false;
              })
            : null,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (_loading) return const Center(child: CircularProgressIndicator());

    final users = _query.isEmpty
        ? _users
        : _users.where((user) {
            final haystack = [
              text(user, 'username'),
              text(user, 'fullNameEn'),
              text(user, 'fullNameAr'),
            ].join(' ').toLowerCase();
            return haystack.contains(_query.toLowerCase());
          }).toList(growable: false);

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
                width: 320,
                child: SearchField(
                  hint: _t('ابحث عن مستخدم', 'Search a person'),
                  onChanged: (value) => setState(() => _query = value.trim()),
                ),
              ),
              if (_busy)
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              if (_mayManage)
                FilledButton.icon(
                  key: const ValueKey('warehouse-access-save'),
                  onPressed: _selectedUserId == null || _busy ? null : _save,
                  icon: const Icon(Icons.save_outlined, size: 18),
                  label: Text(_t('حفظ الصلاحيات', 'Save permissions')),
                ),
            ],
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
          ),
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 300,
                child: ListView.builder(
                  itemCount: users.length,
                  itemBuilder: (context, index) {
                    final user = users[index];
                    final id = text(user, 'id');
                    final chosen = id == _selectedUserId;
                    return ListTile(
                      key: ValueKey('access-user-$id'),
                      dense: true,
                      selected: chosen,
                      leading: Icon(
                        chosen ? Icons.person : Icons.person_outline,
                        size: 18,
                      ),
                      title: Text(
                        _userName(user),
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodyMedium,
                      ),
                      onTap: () => _open(id),
                    );
                  },
                ),
              ),
              const VerticalDivider(width: 1),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  children: [
                    if (_profile != null)
                      Text(
                        _t(
                          'صلاحيات ${_userName(_profile!)}',
                          'Rights of ${_userName(_profile!)}',
                        ),
                        style: theme.textTheme.titleMedium,
                      ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      _restricted
                          ? _t(
                              'هذا المستخدم مقيّد بالمخازن المؤشَّرة. أي مخزن بلا علامة لا يستطيع العمل فيه.',
                              'This person is limited to the ticked warehouses. A warehouse left unticked is '
                                  'one they cannot work in.',
                            )
                          : _t(
                              'لا قيود على هذا المستخدم الآن، فيعمل في كل مخازن فروعه. ضع علامة على مخزن لتقييده.',
                              'Nothing is restricted today, so they work in every warehouse of their '
                                  'branches. Tick a warehouse to start limiting them.',
                            ),
                      style: theme.textTheme.bodySmall,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    if (_warehouses.isEmpty)
                      Text(
                        _t('لا توجد مخازن.', 'There are no warehouses.'),
                        style: theme.textTheme.bodyMedium,
                      )
                    else
                      SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: DataTable(
                          showCheckboxColumn: false,
                          columns: [
                            DataColumn(label: Text(_t('المخزن', 'Warehouse'))),
                            for (final right in _rights)
                              DataColumn(
                                label: Tooltip(
                                  message: _arabic ? right.ar : right.en,
                                  child: Icon(right.icon, size: 18),
                                ),
                              ),
                          ],
                          rows: [
                            for (final warehouse in _warehouses)
                              DataRow(
                                key: ValueKey('access-row-${text(warehouse, 'id')}'),
                                cells: [
                                  DataCell(Text(_warehouseName(warehouse))),
                                  for (final right in _rights)
                                    DataCell(
                                      _rightCell(text(warehouse, 'id'), right),
                                    ),
                                ],
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
      ],
    );
  }
}
