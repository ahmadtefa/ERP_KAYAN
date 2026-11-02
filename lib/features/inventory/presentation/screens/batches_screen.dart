import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/design_tokens.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/widgets/records_table.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../../common/presentation/screens/module_scaffold.dart';

/// «الدفعات وتواريخ الصلاحية» - the goods themselves, not the totals.
///
/// A stock report answers "how many". This screen answers the three questions
/// a stock report cannot: which box, when does it expire, and where did it
/// come from. The bands shown here are the bands the server uses to raise
/// alerts, so what the owner reads on this screen and what the notification
/// centre says cannot disagree.
///
/// The two actions are the two things a person actually does with a lot after
/// it exists: follow it (traceability, from the purchase to the customer) and
/// destroy it (a write-off, which asks for a reason before it asks for a
/// quantity, because that reason is what the ledger entry will say for ever).
class BatchesScreen extends ConsumerStatefulWidget {
  const BatchesScreen({super.key});

  @override
  ConsumerState<BatchesScreen> createState() => _BatchesScreenState();
}

class _BatchesScreenState extends ConsumerState<BatchesScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 2, vsync: this);

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ModuleScaffold(
      title: _t('الدفعات والصلاحية', 'Lots and expiry'),
      subtitle: _t(
        'كل دفعة في المخزن بتاريخ إنتاجها وصلاحيتها، والتتبع من الشراء إلى العميل.',
        'Every lot with the dates it was made and expires, traced from the purchase to the customer.',
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TabBar(
            controller: _tabs,
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [
              Tab(text: _t('الدفعات', 'Lots')),
              Tab(text: _t('تقرير الصلاحية', 'Expiry report')),
            ],
          ),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: const [_LotListTab(), _ExpiryReportTab()],
            ),
          ),
        ],
      ),
    );
  }
}

/// The wording and colour of one expiry band, in one place.
class _Band {
  const _Band(this.ar, this.en, this.color);
  final String ar;
  final String en;
  final Color color;

  static _Band of(String value) {
    switch (value) {
      case 'EXPIRED':
        return const _Band('منتهية', 'Expired', Color(0xFFB3261E));
      case 'TODAY':
        return const _Band('تنتهي اليوم', 'Expires today', Color(0xFFE8710A));
      case 'IN_7':
        return const _Band('خلال ٧ أيام', 'Within 7 days', Color(0xFFE8710A));
      case 'IN_30':
        return const _Band('خلال ٣٠ يومًا', 'Within 30 days', Color(0xFFF2B01E));
      case 'IN_60':
        return const _Band('خلال ٦٠ يومًا', 'Within 60 days', Color(0xFF4C8DFF));
      case 'IN_90':
        return const _Band('خلال ٩٠ يومًا', 'Within 90 days', Color(0xFF2E7D32));
      case 'NO_EXPIRY':
        return const _Band('بلا صلاحية', 'No expiry', Color(0xFF6B7280));
      default:
        return const _Band('لاحقًا', 'Later', Color(0xFF6B7280));
    }
  }
}

/// A band as a tinted pill. Drawn rather than stamped into the text so the
/// urgency is visible before the words are read, and readable without colour.
Widget _bandPill(BuildContext context, String band, bool arabic) {
  final spec = _Band.of(band);
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 3),
    decoration: BoxDecoration(
      color: spec.color.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(AppRadii.pill),
      border: Border.all(color: spec.color.withValues(alpha: 0.35)),
    ),
    child: Text(
      arabic ? spec.ar : spec.en,
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: spec.color,
            fontWeight: FontWeight.w700,
          ),
    ),
  );
}

String _day(Object? value) {
  final text = asString(value);
  if (text == null) return '—';
  return text.split('T').first;
}

// ───────────────────────────────────────────────────────────────── the lots

class _LotListTab extends ConsumerStatefulWidget {
  const _LotListTab();

  @override
  ConsumerState<_LotListTab> createState() => _LotListTabState();
}

class _LotListTabState extends ConsumerState<_LotListTab> {
  Future<List<Json>>? _future;
  String _status = 'OPEN';
  String _query = '';
  bool _busy = false;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  bool _can(String permission) =>
      ref.read(currentUserProvider)?.can(permission) ?? false;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<Json>> _load() async {
    final data = await ref.read(apiClientProvider).get(
      '/inventory/batches',
      query: {
        if (_status.isNotEmpty) 'status': _status,
        'pageSize': '200',
      },
    );
    return listOf(data['items']);
  }

  void _refresh() => setState(() => _future = _load());

  void _say(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _writeOff(Json lot) async {
    final quantity = TextEditingController(text: asString(lot['remainingQuantity']));
    final reason = TextEditingController();
    final formKey = GlobalKey<FormState>();
    final available = double.tryParse(asString(lot['remainingQuantity']) ?? '0') ?? 0;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(_t('إعدام دفعة', 'Write off a lot')),
        content: Form(
          key: formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _t(
                  'ستخرج الدفعة ${text(lot, 'batchNumber')} من المخزون بقيمتها، ويُسجَّل الفرق في حساب فروق الجرد مع السبب.',
                  'Lot ${text(lot, 'batchNumber')} leaves stock at its value; the difference goes to the '
                      'inventory-difference account, with the reason on the entry.',
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              TextFormField(
                controller: quantity,
                decoration: InputDecoration(
                  labelText: _t('الكمية', 'Quantity'),
                  helperText: _t(
                    'المتاح: ${text(lot, 'remainingQuantity')}',
                    'Available: ${text(lot, 'remainingQuantity')}',
                  ),
                ),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                validator: (value) {
                  final parsed = double.tryParse((value ?? '').trim());
                  if (parsed == null || parsed <= 0) {
                    return _t('أدخل كمية أكبر من صفر', 'Enter a quantity above zero');
                  }
                  if (parsed > available) {
                    return _t('أكبر من المتاح', 'More than the lot holds');
                  }
                  return null;
                },
              ),
              const SizedBox(height: AppSpacing.md),
              TextFormField(
                controller: reason,
                decoration: InputDecoration(labelText: _t('السبب', 'Reason')),
                validator: (value) => (value ?? '').trim().length < 3
                    ? _t('السبب مطلوب', 'A reason is required')
                    : null,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(_t('إلغاء', 'Cancel')),
          ),
          FilledButton(
            onPressed: () {
              if (formKey.currentState?.validate() ?? false) {
                Navigator.pop(context, true);
              }
            },
            child: Text(_t('إعدام', 'Write off')),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _busy = true);
    try {
      final result = await ref.read(apiClientProvider).post(
        '/inventory/batches/write-off',
        body: {
          'branchId': lot['branchId'],
          'warehouseId': lot['warehouseId'],
          'itemId': lot['itemId'],
          'batchId': lot['id'],
          'quantity': quantity.text.trim(),
          'reason': reason.text.trim(),
        },
      );
      if (!mounted) return;
      _say(
        _t(
          'تم الإعدام، والقيد ${text(result, 'journalEntryNumber')}',
          'Written off; entry ${text(result, 'journalEntryNumber')}',
        ),
      );
      _refresh();
    } catch (error) {
      _say('$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _trace(Json lot) async {
    try {
      final data = await ref
          .read(apiClientProvider)
          .get('/inventory/batches/${lot['id']}/trace');
      if (!mounted) return;
      final batch = data['batch'] as Json? ?? const <String, dynamic>{};
      final movements = listOf(data['movements']);
      final customers = listOf(data['customers']);
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(
            _t(
              'تتبع الدفعة ${text(batch, 'batchNumber')}',
              'Trace lot ${text(batch, 'batchNumber')}',
            ),
          ),
          content: SizedBox(
            width: 620,
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _t(
                      'وصلت من ${text(batch, 'sourceNumber', fallback: '—')} — المتبقي '
                      '${text(batch, 'remainingQuantity')}',
                      'Came from ${text(batch, 'sourceNumber', fallback: '—')} — remaining '
                      '${text(batch, 'remainingQuantity')}',
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  ...movements.map(
                    (row) => ListTile(
                      dense: true,
                      leading: Icon(
                        text(row, 'direction') == 'IN'
                            ? Icons.south_west_rounded
                            : Icons.north_east_rounded,
                        size: 18,
                      ),
                      title: Text(
                        '${text(row, 'referenceType')} ${text(row, 'referenceNumber')}',
                      ),
                      subtitle: Text(_day(row['movementDate'])),
                      trailing: Text(text(row, 'quantity')),
                    ),
                  ),
                  if (customers.isNotEmpty) ...[
                    const Divider(),
                    Text(
                      _t('وصلت إلى', 'Went to'),
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    ...customers.map(
                      (row) => ListTile(
                        dense: true,
                        leading: const Icon(Icons.person_outline, size: 18),
                        title: Text(text(row, 'customerName', fallback: '—')),
                        subtitle: Text(text(row, 'invoiceNumber')),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(_t('إغلاق', 'Close')),
            ),
          ],
        ),
      );
    } catch (error) {
      _say('$error');
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              SizedBox(
                width: 260,
                child: TextField(
                  decoration: InputDecoration(
                    prefixIcon: const Icon(Icons.search_rounded, size: 18),
                    hintText: _t('رقم الدفعة أو الصنف', 'Lot or item'),
                    isDense: true,
                  ),
                  onChanged: (value) => setState(() => _query = value.trim()),
                ),
              ),
              DropdownButton<String>(
                value: _status,
                items: [
                  DropdownMenuItem(value: 'OPEN', child: Text(_t('المفتوحة', 'Open'))),
                  DropdownMenuItem(
                    value: 'CLOSED',
                    child: Text(_t('المستهلكة', 'Used up')),
                  ),
                  DropdownMenuItem(
                    value: 'WRITTEN_OFF',
                    child: Text(_t('المعدومة', 'Written off')),
                  ),
                  DropdownMenuItem(value: '', child: Text(_t('الكل', 'All'))),
                ],
                onChanged: (value) => setState(() {
                  _status = value ?? '';
                  _future = _load();
                }),
              ),
              IconButton(
                tooltip: _t('تحديث', 'Refresh'),
                onPressed: _busy ? null : _refresh,
                icon: const Icon(Icons.refresh_rounded, size: 18),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Expanded(
            child: FutureBuilder<List<Json>>(
              future: _future,
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return Center(
                    child: Text(
                      _t(
                        'تعذر تحميل الدفعات: ${snapshot.error}',
                        'The lots could not be loaded: ${snapshot.error}',
                      ),
                      style: theme.textTheme.bodyMedium,
                    ),
                  );
                }
                final needle = _query.toLowerCase();
                final lots = (snapshot.data ?? const <Json>[])
                    .where((lot) => needle.isEmpty || _searchText(lot).contains(needle))
                    .toList(growable: false);
                if (lots.isEmpty) {
                  return Center(
                    child: Text(
                      _t(
                        'لا توجد دفعات بعد. تُنشأ الدفعة عند استلام البضاعة.',
                        'No lots yet. A lot is created when goods are received.',
                      ),
                    ),
                  );
                }
                return RecordsTable(
                  rows: lots,
                  columns: [
                    ColumnSpec(
                      _t('الدفعة', 'Lot'),
                      value: (row) => text(row, 'batchNumber'),
                      emphasise: true,
                      flex: 2,
                    ),
                    ColumnSpec(
                      _t('الصنف', 'Item'),
                      value: (row) => _arabic
                          ? text(row['item'] as Json? ?? const <String, dynamic>{}, 'nameAr')
                          : text(row['item'] as Json? ?? const <String, dynamic>{}, 'nameEn'),
                      flex: 3,
                    ),
                    ColumnSpec(
                      _t('المخزن', 'Warehouse'),
                      value: (row) => _arabic
                          ? text(row['warehouse'] as Json? ?? const <String, dynamic>{}, 'nameAr')
                          : text(row['warehouse'] as Json? ?? const <String, dynamic>{}, 'nameEn'),
                      flex: 2,
                    ),
                    ColumnSpec(
                      _t('الإنتاج', 'Made'),
                      value: (row) => _day(row['productionDate']),
                    ),
                    ColumnSpec(
                      _t('الصلاحية', 'Expires'),
                      value: (row) => _day(row['expiryDate']),
                    ),
                    ColumnSpec(
                      _t('الحالة', 'Band'),
                      value: (row) => text(row, 'band'),
                      leading: (row) =>
                          _bandPill(context, text(row, 'band'), _arabic),
                      flex: 2,
                    ),
                    ColumnSpec(
                      _t('المتبقي', 'Remaining'),
                      value: (row) => text(row, 'remainingQuantity'),
                      numeric: true,
                    ),
                    ColumnSpec(
                      _t('التكلفة', 'Cost'),
                      value: (row) => text(row, 'unitCost'),
                      numeric: true,
                    ),
                  ],
                  actions: (row) => [
                    IconButton(
                      tooltip: _t('تتبع', 'Trace'),
                      onPressed: () => _trace(row),
                      icon: const Icon(Icons.timeline_rounded, size: 18),
                    ),
                    if (_can('inventory.batches.writeoff') &&
                        (double.tryParse(text(row, 'remainingQuantity')) ?? 0) > 0)
                      IconButton(
                        tooltip: _t('إعدام', 'Write off'),
                        onPressed: _busy ? null : () => _writeOff(row),
                        icon: const Icon(Icons.delete_sweep_outlined, size: 18),
                      ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  String _searchText(Json lot) => [
        text(lot, 'batchNumber'),
        text(lot['item'] as Json? ?? const <String, dynamic>{}, 'code'),
        text(lot['item'] as Json? ?? const <String, dynamic>{}, 'nameAr'),
        text(lot['item'] as Json? ?? const <String, dynamic>{}, 'nameEn'),
      ].join(' ').toLowerCase();
}

// ──────────────────────────────────────────────────────── the expiry report

class _ExpiryReportTab extends ConsumerStatefulWidget {
  const _ExpiryReportTab();

  @override
  ConsumerState<_ExpiryReportTab> createState() => _ExpiryReportTabState();
}

class _ExpiryReportTabState extends ConsumerState<_ExpiryReportTab> {
  Future<Json>? _future;
  String _band = 'EXPIRED';

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _arabic ? ar : en;

  static const _bands = ['EXPIRED', 'TODAY', 'IN_7', 'IN_30', 'IN_60', 'IN_90'];

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<Json> _load() async {
    return ref.read(apiClientProvider).get(
      '/inventory/batches/expiry-report',
      query: {'band': _band, 'days': '7,30,60,90'},
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return FutureBuilder<Json>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (!snapshot.hasData) {
          return Center(
            child: Text(
              _t(
                'تعذر تحميل التقرير: ${snapshot.error}',
                'The report could not be loaded: ${snapshot.error}',
              ),
            ),
          );
        }
        final report = snapshot.data!;
        final buckets = (report['buckets'] as Map<String, dynamic>?) ??
            const <String, dynamic>{};
        final items = listOf(report['items']);
        return Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Wrap(
                spacing: AppSpacing.sm,
                runSpacing: AppSpacing.sm,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.md,
                      vertical: AppSpacing.sm,
                    ),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.errorContainer.withValues(alpha: 0.55),
                      borderRadius: BorderRadius.circular(AppRadii.md),
                    ),
                    child: Text(
                      _t(
                        'قيمة معرضة للخطر: ${amount(report, 'atRisk')}',
                        'Value at risk: ${amount(report, 'atRisk')}',
                      ),
                      style: theme.textTheme.titleSmall?.copyWith(
                        color: theme.colorScheme.onErrorContainer,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  for (final band in _bands)
                    ChoiceChip(
                      label: Text(
                        '${_arabic ? _Band.of(band).ar : _Band.of(band).en} '
                        '(${(buckets[band] as Json?)?['count'] ?? 0})',
                      ),
                      selected: _band == band,
                      onSelected: (_) => setState(() {
                        _band = band;
                        _future = _load();
                      }),
                    ),
                ],
              ),
              const SizedBox(height: AppSpacing.md),
              Expanded(
                child: items.isEmpty
                    ? Center(
                        child: Text(
                          _t('لا توجد دفعات في هذه الفئة', 'No lots in this band'),
                          style: theme.textTheme.bodyMedium,
                        ),
                      )
                    : RecordsTable(
                        rows: items,
                        columns: [
                          ColumnSpec(
                            _t('الدفعة', 'Lot'),
                            value: (row) => text(row, 'batchNumber'),
                            emphasise: true,
                            flex: 2,
                          ),
                          ColumnSpec(
                            _t('الصنف', 'Item'),
                            value: (row) => _arabic
                                ? text(row, 'itemNameAr')
                                : text(row, 'itemNameEn'),
                            flex: 3,
                          ),
                          ColumnSpec(
                            _t('المخزن', 'Warehouse'),
                            value: (row) => _arabic
                                ? text(row, 'warehouseNameAr')
                                : text(row, 'warehouseNameEn'),
                            flex: 2,
                          ),
                          ColumnSpec(
                            _t('الصلاحية', 'Expires'),
                            value: (row) => _day(row['expiryDate']),
                          ),
                          ColumnSpec(
                            _t('الأيام', 'Days'),
                            value: (row) => asString(row['daysToExpiry']),
                            numeric: true,
                          ),
                          ColumnSpec(
                            _t('الكمية', 'Quantity'),
                            value: (row) => text(row, 'quantity'),
                            numeric: true,
                          ),
                          ColumnSpec(
                            _t('القيمة', 'Value'),
                            value: (row) => text(row, 'value'),
                            numeric: true,
                          ),
                        ],
                      ),
              ),
            ],
          ),
        );
      },
    );
  }
}
