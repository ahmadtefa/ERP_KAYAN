import 'package:decimal/decimal.dart';

import '../../core/json/discount_math.dart';
import '../../core/json/json_utils.dart';

/// How a receipt or a payment is spread over the invoices a party still owes.
///
/// Oldest first: money is applied to the oldest debt unless somebody says
/// otherwise, and the screen says so. Nothing is ever applied twice, nothing
/// beyond what an invoice still owes, and nothing beyond the money that came
/// in - the last invoice gets only the remainder.
///
/// Decimals, not doubles: on floats a 0.1 + 0.2 reminder turns into a
/// four-decimal allocation that no longer adds up to the voucher.
List<Json> planAllocations({
  required List<Json> openInvoices,
  required String amount,
  required bool isReceipt,
}) {
  var left = decimalOf(amount);
  final allocations = <Json>[];
  for (final invoice in openInvoices) {
    if (left <= Decimal.zero) break;
    final due = decimalOf(asString(invoice['balance']));
    if (due <= Decimal.zero) continue;
    final applied = due < left ? due : left;
    allocations.add({
      if (isReceipt)
        'salesInvoiceId': text(invoice, 'id')
      else
        'purchaseInvoiceId': text(invoice, 'id'),
      'amount': applied.toStringAsFixed(4),
    });
    left = left - applied;
  }
  return allocations;
}
