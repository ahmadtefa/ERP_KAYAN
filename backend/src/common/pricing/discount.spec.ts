import { Prisma } from '@prisma/client';

import {
  allocateDocumentDiscount,
  assertDiscountLimit,
  DiscountError,
  effectiveDiscountPercent,
  resolveDiscount,
} from './discount';

const D = (value: string | number) => new Prisma.Decimal(value);
const sum = (values: Prisma.Decimal[]) =>
  values.reduce((total, value) => total.plus(value), D(0));

describe('invoice and quotation discounts', () => {
  describe('resolveDiscount', () => {
    it('turns a percentage into an exact amount before tax', () => {
      const result = resolveDiscount(D('1000'), { type: 'PERCENT', percent: '12.5' });
      expect(result.type).toBe('PERCENT');
      expect(result.amount.toFixed(4)).toBe('125.0000');
      expect(result.net.toFixed(4)).toBe('875.0000');
      expect(result.percent.toFixed(4)).toBe('12.5000');
    });

    it('keeps a fixed amount exactly as typed and derives the percentage', () => {
      const result = resolveDiscount(D('250'), { type: 'AMOUNT', amount: '37.5000' });
      expect(result.type).toBe('AMOUNT');
      expect(result.amount.toFixed(4)).toBe('37.5000');
      expect(result.net.toFixed(4)).toBe('212.5000');
      expect(result.percent.toFixed(4)).toBe('15.0000');
    });

    it('accepts the old shape, where only a percent was sent', () => {
      const result = resolveDiscount(D('100'), { percent: '10' });
      expect(result.type).toBe('PERCENT');
      expect(result.amount.toFixed(4)).toBe('10.0000');
    });

    it('accepts a fixed amount sent without a type', () => {
      const result = resolveDiscount(D('100'), { amount: '10' });
      expect(result.type).toBe('AMOUNT');
      expect(result.percent.toFixed(4)).toBe('10.0000');
    });

    it('reports no discount when nothing was asked for', () => {
      const result = resolveDiscount(D('100'), {});
      expect(result.type).toBeNull();
      expect(result.amount.toFixed(4)).toBe('0.0000');
      expect(result.net.toFixed(4)).toBe('100.0000');
    });

    it('refuses a discount larger than the value it applies to', () => {
      expect(() => resolveDiscount(D('10'), { type: 'AMOUNT', amount: '10.0001' }))
        .toThrow(DiscountError);
      expect(() => resolveDiscount(D('10'), { type: 'PERCENT', percent: '100.0001' }))
        .toThrow(DiscountError);
    });

    it('refuses negative values', () => {
      expect(() => resolveDiscount(D('10'), { type: 'AMOUNT', amount: '-1' }))
        .toThrow(/negative/);
      expect(() => resolveDiscount(D('10'), { type: 'PERCENT', percent: '-1' }))
        .toThrow(/negative/);
      expect(() => resolveDiscount(D('-1'), { type: 'PERCENT', percent: '1' }))
        .toThrow(/base cannot be negative/);
    });

    it('refuses an unknown type rather than guessing', () => {
      expect(() => resolveDiscount(D('10'), { type: 'BOGO' })).toThrow(/Unknown discount type/);
    });

    it('rounds the resolved amount to four decimal places, never binary floats', () => {
      const result = resolveDiscount(D('0.3333'), { type: 'PERCENT', percent: '33.3333' });
      expect(result.amount.toFixed(4)).toBe('0.1111');
      expect(result.net.toFixed(4)).toBe('0.2222');
    });
  });

  describe('allocateDocumentDiscount', () => {
    it('spreads a document discount in proportion to net line value', () => {
      const { discount, shares } = allocateDocumentDiscount(
        [D('100'), D('200'), D('300')],
        { type: 'PERCENT', percent: '10' },
      );
      expect(discount.amount.toFixed(4)).toBe('60.0000');
      expect(shares.map((share) => share.toFixed(4))).toEqual([
        '10.0000', '20.0000', '30.0000',
      ]);
      expect(sum(shares).toFixed(4)).toBe(discount.amount.toFixed(4));
    });

    it('assigns every rounding unit so the shares add up to the discount exactly', () => {
      const { discount, shares } = allocateDocumentDiscount(
        [D('1'), D('1'), D('1')],
        { type: 'AMOUNT', amount: '0.0100' },
      );
      expect(discount.amount.toFixed(4)).toBe('0.0100');
      expect(sum(shares).toFixed(4)).toBe('0.0100');
      expect(shares.map((share) => share.toFixed(4))).toEqual([
        '0.0034', '0.0033', '0.0033',
      ]);
    });

    it('does not give a discount to a line worth nothing', () => {
      const { shares } = allocateDocumentDiscount(
        [D('0'), D('50'), D('50')],
        { type: 'AMOUNT', amount: '10' },
      );
      expect(shares.map((share) => share.toFixed(4))).toEqual([
        '0.0000', '5.0000', '5.0000',
      ]);
    });

    it('refuses a discount when there is nothing to discount', () => {
      expect(() => allocateDocumentDiscount([D('0'), D('0')], { type: 'AMOUNT', amount: '1' }))
        .toThrow(DiscountError);
    });

    it('leaves the lines untouched when there is no document discount', () => {
      const { shares, discount } = allocateDocumentDiscount([D('10'), D('20')], {});
      expect(discount.amount.toFixed(4)).toBe('0.0000');
      expect(shares.map((share) => share.toFixed(4))).toEqual(['0.0000', '0.0000']);
    });
  });

  describe('limit enforcement', () => {
    it('measures the combined discount against the gross value', () => {
      expect(effectiveDiscountPercent(D('1000'), D('150')).toFixed(4)).toBe('15.0000');
      expect(effectiveDiscountPercent(D('0'), D('1')).toFixed(4)).toBe('0.0000');
    });

    it('refuses anything above the company maximum', () => {
      expect(() => assertDiscountLimit(D('15'), D('10'), 'Line 1'))
        .toThrow(/exceeds the company maximum/);
      expect(() => assertDiscountLimit(D('10'), D('10'), 'Line 1')).not.toThrow();
    });
  });
});
