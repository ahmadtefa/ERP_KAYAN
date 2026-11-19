import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/platform/browser_actions.dart';
import '../../../../core/platform/picked_file.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../providers/data_providers.dart';

/// Bilingual text for the parts of this section that are about the system as
/// a whole.
///
/// The section speaks both languages for the same reason the warning does: the
/// person who has to restore a machine at midnight should not have to guess
/// which sentence is the important one.
String _t(BuildContext context, String ar, String en) {
  final language = Localizations.localeOf(context).languageCode;
  return language == 'ar' ? ar : en;
}

/// System backup and restore: the disaster-recovery half of the screen.
///
/// Two things live here, and they are deliberately shown as two:
///
///  * a **complete system backup** — one archive holding the database, the
///    uploaded files, the settings, the licence state and a manifest with the
///    SHA-256 of every file. It can be verified, downloaded, and restored;
///  * a **database archive** (`.dump`) — the whole PostgreSQL database only.
///    It carries no uploaded files and no licence record, which is why it is
///    presented as the smaller thing it is.
///
/// A restore replaces every company on the installation, so the screen never
/// offers it quietly: the warning comes first, then the typed word `RESTORE`,
/// and the button itself only exists when this machine passed every safety
/// check (tools present, backup folder writable, scratch database available,
/// no interrupted restore waiting).
class FullBackupSection extends ConsumerStatefulWidget {
  const FullBackupSection({super.key});

  @override
  ConsumerState<FullBackupSection> createState() => _FullBackupSectionState();
}

class _FullBackupSectionState extends ConsumerState<FullBackupSection> {
  Map<String, dynamic>? _capabilities;
  List<Map<String, dynamic>> _files = const [];
  Map<String, dynamic>? _systemCapabilities;
  List<Map<String, dynamic>> _systemFiles = const [];
  Map<String, dynamic>? _restoreStatus;
  bool _busy = false;

  /// True only while the first capabilities/list round-trip is in flight.
  /// The loading bar is bound to this flag — never to "capabilities is
  /// still null" — so a failed load ends in a message and a retry button
  /// instead of a progress bar that spins forever over a hidden error.
  bool _loading = true;
  String? _notice;
  String? _failure;
  Timer? _statusPoll;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _statusPoll?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _failure = null;
    });
    final service = ref.read(fullBackupServiceProvider);
    // The two answers are read independently: coupling them in one `try`
    // meant a failed file list discarded perfectly good capabilities and
    // the whole section collapsed into its error branch — where the only
    // remaining button was «تحديث الحالة», which is the dead end this
    // layout exists to avoid. A refresh that fails now keeps the last
    // known state and merely reports the failure.
    var capabilities = _capabilities;
    var files = _files;
    Object? loadError;
    try {
      capabilities = await service.capabilities();
    } catch (error) {
      loadError = error;
    }
    try {
      files = await service.list();
    } catch (error) {
      loadError ??= error;
    }

    // The complete-backup half is asked separately, and its failure never
    // overwrites the answer above: a server that cannot restore must still
    // show its backup buttons.
    Map<String, dynamic>? systemCapabilities;
    List<Map<String, dynamic>> systemFiles = const [];
    try {
      systemCapabilities = await ref.read(systemBackupServiceProvider).capabilities();
      systemFiles = await ref.read(systemBackupServiceProvider).list();
    } catch (_) {
      systemCapabilities = null;
      systemFiles = const [];
    }
    Map<String, dynamic>? restoreStatus;
    try {
      restoreStatus = await ref.read(systemBackupServiceProvider).status();
    } catch (_) {
      restoreStatus = null;
    }

    if (!mounted) return;
    setState(() {
      _capabilities = capabilities;
      _files = files;
      _systemCapabilities = systemCapabilities;
      _systemFiles = systemFiles;
      _restoreStatus = restoreStatus;
      _loading = false;
      _failure = loadError == null ? null : describeApiError(loadError);
    });
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
      // A 200 without a file is not a backup. Saying «saved» over an empty
      // answer is the same lie as a progress bar that never ends.
      if (file == null ||
          file['name'] is! String ||
          (file['name'] as String).trim().isEmpty) {
        throw const FormatException('The backup response did not identify a file.');
      }
      if (!mounted) return;
      setState(() => _notice = _createdNotice(file, complete: false));
      await _load();
    } catch (error) {
      if (!mounted) return;
      // A timeout can happen after the server has finished, but a new file
      // may also be another user's concurrent backup. Refresh the list without
      // claiming that any file belongs to this request or is restorable.
      final message = describeApiError(error);
      await _load();
      if (!mounted) return;
      setState(() {
        _notice = null;
        _failure = '$message\n${_t(
          context,
          'تعذر تأكيد نتيجة الطلب. قد تنتمي الملفات الجديدة إلى عملية أخرى؛ افحص النسخة قبل الاعتماد عليها.',
          'The request outcome could not be confirmed. A new file may belong to another backup; inspect it before relying on it.',
        )}';
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Takes a complete system backup: database, files, settings, licence state
  /// and manifest.
  Future<void> _createSystemBackup() async {
    setState(() {
      _busy = true;
      _notice = _t(
        context,
        'جارٍ إنشاء نسخة كاملة للنظام… قد يستغرق هذا بعض الوقت.',
        'Creating a complete system backup… this can take a while.',
      );
      _failure = null;
    });
    try {
      final result = await ref.read(systemBackupServiceProvider).create();
      final file = result['file'] as Map<String, dynamic>?;
      if (file == null ||
          file['name'] is! String ||
          (file['name'] as String).trim().isEmpty) {
        throw const FormatException('The backup response did not identify a file.');
      }
      if (!mounted) return;
      final warnings = (result['warnings'] as List<dynamic>? ?? const [])
          .map((entry) => '$entry')
          .where((entry) => entry.isNotEmpty)
          .toList(growable: false);
      setState(() {
        _notice = [
          _createdNotice(file, complete: true),
          ...warnings,
        ].join('\n');
      });
      await _load();
    } catch (error) {
      if (!mounted) return;
      // Same rule as the database archive: a file that appeared while the
      // request was failing is not proof that this request made it.
      final message = describeApiError(error);
      await _load();
      if (!mounted) return;
      setState(() {
        _notice = null;
        _failure = '$message\n${_t(
          context,
          'تعذر تأكيد نتيجة الطلب. راجع قائمة النسخ وافحص النسخة الجديدة قبل الاعتماد عليها.',
          'The request outcome could not be confirmed. Check the list and inspect any new archive before relying on it.',
        )}';
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// What the person is told once the server has the file: its name, its
  /// size and the folder it sits in, so «it worked» can be checked rather
  /// than trusted. The folder is the server's own answer (capabilities),
  /// never a path the client guesses.
  String _createdNotice(Map<String, dynamic>? file, {required bool complete}) {
    final l10n = context.l10n;
    final name = file == null ? '' : '${file['name'] ?? ''}';
    final size = file == null ? null : file['sizeBytes'];
    final directory =
        '${_systemCapabilities?['backupDirectory'] ?? _capabilities?['backupDirectory'] ?? ''}';
    final where = directory.isEmpty ? '' : '\n${l10n.backupSavedIn(directory)}';
    if (complete) {
      return '${l10n.createdSuccessfully}${name.isEmpty ? '' : ': $name'}'
          '${size == null ? '' : ' · $size ${l10n.sizeLabel}'}$where';
    }
    // The database archive is the smaller thing it is, and the message says
    // so: it carries no uploaded files and no licence record, and no full
    // restore of it has been proved.
    final label = _t(
      context,
      'تم حفظ أرشيف قاعدة البيانات فقط (وليس نسخة كاملة)',
      'Database archive saved (not a complete backup)',
    );
    final warning = _t(
      context,
      'لم تُحفظ الملفات الخارجية والترخيص في هذا الأرشيف، ولم تثبت استعادة كاملة.',
      'External files and the licence are not included, and a complete restore has not been verified.',
    );
    return '$label${name.isEmpty ? '' : ': $name'}'
        '${size == null ? '' : ' · $size ${l10n.sizeLabel}'}$where\n$warning';
  }

  /// The reason deletion is not offered, when the server protects its backups.
  String _deleteProtectionMessage() => _t(
    context,
    'حذف النسخ متوقف لحمايتها حتى يثبت استرجاع نسخة بديلة كاملة تشمل البيانات والملفات والترخيص.',
    'Deletion is paused to protect backups until a complete replacement restore, including files and licence, is verified.',
  );

  Future<void> _verify(String name, {required bool complete}) async {
    setState(() {
      _busy = true;
      _failure = null;
      _notice = _t(
        context,
        'جارٍ فحص الأرشيف… يُقرأ كل ملف ويُقارن بصمته.',
        'Checking the archive… every file is read back and compared with its SHA-256.',
      );
    });
    try {
      final report = complete
          ? await ref.read(systemBackupServiceProvider).verify(name)
          : await ref.read(fullBackupServiceProvider).verify(name);
      if (!mounted) return;
      if (complete) {
        final manifest = report['manifest'] as Map?;
        final entries = manifest?['files'] as Map?;
        final counts = manifest?['counts'] as Map?;
        final checks = (report['checks'] as List?)?.length ?? 0;
        final ok = report['ok'] == true;
        final verdict = ok
            ? _t(context, '✔ النسخة سليمة', '✔ The archive is intact')
            : _t(context, '✖ النسخة غير صالحة', '✖ The archive is not usable');
        final files = entries == null
            ? ''
            : ' · ${entries['count']} ${_t(context, 'ملفاً', 'files')}';
        final companies = counts == null
            ? ''
            : ' · ${counts['companies']} ${_t(context, 'شركة', 'companies')}'
                ' / ${counts['users']} ${_t(context, 'مستخدماً', 'users')}';
        final failure = report['failure'] == null ? '' : '\n${report['failure']}';
        setState(() {
          _notice = '$verdict · $checks ${_t(context, 'فحصاً', 'checks')}$files$companies$failure';
        });
      } else {
        final entries = report['entries'];
        setState(() {
          _notice = _t(
            context,
            'النسخة سليمة: $entries كائناً في الأرشيف.',
            'The archive is intact: $entries objects inside it.',
          );
        });
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _failure = describeApiError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _download(String name, {required bool complete}) => runDownload(
    context,
    complete
        ? ref.read(reportLinkProvider).systemBackupDownload(name)
        : ref.read(reportLinkProvider).fullBackupDownload(name),
  );

  Future<void> _delete(String name, {required bool complete}) async {
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
      if (complete) {
        await ref.read(systemBackupServiceProvider).delete(name);
      } else {
        await ref.read(fullBackupServiceProvider).delete(name);
      }
      await _load();
    } catch (error) {
      if (!mounted) return;
      final protected =
          error is DioException &&
          error.response?.statusCode == 409 &&
          error.response?.data is Map &&
          (error.response!.data as Map)['code'] == 'BACKUP_DELETE_PROTECTED';
      setState(
        () => _failure = protected
            ? _deleteProtectionMessage()
            : describeApiError(error),
      );
    }
  }

  /// The warning, then the typed word. Twice on purpose: the first dialog says
  /// what will happen, the second makes the person write it down.
  Future<bool> _confirm() async {
    final l10n = context.l10n;
    final warned = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.confirmFullRestoreTitle),
        content: Text(
          '${l10n.restoreFullWarning}\n\n'
          '${_t(
            context,
            'هذه الاستعادة تمس جميع الشركات وليس شركة واحدة. تأكد أنك تريد استبدال كل البيانات الحالية.',
            'This restore replaces every company on the installation, not one company. Make sure you mean to replace all current data.',
          )}',
        ),
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
    if (warned != true || !mounted) return false;

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
    return confirmed == true && mounted;
  }

  /// Restores from a complete archive (server file or upload) or a database
  /// archive. Progress is polled so the person sees which step is running
  /// instead of an unmoving bar.
  Future<void> _restore({PickedFile? file, String? fileName}) async {
    if (!await _confirm()) return;
    if (!mounted) return;

    setState(() {
      _busy = true;
      _notice = _t(
        context,
        'جارٍ التحقق من الأرشيف ثم تجربة الاستعادة على قاعدة منفصلة…',
        'Verifying the archive and rehearsing the restore on a scratch database…',
      );
      _failure = null;
    });
    _startStatusPolling();

    try {
      final result = await ref.read(systemBackupServiceProvider).restore(
        file: file,
        fileName: fileName,
        confirm: true,
        confirmPhrase: 'RESTORE',
      );
      if (!mounted) return;
      final safety = '${result['safetyBackup'] ?? ''}';
      final filesRestored = result['filesRestored'];
      setState(() {
        _notice = [
          _t(context, 'تمت الاستعادة بنجاح.', 'The restore finished.'),
          if (safety.isNotEmpty)
            _t(
              context,
              'نسخة الأمان: $safety (احتفظ بها حتى تتأكد من كل شيء).',
              'Safety backup: $safety (keep it until you have checked everything).',
            ),
          if (filesRestored != null)
            _t(
              context,
              'الملفات المستعادة: $filesRestored',
              'Files restored: $filesRestored',
            ),
        ].join('\n');
      });
      await _load();
      // The restore replaced the users table: the token this session holds
      // belongs to an account that may no longer exist, so the honest next
      // step is to sign in again with the restored credentials.
      if (mounted) {
        await ref.read(authControllerProvider.notifier).signOut();
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _failure = describeApiError(error));
    } finally {
      _stopStatusPolling();
      if (mounted) setState(() => _busy = false);
    }
  }

  void _startStatusPolling() {
    _statusPoll?.cancel();
    _statusPoll = Timer.periodic(const Duration(seconds: 3), (_) async {
      try {
        final status = await ref.read(systemBackupServiceProvider).status();
        if (!mounted || !_busy) return;
        final phase = (status['journal'] as Map?)?['phase'];
        final maintenance = status['maintenance'] is Map
            ? (status['maintenance'] as Map)['maintenance']
            : status['maintenance'];
        setState(() {
          _restoreStatus = status;
          if (phase != null) {
            _notice = _t(
              context,
              'الاستعادة جارية — الخطوة: $phase',
              'Restore running — step: $phase',
            );
          } else if (maintenance == true) {
            _notice = _t(
              context,
              'الاستعادة جارية: النظام في وضع الصيانة.',
              'Restore running: the system is in maintenance mode.',
            );
          }
        });
      } catch (_) {
        // A status request that fails is not a restore that failed; the
        // restore request itself carries the answer.
      }
    });
  }

  void _stopStatusPolling() {
    _statusPoll?.cancel();
    _statusPoll = null;
  }

  Future<void> _resumeRecovery() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_t(context, 'استكمال التعافي', 'Resume recovery')),
        content: Text(
          _t(
            context,
            'سيُعاد تحميل نسخة الأمان التي أُخذت قبل الاستعادة المتوقفة، وتُستبدل البيانات الحالية بها. لا تُدخل أي بيانات قبل انتهاء هذه العملية.',
            'The safety backup taken before the interrupted restore will be put back, replacing the current data. Do not enter data until this finishes.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(context.l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(_t(context, 'ابدأ التعافي', 'Start recovery')),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      _busy = true;
      _notice = _t(context, 'جارٍ التعافي من نسخة الأمان…', 'Recovering from the safety backup…');
      _failure = null;
    });
    try {
      final result = await ref.read(systemBackupServiceProvider).resumeRecovery();
      if (!mounted) return;
      setState(() {
        _notice = '${result['detail'] ?? ''}';
      });
      await _load();
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
      picked = await pickFile(extensions: ['.kayanbackup', '.dump', '.json']);
    } catch (error) {
      if (!mounted) return;
      setState(() => _failure = describeApiError(error));
      return;
    }
    if (picked == null) return;

    final lower = picked.name.toLowerCase();
    final isComplete = lower.endsWith('.kayanbackup');
    final isDump = lower.endsWith('.dump') ||
        (picked.bytes.length >= 5 &&
            String.fromCharCodes(picked.bytes.sublist(0, 5)) == 'PGDMP');
    final isJson = lower.endsWith('.json') ||
        (picked.bytes.isNotEmpty &&
            (picked.bytes.first == 0x7B || picked.bytes.first == 0x5B));

    if (isJson) {
      if (!mounted) return;
      setState(() {
        _failure = _t(
          context,
          'هذا ملف بيانات JSON وليس أرشيف نظام.\n'
              'لاستعادة بيانات شركة واحدة، استخدم القسم الأول «نسخ واستعادة بيانات الشركة».',
          'This is a JSON data file, not a system archive. To restore one company, use the '
              'first section, "Back up and restore company data".',
        );
      });
      return;
    }
    if (isDump) {
      // A bare .dump is the database only: no uploaded files, no settings, no
      // licence record. Restoring it as if it were the whole machine is the
      // mistake this screen exists to prevent, and the database-only restore
      // stays closed until its own safety test passes.
      if (!mounted) return;
      setState(() {
        _failure = _t(
          context,
          'أرشيف قاعدة البيانات (.dump) يحمل قاعدة البيانات وحدها: لا ملفات ولا ترخيص.\n'
              'استخدم نسخة كاملة للنظام (.kayanbackup) لاستعادة الجهاز.',
          'A database archive (.dump) holds the database alone: no files and no licence. '
              'Use a complete system backup (.kayanbackup) to restore the machine.',
        );
      });
      return;
    }
    if (!isComplete) {
      if (!mounted) return;
      setState(() {
        _failure = _t(
          context,
          'اختر ملف نسخة كاملة (.kayanbackup).',
          'Choose a complete backup (.kayanbackup).',
        );
      });
      return;
    }

    // The archive is checked before it is restored: the person sees what is
    // inside and what it would replace, and a damaged file never reaches the
    // database.
    setState(() {
      _busy = true;
      _notice = _t(
        context,
        'جارٍ فحص الأرشيف قبل الاستعادة…',
        'Checking the archive before restoring…',
      );
      _failure = null;
    });
    try {
      final report = await ref.read(systemBackupServiceProvider).inspect(picked);
      if (!mounted) return;
      if (report['ok'] != true) {
        setState(() {
          _failure =
              '${report['failure'] ?? _t(context, 'الأرشيف غير صالح', 'The archive is not usable')}';
        });
        return;
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _failure = describeApiError(error));
      return;
    } finally {
      if (mounted) setState(() => _busy = false);
    }

    await _restore(file: picked);
  }

  /// Whether this machine may restore at all. An absent answer is a «no»:
  /// a destructive restore is never offered because the question could not be
  /// asked, and `KAYAN_FULL_RESTORE_ENABLED=0` can only ever close it.
  bool get _restoreSupported => _systemCapabilities?['fullRestoreSupported'] == true;

  List<String> get _restoreReasons {
    final reasons = _systemCapabilities?['fullRestoreReasons'];
    if (reasons is List) {
      return reasons.map((entry) => '$entry').toList(growable: false);
    }
    return const [];
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final capabilities = _capabilities;
    final toolsAvailable = capabilities?['available'] == true;
    // Only a definite answer disables the actions. «We could not ask»
    // (capabilities still null after a failed load) leaves them enabled:
    // the server's own reply to the attempt is clearer than a grey button.
    final toolsUnavailable = capabilities != null && !toolsAvailable;
    final completeAvailable = _systemCapabilities?['available'] == true;
    final restoreBusy = _busy;
    final journal = _restoreStatus?['journal'] as Map?;
    final recoveryAvailable = journal?['unfinished'] == true || journal?['destructive'] == true;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.inventory_2_outlined, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _t(
                      context,
                      'القسم الثاني: نسخ واستعادة النظام (DUMP / استعادة كاملة)',
                      'Section two: system backup and restore (DUMP / full recovery)',
                    ),
                    style: theme.textTheme.titleMedium,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              l10n.fullBackupDescription,
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            // The warning is not decoration: this is the one screen in the
            // program that can replace every company at once.
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: theme.colorScheme.errorContainer.withValues(alpha: 0.35),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.warning_amber_outlined, size: 18, color: theme.colorScheme.error),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _t(
                        context,
                        'تحذير: استعادة قاعدة البيانات تستبدل بيانات جميع الشركات والمستخدمين على هذا الجهاز. '
                            'لا تُستعاد بيانات شركة واحدة من هنا؛ لذلك استخدم القسم الأول.',
                        'Warning: restoring the database replaces the data of every company and user on '
                            'this machine. A single company is not restored here — that is section one.',
                      ),
                      style: theme.textTheme.bodySmall,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            if (capabilities == null && _loading)
              const LinearProgressIndicator()
            else if (capabilities == null)
              _Notice(
                icon: Icons.info_outline,
                color: theme.colorScheme.error,
                text: l10n.fullBackupUnavailable,
              ),
            if (toolsUnavailable) ..._toolUnavailable(context, capabilities),
            if (!_restoreSupported) ..._restoreBlocked(context),
            if (capabilities?['deletionProtected'] == true) ...[
              _Notice(
                icon: Icons.warning_amber_outlined,
                color: theme.colorScheme.error,
                text: _deleteProtectionMessage(),
              ),
              const SizedBox(height: 8),
            ],
            if (recoveryAvailable) ..._recoveryBanner(context, journal),
            if (capabilities != null &&
                capabilities['maintenance'] is Map &&
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
                  onPressed: restoreBusy || toolsUnavailable ? null : _createBackup,
                  icon: const Icon(Icons.save_alt),
                  label: Text(l10n.createFullBackup),
                ),
                FilledButton.icon(
                  onPressed: restoreBusy || !completeAvailable ? null : _createSystemBackup,
                  icon: const Icon(Icons.inventory_2_outlined),
                  label: Text(
                    _t(context, 'إنشاء نسخة كاملة للنظام', 'Create a complete system backup'),
                  ),
                ),
                if (_restoreSupported)
                  OutlinedButton.icon(
                    onPressed: restoreBusy || toolsUnavailable
                        ? null
                        : _uploadAndRestore,
                    icon: const Icon(Icons.restore),
                    label: Text(
                      _t(context, 'استعادة من ملف نظام', 'Restore from a system file'),
                    ),
                  ),
                OutlinedButton.icon(
                  onPressed: restoreBusy ? null : _load,
                  icon: const Icon(Icons.refresh),
                  label: Text(l10n.refreshStatus),
                ),
              ],
            ),
            if (_busy || _loading) ...[
              const SizedBox(height: 12),
              const LinearProgressIndicator(),
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
            if (_systemFiles.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(
                _t(context, 'النسخ الكاملة للنظام على الخادم', 'Complete system backups on the server'),
                style: theme.textTheme.titleSmall,
              ),
              const SizedBox(height: 8),
              for (final file in _systemFiles)
                _fileTile(
                  context,
                  file,
                  complete: true,
                  restoreEnabled: _restoreSupported && !restoreBusy,
                ),
            ],
            if (_files.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(
                _t(
                  context,
                  'أرشيفات قاعدة البيانات (DUMP) على الخادم',
                  'Database archives (DUMP) on the server',
                ),
                style: theme.textTheme.titleSmall,
              ),
              const SizedBox(height: 8),
              for (final file in _files)
                _fileTile(
                  context,
                  file,
                  complete: false,
                  restoreEnabled: _restoreSupported && !restoreBusy,
                ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _fileTile(
    BuildContext context,
    Map<String, dynamic> file, {
    required bool complete,
    required bool restoreEnabled,
  }) {
    final l10n = context.l10n;
    final name = '${file['name']}';
    final kind = '${file['kind'] ?? 'full'}';
    final label = complete
        ? (kind == 'safety' ? l10n.safetyBackup : _t(context, 'نسخة نظام كاملة', 'Complete system backup'))
        : (kind == 'safety' ? l10n.safetyBackup : l10n.fullBackupKind);
    return ListTile(
      dense: true,
      leading: Icon(complete ? Icons.inventory_2_outlined : Icons.archive_outlined),
      title: Text(name),
      subtitle: Text('$label · ${file['sizeBytes']} ${l10n.sizeLabel}'),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            tooltip: _t(context, 'فحص الأرشيف', 'Check the archive'),
            icon: const Icon(Icons.verified_outlined, size: 20),
            onPressed: _busy ? null : () => _verify(name, complete: complete),
          ),
          IconButton(
            tooltip: l10n.downloadBackup,
            icon: const Icon(Icons.download_outlined, size: 20),
            onPressed: _busy ? null : () => _download(name, complete: complete),
          ),
          // Restoring a bare .dump would put back the database without the
          // files or the licence, so that control exists only for a complete
          // archive — and only when this machine passed every check.
          if (complete && restoreEnabled)
            IconButton(
              tooltip: l10n.restoreFullDatabase,
              icon: const Icon(Icons.restore, size: 20),
              onPressed: () => _restore(fileName: name),
            ),
          IconButton(
            tooltip: l10n.deleteBackup,
            icon: const Icon(Icons.delete_outline, size: 20),
            onPressed: _busy || _deletionProtected
                ? null
                : () => _delete(name, complete: complete),
          ),
        ],
      ),
    );
  }

  List<Widget> _toolUnavailable(BuildContext context, Map<String, dynamic>? capabilities) {
    final theme = Theme.of(context);
    return [
      _Notice(
        icon: Icons.info_outline,
        color: theme.colorScheme.error,
        text:
            '${context.l10n.fullBackupUnavailable}'
            '${capabilities?['reason'] == null ? '' : '\n${capabilities?['reason']}'}',
      ),
      const SizedBox(height: 8),
    ];
  }

  bool get _deletionProtected => _capabilities?['deletionProtected'] == true;

  List<Widget> _restoreBlocked(BuildContext context) {
    final theme = Theme.of(context);
    final reasons = _restoreReasons;
    return [
      _Notice(
        icon: Icons.lock_outline,
        color: theme.colorScheme.error,
        text: [
          _t(
            context,
            'الاستعادة الكاملة متوقفة حتى يثبت ربط قاعدة البيانات والملفات والترخيص والتعافي من الانقطاع.',
            'Full restore is paused until database, files and licence recovery and interruption safety are verified.',
          ),
          if (reasons.isNotEmpty)
            _t(
              context,
              'ما ينقص هذا الجهاز:\n• ${reasons.join('\n• ')}',
              'What this machine still needs:\n• ${reasons.join('\n• ')}',
            ),
        ].join('\n'),
      ),
      const SizedBox(height: 8),
    ];
  }

  List<Widget> _recoveryBanner(BuildContext context, Map? journal) {
    final theme = Theme.of(context);
    return [
      Container(
        width: double.infinity,
        padding: const EdgeInsets.all(10),
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: theme.colorScheme.errorContainer,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              _t(
                context,
                'استعادة سابقة لم تكتمل (الخطوة: ${journal?['phase'] ?? '—'}).\n'
                    'النظام في وضع الصيانة ولا يقبل أي تعديل حتى تُستكمل العملية.',
                'An earlier restore did not finish (step: ${journal?['phase'] ?? '—'}).\n'
                    'The system is in maintenance mode and accepts no changes until it is resolved.',
              ),
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: _busy ? null : _resumeRecovery,
              icon: const Icon(Icons.healing),
              label: Text(_t(context, 'استكمال التعافي من نسخة الأمان', 'Resume recovery from the safety backup')),
            ),
          ],
        ),
      ),
    ];
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
