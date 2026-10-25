import { Prisma } from '@prisma/client';
import { applyInvoiceDiscount } from './invoice-discount';

describe('applyInvoiceDiscount', () => {
  it('applies a percentage before tax and keeps the invoice line allocation', () => {
    const result = applyInvoiceDiscount([
      {
        lineTotal: new Prisma.Decimal('100.0000'),
        taxAmount: new Prisma.Decimal('14.0000'),
        landedCostAmount: new Prisma.Decimal('5.0000'),
        inventoryCostTotal: new Prisma.Decimal('105.0000'),
      },
    ], '10', '0');

    expect(result.discountPercent.toFixed(4)).toBe('10.0000');
    expect(result.discountAmount.toFixed(4)).toBe('10.0000');
    expect(result.lines[0].lineTotal.toFixed(4)).toBe('90.0000');
    expect(result.lines[0].taxAmount.toFixed(4)).toBe('12.6000');
    expect(result.lines[0].discountAmount.toFixed(4)).toBe('10.0000');
    expect(result.lines[0].inventoryCostTotal?.toFixed(4)).toBe('95.0000');
  });

  it('allocates a fixed discount proportionally and reconciles exactly', () => {
    const result = applyInvoiceDiscount([
      { lineTotal: new Prisma.Decimal('100'), taxAmount: new Prisma.Decimal('10') },
      { lineTotal: new Prisma.Decimal('200'), taxAmount: new Prisma.Decimal('20') },
    ], '0', '30');

    expect(result.discountAmount.toFixed(4)).toBe('30.0000');
    expect(result.lines.map(line => line.discountAmount.toFixed(4))).toEqual([
      '10.0000',
      '20.0000',
    ]);
    expect(result.lines.map(line => line.lineTotal.toFixed(4))).toEqual([
      '90.0000',
      '180.0000',
    ]);
    expect(result.lines.map(line => line.taxAmount.toFixed(4))).toEqual([
      '9.0000',
      '18.0000',
    ]);
  });

  it('rejects discounts above subtotal and simultaneous percentage/fixed values', () => {
    const lines = [
      { lineTotal: new Prisma.Decimal('100'), taxAmount: new Prisma.Decimal('14') },
    ];
    expect(() => applyInvoiceDiscount(lines, '0', '101')).toThrow(
      'discountAmount cannot exceed the invoice subtotal',
    );
    expect(() => applyInvoiceDiscount(lines, '5', '1')).toThrow(
      'Choose either a percentage discount or a fixed discount, not both',
    );
    expect(() => applyInvoiceDiscount(lines, '101', '0')).toThrow(
      'discountPercent must be between 0 and 100',
    );
  });
});
