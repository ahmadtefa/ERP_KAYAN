import { Prisma } from '@prisma/client';

import {
  INTERNAL_BARCODE_PREFIX,
  ean13CheckDigit,
  fromBaseQuantity,
  internalBarcodePayload,
  isValidEan13,
  randomInternalBarcode,
  toBaseQuantity,
  withEan13CheckDigit,
} from './barcode';

describe('barcode check digits', () => {
  it('computes the documented EAN-13 check digit', () => {
    // A real EAN-13: 4006381333931 is a well-known valid code, and 5901234123457
    // is the example used in GS1 documentation.
    expect(withEan13CheckDigit('400638133393')).toBe('4006381333931');
    expect(isValidEan13('4006381333931')).toBe(true);
  });

  it('rejects a code whose last digit is wrong', () => {
    expect(isValidEan13('4006381333932')).toBe(false);
    expect(isValidEan13('400638133393')).toBe(false);
    expect(isValidEan13('not-a-barcode')).toBe(false);
    expect(ean13CheckDigit('590123412345')).toBe('7');
  });

  it('refuses to make a check digit for the wrong payload length', () => {
    expect(() => ean13CheckDigit('123')).toThrow(/12 digits/);
  });
});

describe('internal barcode generation', () => {
  it('uses the reserved internal prefix and keeps twelve digits', () => {
    expect(internalBarcodePayload(42)).toBe('200000000042');
    expect(internalBarcodePayload('42')).toHaveLength(12);
    expect(internalBarcodePayload(42).startsWith(INTERNAL_BARCODE_PREFIX)).toBe(true);
  });

  it('refuses a body that cannot fit', () => {
    expect(() => internalBarcodePayload('1234567890123')).toThrow(/too long/);
    expect(() => internalBarcodePayload('')).toThrow(/required/);
  });

  it('generates codes a scanner can read', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = randomInternalBarcode();
      expect(code).toHaveLength(13);
      expect(code.startsWith(INTERNAL_BARCODE_PREFIX)).toBe(true);
      expect(isValidEan13(code)).toBe(true);
    }
  });
});

describe('unit conversion', () => {
  it('turns cartons into base units with the saved factor, not an assumed one', () => {
    // A carton of 24, a box of 6: neither is guessed from the item's name.
    expect(toBaseQuantity(3, 24).toFixed(4)).toBe('72.0000');
    expect(toBaseQuantity(2, 6).toFixed(4)).toBe('12.0000');
  });

  it('keeps four decimals and rounds half up, so a part of a unit is not lost', () => {
    // One third of a dozen is four pieces exactly; one third of a box of 5 is
    // 1.6667 pieces, rounded rather than truncated to 1.6666.
    expect(toBaseQuantity('0.333333', 12).toFixed(4)).toBe('4.0000');
    expect(toBaseQuantity(1, '1.666666').toFixed(4)).toBe('1.6667');
  });

  it('converts a base balance back to the unit a person counts in', () => {
    expect(fromBaseQuantity(240, 24).toFixed(4)).toBe('10.0000');
    expect(fromBaseQuantity('1.0000', '3').toFixed(4)).toBe('0.3333');
    expect(() => fromBaseQuantity(10, 0)).toThrow(/zero/);
  });

  it('multiplies decimals exactly instead of through floating point', () => {
    const result = toBaseQuantity(new Prisma.Decimal('2.5'), new Prisma.Decimal('7.25'));
    expect(result.toFixed(4)).toBe('18.1250');
  });
});
