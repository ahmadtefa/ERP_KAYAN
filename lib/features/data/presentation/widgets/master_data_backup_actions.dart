import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/platform/browser_actions.dart';
import '../../../../core/platform/picked_file.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/app_error_dialog.dart';
import '../../../../shared/widgets/confirm_dialog.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../providers/data_providers.dart';

/// Explicit, independent backup and restore buttons for one master-data list.
/// Restoring one kind never sends the other master-data types, transactions,
/// balances, warehouse settings or historical relations to the API.
class MasterDataBackupActions extends ConsumerStatefulWidget {
  const MasterDataBackupActions({
    super.key,
    required this.kind,
    this.onRestored,
  });

  final String kind;
  final VoidCallback? onRestored;

  @override
  ConsumerState<MasterDataBackupActions> createState() =>
      _MasterDataBackupActionsState();
}

class _MasterDataBackupActionsState
    extends ConsumerState<MasterDataBackupActions> {
  bool _busy = false;

  String get _readPermission => switch (widget.kind) {
    'items' => 'inventory.items.read',
    'customers' => 'parties.customers.read',
    'suppliers' => 'parties.suppliers.read',
    _ => '',
  };

  String get _createPermission => switch (widget.kind) {
    'items' => 'inventory.items.create',
    'customers' => 'parties.customers.create',
    'suppliers' => 'parties.suppliers.create',
    _ => '',
  };

  String get _updatePermission => switch (widget.kind) {
    'items' => 'inventory.items.update',
    'customers' => 'parties.customers.update',
    'suppliers' => 'parties.suppliers.update',
    _ => '',
  };

  String _text(String ar, String en) =>
      Localizations.localeOf(context).languageCode == 'ar' ? ar : en;

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final mayBackup = user?.can(_readPermission) ?? false;
    final mayRestore = (user?.can(_createPermission) ?? false) &&
        (user?.can(_updatePermission) ?? false);
    if (!mayBackup && !mayRestore) return const SizedBox.shrink();

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (mayBackup)
          OutlinedButton.icon(
            onPressed: _busy ? null : _backup,
            icon: const Icon(Icons.backup_outlined, size: 18),
            label: Text(_text('نسخ احتياطي', 'Back up')),
          ),
        if (mayRestore)
          OutlinedButton.icon(
            onPressed: _busy ? null : _restore,
            icon: const Icon(Icons.restore_outlined, size: 18),
            label: Text(_text('استعادة', 'Restore')),
          ),
      ],
    );
  }

  Future<void> _backup() async {
    setState(() => _busy = true);
    await runDownload(
      context,
      ref.read(reportLinkProvider).masterDataBackup(kind: widget.kind),
      onDone: () {
        if (mounted) setState(() => _busy = false);
      },
    );
  }

  Future<void> _restore() async {
    final picked = await pickFile(extensions: const ['.json']);
    if (picked == null || !mounted) return;
    if (!picked.name.toLowerCase().endsWith('.json')) {
      await showAppError(context, _text(
        'اختر ملف النسخة الاحتياطية المستقل بصيغة JSON.',
        'Choose the independent JSON backup file.',
      ));
      return;
    }

    final Map<String, dynamic> archive;
    try {
      if (picked.sizeInBytes > 5 * 1024 * 1024) {
        throw FormatException(_text(
          'حجم الملف يتجاوز الحد المسموح (5 ميجابايت).',
          'The file exceeds the 5 MB safety limit.',
        ));
      }
      final decoded = jsonDecode(utf8.decode(picked.bytes));
      if (decoded is! Map) {
        throw const FormatException('The selected JSON file is not an archive object.');
      }
      archive = Map<String, dynamic>.from(decoded);
    } catch (error) {
      if (mounted) await showAppError(context, error);
      return;
    }

    setState(() => _busy = true);
    try {
      final api = ref.read(apiClientProvider);
      final preview = await api.post(
        '/master-data-backups/${widget.kind}/preview',
        body: {'backup': archive},
      );
      final conflicts = int.tryParse('${preview['conflictCount'] ?? 0}') ?? 0;
      if (conflicts > 0) {
        final codes = (preview['conflicts'] as List? ?? const [])
            .map((value) => value.toString())
            .join(', ');
        throw StateError(_text(
          'توقفت المعاينة: تعارض مع سجلات محذوفة للأكواد: $codes. لم تُجرَ أي تغييرات.',
          'Preview found conflicts with deleted records, codes: $codes. Nothing was changed.',
        ));
      }
      if (!mounted) return;
      final createCount = int.tryParse('${preview['createCount'] ?? 0}') ?? 0;
      final updateCount = int.tryParse('${preview['updateCount'] ?? 0}') ?? 0;
      final total = int.tryParse('${preview['total'] ?? 0}') ?? 0;
      if (total == 0) {
        throw StateError(_text(
          'ملف النسخة لا يحتوي على سجلات للاستعادة.',
          'The backup contains no records to restore.',
        ));
      }
      final approve = await confirmAction(
        context,
        title: _text('معاينة استعادة البيانات', 'Review data restore'),
        message: _text(
          'الملف: ${picked.name}\nالسجلات: $total\nإضافة: $createCount\nتحديث السجل الرئيسي القائم: $updateCount\n\nستُحفظ السجلات القائمة بمعرّفاتها؛ لن تتغير الأرصدة أو الحركات أو المستندات أو العلاقات التاريخية. لا يمكن التراجع عن تحديث بيانات الأصناف/الأطراف.',
          'File: ${picked.name}\nRecords: $total\nNew: $createCount\nExisting master records to update: $updateCount\n\nExisting record IDs are kept. Stock balances, movements, documents and historical relationships are not changed. Master-data updates cannot be automatically undone.',
        ),
        confirmLabel: _text('استعادة هذه البيانات', 'Restore these records'),
      );
      if (!approve || !mounted) return;

      final result = await api.post(
        '/master-data-backups/${widget.kind}/restore',
        body: {
          'backup': archive,
          'previewFingerprint': preview['previewFingerprint'],
        },
      );
      if (!mounted) return;
      widget.onRestored?.call();
      final created = result['created'] ?? 0;
      final updated = result['updated'] ?? 0;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(
          content: Text(_text(
            'اكتملت الاستعادة: أضيف $created وحُدّث $updated.',
            'Restore completed: $created created, $updated updated.',
          )),
        ));
    } catch (error) {
      if (mounted) await showAppError(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}
