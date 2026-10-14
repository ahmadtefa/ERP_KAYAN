import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/router/app_router.dart';
import '../../../../l10n/generated/app_localizations.dart';
import '../../../../shared/extensions/l10n_extension.dart';
import '../../../accounting/presentation/providers/chart_of_accounts_providers.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/providers/resource_providers.dart';
import '../../../invoicing/presentation/providers/invoice_providers.dart';
import '../../../settings/presentation/providers/company_providers.dart';

/// Responsive executive dashboard with live, tenant-scoped API data.
class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final arabic = Localizations.localeOf(context).languageCode == 'ar';
    final user = ref.watch(currentUserProvider);
    final accounts = ref.watch(chartOfAccountsProvider);
    final companyAsync = ref.watch(companyProfileProvider);
    final branchesAsync = ref.watch(branchesProvider);
    final salesAsync = ref.watch(salesInvoicesProvider);
    final purchasesAsync = ref.watch(purchaseInvoicesProvider);
    final customersAsync = ref.watch(customersProvider);
    final suppliersAsync = ref.watch(suppliersProvider);
    final itemsAsync = ref.watch(itemsProvider);
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

    final sales = salesAsync.asData?.value ?? const <dynamic>[];
    final purchases = purchasesAsync.asData?.value ?? const <dynamic>[];
    final salesTotal = sales.fold<double>(0, (sum, row) => sum + _amount(row));
    final purchaseTotal =
        purchases.fold<double>(0, (sum, row) => sum + _amount(row));
    final salesByMonth = _monthTotals(sales);
    final purchasesByMonth = _monthTotals(purchases);
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
                ref.invalidate(salesInvoicesProvider);
                ref.invalidate(purchaseInvoicesProvider);
                ref.invalidate(customersProvider);
                ref.invalidate(suppliersProvider);
                ref.invalidate(itemsProvider);
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
        Row(
          children: [
            Expanded(
              child: Text(
                arabic ? 'مؤشرات الأعمال' : 'Business overview',
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.w800),
              ),
            ),
            if (salesAsync.isLoading || purchasesAsync.isLoading)
              const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
          ],
        ),
        const SizedBox(height: 12),
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = wide ? 4 : 2;
            final gap = 12.0;
            final cardWidth =
                (constraints.maxWidth - gap * (columns - 1)) / columns;
            final metrics = <_Metric>[
              _Metric(
                arabic ? 'فواتير المبيعات' : 'Sales invoices',
                salesAsync.when(
                  data: (rows) => rows.length.toString(),
                  loading: () => '—',
                  error: (_, __) => '—',
                ),
                _money(salesTotal, arabic),
                Icons.trending_up_rounded,
                const Color(0xFF087F8C),
              ),
              _Metric(
                arabic ? 'فواتير المشتريات' : 'Purchase invoices',
                purchasesAsync.when(
                  data: (rows) => rows.length.toString(),
                  loading: () => '—',
                  error: (_, __) => '—',
                ),
                _money(purchaseTotal, arabic),
                Icons.shopping_bag_outlined,
                const Color(0xFF7657C8),
              ),
              _Metric(
                arabic ? 'العملاء' : 'Customers',
                customersAsync.when(
                  data: (rows) => rows.length.toString(),
                  loading: () => '—',
                  error: (_, __) => '—',
                ),
                arabic ? 'إجمالي المسجلين' : 'Registered records',
                Icons.groups_2_outlined,
                const Color(0xFF2878C8),
              ),
              _Metric(
                arabic ? 'أصناف المخزون' : 'Inventory items',
                itemsAsync.when(
                  data: (rows) => rows.length.toString(),
                  loading: () => '—',
                  error: (_, __) => '—',
                ),
                arabic ? 'الأصناف المسجلة' : 'Catalog records',
                Icons.inventory_2_outlined,
                const Color(0xFFB36A18),
              ),
            ];
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
        const SizedBox(height: 22),
        _ActivityChart(
          sales: salesByMonth,
          purchases: purchasesByMonth,
          arabic: arabic,
        ),
        const SizedBox(height: 24),
        Text(
          arabic ? 'الوصول السريع' : 'Quick access',
          style: Theme.of(context)
              .textTheme
              .titleLarge
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 12),
        GridView.count(
          crossAxisCount: wide ? 5 : medium ? 3 : 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: wide ? 1.8 : 1.5,
          children: [
            for (final module in _modules(l10n))
              _ModuleTile(
                icon: module.icon,
                label: module.label,
                onTap: () => context.go(module.path),
              ),
          ],
        ),
        const SizedBox(height: 18),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            _MiniStat(
              title: arabic ? 'دليل الحسابات' : 'Chart of accounts',
              value: accounts.when(
                data: (rows) => rows.length.toString(),
                loading: () => '—',
                error: (_, __) => '—',
              ),
              icon: Icons.account_tree_outlined,
            ),
            _MiniStat(
              title: arabic ? 'الموردون' : 'Suppliers',
              value: suppliersAsync.when(
                data: (rows) => rows.length.toString(),
                loading: () => '—',
                error: (_, __) => '—',
              ),
              icon: Icons.local_shipping_outlined,
            ),
          ],
        ),
      ],
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

double _amount(dynamic value) {
  if (value is! Map) return 0;
  final row = Map<String, dynamic>.from(value);
  for (final key in const [
    'grandTotal',
    'totalAmount',
    'total',
    'netTotal',
    'totalDebit',
  ]) {
    final raw = row[key];
    if (raw is num) return raw.toDouble();
    if (raw is String) {
      final parsed = double.tryParse(raw.replaceAll(',', ''));
      if (parsed != null) return parsed;
    }
  }
  return 0;
}

DateTime? _documentDate(dynamic value) {
  if (value is! Map) return null;
  final row = Map<String, dynamic>.from(value);
  for (final key in const ['invoiceDate', 'documentDate', 'date', 'createdAt']) {
    final raw = row[key];
    if (raw is DateTime) return raw;
    if (raw is String) {
      final parsed = DateTime.tryParse(raw);
      if (parsed != null) return parsed;
    }
  }
  return null;
}

List<double> _monthTotals(List<dynamic> rows) {
  final now = DateTime.now();
  final first = DateTime(now.year, now.month - 5);
  final values = List<double>.filled(6, 0);
  for (final row in rows) {
    final date = _documentDate(row);
    if (date == null) continue;
    final index = (date.year - first.year) * 12 + date.month - first.month;
    if (index >= 0 && index < values.length) values[index] += _amount(row);
  }
  return values;
}

String _money(double amount, bool arabic) {
  final value = amount.abs() >= 1000000
      ? (amount / 1000000).toStringAsFixed(1) + 'M'
      : amount.abs() >= 1000
          ? (amount / 1000).toStringAsFixed(1) + 'K'
          : amount.toStringAsFixed(0);
  return value + (arabic ? ' ج.م' : ' EGP');
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
          errorBuilder: (_, __, ___) =>
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

class _ActivityChart extends StatelessWidget {
  const _ActivityChart({
    required this.sales,
    required this.purchases,
    required this.arabic,
  });
  final List<double> sales;
  final List<double> purchases;
  final bool arabic;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final salesColor = theme.colorScheme.primary;
    const purchaseColor = Color(0xFFB36A18);
    final now = DateTime.now();
    final labels = List.generate(6, (index) {
      final date = DateTime(now.year, now.month - 5 + index);
      return arabic
          ? date.month.toString() + '/' + date.year.toString().substring(2)
          : _monthName(date.month);
    });
    final maxValue = <double>[...sales, ...purchases]
        .fold<double>(0, (max, value) => math.max(max, value).toDouble());
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 18),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(
          color: theme.colorScheme.outlineVariant.withValues(alpha: 0.7),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            arabic ? 'حركة المبيعات والمشتريات' : 'Sales & purchase activity',
            style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 5),
          Text(
            arabic
                ? 'قيمة الفواتير خلال آخر ستة أشهر'
                : 'Invoice totals over the last six months',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 18,
            runSpacing: 8,
            children: [
              _Legend(color: salesColor, label: arabic ? 'المبيعات' : 'Sales'),
              _Legend(color: purchaseColor, label: arabic ? 'المشتريات' : 'Purchases'),
            ],
          ),
          const SizedBox(height: 14),
          SizedBox(
            height: 225,
            width: double.infinity,
            child: CustomPaint(
              painter: _LineChartPainter(
                sales: sales,
                purchases: purchases,
                labels: labels,
                maxValue: maxValue <= 0 ? 1 : maxValue,
                salesColor: salesColor,
                purchaseColor: purchaseColor,
                gridColor: theme.colorScheme.outlineVariant.withValues(alpha: 0.6),
                labelColor: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          if (sales.every((value) => value == 0) &&
              purchases.every((value) => value == 0))
            Text(
              arabic
                  ? 'ستظهر البيانات هنا عند توفر فواتير مؤرخة.'
                  : 'Chart data appears here when dated invoices are available.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
        ],
      ),
    );
  }
}

String _monthName(int month) => const [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ][month - 1];

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 9,
            height: 9,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 7),
          Text(label, style: Theme.of(context).textTheme.bodySmall),
        ],
      );
}

class _LineChartPainter extends CustomPainter {
  const _LineChartPainter({
    required this.sales,
    required this.purchases,
    required this.labels,
    required this.maxValue,
    required this.salesColor,
    required this.purchaseColor,
    required this.gridColor,
    required this.labelColor,
  });

  final List<double> sales;
  final List<double> purchases;
  final List<String> labels;
  final double maxValue;
  final Color salesColor;
  final Color purchaseColor;
  final Color gridColor;
  final Color labelColor;

  @override
  void paint(Canvas canvas, Size size) {
    const left = 8.0;
    const right = 8.0;
    const top = 12.0;
    const bottom = 28.0;
    final rect = Rect.fromLTRB(
      left,
      top,
      size.width - right,
      size.height - bottom,
    );
    final grid = Paint()..color = gridColor..strokeWidth = 1;
    for (var i = 0; i < 4; i++) {
      final y = rect.top + rect.height * i / 3;
      canvas.drawLine(Offset(rect.left, y), Offset(rect.right, y), grid);
    }
    for (var i = 0; i < labels.length; i++) {
      final x = rect.left + rect.width * i / (labels.length - 1);
      final painter = TextPainter(
        text: TextSpan(
          text: labels[i],
          style: TextStyle(color: labelColor, fontSize: 10),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      painter.paint(canvas, Offset(x - painter.width / 2, rect.bottom + 9));
    }
    _drawSeries(canvas, rect, sales, salesColor);
    _drawSeries(canvas, rect, purchases, purchaseColor);
  }

  void _drawSeries(Canvas canvas, Rect rect, List<double> values, Color color) {
    if (values.length < 2) return;
    final points = <Offset>[];
    for (var i = 0; i < values.length; i++) {
      final x = rect.left + rect.width * i / (values.length - 1);
      final ratio = (values[i] / maxValue).clamp(0.0, 1.0);
      points.add(Offset(x, rect.bottom - ratio * rect.height));
    }
    final path = Path()..moveTo(points.first.dx, points.first.dy);
    for (var i = 1; i < points.length; i++) {
      final previous = points[i - 1];
      final current = points[i];
      final mid = (previous.dx + current.dx) / 2;
      path.cubicTo(mid, previous.dy, mid, current.dy, current.dx, current.dy);
    }
    final fill = Path.from(path)
      ..lineTo(points.last.dx, rect.bottom)
      ..lineTo(points.first.dx, rect.bottom)
      ..close();
    canvas.drawPath(
      fill,
      Paint()
        ..shader = LinearGradient(
          colors: [color.withValues(alpha: 0.19), color.withValues(alpha: 0.005)],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ).createShader(rect),
    );
    canvas.drawPath(
      path,
      Paint()
        ..color = color
        ..strokeWidth = 2.8
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
    for (final point in points) {
      canvas.drawCircle(point, 5.5, Paint()..color = color.withValues(alpha: 0.15));
      canvas.drawCircle(point, 3, Paint()..color = color);
    }
  }

  @override
  bool shouldRepaint(covariant _LineChartPainter old) =>
      old.sales != sales ||
      old.purchases != purchases ||
      old.maxValue != maxValue ||
      old.salesColor != salesColor ||
      old.purchaseColor != purchaseColor;
}

class _MiniStat extends StatelessWidget {
  const _MiniStat({
    required this.title,
    required this.value,
    required this.icon,
  });
  final String title;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      width: 250,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: theme.colorScheme.outlineVariant.withValues(alpha: 0.7),
        ),
      ),
      child: Row(
        children: [
          Icon(icon, color: theme.colorScheme.primary),
          const SizedBox(width: 10),
          Expanded(child: Text(title, style: theme.textTheme.bodyMedium)),
          Text(
            value,
            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
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
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.surface,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: theme.colorScheme.outlineVariant.withValues(alpha: 0.7),
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: theme.colorScheme.primary, size: 26),
              const SizedBox(height: 9),
              Text(
                label,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
