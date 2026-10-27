import 'package:flutter/material.dart';

/// The same choice is used by list, report and saved-document PDF/print
/// actions. This changes only the rendered copy, never the stored document.
Future<Map<String, bool>?> choosePriceVisibility(
  BuildContext context, {
  required bool arabic,
}) async {
  var showSalePrice = true;
  var showCost = true;

  return showDialog<Map<String, bool>>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setDialogState) => AlertDialog(
        title: Text(arabic ? 'بيانات الأسعار في النسخة' : 'Prices in this copy'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: showSalePrice,
              title: Text(arabic ? 'إظهار سعر البيع' : 'Show sale prices'),
              onChanged: (value) => setDialogState(() => showSalePrice = value ?? false),
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: showCost,
              title: Text(arabic ? 'إظهار التكلفة' : 'Show costs'),
              onChanged: (value) => setDialogState(() => showCost = value ?? false),
            ),
            const SizedBox(height: 8),
            Text(
              arabic
                  ? 'يؤثر الاختيار على نسخة الطباعة أو PDF فقط، ولا يغيّر البيانات الأصلية.'
                  : 'This affects only the printed/PDF copy; original data is unchanged.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(arabic ? 'إلغاء' : 'Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop({
              'showSalePrice': showSalePrice,
              'showCost': showCost,
            }),
            child: Text(arabic ? 'متابعة' : 'Continue'),
          ),
        ],
      ),
    ),
  );
}
