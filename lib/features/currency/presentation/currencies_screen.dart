import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme/design_tokens.dart';
import '../../../core/json/json_utils.dart';
import '../../../shared/widgets/form_sheet.dart';
import '../../../shared/widgets/records_table.dart';
import '../../../shared/widgets/state_views.dart';
import '../../auth/presentation/providers/auth_providers.dart';
import '../../common/presentation/providers/resource_providers.dart';
import '../../common/presentation/screens/module_scaffold.dart';

/// Foreign currencies and the exchange rates the company enters by hand.
/// No rate is ever fetched or guessed: the accountant types each one.
final currenciesProvider = AsyncNotifierProvider<CurrenciesController, List<Json>>(CurrenciesController.new);

class CurrenciesController extends JsonListController {
  @override
  String get resourcePath => '/currencies';
}

class CurrenciesScreen extends ConsumerStatefulWidget {
  const CurrenciesScreen({super.key});

  @override
  ConsumerState<CurrenciesScreen> createState() => _CurrenciesScreenState();
}

class _CurrenciesScreenState extends ConsumerState<CurrenciesScreen> {
  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(currentUserProvider);
    final canManage = user?.can('currency.manage') ?? false;
    final canRates = user?.can('currency.rates.manage') ?? false;
    final async = ref.watch(currenciesProvider);
    return ModuleScaffold(
      title: _arabic ? 'العملات وأسعار الصرف' : 'Currencies and exchange rates',
      eyebrow: _arabic ? 'المحاسبة' : 'Accounting',
      trailing: Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          if (canManage)
            FilledButton.icon(
              onPressed: () => _currencyForm(null),
              icon: const Icon(Icons.add, size: 18),
              label: Text(_arabic ? 'عملة جديدة' : 'New currency'),
            ),
          IconButton(tooltip: _arabic ? 'تحديث' : 'Refresh', icon: const Icon(Icons.refresh), onPressed: () => ref.invalidate(currenciesProvider)),
        ],
      ),
      body: AsyncStateView<List<Json>>(
        value: async,
        onRetry: () => ref.read(currenciesProvider.notifier).reload(),
        isEmpty: (rows) => rows.isEmpty,
        emptyMessage: _arabic ? 'لم تُضف عملات أجنبية بعد. أضف العملة ثم اكتب سعر صرفها.' : 'No foreign currencies yet. Add a currency, then enter its exchange rate.',
        data: (rows) => RecordsTable(
          rows: rows,
          columns: [
            ColumnSpec(_arabic ? 'الرمز' : 'Code', value: (r) => text(r, 'code'), emphasise: true),
            ColumnSpec(_arabic ? 'الاسم' : 'Name', value: (r) => _arabic ? text(r, 'nameAr', fallback: text(r, 'nameEn')) : text(r, 'nameEn', fallback: text(r, 'nameAr'))),
            ColumnSpec(_arabic ? 'آخر سعر' : 'Latest rate', value: (r) => text(r, 'latestRate', fallback: '-')),
            ColumnSpec(_arabic ? 'بتاريخ' : 'As of', value: (r) => text(r, 'latestRateDate', fallback: '-')),
            ColumnSpec(
              _arabic ? 'الحالة' : 'Status',
              value: (r) => r['isActive'] == false ? (_arabic ? 'متوقفة' : 'Switched off') : (_arabic ? 'تعمل' : 'Active'),
              tone: (r) => r['isActive'] == false ? AppTone.neutral : AppTone.success,
            ),
          ],
          actions: (row) => [
            if (canRates)
              IconButton(
                key: ValueKey('currency-rate-${text(row, 'code')}'),
                tooltip: _arabic ? 'كتابة سعر صرف' : 'Enter a rate',
                icon: const Icon(Icons.currency_exchange, size: 20),
                onPressed: () => _rateForm(row),
              ),
            IconButton(
              key: ValueKey('currency-history-${text(row, 'code')}'),
              tooltip: _arabic ? 'سجل الأسعار' : 'Rate history',
              icon: const Icon(Icons.history, size: 20),
              onPressed: () => _history(row),
            ),
            if (canManage)
              IconButton(
                key: ValueKey('currency-edit-${text(row, 'code')}'),
                tooltip: _arabic ? 'تعديل' : 'Edit',
                icon: const Icon(Icons.edit_outlined, size: 20),
                onPressed: () => _currencyForm(row),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _currencyForm(Json? row) async {
    final editing = row != null;
    final saved = await showFormSheet(
      context,
      title: editing ? (_arabic ? 'تعديل العملة' : 'Edit the currency') : (_arabic ? 'عملة جديدة' : 'New currency'),
      submitLabel: _arabic ? 'حفظ' : 'Save',
      initial: row == null
          ? const <String, dynamic>{'isActive': true}
          : <String, dynamic>{'nameAr': text(row, 'nameAr'), 'nameEn': text(row, 'nameEn'), 'symbol': text(row, 'symbol'), 'isActive': row['isActive'] != false},
      fields: [
        if (!editing) FieldSpec('code', _arabic ? 'رمز العملة (ثلاثة أحرف، مثل USD)' : 'Currency code (three letters, like USD)', required: true, maxLength: 3, minLength: 3, section: _arabic ? 'بيانات العملة' : 'Currency details'),
        FieldSpec('nameAr', _arabic ? 'الاسم بالعربية' : 'Name in Arabic', required: true, maxLength: 60),
        FieldSpec('nameEn', _arabic ? 'الاسم بالإنجليزية' : 'Name in English', required: true, maxLength: 60),
        FieldSpec('symbol', _arabic ? 'الرمز المختصر' : 'Symbol', maxLength: 6),
        if (editing) FieldSpec('isActive', _arabic ? 'تعمل' : 'Active', kind: FieldKind.toggle),
      ],
      onSubmit: (values) async {
        final body = <String, dynamic>{
          if (!editing) 'code': text(values, 'code').trim().toUpperCase(),
          'nameAr': text(values, 'nameAr').trim(),
          'nameEn': text(values, 'nameEn').trim(),
          'symbol': text(values, 'symbol').trim(),
          if (editing) 'isActive': values['isActive'] == true,
        };
        final api = ref.read(apiClientProvider);
        if (row != null) {
          await api.patch('/currencies/${text(row, 'code')}', body: body);
        } else {
          await api.post('/currencies', body: body);
        }
      },
    );
    if (saved != null && mounted) {
      showMessage(context, _arabic ? 'تم الحفظ.' : 'Saved.');
      ref.invalidate(currenciesProvider);
    }
  }

  Future<void> _rateForm(Json row) async {
    final today = DateTime.now();
    final saved = await showFormSheet(
      context,
      title: _arabic ? 'سعر صرف ${text(row, 'code')}' : 'Exchange rate of ${text(row, 'code')}',
      submitLabel: _arabic ? 'حفظ السعر' : 'Save the rate',
      initial: {'rateDate': '${today.year}-${today.month.toString().padLeft(2, '0')}-${today.day.toString().padLeft(2, '0')}'},
      fields: [
        FieldSpec('rateDate', _arabic ? 'التاريخ' : 'Date', kind: FieldKind.date, required: true, section: _arabic ? 'سعر الصرف' : 'Exchange rate'),
        FieldSpec(
          'rate',
          _arabic ? 'عدد الجنيهات للوحدة الواحدة' : 'Pounds for one unit',
          kind: FieldKind.decimal,
          required: true,
          helper: _arabic ? 'اكتب السعر كما تريد استخدامه. لا يُجلب سعر تلقائيًا. سعر نفس اليوم يُستبدل.' : 'Type the rate you want to use. No rate is fetched automatically. A rate for the same day is replaced.',
        ),
        FieldSpec('note', _arabic ? 'ملاحظة (المصدر مثلًا)' : 'Note (the source, for example)', maxLength: 200),
      ],
      onSubmit: (values) async {
        await ref.read(apiClientProvider).post('/currencies/${text(row, 'code')}/rates', body: {
          'rateDate': text(values, 'rateDate'),
          'rate': text(values, 'rate').trim(),
          if (text(values, 'note').trim().isNotEmpty) 'note': text(values, 'note').trim(),
        });
      },
    );
    if (saved != null && mounted) {
      showMessage(context, _arabic ? 'تم حفظ السعر.' : 'The rate was saved.');
      ref.invalidate(currenciesProvider);
    }
  }

  Future<void> _history(Json row) async {
    List<Json> rates;
    try {
      rates = await ref.read(apiClientProvider).getList('/currencies/${text(row, 'code')}/rates');
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
      return;
    }
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_arabic ? 'أسعار ${text(row, 'code')}' : 'Rates of ${text(row, 'code')}'),
        content: SizedBox(
          width: 420,
          height: 360,
          child: rates.isEmpty
              ? Center(child: Text(_arabic ? 'لم يُكتب سعر بعد.' : 'No rate has been entered yet.'))
              : ListView(
                  children: [
                    for (final r in rates)
                      ListTile(dense: true, title: Text(text(r, 'rateDate')), trailing: Text(text(r, 'rate')), subtitle: text(r, 'note').isEmpty ? null : Text(text(r, 'note'))),
                  ],
                ),
        ),
        actions: [TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: Text(_arabic ? 'إغلاق' : 'Close'))],
      ),
    );
  }
}
