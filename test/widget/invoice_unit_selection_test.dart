import 'package:erp_kayan/features/invoicing/presentation/screens/invoice_editor_screen.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('legacy items have a base unit and missing prices stay empty', () {
    final item = <String, dynamic>{'unit': 'piece'};
    final units = lineUnitsOf(item);
    expect(units, hasLength(1));
    expect(units.single['unit'], 'piece');
    expect(unitListPrice(item, 'piece', isSales: true), '');
    expect(unitListPrice(item, 'piece', isSales: false), '');
    expect(lineUnitsOf(null), isEmpty);
  });

  test('only an automatic or untouched price follows a unit change', () {
    expect(maySuggestUnitPrice('10', automatic: true, edited: false), isTrue);
    expect(maySuggestUnitPrice('0', automatic: false, edited: false), isTrue);
    expect(maySuggestUnitPrice('0', automatic: false, edited: true), isFalse);
    expect(maySuggestUnitPrice('15', automatic: false, edited: true), isFalse);
    expect(maySuggestUnitPrice('15', automatic: false, edited: false), isFalse);
  });

  test('a missing unit price is converted once from the base price', () {
    final item = <String, dynamic>{
      'unit': 'piece',
      'salePrice': '10',
      'purchasePrice': '7',
      'units': <Map<String, dynamic>>[
        {'unit': 'piece', 'factor': '1'},
        {'unit': 'carton', 'factor': '12'},
        {'unit': 'half', 'factor': '0.5'},
        {'unit': 'broken', 'factor': '0'},
      ],
    };
    expect(unitListPrice(item, 'carton', isSales: true), '120');
    expect(unitListPrice(item, 'carton', isSales: false), '84');
    expect(unitListPrice(item, 'half', isSales: true), '5');
    expect(unitListPrice(item, 'broken', isSales: true), '');
    expect(unitListPrice(item, 'unknown', isSales: true), '');
  });

  test('active units sort by factor and unit prices fall back safely', () {
    final item = <String, dynamic>{
      'unit': 'piece',
      'salePrice': '10',
      'purchasePrice': null,
      'units': <Map<String, dynamic>>[
        {'unit': 'box', 'factor': '12', 'salePrice': '100'},
        {'unit': 'piece', 'factor': null},
        {'unit': 'inactive', 'factor': '0.5', 'isActive': false},
      ],
    };
    expect(lineUnitsOf(item).map((u) => u['unit']), ['piece', 'box']);
    expect(unitListPrice(item, 'box', isSales: true), '100');
    expect(unitListPrice(item, 'piece', isSales: true), '10');
    expect(unitListPrice(item, 'box', isSales: false), '');
  });
}
