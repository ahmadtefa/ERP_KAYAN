import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';

/// Two rounded bars per month (sales vs purchases) with the ledger result
/// drawn as a line over them. Pure painter - no chart package.
class MonthlyBarsChart extends StatelessWidget {
  const MonthlyBarsChart({
    super.key,
    required this.months,
    required this.arabic,
  });

  /// One entry per month: `{ month: '2026-04', sales, purchases, result }`.
  final List<Json> months;
  final bool arabic;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final salesColor = theme.colorScheme.primary;
    const purchaseColor = Color(0xFFB36A18);
    final resultColor = theme.colorScheme.tertiary;
    final maxValue = months.fold<double>(0, (max, row) {
      final double sales = asNum(row['sales'])?.toDouble() ?? 0.0;
      final double purchases = asNum(row['purchases'])?.toDouble() ?? 0.0;
      return math.max(max, math.max(sales, purchases));
    });

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
            arabic ? 'المبيعات والمشتريات الشهرية' : 'Monthly sales & purchases',
            style: theme.textTheme.titleLarge
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 5),
          Text(
            arabic
                ? 'مقارنة آخر اثني عشر شهراً'
                : 'A twelve-month comparison',
            style: theme.textTheme.bodyMedium
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 18,
            runSpacing: 8,
            children: [
              _Legend(color: salesColor, label: arabic ? 'المبيعات' : 'Sales'),
              _Legend(
                  color: purchaseColor, label: arabic ? 'المشتريات' : 'Purchases'),
              _Legend(
                  color: resultColor,
                  label: arabic ? 'النتيجة' : 'Net result'),
            ],
          ),
          const SizedBox(height: 14),
          SizedBox(
            height: 240,
            width: double.infinity,
            child: months.isEmpty
                ? Center(
                    child: Text(
                      arabic
                          ? 'ستظهر البيانات هنا عند توفر الحركات.'
                          : 'Numbers appear here once documents exist.',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  )
                : CustomPaint(
                    painter: _MonthlyBarsPainter(
                      months: months,
                      maxValue: maxValue <= 0 ? 1 : maxValue,
                      salesColor: salesColor,
                      purchaseColor: purchaseColor,
                      resultColor: resultColor,
                      gridColor: theme.colorScheme.outlineVariant
                          .withValues(alpha: 0.6),
                      labelColor: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _MonthlyBarsPainter extends CustomPainter {
  const _MonthlyBarsPainter({
    required this.months,
    required this.maxValue,
    required this.salesColor,
    required this.purchaseColor,
    required this.resultColor,
    required this.gridColor,
    required this.labelColor,
  });

  final List<Json> months;
  final double maxValue;
  final Color salesColor;
  final Color purchaseColor;
  final Color resultColor;
  final Color gridColor;
  final Color labelColor;

  @override
  void paint(Canvas canvas, Size size) {
    const top = 10.0;
    const bottom = 30.0;
    const left = 6.0;
    const right = 6.0;
    final rect = Rect.fromLTRB(left, top, size.width - right, size.height - bottom);
    final grid = Paint()
      ..color = gridColor
      ..strokeWidth = 1;
    for (var i = 0; i < 4; i += 1) {
      final y = rect.top + rect.height * i / 3;
      canvas.drawLine(Offset(rect.left, y), Offset(rect.right, y), grid);
    }

    final count = months.length;
    if (count == 0) return;
    final slot = rect.width / count;
    final barWidth = math.max(3.0, slot * 0.22);

    for (var i = 0; i < count; i += 1) {
      final row = months[i];
      final centerX = rect.left + slot * i + slot / 2;

      final sales = (asNum(row['sales'])?.toDouble() ?? 0) / maxValue;
      final purchases = (asNum(row['purchases'])?.toDouble() ?? 0) / maxValue;

      final salesRect = Rect.fromCenter(
        center: Offset(centerX - barWidth * 0.7, rect.bottom),
        width: barWidth,
        height: rect.height * sales.clamp(0.0, 1.0),
      );
      final purchaseRect = Rect.fromCenter(
        center: Offset(centerX + barWidth * 0.7, rect.bottom),
        width: barWidth,
        height: rect.height * purchases.clamp(0.0, 1.0),
      );
      canvas.drawRRect(
        RRect.fromRectAndRadius(
            salesRect, const Radius.circular(3)),
        Paint()..color = salesColor.withValues(alpha: 0.9),
      );
      canvas.drawRRect(
        RRect.fromRectAndRadius(
            purchaseRect, const Radius.circular(3)),
        Paint()..color = purchaseColor.withValues(alpha: 0.9),
      );

      // Month label: show one every other month to keep wide dates readable.
      if (i % 2 == 0 || count <= 6) {
        final label = (row['month'] as String?) ?? '';
        final short = label.length >= 7 ? label.substring(5) : label;
        final painter = TextPainter(
          text: TextSpan(
            text: short,
            style: TextStyle(color: labelColor, fontSize: 9),
          ),
          textDirection: TextDirection.ltr,
        )..layout();
        painter.paint(canvas, Offset(centerX - painter.width / 2, rect.bottom + 8));
      }
    }

    // Net result as a smooth line across the months.
    final points = <Offset>[];
    for (var i = 0; i < count; i += 1) {
      final result = (asNum(months[i]['result'])?.toDouble() ?? 0) / maxValue;
      points.add(Offset(
        rect.left + slot * i + slot / 2,
        rect.bottom - result.clamp(-1.0, 1.0) * rect.height,
      ));
    }
    final path = Path()..moveTo(points.first.dx, points.first.dy);
    for (var i = 1; i < points.length; i += 1) {
      final previous = points[i - 1];
      final current = points[i];
      final mid = (previous.dx + current.dx) / 2;
      path.cubicTo(mid, previous.dy, mid, current.dy, current.dx, current.dy);
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = resultColor
        ..strokeWidth = 2.2
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(covariant _MonthlyBarsPainter old) =>
      old.months != months ||
      old.maxValue != maxValue ||
      old.salesColor != salesColor ||
      old.purchaseColor != purchaseColor;
}

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

/// Ranked list - top customers or top products.
class TopListPanel extends StatelessWidget {
  const TopListPanel({
    super.key,
    required this.title,
    required this.rows,
    required this.arabic,
    required this.emptyText,
    this.quantitySuffix,
  });

  final String title;
  final List<Json> rows;
  final bool arabic;
  final String emptyText;
  final String? quantitySuffix;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: theme.colorScheme.outlineVariant.withValues(alpha: 0.7),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: theme.textTheme.titleMedium
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 12),
          if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                emptyText,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            )
          else
            for (var index = 0; index < rows.length; index += 1)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 13,
                      backgroundColor:
                          theme.colorScheme.primary.withValues(alpha: 0.12),
                      child: Text(
                        '${index + 1}',
                        style: theme.textTheme.labelSmall?.copyWith(
                          color: theme.colorScheme.primary,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _localName(rows[index], arabic),
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodyMedium
                            ?.copyWith(fontWeight: FontWeight.w600),
                      ),
                    ),
                    if (quantitySuffix != null)
                      Text(
                        '${formatQuantity(asString(rows[index]['quantity']))} $quantitySuffix',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    const SizedBox(width: 10),
                    Text(
                      formatAmount(asString(rows[index]['total'])),
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                        color: theme.colorScheme.primary,
                      ),
                    ),
                  ],
                ),
              ),
        ],
      ),
    );
  }
}

/// The last documents raised anywhere in the system.
class RecentDocumentsPanel extends StatelessWidget {
  const RecentDocumentsPanel({
    super.key,
    required this.rows,
    required this.arabic,
    required this.emptyText,
  });

  final List<Json> rows;
  final bool arabic;
  final String emptyText;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: theme.colorScheme.outlineVariant.withValues(alpha: 0.7),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            arabic ? 'آخر العمليات' : 'Recent activity',
            style: theme.textTheme.titleMedium
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                emptyText,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            )
          else
            for (final row in rows)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 7),
                child: Row(
                  children: [
                    Icon(
                      _kindIcon(text(row, 'kind')),
                      size: 19,
                      color: theme.colorScheme.primary,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            text(row, 'number'),
                            style: theme.textTheme.bodyMedium
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          Text(
                            _localName(row, arabic),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Text(
                      text(row, 'date'),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Text(
                      formatAmount(asString(row['amount'])),
                      style: theme.textTheme.bodyMedium
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                  ],
                ),
              ),
        ],
      ),
    );
  }
}

/// Every cash box and bank account with what is in it.
class CashAccountsPanel extends StatelessWidget {
  const CashAccountsPanel({
    super.key,
    required this.rows,
    required this.arabic,
    required this.emptyText,
  });

  final List<Json> rows;
  final bool arabic;
  final String emptyText;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: theme.colorScheme.outlineVariant.withValues(alpha: 0.7),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            arabic ? 'أرصدة النقدية والبنوك' : 'Cash & bank balances',
            style: theme.textTheme.titleMedium
                ?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                emptyText,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            )
          else
            for (final row in rows)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: [
                    Icon(
                      text(row, 'kind') == 'BANK'
                          ? Icons.account_balance_outlined
                          : Icons.payments_outlined,
                      size: 19,
                      color: theme.colorScheme.primary,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _localName(row, arabic),
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodyMedium,
                      ),
                    ),
                    Text(
                      formatAmount(asString(row['balance'])),
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
        ],
      ),
    );
  }
}

/// A shortcut tile, with a badge when work is waiting.
class QuickActionTile extends StatelessWidget {
  const QuickActionTile({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.badge,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final String? badge;

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
              Badge(
                isLabelVisible: badge != null && badge != '0',
                label: Text(badge ?? ''),
                child: Icon(icon, color: theme.colorScheme.primary, size: 26),
              ),
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

String _localName(Json row, bool arabic) {
  final ar = asString(row['nameAr']) ?? '';
  final en = asString(row['nameEn']) ?? '';
  final partyAr = asString(row['partyNameAr']) ?? '';
  final partyEn = asString(row['partyNameEn']) ?? '';
  final nameAr = ar.isNotEmpty ? ar : partyAr;
  final nameEn = en.isNotEmpty ? en : partyEn;
  return arabic
      ? (nameAr.isNotEmpty ? nameAr : nameEn)
      : (nameEn.isNotEmpty ? nameEn : nameAr);
}

IconData _kindIcon(String kind) => switch (kind) {
      'SALES_INVOICE' => Icons.receipt_long_outlined,
      'PURCHASE_INVOICE' => Icons.shopping_bag_outlined,
      'CASH_RECEIPT' => Icons.south_west_rounded,
      'CASH_PAYMENT' => Icons.north_east_rounded,
      _ => Icons.description_outlined,
    };
