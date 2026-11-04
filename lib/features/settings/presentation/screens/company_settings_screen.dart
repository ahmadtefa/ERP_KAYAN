import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/router/draft_exit_guard.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../core/image/company_logo_image.dart';
import '../../../../core/image/company_logo_url.dart';
import '../../../../core/platform/browser_actions.dart';
import '../../../../core/platform/picked_file.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/page_header.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../providers/company_providers.dart';

/// Company profile, logo and units — the records every report and document
/// is headed by. Profile and logo edits require super admin on the server.
class CompanySettingsScreen extends ConsumerStatefulWidget {
  const CompanySettingsScreen({super.key, this.navigationKey});
  final ValueKey<String>? navigationKey;
  @override
  ConsumerState<CompanySettingsScreen> createState() => _CompanySettingsScreenState();
}

class _CompanySettingsScreenState extends ConsumerState<CompanySettingsScreen> {
  GlobalKey<_ProfileCardState> _profileKey = GlobalKey<_ProfileCardState>();
  late final DraftExitGuard _exitGuard;
  Map<String,dynamic>? _lastProfile;
  String? _scope;
  bool _confirming = false;

  @override
  void initState() {
    super.initState();
    _exitGuard = ref.read(draftExitGuardProvider);
    final key = widget.navigationKey;
    if (key != null) _exitGuard.register(key, _confirmExit);
  }
  @override
  void dispose() {
    final key = widget.navigationKey;
    if (key != null) _exitGuard.unregister(key, _confirmExit);
    super.dispose();
  }
  Future<bool> _confirmExit() async {
    final card = _profileKey.currentState;
    if (card == null) return true;
    if (card.busy || _confirming) return false;
    if (!card.dirty) return true;
    _confirming = true;
    try {
      final ar = Localizations.localeOf(context).languageCode == 'ar';
      return await confirmAction(context, title: ar ? 'تغييرات غير محفوظة' : 'Unsaved changes',
        message: ar ? 'الخروج دون حفظ بيانات الشركة؟' : 'Leave without saving the company profile?',
        confirmLabel: ar ? 'خروج' : 'Discard', destructive:true);
    } finally { _confirming = false; }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final user = ref.watch(currentUserProvider);
    final scope = user == null ? null : '${user.companyId}/${user.id}';
    if (_scope != scope) {
      _scope = scope;
      _lastProfile = null;
      _profileKey = GlobalKey<_ProfileCardState>();
    }
    final profile = ref.watch(companyProfileProvider);
    final loaded = profile.asData?.value;
    // Never carry a previous company's fields across a session switch.
    if (loaded != null && user != null && loaded['id'] == user.companyId) _lastProfile = loaded;
    final shown = _lastProfile;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PageHeader(title: l10n.companySettings),
        Container(
          height: 1,
          color: Theme.of(context).colorScheme.outlineVariant,
        ),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.xxl),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1080),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      l10n.companyProfile,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    if (shown != null) ...[
                      _ProfileCard(key:_profileKey,profile:shown),
                      if (profile.hasError) TextButton(
                        onPressed:() => ref.read(companyProfileProvider.notifier).refresh(),
                        child:Text(Localizations.localeOf(context).languageCode == 'ar'
                          ? 'تعذر التحديث — إعادة المحاولة' : 'Refresh failed — retry')),
                    ] else AsyncStateView<Map<String, dynamic>>(
                      value: profile,
                      onRetry: () => ref.read(companyProfileProvider.notifier).refresh(),
                      isEmpty: (map) => map.isEmpty || user == null || map['id'] != user.companyId,
                      emptyMessage: l10n.noData,
                      data: (data) => _ProfileCard(key:_profileKey,profile:data),
                    ),
                    const SizedBox(height: AppSpacing.xxl),
                    Text(
                      l10n.branches,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    const _BranchesCard(),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _ProfileCard extends ConsumerStatefulWidget {
  const _ProfileCard({super.key, required this.profile});

  final Map<String, dynamic> profile;

  @override
  ConsumerState<_ProfileCard> createState() => _ProfileCardState();
}

class _ProfileCardState extends ConsumerState<_ProfileCard> {
  late final TextEditingController _code;
  late final TextEditingController _nameAr;
  late final TextEditingController _nameEn;
  late final TextEditingController _taxId;
  late final TextEditingController _phone;
  late final TextEditingController _email;
  late final TextEditingController _address;
  bool _saving = false;
  bool _externalChange = false;
  late String _savedSnapshot;
  final _logoKey = GlobalKey<_LogoRowState>();
  String _snapshot() => jsonEncode([_code.text,_nameAr.text,_nameEn.text,_taxId.text,_phone.text,_email.text,_address.text]);
  String _profileSnapshot(Map<String,dynamic> p) => jsonEncode([
    for (final field in ['code','nameAr','nameEn','taxId','phone','email','address']) '${p[field] ?? ''}',
  ]);
  bool get dirty => _snapshot() != _savedSnapshot;
  bool get busy => _saving || (_logoKey.currentState?._busy ?? false);

  void _applyProfile(Map<String,dynamic> p) {
    _code.text = '${p['code'] ?? ''}';
    _nameAr.text = '${p['nameAr'] ?? ''}';
    _nameEn.text = '${p['nameEn'] ?? ''}';
    _taxId.text = '${p['taxId'] ?? ''}';
    _phone.text = '${p['phone'] ?? ''}';
    _email.text = '${p['email'] ?? ''}';
    _address.text = '${p['address'] ?? ''}';
    _savedSnapshot = _snapshot();
    _externalChange = false;
  }

  @override
  void initState() {
    super.initState();
    final p = widget.profile;
    _code = TextEditingController(text: '${p['code'] ?? ''}');
    _nameAr = TextEditingController(text: '${p['nameAr'] ?? ''}');
    _nameEn = TextEditingController(text: '${p['nameEn'] ?? ''}');
    _taxId = TextEditingController(text: '${p['taxId'] ?? ''}');
    _phone = TextEditingController(text: '${p['phone'] ?? ''}');
    _email = TextEditingController(text: '${p['email'] ?? ''}');
    _address = TextEditingController(text: '${p['address'] ?? ''}');
    _savedSnapshot = _snapshot();
  }

  @override
  void didUpdateWidget(_ProfileCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.profile != oldWidget.profile && !_saving) {
      if (dirty) {
        // A logo-only refresh must not erase typed fields. A real remote
        // profile change requires an explicit reload before writing over it.
        if (_profileSnapshot(widget.profile) != _savedSnapshot) _externalChange = true;
      } else {
        _applyProfile(widget.profile);
      }
    }
  }

  @override
  void dispose() {
    _code.dispose();
    _nameAr.dispose();
    _nameEn.dispose();
    _taxId.dispose();
    _phone.dispose();
    _email.dispose();
    _address.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (busy || _externalChange) return;
    setState(() => _saving = true);
    final error = await ref.read(companyProfileProvider.notifier).updateProfile(
      {
        'code': _code.text.trim(),
        'nameAr': _nameAr.text.trim(),
        'nameEn': _nameEn.text.trim(),
        'taxId': _taxId.text.trim(),
        'phone': _phone.text.trim(),
        'email': _email.text.trim(),
        'address': _address.text.trim(),
      },
    );
    if (!mounted) return;
    setState(() => _saving = false);
    final l10n = context.l10n;
    if (error == null) {
      _savedSnapshot = _snapshot();
      ref.invalidate(companyProfileProvider);
      showMessage(context, l10n.profileSaved);
    } else {
      showMessage(context, error, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final canEdit = ref.watch(currentUserProvider)?.isSuperAdmin == true;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _LogoRow(
              key:_logoKey,
              profileSaving:_saving,
              onBusyChanged:() { if (mounted) setState(() {}); },
              hasLogo: widget.profile['hasLogo'] == true,
              logoUrl: widget.profile['logoUrl'] as String?,
              companyId: widget.profile['id'] as String?,
              canEdit: canEdit,
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _code,
                    enabled: canEdit && !_saving,
                    decoration: InputDecoration(labelText: l10n.companyCode),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                    controller: _taxId,
                    enabled: canEdit && !_saving,
                    decoration: InputDecoration(labelText: l10n.taxId),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _nameAr,
              enabled: canEdit && !_saving,
              decoration: InputDecoration(labelText: l10n.nameArabic),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _nameEn,
              enabled: canEdit && !_saving,
              decoration: InputDecoration(labelText: l10n.nameEnglish),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _phone,
                    enabled: canEdit && !_saving,
                    decoration: InputDecoration(labelText: l10n.phone),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                    controller: _email,
                    enabled: canEdit && !_saving,
                    decoration: InputDecoration(labelText: l10n.email),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _address,
              enabled: canEdit && !_saving,
              decoration: InputDecoration(labelText: l10n.address),
            ),
            const SizedBox(height: 16),
            if (_externalChange) ...[
              Text(Localizations.localeOf(context).languageCode == 'ar'
                ? 'تغيرت بيانات الشركة على الخادم. احتفظ بمدخلاتك أو أعد تحميل البيانات قبل الحفظ.'
                : 'The company profile changed on the server. Keep your input or reload before saving.'),
              TextButton(key:const Key('company-profile-reload-conflict'),onPressed:() async {
                final ar = Localizations.localeOf(context).languageCode == 'ar';
                final accepted = await confirmAction(context,
                  title: ar ? 'تغييرات غير محفوظة' : 'Unsaved changes',
                  message: ar ? 'تجاهل المدخلات وتحميل بيانات الشركة من الخادم؟' : 'Discard your input and reload the company profile?',
                  confirmLabel: ar ? 'تجاهل' : 'Discard',destructive:true);
                if (accepted && mounted) setState(() => _applyProfile(widget.profile));
              },child:Text(Localizations.localeOf(context).languageCode == 'ar' ? 'تحميل بيانات الخادم' : 'Reload server data')),
            ],
            if (canEdit) Align(
              alignment: AlignmentDirectional.centerEnd,
              child: FilledButton(
                onPressed: busy || _externalChange ? null : _save,
                child: _saving
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(l10n.save),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LogoRow extends ConsumerStatefulWidget {
  const _LogoRow({
    super.key,
    required this.hasLogo,
    required this.canEdit,
    required this.profileSaving,
    required this.onBusyChanged,
    this.logoUrl,
    this.companyId,
  });

  final bool hasLogo;
  final bool canEdit;
  final bool profileSaving;
  final VoidCallback onBusyChanged;

  /// The relative path the profile reports; [companyLogoUrl] resolves it
  /// against the address this client talks to.
  final String? logoUrl;
  final String? companyId;

  @override
  ConsumerState<_LogoRow> createState() => _LogoRowState();
}

class _LogoRowState extends ConsumerState<_LogoRow> {
  bool _busy = false;
  void _setBusy(bool value) {
    setState(() => _busy = value);
    widget.onBusyChanged();
  }

  Future<void> _upload() async {
    if (_busy || widget.profileSaving) return;
    final l10n = context.l10n;
    PickedFile? picked;
    try {
      picked = await pickFile(
        extensions: ['.png', '.jpg', '.jpeg', '.webp'],
      );
    } catch (error) {
      if (!mounted) return;
      showMessage(context, '$error', error: true);
      return;
    }
    if (picked == null || !mounted || widget.profileSaving) return;

    late final PickedFile normalized;
    try {
      final bytes = await normalizeCompanyLogo(picked.bytes);
      normalized = PickedFile(
        name: 'company-logo.png',
        bytes: bytes,
        mimeType: 'image/png',
      );
    } on CompanyLogoImageException catch (problem) {
      if (!mounted) return;
      showMessage(
        context,
        problem.tooLarge ? l10n.logoTooLarge : l10n.logoInvalid,
        error: true,
      );
      return;
    }
    if (!mounted || widget.profileSaving) return;

    _setBusy(true);
    final error = await ref
        .read(companyProfileProvider.notifier)
        .uploadLogo(normalized);
    if (!mounted) return;
    _setBusy(false);
    if (error == null) {
      showMessage(context, l10n.logoUpdated);
    } else {
      showMessage(
        context,
        _localizedLogoError(
          error,
          tooLarge: l10n.logoTooLarge,
          invalid: l10n.logoInvalid,
        ),
        error: true,
      );
    }
  }

  String _localizedLogoError(
    String error, {
    required String tooLarge,
    required String invalid,
  }) {
    final lower = error.toLowerCase();
    if (lower.contains('larger than') || lower.contains('too large')) {
      return tooLarge;
    }
    if (lower.contains('logo') ||
        lower.contains('image') ||
        lower.contains('webp') ||
        lower.contains('png') ||
        lower.contains('jpeg')) {
      return invalid;
    }
    return error;
  }

  Future<void> _remove() async {
    if (_busy || widget.profileSaving) return;
    final l10n = context.l10n;
    _setBusy(true);
    final error =
        await ref.read(companyProfileProvider.notifier).removeLogo();
    if (!mounted) return;
    _setBusy(false);
    if (error == null) {
      showMessage(context, l10n.logoRemoved);
    } else {
      showMessage(context, error, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final url = companyLogoUrl(
      ref.watch(appConfigProvider).apiBaseUrl,
      {
        'id': widget.companyId,
        'logoUrl': widget.logoUrl,
        'hasLogo': widget.hasLogo,
      },
    );
    return Row(
      children: [
        CircleAvatar(
          radius: 28,
          backgroundColor: Theme.of(context)
              .colorScheme
              .surfaceContainerHighest,
          child: url == null
              ? Icon(
                  widget.hasLogo ? Icons.business : Icons.business_outlined,
                  size: 28,
                )
              : ClipOval(
                  child: Image.network(
                    url,
                    width: 56,
                    height: 56,
                    fit: BoxFit.contain,
                    errorBuilder: (_, _, _) => Icon(
                      widget.hasLogo ? Icons.business : Icons.business_outlined,
                      size: 28,
                    ),
                  ),
                ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                widget.hasLogo ? l10n.companyLogo : l10n.noLogo,
                style: Theme.of(context).textTheme.titleSmall,
              ),
              Text(l10n.logoHint, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
        if (widget.canEdit) TextButton.icon(
          onPressed: _busy || widget.profileSaving ? null : _upload,
          icon: const Icon(Icons.upload, size: 18),
          label: Text(l10n.uploadLogo),
        ),
        if (widget.canEdit && widget.hasLogo)
          TextButton.icon(
            onPressed: _busy || widget.profileSaving ? null : _remove,
            icon: const Icon(Icons.delete_outline, size: 18),
            label: Text(l10n.removeLogo),
          ),
      ],
    );
  }
}

class _BranchesCard extends ConsumerWidget {
  const _BranchesCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final branches = ref.watch(branchesProvider);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: FilledButton.icon(
                onPressed: () => _editBranch(context, ref, null),
                icon: const Icon(Icons.add),
                label: Text(l10n.newBranch),
              ),
            ),
            AsyncStateView<List<Map<String, dynamic>>>(
              value: branches,
              onRetry: () => ref.read(branchesProvider.notifier).refresh(),
              isEmpty: (list) => list.isEmpty,
              emptyMessage: l10n.noData,
              data: (list) => Column(
                children: [
                  for (final branch in list)
                    ListTile(
                      leading: Icon(
                        branch['kind'] == 'HEADQUARTERS'
                            ? Icons.account_balance
                            : Icons.storefront_outlined,
                      ),
                      title: Text(
                        '${branch['code']} — ${branch['nameAr'] ?? branch['nameEn']}',
                      ),
                      subtitle: Text(
                        branch['kind'] == 'HEADQUARTERS'
                            ? l10n.headquarters
                            : l10n.branchUnit,
                      ),
                      trailing: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          IconButton(
                            tooltip: l10n.editBranch,
                            icon: const Icon(Icons.edit_outlined, size: 20),
                            onPressed: () => _editBranch(context, ref, branch),
                          ),
                          IconButton(
                            tooltip: l10n.deleteBranch,
                            icon: const Icon(Icons.delete_outline, size: 20),
                            onPressed: () =>
                                _deleteBranch(context, ref, branch),
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
    );
  }
}

Future<void> _editBranch(
  BuildContext context,
  WidgetRef ref,
  Map<String, dynamic>? existing,
) async {
  final l10n = context.l10n;
  final codeController = TextEditingController(
    text: '${existing?['code'] ?? ''}',
  );
  final nameArController = TextEditingController(
    text: '${existing?['nameAr'] ?? ''}',
  );
  final nameEnController = TextEditingController(
    text: '${existing?['nameEn'] ?? ''}',
  );
  var kind = '${existing?['kind'] ?? 'BRANCH'}';
  String? parent = existing?['parentBranchId'] as String?;
  final branches =
      ref.read(branchesProvider).value ?? const <Map<String, dynamic>>[];

  final saved = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (dialogContext, setDialogState) => AlertDialog(
        title: Text(existing == null ? l10n.newBranch : l10n.editBranch),
        content: SizedBox(
          width: 480,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: codeController,
                  enabled: existing == null,
                  decoration: InputDecoration(labelText: l10n.branchCode),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: nameArController,
                  decoration: InputDecoration(labelText: l10n.nameArabic),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: nameEnController,
                  decoration: InputDecoration(labelText: l10n.nameEnglish),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: kind,
                  decoration: InputDecoration(labelText: l10n.branchKind),
                  items: [
                    DropdownMenuItem(
                      value: 'HEADQUARTERS',
                      child: Text(l10n.headquarters),
                    ),
                    DropdownMenuItem(
                      value: 'BRANCH',
                      child: Text(l10n.branchUnit),
                    ),
                  ],
                  onChanged: (value) =>
                      setDialogState(() => kind = value ?? 'BRANCH'),
                ),
                if (kind == 'BRANCH') ...[
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String?>(
                    initialValue: parent,
                    decoration: InputDecoration(labelText: l10n.parentUnit),
                    items: [
                      DropdownMenuItem<String?>(
                        value: null,
                        child: Text(l10n.parentAccountHelper),
                      ),
                      for (final b in branches)
                        if (b['id'] != existing?['id'])
                          DropdownMenuItem<String?>(
                            value: b['id'] as String?,
                            child: Text(
                              '${b['code']} — ${b['nameAr'] ?? b['nameEn']}',
                            ),
                          ),
                    ],
                    onChanged: (value) => setDialogState(() => parent = value),
                  ),
                ],
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.save),
          ),
        ],
      ),
    ),
  );
  if (saved != true || !context.mounted) return;

  final body = <String, dynamic>{
    'nameAr': nameArController.text.trim(),
    'nameEn': nameEnController.text.trim(),
    'kind': kind,
    if (kind == 'BRANCH' && parent != null) 'parentBranchId': parent,
  };

  final controller = ref.read(branchesProvider.notifier);
  final error = existing == null
      ? await controller.create({'code': codeController.text.trim(), ...body})
      : await controller.updateBranch('${existing['id']}', body);

  if (!context.mounted) return;
  if (error == null) {
    showMessage(context, l10n.branchSaved);
  } else {
    showMessage(context, error, error: true);
  }
}

Future<void> _deleteBranch(
  BuildContext context,
  WidgetRef ref,
  Map<String, dynamic> branch,
) async {
  final l10n = context.l10n;
  final name = '${branch['nameAr'] ?? branch['nameEn']}';
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(l10n.deleteBranch),
      content: Text(l10n.deleteBranchConfirm(name)),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: Text(l10n.deleteBranch),
        ),
      ],
    ),
  );
  if (confirmed != true || !context.mounted) return;

  final error = await ref
      .read(branchesProvider.notifier)
      .remove('${branch['id']}');
  if (context.mounted && error != null) {
    showMessage(context, error, error: true);
  }
}
