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

/// Serial numbers and warranty: each physical unit, where it is, who bought it
/// and until when it is covered. Selling assigns a unit to a posted invoice and
/// starts its warranty from the invoice date.
final serialsProvider = AsyncNotifierProvider<SerialsController, List<Json>>(SerialsController.new);

class SerialsController extends JsonListController {
  @override
  String get resourcePath => '/serials';
}

/// Which row actions a unit in [status] offers. The server decides; this only hides the rest.
List<String> serialNextActions(String status) => switch (status) {
  'IN_STOCK' => const ['scrap'],
  'SOLD' => const ['return'],
  'RETURNED' => const ['scrap'],
  _ => const [],
};

class SerialsScreen extends ConsumerStatefulWidget {
  const SerialsScreen({super.key});

  @override
  ConsumerState<SerialsScreen> createState() => _SerialsScreenState();
}

class _SerialsScreenState extends ConsumerState<SerialsScreen> {
  String _status = 'ALL';
  String _query = '';

  bool get _arabic => Localizations.localeOf(context).languageCode == 'ar';

  String _statusLabel(String s) => switch (s) {
    'IN_STOCK' => _arabic ? 'في المخزن' : 'In stock',
    'SOLD' => _arabic ? 'مباع' : 'Sold',
    'RETURNED' => _arabic ? 'مرتجع' : 'Returned',
    'SCRAPPED' => _arabic ? 'معدوم' : 'Scrapped',
    _ => s,
  };

  AppTone _tone(String s) => switch (s) {
    'SOLD' => AppTone.success,
    'SCRAPPED' => AppTone.danger,
    'RETURNED' => AppTone.warning,
    _ => AppTone.neutral,
  };

  String _warrantyLabel(Json r) {
    final w = text(r, 'warranty');
    return switch (w) {
      'ACTIVE' => _arabic
          ? 'ساري حتى ${text(r, 'warrantyEndsOn')}'
          : 'Active until ${text(r, 'warrantyEndsOn')}',
      'EXPIRED' => _arabic ? 'انتهى ${text(r, 'warrantyEndsOn')}' : 'Expired ${text(r, 'warrantyEndsOn')}',
      'NONE' => _arabic ? 'بدون ضمان' : 'No warranty',
      _ => '',
    };
  }

  String _item(Json r) => _arabic
      ? '${text(r, 'itemCode')} - ${text(r, 'itemAr', fallback: text(r, 'itemEn'))}'
      : '${text(r, 'itemCode')} - ${text(r, 'itemEn', fallback: text(r, 'itemAr'))}';

  List<Json> _visible(List<Json> rows) => [
    for (final r in rows)
      if ((_status == 'ALL' || text(r, 'status') == _status) &&
          (_query.isEmpty || text(r, 'serialNumber').toLowerCase().contains(_query.toLowerCase())))
        r,
  ];

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(serialsProvider);
    final user = ref.watch(currentUserProvider);
    final canManage = user?.can('serials.manage') ?? false;
    return ModuleScaffold(
      title: _arabic ? 'الأرقام التسلسلية والضمان' : 'Serial numbers and warranty',
      eyebrow: _arabic ? 'المخزون' : 'Inventory',
      trailing: Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          if (canManage)
            FilledButton.icon(
              onPressed: _register,
              icon: const Icon(Icons.add, size: 18),
              label: Text(_arabic ? 'تسجيل أرقام' : 'Register serials'),
            ),
          if (canManage)
            OutlinedButton.icon(
              onPressed: _sell,
              icon: const Icon(Icons.sell_outlined, size: 18),
              label: Text(_arabic ? 'ربط بفاتورة بيع' : 'Assign to a sale'),
            ),
          SearchField(
            hint: _arabic ? 'بحث بالرقم التسلسلي' : 'Search a serial number',
            onChanged: (v) => setState(() => _query = v.trim()),
          ),
          IconButton(
            tooltip: _arabic ? 'تحديث' : 'Refresh',
            icon: const Icon(Icons.refresh),
            onPressed: async.isLoading ? null : () => ref.read(serialsProvider.notifier).reload(),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final s in const ['ALL', 'IN_STOCK', 'SOLD', 'RETURNED', 'SCRAPPED'])
                  ChoiceChip(
                    key: ValueKey('serial-status-$s'),
                    label: Text(s == 'ALL' ? (_arabic ? 'الكل' : 'All') : _statusLabel(s)),
                    selected: _status == s,
                    onSelected: (_) => setState(() => _status = s),
                  ),
              ],
            ),
          ),
          Expanded(
            child: AsyncStateView<List<Json>>(
              value: async,
              onRetry: () => ref.read(serialsProvider.notifier).reload(),
              isEmpty: (rows) => _visible(rows).isEmpty,
              emptyMessage: _arabic
                  ? (canManage ? 'لا توجد أرقام تسلسلية. اضغط «تسجيل أرقام» لإضافتها.' : 'لا توجد أرقام تسلسلية.')
                  : (canManage ? 'No serial numbers yet. Use "Register serials" to add them.' : 'No serial numbers.'),
              data: (rows) => RecordsTable(
                rows: _visible(rows),
                columns: [
                  ColumnSpec(_arabic ? 'الرقم التسلسلي' : 'Serial', value: (r) => text(r, 'serialNumber'), emphasise: true),
                  ColumnSpec(_arabic ? 'الصنف' : 'Item', value: _item),
                  ColumnSpec(
                    _arabic ? 'الحالة' : 'Status',
                    value: (r) => _statusLabel(text(r, 'status')),
                    tone: (r) => _tone(text(r, 'status')),
                  ),
                  ColumnSpec(_arabic ? 'الفاتورة' : 'Invoice', value: (r) => text(r, 'invoiceNumber')),
                  ColumnSpec(
                    _arabic ? 'العميل' : 'Customer',
                    value: (r) => _arabic ? text(r, 'customerAr', fallback: text(r, 'customerEn')) : text(r, 'customerEn', fallback: text(r, 'customerAr')),
                  ),
                  ColumnSpec(
                    _arabic ? 'الضمان' : 'Warranty',
                    value: _warrantyLabel,
                    tone: (r) => switch (text(r, 'warranty')) {
                      'ACTIVE' => AppTone.success,
                      'EXPIRED' => AppTone.danger,
                      _ => AppTone.neutral,
                    },
                  ),
                ],
                actions: (row) => [
                  IconButton(
                    key: ValueKey('serial-history-${text(row, 'id')}'),
                    tooltip: _arabic ? 'سجل الرقم' : 'History',
                    icon: const Icon(Icons.history, size: 20),
                    onPressed: () => _history(row),
                  ),
                  if (canManage)
                    for (final a in serialNextActions(text(row, 'status')))
                      IconButton(
                        key: ValueKey('serial-$a-${text(row, 'id')}'),
                        tooltip: a == 'return' ? (_arabic ? 'مرتجع من العميل' : 'Customer return') : (_arabic ? 'إعدام' : 'Scrap'),
                        icon: Icon(a == 'return' ? Icons.undo_outlined : Icons.delete_outline, size: 20),
                        onPressed: () => _act(row, a),
                      ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _history(Json row) async {
    try {
      final res = await ref.read(apiClientProvider).getObject('/serials/lookup', query: {'serial': text(row, 'serialNumber')});
      final items = res['items'];
      final mine = items is List
          ? items.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).firstWhere((m) => text(m, 'id') == text(row, 'id'), orElse: () => <String, dynamic>{})
          : <String, dynamic>{};
      final events = mine['events'] is List ? (mine['events'] as List).whereType<Map>().toList() : const [];
      if (!mounted) return;
      String actionLabel(String a) => switch (a) {
        'register' => _arabic ? 'تسجيل' : 'Registered',
        'sell' => _arabic ? 'بيع' : 'Sold',
        'return' => _arabic ? 'مرتجع' : 'Returned',
        'scrap' => _arabic ? 'إعدام' : 'Scrapped',
        _ => a,
      };
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(text(row, 'serialNumber')),
          content: SizedBox(
            width: 420,
            child: ListView(
              shrinkWrap: true,
              children: [
                Text(_item(row)),
                if (_warrantyLabel(row).isNotEmpty) Text('${_arabic ? 'الضمان' : 'Warranty'}: ${_warrantyLabel(row)}'),
                const Divider(),
                for (final e in events)
                  ListTile(
                    dense: true,
                    title: Text(actionLabel(asString(e['action']) ?? '')),
                    subtitle: Text([
                      (asString(e['at']) ?? '').split('T').first,
                      if ((asString(e['invoiceNumber']) ?? '').isNotEmpty) asString(e['invoiceNumber']) ?? '',
                      if ((asString(e['note']) ?? '').isNotEmpty) asString(e['note']) ?? '',
                    ].join('  -  ')),
                  ),
              ],
            ),
          ),
          actions: [TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: Text(_arabic ? 'إغلاق' : 'Close'))],
        ),
      );
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
    }
  }

  Future<void> _act(Json row, String action) async {
    final values = await showFormSheet(
      context,
      title: action == 'return' ? (_arabic ? 'مرتجع من العميل' : 'Customer return') : (_arabic ? 'إعدام الوحدة' : 'Scrap the unit'),
      submitLabel: _arabic ? 'تأكيد' : 'Confirm',
      fields: [
        FieldSpec('note', _arabic ? 'السبب' : 'Reason', required: true, kind: FieldKind.multiline, maxLines: 2, maxLength: 500),
      ],
      onSubmit: (values) async {
        await ref.read(apiClientProvider).post('/serials/${text(row, 'id')}/$action', body: {'note': text(values, 'note').trim()});
      },
    );
    if (values != null && mounted) {
      showMessage(context, _arabic ? 'تم' : 'Done');
      ref.invalidate(serialsProvider);
    }
  }

  Future<List<FieldOption>> _itemOptions() async {
    final items = await ref.read(apiClientProvider).getList('/inventory/items', query: {'pageSize': 200, 'page': 1});
    return [
      for (final i in items)
        if (i['isActive'] != false)
          FieldOption(
            text(i, 'id'),
            '${text(i, 'code')} - ${_arabic ? text(i, 'nameAr', fallback: text(i, 'nameEn')) : text(i, 'nameEn', fallback: text(i, 'nameAr'))}',
          ),
    ];
  }

  Future<void> _register() async {
    List<FieldOption> items;
    List<Json> warehouses;
    try {
      items = await _itemOptions();
      warehouses = await ref.read(apiClientProvider).getList('/inventory/warehouses');
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
      return;
    }
    if (!mounted) return;
    final saved = await showFormSheet(
      context,
      title: _arabic ? 'تسجيل أرقام تسلسلية' : 'Register serial numbers',
      submitLabel: _arabic ? 'حفظ' : 'Save',
      fields: [
        FieldSpec('itemId', _arabic ? 'الصنف' : 'Item', kind: FieldKind.select, required: true, searchable: true, options: items),
        FieldSpec(
          'warehouseId',
          _arabic ? 'المخزن' : 'Warehouse',
          kind: FieldKind.select,
          nullWhenEmpty: true,
          clearable: true,
          options: [
            for (final w in warehouses)
              if (w['isActive'] != false && w['deletedAt'] == null)
                FieldOption(text(w, 'id'), '${text(w, 'code')} - ${_arabic ? text(w, 'nameAr', fallback: text(w, 'nameEn')) : text(w, 'nameEn', fallback: text(w, 'nameAr'))}'),
          ],
        ),
        FieldSpec(
          'serials',
          _arabic ? 'الأرقام التسلسلية' : 'Serial numbers',
          kind: FieldKind.multiline,
          maxLines: 6,
          required: true,
          helper: _arabic
              ? 'رقم في كل سطر، أو افصل بينها بفاصلة. بدون مسافات داخل الرقم. إن تكرر رقم واحد لا يُحفظ شيء.'
              : 'One per line, or separated by commas. No spaces inside a number. If one repeats, nothing is saved.',
        ),
        FieldSpec(
          'warrantyMonths',
          _arabic ? 'مدة الضمان بالشهور' : 'Warranty in months',
          kind: FieldKind.integer,
          minInteger: 0,
          maxInteger: 240,
          nullWhenEmpty: true,
          helper: _arabic ? 'يبدأ الضمان من تاريخ فاتورة البيع. اتركه فارغًا لبدون ضمان.' : 'The warranty starts on the sales invoice date. Leave empty for none.',
        ),
      ],
      onSubmit: (values) async {
        await ref.read(apiClientProvider).post('/serials/register', body: {
          'itemId': text(values, 'itemId'),
          if (values['warehouseId'] != null) 'warehouseId': text(values, 'warehouseId'),
          'serials': text(values, 'serials'),
          if (values['warrantyMonths'] != null) 'warrantyMonths': text(values, 'warrantyMonths'),
        });
      },
    );
    if (saved != null && mounted) {
      showMessage(context, _arabic ? 'تم تسجيل الأرقام.' : 'The serial numbers were registered.');
      ref.invalidate(serialsProvider);
    }
  }

  Future<void> _sell() async {
    List<FieldOption> items;
    List<Json> invoices;
    try {
      items = await _itemOptions();
      invoices = await ref.read(apiClientProvider).getList('/sales/invoices');
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
      return;
    }
    if (!mounted) return;
    final saved = await showFormSheet(
      context,
      title: _arabic ? 'ربط أرقام بفاتورة بيع' : 'Assign serial numbers to a sale',
      submitLabel: _arabic ? 'ربط' : 'Assign',
      fields: [
        FieldSpec(
          'salesInvoiceId',
          _arabic ? 'فاتورة البيع (مرحّلة)' : 'Sales invoice (posted)',
          kind: FieldKind.select,
          required: true,
          searchable: true,
          options: [
            for (final i in invoices)
              if (text(i, 'status').toUpperCase() == 'POSTED')
                FieldOption(text(i, 'id'), '${text(i, 'invoiceNumber')}  ${text(i, 'invoiceDate')}'),
          ],
        ),
        FieldSpec('itemId', _arabic ? 'الصنف' : 'Item', kind: FieldKind.select, required: true, searchable: true, options: items),
        FieldSpec(
          'serials',
          _arabic ? 'الأرقام التسلسلية المباعة' : 'Serial numbers sold',
          kind: FieldKind.multiline,
          maxLines: 4,
          required: true,
          helper: _arabic
              ? 'لا يزيد عددها عن الكمية المباعة في الفاتورة. يبدأ الضمان من تاريخ الفاتورة.'
              : 'No more than the quantity on the invoice. The warranty starts on the invoice date.',
        ),
      ],
      onSubmit: (values) async {
        await ref.read(apiClientProvider).post('/serials/sell', body: {
          'salesInvoiceId': text(values, 'salesInvoiceId'),
          'itemId': text(values, 'itemId'),
          'serials': text(values, 'serials'),
        });
      },
    );
    if (saved != null && mounted) {
      showMessage(context, _arabic ? 'تم ربط الأرقام بالفاتورة وبدأ الضمان.' : 'The serial numbers were assigned and the warranty has started.');
      ref.invalidate(serialsProvider);
    }
  }
}
