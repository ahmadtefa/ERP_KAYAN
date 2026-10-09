import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../shared/extensions/l10n_extension.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../providers/locale_provider.dart';
import '../widgets/company_management_panel.dart';

/// Application settings.
///
/// Currently exposes locale selection and session information. Nothing here
/// mutates financial data.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  static const appVersion = '0.1.0+1';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final user = ref.watch(currentUserProvider);
    final locale = ref.watch(localeControllerProvider).value;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Column(
            children: [
              ListTile(
                leading: const Icon(Icons.person_outline),
                title: Text(l10n.signedInAs),
                subtitle: Text(user?.fullName ?? l10n.notAvailable),
              ),
              ListTile(
                leading: const Icon(Icons.business_outlined),
                title: Text(l10n.company),
                subtitle: Text(
                  (user?.companyId.isNotEmpty ?? false)
                      ? user!.companyId
                      : l10n.notAvailable,
                ),
              ),
              ListTile(
                leading: const Icon(Icons.location_on_outlined),
                title: Text(l10n.branch),
                subtitle: Text(user?.branchId ?? l10n.notAvailable),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        const CompanyManagementPanel(),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.language,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 12),
                SegmentedButton<String>(
                  segments: [
                    ButtonSegment(
                      value: 'system',
                      label: Text(l10n.systemDefault),
                    ),
                    ButtonSegment(value: 'en', label: Text(l10n.english)),
                    ButtonSegment(value: 'ar', label: Text(l10n.arabic)),
                  ],
                  selected: {locale?.languageCode ?? 'system'},
                  onSelectionChanged: (selection) {
                    final value = selection.first;
                    ref
                        .read(localeControllerProvider.notifier)
                        .setLocale(value == 'system' ? null : Locale(value));
                  },
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Column(
            children: [
              ListTile(
                leading: const Icon(Icons.info_outline),
                title: Text(l10n.about),
                subtitle: Text(
                  '${l10n.aboutDescription}\n${l10n.version}: $appVersion',
                ),
                isThreeLine: true,
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        FilledButton.tonalIcon(
          onPressed: () => ref.read(authControllerProvider.notifier).signOut(),
          icon: const Icon(Icons.logout),
          label: Text(l10n.signOut),
        ),
      ],
    );
  }
}
