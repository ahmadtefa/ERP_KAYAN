import { Prisma } from '@prisma/client';

import { HrError } from './hr-rules';
import { bracketTax, calculateLine, loanInstalmentDue, PayrollInput, prorationFor } from './payroll-rules';

// Made-up test parameters, not law figures.
const settings = {
  siEmployeeRate: '10', siEmployerRate: '20', siCeiling: '4000', personalExemption: '12000', overtimeFactor: '1.5', monthDivisor: 30,
  taxBrackets: [
    { from: '0.0000', to: '10000.0000', ratePercent: '0.0000' },
    { from: '10000.0000', to: '50000.0000', ratePercent: '10.0000' },
    { from: '50000.0000', to: null, ratePercent: '20.0000' },
  ],
};
const base: PayrollInput = {
  month: '2026-03', hireDate: '2025-01-01', leaveDate: null, basic: '3000', coveredBySI: true, coveredByTax: true,
  items: [], attendance: null, settings, loanInstalment: '0',
};

describe('payroll line', () => {
  it('plain month: no extras', () => {
    const l = calculateLine(base);
    expect(l).toMatchObject({ basic: '3000.0000', gross: '3000.0000', employeeSI: '300.0000', employerSI: '600.0000' });
    // annual 36000 - exemption 12000 = 24000; (24000-10000)*10% = 1400; monthly 116.67
    expect(l.tax).toBe('116.6700');
    expect(l.net).toBe('2583.3300');
  });

  it('social insurance is capped at the ceiling', () => {
    const l = calculateLine({ ...base, basic: '9000' });
    expect(l.employeeSI).toBe('400.0000');
    expect(l.employerSI).toBe('800.0000');
  });

  it('absence, overtime and penalty change gross using the typed divisor and factor', () => {
    const l = calculateLine({ ...base, attendance: { absenceDays: '2', overtimeHours: '8', penaltyAmount: '50' } });
    expect(l.absenceDeduction).toBe('200.0000'); // 3000/30*2
    expect(l.overtime).toBe('150.0000'); // 3000/30/8*8*1.5
    expect(l.gross).toBe('2900.0000'); // 3000+150-200-50
  });

  it('allowance flags decide what counts for insurance and tax', () => {
    const l = calculateLine({
      ...base,
      items: [
        { kind: 'ALLOWANCE', amount: '600', subjectToSI: false, subjectToTax: false },
        { kind: 'ALLOWANCE', amount: '400', subjectToSI: true, subjectToTax: true },
      ],
    });
    expect(l.allowances).toBe('1000.0000');
    expect(l.gross).toBe('4000.0000');
    expect(l.employeeSI).toBe('340.0000'); // (3000+400)*10%
  });

  it('a fixed deduction and a loan instalment come off the net', () => {
    const l = calculateLine({ ...base, items: [{ kind: 'DEDUCTION', amount: '100', subjectToSI: true, subjectToTax: true }], loanInstalment: '250' });
    expect(l.deductions).toBe('100.0000');
    expect(l.net).toBe(String((3000 - 300 - 116.67 - 100 - 250).toFixed(4)));
  });

  it('a partial month is prorated by calendar days', () => {
    expect(prorationFor('2026-03', '2026-03-16', null).toFixed(6)).toBe('0.516129'); // 16 of 31 days
    expect(prorationFor('2026-03', '2025-01-01', '2026-03-10').toFixed(6)).toBe('0.322581'); // 10 of 31
    expect(prorationFor('2026-03', '2026-04-01', null).isZero()).toBe(true);
    const l = calculateLine({ ...base, hireDate: '2026-03-16' });
    expect(l.basic).toBe('1548.3900');
  });

  it('refuses a month the person was not employed, and negative pay', () => {
    expect(() => calculateLine({ ...base, hireDate: '2026-04-01' })).toThrow(HrError);
    expect(() => calculateLine({ ...base, attendance: { absenceDays: '31', overtimeHours: '0', penaltyAmount: '500' } })).toThrow(/more than the earnings/);
    expect(() => calculateLine({ ...base, loanInstalment: '99999' })).toThrow(/more than the pay/);
  });

  it('a person outside insurance and tax pays neither', () => {
    const l = calculateLine({ ...base, coveredBySI: false, coveredByTax: false });
    expect(l).toMatchObject({ employeeSI: '0.0000', employerSI: '0.0000', tax: '0.0000', net: '3000.0000' });
  });

  it('bracket tax adds across brackets, including the open last one', () => {
    expect(bracketTax(new Prisma.Decimal('60000'), settings.taxBrackets).toFixed(2)).toBe('6000.00'); // 40000*10% + 10000*20%
  });

  it('loan instalment is the plan amount, or what is left', () => {
    expect(loanInstalmentDue('1200', 12, '1200').toFixed(2)).toBe('100.00');
    expect(loanInstalmentDue('1200', 12, '60').toFixed(2)).toBe('60.00');
    expect(loanInstalmentDue('1200', 12, '0').toFixed(2)).toBe('0.00');
  });
});
