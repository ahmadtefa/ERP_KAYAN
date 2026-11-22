import { Prisma } from '@prisma/client';
import { assertActiveOrderAllocations } from './order-amendment-allocation';
const D = (n:string) => new Prisma.Decimal(n);
const lines = [{id:'one', invoicedQuantity:D('5')}, {id:'two', invoicedQuantity:D('0')}];
describe('approved amendment allocation reconciliation', () => {
  it('accepts only counters matching active invoice lines', () => {
    expect(() => assertActiveOrderAllocations(lines, [{lines:[{orderLineId:'one',quantity:D('5')}]}])).not.toThrow();
    expect(() => assertActiveOrderAllocations(lines, [])).toThrow(/inconsistent/);
    expect(() => assertActiveOrderAllocations(lines, [{lines:[{orderLineId:null,quantity:D('5')}]}])).toThrow(/invalid/);
    expect(() => assertActiveOrderAllocations(lines, [{lines:[{orderLineId:'two',quantity:D('5')}]}])).toThrow(/inconsistent/);
    expect(() => assertActiveOrderAllocations(lines, [{lines:[]}])).toThrow(/missing/);
  });
});
