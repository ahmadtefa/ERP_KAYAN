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
  Widget build(BuildContext context) {
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
    final quick =
        Map<String, dynamic>.from(summary['quickActions'] as Map? ?? {});
    final hasData = flag(summary, 'hasData', fallback: true);
    final money = (Object? value) => formatAmount(asString(value), decimals: 0);

    final metrics = <_Metric>[
      _Metric(
        arabic ? 'إجمالي المبيعات' : 'Total sales',
        money(sales['total']),
        arabic
            ? '${sales['invoices'] ?? 0} فاتورة'
            : '${sales['invoices'] ?? 0} invoices',
        Icons.trending_up_rounded,
        const Color(0xFF087F8C),
      ),
      _Metric(
        arabic ? 'إجمالي المشتريات' : 'Total purchases',
        money(purchases['total']),
        arabic
            ? '${purchases['invoices'] ?? 0} فاتورة'
            : '${purchases['invoices'] ?? 0} invoices',
        Icons.shopping_bag_outlined,
        const Color(0xFF7657C8),
      ),
      _Metric(
        arabic ? 'المقبوضات' : 'Receipts',
        money(receipts['total']),
        arabic
            ? '${receipts['vouchers'] ?? 0} سند'
            : '${receipts['vouchers'] ?? 0} vouchers',
        Icons.south_west_rounded,
        const Color(0xFF1B8A5A),
      ),
      _Metric(
        arabic ? 'المدفوعات' : 'Payments',
        money(payments['total']),
        arabic
            ? '${payments['vouchers'] ?? 0} سند'
            : '${payments['vouchers'] ?? 0} vouchers',
        Icons.north_east_rounded,
        const Color(0xFFC2474B),
      ),
      _Metric(
        arabic ? 'صافي النتيجة' : 'Net result',
        money(summary['grossResult']),
        arabic ? 'إيرادات ناقص مصروفات' : 'Revenue less expenses',
        Icons.insights_rounded,
        const Color(0xFF2878C8),
      ),
      _Metric(
        arabic ? 'المصروفات' : 'Expenses',
        money(summary['expenses']),
        arabic ? 'من دليل الحسابات' : 'From the ledger',
        Icons.receipt_long_outlined,
        const Color(0xFFB36A18),
      ),
      _Metric(
        arabic ? 'النقدية' : 'Cash position',
        money(summary['cashPosition']),
        arabic ? 'الصناديق والبنوك' : 'Cash boxes and banks',
        Icons.account_balance_wallet_outlined,
        const Color(0xFF0F766E),
      ),
      _Metric(
        arabic ? 'الذمم المدينة' : 'Receivables',
        money(summary['receivables']),
        arabic ? 'مستحق من العملاء' : 'Owed by customers',
        Icons.groups_2_outlined,
        const Color(0xFF2878C8),
      ),
      _Metric(
        arabic ? 'الذمم الدائنة' : 'Payables',
        money(summary['payables']),
        arabic ? 'مستحق للموردين' : 'Owed to suppliers',
        Icons.local_shipping_outlined,
        const Color(0xFF7657C8),
      ),
      _Metric(
        arabic ? 'الفواتير المتأخرة' : 'Overdue invoices',
        money(overdue['total']),
        arabic
            ? '${overdue['invoices'] ?? 0} فاتورة'
            : '${overdue['invoices'] ?? 0} invoices',
        Icons.warning_amber_rounded,
        const Color(0xFFC2474B),
      ),
      _Metric(
        arabic ? 'العملاء' : 'Customers',
        '${customers['count'] ?? 0}',
        arabic
            ? '${customers['active'] ?? 0} نشط'
            : '${customers['active'] ?? 0} active',
        Icons.people_outline,
        const Color(0xFF2878C8),
      ),
      _Metric(
        arabic ? 'الموردون' : 'Suppliers',
        '${suppliers['count'] ?? 0}',
        arabic
            ? '${suppliers['active'] ?? 0} نشط'
            : '${suppliers['active'] ?? 0} active',
        Icons.local_shipping_outlined,
        const Color(0xFFB36A18),
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
            margin: const EdgeInsets.only(bottom: 18),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFF2878C8).withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: const Color(0xFF2878C8).withValues(alpha: 0.25),
              ),
            ),
            child: Row(
              children: [
                const Icon(Icons.info_outline, color: Color(0xFF2878C8)),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    arabic
                        ? 'لا توجد مستندات في هذه الفترة بعد. ابدأ بتسجيل أول فاتورة أو سند.'
                        : 'There are no documents in this period yet. Raise your first invoice or voucher.',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ),
              ],
            ),
          ),
        Text(
          arabic ? 'مؤشرات الأعمال' : 'Business overview',
          style: Theme.of(context)
              .textTheme
              .titleLarge
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 12),
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = wide ? 4 : 2;
            const gap = 12.0;
            final cardWidth =
                (constraints.maxWidth - gap * (columns - 1)) / columns;
            return Wrap(
              spacing: gap,
              runSpacing: gap,
              children: [
                for (final metric in metrics)
                  SizedBox(
                    width: cardWidth,
                    child: _MetricCard(metric: metric),
                  ),
              ],
            );
          },
        ),
        const SizedBox(height: 18),
        _ComparisonStrip(summary: summary, previous: previous, arabic: arabic),
        const SizedBox(height: 22),
        if (monthlyLoading && monthlyRows.isEmpty)
          const Center(
            child: Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: CircularProgressIndicator(),
            ),
          )
        else
          MonthlyBarsChart(months: monthlyRows, arabic: arabic),
        const SizedBox(height: 22),
        Text(
          arabic ? 'أعلى العملاء والمنتجات' : 'Top customers & products',
          style: Theme.of(context)
              .textTheme
              .titleLarge
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: TopListPanel(
                title: arabic ? 'أهم العملاء' : 'Top customers',
                rows: topCustomers,
                arabic: arabic,
                emptyText: arabic
                    ? 'ستظهر الأسماء هنا عند توفر مبيعات.'
                    : 'Names appear here once sales exist.',
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TopListPanel(
                title: arabic
                    ? 'أكثر المنتجات مبيعاً'
                    : 'Best-selling products',
                rows: topItems,
                arabic: arabic,
                quantitySuffix: arabic ? 'وحدة' : 'units',
                emptyText: arabic
                    ? 'ستظهر الأصناف هنا عند توفر مبيعات.'
                    : 'Items appear here once sales exist.',
              ),
            ),
          ],
        ),
        const SizedBox(height: 22),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: CashAccountsPanel(
                rows: cashAccounts,
                arabic: arabic,
                emptyText: arabic
                    ? 'لم تُسجَّل حسابات نقدية بعد.'
                    : 'No cash accounts recorded yet.',
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: RecentDocumentsPanel(
                rows: recent,
                arabic: arabic,
                emptyText: arabic
                    ? 'لا توجد عمليات بعد.'
                    : 'No activity yet.',
              ),
            ),
          ],
        ),
        const SizedBox(height: 24),
        Text(
          arabic ? 'إجراءات سريعة' : 'Quick actions',
          style: Theme.of(context)
              .textTheme
              .titleLarge
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 12),
        _QuickActions(
          quick: quick,
          arabic: arabic,
          wide: wide,
          medium: medium,
          l10n: l10n,
        ),
      ],
    );
  }
}

/// This period against the previous one, in one honest sentence each.
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
  Widget build(BuildContext context) => const SizedBox.shrink();
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
  Widget build(BuildContext context) => const SizedBox.shrink();
class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.arabic, required this.onRetry});

  final bool arabic;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
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
  Widget build(BuildContext context) => const SizedBox.shrink();
List<({IconData icon, String label, String path})> _modules(
  AppLocalizations l10n,
) => [
      (icon: Icons.settings_outlined, label: l10n.settings, path: AppRoutes.settings),
];
