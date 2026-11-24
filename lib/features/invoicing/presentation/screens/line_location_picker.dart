import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';

import '../../../../core/json/json_utils.dart';
import '../../../../core/json/amount_format.dart';
import '../../../../core/network/api_client.dart';

/// Allocations are entered in the invoice line's unit. Available stock is
/// labelled in base units, so a carton count is never presented as pieces.
Future<Json?> pickLineLocations(
  BuildContext context,
  ApiClient api, {
  required String itemId,
  required String lineQuantity,
  required String? unitName,
  String? unitFactor,
  required String? warehouseId,
  required List<Json> initial,
}) async {
  final ar = Localizations.localeOf(context).languageCode == 'ar';
  String t(String a, String e) => ar ? a : e;
  final data = await api.getObject('/inventory/locations/item/$itemId');
  if (!context.mounted) return null;
  final warehouses = listOf(data['warehouses']);
  String? chosen = warehouses.any((w) => text(w, 'warehouseId') == warehouseId)
      ? warehouseId
      : null;
  if (chosen == null && warehouses.length == 1) {
    chosen = text(warehouses.single, 'warehouseId');
  }
  final controllers = <String, TextEditingController>{};
  for (final row in initial) {
    controllers[text(row, 'storageLocationId')] = TextEditingController(
      text: text(row, 'quantity'),
    );
  }
  String? error;
  final result = await showDialog<Json>(
    context: context,
    barrierDismissible: false,
    builder: (context) => StatefulBuilder(
      builder: (context, update) {
        final warehouse = warehouses
            .where((w) => text(w, 'warehouseId') == chosen)
            .firstOrNull;
        final locations = listOf(warehouse?['locations']);
        return AlertDialog(
          title: Text(t('مواقع صرف السطر', 'Line source locations')),
          content: SizedBox(
            width: 600,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    '${t('وزّع كمية السطر', 'Allocate line quantity')}: $lineQuantity ${unitName ?? ''}',
                  ),
                  Text(
                    '${t('الأرصدة المعروضة بوحدة الصنف الأساسية', 'Available balances are in base units')}: ${text(data, 'unit')}',
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: chosen,
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: t('المستودع', 'Warehouse'),
                    ),
                    items: [
                      for (final w in warehouses)
                        DropdownMenuItem(
                          value: text(w, 'warehouseId'),
                          child: Text(
                            '${text(w, 'warehouseCode')} • ${text(w, ar ? 'warehouseNameAr' : 'warehouseNameEn')}',
                          ),
                        ),
                    ],
                    onChanged: (v) => update(() {
                      chosen = v;
                      error = null;
                    }),
                  ),
                  const SizedBox(height: 12),
                  if (warehouse != null && locations.isEmpty)
                    Text(
                      t(
                        'لا توجد أرصدة بمواقع محددة هنا. الرصيد بدون موقع يستمر بالطريقة الحالية؛ يمكنك تعيين موقع له من شاشة مواقع الصنف.',
                        'No located stock here. Unlocated stock retains its current issue behavior. Assign it a location from Item locations if needed.',
                      ),
                    ),
                  for (final location in locations)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: TextFormField(
                        controller: controllers.putIfAbsent(
                          text(location, 'locationId'),
                          () => TextEditingController(),
                        ),
                        keyboardType: TextInputType.number,
                        decoration: InputDecoration(
                          labelText:
                              '${text(location, 'code')} • ${localizedRecordName(location, arabic: ar)}',
                          helperText:
                              '${t('المتاح بالوحدة الأساسية', 'Available in base units')}: ${formatQuantity(asString(location['quantity']))}',
                          suffixText: unitName,
                        ),
                        onChanged: (_) => update(() => error = null),
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
          actions: [
            TextButton(
              onPressed: chosen == null
                  ? null
                  : () => Navigator.pop(context, {
                      'warehouseId': chosen,
                      'locationAllocations': <Json>[],
                    }),
              child: Text(
                t('مسح التوزيع (للمسودة فقط)', 'Clear allocation (draft only)'),
              ),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(t('إلغاء', 'Cancel')),
            ),
            FilledButton(
              onPressed: () {
                if (chosen == null) {
                  update(
                    () => error = t(
                      'اختر المستودع أولًا.',
                      'Choose the warehouse first.',
                    ),
                  );
                  return;
                }
                final allocations = <Json>[];
                var total = Decimal.zero;
                for (final location in locations) {
                  final id = text(location, 'locationId');
                  final raw = controllers[id]?.text.trim() ?? '';
                  if (raw.isEmpty) continue;
                  final q = Decimal.tryParse(raw);
                  if (q == null ||
                      q <= Decimal.zero ||
                      !RegExp(r'^\d+(?:\.\d{1,4})?$').hasMatch(raw)) {
                    update(
                      () => error = t(
                        'اكتب كمية موجبة بأربع خانات عشرية كحد أقصى لكل موقع مستخدم.',
                        'Enter a positive quantity with at most four decimal places for each used location.',
                      ),
                    );
                    return;
                  }
                  final factor = Decimal.tryParse(unitFactor ?? '');
                  final available = Decimal.tryParse(
                    text(location, 'quantity'),
                  );
                  if (factor != null &&
                      available != null &&
                      q * factor > available) {
                    update(
                      () => error = t(
                        'الكمية في الموقع ${text(location, 'code')} غير كافية. خفّض الكمية أو اختر موقعًا آخر.',
                        'Insufficient stock at ${text(location, 'code')}. Reduce its quantity or choose another location.',
                      ),
                    );
                    return;
                  }
                  total += q;
                  allocations.add({'storageLocationId': id, 'quantity': raw});
                }
                if (locations.isNotEmpty &&
                    total != (Decimal.tryParse(lineQuantity) ?? Decimal.zero)) {
                  update(
                    () => error = t(
                      'مجموع كميات المواقع لا يساوي كمية السطر. عدّلها لتساوي $lineQuantity ${unitName ?? ''}.',
                      'Location quantities do not equal the line quantity. Change them to total $lineQuantity ${unitName ?? ''}.',
                    ),
                  );
                  return;
                }
                Navigator.pop(context, {
                  'warehouseId': chosen,
                  'locationAllocations': allocations,
                });
              },
              child: Text(t('اعتماد التوزيع', 'Use allocation')),
            ),
          ],
        );
      },
    ),
  );
  await Future<void>.delayed(const Duration(milliseconds: 300));
  for (final c in controllers.values) {
    c.dispose();
  }
  return result;
}
