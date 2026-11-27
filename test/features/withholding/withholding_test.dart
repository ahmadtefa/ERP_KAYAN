import 'package:erp_kayan/features/cash/presentation/withholding_dialog.dart';
import 'package:erp_kayan/features/withholding/presentation/withholding_screen.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('only a supplier payment or a customer receipt can carry withholding', () {
    expect(voucherTakesWithholding({'kind': 'PAYMENT', 'supplierId': 's1'}), isTrue);
    expect(voucherTakesWithholding({'kind': 'payment', 'supplierId': 's1'}), isTrue);
    expect(voucherTakesWithholding({'kind': 'RECEIPT', 'customerId': 'c1'}), isTrue);
    expect(voucherTakesWithholding({'kind': 'PAYMENT', 'customerId': 'c1'}), isFalse);
    expect(voucherTakesWithholding({'kind': 'RECEIPT', 'supplierId': 's1'}), isFalse);
    expect(voucherTakesWithholding({'kind': 'PAYMENT', 'counterAccountId': 'a1'}), isFalse);
  });

  test('the two kinds are named for what happened, in both languages', () {
    expect(withholdingDirectionLabel('PAYABLE', false), contains('supplier'));
    expect(withholdingDirectionLabel('RECEIVABLE', false), contains('customer'));
    expect(withholdingDirectionLabel('PAYABLE', true), contains('مورد'));
    expect(withholdingDirectionLabel('RECEIVABLE', true), contains('عميل'));
  });
}
