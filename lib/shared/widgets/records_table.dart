import 'package:flutter/material.dart';

import '../../core/json/json_utils.dart';
import '../extensions/l10n_extension.dart';

/// One column of a [RecordsTable].
class ColumnSpec {
  const ColumnSpec(
    this.label, {
    required this.value,
    this.numeric = false,
    this.flex = 1,
    this.emphasise = false,
  });

  final String label;

  /// Pulls the cell text out of a record. Returning null renders a dash.
  final String? Function(Json row) value;
  final bool numeric;
  final int flex;
  final bool emphasise;
}

/// A record list that stays readable on a phone and on a desktop.
///
/// Wide screens get a real table. Narrow screens get one card per record, so
/// nothing is squeezed into unreadable columns.
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
    if (MediaQuery.sizeOf(context).width < _wideBreakpoint) {
      return _cardList(context);
    }
    return _table(context);
  }

  Widget _table(BuildContext context) {
    final theme = Theme.of(context);
    return SingleChildScrollView(
      scrollDirection: Axis.vertical,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          headingTextStyle: theme.textTheme.labelLarge,
          columns: [
            for (final column in columns)
              DataColumn(
                label: Text(column.label),
                numeric: column.numeric,
              ),
            if (actions != null) DataColumn(label: Text(context.l10n.actions)),
          ],
          rows: [
            for (final row in rows)
              DataRow(
                onSelectChanged: onTap == null ? null : (_) => onTap!(row),
                cells: [
                  for (final column in columns)
                    DataCell(
                      Text(
                        column.value(row) ?? '—',
                        style: column.emphasise
                            ? theme.textTheme.bodyMedium?.copyWith(
                                fontWeight: FontWeight.w600,
                              )
                            : null,
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
    );
  }

  Widget _cardList(BuildContext context) {
    final theme = Theme.of(context);
    return ListView.separated(
      padding: const EdgeInsets.all(12),
      itemCount: rows.length,
      separatorBuilder: (_, _) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final row = rows[index];
        // The first column is the identifier, the rest are detail lines.
        final headline = columns.isEmpty ? '' : columns.first.value(row) ?? '—';
        return Card(
          margin: EdgeInsets.zero,
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: onTap == null ? null : () => onTap!(row),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(headline, style: theme.textTheme.titleMedium),
                  const SizedBox(height: 8),
                  for (final column in columns.skip(1))
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              column.label,
                              style: theme.textTheme.bodySmall,
                            ),
                          ),
                          Expanded(
                            flex: 2,
                            child: Text(
                              column.value(row) ?? '—',
                              textAlign: TextAlign.end,
                            ),
                          ),
                        ],
                      ),
                    ),
                  if (actions != null) ...[
                    const SizedBox(height: 4),
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
class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.label, required this.status});

  final String label;
  final String status;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (background, foreground) = switch (status.toLowerCase()) {
      'posted' => (scheme.primaryContainer, scheme.onPrimaryContainer),
      'reversed' => (scheme.errorContainer, scheme.onErrorContainer),
      'draft' => (scheme.surfaceContainerHighest, scheme.onSurfaceVariant),
      _ => (scheme.surfaceContainerHighest, scheme.onSurfaceVariant),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: Theme.of(
          context,
        ).textTheme.labelSmall?.copyWith(color: foreground),
      ),
    );
  }
}
