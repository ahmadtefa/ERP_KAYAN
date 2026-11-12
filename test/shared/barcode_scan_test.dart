import 'package:decimal/decimal.dart';
import 'package:erp_kayan/core/error/failure.dart';
import 'package:erp_kayan/shared/barcode/barcode_scan.dart';
import 'package:flutter_test/flutter_test.dart';

/// The rules every screen that accepts a scan depends on, as arithmetic.
///
/// These are the tests that make "one scan of a carton is one carton" a fact
/// rather than a comment: the quantity written into a line is the number of
/// scans, never the number of base units, and the factor is used for display
/// only.

/// A barcode response shaped exactly like `ItemsService.findByBarcode` sends:
/// a carton whose factor is 24.
Map<String, dynamic> cartonResponse({String matched = 'unit'}) => {
  'matched': matched,
  'unit': 'كرتونة',
  'factor': '24.000000',
  'quantityPerScan': '24.000000',
  'quantityPerScanFitsLedgerScale': true,
  'salePrice': '240.0000',
  'purchasePrice': '200.0000',
  'item': {
    'id': 'item-water',
    'code': 'WATER',
    'nameEn': 'Water',
    'nameAr': 'مياه',
    'unit': 'علبة',
    'salePrice': '10.0000',
    'purchasePrice': '8.0000',
    'units': [
      {
        'id': 'unit-base',
        'unit': 'علبة',
        'factor': '1.000000',
        'isActive': true,
        'isDefaultSale': false,
        'isDefaultPurchase': false,
      },
      {
        'id': 'unit-carton',
        'unit': 'كرتونة',
        'factor': '24.000000',
        'isActive': true,
        'isDefaultSale': true,
        'isDefaultPurchase': true,
      },
    ],
  },
  'units': [
    {'id': 'unit-base', 'unit': 'علبة', 'factor': '1.000000'},
    {'id': 'unit-carton', 'unit': 'كرتونة', 'factor': '24.000000'},
  ],
};

void main() {
  /// A response that names a non-base unit must carry a usable factor.
  ///
  /// The old code substituted 1 for a missing or unreadable factor, which reads
  /// as "this carton is one piece" - a 24-fold under-count on every scan and a
  /// wrong shelf once it is posted. Factor 1 is now only accepted when the
  /// response actually says 1 (a base-unit/item barcode); anything else is
  /// refused with a message that names the barcode.
  group('a non-base unit without a usable factor is refused', () {
    Map<String, dynamic> withoutFactor() {
      final body = cartonResponse();
      body.remove('factor');
      return body;
    }

    test('a missing factor on a unit scan is an error, not factor 1', () {
      expect(
        () => BarcodeMatch.fromResponse('6221', withoutFactor()),
        throwsA(
          isA<FormatException>().having(
            (error) => error.message,
            'message',
            contains('no conversion factor'),
          ),
        ),
      );
    });

    test('an empty factor string is an error too, not a silent 1', () {
      final body = cartonResponse();
      body['factor'] = '';
      expect(
        () => BarcodeMatch.fromResponse('6221', body),
        throwsA(isA<FormatException>()),
      );
    });

    test('a factor that is not a number is refused', () {
      final body = cartonResponse();
      body['factor'] = 'two dozen';
      expect(
        () => BarcodeMatch.fromResponse('6221', body),
        throwsA(
          isA<FormatException>().having(
            (error) => error.message,
            'message',
            contains('not a number'),
          ),
        ),
      );
    });

    test('a zero factor is refused, because nothing converts with it', () {
      final body = cartonResponse();
      body['factor'] = '0';
      expect(
        () => BarcodeMatch.fromResponse('6221', body),
        throwsA(
          isA<FormatException>().having(
            (error) => error.message,
            'message',
            contains('greater than zero'),
          ),
        ),
      );
    });

    test('a negative factor is refused', () {
      final body = cartonResponse();
      body['factor'] = '-24';
      expect(
        () => BarcodeMatch.fromResponse('6221', body),
        throwsA(isA<FormatException>()),
      );
    });

    test('a unit the item does not list is refused as contradictory', () {
      final body = cartonResponse();
      body['unit'] = 'صندوق';
      expect(
        () => BarcodeMatch.fromResponse('6221', body),
        throwsA(
          isA<FormatException>().having(
            (error) => error.message,
            'message',
            contains('does not list it'),
          ),
        ),
      );
    });

    test('a factor that disagrees with the item packing table is refused', () {
      final body = cartonResponse();
      body['factor'] = '12.000000';
      expect(
        () => BarcodeMatch.fromResponse('6221', body),
        throwsA(
          isA<FormatException>().having(
            (error) => error.message,
            'message',
            contains('but the item says'),
          ),
        ),
      );
    });

    test('the error names the barcode, so the counter knows which label', () {
      expect(
        () => BarcodeMatch.fromResponse('6221', withoutFactor()),
        throwsA(
          isA<FormatException>().having(
            (error) => error.message,
            'message',
            contains('6221'),
          ),
        ),
      );
    });
  });

  /// The cases where factor 1 IS the truth, and must keep working.
  group('a base-unit scan still resolves to factor 1', () {
    test('an item barcode with no factor field is one base unit', () {
      final body = cartonResponse(matched: 'item');
      body.remove('factor');
      body['unit'] = 'علبة';
      final match = BarcodeMatch.fromResponse('WATER', body);
      expect(match.factor, Decimal.one);
      expect(match.isBaseUnit, isTrue);
      expect(match.matched, 'item');
    });

    test('an explicit factor of 1 is accepted as written', () {
      final body = cartonResponse(matched: 'item');
      body['unit'] = 'علبة';
      body['factor'] = '1.000000';
      final match = BarcodeMatch.fromResponse('WATER', body);
      expect(match.factor, Decimal.one);
    });

    test('a carton still carries its real factor, so nothing over-corrects', () {
      final match = BarcodeMatch.fromResponse('6221', cartonResponse());
      expect(match.factor, Decimal.fromInt(24));
      expect(match.unit, 'كرتونة');
    });

    test('a response with no usable unit at all is refused', () {
      final body = cartonResponse(matched: 'item');
      body.remove('unit');
      body.remove('factor');
      final item = Map<String, dynamic>.from(body['item'] as Map);
      item.remove('unit');
      body['item'] = item;
      expect(
        () => BarcodeMatch.fromResponse('X', body),
        throwsA(isA<FormatException>()),
      );
    });
  });

  group('a scanned label means one of its own unit', () {
    test('a carton scan carries the carton unit and its factor', () {
      final match = BarcodeMatch.fromResponse('6221', cartonResponse());

      expect(match.itemId, 'item-water');
      expect(match.unit, 'كرتونة');
      expect(match.factor, Decimal.fromInt(24));
      expect(match.matched, 'unit');
      expect(match.isBaseUnit, isFalse);
    });

    test('one scan adds one carton, not twenty-four pieces', () {
      // The whole defect this work exists to prevent: the quantity written to
      // the line is the scan count, and the factor is nowhere in it.
      final first = quantityAfterScan(current: null, sameSelection: false);
      expect(first, Decimal.one);
      expect(plainQuantity(first), '1');
    });

    test('scanning the same label again adds a second carton', () {
      var quantity = quantityAfterScan(current: null, sameSelection: false);
      for (var scan = 2; scan <= 3; scan++) {
        quantity = quantityAfterScan(current: quantity, sameSelection: true);
        expect(quantity, Decimal.fromInt(scan));
      }
      expect(plainQuantity(quantity), '3');
    });

    test('a scan of a different selection starts again at one', () {
      expect(
        quantityAfterScan(
          current: Decimal.fromInt(5),
          sameSelection: false,
        ),
        Decimal.one,
      );
    });

    test('a box holding something unreadable is treated as empty', () {
      expect(
        quantityAfterScan(current: null, sameSelection: true),
        Decimal.one,
      );
      expect(
        quantityAfterScan(current: Decimal.zero, sameSelection: true),
        Decimal.one,
      );
    });

    test('the base equivalent is shown from the factor, never posted', () {
      final match = BarcodeMatch.fromResponse('6221', cartonResponse());
      // Three scans: the line holds 3, and the shelf will move 72.
      expect(
        baseEquivalentLabel(
          item: match.item,
          unitName: match.unit,
          quantityText: '3',
        ),
        '3 كرتونة = 72 علبة',
      );
    });

    test('a base-unit line shows no equivalent, because it already is one', () {
      final match = BarcodeMatch.fromResponse('6221', cartonResponse());
      expect(
        baseEquivalentLabel(
          item: match.item,
          unitName: 'علبة',
          quantityText: '3',
        ),
        isNull,
      );
    });

    test('an unknown unit has no factor, so nothing is invented', () {
      final match = BarcodeMatch.fromResponse('6221', cartonResponse());
      expect(factorOfUnit(match.item, 'unknown'), isNull);
      expect(
        baseEquivalentLabel(
          item: match.item,
          unitName: 'unknown',
          quantityText: '2',
        ),
        isNull,
      );
    });

    test('units with different factors each convert to their own number', () {
      final item = {
        'unit': 'm',
        'units': [
          {'unit': 'm', 'factor': '1'},
          {'unit': 'reel', 'factor': '100'},
          {'unit': 'box', 'factor': '12.5'},
        ],
      };
      expect(
        baseEquivalentLabel(item: item, unitName: 'reel', quantityText: '2'),
        '2 reel = 200 m',
      );
      expect(
        baseEquivalentLabel(item: item, unitName: 'box', quantityText: '4'),
        '4 box = 50 m',
      );
    });
  });

  group('the default unit the catalogue names is the one a screen uses', () {
    test('carton marked as the sales default wins over the base unit', () {
      final match = BarcodeMatch.fromResponse(
        '6220',
        cartonResponse(matched: 'item'),
      );
      final unit = defaultScannedUnit(match, isSales: true);
      expect(unit, 'كرتونة');
    });

    test('purchase and sales defaults are read separately', () {
      final item = {
        'unit': 'piece',
        'units': [
          {'unit': 'piece', 'factor': '1'},
          {'unit': 'carton', 'factor': '24', 'isDefaultSale': true},
          {'unit': 'pallet', 'factor': '2400', 'isDefaultPurchase': true},
        ],
      };
      expect(
        defaultScannedUnit(
          BarcodeMatch.fromResponse('1', {'item': item, 'unit': 'piece'}),
          isSales: true,
        ),
        'carton',
      );
      expect(
        defaultScannedUnit(
          BarcodeMatch.fromResponse('1', {'item': item, 'unit': 'piece'}),
          isSales: false,
        ),
        'pallet',
      );
    });

    test('a unit barcode outranks the default, because it names the unit', () {
      final match = BarcodeMatch.fromResponse('6221', cartonResponse());
      // Even a catalogue whose default is the base unit must add a carton when
      // the carton's own label is scanned.
      expect(defaultScannedUnit(match, isSales: true), 'كرتونة');
    });

    test('an item with no default falls back to its own base unit', () {
      final item = {
        'unit': 'piece',
        'units': [
          {'unit': 'piece', 'factor': '1'},
          {'unit': 'carton', 'factor': '12'},
        ],
      };
      expect(
        defaultScannedUnit(
          BarcodeMatch.fromResponse('1', {'item': item}),
          isSales: true,
        ),
        'piece',
      );
    });
  });

  group('a failed read changes nothing', () {
    test('a truncated answer is not a usable match', () {
      expect(
        () => BarcodeMatch.fromResponse('6221', {'matched': 'unit'}),
        throwsA(isA<FormatException>()),
      );
      expect(
        () => BarcodeMatch.fromResponse('6221', {'item': {'code': 'X'}}),
        throwsA(isA<FormatException>()),
      );
      expect(
        () => BarcodeMatch.fromResponse('6221', null),
        throwsA(isA<FormatException>()),
      );
    });

    test('a legacy item with no unit list still resolves its base unit', () {
      final match = BarcodeMatch.fromResponse('6220', {
        'matched': 'item',
        'item': {'id': 'legacy', 'unit': 'piece'},
      });
      expect(match.unit, 'piece');
      expect(match.factor, Decimal.one);
    });

    test('an unknown code is named back to the operator', () {
      final arabic = unknownBarcodeMessage(
        const ApiFailure('Not found', statusCode: 404),
        '999',
        arabic: true,
      );
      expect(arabic, contains('999'));
      expect(arabic, contains('لا يوجد صنف'));

      final english = unknownBarcodeMessage(
        const ApiFailure('Not found', statusCode: 404),
        '999',
        arabic: false,
      );
      expect(english, contains('999'));
      expect(english, contains('No item or unit'));
    });

    test('a permission or network failure is never reported as a bad label', () {
      expect(
        unknownBarcodeMessage(
          const ApiFailure('Forbidden', statusCode: 403),
          '999',
          arabic: false,
        ),
        isNull,
      );
      expect(
        unknownBarcodeMessage(
          const ApiFailure('Server error', statusCode: 500),
          '999',
          arabic: true,
        ),
        isNull,
      );
    });
  });

  group('one physical press is one scan', () {
    test('the same code inside the window is a repeat', () {
      final at = DateTime(2026, 11, 6, 12);
      expect(
        isRepeatScan(
          lastCode: '6221',
          lastAt: at,
          code: '6221',
          inFlight: false,
          now: at.add(const Duration(milliseconds: 100)),
        ),
        isTrue,
      );
    });

    test('the same code after the window is a deliberate second scan', () {
      final at = DateTime(2026, 11, 6, 12);
      expect(
        isRepeatScan(
          lastCode: '6221',
          lastAt: at,
          code: '6221',
          inFlight: false,
          now: at.add(const Duration(seconds: 2)),
        ),
        isFalse,
      );
    });

    test('a different code is never a repeat', () {
      final at = DateTime(2026, 11, 6, 12);
      expect(
        isRepeatScan(
          lastCode: '6221',
          lastAt: at,
          code: '6222',
          inFlight: false,
          now: at.add(const Duration(milliseconds: 10)),
        ),
        isFalse,
      );
    });

    test('a scan already in flight blocks every further submit', () {
      expect(
        isRepeatScan(
          lastCode: '6221',
          lastAt: DateTime(2026, 11, 6, 12),
          code: '6222',
          inFlight: true,
        ),
        isTrue,
      );
    });
  });

  group('plainQuantity writes numbers an operator would type', () {
    test('trailing zeros disappear, a real fraction stays', () {
      expect(plainQuantity(Decimal.parse('1.000000')), '1');
      expect(plainQuantity(Decimal.parse('24.000000')), '24');
      expect(plainQuantity(Decimal.parse('0.5')), '0.5');
      expect(plainQuantity(Decimal.parse('12.2500')), '12.25');
    });
  });
}
