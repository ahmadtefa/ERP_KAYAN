import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/widgets/download_feedback.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../data/presentation/providers/data_providers.dart';

/// «تقارير المخزون» - the twenty analytical reports the warehouse answers.
///
/// The server publishes the catalogue itself, so this screen is not a second
/// list that drifts: it reads `/inventory/reports`, draws a card per report,
/// and runs whichever one is chosen with the filters that report declares. A
/// report the API gains appears here without a release of the desktop.
///
/// Every row of every report is a real answer from the database - there is no
/// sample data anywhere on this screen - and each one can leave the building:
/// CSV for all twenty through one export route, and paper or PDF for the four
/// that have a printed sheet.
class InventoryReportsScreen extends ConsumerStatefulWidget {
  const InventoryReportsScreen({super.key});

  @override
  ConsumerState<InventoryReportsScreen> createState() =>
      _InventoryReportsScreenState();
}

class _InventoryReportsScreenState extends ConsumerState<InventoryReportsScreen> {
  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  @override
  Widget build(BuildContext context) {
    return ModuleScaffold(
      title: _t('تقارير المخزون', 'Inventory reports'),
      subtitle: _t(
        'عشرون تقريرًا للمخزون والمخازن والدفعات والصلاحية والهالك، بفلاتر وعرض تفصيلي وطباعة وتصدير.',
        'Twenty reports over stock, warehouses, lots, expiry and scrap - with filters, details, '
            'printing and export.',
      ),
      body: const _ReportsBody(),
    );
  }
}

class _ReportsBody extends ConsumerStatefulWidget {
  const _ReportsBody();

  @override
  ConsumerState<_ReportsBody> createState() => _ReportsBodyState();
}

class _ReportsBodyState extends ConsumerState<_ReportsBody> {
  List<Json> _catalogue = const [];
  List<Json> _warehouses = const [];
  List<Json> _items = const [];
  Json? _open;
  Json? _result;
  bool _loading = true;
  bool _running = false;
  bool _busy = false;
  String? _error;

  /// The filters, kept across reports on purpose: a person comparing the same
  /// warehouse across three reports should not have to choose it three times.
  String _from = '';
  String _to = '';
  String? _warehouseId;
  String? _itemId;
  String _days = '';

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  String get _language => Localizations.localeOf(context).languageCode;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _to = _day(now);
    _from = _day(DateTime(now.year, now.month - 1, now.day));
    _bootstrap();
  }

  static String _day(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-'
      '${value.month.toString().padLeft(2, '0')}-'
      '${value.day.toString().padLeft(2, '0')}';

  Future<void> _bootstrap() async {
    try {
      final catalogue = await ref
          .read(apiClientProvider)
          .getObject('/inventory/reports');
      final reports = listOf(catalogue['reports']);
      if (!mounted) return;
      setState(() {
        _catalogue = reports;
        _loading = false;
      });
      // The filters need the real lists; a report can still be run without
      // them, with a date range alone.
      try {
        final warehouses = await ref
            .read(apiClientProvider)
            .getList('/inventory/warehouses');
        if (mounted) setState(() => _warehouses = warehouses);
      } on Failure {
        // No warehouse filter, but the reports still work.
      }
      try {
        final items = await ref
            .read(apiClientProvider)
            .getList('/inventory/items', query: {'pageSize': 500});
        if (mounted) setState(() => _items = items);
      } on Failure {
        // Same: item filters are optional.
      }
    } on Failure catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.message;
      });
    }
  }

  String _title(Json report) {
    final ar = text(report, 'titleAr');
    final en = text(report, 'titleEn');
    return _arabic ? (ar.isEmpty ? en : ar) : (en.isEmpty ? ar : en);
  }

  /// The catalogue lists filter names as plain strings, so this reads them as
  /// strings - `listOf` would keep only maps and answer "no filters" for every
  /// report, which would quietly hide the filters that exist.
  bool _hasFilter(Json report, String name) {
    final filters = report['filters'];
    if (filters is! List) return false;
    return filters.map((entry) => '$entry').contains(name);
  }

  Map<String, String> get _filters {
    final open = _open;
    if (open == null) return const {};
    return {
      if (_hasFilter(open, 'from') && _from.isNotEmpty) 'from': _from,
      if (_hasFilter(open, 'to') && _to.isNotEmpty) 'to': _to,
      if (_hasFilter(open, 'warehouseId') && _warehouseId != null)
        'warehouseId': _warehouseId!,
      if (_hasFilter(open, 'itemId') && _itemId != null) 'itemId': _itemId!,
      if (_hasFilter(open, 'days') && _days.trim().isNotEmpty)
        'days': _days.trim(),
    };
  }

  Future<void> _run() async {
    final open = _open;
    if (open == null) return;
    setState(() {
      _running = true;
      _error = null;
    });
    try {
      final result = await ref.read(apiClientProvider).getObject(
        '/inventory/reports/${text(open, 'slug')}',
        query: _filters,
      );
      if (!mounted) return;
      setState(() => _result = result);
    } on Failure catch (error) {
      if (!mounted) return;
      setState(() {
        _result = null;
        _error = error.message;
      });
    } finally {
      if (mounted) setState(() => _running = false);
    }
  }

  /// Whether this report has a printed sheet of its own.
  bool _hasPaper(Json report) => const {
    'valuation-by-warehouse',
    'slow-moving',
    'below-minimum',
  }.contains(text(report, 'slug'));

  /// The slug the print route knows, when it knows this report at all.
  String? _paperSlug(Json report) {
    switch (text(report, 'slug')) {
      case 'valuation-by-warehouse':
        return 'valuation';
      case 'slow-moving':
        return 'slow-moving';
      case 'below-minimum':
        return 'reorder';
      default:
        return null;
    }
  }

  Future<void> _print(Json report, {required bool pdf}) async {
    final slug = _paperSlug(report);
    if (slug == null) return;
    final links = ref.read(reportLinkProvider);
    setState(() => _busy = true);
    try {
      if (pdf) {
        await runDownload(
          context,
          links.inventoryReportPdf(
            report: slug,
            language: _language,
            filters: _filters,
          ),
        );
      } else {
        await runPrint(
          context,
          links.inventoryReportPrint(
            report: slug,
            language: _language,
            filters: _filters,
          ),
        );
      }
    } catch (error) {
      if (mounted) showMessage(context, '$error', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _export(Json report) async {
    setState(() => _busy = true);
    try {
      await runDownload(
        context,
        ref.read(reportLinkProvider).inventoryReportCsv(
          slug: text(report, 'slug'),
          language: _language,
          filters: _filters,
        ),
      );
    } catch (error) {
      if (mounted) showMessage(context, '$error', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The rows of whatever shape the report returned: some answer with `rows`,
  /// a few with `lines`, and the reconciliation with a single summary object.
  List<Json> get _rows {
    final result = _result;
    if (result == null) return const [];
    final rows = listOf(result['rows']);
    if (rows.isNotEmpty) return rows;
    final lines = listOf(result['lines']);
    if (lines.isNotEmpty) return lines;
    return const [];
  }

  /// The columns the server chose, in the order it returned them. A report is
  /// data; inventing headings here would let the screen disagree with the API.
  List<String> get _columns {
    final rows = _rows;
    if (rows.isEmpty) return const [];
    final keys = rows.first.keys.where((key) {
      final value = rows.first[key];
      return value is! Map && value is! List;
    }).toList(growable: false);
    return keys;
  }

  Widget _filterBar(Json report) {
    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (_hasFilter(report, 'from'))
          SizedBox(
            width: 160,
            child: TextFormField(
              key: const ValueKey('inventory-report-from'),
              initialValue: _from,
              decoration: InputDecoration(
                labelText: _t('من', 'From'),
                isDense: true,
                border: const OutlineInputBorder(),
              ),
              onChanged: (value) => _from = value.trim(),
            ),
          ),
        if (_hasFilter(report, 'to'))
          SizedBox(
            width: 160,
            child: TextFormField(
              key: const ValueKey('inventory-report-to'),
              initialValue: _to,
              decoration: InputDecoration(
                labelText: _t('إلى', 'To'),
                isDense: true,
                border: const OutlineInputBorder(),
              ),
              onChanged: (value) => _to = value.trim(),
            ),
          ),
        if (_hasFilter(report, 'days'))
          SizedBox(
            width: 140,
            child: TextFormField(
              key: const ValueKey('inventory-report-days'),
              initialValue: _days,
              decoration: InputDecoration(
                labelText: _t('عدد الأيام', 'Days'),
                isDense: true,
                border: const OutlineInputBorder(),
              ),
              onChanged: (value) => _days = value.trim(),
            ),
          ),
        if (_hasFilter(report, 'warehouseId'))
          SizedBox(
            width: 240,
            child: DropdownButtonFormField<String>(
              key: const ValueKey('inventory-report-warehouse'),
              initialValue: _warehouseId,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: _t('المخزن', 'Warehouse'),
                isDense: true,
                border: const OutlineInputBorder(),
              ),
              items: [
                for (final warehouse in _warehouses)
                  DropdownMenuItem(
                    value: text(warehouse, 'id'),
                    child: Text(
                      '${text(warehouse, 'code')} — '
                      '${_arabic ? text(warehouse, 'nameAr') : text(warehouse, 'nameEn')}',
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: (value) => setState(() => _warehouseId = value),
            ),
          ),
        if (_hasFilter(report, 'itemId'))
          SizedBox(
            width: 240,
            child: DropdownButtonFormField<String>(
              key: const ValueKey('inventory-report-item'),
              initialValue: _itemId,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: _t('الصنف', 'Item'),
                isDense: true,
                border: const OutlineInputBorder(),
              ),
              items: [
                for (final item in _items)
                  DropdownMenuItem(
                    value: text(item, 'id'),
                    child: Text(
                      '${text(item, 'code')} — '
                      '${_arabic ? text(item, 'nameAr') : text(item, 'nameEn')}',
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: (value) => setState(() => _itemId = value),
            ),
          ),
        FilledButton.icon(
          key: const ValueKey('inventory-report-run'),
          onPressed: _running ? null : _run,
          icon: const Icon(Icons.play_arrow, size: 18),
          label: Text(_t('تشغيل', 'Run')),
        ),
        OutlinedButton.icon(
          key: const ValueKey('inventory-report-csv'),
          onPressed: _busy ? null : () => _export(report),
          icon: const Icon(Icons.table_view_outlined, size: 18),
          label: Text('CSV'),
        ),
        if (_hasPaper(report)) ...[
          OutlinedButton.icon(
            key: const ValueKey('inventory-report-print'),
            onPressed: _busy ? null : () => _print(report, pdf: false),
            icon: const Icon(Icons.print_outlined, size: 18),
            label: Text(_t('طباعة', 'Print')),
          ),
          OutlinedButton.icon(
            key: const ValueKey('inventory-report-pdf'),
            onPressed: _busy ? null : () => _print(report, pdf: true),
            icon: const Icon(Icons.picture_as_pdf_outlined, size: 18),
            label: Text('PDF'),
          ),
        ],
        if (_running)
          const SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
      ],
    );
  }

  /// A heading a person can read. The report data is English-keyed, and a
  /// table headed `unitCost` to an Arabic user is a table nobody trusts; the
  /// keys that ship today are named in both languages and anything the API
  /// adds later still appears, under its own name, rather than vanishing.
  String _label(String key) {
    const names = <String, List<String>>{
      'itemCode': ['الكود', 'Code'],
      'itemName': ['الصنف', 'Item'],
      'itemNameEn': ['الصنف', 'Item'],
      'itemNameAr': ['الصنف', 'Item'],
      'unit': ['الوحدة', 'Unit'],
      'quantity': ['الكمية', 'Quantity'],
      'unitCost': ['تكلفة الوحدة', 'Unit cost'],
      'value': ['القيمة', 'Value'],
      'warehouseCode': ['المخزن', 'Warehouse'],
      'warehouseName': ['المخزن', 'Warehouse'],
      'batchNumber': ['الدفعة', 'Lot'],
      'expiryDate': ['الانتهاء', 'Expiry'],
      'documentNumber': ['المستند', 'Document'],
      'documentDate': ['التاريخ', 'Date'],
      'reason': ['السبب', 'Reason'],
      'status': ['الحالة', 'Status'],
      'movementDate': ['تاريخ الحركة', 'Movement date'],
      'direction': ['الاتجاه', 'Direction'],
      'createdByName': ['أنشأه', 'Created by'],
      'categoryName': ['المجموعة', 'Category'],
      'minimum': ['الحد الأدنى', 'Minimum'],
      'reorderPoint': ['نقطة الطلب', 'Reorder at'],
      'maximum': ['الحد الأقصى', 'Maximum'],
      'daysSinceLastMovement': ['أيام بلا حركة', 'Days idle'],
      'varianceQuantity': ['الفرق', 'Variance'],
      'varianceValue': ['قيمة الفرق', 'Variance value'],
    };
    final entry = names[key];
    if (entry == null) return key;
    return _arabic ? entry[0] : entry[1];
  }

  Widget _reportList() {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        Text(
          _t(
            'التقارير المتاحة: ${_catalogue.length}',
            'Reports available: ${_catalogue.length}',
          ),
          style: theme.textTheme.titleSmall,
        ),
        const SizedBox(height: AppSpacing.sm),
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            for (final report in _catalogue)
              SizedBox(
                width: 260,
                child: Card(
                  child: InkWell(
                    key: ValueKey('inventory-report-${text(report, 'slug')}'),
                    onTap: () => setState(() {
                      _open = report;
                      _result = null;
                      _error = null;
                    }),
                    child: Padding(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      child: Row(
                        children: [
                          const Icon(Icons.insights_outlined, size: 18),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(
                            child: Text(
                              _title(report),
                              style: theme.textTheme.bodyMedium,
                            ),
                          ),
                          const Icon(Icons.chevron_right, size: 18),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.md),
            child: Text(
              _error!,
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ),
      ],
    );
  }

  Widget _reportView(Json report) {
    final theme = Theme.of(context);
    final rows = _rows;
    final columns = _columns;
    final totals = _result?['totals'];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.sm,
          ),
          child: Row(
            children: [
              TextButton.icon(
                onPressed: () => setState(() {
                  _open = null;
                  _result = null;
                }),
                icon: const Icon(Icons.arrow_back, size: 18),
                label: Text(_t('كل التقارير', 'All reports')),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  _title(report),
                  style: theme.textTheme.titleMedium,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          child: _filterBar(report),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg,
              vertical: AppSpacing.sm,
            ),
            child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
          ),
        if (totals is Map && totals.isNotEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg,
              vertical: AppSpacing.sm,
            ),
            child: Wrap(
              spacing: AppSpacing.lg,
              runSpacing: AppSpacing.xs,
              children: [
                for (final entry in totals.entries)
                  Text(
                    '${entry.key}: ${entry.value}',
                    style: theme.textTheme.bodySmall,
                  ),
              ],
            ),
          ),
        Expanded(
          child: rows.isEmpty
              ? Center(
                  child: Text(
                    _result == null
                        ? _t('اختر «تشغيل» لعرض التقرير.', 'Press Run to see the report.')
                        : _t(
                            'لا توجد بيانات مطابقة لهذه الفلاتر.',
                            'Nothing matches these filters.',
                          ),
                  ),
                )
              : RecordsTable(
                  rows: rows,
                  columns: [
                    for (final key in columns)
                      ColumnSpec(
                        _label(key),
                        value: (row) {
                          final value = row[key];
                          if (value == null) return '—';
                          if (value is num) return value.toString();
                          return value.toString();
                        },
                      ),
                  ],
                ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    final open = _open;
    if (open == null) return _reportList();
    return _reportView(open);
  }
}
