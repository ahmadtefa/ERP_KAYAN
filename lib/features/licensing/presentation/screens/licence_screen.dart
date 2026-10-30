import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../data/licence_data_source.dart';
import '../providers/licence_providers.dart';

/// The licence: what this installation is licensed to do, and the one place a
/// key can be entered.
///
/// It is reachable while the licence is expired or suspended - that is the
/// point of it - so it must never depend on a business endpoint to render.
class LicenceScreen extends ConsumerStatefulWidget {
  const LicenceScreen({super.key});

  @override
  ConsumerState<LicenceScreen> createState() => _LicenceScreenState();
}

class _LicenceScreenState extends ConsumerState<LicenceScreen> {
  final _keyController = TextEditingController();
  String _operation = 'activation';
  bool _busy = false;
  String? _error;
  String? _notice;
  List<Map<String, dynamic>>? _events;

  @override
  void dispose() {
    _keyController.dispose();
    super.dispose();
  }

  Future<void> _apply() async {
    final l10n = context.l10n;
    final key = _keyController.text.trim();
    if (key.isEmpty) {
      setState(() => _error = l10n.licenceKeyHint);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    final failure = await ref
        .read(licenceActionsProvider)
        .apply(_operation, key);
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (failure == null) {
        _notice = l10n.licenceApplied;
        _keyController.clear();
      } else {
        _error = failure == 'EMPTY' ? l10n.licenceKeyHint : failure;
      }
    });
  }

  Future<void> _confirmClock() async {
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    final failure = await ref.read(licenceActionsProvider).confirmClock();
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (failure == null) {
        _notice = context.l10n.licenceApplied;
      } else {
        _error = failure;
      }
    });
  }

  Future<void> _loadEvents() async {
    setState(() => _busy = true);
    try {
      final rows = await ref.read(licenceActionsProvider).events();
      if (!mounted) return;
      setState(() {
        _events = rows;
        _busy = false;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = '$error';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final statusAsync = ref.watch(licenceStatusProvider);

    return ModuleScaffold(
      title: l10n.licence,
      subtitle: l10n.licenceSubtitle,
      trailing: IconButton(
        tooltip: l10n.retry,
        icon: const Icon(Icons.refresh),
        onPressed: () => ref.invalidate(licenceStatusProvider),
      ),
      body: ListView(
        padding: AppSpacing.pagePadding,
        children: [
          if (statusAsync.isLoading && !statusAsync.hasValue)
            const Padding(
              padding: EdgeInsets.all(AppSpacing.xxl),
              child: LinearProgressIndicator(),
            )
          else if (statusAsync.hasError && !statusAsync.hasValue)
            _MessageCard(
              icon: Icons.error_outline,
              title: l10n.errorDialogTitle,
              body: '${statusAsync.error}',
              tone: _Tone.error,
            )
          else if (statusAsync.hasValue) ...[
            _StatusCard(status: statusAsync.value!),
            if (statusAsync.value!.expiringSoon) ...[
              const SizedBox(height: AppSpacing.lg),
              _MessageCard(
                icon: Icons.schedule,
                title: l10n.licenceDaysRemaining,
                body: l10n.licenceExpiringSoon,
                tone: _Tone.warning,
              ),
            ],
            if (statusAsync.value!.state != 'WRONG_MACHINE' &&
                (statusAsync.value!.clockState != 'OK' ||
                    statusAsync.value!.state == 'SUSPENDED')) ...[
              const SizedBox(height: AppSpacing.lg),
              _ClockCard(
                status: statusAsync.value!,
                busy: _busy,
                onConfirm: _confirmClock,
              ),
            ],
            const SizedBox(height: AppSpacing.lg),
            _RequestCodeCard(status: statusAsync.value!),
            const SizedBox(height: AppSpacing.lg),
            _ApplyCard(
              controller: _keyController,
              operation: _operation,
              busy: _busy,
              error: _error,
              notice: _notice,
              canApply: statusAsync.value!.configured,
              onOperation: (value) => setState(() => _operation = value),
              onApply: _apply,
            ),
            const SizedBox(height: AppSpacing.lg),
            _EventsCard(events: _events, busy: _busy, onLoad: _loadEvents),
            const SizedBox(height: AppSpacing.lg),
            const _BackupNote(),
            const SizedBox(height: AppSpacing.xxl),
          ],
        ],
      ),
    );
  }
}

enum _Tone { info, warning, error }

class _MessageCard extends StatelessWidget {
  const _MessageCard({
    required this.icon,
    required this.title,
    required this.body,
    required this.tone,
  });

  final IconData icon;
  final String title;
  final String body;
  final _Tone tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = switch (tone) {
      _Tone.error => scheme.error,
      _Tone.warning => scheme.tertiary,
      _Tone.info => scheme.primary,
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: color),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: AppSpacing.xs),
                  Text(body),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.status});

  final LicenceStatus status;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final dateFormat = MaterialLocalizations.of(context).formatMediumDate;

    final (label, colour) = switch (status.state) {
      'ACTIVE' => (l10n.licenceStateActive, theme.colorScheme.primary),
      'EXPIRED' => (l10n.licenceStateExpired, theme.colorScheme.error),
      'SUSPENDED' => (l10n.licenceStateSuspended, theme.colorScheme.error),
      'WRONG_MACHINE' => (
        l10n.licenceStateWrongMachine,
        theme.colorScheme.error,
      ),
      _ => (l10n.licenceStateUnlicensed, theme.colorScheme.tertiary),
    };

    String date(DateTime? value) =>
        value == null ? l10n.notAvailable : dateFormat(value);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.verified_user_outlined, color: colour),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    label,
                    style: theme.textTheme.titleLarge?.copyWith(color: colour),
                  ),
                ),
                Chip(
                  label: Text(
                    switch (status.enforcement) {
                      'enforce' => l10n.licenceEnforcementEnforce,
                      'off' => l10n.licenceEnforcementOff,
                      _ => l10n.licenceEnforcementWarn,
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            _Field(label: l10n.licenceMachineId, value: status.machineId),
            if (status.licenseId != null)
              _Field(
                label: l10n.licenceLicenceId,
                value: status.licenseId!,
              ),
            _Field(
              label: l10n.licenceExpiresAt,
              value: status.perpetual
                  ? l10n.licencePerpetual
                  : date(status.expiresAt),
            ),
            if (!status.perpetual && status.daysRemaining != null)
              _Field(
                label: l10n.licenceDaysRemaining,
                value: '${status.daysRemaining}',
              ),
            if (status.issuedAt != null)
              _Field(
                label: l10n.licenceIssuedAt,
                value: date(status.issuedAt),
              ),
            const Divider(height: AppSpacing.xxl),
            Text(l10n.licenceSeats, style: theme.textTheme.titleSmall),
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: AppSpacing.lg,
              runSpacing: AppSpacing.sm,
              children: [
                _Stat(
                  label: l10n.licenceSeatsUsedLabel,
                  value: '${status.seatsUsed}',
                ),
                _Stat(
                  label: l10n.licenceSeatsLimitLabel,
                  value: status.seatLimit == 0 ? l10n.notAvailable : '${status.seatLimit}',
                ),
                _Stat(
                  label: l10n.licenceSeatsAvailableLabel,
                  value: status.availableSeats == null
                      ? l10n.notAvailable
                      : '${status.availableSeats}',
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              l10n.licenceSeatsExplainer,
              style: theme.textTheme.bodySmall,
            ),
            if (status.publicKeyFingerprint == null) ...[
              const SizedBox(height: AppSpacing.md),
              _MessageCard(
                icon: Icons.key_off_outlined,
                title: l10n.licencePublicKey,
                body: l10n.licenceNotConfigured,
                tone: _Tone.error,
              ),
            ] else
              _Field(
                label: l10n.licencePublicKey,
                value: status.publicKeyFingerprint!,
              ),
          ],
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 180,
            child: Text(
              label,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          Expanded(
            child: SelectableText(
              value,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: theme.textTheme.bodySmall),
        Text(value, style: theme.textTheme.titleMedium),
      ],
    );
  }
}

class _RequestCodeCard extends StatelessWidget {
  const _RequestCodeCard({required this.status});

  final LicenceStatus status;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.qr_code, color: theme.colorScheme.primary),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    l10n.licenceRequestCode,
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                IconButton(
                  tooltip: l10n.licenceCopy,
                  icon: const Icon(Icons.copy),
                  onPressed: () {
                    Clipboard.setData(
                      ClipboardData(text: status.requestCode),
                    );
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(l10n.licenceCopied),
                        duration: const Duration(seconds: 3),
                      ),
                    );
                  },
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            SelectableText(
              status.requestCode,
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              l10n.licenceRequestCodeHint,
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _ApplyCard extends StatelessWidget {
  const _ApplyCard({
    required this.controller,
    required this.operation,
    required this.busy,
    required this.canApply,
    required this.onOperation,
    required this.onApply,
    this.error,
    this.notice,
  });

  final TextEditingController controller;
  final String operation;
  final bool busy;
  final bool canApply;
  final String? error;
  final String? notice;
  final ValueChanged<String> onOperation;
  final VoidCallback onApply;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.licenceEnterKey, style: theme.textTheme.titleMedium),
            const SizedBox(height: AppSpacing.md),
            TextField(
              controller: controller,
              minLines: 2,
              maxLines: 4,
              enabled: !busy && canApply,
              decoration: InputDecoration(
                labelText: l10n.licenceEnterKey,
                hintText: l10n.licenceKeyHint,
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Text(l10n.licenceOperation, style: theme.textTheme.bodySmall),
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              children: [
                for (final entry in [
                  ('activation', l10n.licenceOperationActivation),
                  ('renewal', l10n.licenceOperationRenewal),
                  ('seats', l10n.licenceOperationSeats),
                  ('transfer', l10n.licenceOperationTransfer),
                ])
                  ChoiceChip(
                    label: Text(entry.$2),
                    selected: operation == entry.$1,
                    onSelected: busy || !canApply
                        ? null
                        : (_) => onOperation(entry.$1),
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            if (error != null) ...[
              _MessageCard(
                icon: Icons.block,
                title: l10n.warningDialogTitle,
                body: error!,
                tone: _Tone.error,
              ),
              const SizedBox(height: AppSpacing.md),
            ],
            if (notice != null) ...[
              _MessageCard(
                icon: Icons.check_circle_outline,
                title: l10n.licenceApply,
                body: notice!,
                tone: _Tone.info,
              ),
              const SizedBox(height: AppSpacing.md),
            ],
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: FilledButton.icon(
                onPressed: busy || !canApply ? null : onApply,
                icon: const Icon(Icons.vpn_key_outlined),
                label: Text(l10n.licenceApply),
              ),
            ),
            if (!canApply) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                l10n.licenceNotConfigured,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ClockCard extends StatelessWidget {
  const _ClockCard({
    required this.status,
    required this.busy,
    required this.onConfirm,
  });

  final LicenceStatus status;
  final bool busy;
  final VoidCallback onConfirm;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _MessageCard(
              icon: Icons.access_time,
              title: l10n.licenceClockTitle,
              body: status.clockNote ?? l10n.licenceClockWarning,
              tone: status.clockState == 'TAMPERED'
                  ? _Tone.error
                  : _Tone.warning,
            ),
            const SizedBox(height: AppSpacing.sm),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: FilledButton.tonalIcon(
                onPressed: busy ? null : onConfirm,
                icon: const Icon(Icons.verified_outlined),
                label: Text(l10n.licenceConfirmClock),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EventsCard extends StatelessWidget {
  const _EventsCard({
    required this.events,
    required this.busy,
    required this.onLoad,
  });

  final List<Map<String, dynamic>>? events;
  final bool busy;
  final VoidCallback onLoad;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final rows = events;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.history, color: theme.colorScheme.primary),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    l10n.licenceEvents,
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                TextButton(
                  onPressed: busy ? null : onLoad,
                  child: Text(l10n.retry),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            if (rows == null)
              Text(l10n.licenceEventsEmpty, style: theme.textTheme.bodySmall)
            else if (rows.isEmpty)
              Text(l10n.licenceEventsEmpty, style: theme.textTheme.bodySmall)
            else
              for (final row in rows)
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text('${row['type'] ?? ''}'),
                  subtitle: Text('${row['detail'] ?? ''}'),
                  trailing: Text(
                    '${row['occurredAt'] ?? ''}'.split('T').first,
                  ),
                ),
          ],
        ),
      ),
    );
  }
}

class _BackupNote extends StatelessWidget {
  const _BackupNote();

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Card(
      child: ListTile(
        leading: const Icon(Icons.backup_outlined),
        title: Text(l10n.licenceOpenBackup),
        subtitle: Text(l10n.licenceBackupStillAvailable),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => context.go(AppRoutes.backup),
      ),
    );
  }
}
