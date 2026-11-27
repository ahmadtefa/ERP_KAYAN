import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme/design_tokens.dart';
import '../../../core/json/amount_format.dart';
import '../../../core/json/json_utils.dart';
import '../../../shared/widgets/form_sheet.dart';
import '../../../shared/widgets/records_table.dart';
import '../../../shared/widgets/state_views.dart';
import '../../auth/presentation/providers/auth_providers.dart';
import '../../common/presentation/providers/resource_providers.dart';
import '../../common/presentation/screens/module_scaffold.dart';

/// Withholding tax: the rates a company sets up, and what was withheld.
///
/// Tax withheld from a supplier is owed to the tax authority; tax a customer
/// withheld from us is a claim on it. Each rate names its own ledger account.
final withholdingRatesProvider =
    AsyncNotifierProvider<WithholdingRatesController, List<Json>>(WithholdingRatesController.new);

class WithholdingRatesController extends JsonListController {
  @override
  String get resourcePath => '/withholding/rates';
}

String withholdingDirectionLabel(String direction, bool arabic) => direction == 'PAYABLE'
    ? (arabic ? 'مخصومة من مورد' : 'Withheld from a supplier')
    : (arabic ? 'مخصومة من عميل لصالحنا' : 'Withheld by a customer');

class WithholdingScreen extends ConsumerStatefulWidget {
  const WithholdingScreen({super.key});

  @override
  ConsumerState<WithholdingScreen> createState() => _WithholdingScreenState();
}

class _WithholdingScreenState extends ConsumerState<WithholdingScreen> {
  bool _report = false;
  late String _from;
  late String _to;
  String _direction = 'ALL';
  Future<List<Json>>? _reportRows;

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    String d(DateTime t) => t.toIso8601String().substring(0, 10);
    _from = d(DateTime(now.year, now.month, 1));
    _to = d(now);
  }

  void _loadReport() {
    setState(() {
      _reportRows = ref.read(apiClientProvider).getList(
        '/withholding/report',
        query: {'from': _from, 'to': _to, if (_direction != 'ALL') 'direction': _direction},
      );
    });
  }

  String _party(Json r) => _arabic
      ? text(r, 'partyAr', fallback: text(r, 'partyEn'))
      : text(r, 'partyEn', fallback: text(r, 'partyAr'));

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final canManage = user?.can('withholding.manage') ?? false;
    return ModuleScaffold(
      title: _arabic ? 'ضريبة الخصم والإضافة' : 'Withholding tax',
      eyebrow: _arabic ? 'الخزينة والبنوك' : 'Cash and banks',
      trailing: Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          ChoiceChip(
            key: const ValueKey('withholding-view-rates'),
            label: Text(_arabic ? 'النسب' : 'Rates'),
            selected: !_report,
            onSelected: (_) => setState(() => _report = false),
          ),
          ChoiceChip(
            key: const ValueKey('withholding-view-report'),
            label: Text(_arabic ? 'التقرير' : 'Report'),
            selected: _report,
            onSelected: (_) {
              setState(() => _report = true);
              if (_reportRows == null) _loadReport();
            },
          ),
          if (!_report && canManage)
            FilledButton.icon(
              onPressed: _newRate,
              icon: const Icon(Icons.add, size: 18),
              label: Text(_arabic ? 'نسبة جديدة' : 'New rate'),
            ),
        ],
      ),
      body: _report ? _reportView() : _ratesView(canManage),
    );
  }

  Widget _ratesView(bool canManage) {
    final async = ref.watch(withholdingRatesProvider);
    return AsyncStateView<List<Json>>(
      value: async,
      onRetry: () => ref.read(withholdingRatesProvider.notifier).reload(),
      isEmpty: (rows) => rows.isEmpty,
      emptyMessage: _arabic
          ? (canManage ? 'لا توجد نسب. اضغط «نسبة جديدة» لإضافة أول نسبة.' : 'لا توجد نسب.')
          : (canManage ? 'No rates yet. Use "New rate" to add the first one.' : 'No rates.'),
      data: (rows) => RecordsTable(
        rows: rows,
        columns: [
          ColumnSpec(_arabic ? 'الكود' : 'Code', value: (r) => text(r, 'code'), emphasise: true),
          ColumnSpec(
            _arabic ? 'الاسم' : 'Name',
            value: (r) => _arabic ? text(r, 'nameAr', fallback: text(r, 'nameEn')) : text(r, 'nameEn', fallback: text(r, 'nameAr')),
          ),
          ColumnSpec(_arabic ? 'النوع' : 'Kind', value: (r) => withholdingDirectionLabel(text(r, 'direction'), _arabic)),
          ColumnSpec(_arabic ? 'النسبة %' : 'Rate %', numeric: true, value: (r) => formatAmount(asString(r['ratePercent']))),
          ColumnSpec(_arabic ? 'الحساب' : 'Account', value: (r) => '${text(r, 'accountCode')} ${_arabic ? text(r, 'accountNameAr') : text(r, 'accountNameEn')}'),
          ColumnSpec(
            _arabic ? 'الحالة' : 'Status',
            value: (r) => r['isActive'] == false ? (_arabic ? 'موقوفة' : 'Off') : (_arabic ? 'فعالة' : 'Active'),
            tone: (r) => r['isActive'] == false ? AppTone.neutral : AppTone.success,
          ),
        ],
        actions: (row) => canManage
            ? [
                IconButton(
                  key: ValueKey('withholding-toggle-${text(row, 'id')}'),
                  tooltip: row['isActive'] == false ? (_arabic ? 'تفعيل' : 'Turn on') : (_arabic ? 'إيقاف' : 'Turn off'),
                  icon: Icon(row['isActive'] == false ? Icons.toggle_off_outlined : Icons.toggle_on_outlined),
                  onPressed: () => _toggle(row),
                ),
              ]
            : const [],
      ),
    );
  }

  Future<void> _toggle(Json row) async {
    try {
      await ref.read(apiClientProvider).patch('/withholding/rates/${text(row, 'id')}', body: {'isActive': row['isActive'] == false});
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
    } finally {
      if (mounted) await ref.read(withholdingRatesProvider.notifier).refreshQuietly();
    }
  }

  Future<void> _newRate() async {
    final api = ref.read(apiClientProvider);
    List<Json> accounts;
    try {
      accounts = await api.getList('/accounting/chart-of-accounts');
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
      return;
    }
    if (!mounted) return;
    String name(Json r) => _arabic ? text(r, 'nameAr', fallback: text(r, 'nameEn')) : text(r, 'nameEn', fallback: text(r, 'nameAr'));
    List<FieldOption> options(String type) => [
      for (final a in accounts)
        if (a['isPostable'] != false && a['isActive'] != false && text(a, 'type').toUpperCase() == type)
          FieldOption(text(a, 'id'), '${text(a, 'code')} - ${name(a)}'),
    ];
    final saved = await showFormSheet(
      context,
      title: _arabic ? 'نسبة ضريبة خصم جديدة' : 'New withholding rate',
      submitLabel: _arabic ? 'حفظ' : 'Save',
      initial: const {'direction': 'PAYABLE'},
      fields: [
        FieldSpec('code', _arabic ? 'الكود' : 'Code', required: true, maxLength: 32),
        FieldSpec('nameAr', _arabic ? 'الاسم بالعربية' : 'Arabic name', required: true, maxLength: 160),
        FieldSpec('nameEn', _arabic ? 'الاسم بالإنجليزية' : 'English name', required: true, maxLength: 160),
        FieldSpec(
          'direction',
          _arabic ? 'النوع' : 'Kind',
          kind: FieldKind.select,
          required: true,
          options: [
            FieldOption('PAYABLE', withholdingDirectionLabel('PAYABLE', _arabic)),
            FieldOption('RECEIVABLE', withholdingDirectionLabel('RECEIVABLE', _arabic)),
          ],
        ),
        FieldSpec(
          'ratePercent',
          _arabic ? 'النسبة %' : 'Rate %',
          kind: FieldKind.decimal,
          required: true,
          validator: (v) {
            final n = double.tryParse(v.trim());
            return n == null || n <= 0 || n > 100
                ? (_arabic ? 'اكتب نسبة أكبر من صفر وحتى 100.' : 'Enter a rate above 0 and up to 100.')
                : null;
          },
        ),
        FieldSpec(
          'payableAccountId',
          _arabic ? 'حساب الضريبة المستحقة (التزام)' : 'Tax owed account (liability)',
          kind: FieldKind.select,
          required: true,
          searchable: true,
          options: options('LIABILITY'),
          showWhenField: 'direction',
          showWhenValues: const {'PAYABLE'},
        ),
        FieldSpec(
          'receivableAccountId',
          _arabic ? 'حساب الضريبة المدينة (أصل)' : 'Tax claim account (asset)',
          kind: FieldKind.select,
          required: true,
          searchable: true,
          options: options('ASSET'),
          showWhenField: 'direction',
          showWhenValues: const {'RECEIVABLE'},
        ),
      ],
      onSubmit: (values) async {
        final payable = text(values, 'direction') == 'PAYABLE';
        await api.post('/withholding/rates', body: {
          'code': text(values, 'code').trim(),
          'nameAr': text(values, 'nameAr').trim(),
          'nameEn': text(values, 'nameEn').trim(),
          'direction': text(values, 'direction'),
          'ratePercent': text(values, 'ratePercent').trim(),
          'accountId': text(values, payable ? 'payableAccountId' : 'receivableAccountId'),
        });
      },
    );
    if (saved != null && mounted) {
      showMessage(context, _arabic ? 'تم حفظ النسبة.' : 'The rate was saved.');
      ref.invalidate(withholdingRatesProvider);
    }
  }

  Widget _reportView() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              OutlinedButton.icon(
                key: const ValueKey('withholding-period'),
                onPressed: _pickPeriod,
                icon: const Icon(Icons.date_range_outlined, size: 18),
                label: Text('$_from  →  $_to'),
              ),
              for (final d in const ['ALL', 'PAYABLE', 'RECEIVABLE'])
                ChoiceChip(
                  key: ValueKey('withholding-direction-$d'),
                  label: Text(switch (d) {
                    'PAYABLE' => _arabic ? 'من موردين' : 'From suppliers',
                    'RECEIVABLE' => _arabic ? 'من عملاء' : 'By customers',
                    _ => _arabic ? 'الكل' : 'All',
                  }),
                  selected: _direction == d,
                  onSelected: (_) {
                    _direction = d;
                    _loadReport();
                  },
                ),
            ],
          ),
        ),
        Expanded(
          child: FutureBuilder<List<Json>>(
            future: _reportRows,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                return Center(
                  child: TextButton(
                    onPressed: _loadReport,
                    child: Text(_arabic ? 'تعذر تحميل التقرير. أعد المحاولة.' : 'The report could not load. Try again.'),
                  ),
                );
              }
              final rows = snapshot.data ?? const <Json>[];
              if (rows.isEmpty) {
                return Center(child: Text(_arabic ? 'لا توجد ضرائب مخصومة في هذه الفترة.' : 'No tax was withheld in this period.'));
              }
              return RecordsTable(
                rows: rows,
                columns: [
                  ColumnSpec(_arabic ? 'السند' : 'Voucher', value: (r) => text(r, 'voucherNumber'), emphasise: true),
                  ColumnSpec(_arabic ? 'التاريخ' : 'Date', value: (r) => text(r, 'voucherDate')),
                  ColumnSpec(_arabic ? 'الطرف' : 'Party', value: _party),
                  ColumnSpec(_arabic ? 'النوع' : 'Kind', value: (r) => withholdingDirectionLabel(text(r, 'direction'), _arabic)),
                  ColumnSpec(_arabic ? 'النسبة %' : 'Rate %', numeric: true, value: (r) => formatAmount(asString(r['ratePercent']))),
                  ColumnSpec(_arabic ? 'المبلغ الإجمالي' : 'Gross', numeric: true, value: (r) => formatAmount(asString(r['base']))),
                  ColumnSpec(_arabic ? 'الضريبة المخصومة' : 'Tax withheld', numeric: true, emphasise: true, value: (r) => formatAmount(asString(r['amount']))),
                ],
              );
            },
          ),
        ),
      ],
    );
  }

  Future<void> _pickPeriod() async {
    final values = await showFormSheet(
      context,
      title: _arabic ? 'الفترة' : 'Period',
      submitLabel: _arabic ? 'عرض' : 'Show',
      initial: {'from': _from, 'to': _to},
      fields: [
        FieldSpec('from', _arabic ? 'من' : 'From', kind: FieldKind.date, required: true),
        FieldSpec('to', _arabic ? 'إلى' : 'To', kind: FieldKind.date, required: true),
      ],
    );
    if (values == null || !mounted) return;
    final a = text(values, 'from');
    final b = text(values, 'to');
    // A reversed range is read as the same two days the other way round.
    _from = a.compareTo(b) <= 0 ? a : b;
    _to = a.compareTo(b) <= 0 ? b : a;
    _loadReport();
  }
}
