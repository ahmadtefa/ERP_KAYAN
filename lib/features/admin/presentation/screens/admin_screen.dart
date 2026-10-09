import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/form_sheet.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../providers/admin_providers.dart';
import '../../../data/presentation/widgets/list_export_actions.dart';

/// Administration: the users, the roles, and what the audit trail recorded.
///
/// The three belong together because they answer one question — who may do
/// what, and who actually did it.
class AdminScreen extends StatelessWidget {
  const AdminScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return DefaultTabController(
      length: 3,
      child: Column(
        children: [
          TabBar(
            tabs: [
              Tab(text: l10n.users, icon: const Icon(Icons.person_outline)),
              Tab(text: l10n.roles, icon: const Icon(Icons.badge_outlined)),
              Tab(
                text: l10n.auditTrail,
                icon: const Icon(Icons.history_outlined),
              ),
            ],
          ),
          const Expanded(
            child: TabBarView(
              children: [_UsersTab(), _RolesTab(), _AuditTab()],
            ),
          ),
        ],
      ),
    );
  }
}

// ═════════════════════════════════════════════════════════════ users

class _UsersTab extends ConsumerStatefulWidget {
  const _UsersTab();

  @override
  ConsumerState<_UsersTab> createState() => _UsersTabState();
}

class _UsersTabState extends ConsumerState<_UsersTab> {
  String _query = '';
  bool _busy = false;

  /// The roles, as choices for the form. Read before the form opens so the
  /// dialog never appears empty.
  Future<List<FieldOption>> _roleOptions() async {
    // Read the locale before the await: the widget may be rebuilt meanwhile.
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final roles = await ref.read(rolesListProvider.future);
    return [
      for (final role in roles)
        FieldOption(
          text(role, 'id'),
          '${text(role, 'code')} — '
              '${isArabic ? text(role, 'nameAr') : text(role, 'nameEn')}',
        ),
    ];
  }

  Future<void> _edit({Json? existing}) async {
    final l10n = context.l10n;
    final isEdit = existing != null;
    final roles = await _roleOptions();
    if (!mounted) return;

    final fields = <FieldSpec>[
      if (!isEdit)
        FieldSpec(
          'username',
          l10n.username,
          required: true,
          helper: l10n.usernameHelper,
        ),
      FieldSpec('fullNameEn', l10n.fullNameEn, required: true),
      FieldSpec('fullNameAr', l10n.fullNameAr, required: true),
      FieldSpec('email', l10n.email),
      if (!isEdit)
        FieldSpec(
          'password',
          l10n.password,
          required: true,
          helper: l10n.passwordHelper,
        ),
      FieldSpec(
        'roleIds',
        l10n.roles,
        kind: FieldKind.multiSelect,
        options: roles,
      ),
      if (isEdit) FieldSpec('isActive', l10n.active, kind: FieldKind.toggle),
    ];

    final values = await showFormSheet(
      context,
      title: isEdit ? l10n.editUser : l10n.newUser,
      fields: fields,
      initial: existing,
    );
    if (values == null || !mounted) return;

    setState(() => _busy = true);
    try {
      final client = ref.read(apiClientProvider);
      if (isEdit) {
        await client.patch('/admin/users/${existing['id']}', body: values);
      } else {
        await client.post('/admin/users', body: values);
      }
      await ref.read(usersListProvider.notifier).reload();
      if (mounted) showMessage(context, l10n.createdSuccessfully);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _changePassword(Json row) async {
    final l10n = context.l10n;
    final values = await showFormSheet(
      context,
      title: '${l10n.changePassword} — ${text(row, 'username')}',
      fields: [
        FieldSpec(
          'password',
          l10n.password,
          required: true,
          helper: l10n.passwordHelper,
        ),
      ],
      submitLabel: l10n.save,
    );
    if (values == null || !mounted) return;

    setState(() => _busy = true);
    try {
      await ref
          .read(apiClientProvider)
          .post('/admin/users/${row['id']}/password', body: values);
      if (mounted) showMessage(context, l10n.passwordChanged);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggleActive(Json row) async {
    final l10n = context.l10n;
    final isActive = flag(row, 'isActive', fallback: true);
    if (isActive) {
      final ok = await confirmAction(
        context,
        title: l10n.deactivate,
        message: l10n.confirmDeactivateUser,
        confirmLabel: l10n.deactivate,
        destructive: true,
      );
      if (!ok || !mounted) return;
    }

    setState(() => _busy = true);
    try {
      final client = ref.read(apiClientProvider);
      if (isActive) {
        await client.post('/admin/users/${row['id']}/deactivate');
      } else {
        await client.patch('/admin/users/${row['id']}', body: {'isActive': true});
      }
      await ref.read(usersListProvider.notifier).reload();
      if (mounted) showMessage(context, l10n.createdSuccessfully);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(usersListProvider);
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';

    return ModuleScaffold(
      title: l10n.users,
      actions: const [ListExportActions(list: 'users')],
      trailing: Row(
        children: [
          SearchField(
            hint: l10n.searchUsers,
            onChanged: (value) => setState(() => _query = value.trim()),
          ),
          const SizedBox(width: 12),
          FilledButton.icon(
            onPressed: _busy ? null : () => _edit(),
            icon: const Icon(Icons.person_add_alt),
            label: Text(l10n.newUser),
          ),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(usersListProvider.notifier).reload(),
        isEmpty: (rows) => _filter(rows).isEmpty,
        emptyMessage: l10n.noUsers,
        data: (rows) => RecordsTable(
          rows: _filter(rows),
          columns: [
            ColumnSpec(
              l10n.username,
              value: (r) => text(r, 'username'),
              emphasise: true,
            ),
            ColumnSpec(l10n.fullNameEn, value: (r) => text(r, 'fullNameEn')),
            ColumnSpec(l10n.fullNameAr, value: (r) => text(r, 'fullNameAr')),
            ColumnSpec(
              l10n.roles,
              value: (r) => listOf(r['roles'])
                  .map(
                    (role) => isArabic
                        ? text(role, 'nameAr', fallback: text(role, 'code'))
                        : text(role, 'code'),
                  )
                  .join('، '),
            ),
            ColumnSpec(
              l10n.lastLogin,
              value: (r) => _moment(text(r, 'lastLoginAt')) ?? l10n.never,
            ),
            ColumnSpec(l10n.status, value: (r) => _status(r)),
          ],
          actions: (row) => [
            IconButton(
              tooltip: l10n.edit,
              icon: const Icon(Icons.edit_outlined, size: 20),
              onPressed: _busy ? null : () => _edit(existing: row),
            ),
            IconButton(
              tooltip: l10n.changePassword,
              icon: const Icon(Icons.key_outlined, size: 20),
              onPressed: _busy ? null : () => _changePassword(row),
            ),
            IconButton(
              tooltip: flag(row, 'isActive', fallback: true)
                  ? l10n.deactivate
                  : l10n.activate,
              icon: Icon(
                flag(row, 'isActive', fallback: true)
                    ? Icons.block_outlined
                    : Icons.check_circle_outline,
                size: 20,
              ),
              onPressed: _busy ? null : () => _toggleActive(row),
            ),
          ],
        ),
      ),
    );
  }

  String _status(Json row) {
    final l10n = context.l10n;
    if (!flag(row, 'isActive', fallback: true)) return l10n.inactive;
    if (flag(row, 'isSuperAdmin')) return l10n.superAdmin;
    return l10n.active;
  }

  List<Json> _filter(List<Json> rows) {
    if (_query.isEmpty) return rows;
    final needle = _query.toLowerCase();
    return rows
        .where(
          (r) =>
              text(r, 'username').toLowerCase().contains(needle) ||
              text(r, 'fullNameEn').toLowerCase().contains(needle) ||
              text(r, 'fullNameAr').contains(_query),
        )
        .toList(growable: false);
  }
}

// ═════════════════════════════════════════════════════════════ roles

class _RolesTab extends ConsumerStatefulWidget {
  const _RolesTab();

  @override
  ConsumerState<_RolesTab> createState() => _RolesTabState();
}

class _RolesTabState extends ConsumerState<_RolesTab> {
  bool _busy = false;

  Future<void> _edit({Json? existing}) async {
    final l10n = context.l10n;
    final isEdit = existing != null;
    final values = await showFormSheet(
      context,
      title: isEdit ? l10n.editRole : l10n.newRole,
      fields: [
        if (!isEdit) FieldSpec('code', l10n.roleCode, required: true),
        FieldSpec('nameEn', l10n.fullNameEn, required: true),
        FieldSpec('nameAr', l10n.fullNameAr, required: true),
      ],
      initial: existing,
    );
    if (values == null || !mounted) return;

    setState(() => _busy = true);
    try {
      final client = ref.read(apiClientProvider);
      if (isEdit) {
        await client.patch('/admin/roles/${existing['id']}', body: values);
      } else {
        await client.post('/admin/roles', body: values);
      }
      await ref.read(rolesListProvider.notifier).reload();
      if (mounted) showMessage(context, l10n.createdSuccessfully);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _choosePermissions(Json role) async {
    final l10n = context.l10n;
    final chosen = await showDialog<Set<String>>(
      context: context,
      builder: (context) => _PermissionsDialog(
        title: '${l10n.setPermissions} — '
            '${Localizations.localeOf(context).languageCode == 'ar' ? text(role, 'nameAr') : text(role, 'nameEn')}',
        selected: listOf(role['permissions']).map((e) => e.toString()).toSet(),
      ),
    );
    if (chosen == null || !mounted) return;

    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).post(
        '/admin/roles/${role['id']}/permissions',
        body: {'permissions': chosen.toList(growable: false)},
      );
      await ref.read(rolesListProvider.notifier).reload();
      if (mounted) showMessage(context, l10n.createdSuccessfully);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove(Json role) async {
    final l10n = context.l10n;
    final ok = await confirmAction(
      context,
      title: l10n.deleteRole,
      message: l10n.confirmDeleteRole,
      confirmLabel: l10n.deleteRole,
      destructive: true,
    );
    if (!ok || !mounted) return;

    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).delete('/admin/roles/${role['id']}');
      await ref.read(rolesListProvider.notifier).reload();
      if (mounted) showMessage(context, l10n.createdSuccessfully);
    } on Failure catch (e) {
      if (mounted) showMessage(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(rolesListProvider);

    return ModuleScaffold(
      title: l10n.roles,
      actions: const [ListExportActions(list: 'roles')],
      trailing: Row(
        children: [
          IconButton(
            tooltip: l10n.refresh,
            onPressed: _busy
                ? null
                : () => ref.read(rolesListProvider.notifier).reload(),
            icon: const Icon(Icons.refresh),
          ),
          const SizedBox(width: 4),
          FilledButton.icon(
            onPressed: _busy ? null : () => _edit(),
            icon: const Icon(Icons.add),
            label: Text(l10n.newRole),
          ),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(rolesListProvider.notifier).reload(),
        isEmpty: (rows) => rows.isEmpty,
        emptyMessage: l10n.noRoles,
        data: (rows) => RecordsTable(
          rows: rows,
          columns: [
            ColumnSpec(
              l10n.roleCode,
              value: (r) => text(r, 'code'),
              emphasise: true,
            ),
            ColumnSpec(l10n.fullNameEn, value: (r) => text(r, 'nameEn')),
            ColumnSpec(l10n.fullNameAr, value: (r) => text(r, 'nameAr')),
            ColumnSpec(
              l10n.permissions,
              numeric: true,
              value: (r) => '${listOf(r['permissions']).length}',
            ),
            ColumnSpec(
              l10n.status,
              value: (r) => flag(r, 'isSystem') ? l10n.systemRole : l10n.customRole,
            ),
          ],
          actions: (row) => [
            IconButton(
              tooltip: flag(row, 'isSystem')
                  ? l10n.permissionsNote
                  : l10n.setPermissions,
              icon: const Icon(Icons.rule_outlined, size: 20),
              onPressed: _busy ? null : () => _choosePermissions(row),
            ),
            IconButton(
              tooltip: l10n.edit,
              icon: const Icon(Icons.edit_outlined, size: 20),
              onPressed: _busy || flag(row, 'isSystem')
                  ? null
                  : () => _edit(existing: row),
            ),
            IconButton(
              tooltip: l10n.deleteRole,
              icon: const Icon(Icons.delete_outline, size: 20),
              onPressed: _busy || flag(row, 'isSystem')
                  ? null
                  : () => _remove(row),
            ),
          ],
        ),
      ),
    );
  }
}

/// Picks permissions from the catalogue the server publishes, grouped by the
/// module each permission belongs to.
class _PermissionsDialog extends ConsumerStatefulWidget {
  const _PermissionsDialog({required this.title, required this.selected});

  final String title;
  final Set<String> selected;

  @override
  ConsumerState<_PermissionsDialog> createState() => _PermissionsDialogState();
}

class _PermissionsDialogState extends ConsumerState<_PermissionsDialog> {
  late final Set<String> _selected = {...widget.selected};

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(permissionsProvider);

    return AlertDialog(
      title: Text(widget.title),
      content: SizedBox(
        width: 520,
        height: 480,
        child: async.when(
          loading: () => const LoadingView(),
          error: (error, _) => ErrorView(
            message: describeError(context, error),
            onRetry: () => ref.invalidate(permissionsProvider),
          ),
          data: (catalogue) {
            final items = listOf(catalogue['items']);
            final modules = (catalogue['modules'] as List? ?? const [])
                .map((e) => e.toString())
                .toList(growable: false);
            final isArabic =
                Localizations.localeOf(context).languageCode == 'ar';

            return ListView(
              children: [
                for (final module in modules)
                  _moduleSection(
                    module,
                    items
                        .where((p) => text(p, 'module') == module)
                        .toList(growable: false),
                    isArabic,
                  ),
              ],
            );
          },
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(_selected),
          child: Text(l10n.save),
        ),
      ],
    );
  }

  Widget _moduleSection(String module, List<Json> permissions, bool isArabic) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 12, bottom: 4),
          child: Text(
            module,
            style: Theme.of(context).textTheme.titleSmall,
          ),
        ),
        for (final permission in permissions)
          CheckboxListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            value: _selected.contains(text(permission, 'code')),
            title: Text(
              isArabic
                  ? text(permission, 'nameAr', fallback: text(permission, 'code'))
                  : text(permission, 'nameEn', fallback: text(permission, 'code')),
            ),
            subtitle: Text(text(permission, 'code')),
            onChanged: (checked) => setState(() {
              final code = text(permission, 'code');
              if (checked ?? false) {
                _selected.add(code);
              } else {
                _selected.remove(code);
              }
            }),
          ),
      ],
    );
  }
}

// ═════════════════════════════════════════════════════════ audit trail

class _AuditTab extends ConsumerStatefulWidget {
  const _AuditTab();

  @override
  ConsumerState<_AuditTab> createState() => _AuditTabState();
}

class _AuditTabState extends ConsumerState<_AuditTab> {
  final _action = TextEditingController();
  final _entity = TextEditingController();
  AsyncValue<Json> _state = const AsyncValue.loading();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _action.dispose();
    _entity.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _state = const AsyncValue.loading());
    try {
      final query = <String, dynamic>{'pageSize': 100};
      if (_action.text.trim().isNotEmpty) {
        query['action'] = _action.text.trim();
      }
      if (_entity.text.trim().isNotEmpty) {
        query['entity'] = _entity.text.trim();
      }
      final body = await ref
          .read(apiClientProvider)
          .getObject('/admin/audit-logs', query: query);
      if (mounted) setState(() => _state = AsyncValue.data(body));
    } catch (error, stack) {
      if (mounted) setState(() => _state = AsyncValue.error(error, stack));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return ModuleScaffold(
      title: l10n.auditTrail,
      actions: [ListExportActions(list: 'audit-trail')],
      trailing: Row(
        children: [
          SizedBox(
            width: 160,
            child: TextField(
              controller: _action,
              onSubmitted: (_) => _load(),
              decoration: InputDecoration(
                labelText: l10n.action,
                isDense: true,
                border: const OutlineInputBorder(),
              ),
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 160,
            child: TextField(
              controller: _entity,
              onSubmitted: (_) => _load(),
              decoration: InputDecoration(
                labelText: l10n.entity,
                isDense: true,
                border: const OutlineInputBorder(),
              ),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            tooltip: l10n.refresh,
            onPressed: _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: AsyncStateView<Json>(
        value: _state,
        onRetry: _load,
        isEmpty: (body) => listOf(body['items']).isEmpty,
        emptyMessage: l10n.noAuditLogs,
        data: (body) {
          final rows = listOf(body['items']);
          return RecordsTable(
            rows: rows,
            columns: [
              ColumnSpec(
                l10n.when,
                value: (r) => _moment(text(r, 'createdAt')) ?? '',
                emphasise: true,
              ),
              ColumnSpec(l10n.action, value: (r) => text(r, 'action')),
              ColumnSpec(
                l10n.entity,
                value: (r) =>
                    '${text(r, 'entity')}'
                    '${text(r, 'entityId').isEmpty ? '' : ' · ${text(r, 'entityId').substring(0, 8)}'}',
              ),
              ColumnSpec(
                l10n.by,
                value: (r) => text(r, 'username', fallback: '—'),
              ),
              ColumnSpec('IP', value: (r) => text(r, 'ipAddress')),
            ],
          );
        },
      ),
    );
  }
}

/// `2026-10-07T09:15:00.000Z` → `2026-10-07 09:15`. Null for an empty value.
String? _moment(String value) {
  if (value.isEmpty) return null;
  final cleaned = value.replaceFirst('T', ' ');
  return cleaned.length >= 16 ? cleaned.substring(0, 16) : cleaned;
}
