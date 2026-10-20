import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/platform/browser_actions.dart';
import '../../../../core/platform/picked_file.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../../../accounting/presentation/providers/chart_of_accounts_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../inventory/presentation/screens/items_screen.dart'
    show itemsListProvider;
import '../../../inventory/presentation/screens/stock_screen.dart'
    show stockListProvider;
import '../../../parties/presentation/screens/parties_screen.dart'
    show customersListProvider, suppliersListProvider;
import '../providers/data_providers.dart';

/// Bringing customers, suppliers or items in from a spreadsheet.
///
/// The screen is built around one idea: nothing is written until the person
/// has seen what would be written. Choosing a file reads it and shows the
/// result; only then does the button that actually imports appear.
class ImportScreen extends ConsumerWidget {
  const ImportScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final state = ref.watch(importControllerProvider);
    final controller = ref.read(importControllerProvider.notifier);

    return ModuleScaffold(
      title: l10n.importData,
      trailing: IconButton(
        tooltip: l10n.startOver,
        icon: const Icon(Icons.restart_alt),
        onPressed: controller.reset,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const _Steps(),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.whatAreYouImporting,
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<ImportKind>(
                    initialValue: state.kind,
                    decoration: InputDecoration(labelText: l10n.whatAreYouImporting),
                    items: [
                      DropdownMenuItem(value: ImportKind.customers, child: Text(l10n.customers)),
                      DropdownMenuItem(value: ImportKind.suppliers, child: Text(l10n.suppliers)),
                      DropdownMenuItem(value: ImportKind.items, child: Text(l10n.items)),
                      DropdownMenuItem(value: ImportKind.chartOfAccounts, child: Text(l10n.chartOfAccounts)),
                      DropdownMenuItem(value: ImportKind.openingBalances, child: Text(l10n.openingBalancesTitle)),
                    ],
                    onChanged: (choice) {
                      if (choice != null) controller.chooseKind(choice);
                    },
                  ),
                  if (state.kind == ImportKind.openingBalances) ...[
                    const SizedBox(height: 10),
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: TextButton.icon(
                        onPressed: () => context.go('/accounting/opening-balances'),
                        icon: const Icon(Icons.fact_check_outlined),
                        label: Text(l10n.reviewOpeningBalances),
                      ),
                    ),
                  ],
                  const SizedBox(height: 20),
                  Text(l10n.templateFirst,
                      style: Theme.of(context).textTheme.titleSmall),
                  const SizedBox(height: 4),
                  Text(
                    l10n.templateExplains,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: () {
                      final language =
                          Localizations.localeOf(context).languageCode;
                      runDownload(
                        context,
                        ref.read(reportLinkProvider).importTemplate(
                              kind: state.kind.slug,
                              language: language,
                            ),
                      );
                    },
                    icon: const Icon(Icons.download_outlined),
                    label: Text(l10n.downloadTemplate),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          _FileCard(state: state),
          if (state.kind.supportsUpsert) ...[
            const SizedBox(height: 16),
            _ModeCard(state: state),
          ],
          if (state.failure != null) ...[
            const SizedBox(height: 16),
            _FailureCard(message: state.failure!),
          ],
          if (state.report != null) ...[
            const SizedBox(height: 16),
            _ResultCard(state: state),
          ],
        ],
      ),
    );
  }
}

class _Steps extends StatelessWidget {
  const _Steps();
  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final steps = [l10n.importStep1, l10n.importStep2, l10n.importStep3, l10n.importStep4];
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (var index = 0; index < steps.length; index += 1)
          Chip(
            avatar: CircleAvatar(
              radius: 11,
              child: Text('${index + 1}', style: const TextStyle(fontSize: 11)),
            ),
            label: Text(steps[index]),
          ),
      ],
    );
  }
}

class _FileCard extends ConsumerWidget {
  const _FileCard({required this.state});

  final ImportState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final controller = ref.read(importControllerProvider.notifier);
    final file = state.file;

    Future<void> choose() async {
      PickedFile? picked;
      try {
        picked = await pickFile(extensions: ['.xlsx', '.csv']);
      } catch (error) {
        controller.failed(describeApiError(error));
        return;
      }
      controller.chooseFile(picked);
      if (picked != null) await _read(ref, dryRun: true);
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.chooseFile, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            if (file != null)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(
                  file.isSpreadsheet ? Icons.table_chart_outlined : Icons.insert_drive_file_outlined,
                ),
                title: Text(file.name),
                subtitle: Text(file.readableSize),
                trailing: IconButton(
                  tooltip: l10n.removeFile,
                  icon: const Icon(Icons.close),
                  onPressed: () => controller.chooseFile(null),
                ),
              )
            else
              Text(
                l10n.fileAcceptHint,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: [
                FilledButton.icon(
                  onPressed: state.busy ? null : choose,
                  icon: const Icon(Icons.upload_file_outlined),
                  label: Text(file == null ? l10n.chooseFile : l10n.chooseAnotherFile),
                ),
                if (file != null)
                  OutlinedButton.icon(
                    onPressed: state.busy
                        ? null
                        : () => _read(ref, dryRun: true),
                    icon: const Icon(Icons.fact_check_outlined),
                    label: Text(l10n.readWithoutSaving),
                  ),
              ],
            ),
            if (state.busy) ...[
              const SizedBox(height: 12),
              const LinearProgressIndicator(),
            ],
          ],
        ),
      ),
    );
  }

  /// Reads the file. Called with `dryRun: true` from the screen, and only the
  /// second, deliberate press writes anything.
  Future<void> _read(WidgetRef ref, {required bool dryRun}) async {
    final controller = ref.read(importControllerProvider.notifier);
    final state = ref.read(importControllerProvider);
    final file = state.file;
    if (file == null) return;

    controller.beginning();
    try {
      final report = await ref.read(dataServiceProvider).import(
            kind: state.kind,
            file: file,
            mode: state.mode,
            dryRun: dryRun,
          );
      controller.succeeded(report);
    } catch (error) {
      controller.failed(describeApiError(error));
    }
  }
}

class _ModeCard extends ConsumerWidget {
  const _ModeCard({required this.state});

  final ImportState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final controller = ref.read(importControllerProvider.notifier);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.whatAboutExisting,
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            RadioGroup<ImportMode>(
              groupValue: state.mode,
              onChanged: (value) => controller.chooseMode(value ?? ImportMode.insert),
              child: Column(
                children: [
                  RadioListTile<ImportMode>(
                    value: ImportMode.insert,
                    title: Text(l10n.importModeSkip),
                    subtitle: Text(l10n.importModeSkipHint),
                    contentPadding: EdgeInsets.zero,
                  ),
                  RadioListTile<ImportMode>(
                    value: ImportMode.upsert,
                    title: Text(l10n.importModeUpdate),
                    subtitle: Text(l10n.importModeUpdateHint),
                    contentPadding: EdgeInsets.zero,
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

class _FailureCard extends StatelessWidget {
  const _FailureCard({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(Icons.error_outline, color: scheme.onErrorContainer),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                message,
                style: TextStyle(color: scheme.onErrorContainer),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ResultCard extends ConsumerWidget {
  const _ResultCard({required this.state});

  final ImportState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final report = state.report!;
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  report.hasErrors ? Icons.warning_amber_outlined : Icons.check_circle_outline,
                  color: report.hasErrors ? scheme.error : scheme.primary,
                ),
                const SizedBox(width: 8),
                Text(
                  report.dryRun ? l10n.readResult : l10n.importResult,
                  style: theme.textTheme.titleMedium,
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 12,
              runSpacing: 8,
              children: [
                _Count(label: l10n.rowsInFile, value: report.totalRows),
                _Count(label: l10n.willBeAdded, value: report.created),
                _Count(label: l10n.willBeUpdated, value: report.updated),
                _Count(label: l10n.willBeSkipped, value: report.skipped),
              ],
            ),
            if (report.unknownColumns.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(
                '${l10n.columnsNotUnderstood}: ${report.unknownColumns.join(', ')}',
                style: theme.textTheme.bodySmall,
              ),
            ],
            if (report.hasErrors) ...[
              const SizedBox(height: 12),
              Text(l10n.rowsWithProblems, style: theme.textTheme.titleSmall),
              const SizedBox(height: 4),
              for (final error in report.errors.take(20))
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Text(
                    '• ${l10n.row} ${error['row']} — ${error['column']}: ${error['message']}',
                    style: theme.textTheme.bodySmall?.copyWith(color: scheme.error),
                  ),
                ),
              if (report.errors.length > 20)
                Text('… ${report.errors.length - 20} ${l10n.moreRows}',
                    style: theme.textTheme.bodySmall),
              const SizedBox(height: 8),
              Text(l10n.fixErrorsThenRetry, style: theme.textTheme.bodySmall),
            ],
            const SizedBox(height: 16),
            if (report.dryRun)
              FilledButton.icon(
                onPressed: state.readyToCommit
                    ? () => _commit(context, ref)
                    : null,
                icon: const Icon(Icons.save_alt_outlined),
                label: Text(l10n.importForReal),
              )
            else if (report.hasErrors)
              Text(l10n.fixErrorsThenRetry, style: theme.textTheme.bodyMedium?.copyWith(color: scheme.error))
            else
              Wrap(
                spacing: 12,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.check, size: 18),
                      const SizedBox(width: 8),
                      Text(l10n.importDone),
                    ],
                  ),
                  if (report.raw['draft'] is Map)
                    OutlinedButton.icon(
                      onPressed: () => context.go('/accounting/opening-balances'),
                      icon: const Icon(Icons.fact_check_outlined),
                      label: Text(l10n.reviewOpeningBalances),
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _commit(BuildContext context, WidgetRef ref) async {
    final controller = ref.read(importControllerProvider.notifier);
    final current = ref.read(importControllerProvider);
    final file = current.file;
    if (file == null) return;

    controller.beginning();
    try {
      final report = await ref.read(dataServiceProvider).import(
            kind: current.kind,
            file: file,
            mode: current.mode,
            dryRun: false,
          );
      // An import writes records other screens have already cached. Refresh
      // them now, so a customer, item or opening stock imported here appears
      // in the invoice pickers, item list and stock screen without a restart.
      ref.invalidate(customersProvider);
      ref.invalidate(suppliersProvider);
      ref.invalidate(itemsProvider);
      ref.invalidate(customersListProvider);
      ref.invalidate(suppliersListProvider);
      ref.invalidate(itemsListProvider);
      ref.invalidate(chartOfAccountsProvider);
      ref.invalidate(stockListProvider);
      controller.succeeded(report);
    } catch (error) {
      controller.failed(describeApiError(error));
    }
  }
}

class _Count extends StatelessWidget {
  const _Count({required this.label, required this.value});

  final String label;
  final int value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('$value', style: theme.textTheme.titleLarge),
          Text(label, style: theme.textTheme.bodySmall),
        ],
      ),
    );
  }
}
