import 'package:flutter/material.dart';

/// The choice made in front of one print button.
///
/// A null field means "leave the company's saved policy alone" - which is what
/// happens when the person presses Continue without changing anything. Only a
/// deliberate change becomes an override, so the saved setting keeps governing
/// the copies nobody thought about.
class PrintVisibilityChoice {
  const PrintVisibilityChoice({this.showSalePrice, this.showCost});

  final bool? showSalePrice;
  final bool? showCost;

  bool get isOverride => showSalePrice != null || showCost != null;

  Map<String, dynamic> toQuery() => {
    if (showSalePrice != null) 'showSalePrice': showSalePrice,
    if (showCost != null) 'showCost': showCost,
  };
}

/// The same choice is used by list, report and saved-document PDF/print
/// actions.
///
/// It opens at the company's saved policy for this exact print type - so a
/// company that decided warehouse sheets leave without costs is not asked to
/// remember it on every click - and changing a box overrides that policy for
/// this copy only. The server applies them in one order and says so: the
/// caller's permission first (a cost is never shown without
/// `inventory.cost.read`), then this override, then the saved type, then the
/// saved default.
///
/// [canSeeCost] mirrors the permission. A person who may not read a cost is not
/// offered it here: the server would refuse anyway, and a checkbox that quietly
/// changes nothing is worse than saying why it is not there.
Future<PrintVisibilityChoice?> choosePriceVisibility(
  BuildContext context, {
  required bool arabic,
  bool canSeeCost = true,
  bool initialShowSalePrice = true,
  bool initialShowCost = true,
  String? policyNote,
}) async {
  var showSalePrice = initialShowSalePrice;
  // The starting point is also what "no override" means, so it is kept as the
  // value the boxes are compared against when the person presses Continue.
  final startShowCost = canSeeCost && initialShowCost;
  var showCost = startShowCost;

  final result = await showDialog<PrintVisibilityChoice>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setDialogState) => AlertDialog(
        title: Text(arabic ? 'بيانات الأسعار في النسخة' : 'Prices in this copy'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: showSalePrice,
              title: Text(arabic ? 'إظهار سعر البيع' : 'Show sale prices'),
              onChanged: (value) =>
                  setDialogState(() => showSalePrice = value ?? false),
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
            if (policyNote != null && policyNote.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(policyNote, style: Theme.of(context).textTheme.bodySmall),
            ],
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
            onPressed: () => Navigator.of(dialogContext).pop(
              PrintVisibilityChoice(
                // Only what was actually changed travels as an override.
                showSalePrice: showSalePrice == initialShowSalePrice
                    ? null
                    : showSalePrice,
                showCost: !canSeeCost
                    ? null
                    : (showCost == startShowCost ? null : showCost),
              ),
            ),
            child: Text(arabic ? 'متابعة' : 'Continue'),
          ),
        ],
      ),
    ),
  );
  return result;
}
