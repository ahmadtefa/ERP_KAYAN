import { Prisma } from '@prisma/client';
import { planDraftOrderEdit } from './order-draft-edit';
const D = (value: string) => new Prisma.Decimal(value);
const original = () => [{ id:'line-1', quantity:D('30'), invoicedQuantity:D('0'),
  unitName:'carton', unitFactor:D('10'), unitQuantity:D('3') }];
const input = () => [{ orderLineId:'line-1', quantity:'2', unitPrice:'100', discountPercent:'5', taxRate:'14' }];

describe('draft order edit arithmetic and historical unit policy', () => {
  it('reuses the stored factor and computes quantity, discount and tax exactly', () => {
    const result = planDraftOrderEdit(original(), input());
    expect(result.lines[0].quantity.toFixed(4)).toBe('20.0000');
    expect(result.lines[0].unitQuantity?.toFixed(4)).toBe('2.0000');
    expect(result.subTotal.toFixed(4)).toBe('190.0000');
    expect(result.taxAmount.toFixed(4)).toBe('26.6000');
    expect(result.totalAmount.toFixed(4)).toBe('216.6000');
  });
  it('fails closed on existing allocations or corrupt unit snapshots', () => {
    expect(() => planDraftOrderEdit([{...original()[0], invoicedQuantity:D('1')}], input())).toThrow(/Allocated/);
    expect(() => planDraftOrderEdit([{...original()[0], unitQuantity:D('4')}], input())).toThrow(/Inconsistent/);
    expect(() => planDraftOrderEdit([{...original()[0], unitFactor:null}], input())).toThrow(/Incomplete/);
  });
  it('rejects foreign, omitted or duplicate lines and invalid money or precision', () => {
    expect(() => planDraftOrderEdit(original(), [])).toThrow();
    expect(() => planDraftOrderEdit(original(), [{...input()[0],orderLineId:'foreign'}])).toThrow();
    expect(() => planDraftOrderEdit(original(), [{...input()[0],quantity:'0.00001'}])).toThrow();
    expect(() => planDraftOrderEdit(original(), [{...input()[0],unitPrice:'NaN'}])).toThrow();
    expect(() => planDraftOrderEdit(original(), [{...input()[0],taxRate:'101'}])).toThrow();
    expect(() => planDraftOrderEdit(original(), [{...input()[0],unitPrice:'0.00001'}])).toThrow();
  });
});

describe('approved order amendment safeguards', () => {
  const allocated = () => [{...original()[0], invoicedQuantity:D('20'), unitPrice:D('100'), discountPercent:D('5'), taxRate:D('14')}];
  it('allows an allocation-preserving quantity, but not below invoiced quantity', () => {
    expect(planDraftOrderEdit(allocated(), input(), true).lines[0].quantity.toFixed(4)).toBe('20.0000');
    expect(() => planDraftOrderEdit(allocated(), [{...input()[0],quantity:'1'}], true)).toThrow(/less than the allocated/);
  });
  it('does not reprice already allocated lines', () => {
    for (const change of [{unitPrice:'101'}, {discountPercent:'6'}, {taxRate:'15'}]) {
      expect(() => planDraftOrderEdit(allocated(), [{...input()[0],...change}], true)).toThrow(/Financial terms/);
    }
  });
});
