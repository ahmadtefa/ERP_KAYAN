import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../data/reset_data_source.dart';
import '../providers/reset_providers.dart';

/// «إعادة ضبط بيانات البرنامج» — Reset ERP Data.
///
/// The most destructive thing the program offers, and the only one that
/// cannot be taken back by pressing another button — the way back is the
/// backup the server takes first. So the screen does four things before it
/// will send anything:
///
///  1. it counts what would go, and names it;
///  2. it warns, in its own dialog, and waits for the person to continue;
///  3. it asks for the administrator's own password, which the server checks
///     against the hash it holds — the screen cannot check it itself;
///  4. it asks for the word RESET to be typed, and keeps the button disabled
///     until the word matches exactly.
///
/// Ordinary users are not shown the way in at all. That is a courtesy: the
/// server refuses them regardless, and it is the server's refusal that
/// counts.
class ResetDataCard extends ConsumerWidget {
  const ResetDataCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final user = ref.watch(currentUserProvider);
    // The server reset service requires a super-administrator specifically;
    // a company manager with profile-edit permission must not see a button
    // that the server will reject.
    final allowed = user?.isSuperAdmin == true;

    if (!allowed) return const SizedBox.shrink();

    final preview = ref.watch(resetPreviewProvider);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.restart_alt, color: theme.colorScheme.error),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    l10n.resetData,
                    style: theme.textTheme.titleMedium,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(l10n.resetDataHint, style: theme.textTheme.bodySmall),
            const SizedBox(height: 12),
            preview.when(
              loading: () => const LinearProgressIndicator(),
              error: (error, _) => Text(
                l10n.resetPreviewFailed,
                style: TextStyle(color: theme.colorScheme.error),
              ),
              data: (value) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.resetForCompany(value.companyLabel),
                    style: theme.textTheme.titleSmall,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    l10n.resetBackupFirst,
                    style: theme.textTheme.bodySmall,
                  ),
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    // Nothing to reset is still a reason not to offer the
                    // button: the company is already where a reset would
                    // put it.
                    onPressed: value.totalRecords == 0
                        ? null
                        : () => _ask(context, ref, value),
                    style: FilledButton.styleFrom(
                      backgroundColor: theme.colorScheme.error,
                      foregroundColor: theme.colorScheme.onError,
                    ),
                    icon: const Icon(Icons.restart_alt),
                    label: Text(l10n.resetButton),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _ask(
    BuildContext context,
    WidgetRef ref,
    ResetPreview preview,
  ) async {
    final result = await showDialog<ResetResult>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) =>
          _ResetDialog(preview: preview, ref: ref),
    );
    if (result == null || !context.mounted) return;

    final l10n = context.l10n;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          '${l10n.resetDone(result.backupFile)}\n${l10n.resetNeedsSetup}',
        ),
        duration: const Duration(seconds: 8),
      ),
    );
    ref.invalidate(resetPreviewProvider);
    // The reset revokes every refresh token and returns the company to its
    // first-run state. Drop the local JWT as well, so the router opens the
    // setup/login flow instead of leaving a signed-in screen on empty books.
    await ref.read(authControllerProvider.notifier).signOut();
  }
}

/// Two steps: the warning, then the password and the typed word.
///
/// The password is held only for as long as this dialog is open, and is
/// never written anywhere else.
class _ResetDialog extends StatefulWidget {
  const _ResetDialog({required this.preview, required this.ref});

  final ResetPreview preview;
  final WidgetRef ref;

  @override
  State<_ResetDialog> createState() => _ResetDialogState();
}

class _ResetDialogState extends State<_ResetDialog> {
  final _password = TextEditingController();
  final _word = TextEditingController();
  bool _busy = false;
  String? _failure;
  bool _warned = false;

  @override
  void dispose() {
    _password.dispose();
    _word.dispose();
    super.dispose();
  }

  bool get _canSubmit =>
      !_busy &&
      _password.text.isNotEmpty &&
      _word.text.trim() == widget.preview.confirmationWord;

  Future<void> _submit() async {
    final l10n = context.l10n;
    if (!_canSubmit) {
      setState(
        () => _failure = l10n.resetWrongWord(widget.preview.confirmationWord),
      );
      return;
    }
    setState(() {
      _busy = true;
      _failure = null;
    });
    try {
      final result = await widget.ref
          .read(resetDataSourceProvider)
          .reset(
            password: _password.text,
            confirmation: _word.text.trim(),
          );
      if (!mounted) return;
      Navigator.of(context).pop(result);
    } on Failure catch (failure) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _failure = failure.message;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _failure = '$error';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    if (!_warned) {
      return AlertDialog(
        title: Text(l10n.resetConfirmTitle),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                l10n.resetForCompany(widget.preview.companyLabel),
                style: theme.textTheme.titleSmall,
              ),
              const SizedBox(height: 12),
              Text(l10n.resetBackupFirst),
              const SizedBox(height: 16),
              Text(
                l10n.resetWhatIsDeleted,
                style: theme.textTheme.titleSmall,
              ),
              const SizedBox(height: 4),
              Text(
                l10n.resetDeletedHint,
                style: theme.textTheme.bodySmall,
              ),
              const SizedBox(height: 8),
              _Counts(counts: widget.preview.counts),
              const SizedBox(height: 16),
              Text(l10n.resetWhatIsKept, style: theme.textTheme.titleSmall),
              const SizedBox(height: 4),
              _KeptList(items: [
                l10n.resetKeptAdmin,
                l10n.resetKeptPermissions,
                l10n.resetKeptRoles,
                l10n.resetKeptConfig,
              ]),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: scheme.error,
              foregroundColor: scheme.onError,
            ),
            onPressed: () => setState(() => _warned = true),
            child: Text(l10n.confirm),
          ),
        ],
      );
    }

    return AlertDialog(
      title: Text(l10n.resetConfirmTitle),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(l10n.resetConfirmBody(widget.preview.confirmationWord)),
            const SizedBox(height: 12),
            TextField(
              controller: _password,
              obscureText: true,
              enabled: !_busy,
              decoration: InputDecoration(
                labelText: l10n.resetPasswordLabel,
                helperText: l10n.resetPasswordHint,
                helperMaxLines: 3,
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _word,
              enabled: !_busy,
              decoration: InputDecoration(
                labelText: l10n.resetWordLabel(
                  widget.preview.confirmationWord,
                ),
              ),
              onChanged: (_) => setState(() {}),
            ),
            if (_failure != null) ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  Icon(Icons.error_outline, color: scheme.error, size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _failure!,
                      style: TextStyle(color: scheme.error),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          style: FilledButton.styleFrom(
            backgroundColor: scheme.error,
            foregroundColor: scheme.onError,
          ),
          onPressed: _canSubmit ? _submit : null,
          child: _busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(l10n.resetButton),
        ),
      ],
    );
  }
}

/// The numbers, named. A warning that says "14,203 records" is not a
/// warning anyone can act on; one that says "1,180 sales invoices" is.
class _Counts extends StatelessWidget {
  const _Counts({required this.counts});

  final Map<String, int> counts;

  String _label(BuildContext context, String key) {
    final l10n = context.l10n;
    return switch (key) {
      'journalEntries' => l10n.resetCountJournalEntries,
      'accounts' => l10n.resetCountAccounts,
      'customers' => l10n.resetCountCustomers,
      'suppliers' => l10n.resetCountSuppliers,
      'items' => l10n.resetCountItems,
      'salesInvoices' => l10n.resetCountSalesInvoices,
      'purchaseInvoices' => l10n.resetCountPurchaseInvoices,
      'stockMovements' => l10n.resetCountStockMovements,
      'fiscalPeriods' => l10n.resetCountFiscalPeriods,
      'branches' => l10n.resetCountBranches,
      'users' => l10n.resetCountUsers,
      _ => key,
    };
  }

  @override
  Widget build(BuildContext context) {
    final shown = counts.entries.where((entry) => entry.value > 0).toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    if (shown.isEmpty) return const SizedBox.shrink();
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final entry in shown)
          Chip(
            label: Text('${_label(context, entry.key)}: ${entry.value}'),
            visualDensity: VisualDensity.compact,
          ),
      ],
    );
  }
}

class _KeptList extends StatelessWidget {
  const _KeptList({required this.items});

  final List<String> items;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final item in items)
          Padding(
            padding: const EdgeInsets.only(bottom: 2),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.check, size: 16),
                const SizedBox(width: 6),
                Expanded(child: Text(item)),
              ],
            ),
          ),
      ],
    );
  }
}
