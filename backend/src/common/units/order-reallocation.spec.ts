import { Prisma } from '@prisma/client';
import { planOrderReallocation } from './order-reallocation';
const d = (v: number) => new Prisma.Decimal(v);

describe('order reallocation', () => {
  const lines = [{id:'a', quantity:d(10), invoicedQuantity:d(7)}, {id:'b',quantity:d(5),invoicedQuantity:d(1)}];
  const old = [{orderLineId:'a',quantity:d(4)},{orderLineId:'b',quantity:d(1)}];
  it('keeps other invoice allocations while replacing selected quantities', () => {
    const result = planOrderReallocation(lines,old,new Map([['a',d(2)],['b',d(3)]]));
    expect(result.get('a')?.toString()).toBe('5');
    expect(result.get('b')?.toString()).toBe('3');
  });
  it('rejects exceeding actual remaining quantity', () => {
    expect(() => planOrderReallocation(lines,old,new Map([['a',d(8)]]))).toThrow(/exceeds/);
  });
  it('fails closed when historical allocations are missing or inconsistent', () => {
    expect(() => planOrderReallocation(lines,[{orderLineId:null,quantity:d(1)}],new Map())).toThrow(/manual review/);
    expect(() => planOrderReallocation(lines,[{orderLineId:'a',quantity:d(8)}],new Map())).toThrow(/manual review/);
  });
});
