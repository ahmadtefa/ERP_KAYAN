import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/json_utils.dart';
import '../../../../core/platform/download_request.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// The reports the inventory module can answer.
///
/// The list is read from the server rather than written down here: the
/// catalogue endpoint returns each report with the filters it understands, so
/// a report added to the backend appears here without a second list to keep in
/// step - and a report removed stops being offered instead of failing when
/// pressed.
final _catalogueProvider = FutureProvider<List<Json>>((ref) async {
  final response = await ref
      .read(apiClientProvider)
      .get('/inventory/reports');
  final reports = response['reports'];
  if (reports is! List) return const [];
  return reports
      .whereType<Map>()
      .map((row) => Map<String, dynamic>.from(row))
      .toList(growable: false);
});

/// One report's answer, keyed by slug so switching reports does not show the
/// previous report's rows while the new one loads.
final _reportProvider = FutureProvider.family<Json, String>((ref, slug) async {
  final query = ref.watch(_reportFilterProvider);
  return ref.read(apiClientProvider).get(
    '/inventory/reports/$slug',
    query: query.isEmpty ? null : query,
  );
});

/// The filter the whole screen shares. Only the keys a report declares are
/// read from it, so one set of controls serves twenty reports.
/// Riverpod 3 removed `StateProvider`; a `Notifier` is the supported way to
/// hold a value a widget both reads and writes.
class _ReportFilter extends Notifier<Map<String, dynamic>> {
  @override
  Map<String, dynamic> build() => const {};

  void set(String key, dynamic value) {
    final next = {...state};
    if (value == null) {
      next.remove(key);
    } else {
      next[key] = value;
    }
    state = next;
  }

  void clear() => state = const {};
}

final _reportFilterProvider =
    NotifierProvider<_ReportFilter, Map<String, dynamic>>(_ReportFilter.new);

class _SelectedReport extends Notifier<String?> {
  @override
  String? build() => null;

  void select(String? id) => state = id;
}

final _selectedReportProvider =
    NotifierProvider<_SelectedReport, String?>(_SelectedReport.new);

class InventoryReportsScreen extends ConsumerStatefulWidget {
  const InventoryReportsScreen({super.key});

  @override
  ConsumerState<InventoryReportsScreen> createState() =>
      _InventoryReportsScreenState();
}

class _InventoryReportsScreenState
    extends ConsumerState<InventoryReportsScreen> {
  bool _exporting = false;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String _title(Json report) => _arabic
      ? text(report, 'titleAr')
      : text(report, 'titleEn');

  // The catalogue reports the filters each report understands, but this screen
  // has no filter controls yet: it renders the rows the server returns for the
  // whole company. A helper that read those keys and was never called would be
  // the kind of dead code that makes a missing feature look present.

  @override
  Widget build(BuildContext context) {
    final catalogue = ref.watch(_catalogueProvider);

    return ModuleScaffold(
      title: _arabic ? 'تقارير المخزون' : 'Inventory reports',
      eyebrow: _arabic ? 'المخزون' : 'Inventory',
      trailing: IconButton(
        tooltip: _arabic ? 'تحديث' : 'Refresh',
        onPressed: () => ref.invalidate(_catalogueProvider),
        icon: const Icon(Icons.refresh),
      ),
      body: AsyncStateView<List<Json>>(
        value: catalogue,
        onRetry: () => ref.invalidate(_catalogueProvider),
        isEmpty: (reports) => reports.isEmpty,
        emptyMessage: _arabic
            ? 'لا توجد تقارير متاحة.'
            : 'No reports are available.',
        data: (reports) {
          final selected = ref.watch(_selectedReportProvider) ??
              text(reports.first, 'slug');
          final report = reports.firstWhere(
            (row) => text(row, 'slug') == selected,
            orElse: () => reports.first,
          );
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(
                width: 280,
                child: ListView(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  children: [
                    for (final row in reports)
                      ListTile(
                        dense: true,
                        selected: text(row, 'slug') == selected,
                        title: Text(_title(row)),
                        onTap: () => ref
                            .read(_selectedReportProvider.notifier)
                            .select(text(row, 'slug')),
                      ),
                  ],
                ),
              ),
              const VerticalDivider(width: 1),
              Expanded(child: _result(report)),
            ],
          );
        },
      ),
    );
  }

  Widget _result(Json report) {
    final slug = text(report, 'slug');
    final async = ref.watch(_reportProvider(slug));
    final mayExport =
        ref.watch(currentUserProvider)?.can('inventory.export') ?? false;

    return AsyncStateView<Json>(
      value: async,
      onRetry: () => ref.invalidate(_reportProvider(slug)),
      data: (data) {
        final rows = (data['rows'] is List)
            ? (data['rows'] as List)
                  .whereType<Map>()
                  .map((row) => Map<String, dynamic>.from(row))
                  .toList(growable: false)
            : const <Json>[];
        final totals = data['totals'];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      _title(report),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                  Text(
                    _arabic ? '${rows.length} سجل' : '${rows.length} rows',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  if (mayExport) ...[
                    const SizedBox(width: 12),
                    FilledButton.tonalIcon(
                      onPressed: _exporting ? null : () => _export(slug),
                      icon: const Icon(Icons.download_outlined, size: 18),
                      label: Text(_arabic ? 'تصدير CSV' : 'Export CSV'),
                    ),
                  ],
                ],
              ),
            ),
            if (totals is Map) _totals(Map<String, dynamic>.from(totals)),
            Expanded(
              child: rows.isEmpty
                  ? Center(
                      child: Text(
                        _arabic ? 'لا توجد بيانات.' : 'No data.',
                      ),
                    )
                  : RecordsTable(
                      rows: rows,
                      columns: _columnsFor(rows.first),
                    ),
            ),
          ],
        );
      },
    );
  }

  /// A report's columns are its own row keys. They are shown as the server
  /// named them rather than mapped through a per-report dictionary that would
  /// have to be kept in step with twenty reports.
  List<ColumnSpec> _columnsFor(Json row) {
    return [
      for (final key in row.keys)
        ColumnSpec(
          key,
          value: (r) => asString(r[key]),
          numeric: _looksNumeric(row, key),
        ),
    ];
  }

  bool _looksNumeric(Json row, String key) {
    final value = row[key];
    if (value is num) return true;
    final asText = asString(value);
    if (asText == null) return false;
    return num.tryParse(asText) != null;
  }

  Widget _totals(Json totals) {
    if (totals.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 0, 24, 12),
      child: Wrap(
        spacing: 16,
        runSpacing: 4,
        children: [
          for (final entry in totals.entries)
            Chip(
              label: Text('${entry.key}: ${asString(entry.value) ?? '—'}'),
            ),
        ],
      ),
    );
  }

  /// The CSV route the inventory module owns.
  ///
  /// `/exports/:report` does not serve these: its allow-list is the accounting
  /// and operations reports, and the inventory slugs are not in it. The
  /// inventory controller exports its own reports at
  /// `/inventory/reports/:slug/export`, behind `inventory.export`, and that is
  /// what this button asks for.
  Future<void> _export(String slug) async {
    setState(() => _exporting = true);
    try {
      // The base the API client is already pointed at; the ticket and the
      // request must travel to the same origin or the server will not
      // recognise them as the same session.
      final base = ref.read(appConfigProvider).apiBaseUrl;
      final filter = ref.read(_reportFilterProvider);
      final query = <String, String>{
        for (final entry in filter.entries)
          if (entry.value != null) entry.key: '${entry.value}',
      };
      final url = Uri.parse('$base/inventory/reports/$slug/export')
          .replace(queryParameters: query.isEmpty ? null : query);
      await runDownload(
        context,
        Future.value(DownloadRequest(url: url.toString())),
      );
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }
}
