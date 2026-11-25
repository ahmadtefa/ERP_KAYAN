import 'package:flutter/material.dart';

import '../../../../core/json/json_utils.dart';
import '../../../../core/network/api_client.dart';

/// Receipt destinations include empty active shelves, not just stocked shelves.
Future<Json?> pickReceiptLocation(
  BuildContext context,
  ApiClient api, {
  required String? warehouseId,
  required String? storageLocationId,
}) async {
  final ar = Localizations.localeOf(context).languageCode == 'ar';
  String t(String a, String e) => ar ? a : e;
  final warehouses = (await api.getList('/inventory/warehouses'))
      .where((w) => w['isActive'] != false)
      .toList();
  final shelves = (await api.getList('/inventory/locations'))
      .where((s) => s['isActive'] != false)
      .toList();
  if (!context.mounted) return null;
  String? chosen = warehouses.any((w) => text(w, 'id') == warehouseId)
      ? warehouseId
      : warehouses.length == 1
      ? text(warehouses.single, 'id')
      : null;
  var location = storageLocationId;
  return showDialog<Json>(
    context: context,
    barrierDismissible: false,
    builder: (context) => StatefulBuilder(
      builder: (context, update) {
        final options = shelves
            .where((s) => text(s, 'warehouseId') == chosen)
            .toList();
        final stale =
            location != null && !options.any((s) => text(s, 'id') == location);
        return AlertDialog(
          title: Text(t('موقع استلام السطر', 'Line receiving location')),
          content: SizedBox(
            width: 560,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  t(
                    'اختر المستودع وموقع وضع البضاعة. بدون موقع تبقى الكمية غير موزعة.',
                    'Choose the warehouse and physical destination. Without a location, stock remains unlocated.',
                  ),
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
                        value: text(w, 'id'),
                        child: Text(
                          '${text(w, 'code')} • ${localizedRecordName(w, arabic: ar)}',
                        ),
                      ),
                  ],
                  onChanged: (v) => update(() {
                    chosen = v;
                    location = null;
                  }),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  key: ValueKey(chosen),
                  initialValue: stale ? null : location,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: t('موقع الاستلام', 'Receiving location'),
                  ),
                  items: [
                    for (final s in options)
                      DropdownMenuItem(
                        value: text(s, 'id'),
                        child: Text(
                          '${text(s, 'code')} • ${localizedRecordName(s, arabic: ar)}',
                        ),
                      ),
                  ],
                  onChanged: (v) => update(() => location = v),
                ),
                if (stale)
                  Text(
                    t(
                      'الموقع المحفوظ غير متاح. اختر موقعًا نشطًا أو احذفه صراحة.',
                      'The saved destination is unavailable. Choose an active location or explicitly clear it.',
                    ),
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                if (chosen != null && options.isEmpty)
                  Text(
                    t(
                      'لا توجد مواقع نشطة. أنشئ موقعًا من إدارة المواقع ثم افتح الاختيار مجددًا.',
                      'No active locations. Create one in Storage locations, then reopen this picker.',
                    ),
                  ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: Text(t('إلغاء', 'Cancel')),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context, {
                'warehouseId': chosen,
                'storageLocationId': null,
              }),
              child: Text(t('بدون موقع', 'Clear location')),
            ),
            FilledButton(
              onPressed: chosen == null || location == null || stale
                  ? null
                  : () => Navigator.pop(context, {
                      'warehouseId': chosen,
                      'storageLocationId': location,
                    }),
              child: Text(t('تطبيق', 'Apply')),
            ),
          ],
        );
      },
    ),
  );
}
