import 'package:erp_kayan/features/cash/voucher_allocation.dart';
import 'package:flutter_test/flutter_test.dart';

/// The screen spreads a receipt over the invoices still open. The totals it
/// sends have to add up to the money received, to the cent, or the voucher
/// settles less than it collected.
void main() {
  Map<String, dynamic> invoice(String id, String balance) =>
      <String, dynamic>{'id': id, 'balance': balance};

  test('fills the oldest invoice first and stops when the money runs out', () {
    final planned = planAllocations(
      openInvoices: [invoice('a', '300.0000'), invoice('b', '500.0000')],
      amount: '400',
      isReceipt: true,
    );
    expect(planned, [
      {'salesInvoiceId': 'a', 'amount': '300.0000'},
      {'salesInvoiceId': 'b', 'amount': '100.0000'},
    ]);
  });

  test('never applies more than an invoice still owes', () {
    final planned = planAllocations(
      openInvoices: [invoice('a', '120.0000'), invoice('b', '80.0000')],
      amount: '1000',
      isReceipt: true,
    );
    expect(planned.map((row) => row['amount']), ['120.0000', '80.0000']);
  });

  test('keeps the sum exact when the fractions do not divide evenly', () {
    final planned = planAllocations(
      openInvoices: [invoice('a', '0.1000'), invoice('b', '0.2000')],
      amount: '0.3',
      isReceipt: false,
    );
    expect(planned, [
      {'purchaseInvoiceId': 'a', 'amount': '0.1000'},
      {'purchaseInvoiceId': 'b', 'amount': '0.2000'},
    ]);
  });

  test('a payment names purchase invoices, a receipt names sales invoices', () {
    final payment = planAllocations(
      openInvoices: [invoice('p', '50.0000')],
      amount: '50',
      isReceipt: false,
    );
    expect(payment.single.containsKey('purchaseInvoiceId'), isTrue);
    expect(payment.single.containsKey('salesInvoiceId'), isFalse);
  });

  test('money that no invoice needs stays on account: no allocations', () {
    final planned = planAllocations(
      openInvoices: [invoice('a', '0.0000'), invoice('b', '-10.0000')],
      amount: '75',
      isReceipt: true,
    );
    expect(planned, isEmpty);
  });

  test('an amount of zero allocates nothing instead of a zero row', () {
    final planned = planAllocations(
      openInvoices: [invoice('a', '100.0000')],
      amount: '0',
      isReceipt: true,
    );
    expect(planned, isEmpty);
  });
}
