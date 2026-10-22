import 'package:flutter/material.dart';

import '../../app/theme/design_tokens.dart';
import '../../core/json/json_utils.dart';
import '../extensions/l10n_extension.dart';
import 'status_pill.dart';

/// One column of a [RecordsTable].
class ColumnSpec {
  const ColumnSpec(
    this.label, {
    required this.value,
    this.numeric = false,
    this.flex = 1,
    this.emphasise = false,
    this.tone,
  });

  final String label;

  /// Pulls the cell text out of a record. Returning null renders a dash.
  final String? Function(Json row) value;
  final bool numeric;
  final int flex;
  final bool emphasise;

  /// When set, the cell is drawn as a status pill tinted by this tone. The
  /// text is still the same label the column already produced, so nothing is
  /// renamed by the presentation.
  final AppTone Function(Json row)? tone;
}

/// A record list that stays readable on a phone and on a desktop.
///
/// Wide screens get a real table, dense enough for financial review: 42 px
/// rows, tabular numerals, a hairline header and a quiet hover highlight.
/// Narrow screens get one card per record, so nothing is squeezed into
/// unreadable columns.
class RecordsTable extends StatelessWidget {
  const RecordsTable({
    super.key,
    required this.columns,
    required this.rows,
    this.actions,
    this.onTap,
  });

  final List<ColumnSpec> columns;
  final List<Json> rows;

  /// Extra buttons shown at the end of every record.
  final List<Widget> Function(Json row)? actions;
  final void Function(Json row)? onTap;

  static const _wideBreakpoint = 760.0;

  @override
  Widget build(BuildContext context) {
    // The available width — not the device's — decides. Inside a
    // dialog or a narrow pane the screen may be wide while the table's
    // actual room is not, and sizing to the screen squeezed the table
    // into space it did not have.
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth.isFinite
            ? constraints.maxWidth
            : MediaQuery.sizeOf(context).width;
        if (width < _wideBreakpoint) return _cardList(context);
        return _table(context);
      },
    );
  }

  Widget _table(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final hover = theme.brightness == Brightness.light
        ? AppColors.surfaceMuted
        : AppColors.darkSurfaceAlt;
    return Scrollbar(
      child: SingleChildScrollView(
        scrollDirection: Axis.vertical,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: DataTable(
            showCheckboxColumn: false,
            headingTextStyle: theme.textTheme.labelSmall?.copyWith(
              color: scheme.onSurfaceVariant,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
            ),
            columns: [
              for (final column in columns)
                DataColumn(
                  // A heading never wraps into a tower of syllables: the
                  // column takes the width its heading needs and the
                  // table scrolls sideways for the rest.
                  label: Text(column.label, softWrap: false),
                  numeric: column.numeric,
                ),
              if (actions != null)
                DataColumn(label: Text(context.l10n.actions, softWrap: false)),
            ],
            rows: [
              for (final row in rows)
                DataRow(
                  color: WidgetStateProperty.resolveWith((states) {
                    if (states.contains(WidgetState.hovered) ||
                        states.contains(WidgetState.focused)) {
                      return hover;
                    }
                    return null;
                  }),
                  onSelectChanged: onTap == null ? null : (_) => onTap!(row),
                  cells: [
                    for (final column in columns)
                      DataCell(
                        column.tone == null
                            ? column.numeric
                                  // A number is shown whole or not at all:
                                  // never wrapped at a comma, never split
                                  // across lines into a different-looking
                                  // figure. The column grows instead, and
                                  // the table scrolls.
                                  ? Text(
                                      column.value(row) ?? '—',
                                      softWrap: false,
                                      style: _cellStyle(theme, column),
                                    )
                                  // Descriptive text may wrap, but inside
                                  // bounds: never crushed to a sliver,
                                  // never stretching the table forever.
                                  : ConstrainedBox(
                                      constraints: const BoxConstraints(
                                        minWidth: 110,
                                        maxWidth: 300,
                                      ),
                                      child: Text(
                                        column.value(row) ?? '—',
                                        style: _cellStyle(theme, column),
                                      ),
                                    )
                            : Align(
                                alignment: AlignmentDirectional.centerStart,
                                child: StatusPill(
                                  label: column.value(row) ?? '—',
                                  tone: column.tone!(row),
                                  dense: true,
                                ),
                              ),
                      ),
                    if (actions != null)
                      DataCell(
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: actions!(row),
                        ),
                      ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }

  TextStyle? _cellStyle(ThemeData theme, ColumnSpec column) {
    final base = column.numeric
        ? theme.textTheme.bodyMedium?.copyWith(
            fontFeatures: const [FontFeature.tabularFigures()],
          )
        : theme.textTheme.bodyMedium;
    if (!column.emphasise) return base;
    return base?.copyWith(fontWeight: FontWeight.w600);
  }

  Widget _cardList(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return ListView.separated(
      padding: const EdgeInsets.all(AppSpacing.md),
      itemCount: rows.length,
      separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.sm),
      itemBuilder: (context, index) {
        final row = rows[index];
        // The first column is the identifier, the rest are detail lines.
        final headline = columns.isEmpty
            ? ''
            : columns.first.value(row) ?? '—';
        return Material(
          color: scheme.surface,
          borderRadius: AppRadii.control,
          child: InkWell(
            borderRadius: AppRadii.control,
            onTap: onTap == null ? null : () => onTap!(row),
            child: Ink(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                borderRadius: AppRadii.control,
                border: Border.all(
                  color: scheme.outlineVariant.withValues(alpha: 0.8),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    headline,
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (columns.length > 1) const SizedBox(height: AppSpacing.sm),
                  // Label above, value below at full card width. Side by
                  // side, a long Arabic account name and its amount
                  // fought over one narrow line and both lost — the
                  // compressed, overlapping look on phones. Stacked,
                  // each gets the whole width; numbers still never wrap.
                  for (final column in columns.skip(1))
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            column.label,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: 2),
                          if (column.tone != null)
                            Align(
                              alignment: AlignmentDirectional.centerStart,
                              child: StatusPill(
                                label: column.value(row) ?? '—',
                                tone: column.tone!(row),
                                dense: true,
                              ),
                            )
                          else if (column.numeric)
                            SingleChildScrollView(
                              scrollDirection: Axis.horizontal,
                              child: Text(
                                column.value(row) ?? '—',
                                softWrap: false,
                                style: theme.textTheme.bodyMedium?.copyWith(
                                  fontFeatures: const [
                                    FontFeature.tabularFigures(),
                                  ],
                                ),
                              ),
                            )
                          else
                            Text(column.value(row) ?? '—'),
                        ],
                      ),
                    ),
                  if (actions != null) ...[
                    const SizedBox(height: AppSpacing.xs),
                    Align(
                      alignment: AlignmentDirectional.centerEnd,
                      child: Wrap(children: actions!(row)),
                    ),
                  ],
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Small coloured label for a document status.
///
/// Kept as the public name the screens already use; the visual treatment is
/// the shared [StatusPill] so every list speaks the same colour language.
class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.label, required this.status});

  final String label;
  final String status;

  @override
  Widget build(BuildContext context) {
    return StatusPill(label: label, tone: toneForStatus(status), dense: true);
  }
}
