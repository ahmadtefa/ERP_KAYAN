import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/widgets/kpi_card.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../../shared/widgets/surface_card.dart';
import '../../../auth/domain/entities/app_user.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../notifications/presentation/screens/notification_center_screen.dart';
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
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final user = ref.watch(currentUserProvider);
    final authorizedSections = _dashboardSectionsFor(user);
    final summaryAsync = ref.watch(dashboardSummaryProvider);
    final monthlyAsync = ref.watch(dashboardMonthlyProvider);

    final width = MediaQuery.sizeOf(context).width;
    final medium = width >= 650;
    final pagePadding = width >= 1280 ? 24.0 : 16.0;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: ListView(
            padding: EdgeInsets.fromLTRB(
              pagePadding,
              AppSpacing.md,
              pagePadding,
              AppSpacing.xxl,
            ),
            children: [
              // The existing dashboard begins immediately beneath the shell;
              // its live figures are the first content on this home screen.
              Row(
                children: [
                  Expanded(
                    child: Text(
                      arabic ? 'لوحة المتابعة' : 'Business dashboard',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                  ),
                  IconButton(
                    tooltip: arabic ? 'تحديث البيانات' : 'Refresh data',
                    visualDensity: VisualDensity.compact,
                    iconSize: 18,
                    onPressed: () {
                      // Refresh every live dashboard and notification source.
                      ref.invalidate(dashboardSummaryProvider);
                      ref.invalidate(dashboardMonthlyProvider);
                      ref.invalidate(notificationFeedProvider);
                      ref.invalidate(notificationCountProvider);
                    },
                    icon: const Icon(Icons.refresh_rounded),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
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
                  authorizedSections: authorizedSections,
                ),
              ),
              // Below the numbers, not above them: an owner who opens the
              // dashboard to see today's sales should not have to scroll past
              // a list to find them, and the alerts are one line each anyway.
              const SizedBox(height: AppSpacing.lg),
              _NotificationsPanel(arabic: arabic),
            ],
          ),
        ),
      ],
    );
  }
}

/// What the program wants the owner to deal with, on the screen they open first.
///
/// Five rows at most, ordered by the server (loudest first, then newest). It is
/// deliberately not a copy of the centre: it is the part of the centre that
/// changes what somebody does this morning. A person without
/// `notifications.read` sees nothing at all, because there is nothing they may
/// read.
class _NotificationsPanel extends ConsumerWidget {
  const _NotificationsPanel({required this.arabic});

  final bool arabic;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(currentUserProvider);
    if (user == null || !user.can('notifications.read')) {
      return const SizedBox.shrink();
    }
    final theme = Theme.of(context);
    final feed = ref.watch(notificationFeedProvider);
    final rows = feed.asData?.value ?? const <Json>[];

    return SurfaceCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.notifications_active_outlined, size: 18, color: theme.colorScheme.primary),
              const SizedBox(width: AppSpacing.sm),
              Text(
                arabic ? 'التنبيهات' : 'Notifications',
                style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(width: AppSpacing.sm),
              if (rows.isNotEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.errorContainer,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    '${rows.length}',
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.onErrorContainer,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              const Spacer(),
              TextButton(
                onPressed: () => context.go(AppRoutes.notifications),
                child: Text(arabic ? 'عرض الكل' : 'View all'),
              ),
            ],
          ),
          if (feed.isLoading && rows.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
              child: Center(child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))),
            )
          else if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
              child: Text(
                arabic ? 'لا توجد تنبيهات تحتاج انتباهك الآن' : 'Nothing needs your attention right now',
                style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            )
          else
            for (final row in rows)
              _NotificationLine(row: row, arabic: arabic),
        ],
      ),
    );
  }
}

class _NotificationLine extends StatelessWidget {
  const _NotificationLine({required this.row, required this.arabic});

  final Json row;
  final bool arabic;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final severity = text(row, 'severity');
    final tone = severity == 'CRITICAL'
        ? theme.colorScheme.error
        : severity == 'WARNING'
            ? const Color(0xFFE8710A)
            : theme.colorScheme.primary;
    return InkWell(
      borderRadius: BorderRadius.circular(AppRadii.sm),
      onTap: () => openNotificationTarget(context, row),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
        child: Row(
          children: [
            Container(
              width: 7,
              height: 7,
              decoration: BoxDecoration(color: tone, shape: BoxShape.circle),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                arabic ? text(row, 'titleAr') : text(row, 'titleEn'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Icon(Icons.chevron_left_rounded, size: 16, color: theme.colorScheme.outline),
          ],
        ),
      ),
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
    required this.authorizedSections,
  });

  final Json summary;
  final Json? monthly;
  final bool monthlyLoading;
  final bool arabic;
  final bool medium;
  final Set<String> authorizedSections;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final serverSections = (summary['allowedSections'] as List? ?? const [])
        .map((value) => value.toString())
        .toSet();
    final sections = serverSections.intersection(authorizedSections);
    final sales = Map<String, dynamic>.from(summary['sales'] as Map? ?? {});
    final purchases =
        Map<String, dynamic>.from(summary['purchases'] as Map? ?? {});
    final receipts =
        Map<String, dynamic>.from(summary['receipts'] as Map? ?? {});
    final payments =
        Map<String, dynamic>.from(summary['payments'] as Map? ?? {});
    final overdue = Map<String, dynamic>.from(summary['overdue'] as Map? ?? {});
    final previous =
        Map<String, dynamic>.from(summary['previousPeriod'] as Map? ?? {});
    final hasData = flag(summary, 'hasData', fallback: true);
    String money(Object? value) => formatAmount(asString(value), decimals: 0);

    // Existing KPI cards are reused; each enters the layout only when the
    // server returned its authorized section. Wrap auto-flows the remaining
    // cards to the available desktop/mobile width.
    final primary = <_PrimaryMetric>[
      if (sections.contains('sales'))
        _PrimaryMetric(
          arabic ? 'إجمالي المبيعات' : 'Total sales',
          money(sales['total']),
          arabic
              ? '${sales['invoices'] ?? 0} فاتورة'
              : '${sales['invoices'] ?? 0} invoices',
          Icons.trending_up_rounded,
          AppTone.success,
          SectionAccents.sales,
        ),
      if (sections.contains('purchases'))
        _PrimaryMetric(
          arabic ? 'إجمالي المشتريات' : 'Total purchases',
          money(purchases['total']),
          arabic
              ? '${purchases['invoices'] ?? 0} فاتورة'
              : '${purchases['invoices'] ?? 0} invoices',
          Icons.shopping_bag_outlined,
          AppTone.info,
          SectionAccents.purchases,
        ),
      if (sections.contains('profit'))
        _PrimaryMetric(
          arabic ? 'صافي النتيجة' : 'Net result',
          money(summary['grossResult']),
          arabic ? 'إيرادات ناقص مصروفات' : 'Revenue less expenses',
          Icons.insights_rounded,
          AppTone.info,
          SectionAccents.insights,
        ),
      if (sections.contains('cash'))
        _PrimaryMetric(
          arabic ? 'النقدية' : 'Cash position',
          money(summary['cashPosition']),
          arabic ? 'الصناديق والبنوك' : 'Cash boxes and banks',
          Icons.account_balance_wallet_outlined,
          AppTone.neutral,
          SectionAccents.cash,
        ),
      if (sections.contains('receivables'))
        _PrimaryMetric(
          arabic ? 'الذمم المدينة' : 'Receivables',
          money(summary['receivables']),
          arabic ? 'مستحق من العملاء' : 'Owed by customers',
          Icons.groups_2_outlined,
          AppTone.warning,
          SectionAccents.parties,
        ),
      if (sections.contains('payables'))
        _PrimaryMetric(
          arabic ? 'الذمم الدائنة' : 'Payables',
          money(summary['payables']),
          arabic ? 'مستحق للموردين' : 'Owed to suppliers',
          Icons.local_shipping_outlined,
          AppTone.danger,
          SectionAccents.parties,
        ),
      if (sections.contains('stock'))
        _PrimaryMetric(
          arabic ? 'قيمة المخزون' : 'Inventory value',
          money((summary['stock'] as Map?)?['value']),
          arabic ? 'قيمة الرصيد المتاح' : 'Current stock value',
          Icons.inventory_2_outlined,
          AppTone.success,
          SectionAccents.inventory,
        ),
    ];

    final secondary = <Widget>[
      if (sections.contains('movements')) ...[
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
      ],
      if (sections.contains('revenue'))
        StatStripItem(
          label: arabic ? 'المصروفات' : 'Expenses',
          value: money(summary['expenses']),
          icon: Icons.receipt_long_outlined,
          tone: AppTone.warning,
        ),
      if (sections.contains('receivables'))
        StatStripItem(
          label: arabic ? 'فواتير متأخرة' : 'Overdue invoices',
          value: money(overdue['total']),
          icon: Icons.warning_amber_rounded,
          tone: AppTone.danger,
        ),
    ];

    final monthlyRows = listOf(monthly?['months']);
    final topCustomers = listOf(summary['topCustomers']);
    final topItems = listOf(summary['topItems']);
    final recent = listOf(summary['recentDocuments']);
    final cashAccounts = listOf(summary['cashAccounts']);
    final showChart = sections.contains('charts') &&
        (sections.contains('sales') ||
            sections.contains('purchases') ||
            sections.contains('profit'));

    if (sections.isEmpty) {
      return SurfaceCard(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Text(
          arabic
              ? 'لا توجد مؤشرات متاحة لحسابك. تواصل مع مدير النظام لمنحك الصلاحيات المناسبة.'
              : 'No dashboard indicators are available for your account. Ask your administrator to grant access.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyMedium,
        ),
      );
    }

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
        if (primary.isNotEmpty) ...[
          Row(
            children: [
              Text(
                arabic ? 'مؤشرات الأعمال' : 'Business overview',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(child: Container(height: 1, color: theme.colorScheme.outlineVariant)),
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
                        accent: metric.accent,
                      ),
                    ),
                ],
              );
            },
          ),
        ],
        if (secondary.isNotEmpty) ...[
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
        ],
        if (sections.contains('revenue') &&
            sections.contains('profit') &&
            sections.contains('charts')) ...[
          const SizedBox(height: AppSpacing.md),
          _ComparisonStrip(summary: summary, previous: previous, arabic: arabic),
        ],
        if (showChart) ...[
          const SizedBox(height: AppSpacing.md),
          SurfaceCard(
            title: arabic ? 'المؤشرات شهرياً' : 'Monthly performance',
            subtitle: arabic
                ? 'مقارنة المؤشرات المسموح بعرضها خلال الأشهر المعروضة'
                : 'Comparison of the permitted indicators over the months shown',
            icon: Icons.stacked_bar_chart_outlined,
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.lg,
              AppSpacing.md,
            ),
            child: monthlyLoading && monthlyRows.isEmpty
                ? const SizedBox(height: 160, child: LoadingView())
                : MonthlyBarsChart(
                    months: monthlyRows,
                    arabic: arabic,
                    showSales: sections.contains('sales'),
                    showPurchases: sections.contains('purchases'),
                    showResult: sections.contains('profit'),
                  ),
          ),
        ],
        if (sections.contains('top')) ...[
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
        ],
        if (sections.contains('cash') && sections.contains('recent')) ...[
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
        ] else if (sections.contains('cash')) ...[
          const SizedBox(height: AppSpacing.md),
          CashAccountsPanel(
            rows: cashAccounts,
            arabic: arabic,
            emptyText: arabic
                ? 'لم تُسجَّل حسابات نقدية بعد.'
                : 'No cash accounts recorded yet.',
          ),
        ] else if (sections.contains('recent')) ...[
          const SizedBox(height: AppSpacing.md),
          RecentDocumentsPanel(
            rows: recent,
            arabic: arabic,
            emptyText: arabic ? 'لا توجد عمليات بعد.' : 'No activity yet.',
          ),
        ],
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
    this.accent,
  );

  final String label;
  final String value;
  final String caption;
  final IconData icon;
  final AppTone tone;

  /// The section this figure belongs to; its card wears that section's
  /// colour, matching the navigation.
  final SectionAccent accent;
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
/// Flutter applies the same section permissions as an additional fail-closed
/// presentation check. Backend filtering remains the actual data boundary.
Set<String> _dashboardSectionsFor(AppUser? user) {
  if (user == null || (!user.isSuperAdmin && !user.can('dashboard.view'))) {
    return <String>{};
  }
  const permissions = <String, String>{
    'sales': 'dashboard.sales',
    'purchases': 'dashboard.purchases',
    'revenue': 'dashboard.revenue',
    'profit': 'dashboard.profit',
    'cash': 'dashboard.cash',
    'movements': 'dashboard.movements',
    'receivables': 'dashboard.receivables',
    'payables': 'dashboard.payables',
    'stock': 'dashboard.stock',
    'charts': 'dashboard.charts',
    'top': 'dashboard.top',
    'recent': 'dashboard.recent',
  };
  final isCompanyManager = user.roles.any(
    (role) => const {'GENERAL_MANAGER', 'FINANCE_MANAGER'}
        .contains(role.trim().toUpperCase()),
  );
  if (!isCompanyManager) {
    return user.isSuperAdmin || user.can('dashboard.recent')
        ? {'recent'}
        : <String>{};
  }
  if (user.isSuperAdmin) return permissions.keys.toSet();
  final allowed = <String>{
    for (final entry in permissions.entries)
      if (user.can(entry.value) &&
          (entry.key != 'stock' || user.canReadCost) &&
          (entry.key != 'sales' && entry.key != 'top' || user.canReadSalePrice) &&
          (entry.key != 'purchases' && entry.key != 'payables' || user.canReadPurchasePrice) &&
          (entry.key != 'receivables' || user.canReadSalePrice) &&
          (entry.key != 'revenue' && entry.key != 'profit' ||
              (user.canReadSalePrice && user.canReadPurchasePrice)))
        entry.key,
  };
  if (user.can('dashboard.financial')) {
    allowed.addAll(const ['cash', 'movements']);
    if (user.canReadSalePrice && user.canReadPurchasePrice) {
      allowed.addAll(const ['revenue', 'profit']);
    }
  }
  return allowed;
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
