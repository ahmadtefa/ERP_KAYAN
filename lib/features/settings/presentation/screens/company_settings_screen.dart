import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/image/company_logo_image.dart';
import '../../../../core/image/company_logo_url.dart';
import '../../../../core/platform/browser_actions.dart';
import '../../../../core/platform/picked_file.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/page_header.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../providers/company_providers.dart';

/// Company profile, logo and units — the records every report and document
/// is headed by. Editing needs `admin.company.manage`; the server checks.
class CompanySettingsScreen extends ConsumerWidget {
  const CompanySettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final profile = ref.watch(companyProfileProvider);

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
                    AsyncStateView<Map<String, dynamic>>(
                      value: profile,
                      onRetry: () =>
                          ref.read(companyProfileProvider.notifier).refresh(),
                      isEmpty: (map) => map.isEmpty,
                      emptyMessage: l10n.noData,
                      data: (data) => _ProfileCard(profile: data),
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
  const _ProfileCard({required this.profile});

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
  }

  @override
  void didUpdateWidget(_ProfileCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.profile != oldWidget.profile && !_saving) {
      final p = widget.profile;
      _code.text = '${p['code'] ?? ''}';
      _nameAr.text = '${p['nameAr'] ?? ''}';
      _nameEn.text = '${p['nameEn'] ?? ''}';
      _taxId.text = '${p['taxId'] ?? ''}';
      _phone.text = '${p['phone'] ?? ''}';
      _email.text = '${p['email'] ?? ''}';
      _address.text = '${p['address'] ?? ''}';
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
      ref.invalidate(companyProfileProvider);
    }
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(error ?? l10n.profileSaved)));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _LogoRow(
              hasLogo: widget.profile['hasLogo'] == true,
              logoUrl: widget.profile['logoUrl'] as String?,
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _code,
                    decoration: InputDecoration(labelText: l10n.companyCode),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                    controller: _taxId,
                    decoration: InputDecoration(labelText: l10n.taxId),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _nameAr,
              decoration: InputDecoration(labelText: l10n.nameArabic),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _nameEn,
              decoration: InputDecoration(labelText: l10n.nameEnglish),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _phone,
                    decoration: InputDecoration(labelText: l10n.phone),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                    controller: _email,
                    decoration: InputDecoration(labelText: l10n.email),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _address,
              decoration: InputDecoration(labelText: l10n.address),
            ),
            const SizedBox(height: 16),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: FilledButton(
                onPressed: _saving ? null : _save,
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
  const _LogoRow({required this.hasLogo, this.logoUrl});

  final bool hasLogo;

  /// The relative path the profile reports; [CompanyLogoUrl] resolves it
  /// against the address this client talks to.
  final String? logoUrl;

  @override
  ConsumerState<_LogoRow> createState() => _LogoRowState();
}

class _LogoRowState extends ConsumerState<_LogoRow> {
  bool _busy = false;

  Future<void> _upload() async {
    final l10n = context.l10n;
    PickedFile? picked;
    try {
      picked = await pickFile(
        extensions: ['.png', '.jpg', '.jpeg', '.webp'],
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('$error')));
      return;
    }
    if (picked == null || !mounted) return;

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
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(problem.tooLarge ? l10n.logoTooLarge : l10n.logoInvalid)),
      );
      return;
    }
    if (!mounted) return;

    setState(() => _busy = true);
    final error = await ref
        .read(companyProfileProvider.notifier)
        .uploadLogo(normalized);
    if (!mounted) return;
    setState(() => _busy = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          error == null
              ? l10n.logoUpdated
              : _localizedLogoError(
                  error,
                  tooLarge: l10n.logoTooLarge,
                  invalid: l10n.logoInvalid,
                ),
        ),
      ),
    );
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
    final l10n = context.l10n;
    setState(() => _busy = true);
    final error =
        await ref.read(companyProfileProvider.notifier).removeLogo();
    if (!mounted) return;
    setState(() => _busy = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(error ?? l10n.logoRemoved)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final url = resolveCompanyLogoUrl(
      ref.watch(appConfigProvider).apiBaseUrl,
      widget.logoUrl,
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
        TextButton.icon(
          onPressed: _busy ? null : _upload,
          icon: const Icon(Icons.upload, size: 18),
          label: Text(l10n.uploadLogo),
        ),
        if (widget.hasLogo)
          TextButton.icon(
            onPressed: _busy ? null : _remove,
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

  if (context.mounted) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(error ?? l10n.branchSaved)));
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
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error)));
  }
}
