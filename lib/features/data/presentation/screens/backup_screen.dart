import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/config/app_config.dart';
import '../../../../core/platform/browser_actions.dart';
import '../../../../core/app/app_scope_restart.dart';
import '../../../../core/platform/picked_file.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../backup_record_labels.dart';
import '../providers/data_providers.dart';
import '../widgets/full_backup_section.dart';

/// Copying the company's books out, and putting a copy back.
///
/// The screen is deliberately two separate halves. Taking a copy is safe and
/// is one click. Putting one back replaces everything the company holds, so it
/// goes through a preview of exactly what is in the file and what would be
/// replaced, and the button that does it stays disabled until that preview has
/// been seen.
/// A numbered heading that makes the two halves of this screen impossible to
/// confuse: the company JSON backup, and the system backup/restore.
class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.number,
    required this.title,
    required this.subtitle,
  });

  final String number;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        CircleAvatar(
          radius: 14,
          backgroundColor: theme.colorScheme.primaryContainer,
          child: Text(
            number,
            style: theme.textTheme.labelLarge?.copyWith(
              color: theme.colorScheme.onPrimaryContainer,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: theme.textTheme.titleMedium),
              const SizedBox(height: 2),
              Text(subtitle, style: theme.textTheme.bodySmall),
            ],
          ),
        ),
      ],
    );
  }
}

class BackupScreen extends ConsumerStatefulWidget {
  const BackupScreen({super.key});

  @override
  ConsumerState<BackupScreen> createState() => _BackupScreenState();
}

class _BackupScreenState extends ConsumerState<BackupScreen> {
  PickedFile? _file;
  Map<String, dynamic>? _preview;
  Map<String, dynamic>? _restored;
  String? _failure;
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final summary = ref.watch(backupSummaryProvider);
    final environment = ref.watch(appConfigProvider).environment;
    // Installed product builds intentionally do not include the sample
    // company archive. Keep real backup/restore available in all modes.
    final showDemo = environment == AppEnvironment.development ||
        environment == AppEnvironment.staging;

    return ModuleScaffold(
      title: l10n.backupTitle,
      trailing: IconButton(
        tooltip: l10n.retry,
        icon: const Icon(Icons.refresh),
        onPressed: () {
          ref.invalidate(backupSummaryProvider);
          setState(() {
            _file = null;
            _preview = null;
            _restored = null;
            _failure = null;
          });
        },
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Section one: one company's books, as a JSON file. This is the
          // backup an accountant takes, and the only one that cannot touch
          // another company.
          _SectionHeader(
            number: '1',
            title: Localizations.localeOf(context).languageCode == 'ar'
                ? 'القسم الأول: نسخ واستعادة بيانات الشركة (JSON)'
                : 'Section one: back up and restore company data (JSON)',
            subtitle: l10n.takeBackupHint,
          ),
          const SizedBox(height: 8),
          _TakingCopy(summary: summary, onDownload: _download),
          const SizedBox(height: 16),
          if (showDemo) ...[
            _DemoBackupSection(onDownload: _downloadDemo),
            const SizedBox(height: 16),
          ],
          _Restoring(
            file: _file,
            preview: _preview,
            restored: _restored,
            failure: _failure,
            busy: _busy,
            onChoose: _choose,
            onInspect: _inspect,
            onRestore: _restore,
          ),
          const SizedBox(height: 24),
          // Section two: the whole installation. It carries its own heading
          // and warning, because it is the one operation that can replace
          // every company at once.
          const FullBackupSection(),
        ],
      ),
    );
  }

  Future<void> _download() => runDownload(
    context,
    ref.read(reportLinkProvider).backup(),
  );

  Future<void> _downloadDemo() => runDownload(
    context,
    ref.read(reportLinkProvider).demoBackup(),
  );

  Future<void> _choose() async {
    PickedFile? picked;
    try {
      picked = await pickFile(extensions: ['.json']);
    } catch (error) {
      if (!mounted) return;
      setState(() => _failure = describeApiError(error));
      return;
    }
    if (picked == null) return;

    final isDump = picked.name.toLowerCase().endsWith('.dump') ||
        (picked.bytes.length >= 5 &&
            String.fromCharCodes(picked.bytes.sublist(0, 5)) == 'PGDMP');
    if (isDump) {
      if (!mounted) return;
      setState(() {
        _file = null;
        _preview = null;
        _restored = null;
        _failure =
            'هذا الملف هو أرشيف قاعدة بيانات PostgreSQL (.dump) وليس ملف JSON خاص بالشركة.\n'
            'لاستعادة ملفات .dump بالكامل، يرجى استخدام القسم الثاني "النسخ الاحتياطي الكامل للنظام" أدناه.';
      });
      return;
    }

    setState(() {
      _file = picked;
      _preview = null;
      _restored = null;
      _failure = null;
    });
    await _inspect();
  }

  Future<void> _inspect() async {
    final file = _file;
    if (file == null) return;
    setState(() {
      _busy = true;
      _failure = null;
      _restored = null;
    });
    try {
      final preview = await ref.read(dataServiceProvider).inspectBackup(file);
      setState(() {
        _preview = preview;
        _busy = false;
      });
    } catch (error) {
      setState(() {
        _failure = describeApiError(error);
        _busy = false;
      });
    }
  }

  Future<void> _restore() async {
    final file = _file;
    if (file == null) return;

    final l10n = context.l10n;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.confirmRestoreTitle),
        content: Text(l10n.confirmRestoreBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.restoreNow),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() {
      _busy = true;
      _failure = null;
    });
    try {
      final result = await ref
          .read(dataServiceProvider)
          .restoreBackup(file, replace: true);
      final written = result['written'];
      final total = result['total'];
      final committedRows = written is Map
          ? written.values.fold<num>(
              0,
              (sum, count) => sum + (count is num ? count : 0),
            )
          : -1;
      if (written is! Map ||
          total is! num ||
          written.values.any((count) => count is! num || count < 0) ||
          committedRows != total) {
        throw const FormatException(
          'The server did not confirm the rows committed by the company restore.',
        );
      }
      setState(() {
        _restored = result;
        _busy = false;
        _preview = null;
      });
      // A successful 200 comes from the service's committed write transaction.
      // Clear this session and dispose every cached list/report/detail provider;
      // otherwise screens continue to show pre-restore values and look as if
      // the restore did nothing. The next screen load starts from the database.
      try {
        await ref.read(tokenStoreProvider).clear();
      } finally {
        restartAppScope();
      }
    } catch (error) {
      setState(() {
        _failure = describeApiError(error);
        _busy = false;
      });
    }
  }
}

class _TakingCopy extends StatelessWidget {
  const _TakingCopy({required this.summary, required this.onDownload});

  final AsyncValue<Map<String, dynamic>> summary;
  final Future<void> Function() onDownload;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.save_outlined),
                const SizedBox(width: 8),
                Text(l10n.takeBackup, style: theme.textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 8),
            Text(l10n.takeBackupHint, style: theme.textTheme.bodySmall),
            const SizedBox(height: 16),
            summary.when(
              loading: () => const LinearProgressIndicator(),
              error: (error, _) => Text(
                describeApiError(error),
                style: TextStyle(color: theme.colorScheme.error),
              ),
              data: (data) {
                final contains = data['contains'] is Map
                    ? Map<String, dynamic>.from(data['contains'] as Map)
                    : <String, dynamic>{};
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${data['companyName'] ?? ''}'.trim(),
                        style: theme.textTheme.titleSmall),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final entry in contains.entries)
                          Chip(
                            label: Text('${backupRecordLabel(entry.key.toString(), arabic: Localizations.localeOf(context).languageCode == 'ar')}: ${entry.value}'),
                            visualDensity: VisualDensity.compact,
                          ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '${l10n.recordsInTotal}: ${data['total'] ?? 0}',
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                );
              },
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: onDownload,
              icon: const Icon(Icons.download_outlined),
              label: Text(l10n.downloadBackup),
            ),
          ],
        ),
      ),
    );
  }

  /// The table names come from the database. A handful have a label the user
  /// recognises; the rest are shown as they are rather than hidden.
}

class _DemoBackupSection extends StatelessWidget {
  const _DemoBackupSection({required this.onDownload});

  final Future<void> Function() onDownload;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.science_outlined),
                const SizedBox(width: 8),
                Text(l10n.demoBackupTitle, style: theme.textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 8),
            Text(l10n.demoBackupHint, style: theme.textTheme.bodySmall),
            const SizedBox(height: 8),
            Text(l10n.demoLoginHint, style: theme.textTheme.bodySmall?.copyWith(
              fontWeight: FontWeight.w600,
            )),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: onDownload,
              icon: const Icon(Icons.download_outlined),
              label: Text(l10n.downloadDemoBackup),
            ),
          ],
        ),
      ),
    );
  }
}

class _Restoring extends StatelessWidget {
  const _Restoring({
    required this.file,
    required this.preview,
    required this.restored,
    required this.failure,
    required this.busy,
    required this.onChoose,
    required this.onInspect,
    required this.onRestore,
  });

  final PickedFile? file;
  final Map<String, dynamic>? preview;
  final Map<String, dynamic>? restored;
  final String? failure;
  final bool busy;
  final Future<void> Function() onChoose;
  final Future<void> Function() onInspect;
  final Future<void> Function() onRestore;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final belongs = preview?['belongsToThisCompany'] == true;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.restore_outlined),
                const SizedBox(width: 8),
                Text(l10n.restoreBackup, style: theme.textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 8),
            Card(
              color: scheme.errorContainer,
              margin: EdgeInsets.zero,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Icon(Icons.warning_amber_outlined, color: scheme.onErrorContainer),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        l10n.restoreWarning,
                        style: TextStyle(color: scheme.onErrorContainer),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            if (file == null)
              Text(l10n.restoreChooseFile, style: theme.textTheme.bodySmall)
            else
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.description_outlined),
                title: Text(file!.name),
                subtitle: Text(file!.readableSize),
              ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: busy ? null : onChoose,
                  icon: const Icon(Icons.folder_open_outlined),
                  label: Text(file == null ? l10n.chooseBackupFile : l10n.chooseAnotherFile),
                ),
                if (file != null)
                  OutlinedButton.icon(
                    onPressed: busy ? null : onInspect,
                    icon: const Icon(Icons.fact_check_outlined),
                    label: Text(l10n.inspectBackup),
                  ),
              ],
            ),
            if (busy) ...[
              const SizedBox(height: 12),
              const LinearProgressIndicator(),
            ],
            if (failure != null) ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  Icon(Icons.error_outline, color: scheme.error),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(failure!, style: TextStyle(color: scheme.error)),
                  ),
                ],
              ),
            ],
            if (preview != null) ...[
              const SizedBox(height: 16),
              Text(l10n.inBackupFile, style: theme.textTheme.titleSmall),
              const SizedBox(height: 8),
              _Counts(map: preview!['contains']),
              const SizedBox(height: 12),
              Text(l10n.inTheProgramNow, style: theme.textTheme.titleSmall),
              const SizedBox(height: 8),
              _Counts(map: preview!['current']),
              const SizedBox(height: 12),
              Text(
                '${l10n.backupTakenAt}: ${preview!['createdAt'] ?? ''}',
                style: theme.textTheme.bodySmall,
              ),
              if (!belongs) ...[
                const SizedBox(height: 12),
                Text(
                  l10n.backupOtherCompany,
                  style: TextStyle(color: scheme.error),
                ),
              ],
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: busy || !belongs ? null : onRestore,
                icon: const Icon(Icons.restore),
                label: Text(l10n.restoreNow),
              ),
            ],
            if (restored != null) ...[
              const SizedBox(height: 16),
              Row(
                children: [
                  Icon(Icons.check_circle_outline, color: scheme.primary),
                  const SizedBox(width: 8),
                  Text(l10n.restoreDone, style: theme.textTheme.titleSmall),
                ],
              ),
              const SizedBox(height: 8),
              _Counts(map: restored!['written']),
            ],
          ],
        ),
      ),
    );
  }
}

class _Counts extends StatelessWidget {
  const _Counts({required this.map});

  final dynamic map;

  @override
  Widget build(BuildContext context) {
    if (map is! Map || (map as Map).isEmpty) {
      return const Text('—');
    }
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final entry in (map as Map).entries)
          Chip(
            label: Text('${backupRecordLabel('${entry.key}', arabic: Localizations.localeOf(context).languageCode == 'ar')}: ${entry.value}'),
            visualDensity: VisualDensity.compact,
          ),
      ],
    );
  }

}
