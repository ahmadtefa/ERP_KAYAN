import 'package:flutter/material.dart';

/// The same choice is used by list, report and saved-document PDF/print
/// actions. This changes only the rendered copy, never the stored document.
///
/// Each switch mirrors one independent API permission. A caller may choose
/// what to print only inside the figures their role may already read; the
/// server enforces the same floor even if a caller edits the request.
Future<Map<String, bool>?> choosePriceVisibility(
  BuildContext context, {
  required bool arabic,
  bool canSeeCost = false,
  bool canSeePurchasePrice = false,
  bool canSeeSalePrice = false,
}) async {
  var showSalePrice = canSeeSalePrice;
  var showPurchasePrice = canSeePurchasePrice;
  var showCost = canSeeCost;

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
              subtitle: canSeeSalePrice
                  ? null
                  : Text(
                      arabic
                          ? 'ليس لديك صلاحية عرض أسعار البيع.'
                          : 'Your role may not view selling prices.',
                    ),
              onChanged: canSeeSalePrice
                  ? (value) => setDialogState(() => showSalePrice = value ?? false)
                  : null,
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: showPurchasePrice,
              title: Text(arabic ? 'إظهار سعر الشراء' : 'Show purchase prices'),
              subtitle: canSeePurchasePrice
                  ? null
                  : Text(
                      arabic
                          ? 'ليس لديك صلاحية عرض أسعار الشراء.'
                          : 'Your role may not view purchase prices.',
                    ),
              onChanged: canSeePurchasePrice
                  ? (value) => setDialogState(() => showPurchasePrice = value ?? false)
                  : null,
            ),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: showCost,
              title: Text(arabic ? 'إظهار التكلفة' : 'Show costs'),
              subtitle: canSeeCost
                  ? null
                  : Text(
                      arabic
                          ? 'ليس لديك صلاحية عرض التكلفة.'
                          : 'Your role may not view costs.',
                    ),
              onChanged: canSeeCost
                  ? (value) => setDialogState(() => showCost = value ?? false)
                  : null,
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
              'showSalePrice': showSalePrice && canSeeSalePrice,
              'showPurchasePrice': showPurchasePrice && canSeePurchasePrice,
              'showCost': showCost && canSeeCost,
            }),
            child: Text(arabic ? 'متابعة' : 'Continue'),
          ),
        ],
      ),
    ),
  );
}
