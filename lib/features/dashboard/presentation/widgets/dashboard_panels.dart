import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/widgets/surface_card.dart';

/// Two bars per month (sales vs purchases) with the ledger result drawn as a
/// line over them. Pure painter - no chart package.
///
/// The chart renders the plot only: the surrounding title, subtitle and card
/// come from the screen so the panel never duplicates its own header.
class MonthlyBarsChart extends StatelessWidget {
  const MonthlyBarsChart({
    super.key,
    required this.months,
    required this.arabic,
    this.showSales = true,
    this.showPurchases = true,
    this.showResult = true,
  });

  /// One entry per month: `{ month: '2026-04', sales, purchases, result }`.
  final List<Json> months;
  final bool arabic;
  final bool showSales;
  final bool showPurchases;
  final bool showResult;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    // The series carry their sections' colours — green sales, orange
    // purchases — the same hues as the navigation and the KPI row above.
    final salesColor = SectionAccents.sales.of(theme.brightness);
    final purchaseColor = SectionAccents.purchases.of(theme.brightness);
    final resultColor = scheme.tertiary;
    final maxValue = months.fold<double>(0, (max, row) {
      final double sales = showSales ? asNum(row['sales'])?.toDouble() ?? 0.0 : 0.0;
      final double purchases = showPurchases ? asNum(row['purchases'])?.toDouble() ?? 0.0 : 0.0;
      final double result = showResult ? (asNum(row['result'])?.toDouble() ?? 0.0).abs() : 0.0;
      return math.max(max, math.max(result, math.max(sales, purchases)));
    });

    final minValue = months.fold<double>(0, (value,row) => showResult ? math.min(value,asNum(row['result'])?.toDouble() ?? 0) : value);
    final minPlotWidth = math.max(320.0, months.length * 66.0 + 90);
    final labelStyle = theme.textTheme.bodySmall!.copyWith(color:scheme.onSurface,fontSize:12,fontWeight:FontWeight.w600);
    String tooltip(Json row) => [row['month']?.toString() ?? '',
      if(showSales) '${arabic ? 'المبيعات' : 'Sales'}: ${row['sales'] ?? 0}',
      if(showPurchases) '${arabic ? 'المشتريات' : 'Purchases'}: ${row['purchases'] ?? 0}',
      if(showResult) '${arabic ? 'صافي النتيجة' : 'Net result'}: ${row['result'] ?? 0}',
    ].join('\n');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Wrap(
          spacing: AppSpacing.xl,
          runSpacing: AppSpacing.sm,
          children: [
            if (showSales)
              _Legend(
                color: salesColor,
                label: arabic ? 'المبيعات' : 'Sales',
              ),
            if (showPurchases)
              _Legend(
                color: purchaseColor,
                label: arabic ? 'المشتريات' : 'Purchases',
              ),
            if (showResult)
              _Legend(
                color: resultColor,
                label: arabic ? 'صافي النتيجة' : 'Net result',
              ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        SizedBox(
          height: 236,
          width: double.infinity,
          child: months.isEmpty
              ? Center(
                  child: Text(
                    arabic
                        ? 'ستظهر البيانات هنا عند توفر الحركات.'
                        : 'Numbers appear here once documents exist.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                )
              : LayoutBuilder(builder:(context,constraints) {
                  final width=math.max(constraints.maxWidth,minPlotWidth);
                  return SingleChildScrollView(scrollDirection:Axis.horizontal,child:SizedBox(width:width,height:236,
                    child:Stack(children:[Positioned.fill(child:CustomPaint(
                      painter:_MonthlyBarsPainter(months:months,maxValue:maxValue<=0?1:maxValue,minValue:minValue,
                        salesColor:salesColor,purchaseColor:purchaseColor,resultColor:resultColor,
                        showSales:showSales,showPurchases:showPurchases,showResult:showResult,
                        gridColor:scheme.outlineVariant,labelColor:scheme.onSurface,labelStyle:labelStyle),
                    )),Positioned(left:76,right:10,top:10,bottom:34,child:Row(children:[
                      for(final row in months) Expanded(child:Tooltip(message:tooltip(row),
                        triggerMode:TooltipTriggerMode.tap,waitDuration:const Duration(milliseconds:150),
                        textStyle:labelStyle.copyWith(color:scheme.onSurface),
                        decoration:BoxDecoration(color:scheme.surfaceContainerHighest,borderRadius:BorderRadius.circular(8),border:Border.all(color:scheme.outline)),
                        child:Semantics(label:tooltip(row),child:const SizedBox.expand()),
                      )),
                    ]))]),
                  ));
                }),
        ),
      ],
    );
  }
}

class _MonthlyBarsPainter extends CustomPainter {
  const _MonthlyBarsPainter({
    required this.months,
    required this.maxValue,
    required this.minValue,
    required this.labelStyle,
    required this.salesColor,
    required this.purchaseColor,
    required this.resultColor,
    required this.showSales,
    required this.showPurchases,
    required this.showResult,
    required this.gridColor,
    required this.labelColor,
  });

  final List<Json> months;
  final double maxValue;
  final double minValue;
  final TextStyle labelStyle;
  final Color salesColor;
  final Color purchaseColor;
  final Color resultColor;
  final bool showSales;
  final bool showPurchases;
  final bool showResult;
  final Color gridColor;
  final Color labelColor;

  @override
  void paint(Canvas canvas, Size size) {
    const top = 10.0;
    const bottom = 34.0;
    const left = 76.0;
    const right = 10.0;
    final rect = Rect.fromLTRB(
      left,
      top,
      size.width - right,
      size.height - bottom,
    );
    final range=maxValue-minValue;
    double yOf(double value) => rect.bottom-(value-minValue)/range*rect.height;
    final zeroY=yOf(0);
    final grid = Paint()..color=gridColor..strokeWidth=1;
    for(var i=0;i<=4;i++) {
      final value=maxValue-range*i/4;final y=yOf(value);
      canvas.drawLine(Offset(rect.left,y),Offset(rect.right,y),grid);
      final unit=value.abs()>=1000000 ? '${(value/1000000).toStringAsFixed(1)}M' : value.abs()>=1000 ? '${(value/1000).toStringAsFixed(1)}K' : value.toStringAsFixed(0);
      final text=TextPainter(text:TextSpan(text:unit,style:labelStyle),textDirection:TextDirection.ltr)..layout(maxWidth:68);
      text.paint(canvas,Offset(rect.left-text.width-8,(y-text.height/2).clamp(0,size.height-text.height)));
    }
    canvas.drawLine(Offset(rect.left,zeroY),Offset(rect.right,zeroY),Paint()..color=labelColor.withValues(alpha:0.65)..strokeWidth=1.3);

    final count = months.length;
    if (count == 0) return;
    final slot = rect.width / count;
    final barWidth = math.max(3.0, slot * 0.22);

    for (var i = 0; i < count; i += 1) {
      final row = months[i];
      final centerX = rect.left + slot * i + slot / 2;

      final sales=showSales ? asNum(row['sales'])?.toDouble() ?? 0 : 0.0;
      final purchases=showPurchases ? asNum(row['purchases'])?.toDouble() ?? 0 : 0.0;
      final salesRect=Rect.fromLTRB(centerX-barWidth*1.2,yOf(sales),centerX-barWidth*0.2,zeroY);
      final purchaseRect=Rect.fromLTRB(centerX+barWidth*0.2,yOf(purchases),centerX+barWidth*1.2,zeroY);
      canvas.drawRRect(
        RRect.fromRectAndRadius(salesRect, const Radius.circular(3)),
        Paint()..color = salesColor.withValues(alpha: 0.9),
      );
      canvas.drawRRect(
        RRect.fromRectAndRadius(purchaseRect, const Radius.circular(3)),
        Paint()..color = purchaseColor.withValues(alpha: 0.9),
      );

      // Month label: show one every other month to keep wide dates readable.
      if (true) {
        final label = (row['month'] as String?) ?? '';
        final short = label;
        final painter = TextPainter(
          text: TextSpan(
            text: short,
            style: labelStyle,
          ),
          textDirection: TextDirection.ltr,
        )..layout();
        painter.paint(
          canvas,
          Offset(centerX - painter.width / 2, rect.bottom + 8),
        );
      }
    }

    // Net result is an independent section and must not be drawn unless the
    // server explicitly authorized it for the monthly response.
    if (showResult) {
      final points = <Offset>[];
      for (var i = 0; i < count; i += 1) {
        final result = asNum(months[i]['result'])?.toDouble() ?? 0;
        points.add(
          Offset(
            rect.left + slot * i + slot / 2,
            yOf(result),
          ),
        );
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
  }

  @override
  bool shouldRepaint(covariant _MonthlyBarsPainter old) =>
      old.months != months ||
      old.maxValue != maxValue ||
      old.minValue != minValue ||
      old.resultColor != resultColor ||
      old.labelStyle != labelStyle ||
      old.salesColor != salesColor ||
      old.purchaseColor != purchaseColor ||
      old.showSales != showSales ||
      old.showPurchases != showPurchases ||
      old.showResult != showResult ||
      old.gridColor != gridColor ||
      old.labelColor != labelColor;
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
        width: 10,
        height: 10,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(AppRadii.xs),
        ),
      ),
      const SizedBox(width: AppSpacing.sm),
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
    return SurfaceCard(
      title: title,
      icon: Icons.leaderboard_outlined,
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.md,
      ),
      child: rows.isEmpty
          ? _PanelEmpty(text: emptyText)
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var index = 0; index < rows.length; index += 1)
                  _RankRow(
                    rank: index + 1,
                    name: _localName(rows[index], arabic),
                    quantity: quantitySuffix == null
                        ? null
                        : '${formatQuantity(asString(rows[index]['quantity']))} '
                              '$quantitySuffix',
                    amount: formatAmount(asString(rows[index]['total'])),
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
    final scheme = theme.colorScheme;
    return SurfaceCard(
      title: arabic ? 'آخر العمليات' : 'Recent activity',
      icon: Icons.history_rounded,
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.md,
      ),
      child: rows.isEmpty
          ? _PanelEmpty(text: emptyText)
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final row in rows)
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      vertical: AppSpacing.xs + 2,
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 28,
                          height: 28,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: scheme.primary.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(AppRadii.sm),
                          ),
                          child: Icon(
                            _kindIcon(text(row, 'kind')),
                            size: 16,
                            color: scheme.primary,
                          ),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                text(row, 'number'),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: theme.textTheme.bodyMedium?.copyWith(
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              Text(
                                _localName(row, arabic),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: scheme.onSurfaceVariant,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Text(
                          text(row, 'date'),
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Text(
                          formatAmount(asString(row['amount'])),
                          style: theme.textTheme.bodyMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                            fontFeatures: const [FontFeature.tabularFigures()],
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
    final scheme = theme.colorScheme;
    return SurfaceCard(
      title: arabic ? 'أرصدة النقدية والبنوك' : 'Cash & bank balances',
      icon: Icons.account_balance_wallet_outlined,
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.md,
      ),
      child: rows.isEmpty
          ? _PanelEmpty(text: emptyText)
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final row in rows)
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      vertical: AppSpacing.sm,
                    ),
                    child: Row(
                      children: [
                        Icon(
                          text(row, 'kind') == 'BANK'
                              ? Icons.account_balance_outlined
                              : Icons.payments_outlined,
                          size: 18,
                          color: scheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: AppSpacing.md),
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
                            fontWeight: FontWeight.w700,
                            fontFeatures: const [FontFeature.tabularFigures()],
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
    this.accent,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final String? badge;

  /// The destination section's colour; the tile's icon wears it, matching
  /// the navigation entry it jumps to.
  final SectionAccent? accent;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Material(
      color: scheme.surface,
      borderRadius: AppRadii.control,
      child: InkWell(
        borderRadius: AppRadii.control,
        onTap: onTap,
        child: Ink(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.sm,
            vertical: 10,
          ),
          decoration: BoxDecoration(
            borderRadius: AppRadii.control,
            border: Border.all(color: scheme.outlineVariant.withValues(alpha: 0.8)),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Badge(
                isLabelVisible: badge != null && badge != '0',
                label: Text(badge ?? ''),
                backgroundColor: AppColors.warning,
                child: Container(
                  width: 34,
                  height: 34,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: accent?.softOf(scheme.brightness) ??
                        scheme.primaryContainer,
                    borderRadius: BorderRadius.circular(AppRadii.md),
                  ),
                  child: Icon(
                    icon,
                    color: accent?.of(scheme.brightness) ?? scheme.primary,
                    size: 20,
                  ),
                ),
              ),
              const SizedBox(height: 6),
              Text(
                label,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall?.copyWith(
                  fontWeight: FontWeight.w600,
                  color: scheme.onSurface,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RankRow extends StatelessWidget {
  const _RankRow({
    required this.rank,
    required this.name,
    required this.amount,
    this.quantity,
  });

  final int rank;
  final String name;
  final String amount;
  final String? quantity;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs + 2),
      child: Row(
        children: [
          Container(
            width: 22,
            height: 22,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: scheme.primary.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(AppRadii.sm),
            ),
            child: Text(
              '$rank',
              style: theme.textTheme.labelSmall?.copyWith(
                color: scheme.primary,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodyMedium,
            ),
          ),
          if (quantity != null) ...[
            Text(
              quantity!,
              style: theme.textTheme.bodySmall?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(width: AppSpacing.md),
          ],
          Text(
            amount,
            style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.w700,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}

class _PanelEmpty extends StatelessWidget {
  const _PanelEmpty({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
      child: Row(
        children: [
          Icon(
            Icons.inbox_outlined,
            size: 18,
            color: theme.colorScheme.onSurfaceVariant,
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
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
