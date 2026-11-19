import { Prisma } from '@prisma/client';
import { orderConversionIdentity } from './order-conversion-identity';
const D = (value: string) => new Prisma.Decimal(value);
const key = 'order-conversion-12345678';

describe('order conversion retry identity', () => {
  it('requires a safe idempotency key and a string date', () => {
    expect(() => orderConversionIdentity({}, new Map([['a', D('1')]]))).toThrow(/idempotencyKey/);
    expect(() => orderConversionIdentity({ idempotencyKey: 'bad key' }, new Map([['a', D('1')]]))).toThrow(/idempotencyKey/);
    expect(() => orderConversionIdentity({ idempotencyKey: key, invoiceDate: 1 }, new Map([['a', D('1')]]))).toThrow(/invoiceDate/);
  });
  it('canonicalizes selection order and equivalent decimal quantities', () => {
    const a = orderConversionIdentity({ idempotencyKey: key, invoiceDate: '2026-11-04' }, new Map([['b', D('1.0')], ['a', D('2')]]));
    const b = orderConversionIdentity({ idempotencyKey: key, invoiceDate: '2026-11-04' }, new Map([['a', D('2.0000')], ['b', D('1')]]));
    expect(a).toEqual(b);
    expect(orderConversionIdentity({ idempotencyKey: key, invoiceDate: '2026-11-05' }, new Map([['a', D('2')], ['b', D('1')]])).hash).not.toEqual(a.hash);
    expect(orderConversionIdentity({ idempotencyKey: key, invoiceDate: '2026-11-04' }, new Map([['a', D('3')], ['b', D('1')]])).hash).not.toEqual(a.hash);
  });
});
