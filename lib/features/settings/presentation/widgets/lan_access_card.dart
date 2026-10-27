import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

final networkInfoProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final client = ref.watch(apiClientProvider);
  try {
    return await client.get('/health/network');
  } on Failure {
    return const <String, dynamic>{};
  }
});

/// The state of the public-address lookup. It is only ever filled by pressing
/// the button: nothing leaves the machine on its own.
typedef PublicIpState = ({
  bool? ok,
  String? ip,
  DateTime? checkedAt,
  String? message,
});

class PublicIpController extends Notifier<PublicIpState> {
  @override
  PublicIpState build() => (ok: null, ip: null, checkedAt: null, message: null);

  void set(PublicIpState value) => state = value;
}

final publicIpProvider = NotifierProvider<PublicIpController, PublicIpState>(
  PublicIpController.new,
);

/// What this installation can be reached at, and what still has to be done to
/// reach it from another computer.
///
/// The card is fed by the server's own report of the interface it bound to, so
/// it never shows an address the server is not actually listening on. When the
/// server is bound to loopback, the LAN addresses are shown as *not in use*
/// with the exact setting that changes it, instead of a link that cannot open.
class LanAccessCard extends ConsumerWidget {
  const LanAccessCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final l10n = context.l10n;
    final networkAsync = ref.watch(networkInfoProvider);
    final data = networkAsync.value ?? const <String, dynamic>{};
    final lanReady = data['isLanAccessible'] == true;
    final port = data['port'] ?? 3000;
    final localUrl = '${data['localUrl'] ?? 'http://localhost:$port'}';
    final addresses = (data['addresses'] as List<dynamic>? ?? const [])
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList(growable: false);
    final interfaces = (data['interfaces'] as List<dynamic>? ?? const [])
        .whereType<Map>()
        .map((row) => Map<String, dynamic>.from(row))
        .toList(growable: false);

    void copy(String value, String message) {
      Clipboard.setData(ClipboardData(text: value));
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 3)),
      );
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.lan_outlined, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    l10n.networkAccessTitle,
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                IconButton(
                  tooltip: l10n.refreshStatus,
                  icon: const Icon(Icons.refresh, size: 20),
                  onPressed: () => ref.invalidate(networkInfoProvider),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (networkAsync.isLoading && data.isEmpty)
              const LinearProgressIndicator()
            else if (data.isEmpty)
              Text(l10n.networkUnavailable, style: theme.textTheme.bodySmall)
            else ...[
              Wrap(
                spacing: 8,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Chip(
                    avatar: Icon(
                      lanReady ? Icons.wifi_tethering : Icons.computer,
                      size: 16,
                    ),
                    label: Text(
                      lanReady ? l10n.lanReachable : l10n.localOnly,
                    ),
                  ),
                  Chip(
                    avatar: const Icon(Icons.storage_outlined, size: 16),
                    label: Text(
                      '${l10n.serverStatus}: '
                      '${data['database'] == 'up' ? l10n.serverReady : l10n.databaseDown}',
                    ),
                  ),
                  Chip(
                    label: Text(
                      '${l10n.listeningOn}: '
                      '${data['host'] ?? '—'}:${data['port'] ?? 3000}',
                    ),
                  ),

                ],
              ),
              const SizedBox(height: 12),
              _addressRow(
                context,
                label: l10n.localAddress,
                url: localUrl,
                onCopy: () => copy(localUrl, l10n.addressCopied),
              ),
              if (lanReady)
                for (final address in addresses)
                  _addressRow(
                    context,
                    label:
                        '${l10n.networkAddress} (${address['interface'] ?? ''})',
                    url: '${address['url'] ?? ''}',
                    onCopy: () => copy(
                      '${address['url'] ?? ''}',
                      l10n.addressCopied,
                    ),
                  )
              else if (interfaces.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  l10n.lanNotEnabledHint,
                  style: theme.textTheme.bodySmall,
                ),
                for (final address in interfaces)
                  _addressRow(
                    context,
                    label: '${l10n.wouldBeAddress} (${address['interface']})',
                    url: '${address['url']}',
                    enabled: false,
                    onCopy: () => copy('${address['url']}', l10n.addressCopied),
                  ),
              ],
              const SizedBox(height: 8),
              Text(
                l10n.lanFirewallHint,
                style: theme.textTheme.bodySmall,
              ),
              const Divider(height: 24),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      l10n.publicAddressTitle,
                      style: theme.textTheme.titleSmall,
                    ),
                  ),
                  TextButton.icon(
                    onPressed: () => _detectPublicIp(context, ref),
                    icon: const Icon(Icons.public, size: 18),
                    label: Text(l10n.detectPublicAddress),
                  ),
                ],
              ),
              _publicIp(context, ref, theme),
            ],
          ],
        ),
      ),
    );
  }

  Widget _addressRow(
    BuildContext context, {
    required String label,
    required String url,
    required VoidCallback onCopy,
    bool enabled = true,
  }) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          SizedBox(
            width: 200,
            child: Text(label, style: theme.textTheme.bodySmall),
          ),
          Expanded(
            child: SelectableText(
              url,
              style: theme.textTheme.titleSmall?.copyWith(
                color: enabled
                    ? theme.colorScheme.primary
                    : theme.colorScheme.outline,
              ),
            ),
          ),
          IconButton(
            tooltip: context.l10n.copyAddress,
            icon: const Icon(Icons.copy, size: 18),
            onPressed: onCopy,
          ),
        ],
      ),
    );
  }

  Widget _publicIp(BuildContext context, WidgetRef ref, ThemeData theme) {
    final l10n = context.l10n;
    final state = ref.watch(publicIpProvider);
    if (state.checkedAt == null) {
      return Text(l10n.publicAddressHint, style: theme.textTheme.bodySmall);
    }
    final time = state.checkedAt!.toLocal().toString().split('.').first;
    if (state.ok == true && (state.ip ?? '').isNotEmpty) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SelectableText(
            state.ip!,
            style: theme.textTheme.titleSmall?.copyWith(
              color: theme.colorScheme.primary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            '${l10n.lastChecked}: $time — ${l10n.publicAddressNotProof}',
            style: theme.textTheme.bodySmall,
          ),
        ],
      );
    }
    return Text(
      '${l10n.lastChecked}: $time — ${state.message ?? l10n.publicAddressUnavailable}',
      style: theme.textTheme.bodySmall,
    );
  }

  Future<void> _detectPublicIp(BuildContext context, WidgetRef ref) async {
    final l10n = context.l10n;
    final notifier = ref.read(publicIpProvider.notifier);
    notifier.set((
      ok: null,
      ip: null,
      checkedAt: DateTime.now(),
      message: l10n.publicAddressChecking,
    ));
    try {
      final data = await ref.read(apiClientProvider).get('/health/public-ip');
      notifier.set((
        ok: data['ok'] == true,
        ip: data['publicIp'] as String?,
        checkedAt: DateTime.tryParse('${data['checkedAt']}') ?? DateTime.now(),
        message: data['message'] as String?,
      ));
    } on Failure catch (error) {
      notifier.set((
        ok: false,
        ip: null,
        checkedAt: DateTime.now(),
        message: error.message,
      ));
    }
  }
}
