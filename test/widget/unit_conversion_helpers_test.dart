import 'package:erp_kayan/features/invoicing/presentation/screens/invoice_editor_screen.dart';
import 'package:flutter_test/flutter_test.dart';

/// The screen-side rules for multi-unit items. The arithmetic that matters
/// (conversion, stock, prices) is proved against a real database by
/// `backend/scripts/scenario-multiunit-cable-carton.mjs`; these tests cover
/// the two things only the screen decides: which units are offered, and
/// whether a typed quantity is allowed in the chosen one.
void main() {
  final cable = <String, dynamic>{
    'unit': 'متر',
    'salePrice': '10',
    'purchasePrice': '8',
    'units': <Map<String, dynamic>>[
      {'unit': 'متر', 'factor': '1', 'isBase': true},
      {'unit': 'لفة', 'factor': '500', 'salePrice': '5000', 'sortOrder': 2},
      {'unit': 'صندوق', 'factor': '1000', 'sortOrder': 1},
    ],
  };

  test('the item price is per base unit, so a reel is not offered at 10', () {
    expect(unitListPrice(cable, 'متر', isSales: true), '10');
    expect(unitListPrice(cable, 'لفة', isSales: true), '5000');
    // A box of a thousand metres with no price of its own follows the factor.
    expect(unitListPrice(cable, 'صندوق', isSales: true), '10000.00');
  });

  test('a unit price entered on the unit itself wins over the item price', () {
    expect(unitListPrice(cable, 'لفة', isSales: false), '4000.00');
  });

  test('display order is honoured, then the smaller pack', () {
    expect(
      lineUnitsOf(cable).map((unit) => unit['unit']).toList(),
      ['متر', 'صندوق', 'لفة'],
    );
  });

  test('a unit switched off for sales is not offered when selling', () {
    final item = <String, dynamic>{
      'unit': 'قطعة',
      'units': <Map<String, dynamic>>[
        {'unit': 'قطعة', 'factor': '1', 'isBase': true},
        {'unit': 'كرتونة', 'factor': '12', 'usedInSales': false},
      ],
    };
    expect(
      lineUnitsOf(item, forSales: true).map((unit) => unit['unit']).toList(),
      ['قطعة'],
    );
    expect(
      lineUnitsOf(item, forSales: false).map((unit) => unit['unit']).toList(),
      ['قطعة', 'كرتونة'],
    );
    // Asking with no side keeps every active unit, which is what the
    // catalogue and the barcode screens need.
    expect(lineUnitsOf(item), hasLength(2));
  });

  test('half a carton is refused, half a metre is not', () {
    final item = <String, dynamic>{
      'unit': 'قطعة',
      'units': <Map<String, dynamic>>[
        {'unit': 'قطعة', 'factor': '1', 'isBase': true},
        {'unit': 'كرتونة', 'factor': '24', 'allowFraction': false},
      ],
    };
    expect(quantityAllowedInUnit(lineUnitOf(item, 'كرتونة'), '0.5'), isFalse);
    expect(quantityAllowedInUnit(lineUnitOf(item, 'كرتونة'), '2'), isTrue);
    expect(quantityAllowedInUnit(lineUnitOf(item, 'قطعة'), '0.5'), isTrue);
  });

  test('a line that names no unit falls back to the base unit', () {
    expect(lineUnitOf(cable, null)?['unit'], 'متر');
    expect(lineUnitOf(cable, 'لفة')?['unit'], 'لفة');
    expect(lineUnitOf(null, 'لفة'), isNull);
  });
}
