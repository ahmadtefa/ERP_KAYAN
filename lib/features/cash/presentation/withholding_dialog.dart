import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/json/amount_format.dart';
import '../../../core/json/json_utils.dart';
import '../../../shared/widgets/form_sheet.dart';
import '../../auth/presentation/providers/auth_providers.dart';
import '../../common/presentation/screens/module_scaffold.dart';

/// Whether a voucher can carry withholding tax at all: a payment to a supplier
/// or a receipt from a customer.
bool voucherTakesWithholding(Json voucher) {
  final kind = text(voucher, 'kind').toUpperCase();
  return (kind == 'PAYMENT' && text(voucher, 'supplierId').isNotEmpty) ||
      (kind == 'RECEIPT' && text(voucher, 'customerId').isNotEmpty);
}

/// Sets, replaces or clears the withholding tax on a draft voucher. The tax is
/// worked out by the server from the rate; nothing is booked until posting.
Future<void> showVoucherWithholding(BuildContext context, WidgetRef ref, Json voucher) async {
  final arabic = Localizations.localeOf(context).languageCode == 'ar';
  final api = ref.read(apiClientProvider);
  final id = text(voucher, 'id');
  final wanted = text(voucher, 'kind').toUpperCase() == 'PAYMENT' ? 'PAYABLE' : 'RECEIVABLE';
  List<Json> rates;
  Json current;
  try {
    rates = await api.getList('/withholding/rates');
    current = await api.getObject('/withholding/vouchers/$id');
  } catch (error) {
    if (context.mounted) showMessage(context, error, error: true);
    return;
  }
  if (!context.mounted) return;
  final options = [
    for (final r in rates)
      if (text(r, 'direction') == wanted && r['isActive'] != false)
        FieldOption(
          text(r, 'id'),
          '${text(r, 'code')} - ${arabic ? text(r, 'nameAr', fallback: text(r, 'nameEn')) : text(r, 'nameEn', fallback: text(r, 'nameAr'))} (${formatAmount(asString(r['ratePercent']))}%)',
        ),
  ];
  final held = current['withholding'];
  final heldRate = held is Map ? (asString(held['rateId']) ?? '') : '';
  final saved = await showFormSheet(
    context,
    title: arabic ? 'ضريبة الخصم على السند' : 'Withholding tax on the voucher',
    submitLabel: arabic ? 'حفظ' : 'Save',
    initial: {if (heldRate.isNotEmpty) 'rateId': heldRate},
    fields: [
      FieldSpec(
        'rateId',
        arabic ? 'النسبة' : 'Rate',
        kind: FieldKind.select,
        options: options,
        clearable: true,
        nullWhenEmpty: true,
        helper: options.isEmpty
            ? (arabic
                  ? 'لا توجد نسب مناسبة لهذا السند. أضفها من شاشة ضريبة الخصم والإضافة.'
                  : 'No rate fits this voucher. Add one on the Withholding tax screen.')
            : (arabic
                  ? 'تُخصم الضريبة من المبلغ النقدي عند الترحيل، ويبقى السند والفواتير بالمبلغ الإجمالي. اترك الحقل فارغًا لإلغاء الخصم.'
                  : 'The tax is taken out of the cash at posting; the voucher and its invoices stay at the gross amount. Leave empty to remove it.'),
      ),
    ],
    onSubmit: (values) async {
      final rateId = values['rateId'] == null ? '' : text(values, 'rateId');
      if (rateId.isEmpty) {
        await api.delete('/withholding/vouchers/$id');
      } else {
        await api.put('/withholding/vouchers/$id', body: {'rateId': rateId});
      }
    },
  );
  if (saved != null && context.mounted) {
    showMessage(context, arabic ? 'تم حفظ ضريبة الخصم.' : 'The withholding tax was saved.');
  }
}
