import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../shared/extensions/l10n_extension.dart';
import '../../../accounting/presentation/providers/chart_of_accounts_providers.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../../l10n/generated/app_localizations.dart';

/// Landing screen after sign-in.
///
/// Counts shown here come from the same providers the feature screens use, so
/// the dashboard cannot drift from the module it summarises. Modules that do
/// not exist yet are labelled as such instead of showing invented figures.
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final user = ref.watch(currentUserProvider);
    final accounts = ref.watch(chartOfAccountsProvider);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          '${l10n.welcomeBack}${user == null ? '' : ', ${user.fullName}'}',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 16),
        Wrap(
          spacing: 16,
          runSpacing: 16,
          children: [
            _StatCard(
              icon: Icons.account_tree_outlined,
              label: l10n.accountsTotal,
              // Shows a dash rather than a fabricated number while loading.
              value: accounts.when(
                data: (list) => '${list.length}',
                loading: () => '—',
                error: (_, _) => '—',
              ),
            ),
            _StatCard(
              icon: Icons.business_outlined,
              label: l10n.company,
              value: user?.companyId.isNotEmpty ?? false
                  ? user!.companyId
                  : l10n.notAvailable,
            ),
            _StatCard(
              icon: Icons.location_on_outlined,
              label: l10n.branch,
              value: user?.branchId ?? l10n.notAvailable,
            ),
          ],
        ),
        const SizedBox(height: 24),
        Text(l10n.quickAccess, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 12),
        GridView.count(
          crossAxisCount: MediaQuery.sizeOf(context).width >= 900 ? 4 : 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 1.4,
          children: [
            for (final module in _pendingModules(l10n))
              _ModuleTile(icon: module.icon, label: module.label),
          ],
        ),
      ],
    );
  }
}

/// Modules that are planned but intentionally not built yet.
///
/// REQUIRES BUSINESS DECISION: scope and priority of Sales, Purchasing,
/// Inventory and Reporting have not been agreed, so they are listed as
/// unavailable rather than stubbed with invented behaviour.
List<({IconData icon, String label})> _pendingModules(AppLocalizations l10n) =>
    [
      (icon: Icons.point_of_sale_outlined, label: l10n.sales),
      (icon: Icons.shopping_cart_outlined, label: l10n.purchases),
      (icon: Icons.inventory_2_outlined, label: l10n.inventory),
      (icon: Icons.bar_chart_outlined, label: l10n.reports),
    ];

class _ModuleTile extends StatelessWidget {
  const _ModuleTile({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(context.l10n.moduleComingSoon))),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: scheme.primary),
            const SizedBox(height: 8),
            Text(label),
          ],
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      width: 220,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Icon(icon, color: theme.colorScheme.primary),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: theme.textTheme.bodySmall),
                    Text(
                      value,
                      style: theme.textTheme.titleMedium,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
