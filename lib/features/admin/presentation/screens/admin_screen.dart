import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../../operations/ops_auto_create.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/router/draft_exit_guard.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../core/image/company_logo_image.dart';
import '../../../../core/platform/browser_actions.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
import '../../../../shared/widgets/form_sheet.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../auth/presentation/widgets/user_photo.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../providers/admin_providers.dart';
import '../../../data/presentation/widgets/list_export_actions.dart';

/// Administration: the users, the roles, and what the audit trail recorded.
///
/// The three belong together because they answer one question — who may do
/// what, and who actually did it.
class AdminScreen extends ConsumerStatefulWidget {
  const AdminScreen({super.key, this.navigationKey});
  final ValueKey<String>? navigationKey;

  @override
  ConsumerState<AdminScreen> createState() => _AdminScreenState();
}

class _AdminScreenState extends ConsumerState<AdminScreen> {
  final _exitRelay = DraftExitRelay();
  late final DraftExitGuard _exitGuard;
  int _pendingActions = 0;
  void _actionStarted() => _pendingActions++;
  void _actionFinished() => _pendingActions--;
  Future<bool> _canLeave() =>
      _pendingActions > 0 ? Future.value(false) : _exitRelay.canLeave();

  @override
  void initState() {
    super.initState();
    _exitGuard = ref.read(draftExitGuardProvider);
    final key = widget.navigationKey;
    if (key != null) _exitGuard.register(key, _canLeave);
  }

  @override
  void dispose() {
    final key = widget.navigationKey;
    if (key != null) _exitGuard.unregister(key, _canLeave);
    super.dispose();
  }

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
          Expanded(
            child: TabBarView(
              children: [
                _UsersTab(
                  exitRelay: _exitRelay,
                  actionStarted: _actionStarted,
                  actionFinished: _actionFinished,
                ),
                _RolesTab(
                  exitRelay: _exitRelay,
                  actionStarted: _actionStarted,
                  actionFinished: _actionFinished,
                ),
                const _AuditTab(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

Set<String>? _permissionCodes(Object? value) {
  if (value is! List || value.any((item) => item is! String || item.isEmpty)) {
    return null;
  }
  return value.cast<String>().toSet();
}

// ═════════════════════════════════════════════════════════════ users

class _UsersTab extends ConsumerStatefulWidget {
  const _UsersTab({
    required this.exitRelay,
    required this.actionStarted,
    required this.actionFinished,
  });
  final DraftExitRelay exitRelay;
  final VoidCallback actionStarted, actionFinished;

  @override
  ConsumerState<_UsersTab> createState() => _UsersTabState();
}

class _UsersTabState extends ConsumerState<_UsersTab> {
  String _query = '';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    opsRunAutoCreate(this, _edit);
  }

  /// The roles, as choices for the form. Read before the form opens so the
  /// dialog never appears empty.
  Future<List<FieldOption>> _roleOptions() async {
    // Read the locale before the await: the widget may be rebuilt meanwhile.
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final roles = await ref.read(rolesListProvider.future);
    final ids = [for (final role in roles) text(role, 'id')];
    if (ids.any((id) => id.isEmpty) || ids.toSet().length != ids.length) {
      throw const FormatException();
    }
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
    List<FieldOption> roles;
    try {
      roles = await _roleOptions();
    } catch (error) {
      if (mounted) showAppError(context, error);
      return;
    }
    if (!mounted) return;
    // The API returns `roles`, not `roleIds`. A missing initial selection
    // used to send [] on every edit and silently strip all existing roles.
    final rawRoles = existing?['roles'];
    final assigned = listOf(rawRoles);
    if (isEdit &&
        (rawRoles is! List ||
            rawRoles.length != assigned.length ||
            assigned.any((role) => text(role, 'id').isEmpty))) {
      // Never turn a malformed or incomplete response into a role removal.
      showAppError(context, const FormatException());
      return;
    }
    final roleIds = {for (final role in assigned) text(role, 'id')}.toList();
    for (final role in assigned) {
      final id = text(role, 'id');
      if (id.isNotEmpty && !roles.any((option) => option.value == id)) {
        roles.add(
          FieldOption(
            id,
            '${text(role, 'code')} — ${text(role, 'nameEn')} '
            '${Localizations.localeOf(context).languageCode == 'ar' ? '(غير متاح)' : '(unavailable)'}',
            enabled: false,
          ),
        );
      }
    }

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
          obscure: true,
        ),
      FieldSpec(
        'roleIds',
        l10n.roles,
        kind: FieldKind.multiSelect,
        options: roles,
      ),
      if (isEdit) FieldSpec('isActive', l10n.active, kind: FieldKind.toggle),
    ];

    String? createdUserId;
    final values = await showFormSheet(
      context,
      exitRelay: widget.exitRelay,
      title: isEdit ? l10n.editUser : l10n.newUser,
      fields: fields,
      initial: {...?existing, if (isEdit) 'roleIds': roleIds},
      onSubmit: (draft) async {
        try {
          final client = ref.read(apiClientProvider);
          final payload = Map<String, dynamic>.from(draft);
          final selected = (payload['roleIds'] as List).cast<String>().toSet();
          if (isEdit &&
              selected.length == roleIds.length &&
              selected.containsAll(roleIds)) {
            // Omission means unchanged on the server. This also avoids
            // overwriting a concurrent role change on a name-only edit.
            payload.remove('roleIds');
          } else if (isEdit) {
            payload['expectedRoleIds'] = roleIds;
          }
          if (isEdit && payload['isActive'] == existing['isActive']) {
            payload.remove('isActive');
          }
          if (isEdit) {
            await client.patch('/admin/users/${existing['id']}', body: payload);
          } else {
            final created = await client.post('/admin/users', body: payload);
            createdUserId = created['id'] is String ? created['id'] as String : null;
          }
        } catch (error) {
          throw UncertainFormSubmission(error);
        } finally {
          if (mounted) ref.invalidate(usersListProvider);
        }
      },
    );
    if (values != null && mounted) {
      showMessage(context, l10n.createdSuccessfully);
      if (createdUserId != null) {
        final arabic = Localizations.localeOf(context).languageCode == 'ar';
        final choose = await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: Text(arabic ? 'صورة المستخدم' : 'User photo'),
            content: Text(arabic ? 'هل تريد إضافة صورة لهذا الحساب الآن؟' : 'Add a photo to this account now?'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: Text(l10n.cancel)),
              FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text(arabic ? 'اختيار صورة' : 'Choose photo')),
            ],
          ),
        );
        if (choose == true && mounted) await _changePhoto({'id': createdUserId});
      }
    }
  }

  Future<void> _changePhoto(Json row) async {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    try {
      final picked = await pickFile(
        extensions: ['.png', '.jpg', '.jpeg', '.webp'],
      );
      if (picked == null || !mounted) return;
      final image = await normalizeCompanyLogo(picked.bytes);
      if (!mounted) return;
      await ref
          .read(apiClientProvider)
          .post(
            '/admin/users/${row['id']}/photo',
            body: FormData.fromMap({
              'file': MultipartFile.fromBytes(
                image,
                filename: 'profile-photo.png',
              ),
            }),
          );
      if (mounted) {
        final current = ref.read(currentUserProvider);
        if (current?.id == text(row, 'id')) {
          // The shell observes the same keyed provider, so the visible image
          // changes immediately when an administrator edits their own photo.
          ref.invalidate(
            userPhotoProvider((
              companyId: current!.companyId,
              userId: current.id,
            )),
          );
        }
        showMessage(context, arabic ? 'تم حفظ الصورة.' : 'Photo saved.');
      }
    } catch (error) {
      if (mounted) showAppError(context, error);
    }
  }

  Future<void> _editExtraPermissions(Json row) async {
    final l10n = context.l10n;
    final selected = _permissionCodes(row['extraPermissions']);
    if (selected == null) {
      showAppError(context, const FormatException());
      return;
    }
    final saved = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _PermissionsDialog(
        title: '${l10n.extraPermissions} — ${text(row, 'username')}',
        selected: selected,
        exitRelay: widget.exitRelay,
        onSubmit: (chosen) async {
          try {
            await ref
                .read(apiClientProvider)
                .patch(
                  '/admin/users/${row['id']}',
                  body: {
                    'extraPermissions': chosen.toList(growable: false),
                    'expectedExtraPermissions': selected.toList(
                      growable: false,
                    ),
                  },
                );
          } finally {
            if (mounted) ref.invalidate(usersListProvider);
          }
        },
      ),
    );
    if (saved == true && mounted) {
      showMessage(context, l10n.createdSuccessfully);
    }
  }

  /// The permissions this one person is explicitly refused.
  ///
  /// A deny is not the absence of a grant: it beats every role, which is the
  /// only way to stop one clerk posting when the whole finance role may.
  Future<void> _editDeniedPermissions(Json row) async {
    final l10n = context.l10n;
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final selected = _permissionCodes(row['deniedPermissions']);
    if (selected == null) {
      showAppError(context, const FormatException());
      return;
    }
    final saved = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _PermissionsDialog(
        title: '${arabic ? 'الصلاحيات المرفوضة' : 'Denied permissions'} — ${text(row, 'username')}',
        selected: selected,
        exitRelay: widget.exitRelay,
        onSubmit: (chosen) async {
          try {
            await ref
                .read(apiClientProvider)
                .patch(
                  '/admin/users/${row['id']}',
                  body: {
                    'deniedPermissions': chosen.toList(growable: false),
                    'expectedDeniedPermissions': selected.toList(growable: false),
                  },
                );
          } finally {
            if (mounted) ref.invalidate(usersListProvider);
          }
        },
      ),
    );
    if (saved == true && mounted) {
      showMessage(context, l10n.createdSuccessfully);
    }
  }

  /// What the person can actually do today, after roles, grants and denies.
  ///
  /// Asked of the server rather than computed here: the screen must not be able
  /// to disagree with the guard that will refuse the request.
  Future<void> _showEffectivePermissions(Json row) async {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    try {
      final data = await ref
          .read(apiClientProvider)
          .get('/admin/users/${row['id']}/effective-permissions');
      final permissions = (data['permissions'] as List?)?.cast<String>() ?? const <String>[];
      final denied = (data['denied'] as List?)?.cast<String>() ?? const <String>[];
      final roles = (data['roles'] as List?)?.cast<String>() ?? const <String>[];
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(
            '${arabic ? 'الصلاحيات الفعلية' : 'Effective permissions'} — ${text(row, 'username')}',
          ),
          content: SizedBox(
            width: 480,
            height: 420,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  arabic
                      ? '${permissions.length} صلاحية من ${roles.length} دور.'
                      : '${permissions.length} permission(s) from ${roles.length} role(s).',
                ),
                if (roles.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(roles.join(' · '), style: Theme.of(dialogContext).textTheme.bodySmall),
                ],
                if (denied.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    arabic ? 'مرفوضة: ${denied.length}' : 'Denied: ${denied.length}',
                    style: Theme.of(dialogContext).textTheme.bodySmall?.copyWith(
                      color: Theme.of(dialogContext).colorScheme.error,
                    ),
                  ),
                ],
                const Divider(),
                Expanded(
                  child: ListView(
                    children: [
                      for (final code in permissions)
                        ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(
                            denied.contains(code)
                                ? Icons.block_outlined
                                : Icons.check_circle_outline,
                            size: 18,
                          ),
                          title: Text(code),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: Text(context.l10n.close),
            ),
          ],
        ),
      );
    } catch (error) {
      if (mounted) showAppError(context, error);
    }
  }

  Future<void> _changePassword(Json row) async {
    final l10n = context.l10n;
    final values = await showFormSheet(
      context,
      exitRelay: widget.exitRelay,
      title: '${l10n.changePassword} — ${text(row, 'username')}',
      fields: [
        FieldSpec(
          'password',
          l10n.password,
          required: true,
          helper: l10n.passwordHelper,
          obscure: true,
        ),
      ],
      submitLabel: l10n.save,
      onSubmit: (draft) async {
        try {
          await ref
              .read(apiClientProvider)
              .post('/admin/users/${row['id']}/password', body: draft);
        } catch (error) {
          // A password response can be lost after sessions have been revoked.
          throw UncertainFormSubmission(error);
        } finally {
          if (mounted) ref.invalidate(usersListProvider);
        }
      },
    );
    if (values != null && mounted) showMessage(context, l10n.passwordChanged);
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

    final actionFinished = widget.actionFinished;
    widget.actionStarted();
    setState(() => _busy = true);
    try {
      final client = ref.read(apiClientProvider);
      if (isActive) {
        await client.post('/admin/users/${row['id']}/deactivate');
      } else {
        await client.patch(
          '/admin/users/${row['id']}',
          body: {'isActive': true},
        );
      }
      if (mounted) showMessage(context, l10n.createdSuccessfully);
    } catch (error) {
      if (mounted) showAppError(context, error);
    } finally {
      if (mounted) {
        // A failed response can follow a committed status change.
        ref.invalidate(usersListProvider);
        setState(() => _busy = false);
      }
      actionFinished();
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
            ColumnSpec(
              l10n.status,
              value: (r) => _status(r),
              tone: (r) => !flag(r, 'isActive', fallback: true)
                  ? AppTone.neutral
                  : flag(r, 'isSuperAdmin')
                  ? AppTone.info
                  : AppTone.success,
            ),
          ],
          actions: (row) => [
            IconButton(
              tooltip: isArabic ? 'تغيير الصورة' : 'Change photo',
              icon: const Icon(Icons.photo_camera_outlined, size: 20),
              onPressed: _busy ? null : () => _changePhoto(row),
            ),
            IconButton(
              tooltip: l10n.extraPermissions,
              icon: const Icon(Icons.rule_outlined, size: 20),
              onPressed: _busy ? null : () => _editExtraPermissions(row),
            ),
            IconButton(
              tooltip: l10n.edit,
              icon: const Icon(Icons.edit_outlined, size: 20),
              onPressed: _busy ? null : () => _edit(existing: row),
            ),
            IconButton(
              tooltip: 'الصلاحيات المرفوضة / Denied permissions',
              icon: const Icon(Icons.block_outlined, size: 20),
              onPressed: _busy ? null : () => _editDeniedPermissions(row),
            ),
            IconButton(
              tooltip: 'الصلاحيات الفعلية / Effective permissions',
              icon: const Icon(Icons.visibility_outlined, size: 20),
              onPressed: _busy ? null : () => _showEffectivePermissions(row),
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
  const _RolesTab({
    required this.exitRelay,
    required this.actionStarted,
    required this.actionFinished,
  });
  final DraftExitRelay exitRelay;
  final VoidCallback actionStarted, actionFinished;

  @override
  ConsumerState<_RolesTab> createState() => _RolesTabState();
}

class _RolesTabState extends ConsumerState<_RolesTab> {
  bool _busy = false;

  static const _categories = <FieldOption>[
    FieldOption('MANAGEMENT', 'الإدارة / Management'),
    FieldOption('FINANCE', 'المالية / Finance'),
    FieldOption('SALES', 'المبيعات / Sales'),
    FieldOption('PURCHASING', 'المشتريات / Purchasing'),
    FieldOption('INVENTORY', 'المخازن / Inventory'),
    FieldOption('CASH', 'الخزينة والبنوك / Cash & banks'),
    FieldOption('AUDIT', 'المراجعة والتقارير / Audit'),
    FieldOption('CUSTOM', 'مخصص / Custom'),
  ];

  /// Creates a role from another role's permissions, without its users.
  Future<void> _clone(Json source) async {
    final l10n = context.l10n;
    final values = await showFormSheet(
      context,
      exitRelay: widget.exitRelay,
      title: '${l10n.newRole} — ${text(source, 'code')}',
      fields: [
        FieldSpec(
          'code',
          l10n.roleCode,
          required: true,
          helper: '${text(source, 'code')}_COPY',
        ),
        FieldSpec('nameEn', l10n.fullNameEn, required: true),
        FieldSpec('nameAr', l10n.fullNameAr, required: true),
      ],
      initial: {
        'code': '${text(source, 'code')}_COPY',
        'nameEn': '${text(source, 'nameEn')} (copy)',
        'nameAr': '${text(source, 'nameAr')} (نسخة)',
      },
      onSubmit: (draft) async {
        try {
          await ref.read(apiClientProvider).post(
            '/admin/roles',
            body: {...draft, 'copyFromRoleId': text(source, 'id')},
          );
        } catch (error) {
          throw UncertainFormSubmission(error);
        } finally {
          if (mounted) ref.invalidate(rolesListProvider);
        }
      },
    );
    if (values != null && mounted) showMessage(context, l10n.createdSuccessfully);
  }

  /// Disables a role without removing it: its holders keep it, it grants
  /// nothing, and switching it back on restores exactly what it was.
  Future<void> _toggleActive(Json role) async {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final active = flag(role, 'isActive');
    final ok = await confirmAction(
      context,
      title: active
          ? (arabic ? 'تعطيل الدور' : 'Disable role')
          : (arabic ? 'تفعيل الدور' : 'Enable role'),
      message: active
          ? (arabic
                ? 'سيبقى الدور مع مستخدميه، لكنه لن يمنح أي صلاحية حتى يعاد تفعيله.'
                : 'The role keeps its users but grants nothing until it is enabled again.')
          : (arabic
                ? 'سيعود الدور لمنح صلاحياته كما كانت.'
                : 'The role will grant its permissions again as before.'),
      confirmLabel: active
          ? (arabic ? 'تعطيل' : 'Disable')
          : (arabic ? 'تفعيل' : 'Enable'),
      destructive: active,
    );
    if (!ok || !mounted) return;
    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).patch(
        '/admin/roles/${role['id']}',
        body: {'isActive': !active},
      );
      if (mounted) ref.invalidate(rolesListProvider);
    } catch (error) {
      if (mounted) showAppError(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _edit({Json? existing}) async {
    final l10n = context.l10n;
    final isEdit = existing != null;
    final values = await showFormSheet(
      context,
      exitRelay: widget.exitRelay,
      title: isEdit ? l10n.editRole : l10n.newRole,
      fields: [
        if (!isEdit) FieldSpec('code', l10n.roleCode, required: true),
        FieldSpec('nameEn', l10n.fullNameEn, required: true),
        FieldSpec('nameAr', l10n.fullNameAr, required: true),
        FieldSpec(
          'descriptionEn',
          'Description (English)',
          kind: FieldKind.multiline,
        ),
        FieldSpec(
          'descriptionAr',
          'الوصف (بالعربية)',
          kind: FieldKind.multiline,
        ),
        FieldSpec(
          'category',
          'المجموعة / Category',
          kind: FieldKind.select,
          options: _categories,
        ),
      ],
      initial: existing,
      onSubmit: (draft) async {
        try {
          final client = ref.read(apiClientProvider);
          if (isEdit) {
            await client.patch('/admin/roles/${existing['id']}', body: draft);
          } else {
            await client.post('/admin/roles', body: draft);
          }
        } catch (error) {
          throw UncertainFormSubmission(error);
        } finally {
          if (mounted) {
            ref.invalidate(rolesListProvider);
            ref.invalidate(usersListProvider);
          }
        }
      },
    );
    if (values != null && mounted) {
      showMessage(context, l10n.createdSuccessfully);
    }
  }

  Future<void> _choosePermissions(Json role) async {
    final l10n = context.l10n;
    final selected = _permissionCodes(role['permissions']);
    if (selected == null) {
      showAppError(context, const FormatException());
      return;
    }
    final saved = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => _PermissionsDialog(
        title:
            '${l10n.setPermissions} — '
            '${Localizations.localeOf(context).languageCode == 'ar' ? text(role, 'nameAr') : text(role, 'nameEn')}',
        selected: selected,
        exitRelay: widget.exitRelay,
        onSubmit: (chosen) async {
          try {
            await ref
                .read(apiClientProvider)
                .post(
                  '/admin/roles/${role['id']}/permissions',
                  body: {
                    'permissions': chosen.toList(growable: false),
                    'expectedPermissions': selected.toList(growable: false),
                  },
                );
          } finally {
            if (mounted) {
              ref.invalidate(rolesListProvider);
              ref.invalidate(usersListProvider);
            }
          }
        },
      ),
    );
    if (saved == true && mounted) {
      showMessage(context, l10n.createdSuccessfully);
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

    final actionFinished = widget.actionFinished;
    widget.actionStarted();
    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).delete('/admin/roles/${role['id']}');
      if (mounted) showMessage(context, l10n.createdSuccessfully);
    } catch (error) {
      if (mounted) showAppError(context, error);
    } finally {
      if (mounted) {
        ref.invalidate(rolesListProvider);
        ref.invalidate(usersListProvider);
        setState(() => _busy = false);
      }
      actionFinished();
    }
  }

  static String _categoryLabel(String category) {
    switch (category) {
      case 'MANAGEMENT':
        return 'الإدارة / Management';
      case 'FINANCE':
        return 'المالية / Finance';
      case 'SALES':
        return 'المبيعات / Sales';
      case 'PURCHASING':
        return 'المشتريات / Purchasing';
      case 'INVENTORY':
        return 'المخازن / Inventory';
      case 'CASH':
        return 'الخزينة / Cash';
      case 'AUDIT':
        return 'المراجعة / Audit';
      default:
        return 'مخصص / Custom';
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
              value: (r) {
                final permissions = _permissionCodes(r['permissions']);
                return permissions == null ? '—' : '${permissions.length}';
              },
            ),
            ColumnSpec(
              'المستخدمون / Users',
              numeric: true,
              value: (r) {
                final count = r['userCount'];
                return count is num ? '$count' : '—';
              },
            ),
            ColumnSpec(
              'المجموعة / Group',
              value: (r) => _categoryLabel(text(r, 'category')),
            ),
            ColumnSpec(
              l10n.status,
              value: (r) => !flag(r, 'isActive')
                  ? (Localizations.localeOf(context).languageCode == 'ar'
                        ? 'معطّل'
                        : 'Disabled')
                  : flag(r, 'isSystem')
                  ? l10n.systemRole
                  : l10n.customRole,
              tone: (r) => !flag(r, 'isActive')
                  ? AppTone.warning
                  : flag(r, 'isSystem')
                  ? AppTone.neutral
                  : AppTone.info,
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
              tooltip: 'نسخ الدور / Copy role',
              icon: const Icon(Icons.copy_all_outlined, size: 20),
              onPressed: _busy ? null : () => _clone(row),
            ),
            IconButton(
              tooltip: flag(row, 'isActive')
                  ? 'تعطيل / Disable'
                  : 'تفعيل / Enable',
              icon: Icon(
                flag(row, 'isActive')
                    ? Icons.pause_circle_outline
                    : Icons.play_circle_outline,
                size: 20,
              ),
              onPressed: _busy || text(row, 'code') == 'ADMIN'
                  ? null
                  : () => _toggleActive(row),
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
  const _PermissionsDialog({
    required this.title,
    required this.selected,
    required this.exitRelay,
    required this.onSubmit,
  });

  final String title;
  final Set<String> selected;
  final DraftExitRelay exitRelay;
  final Future<void> Function(Set<String>) onSubmit;

  @override
  ConsumerState<_PermissionsDialog> createState() => _PermissionsDialogState();
}

class _PermissionsDialogState extends ConsumerState<_PermissionsDialog> {
  late final Set<String> _selected = {...widget.selected};
  bool _saving = false, _uncertain = false, _confirmingExit = false;

  @override
  void initState() {
    super.initState();
    widget.exitRelay.attach(_leaveForRoute);
  }

  @override
  void dispose() {
    widget.exitRelay.detach(_leaveForRoute);
    super.dispose();
  }

  Future<bool> _canLeave() async {
    if (_saving || _confirmingExit) return false;
    if (_uncertain ||
        _selected.length != widget.selected.length ||
        !widget.selected.containsAll(_selected)) {
      _confirmingExit = true;
      try {
        final arabic = Localizations.localeOf(context).languageCode == 'ar';
        final ok = await confirmAction(
          context,
          title: arabic ? 'تغييرات غير محفوظة' : 'Unsaved changes',
          message: _uncertain
              ? (arabic
                    ? 'قد تكون العملية قد اكتملت. راجع الصلاحيات قبل التكرار.'
                    : 'The operation may have completed. Review permissions before retrying.')
              : (arabic
                    ? 'الخروج دون حفظ المدخلات؟'
                    : 'Leave without saving your changes?'),
          confirmLabel: arabic ? 'الخروج دون حفظ' : 'Discard changes',
          destructive: true,
        );
        if (!ok || !mounted) return false;
      } finally {
        _confirmingExit = false;
      }
    }
    return mounted;
  }

  Future<void> _close() async {
    if (await _canLeave() && mounted) Navigator.of(context).pop();
  }

  Future<bool> _leaveForRoute() async {
    if (!await _canLeave() || !mounted) return false;
    Navigator.of(context).pop();
    return true;
  }

  bool _validCatalogue(Json? catalogue) {
    final raw = catalogue?['items'];
    if (raw is! List) return false;
    final items = listOf(raw);
    if (raw.length != items.length ||
        items.any((item) => text(item, 'code').isEmpty)) {
      return false;
    }
    return {for (final item in items) text(item, 'code')}.length ==
        items.length;
  }

  Future<void> _submit() async {
    if (_saving ||
        _uncertain ||
        _confirmingExit ||
        !_validCatalogue(ref.read(permissionsProvider).asData?.value)) {
      return;
    }
    if (_selected.length == widget.selected.length &&
        widget.selected.containsAll(_selected)) {
      // A no-op must not replace newer grants read by another administrator.
      Navigator.of(context).pop(true);
      return;
    }
    setState(() => _saving = true);
    try {
      // The warnings come from the rules the server published with the
      // catalogue, applied here as the boxes are ticked, so the preview costs
      // no request and cannot disagree with the server: both read one list.
      final warnings = _warningsFor(_selected);
      if (warnings.isNotEmpty && mounted) {
        final proceed = await _confirmWarnings(warnings);
        if (!proceed) {
          setState(() => _saving = false);
          return;
        }
      }
      await widget.onSubmit(Set<String>.from(_selected));
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) {
        setState(() => _uncertain = true);
        await showAppError(context, error);
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// The warnings the server's published rules give for this set, in the
  /// person's language. A rule is an exact code or a prefix ending in a dot,
  /// and the catalogue is the only place those rules are written down.
  List<String> _warningsFor(Set<String> codes) {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final catalogue = ref.read(permissionsProvider).asData?.value;
    final warnings = <String>[];
    for (final rule in listOf(catalogue?['warnings'])) {
      final match = text(rule, 'match');
      if (match.isEmpty) continue;
      final hit = match.endsWith('.')
          ? codes.any((code) => code.startsWith(match))
          : codes.contains(match);
      if (!hit) continue;
      final message = arabic
          ? text(rule, 'messageAr', fallback: text(rule, 'messageEn'))
          : text(rule, 'messageEn', fallback: text(rule, 'messageAr'));
      if (message.isNotEmpty && !warnings.contains(message)) {
        warnings.add(message);
      }
    }
    return warnings;
  }

  Future<bool> _confirmWarnings(List<String> warnings) async {
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final answer = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(arabic ? 'راجع هذه الصلاحيات' : 'Review these permissions'),
        content: SizedBox(
          width: 460,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                arabic
                    ? 'هذه المجموعة تمنح ${_selected.length} صلاحية، ومنها ما يستحق مراجعة:'
                    : 'This set grants ${_selected.length} permission(s), and some deserve a second look:',
              ),
              const SizedBox(height: 8),
              for (final warning in warnings)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.warning_amber_rounded, size: 18),
                      const SizedBox(width: 8),
                      Expanded(child: Text(warning)),
                    ],
                  ),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(context.l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(arabic ? 'متابعة الحفظ' : 'Save anyway'),
          ),
        ],
      ),
    );
    return answer ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final async = ref.watch(permissionsProvider);

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _close();
      },
      child: AlertDialog(
        title: Text(widget.title),
        content: SizedBox(
          width: 520,
          height: 480,
          child: async.when(
            loading: () => const LoadingView(),
            error: (error, _) => ErrorView(
              message: error,
              onRetry: () => ref.invalidate(permissionsProvider),
            ),
            data: (catalogue) {
              if (!_validCatalogue(catalogue)) {
                return ErrorView(
                  message: const FormatException(),
                  onRetry: () => ref.invalidate(permissionsProvider),
                );
              }
              final items = listOf(catalogue['items']);
              final grouped = listOf(catalogue['modules']);
              final isArabic =
                  Localizations.localeOf(context).languageCode == 'ar';
              final sections = grouped.isNotEmpty
                  ? grouped
                        .map(
                          (m) => (text(m, 'module'), listOf(m['permissions'])),
                        )
                        .toList(growable: false)
                  : [
                      for (final module in {
                        for (final p in items) text(p, 'module'),
                      })
                        (
                          module,
                          items
                              .where((p) => text(p, 'module') == module)
                              .toList(growable: false),
                        ),
                    ];

              final known = {for (final item in items) text(item, 'code')};
              final unavailable = _selected.difference(known).toList()..sort();
              return AbsorbPointer(
                absorbing: _saving || _uncertain,
                child: Column(
                  children: [
                    if (_uncertain)
                      Text(
                        isArabic
                            ? 'قد تكون العملية قد اكتملت. راجع الصلاحيات قبل تكرار الحفظ.'
                            : 'The operation may have completed. Review permissions before saving again.',
                      ),
                    Wrap(
                      spacing: 8,
                      children: [
                        TextButton(
                          onPressed: () => setState(() {
                            _selected.addAll(items.map((p) => text(p, 'code')));
                          }),
                          child: Text(l10n.selectAll),
                        ),
                        TextButton(
                          onPressed: () => setState(_selected.clear),
                          child: Text(l10n.clearAll),
                        ),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
                          child: Text(
                            isArabic
                                ? '${_selected.length} محددة'
                                : '${_selected.length} selected',
                          ),
                        ),
                      ],
                    ),
                    if (_warningsFor(_selected).isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(Icons.warning_amber_rounded, size: 18),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                isArabic
                                    ? '${_warningsFor(_selected).length} من الصلاحيات المختارة تستحق مراجعة قبل الحفظ.'
                                    : '${_warningsFor(_selected).length} of the selected permissions deserve a second look before saving.',
                              ),
                            ),
                          ],
                        ),
                      ),
                    Expanded(
                      child: ListView(
                        children: [
                          for (final code in unavailable)
                            CheckboxListTile(
                              value: true,
                              title: Text(
                                isArabic
                                    ? 'صلاحية غير متاحة'
                                    : 'Unavailable permission',
                              ),
                              subtitle: Text(code),
                              onChanged: (_) =>
                                  setState(() => _selected.remove(code)),
                            ),
                          for (final section in sections)
                            _moduleSection(section.$1, section.$2, isArabic),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
        actions: [
          TextButton(
            onPressed: _saving ? null : _close,
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed:
                _saving || _uncertain || !_validCatalogue(async.asData?.value)
                ? null
                : _submit,
            child: Text(l10n.save),
          ),
        ],
      ),
    );
  }

  Widget _moduleSection(String module, List<Json> permissions, bool isArabic) {
    final l10n = context.l10n;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 12, bottom: 4),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  module,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
              TextButton(
                onPressed: () => setState(() {
                  for (final p in permissions) {
                    _selected.add(text(p, 'code'));
                  }
                }),
                child: Text(l10n.selectAll),
              ),
              TextButton(
                onPressed: () => setState(() {
                  for (final p in permissions) {
                    _selected.remove(text(p, 'code'));
                  }
                }),
                child: Text(l10n.clearAll),
              ),
            ],
          ),
        ),
        for (final permission in permissions)
          CheckboxListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            value: _selected.contains(text(permission, 'code')),
            title: Text(
              isArabic
                  ? text(
                      permission,
                      'nameAr',
                      fallback: text(permission, 'code'),
                    )
                  : text(
                      permission,
                      'nameEn',
                      fallback: text(permission, 'code'),
                    ),
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
  final _entity = TextEditingController();
  String? _actionFilter;
  String? _userFilter;
  DateTime? _from;
  DateTime? _to;
  List<Json> _users = const [];
  AsyncValue<Json> _state = const AsyncValue.loading();

  static const _actions = [
    'CREATE',
    'UPDATE',
    'DELETE',
    'POST',
    'REVERSE',
    'SUBMIT',
    'APPROVE',
    'CANCEL',
    'ACTIVATE',
    'DEACTIVATE',
    'DEPRECIATE',
    'DISPOSE',
    'INVOICE',
    'RECONCILE',
    'IMPORT',
    'BACKUP',
    'RESTORE',
    'RESET',
    'LOGIN',
    'LOGIN_FAILED',
    'LOGOUT',
  ];

  String _t(String ar, String en) =>
      Localizations.localeOf(context).languageCode == 'ar' ? ar : en;

  /// The trail stores action codes; the reader gets words.
  String _actionLabel(String code) {
    const ar = {
      'CREATE': 'إنشاء',
      'UPDATE': 'تعديل',
      'DELETE': 'حذف',
      'POST': 'ترحيل',
      'REVERSE': 'عكس',
      'SUBMIT': 'تقديم',
      'APPROVE': 'اعتماد',
      'CANCEL': 'إلغاء',
      'ACTIVATE': 'تفعيل',
      'DEACTIVATE': 'تعطيل',
      'DEPRECIATE': 'إهلاك',
      'DISPOSE': 'استبعاد',
      'INVOICE': 'فاتورة',
      'RECONCILE': 'تسوية',
      'IMPORT': 'استيراد',
      'BACKUP': 'نسخ احتياطي',
      'RESTORE': 'استعادة',
      'RESET': 'تصفير',
      'LOGIN': 'تسجيل دخول',
      'LOGIN_FAILED': 'فشل دخول',
      'LOGOUT': 'تسجيل خروج',
    };
    if (Localizations.localeOf(context).languageCode == 'ar') {
      return ar[code] ?? code;
    }
    return code
        .split('_')
        .map((w) => w.isEmpty ? w : '${w[0]}${w.substring(1).toLowerCase()}')
        .join(' ');
  }

  @override
  void initState() {
    super.initState();
    _load();
    _loadUsers();
  }

  @override
  void dispose() {
    _entity.dispose();
    super.dispose();
  }

  Future<void> _loadUsers() async {
    try {
      final body = await ref.read(apiClientProvider).getObject('/admin/users');
      if (mounted) setState(() => _users = listOf(body['items']));
    } catch (_) {
      // The user filter is a convenience; the trail itself still loads.
    }
  }

  String _isoDay(DateTime day) =>
      '${day.year.toString().padLeft(4, '0')}-'
      '${day.month.toString().padLeft(2, '0')}-'
      '${day.day.toString().padLeft(2, '0')}';

  Future<void> _load() async {
    setState(() => _state = const AsyncValue.loading());
    try {
      final query = <String, dynamic>{'pageSize': 100};
      if (_actionFilter != null) query['action'] = _actionFilter;
      if (_userFilter != null) query['userId'] = _userFilter;
      if (_entity.text.trim().isNotEmpty) {
        query['entity'] = _entity.text.trim();
      }
      if (_from != null) query['from'] = _isoDay(_from!);
      if (_to != null) query['to'] = _isoDay(_to!);
      final body = await ref
          .read(apiClientProvider)
          .getObject('/admin/audit-logs', query: query);
      if (mounted) setState(() => _state = AsyncValue.data(body));
    } catch (error, stack) {
      if (mounted) setState(() => _state = AsyncValue.error(error, stack));
    }
  }

  Future<void> _pickDate(bool isFrom) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: (isFrom ? _from : _to) ?? DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (picked == null) return;
    setState(() {
      if (isFrom) {
        _from = picked;
      } else {
        _to = picked;
      }
    });
    await _load();
  }

  void _showDetails(Json row) {
    String pretty(Object? value) {
      if (value == null) return '—';
      try {
        return const JsonEncoder.withIndent('  ').convert(value);
      } catch (_) {
        return value.toString();
      }
    }

    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_actionLabel(text(row, 'action'))),
        content: SizedBox(
          width: 560,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '${text(row, 'entity')} · ${text(row, 'entityId')}',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 4),
                Text(
                  '${_moment(text(row, 'createdAt')) ?? ''} · '
                  '${text(row, 'username', fallback: '—')} · '
                  '${text(row, 'ipAddress')}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 12),
                Text(
                  _t('بعد العملية', 'After'),
                  style: Theme.of(context).textTheme.labelLarge,
                ),
                SelectableText(
                  pretty(row['after']),
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                ),
                const SizedBox(height: 12),
                Text(
                  _t('قبل العملية', 'Before'),
                  style: Theme.of(context).textTheme.labelLarge,
                ),
                SelectableText(
                  pretty(row['before']),
                  style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
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
        ],
      ),
    );
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
            width: 150,
            child: DropdownButtonFormField<String?>(
              key: ValueKey(_actionFilter),
              initialValue: _actionFilter,
              isDense: true,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: l10n.action,
                isDense: true,
                border: const OutlineInputBorder(),
              ),
              items: [
                DropdownMenuItem<String?>(
                  value: null,
                  child: Text(_t('الكل', 'All')),
                ),
                for (final action in _actions)
                  DropdownMenuItem<String?>(
                    value: action,
                    child: Text(_actionLabel(action)),
                  ),
              ],
              onChanged: (value) {
                setState(() => _actionFilter = value);
                _load();
              },
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 150,
            child: DropdownButtonFormField<String?>(
              key: ValueKey(_userFilter),
              initialValue: _userFilter,
              isDense: true,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: _t('المستخدم', 'User'),
                isDense: true,
                border: const OutlineInputBorder(),
              ),
              items: [
                DropdownMenuItem<String?>(
                  value: null,
                  child: Text(_t('الكل', 'All')),
                ),
                for (final user in _users)
                  DropdownMenuItem<String?>(
                    value: text(user, 'id'),
                    child: Text(
                      text(user, 'username', fallback: text(user, 'id')),
                    ),
                  ),
              ],
              onChanged: (value) {
                setState(() => _userFilter = value);
                _load();
              },
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 140,
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
          const SizedBox(width: 4),
          TextButton.icon(
            onPressed: () => _pickDate(true),
            icon: const Icon(Icons.calendar_month_outlined, size: 18),
            label: Text(_from == null ? _t('من', 'From') : _isoDay(_from!)),
          ),
          TextButton.icon(
            onPressed: () => _pickDate(false),
            icon: const Icon(Icons.calendar_month_outlined, size: 18),
            label: Text(_to == null ? _t('إلى', 'To') : _isoDay(_to!)),
          ),
          if (_from != null || _to != null)
            IconButton(
              tooltip: _t('مسح التاريخ', 'Clear dates'),
              onPressed: () {
                setState(() {
                  _from = null;
                  _to = null;
                });
                _load();
              },
              icon: const Icon(Icons.clear, size: 18),
            ),
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
            onTap: _showDetails,
            columns: [
              ColumnSpec(
                l10n.when,
                value: (r) => _moment(text(r, 'createdAt')) ?? '',
                emphasise: true,
              ),
              ColumnSpec(
                l10n.action,
                value: (r) => _actionLabel(text(r, 'action')),
              ),
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
