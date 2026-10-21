import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../core/image/company_logo_url.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../../shared/widgets/kpi_card.dart';
import '../../../../shared/widgets/page_header.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../../shared/widgets/surface_card.dart';
import '../../../accounting/presentation/providers/chart_of_accounts_providers.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../settings/presentation/providers/company_providers.dart';
import '../providers/dashboard_providers.dart';
import '../widgets/dashboard_panels.dart';

/// Executive dashboard, fed by the server-side figures: totals, cash, debts,
/// who buys most, what sells most and what is waiting.
///
/// The redesign keeps the same data and the same refresh behaviour; what
/// changes is the hierarchy. Six numbers an owner actually acts on get large
/// cards, the rest sit in one compact strip, and the lists below answer
/// "who?" and "what happened?" without competing for attention.
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
    // The profile reports a path, not an address; the running client is the
    // only one that knows the host it talks to.
    final brandMark = companyLogoUrl(
      ref.watch(appConfigProvider).apiBaseUrl,
      company,
    );
    final branches =
        branchesAsync.asData?.value
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

    final width = MediaQuery.sizeOf(context).width;
    final medium = width >= 650;
    final pagePadding = width >= 1280 ? 24.0 : 16.0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PageHeader(
          leading: brandMark == null
              ? null
              : ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: Image.network(
                    brandMark,
                    width: 48,
                    height: 48,
                    fit: BoxFit.contain,
                    errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                  ),
                ),
          eyebrow: companyName.isEmpty
              ? (arabic ? 'مساحة عمل الشركة' : 'Company workspace')
              : companyName,
          title: arabic ? 'لوحة التحكم' : 'Executive dashboard',
          subtitle: (arabic ? 'مرحباً، ' : 'Welcome back, ') +
              (user?.fullName ?? ''),
          actions: [
            OutlinedButton.icon(
              onPressed: () => context.go(AppRoutes.companySettings),
              icon: const Icon(Icons.business_outlined, size: 17),
              label: Text(l10n.companySettings),
            ),
            IconButton.filledTonal(
              tooltip: arabic ? 'تحديث البيانات' : 'Refresh data',
              onPressed: () {
                // Refresh every live source on this dashboard, including the
                // company identity and branch context in the header.
                ref.invalidate(dashboardSummaryProvider);
                ref.invalidate(dashboardMonthlyProvider);
                ref.invalidate(companyProfileProvider);
                ref.invalidate(branchesProvider);
                ref.invalidate(chartOfAccountsProvider);
              },
              icon: const Icon(Icons.refresh_rounded, size: 18),
            ),
          ],
        ),
        Container(
          height: 1,
          color: Theme.of(context).colorScheme.outlineVariant,
        ),
        Expanded(
          child: ListView(
            padding: EdgeInsets.fromLTRB(
              pagePadding,
              AppSpacing.lg,
              pagePadding,
              AppSpacing.xxl,
            ),
            children: [
              _CompanyContext(
                company: company,
                logoUrl: brandMark,
                name: companyName.isEmpty
                    ? (arabic ? 'مساحة عمل الشركة' : 'Company workspace')
                    : companyName,
                branch: branchName,
                arabic: arabic,
                onEdit: () => context.go(AppRoutes.companySettings),
              ),
              const SizedBox(height: AppSpacing.lg),
              summaryAsync.when(
                loading: () => const SizedBox(
                  height: 240,
                  child: LoadingView(),
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
                  medium: medium,
                  l10n: l10n,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Everything below the context strip, built from the server summary.
class _SummarySections extends StatelessWidget {
  const _SummarySections({
    required this.summary,
    required this.monthly,
    required this.monthlyLoading,
    required this.arabic,
    required this.medium,
    required this.l10n,
  });

  final Json summary;
  final Json? monthly;
  final bool monthlyLoading;
  final bool arabic;
  final bool medium;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final sales = Map<String, dynamic>.from(summary['sales'] as Map? ?? {});
    final purchases =
        Map<String, dynamic>.from(summary['purchases'] as Map? ?? {});
    final receipts =
        Map<String, dynamic>.from(summary['receipts'] as Map? ?? {});
    final payments =
        Map<String, dynamic>.from(summary['payments'] as Map? ?? {});
    final overdue = Map<String, dynamic>.from(summary['overdue'] as Map? ?? {});
    final parties = Map<String, dynamic>.from(summary['parties'] as Map? ?? {});
    final customers =
        Map<String, dynamic>.from(parties['customers'] as Map? ?? {});
    final suppliers =
        Map<String, dynamic>.from(parties['suppliers'] as Map? ?? {});
    final previous =
        Map<String, dynamic>.from(summary['previousPeriod'] as Map? ?? {});
    final quick = Map<String, dynamic>.from(summary['quickActions'] as Map? ?? {});
    final hasData = flag(summary, 'hasData', fallback: true);
    String money(Object? value) => formatAmount(asString(value), decimals: 0);

    // The six figures that belong on a KPI card: money in, money out, the
    // result, what is liquid, what is owed to us, what we owe.
    final primary = <_PrimaryMetric>[
      _PrimaryMetric(
        arabic ? 'إجمالي المبيعات' : 'Total sales',
        money(sales['total']),
        arabic
            ? '${sales['invoices'] ?? 0} فاتورة'
            : '${sales['invoices'] ?? 0} invoices',
        Icons.trending_up_rounded,
        AppTone.success,
      ),
      _PrimaryMetric(
        arabic ? 'إجمالي المشتريات' : 'Total purchases',
        money(purchases['total']),
        arabic
            ? '${purchases['invoices'] ?? 0} فاتورة'
            : '${purchases['invoices'] ?? 0} invoices',
        Icons.shopping_bag_outlined,
        AppTone.info,
      ),
      _PrimaryMetric(
        arabic ? 'صافي النتيجة' : 'Net result',
        money(summary['grossResult']),
        arabic ? 'إيرادات ناقص مصروفات' : 'Revenue less expenses',
        Icons.insights_rounded,
        AppTone.info,
      ),
      _PrimaryMetric(
        arabic ? 'النقدية' : 'Cash position',
        money(summary['cashPosition']),
        arabic ? 'الصناديق والبنوك' : 'Cash boxes and banks',
        Icons.account_balance_wallet_outlined,
        AppTone.neutral,
      ),
      _PrimaryMetric(
        arabic ? 'الذمم المدينة' : 'Receivables',
        money(summary['receivables']),
        arabic ? 'مستحق من العملاء' : 'Owed by customers',
        Icons.groups_2_outlined,
        AppTone.warning,
      ),
      _PrimaryMetric(
        arabic ? 'الذمم الدائنة' : 'Payables',
        money(summary['payables']),
        arabic ? 'مستحق للموردين' : 'Owed to suppliers',
        Icons.local_shipping_outlined,
        AppTone.danger,
      ),
    ];

    final secondary = <Widget>[
      StatStripItem(
        label: arabic ? 'المقبوضات' : 'Receipts',
        value: money(receipts['total']),
        icon: Icons.south_west_rounded,
        tone: AppTone.success,
      ),
      StatStripItem(
        label: arabic ? 'المدفوعات' : 'Payments',
        value: money(payments['total']),
        icon: Icons.north_east_rounded,
        tone: AppTone.info,
      ),
      StatStripItem(
        label: arabic ? 'المصروفات' : 'Expenses',
        value: money(summary['expenses']),
        icon: Icons.receipt_long_outlined,
        tone: AppTone.warning,
      ),
      StatStripItem(
        label: arabic ? 'فواتير متأخرة' : 'Overdue invoices',
        value: money(overdue['total']),
        icon: Icons.warning_amber_rounded,
        tone: AppTone.danger,
      ),
      StatStripItem(
        label: arabic ? 'العملاء' : 'Customers',
        value: '${customers['count'] ?? 0}',
        icon: Icons.people_outline,
      ),
      StatStripItem(
        label: arabic ? 'الموردون' : 'Suppliers',
        value: '${suppliers['count'] ?? 0}',
        icon: Icons.local_shipping_outlined,
      ),
    ];

    final monthlyRows = listOf(monthly?['months']);
    final topCustomers = listOf(summary['topCustomers']);
    final topItems = listOf(summary['topItems']);
    final recent = listOf(summary['recentDocuments']);
    final cashAccounts = listOf(summary['cashAccounts']);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (!hasData)
          Container(
            margin: const EdgeInsets.only(bottom: AppSpacing.md),
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md,
              vertical: AppSpacing.sm,
            ),
            decoration: BoxDecoration(
              color: AppColors.infoSoft,
              borderRadius: AppRadii.card,
              border: Border.all(color: AppColors.primary.withValues(alpha: 0.18)),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.info_outline_rounded,
                  size: 18,
                  color: AppColors.primary,
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    arabic
                        ? 'لا توجد مستندات في هذه الفترة بعد. ابدأ بتسجيل أول فاتورة أو سند.'
                        : 'There are no documents in this period yet. Raise your first invoice or voucher.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: AppColors.textPrimary,
                    ),
                  ),
                ),
              ],
            ),
          ),
        Row(
          children: [
            Text(
              arabic ? 'مؤشرات الأعمال' : 'Business overview',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Container(
                height: 1,
                color: theme.colorScheme.outlineVariant,
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth >= 1180
                ? 4
                : constraints.maxWidth >= 900
                    ? 3
                    : constraints.maxWidth >= 560
                        ? 2
                        : 1;
            const gap = AppSpacing.md;
            final cardWidth =
                (constraints.maxWidth - gap * (columns - 1)) / columns;
            return Wrap(
              spacing: gap,
              runSpacing: gap,
              children: [
                for (final metric in primary)
                  SizedBox(
                    width: cardWidth,
                    child: KpiCard(
                      label: metric.label,
                      value: metric.value,
                      caption: metric.caption,
                      icon: metric.icon,
                      tone: metric.tone,
                    ),
                  ),
              ],
            );
          },
        ),
        const SizedBox(height: AppSpacing.md),
        SurfaceCard(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.md,
          ),
          child: Wrap(
            spacing: AppSpacing.xxl,
            runSpacing: AppSpacing.md,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: secondary,
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        _ComparisonStrip(summary: summary, previous: previous, arabic: arabic),
        const SizedBox(height: AppSpacing.md),
        SurfaceCard(
          title: arabic ? 'المبيعات والمشتريات شهرياً' : 'Monthly sales & purchases',
          subtitle: arabic
              ? 'مقارنة الإيرادات والمشتريات خلال الأشهر المعروضة'
              : 'Revenue against purchases over the months shown',
          icon: Icons.stacked_bar_chart_outlined,
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg,
            AppSpacing.lg,
            AppSpacing.lg,
            AppSpacing.md,
          ),
          child: monthlyLoading && monthlyRows.isEmpty
              ? const SizedBox(height: 160, child: LoadingView())
              : MonthlyBarsChart(months: monthlyRows, arabic: arabic),
        ),
        const SizedBox(height: AppSpacing.md),
        _SectionTitle(
          title: arabic ? 'أعلى العملاء والمنتجات' : 'Top customers & products',
        ),
        const SizedBox(height: AppSpacing.sm),
        _ResponsivePair(
          medium: medium,
          gap: AppSpacing.md,
          first: TopListPanel(
            title: arabic ? 'أهم العملاء' : 'Top customers',
            rows: topCustomers,
            arabic: arabic,
            emptyText: arabic
                ? 'ستظهر الأسماء هنا عند توفر مبيعات.'
                : 'Names appear here once sales exist.',
          ),
          second: TopListPanel(
            title: arabic ? 'أكثر المنتجات مبيعاً' : 'Best-selling products',
            rows: topItems,
            arabic: arabic,
            quantitySuffix: arabic ? 'وحدة' : 'units',
            emptyText: arabic
                ? 'ستظهر الأصناف هنا عند توفر مبيعات.'
                : 'Items appear here once sales exist.',
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        _ResponsivePair(
          medium: medium,
          gap: AppSpacing.md,
          first: CashAccountsPanel(
            rows: cashAccounts,
            arabic: arabic,
            emptyText: arabic
                ? 'لم تُسجَّل حسابات نقدية بعد.'
                : 'No cash accounts recorded yet.',
          ),
          second: RecentDocumentsPanel(
            rows: recent,
            arabic: arabic,
            emptyText: arabic ? 'لا توجد عمليات بعد.' : 'No activity yet.',
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        _SectionTitle(title: arabic ? 'إجراءات سريعة' : 'Quick actions'),
        const SizedBox(height: AppSpacing.sm),
        _QuickActions(quick: quick, arabic: arabic, l10n: l10n),
      ],
    );
  }
}

class _PrimaryMetric {
  const _PrimaryMetric(
    this.label,
    this.value,
    this.caption,
    this.icon,
    this.tone,
  );

  final String label;
  final String value;
  final String caption;
  final IconData icon;
  final AppTone tone;
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Text(
          title,
          style: theme.textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: Container(height: 1, color: theme.colorScheme.outlineVariant),
        ),
      ],
    );
  }
}

/// Two panels side by side on desktop, stacked when the window is narrow.
class _ResponsivePair extends StatelessWidget {
  const _ResponsivePair({
    required this.medium,
    required this.gap,
    required this.first,
    required this.second,
  });

  final bool medium;
  final double gap;
  final Widget first;
  final Widget second;

  @override
  Widget build(BuildContext context) {
    if (!medium) {
      return Column(
        children: [first, SizedBox(height: gap), second],
      );
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: first),
        SizedBox(width: gap),
        Expanded(child: second),
      ],
    );
  }
}

/// This period against the previous one, in one honest line per figure.
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
    final scheme = theme.colorScheme;
    final changeRaw = asString(previous['revenueChange']);
    final change = changeRaw == null ? null : num.tryParse(changeRaw);
    final changeTone = change == null
        ? AppTone.neutral
        : change >= 0
            ? AppTone.success
            : AppTone.danger;
    return SurfaceCard(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      child: Wrap(
        spacing: AppSpacing.xxl,
        runSpacing: AppSpacing.md,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          _figure(
            context,
            arabic ? 'إيرادات هذه الفترة' : 'Revenue this period',
            formatAmount(asString(summary['revenue'])),
          ),
          _figure(
            context,
            arabic ? 'إيرادات الفترة السابقة' : 'Revenue previous period',
            formatAmount(asString(previous['revenue'])),
          ),
          _figure(
            context,
            arabic ? 'النتيجة السابقة' : 'Previous result',
            formatAmount(asString(previous['result'])),
          ),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                arabic ? 'التغير: ' : 'Change: ',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: changeTone.background,
                  borderRadius: BorderRadius.circular(AppRadii.sm),
                ),
                child: Text(
                  change == null
                      ? '—'
                      : '${change >= 0 ? '+' : ''}${change.toStringAsFixed(1)}%',
                  style: theme.textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: changeTone.foreground,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _figure(BuildContext context, String label, String value) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          style: theme.textTheme.labelSmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
            fontWeight: FontWeight.w500,
          ),
        ),
        const SizedBox(height: 1),
        Text(
          value,
          style: theme.textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.w700,
          ),
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
    required this.l10n,
  });

  final Json quick;
  final bool arabic;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final drafts = asString(quick['draftDocuments']) ?? '0';
    final overdue = asString(quick['overdueInvoices']) ?? '0';
    final reorder = asString(quick['itemsToReorder']) ?? '0';
    return LayoutBuilder(
      builder: (context, constraints) {
        // Column count follows the width the grid actually gets, not the
        // window: the sidebar already took 250 px of it.
        final available = constraints.maxWidth;
        final columns = available >= 980
            ? 5
            : available >= 760
            ? 4
            : available >= 520
            ? 3
            : 2;
        return GridView.count(
          crossAxisCount: columns,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: AppSpacing.sm,
          crossAxisSpacing: AppSpacing.sm,
          mainAxisExtent: 92,
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
      },
    );
  }
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.arabic, required this.onRetry});

  final bool arabic;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return SurfaceCard(
      padding: const EdgeInsets.all(AppSpacing.xxl),
      child: Column(
        children: [
          Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.errorSoft,
              borderRadius: BorderRadius.circular(AppRadii.lg),
            ),
            child: const Icon(
              Icons.cloud_off_rounded,
              size: 21,
              color: AppColors.error,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            arabic
                ? 'تعذر تحميل مؤشرات لوحة التحكم. تحقق من الاتصال ثم أعد المحاولة.'
                : 'The dashboard figures could not be loaded. Check the connection and try again.',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh_rounded, size: 17),
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

/// The company identity strip. It used to be a tall gradient hero; the same
/// information now sits in one compact navy band so the numbers start higher.
class _CompanyContext extends StatelessWidget {
  const _CompanyContext({
    required this.company,
    required this.logoUrl,
    required this.name,
    required this.branch,
    required this.arabic,
    required this.onEdit,
  });

  final Map<String, dynamic> company;
  final String? logoUrl;
  final String name;
  final String branch;
  final bool arabic;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final secondaryName = _localName(company, !arabic, 'nameAr', 'nameEn');
    final taxId = (company['taxId'] as String?)?.trim() ?? '';
    final code = (company['code'] as String?)?.trim() ?? '';
    Widget logo = const Icon(
      Icons.apartment_rounded,
      size: 24,
      color: Colors.white,
    );
    if (logoUrl != null && logoUrl!.isNotEmpty) {
      logo = Image.network(
        logoUrl!,
        width: 46,
        height: 46,
        fit: BoxFit.contain,
        errorBuilder: (_, _, _) => const Icon(
          Icons.apartment_rounded,
          size: 24,
          color: Colors.white,
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: AlignmentDirectional.centerStart,
          end: AlignmentDirectional.centerEnd,
          colors: [AppColors.navy, AppColors.navySoft],
        ),
        borderRadius: AppRadii.card,
      ),
      child: Row(
        children: [
          Container(
            width: 46,
            height: 46,
            clipBehavior: Clip.antiAlias,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(AppRadii.md),
              border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
            ),
            child: logo,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  name,
                  maxLines: 2,
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (secondaryName.isNotEmpty && secondaryName != name)
                  Text(
                    secondaryName,
                    maxLines: 2,
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: AppColors.onNavyMuted,
                    ),
                  ),
                const SizedBox(height: 5),
                Wrap(
                  spacing: AppSpacing.sm,
                  runSpacing: 4,
                  children: [
                    _ContextChip(icon: Icons.location_on_outlined, label: branch),
                    if (taxId.isNotEmpty)
                      _ContextChip(
                        icon: Icons.receipt_long_outlined,
                        label: (arabic ? 'الرقم الضريبي: ' : 'Tax ID: ') + taxId,
                      ),
                    if (code.isNotEmpty)
                      _ContextChip(
                        icon: Icons.badge_outlined,
                        label: (arabic ? 'كود الشركة: ' : 'Code: ') + code,
                      ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          IconButton(
            tooltip: arabic ? 'إعدادات الشركة' : 'Company settings',
            onPressed: onEdit,
            style: IconButton.styleFrom(
              foregroundColor: Colors.white,
              backgroundColor: Colors.white.withValues(alpha: 0.12),
            ),
            icon: const Icon(Icons.edit_outlined, size: 17),
          ),
        ],
      ),
    );
  }
}

class _ContextChip extends StatelessWidget {
  const _ContextChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 12, color: AppColors.onNavyMuted),
      const SizedBox(width: 3),
      ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 240),
        child: Text(
          label,
          maxLines: 2,
          style: const TextStyle(
            color: AppColors.onNavyMuted,
            fontSize: 11,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    ],
  );
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
