import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/platform/browser_actions.dart';
import '../../../../core/platform/picked_file.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../providers/data_providers.dart';

/// Full-database backup and restore: «النسخ الاحتياطي والاستعادة».
///
/// This is the disaster-recovery half of the screen. Everything here happens
/// on the server — the files never leave it except when the person asks for
/// one — and every step reports exactly what happened:
///
///  * a backup is only reported as created after the file exists and was
///    read back for its size and format;
///  * a restore is refused without an explicit typed confirmation, takes a
///    safety backup first, and only says "done" after the server has
///    reconnected and checked the data;
///  * when the machine has no PostgreSQL tools, the buttons are not shown at
///    all and the reason is — nothing here is a dead button.
class FullBackupSection extends ConsumerStatefulWidget {
  const FullBackupSection({super.key});

  @override
  ConsumerState<FullBackupSection> createState() => _FullBackupSectionState();
}

class _FullBackupSectionState extends ConsumerState<FullBackupSection> {
  Map<String, dynamic>? _capabilities;
  List<Map<String, dynamic>> _files = const [];
  bool _busy = false;
  String? _notice;
  String? _failure;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _failure = null;
    });
    try {
      final service = ref.read(fullBackupServiceProvider);
      final capabilities = await service.capabilities();
      final files = await service.list();
      if (!mounted) return;
      setState(() {
        _capabilities = capabilities;
        _files = files;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _failure = describeApiError(error));
    }
  }

  Future<void> _createBackup() async {
    final l10n = context.l10n;
    setState(() {
      _busy = true;
      _notice = l10n.backupInProgress;
      _failure = null;
    });
    try {
      final result = await ref.read(fullBackupServiceProvider).create();
      final file = result['file'] as Map<String, dynamic>?;
      if (!mounted) return;
      setState(() {
        _notice = '${l10n.createdSuccessfully}'
            '${file == null ? '' : ': ${file['name']}'}';
      });
      await _load();
    } catch (error) {
      if (!mounted) return;
      setState(() => _failure = describeApiError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _download(String name) => runDownload(
    context,
    ref.read(reportLinkProvider).fullBackupDownload(name),
  );

  Future<void> _delete(String name) async {
    final l10n = context.l10n;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.deleteBackup),
        content: Text(l10n.deleteBackupConfirm(name)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.deleteBackup),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await ref.read(fullBackupServiceProvider).delete(name);
      await _load();
    } catch (error) {
      if (!mounted) return;
      setState(() => _failure = describeApiError(error));
    }
  }

  Future<void> _restore({PickedFile? file, String? fileName}) async {
    final l10n = context.l10n;

    // The warning is shown first, then the explicit typed confirmation —
    // twice, deliberately.
    final warned = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.confirmFullRestoreTitle),
        content: Text(l10n.restoreFullWarning),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.confirm),
          ),
        ],
      ),
    );
    if (warned != true || !mounted) return;

    final wordController = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.confirmFullRestoreTitle),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(l10n.confirmFullRestoreBody),
            const SizedBox(height: 12),
            TextField(
              controller: wordController,
              decoration: const InputDecoration(labelText: 'RESTORE'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            // The button only agrees when the person typed the word.
            onPressed: () => Navigator.of(
              dialogContext,
            ).pop(wordController.text.trim() == 'RESTORE'),
            child: Text(l10n.restoreFullDatabase),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() {
      _busy = true;
      _notice = null;
      _failure = null;
    });
    try {
      await ref.read(fullBackupServiceProvider).restore(
        file: file,
        fileName: fileName,
        confirm: true,
      );
      if (!mounted) return;
      setState(() => _notice = l10n.restoreFullDone);
      await _load();

      if (!mounted) return;
      final theme = Theme.of(context);
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogCtx) => AlertDialog(
          title: Row(
            children: [
              Icon(Icons.check_circle, color: theme.colorScheme.primary),
              const SizedBox(width: 8),
              const Text('تمت استعادة قاعدة البيانات بنجاح'),
            ],
          ),
          content: const Text(
            'تمت استعادة قاعدة البيانات الكاملة بنجاح واستبدال البيانات السابقة.\n\n'
            'لتحديث البيانات وعرضها داخل البرنامج، يجب تسجيل الدخول مجددًا باستخدام بيانات الدخول الموجودة في النسخة المستعادة.\n\n'
            'مثال للنسخة التجريبية (Demo Backup):\n'
            '• اسم المستخدم: admin\n'
            '• كلمة المرور: Admin@12345',
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.of(dialogCtx).pop(),
              child: const Text('تسجيل الدخول الآن'),
            ),
          ],
        ),
      );

      if (!mounted) return;
      await ref.read(authControllerProvider.notifier).signOut();
    } catch (error) {
      if (!mounted) return;
      setState(() => _failure = describeApiError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _uploadAndRestore() async {
    PickedFile? picked;
    try {
      picked = await pickFile(extensions: ['.dump', '.json']);
    } catch (error) {
      if (!mounted) return;
      setState(() => _failure = describeApiError(error));
      return;
    }
    if (picked == null) return;

    final isJson = picked.name.toLowerCase().endsWith('.json') ||
        (picked.bytes.isNotEmpty &&
            (picked.bytes.first == 0x7B /* '{' */ ||
                picked.bytes.first == 0x5B /* '[' */));
    if (isJson) {
      if (!mounted) return;
      setState(() {
        _failure =
            'هذا الملف هو ملف بيانات JSON وليس أرشيف قاعدة بيانات PostgreSQL (.dump).\n'
            'لاستيراد نسخ بيانات الشركة بصيغة JSON، يرجى استخدام قسم "استعادة نسخة احتياطية للشركة" أدناه.';
      });
      return;
    }

    await _restore(file: picked);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final capabilities = _capabilities;
    final toolsAvailable = capabilities?['available'] == true;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.fullBackupTitle,
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              l10n.fullBackupDescription,
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            if (capabilities == null)
              const LinearProgressIndicator()
            else if (!toolsAvailable) ...[
              // No tools on this machine: say so, and show nothing that
              // pretends to work.
              _Notice(
                icon: Icons.info_outline,
                color: theme.colorScheme.error,
                text:
                    '${l10n.fullBackupUnavailable}'
                    '${capabilities['reason'] == null ? '' : '\n${capabilities['reason']}'}',
              ),
            ] else ...[
              if (capabilities['maintenance'] is Map &&
                  (capabilities['maintenance'] as Map)['maintenance'] == true)
                _Notice(
                  icon: Icons.warning_amber_outlined,
                  color: theme.colorScheme.error,
                  text: l10n.maintenanceActive,
                ),
              Wrap(
                spacing: 12,
                runSpacing: 8,
                children: [
                  FilledButton.icon(
                    onPressed: _busy ? null : _createBackup,
                    icon: const Icon(Icons.save_alt),
                    label: Text(l10n.createFullBackup),
                  ),
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _uploadAndRestore,
                    icon: const Icon(Icons.restore),
                    label: Text(l10n.uploadDumpFile),
                  ),
                  OutlinedButton.icon(
                    onPressed: _busy ? null : _load,
                    icon: const Icon(Icons.refresh),
                    label: Text(l10n.refreshStatus),
                  ),
                ],
              ),
            ],
            if (_notice != null) ...[
              const SizedBox(height: 12),
              _Notice(
                icon: Icons.check_circle_outline,
                color: theme.colorScheme.primary,
                text: _notice!,
              ),
            ],
            if (_failure != null) ...[
              const SizedBox(height: 12),
              _Notice(
                icon: Icons.error_outline,
                color: theme.colorScheme.error,
                text: _failure!,
              ),
            ],
            if (_files.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(
                l10n.backupFiles,
                style: theme.textTheme.titleSmall,
              ),
              const SizedBox(height: 8),
              for (final file in _files)
                ListTile(
                  dense: true,
                  leading: const Icon(Icons.archive_outlined),
                  title: Text('${file['name']}'),
                  subtitle: Text(
                    '${file['kind'] == 'safety' ? l10n.safetyBackup : l10n.fullBackupKind}'
                    ' · ${file['sizeBytes']} ${l10n.sizeLabel}',
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        tooltip: l10n.downloadBackup,
                        icon: const Icon(Icons.download_outlined, size: 20),
                        onPressed: _busy
                            ? null
                            : () => _download('${file['name']}'),
                      ),
                      IconButton(
                        tooltip: l10n.restoreFullDatabase,
                        icon: const Icon(Icons.restore, size: 20),
                        onPressed: _busy
                            ? null
                            : () => _restore(fileName: '${file['name']}'),
                      ),
                      IconButton(
                        tooltip: l10n.deleteBackup,
                        icon: const Icon(Icons.delete_outline, size: 20),
                        onPressed: _busy
                            ? null
                            : () => _delete('${file['name']}'),
                      ),
                    ],
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({
    required this.icon,
    required this.color,
    required this.text,
  });

  final IconData icon;
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: color, size: 20),
        const SizedBox(width: 8),
        Expanded(child: Text(text)),
      ],
    );
  }
}
