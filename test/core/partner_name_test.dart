import 'package:erp_kayan/core/json/json_utils.dart';
import 'package:flutter_test/flutter_test.dart';

/// The voucher list and the voucher dialog both print the partner from the
/// same response. The server nests it (`customer: {nameEn, nameAr}`); reading
/// flat keys instead left the column blank while the name was in the payload.
void main() {
  group('partnerName', () {
    test('reads a customer object in the language asked for', () {
      final row = <String, dynamic>{
        'customer': {'code': 'C-1', 'nameEn': 'Acme', 'nameAr': 'أكمي'},
      };
      expect(partnerName(row, arabic: true), 'أكمي');
      expect(partnerName(row), 'Acme');
    });

    test('falls back to the other language when one side is empty', () {
      final row = <String, dynamic>{
        'supplier': {'code': 'S-1', 'nameEn': 'Nile', 'nameAr': ''},
      };
      expect(partnerName(row, arabic: true), 'Nile');
    });

    test('reads a supplier when the voucher is a payment', () {
      final row = <String, dynamic>{
        'customer': null,
        'supplier': {'code': 'S-1', 'nameEn': 'Nile', 'nameAr': 'النيل'},
      };
      expect(partnerName(row), 'Nile');
      expect(partnerName(row, arabic: true), 'النيل');
    });

    test('still understands the flat keys older rows carry', () {
      final row = <String, dynamic>{'supplierNameAr': 'النيل', 'supplierNameEn': 'Nile'};
      expect(partnerName(row, arabic: true), 'النيل');
      expect(partnerName(row), 'Nile');
    });

    test('is empty, not a crash, when the voucher has no partner', () {
      expect(partnerName(<String, dynamic>{'customer': null}), '');
      expect(partnerName(<String, dynamic>{}), '');
    });
  });
}
