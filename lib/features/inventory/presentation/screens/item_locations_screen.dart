import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/json/amount_format.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/json/json_utils.dart';
import '../../../../shared/widgets/state_views.dart';
import '../../../common/presentation/screens/module_scaffold.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

/// Quantities are read from movement-backed location balances, never inferred
/// from a lot's single legacy location label.
class ItemLocationsScreen extends ConsumerStatefulWidget {
  const ItemLocationsScreen({
    super.key,
    required this.itemId,
    required this.itemName,
  });
  final String itemId;
  final String itemName;
  @override
  ConsumerState<ItemLocationsScreen> createState() =>
      _ItemLocationsScreenState();
}

class _ItemLocationsScreenState extends ConsumerState<ItemLocationsScreen> {
  AsyncValue<Json> _data = const AsyncLoading();
  bool get _ar => Localizations.localeOf(context).languageCode == 'ar';
  String _t(String ar, String en) => _ar ? ar : en;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _data = const AsyncLoading());
    try {
      final result = await ref
          .read(apiClientProvider)
          .getObject('/inventory/locations/item/${widget.itemId}');
      if (mounted) setState(() => _data = AsyncData(result));
    } catch (error, stack) {
      if (mounted) setState(() => _data = AsyncError(error, stack));
    }
  }

  Future<void> _relocate(
    Json warehouse,
    Json source,
    Json lot, {
    required bool assign,
  }) async {
    final api = ref.read(apiClientProvider);
    final warehouseId = text(warehouse, 'warehouseId');
    List<Json> choices;
    try {
      choices =
          (await api.getList(
                '/inventory/locations',
                query: {'warehouseId': warehouseId},
              ))
              .where(
                (r) =>
                    r['isActive'] != false &&
                    text(r, 'id') != text(source, 'locationId'),
              )
              .toList();
    } catch (error) {
      if (mounted) showMessage(context, error, error: true);
      return;
    }
    if (!mounted) return;
    if (choices.isEmpty) {
      showMessage(
        context,
        _t(
          'أنشئ موقع تخزين نشطًا آخر في هذا المستودع ثم أعد المحاولة.',
          'Create an active destination location in this warehouse, then retry.',
        ),
        error: true,
      );
      return;
    }
    final quantity = TextEditingController();
    final reason = TextEditingController();
    final form = GlobalKey<FormState>();
    String? target;
    String? error;
    bool busy = false;
    bool uncertain = false;
    final maximum = Decimal.tryParse(text(lot, 'quantity')) ?? Decimal.zero;
    final done = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (context) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: Text(
            assign
                ? _t('تعيين موقع للرصيد الموجود', 'Assign existing stock')
                : _t('نقل بين المواقع', 'Move between locations'),
          ),
          content: SizedBox(
            width: 480,
            child: Form(
              key: form,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      _t(
                            'لن تتغير كمية المخزن أو قيمته. الكمية المتاحة: ',
                            'Warehouse quantity and value will not change. Available: ',
                          ) +
                          maximum.toString(),
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<String>(
                      initialValue: target,
                      isExpanded: true,
                      decoration: InputDecoration(
                        labelText: _t('الموقع الجديد', 'Destination location'),
                      ),
                      items: [
                        for (final row in choices)
                          DropdownMenuItem(
                            value: text(row, 'id'),
                            child: Text(
                              '${text(row, 'code')} • ${localizedRecordName(row, arabic: _ar)}',
                            ),
                          ),
                      ],
                      onChanged: busy
                          ? null
                          : (v) => update(() {
                              target = v;
                              error = null;
                            }),
                      validator: (v) => v == null
                          ? _t(
                              'اختر موقعًا داخل نفس المستودع.',
                              'Choose a location in the same warehouse.',
                            )
                          : null,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: quantity,
                      enabled: !busy,
                      decoration: InputDecoration(
                        labelText: _t('الكمية', 'Quantity'),
                      ),
                      onChanged: (_) => update(() => error = null),
                      validator: (raw) {
                        final n = Decimal.tryParse((raw ?? '').trim());
                        if (n == null || n <= Decimal.zero) {
                          return _t(
                            'اكتب كمية أكبر من صفر بأربع خانات عشرية كحد أقصى.',
                            'Enter a quantity above zero, up to four decimal places.',
                          );
                        }
                        if (!RegExp(r'^\d+(?:\.\d{1,4})?$')
                            .hasMatch(raw!.trim())) {
                          return _t(
                            'استخدم أربع خانات عشرية كحد أقصى.',
                            'Use no more than four decimal places.',
                          );
                        }
                        if (n > maximum) {
                          return _t(
                            'الكمية أكبر من المتاح. خفّضها أو راجع رصيد المصدر.',
                            'Quantity exceeds available stock. Reduce it or review the source balance.',
                          );
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: reason,
                      enabled: !busy,
                      maxLength: 500,
                      decoration: InputDecoration(
                        labelText: _t('سبب الحركة', 'Reason'),
                      ),
                    ),
                    if (error != null)
                      Text(
                        error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: busy ? null : () => Navigator.pop(context, false),
              child: Text(_t('إلغاء', 'Cancel')),
            ),
            FilledButton(
              onPressed: busy || uncertain
                  ? null
                  : () async {
                      if (!form.currentState!.validate()) return;
                      update(() => busy = true);
                      try {
                        await api.post(
                          assign
                              ? '/inventory/locations/assign-unlocated'
                              : '/inventory/locations/move-stock',
                          body: {
                            if (assign) 'warehouseId': warehouseId,
                            if (!assign)
                              'fromLocationId': text(source, 'locationId'),
                            'toLocationId': target,
                            'itemId': widget.itemId,
                            if (lot['batchId'] != null)
                              'batchId': lot['batchId'],
                            'quantity': quantity.text.trim(),
                            if (reason.text.trim().isNotEmpty)
                              'reason': reason.text.trim(),
                          },
                        );
                        if (context.mounted) Navigator.pop(context, true);
                      } catch (e) {
                        update(() {
                          busy = false;
                          final rejected =
                              e is ApiFailure ||
                              e is PermissionFailure ||
                              e is ValidationFailure;
                          uncertain = !rejected;
                          final message = e is Failure
                              ? e.message
                              : _t(
                                  'تعذر تأكيد نتيجة الحفظ.',
                                  'Could not confirm the save result.',
                                );
                          error = rejected
                              ? '$message\n${_t('راجع الموقع والكمية والصلاحيات ثم أعد المحاولة. بياناتك لم تُمسح.', 'Review location, quantity and permissions, then retry. Your entries are retained.')}'
                              : _t(
                                  'قد تكون الحركة اكتملت. أغلق النافذة وحدّث أرصدة المواقع قبل أي محاولة أخرى. بياناتك محفوظة هنا، ولا تعِد الحفظ الآن.',
                                  'The operation may have completed. Close this dialog and refresh location balances before trying again. Your entries are retained; do not save again now.',
                                );
                        });
                      }
                    },
              child: Text(
                busy
                    ? _t('جارٍ الحفظ...', 'Saving...')
                    : _t('حفظ التوزيع', 'Save allocation'),
              ),
            ),
          ],
        ),
      ),
    );
    // Dialog route animations may still retain the fields for one frame.
    await Future<void>.delayed(const Duration(milliseconds: 300));
    quantity.dispose();
    reason.dispose();
    if (done == true && mounted) await _load();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text('${_t('مواقع الصنف', 'Item locations')}: ${widget.itemName}'),
      actions: [
        IconButton(
          tooltip: _t('تحديث الأرصدة', 'Refresh balances'),
          onPressed: _load,
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    body: AsyncStateView<Json>(
      value: _data,
      onRetry: _load,
      data: (data) {
        final warehouses = (data['warehouses'] as List? ?? const [])
            .whereType<Map>()
            .map((r) => Map<String, dynamic>.from(r))
            .toList();
        if (warehouses.isEmpty) {
          return Center(
            child: Text(
              _t(
                'لا يوجد رصيد ظاهر لهذا الصنف في المخازن المسموح لك بعرضها.',
                'No stock for this item in the warehouses you may view.',
              ),
            ),
          );
        }
        return ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              _t(
                'الأرصدة حسب الموقع الفعلي. «بدون موقع» رصيد لم يُحدَّد مكانه بعد، وليس استلامًا جديدًا.',
                'Balances by physical location. Unlocated stock has no assigned place yet; assigning it does not receive stock again.',
              ),
            ),
            const SizedBox(height: 16),
            for (final warehouse in warehouses) _warehouse(warehouse),
          ],
        );
      },
    ),
  );

  Widget _warehouse(Json warehouse) {
    final locations = (warehouse['locations'] as List? ?? const [])
        .whereType<Map>()
        .map((r) => Map<String, dynamic>.from(r))
        .toList();
    final unlocated = warehouse['unlocated'] is Map
        ? Map<String, dynamic>.from(warehouse['unlocated'] as Map)
        : <String, dynamic>{};
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${text(warehouse, 'warehouseCode')} • ${text(warehouse, _ar ? 'warehouseNameAr' : 'warehouseNameEn')}',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            Text(
              '${_t('إجمالي المخزن', 'Warehouse total')}: ${formatQuantity(asString(warehouse['total']))}',
            ),
            const Divider(),
            for (final location in locations) _location(warehouse, location),
            _location(warehouse, unlocated, unlocated: true),
          ],
        ),
      ),
    );
  }

  Widget _location(Json warehouse, Json location, {bool unlocated = false}) {
    final negative = (asNum(location['quantity']) ?? 0) < 0;
    final title = unlocated
        ? _t('بدون موقع', 'Unlocated')
        : '${text(location, 'code')} • ${text(location, _ar ? 'nameAr' : 'nameEn')}';
    final lots = (location['lots'] as List? ?? const [])
        .whereType<Map>()
        .map((r) => Map<String, dynamic>.from(r))
        .toList();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
              Text(
                formatQuantity(asString(location['quantity'])),
                style: negative
                    ? TextStyle(color: Theme.of(context).colorScheme.error)
                    : null,
              ),
            ],
          ),
          if (negative)
            Text(
              _t(
                'يوجد فرق تاريخي في توزيع المواقع. راجع الحركات والجرد قبل تعيين الكمية؛ لا تستلمها مرة أخرى.',
                'Historical location allocation deficit. Review movements and physical counts before assigning stock; do not receive it again.',
              ),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          for (final lot in lots)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${asString(lot['batchNumber']) ?? _t('بدون دفعة', 'No batch')}: ${formatQuantity(asString(lot['quantity']))}',
                    ),
                  ),
                  if ((ref
                              .read(currentUserProvider)
                              ?.can('inventory.stock.adjust') ??
                          false) &&
                      (asNum(lot['quantity']) ?? 0) > 0)
                    TextButton(
                      onPressed: () => _relocate(
                        warehouse,
                        location,
                        lot,
                        assign: unlocated,
                      ),
                      child: Text(
                        unlocated
                            ? _t('تعيين الموقع', 'Assign location')
                            : _t('نقل', 'Move'),
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
