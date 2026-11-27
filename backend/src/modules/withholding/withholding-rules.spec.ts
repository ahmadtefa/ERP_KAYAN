import { Prisma } from '@prisma/client';

import {
  applyWithholdingToLines,
  directionFor,
  parseRate,
  withheldAmount,
  WithholdingError,
} from './withholding-rules';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const sum = (lines: any[], side: 'debit' | 'credit') => lines.reduce((a, l) => a.plus(l[side] ?? 0), D(0));

describe('withholding tax rules', () => {
  it('computes the tax to the piastre, halves up', () => {
    expect(withheldAmount('1000', '1').toFixed(2)).toBe('10.00');
    expect(withheldAmount('1000', '5').toFixed(2)).toBe('50.00');
    expect(withheldAmount('333.33', '1').toFixed(2)).toBe('3.33');
    expect(withheldAmount('150.50', '1').toFixed(2)).toBe('1.51');
    expect(withheldAmount('100', '0.5').toFixed(2)).toBe('0.50');
  });

  it('refuses a tax that rounds to nothing or swallows the voucher', () => {
    expect(() => withheldAmount('0.10', '1')).toThrow(WithholdingError);
    expect(() => withheldAmount('100', '100')).toThrow(WithholdingError);
    expect(() => withheldAmount('0', '1')).toThrow(WithholdingError);
  });

  it('accepts only sane rates', () => {
    expect(parseRate('1').toString()).toBe('1');
    expect(parseRate('0.5').toString()).toBe('0.5');
    for (const bad of ['', '0', '-1', '100.5', 'abc', '1e2', '5%', '1.23456']) {
      expect(() => parseRate(bad)).toThrow(WithholdingError);
    }
  });

  it('picks the direction from the voucher kind and party', () => {
    expect(directionFor('PAYMENT', false, true)).toBe('PAYABLE');
    expect(directionFor('RECEIPT', true, false)).toBe('RECEIVABLE');
    expect(() => directionFor('PAYMENT', true, false)).toThrow(WithholdingError);
    expect(() => directionFor('RECEIPT', false, true)).toThrow(WithholdingError);
    expect(() => directionFor('PAYMENT', false, false)).toThrow(WithholdingError);
  });

  it('a supplier payment pays the net in cash, owes the tax, and still balances', () => {
    const lines = [
      { accountId: 'ap', debit: D(1000), description: 'Settlement' },
      { accountId: 'cash', credit: D(1000), description: 'Payment' },
    ];
    const out = applyWithholdingToLines(lines, 'cash', 'PAYABLE', D(10), 'wht-payable');
    expect(out.find((l) => l.accountId === 'cash')!.credit!.toFixed(2)).toBe('990.00');
    expect(out.find((l) => l.accountId === 'wht-payable')!.credit!.toFixed(2)).toBe('10.00');
    expect(out.find((l) => l.accountId === 'ap')!.debit!.toFixed(2)).toBe('1000.00');
    expect(sum(out, 'debit').equals(sum(out, 'credit'))).toBe(true);
    // the input was not changed
    expect(lines[1].credit!.toFixed(2)).toBe('1000.00');
  });

  it('a customer receipt receives the net in cash, keeps the tax as a claim, and balances', () => {
    const lines = [
      { accountId: 'cash', debit: D(2000), description: 'Receipt' },
      { accountId: 'ar', credit: D(2000), description: 'Settlement' },
    ];
    const out = applyWithholdingToLines(lines, 'cash', 'RECEIVABLE', D(20), 'wht-receivable');
    expect(out.find((l) => l.accountId === 'cash')!.debit!.toFixed(2)).toBe('1980.00');
    expect(out.find((l) => l.accountId === 'wht-receivable')!.debit!.toFixed(2)).toBe('20.00');
    expect(out.find((l) => l.accountId === 'ar')!.credit!.toFixed(2)).toBe('2000.00');
    expect(sum(out, 'debit').equals(sum(out, 'credit'))).toBe(true);
  });

  it('refuses to adjust a voucher with no cash line', () => {
    expect(() => applyWithholdingToLines([{ accountId: 'ap', debit: D(10), description: 'x' }], 'cash', 'PAYABLE', D(1), 't')).toThrow(WithholdingError);
  });
});
