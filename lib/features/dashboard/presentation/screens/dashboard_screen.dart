import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../accounting/presentation/providers/chart_of_accounts_providers.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../settings/presentation/providers/company_providers.dart';
import '../providers/dashboard_providers.dart';
import '../widgets/dashboard_panels.dart';

/// Responsive executive dashboard, fed by the server-side dashboard figures:
/// totals, cash, debts, who buys most, what sells most, and what is waiting.
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final user = ref.watch(currentUserProvider);
    final companyAsync = ref.watch(companyProfileProvider);
    final branchesAsync = ref.watch(branchesProvider);
    final summaryAsync = ref.watch(dashboardSummaryProvider);
    final monthlyAsync = ref.watch(dashboardMonthlyProvider);
    final company = companyAsync.asData?.value == null
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(companyAsync.asData!.value as Map);
    final branches = branchesAsync.asData?.value
            .map((e) => Map<String, dynamic>.from(e))
            .toList() ??
        <Map<String, dynamic>>[];
    final companyName = _localName(company, arabic, 'nameAr', 'nameEn');
    var branchName = '';
    if (user?.branchId != null) {
      for (final branch in branches) {
        if (branch['id'] == user!.branchId) {
          branchName = _localName(branch, arabic, 'nameAr', 'nameEn');
          break;
        }
      }
    }
    if (branchName.isEmpty && branches.isNotEmpty) {
      final headquarters = branches.where((b) => b['kind'] == 'HEADQUARTERS');
      branchName = _localName(
        headquarters.isNotEmpty ? headquarters.first : branches.first,
        arabic,
        'nameAr',
        'nameEn',
      );
    }
    if (branchName.isEmpty) branchName = user?.branchId ?? l10n.notAvailable;

    final wide = MediaQuery.sizeOf(context).width >= 1100;
    final medium = MediaQuery.sizeOf(context).width >= 650;
    final pad = wide ? 28.0 : 16.0;
    final scheme = Theme.of(context).colorScheme;

    return ListView(
      padding: EdgeInsets.fromLTRB(pad, 22, pad, 32),
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    arabic ? 'لوحة التحكم' : 'Executive dashboard',
                    style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.6,
                        ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    (arabic ? 'مرحباً، ' : 'Welcome back, ') +
                        (user?.fullName ?? ''),
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                  ),
                ],
              ),
            ),
            IconButton.filledTonal(
              tooltip: arabic ? 'تحديث البيانات' : 'Refresh data',
              onPressed: () {
                // Refresh every live source on this dashboard, including the
                // company identity and branch context in the hero header.
                ref.invalidate(dashboardSummaryProvider);
                ref.invalidate(dashboardMonthlyProvider);
                ref.invalidate(companyProfileProvider);
                ref.invalidate(branchesProvider);
                ref.invalidate(chartOfAccountsProvider);
              },
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
        ),
        const SizedBox(height: 22),
        _CompanyHero(
          company: company,
          name: companyName.isEmpty
              ? (arabic ? 'مساحة عمل الشركة' : 'Company workspace')
              : companyName,
          branch: branchName,
          arabic: arabic,
          onEdit: () => context.go(AppRoutes.companySettings),
        ),
        const SizedBox(height: 24),
        summaryAsync.when(
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: 48),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (error, _) => _ErrorCard(
            arabic: arabic,
            onRetry: () => ref.invalidate(dashboardSummaryProvider),
          ),
          data: (summary) => _SummarySections(
            summary: summary,
            monthly: monthlyAsync.asData?.value,
            monthlyLoading: monthlyAsync.isLoading,
            arabic: arabic,
            wide: wide,
            medium: medium,
            l10n: l10n,
          ),
        ),
      ],
    );
  }
}

/// Everything below the hero, built from the server summary.
class _SummarySections extends StatelessWidget {
  const _SummarySections({
    required this.summary,
    required this.monthly,
    required this.monthlyLoading,
    required this.arabic,
    required this.wide,
    required this.medium,
    required this.l10n,
  });

  final Json summary;
  final Json? monthly;
  final bool monthlyLoading;
  final bool arabic;
  final bool wide;
  final bool medium;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}

class _ComparisonStrip extends StatelessWidget {
  const _ComparisonStrip({
    required this.summary,
    required this.previous,
    required this.arabic,
  });

  final Json summary;
  final Json previous;
  final bool arabic;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final changeRaw = asString(previous['revenueChange']);
    final change = changeRaw == null ? null : num.tryParse(changeRaw);
    final changeColor = change == null
        ? theme.colorScheme.onSurfaceVariant
        : change >= 0
            ? const Color(0xFF1B8A5A)
            : const Color(0xFFC2474B);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest
            .withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Wrap(
        spacing: 24,
        runSpacing: 12,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          _comparisonItem(
            context,
            arabic ? 'إيرادات هذه الفترة' : 'Revenue this period',
            formatAmount(asString(summary['revenue'])),
          ),
          _comparisonItem(
            context,
            arabic ? 'إيرادات الفترة السابقة' : 'Revenue previous period',
            formatAmount(asString(previous['revenue'])),
          ),
          _comparisonItem(
            context,
            arabic ? 'النتيجة السابقة' : 'Previous result',
            formatAmount(asString(previous['result'])),
          ),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                arabic ? 'التغير: ' : 'Change: ',
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              Text(
                change == null
                    ? (arabic ? '—' : '—')
                    : '${change >= 0 ? '+' : ''}${change.toStringAsFixed(1)}%',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                  color: changeColor,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _comparisonItem(BuildContext context, String label, String value) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        Text(
          value,
          style: theme.textTheme.titleMedium
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
      ],
    );
  }
}

/// Module shortcuts plus the work waiting in drafts and overdue debts.
class _QuickActions extends StatelessWidget {
  const _QuickActions({
    required this.quick,
    required this.arabic,
    required this.wide,
    required this.medium,
    required this.l10n,
  });

  final Json quick;
  final bool arabic;
  final bool wide;
  final bool medium;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final drafts = asString(quick['draftDocuments']) ?? '0';
    final overdue = asString(quick['overdueInvoices']) ?? '0';
    final reorder = asString(quick['itemsToReorder']) ?? '0';
    return GridView.count(
      crossAxisCount: wide ? 5 : medium ? 3 : 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      childAspectRatio: wide ? 1.8 : 1.5,
      children: [
        for (final module in _modules(l10n))
          QuickActionTile(
            icon: module.icon,
            label: module.label,
            onTap: () => context.go(module.path),
            badge: switch (module.path) {
              AppRoutes.journalEntries => drafts,
              AppRoutes.salesInvoices => overdue,
              AppRoutes.stock => reorder,
              _ => null,
            },
          ),
      ],
    );
  }
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.arabic, required this.onRetry});

  final bool arabic;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: theme.colorScheme.errorContainer.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        children: [
          Icon(Icons.cloud_off_rounded,
              size: 40, color: theme.colorScheme.error),
          const SizedBox(height: 10),
          Text(
            arabic
                ? 'تعذر تحميل مؤشرات لوحة التحكم. تحقق من الاتصال ثم أعد المحاولة.'
                : 'The dashboard figures could not be loaded. Check the connection and try again.',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium,
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded),
            label: Text(arabic ? 'إعادة المحاولة' : 'Retry'),
          ),
        ],
      ),
    );
  }
}

String _localName(
  Map<String, dynamic> row,
  bool arabic,
  String arKey,
  String enKey,
) {
  final ar = (row[arKey] as String?)?.trim() ?? '';
  final en = (row[enKey] as String?)?.trim() ?? '';
  return arabic ? (ar.isNotEmpty ? ar : en) : (en.isNotEmpty ? en : ar);
}

class _CompanyHero extends StatelessWidget {
  const _CompanyHero({
    required this.company,
    required this.name,
    required this.branch,
    required this.arabic,
    required this.onEdit,
  });

  final Map<String, dynamic> company;
  final String name;
  final String branch;
  final bool arabic;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final secondaryName = _localName(company, !arabic, 'nameAr', 'nameEn');
    final taxId = (company['taxId'] as String?)?.trim() ?? '';
    final rawLogo = (company['logoBase64'] as String?)?.trim();
    Widget logo = const Icon(Icons.apartment_rounded, size: 32, color: Colors.white);
    if (rawLogo != null && rawLogo.isNotEmpty) {
      try {
        logo = Image.memory(
          base64Decode(rawLogo),
          width: 58,
          height: 58,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) =>
              const Icon(Icons.apartment_rounded, size: 32, color: Colors.white),
        );
      } catch (_) {
        logo = const Icon(Icons.apartment_rounded, size: 32, color: Colors.white);
      }
    }
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: AlignmentDirectional.topStart,
          end: AlignmentDirectional.bottomEnd,
          colors: [
            scheme.primary,
            Color.lerp(scheme.primary, const Color(0xFF152B43), 0.45)!,
          ],
        ),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: scheme.primary.withValues(alpha: 0.17),
            blurRadius: 24,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 64,
            height: 64,
            clipBehavior: Clip.antiAlias,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(18),
            ),
            child: logo,
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                      ),
                ),
                if (secondaryName.isNotEmpty && secondaryName != name) ...[
                  const SizedBox(height: 3),
                  Text(
                    secondaryName,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: Colors.white.withValues(alpha: 0.82),
                        ),
                  ),
                ],
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _HeroChip(
                      icon: Icons.location_on_outlined,
                      label: branch,
                    ),
                    if (taxId.isNotEmpty)
                      _HeroChip(
                        icon: Icons.receipt_long_outlined,
                        label: (arabic ? 'الرقم الضريبي: ' : 'Tax ID: ') + taxId,
                      ),
                    if ((company['code'] as String?)?.isNotEmpty ?? false)
                      _HeroChip(
                        icon: Icons.badge_outlined,
                        label: (arabic ? 'كود الشركة: ' : 'Company code: ') +
                            company['code'].toString(),
                      ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            tooltip: arabic ? 'إعدادات الشركة' : 'Company settings',
            onPressed: onEdit,
            style: IconButton.styleFrom(
              foregroundColor: Colors.white,
              backgroundColor: Colors.white.withValues(alpha: 0.14),
            ),
            icon: const Icon(Icons.edit_outlined),
          ),
        ],
      ),
    );
  }
}

class _HeroChip extends StatelessWidget {
  const _HeroChip({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.13),
          borderRadius: BorderRadius.circular(30),
          border: Border.all(color: Colors.white.withValues(alpha: 0.2)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 15, color: Colors.white),
            const SizedBox(width: 6),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 260),
              child: Text(
                label,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Colors.white, fontSize: 12),
              ),
            ),
          ],
        ),
      );
}

class _Metric {
  const _Metric(this.title, this.value, this.note, this.icon, this.color);
  final String title;
  final String value;
  final String note;
  final IconData icon;
  final Color color;
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.metric});
  final _Metric metric;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: theme.colorScheme.outlineVariant.withValues(alpha: 0.7),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.025),
            blurRadius: 16,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: metric.color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(metric.icon, color: metric.color),
              ),
              const Spacer(),
              Icon(Icons.north_east_rounded,
                  size: 17, color: theme.colorScheme.onSurfaceVariant),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            metric.title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            metric.value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w800,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            metric.note,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodySmall?.copyWith(color: metric.color),
          ),
        ],
      ),
    );
  }
}

List<({IconData icon, String label, String path})> _modules(
  AppLocalizations l10n,
) => [
      (icon: Icons.menu_book_outlined, label: l10n.journalEntries, path: AppRoutes.journalEntries),
      (icon: Icons.people_outline, label: l10n.customers, path: AppRoutes.customers),
      (icon: Icons.local_shipping_outlined, label: l10n.suppliers, path: AppRoutes.suppliers),
      (icon: Icons.category_outlined, label: l10n.items, path: AppRoutes.items),
      (icon: Icons.inventory_2_outlined, label: l10n.stock, path: AppRoutes.stock),
      (icon: Icons.point_of_sale_outlined, label: l10n.salesInvoices, path: AppRoutes.salesInvoices),
      (icon: Icons.shopping_cart_outlined, label: l10n.purchaseInvoices, path: AppRoutes.purchaseInvoices),
      (icon: Icons.account_tree_outlined, label: l10n.chartOfAccounts, path: AppRoutes.chartOfAccounts),
      (icon: Icons.bar_chart_outlined, label: l10n.reports, path: AppRoutes.reports),
      (icon: Icons.settings_outlined, label: l10n.settings, path: AppRoutes.settings),
    ];
