import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../app/theme/design_tokens.dart';
import '../../core/json/json_utils.dart';
import '../extensions/l10n_extension.dart';

/// How tightly the rows are packed.
enum TableDensity { compact, normal, spacious }

class ResizableColumn {
  const ResizableColumn(
    this.label, {
    required this.value,
    this.numeric = false,
    this.width = 150,
    this.minWidth = 70,
    this.emphasise = false,
  });

  final String label;

  /// Pulls the cell text out of a record. Returning null renders a dash.
  final String? Function(Json row) value;
  final bool numeric;
  final double width;
  final double minWidth;
  final bool emphasise;
}

/// A table whose columns can be widened by dragging their edges.
///
/// The whole table scrolls sideways rather than squeezing values, every cell
/// shows its full text in a tooltip, and the row height can be switched between
/// three densities. Column widths and density are remembered per table, so a
/// person sets their accounts table up once.
class ResizableTable extends StatefulWidget {
  const ResizableTable({
    super.key,
    required this.columns,
    required this.rows,
    this.storageKey,
    this.onTap,
    this.actions,
    this.showToolbar = true,
  });

  final List<ResizableColumn> columns;
  final List<Json> rows;
  final String? storageKey;
  final void Function(Json row)? onTap;

  /// Extra buttons drawn at the end of each row.
  final List<Widget> Function(Json row)? actions;
  final bool showToolbar;

  @override
  State<ResizableTable> createState() => _ResizableTableState();
}

class _ResizableTableState extends State<ResizableTable> {
  late List<double> _widths =
      widget.columns.map((column) => column.width).toList(growable: false);
  TableDensity _density = TableDensity.normal;

  String get _key => 'resizable-table.${widget.storageKey ?? 'default'}';

  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    if (widget.storageKey == null) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_key);
      if (!mounted || saved == null) return;
      final parts = saved.split(',');
      final density = TableDensity.values.firstWhere(
        (value) => value.name == parts.first,
        orElse: () => TableDensity.normal,
      );
      final widths = parts
          .skip(1)
          .map((value) => double.tryParse(value))
          .toList(growable: false);
      setState(() {
        _density = density;
        if (widths.length == widget.columns.length &&
            widths.every((value) => value != null && value > 0)) {
          _widths = widths.cast<double>();
        }
      });
    } catch (_) {
      // Defaults are a perfectly good table.
    }
  }

  Future<void> _persist() async {
    if (widget.storageKey == null) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _key,
        '${_density.name},${_widths.map((value) => value.round()).join(',')}',
      );
    } catch (_) {
      // Ignored.
    }
  }

  double get _rowHeight => switch (_density) {
    TableDensity.compact => AppSizes.compactControlHeight,
    TableDensity.normal => AppSizes.tableRowHeight,
    TableDensity.spacious => 56,
  };

  EdgeInsets get _cellPadding => switch (_density) {
    TableDensity.compact =>
      const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.xs),
    TableDensity.normal =>
      const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
    TableDensity.spacious =>
      const EdgeInsets.symmetric(horizontal: AppSpacing.lg, vertical: AppSpacing.md),
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = context.l10n;
    final hasActions = widget.actions != null;
    final totalWidth = _widths.fold<double>(0, (sum, value) => sum + value) +
        (hasActions ? 150 : 0);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.showToolbar)
          Padding(
            padding: const EdgeInsetsDirectional.only(
              start: AppSpacing.xs,
              end: AppSpacing.xs,
              bottom: AppSpacing.sm,
            ),
            child: Row(
              children: [
                Text(
                  l10n.rowDensity,
                  style: theme.textTheme.bodySmall,
                ),
                const SizedBox(width: 8),
                SegmentedButton<TableDensity>(
                  segments: [
                    ButtonSegment(
                      value: TableDensity.compact,
                      icon: const Icon(Icons.density_small, size: 16),
                      tooltip: l10n.densityCompact,
                    ),
                    ButtonSegment(
                      value: TableDensity.normal,
                      icon: const Icon(Icons.density_medium, size: 16),
                      tooltip: l10n.densityNormal,
                    ),
                    ButtonSegment(
                      value: TableDensity.spacious,
                      icon: const Icon(Icons.density_large, size: 16),
                      tooltip: l10n.densitySpacious,
                    ),
                  ],
                  selected: {_density},
                  showSelectedIcon: false,
                  style: const ButtonStyle(
                    visualDensity: VisualDensity.compact,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  onSelectionChanged: (selection) {
                    setState(() => _density = selection.first);
                    _persist();
                  },
                ),
                const Spacer(),
                Flexible(
                  child: Text(
                    l10n.dragColumnHint,
                    style: theme.textTheme.bodySmall,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.end,
                  ),
                ),
              ],
            ),
          ),
        DecoratedBox(
          decoration: BoxDecoration(
            color: theme.colorScheme.surface,
            border: Border.all(
              color: theme.colorScheme.outlineVariant.withValues(alpha: 0.85),
            ),
            borderRadius: AppRadii.control,
          ),
          child: ClipRRect(
            borderRadius: AppRadii.control,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: SizedBox(
                width: math.max(totalWidth, 320.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Container(
                      color: theme.brightness == Brightness.light
                          ? AppColors.surfaceSunken
                          : AppColors.darkSurfaceAlt,
                      child: Row(
                        children: [
                          for (var index = 0;
                              index < widget.columns.length;
                              index++)
                            _headerCell(context, index),
                          if (hasActions)
                            SizedBox(
                              width: 150,
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 10,
                                  vertical: 10,
                                ),
                                child: Text(
                                  l10n.actions,
                                  style: theme.textTheme.labelSmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                    for (final row in widget.rows)
                      _row(context, row, hasActions),
                    if (widget.rows.isEmpty)
                      Padding(
                        padding: const EdgeInsets.all(24),
                        child: Text(
                          l10n.noRecords,
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodyMedium,
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _headerCell(BuildContext context, int index) {
    final theme = Theme.of(context);
    final column = widget.columns[index];
    return SizedBox(
      width: _widths[index],
      child: Row(
        children: [
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
              child: Text(
                column.label,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.4,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
          MouseRegion(
            cursor: SystemMouseCursors.resizeColumn,
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onHorizontalDragUpdate: (details) {
                setState(() {
                  _widths[index] = math.max(
                    column.minWidth,
                    _widths[index] + details.delta.dx,
                  );
                });
              },
              onHorizontalDragEnd: (_) => _persist(),
              child: Container(
                width: 9,
                height: 34,
                alignment: Alignment.center,
                child: Container(
                  width: 1,
                  height: 18,
                  color: theme.colorScheme.outline.withValues(alpha: 0.5),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _row(BuildContext context, Json row, bool hasActions) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: widget.onTap == null ? null : () => widget.onTap!(row),
      child: Container(
        constraints: BoxConstraints(minHeight: _rowHeight),
        decoration: BoxDecoration(
          border: Border(
            top: BorderSide(color: theme.colorScheme.outlineVariant, width: 0.6),
          ),
        ),
        child: Row(
          children: [
            for (var index = 0; index < widget.columns.length; index++)
              SizedBox(
                width: _widths[index],
                child: Padding(
                  padding: _cellPadding,
                  child: Align(
                    alignment: widget.columns[index].numeric
                        ? AlignmentDirectional.centerEnd
                        : AlignmentDirectional.centerStart,
                    child: Tooltip(
                      message: widget.columns[index].value(row) ?? '—',
                      waitDuration: const Duration(milliseconds: 500),
                      child: Text(
                        widget.columns[index].value(row) ?? '—',
                        maxLines: _density == TableDensity.compact ? 1 : 2,
                        overflow: TextOverflow.ellipsis,
                        textAlign: widget.columns[index].numeric
                            ? TextAlign.end
                            : TextAlign.start,
                        style: (widget.columns[index].emphasise
                                ? theme.textTheme.bodyMedium?.copyWith(
                                    fontWeight: FontWeight.w600,
                                  )
                                : theme.textTheme.bodyMedium)
                            ?.copyWith(
                              fontFeatures: const [
                                FontFeature.tabularFigures(),
                              ],
                            ),
                      ),
                    ),
                  ),
                ),
              ),
            if (hasActions)
              SizedBox(
                width: 150,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: widget.actions!(row),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
