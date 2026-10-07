import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../accounting/presentation/providers/chart_of_accounts_providers.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

/// Landing screen after sign-in.
///
/// Counts shown here come from the same providers the feature screens use, so
/// the dashboard cannot drift from the module it summarises.
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
          crossAxisCount: MediaQuery.sizeOf(context).width >= 1100
              ? 4
              : MediaQuery.sizeOf(context).width >= 700
              ? 3
              : 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 1.5,
          children: [
            for (final module in _modules(l10n))
              _ModuleTile(
                icon: module.icon,
                label: module.label,
                onTap: () => context.go(module.path),
              ),
          ],
        ),
      ],
    );
  }
}

/// Every module, as a tile that navigates straight to it.
List<({IconData icon, String label, String path})> _modules(
  AppLocalizations l10n,
) => [
  (
    icon: Icons.menu_book_outlined,
    label: l10n.journalEntries,
    path: AppRoutes.journalEntries,
  ),
  (icon: Icons.people_outline, label: l10n.customers, path: AppRoutes.customers),
  (
    icon: Icons.local_shipping_outlined,
    label: l10n.suppliers,
    path: AppRoutes.suppliers,
  ),
  (icon: Icons.category_outlined, label: l10n.items, path: AppRoutes.items),
  (icon: Icons.inventory_2_outlined, label: l10n.stock, path: AppRoutes.stock),
  (
    icon: Icons.point_of_sale_outlined,
    label: l10n.salesInvoices,
    path: AppRoutes.salesInvoices,
  ),
  (
    icon: Icons.shopping_cart_outlined,
    label: l10n.purchaseInvoices,
    path: AppRoutes.purchaseInvoices,
  ),
  (
    icon: Icons.account_tree_outlined,
    label: l10n.chartOfAccounts,
    path: AppRoutes.chartOfAccounts,
  ),
  (icon: Icons.bar_chart_outlined, label: l10n.reports, path: AppRoutes.reports),
  (
    icon: Icons.settings_outlined,
    label: l10n.settings,
    path: AppRoutes.settings,
  ),
];

class _ModuleTile extends StatelessWidget {
  const _ModuleTile({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: scheme.primary),
            const SizedBox(height: 8),
            Text(label, textAlign: TextAlign.center),
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
