import { addMonths, allocatePaid, daysLate, InstallmentError, parseMoney, planInstallments } from './installment-rules';

const base = { totalPiasters: 1_000_000, downPaymentPiasters: 0, count: 4, intervalMonths: 1, firstDue: '2026-02-15', invoiceDate: '2026-01-15' };

describe('installment rules', () => {
  it('splits evenly and the sum equals the total', () => {
    const p = planInstallments(base);
    expect(p.map((x) => x.amountPiasters)).toEqual([250_000, 250_000, 250_000, 250_000]);
    expect(p.map((x) => x.dueDate)).toEqual(['2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15']);
  });
  it('puts the odd piasters on the last installment', () => {
    const p = planInstallments({ ...base, totalPiasters: 1_000_001, count: 3 });
    expect(p.map((x) => x.amountPiasters)).toEqual([333_333, 333_333, 333_335]);
    expect(p.reduce((s, x) => s + x.amountPiasters, 0)).toBe(1_000_001);
  });
  it('adds a down payment due on the invoice date', () => {
    const p = planInstallments({ ...base, downPaymentPiasters: 200_000 });
    expect(p[0]).toMatchObject({ no: 1, isDownPayment: true, dueDate: '2026-01-15', amountPiasters: 200_000 });
    expect(p).toHaveLength(5);
    expect(p.reduce((s, x) => s + x.amountPiasters, 0)).toBe(1_000_000);
  });
  it('keeps month ends in range', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(planInstallments({ ...base, firstDue: '2026-01-31' }).map((x) => x.dueDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('refuses nonsense', () => {
    for (const bad of [
      { count: 1 }, { count: 121 }, { count: 2.5 }, { intervalMonths: 0 }, { intervalMonths: 13 },
      { downPaymentPiasters: 1_000_000 }, { downPaymentPiasters: -1 }, { totalPiasters: 0 }, { firstDue: '2026-01-14' },
      { firstDue: '2026-02-30' }, { firstDue: 'soon' }, { totalPiasters: 3, count: 4 },
    ]) expect(() => planInstallments({ ...base, ...bad })).toThrow(InstallmentError);
  });
  it('allocates payments oldest first and sets the status', () => {
    const a = allocatePaid(planInstallments(base), 300_000, '2026-03-20');
    expect(a.map((x) => [x.paidPiasters, x.status])).toEqual([[250_000, 'PAID'], [50_000, 'OVERDUE'], [0, 'UPCOMING'], [0, 'UPCOMING']]);
  });
  it('an installment part paid and not yet due is PARTIAL', () => {
    const a = allocatePaid(planInstallments(base), 300_000, '2026-02-01');
    expect(a.map((x) => x.status)).toEqual(['PAID', 'PARTIAL', 'UPCOMING', 'UPCOMING']);
    expect(a[1].remainingPiasters).toBe(200_000);
  });
  it('overpayment cannot make a negative remainder', () => {
    const a = allocatePaid(planInstallments(base), 99_999_999, '2030-01-01');
    expect(a.every((x) => x.status === 'PAID' && x.remainingPiasters === 0)).toBe(true);
    expect(allocatePaid(planInstallments(base), -5, '2026-01-01').every((x) => x.paidPiasters === 0)).toBe(true);
  });
  it('counts days late', () => {
    expect(daysLate('2026-03-01', '2026-03-11')).toBe(10);
    expect(daysLate('2026-03-01', '2026-03-01')).toBe(0);
    expect(daysLate('2026-03-11', '2026-03-01')).toBe(0);
    expect(daysLate('2026-02-28', '2026-03-01')).toBe(1);
  });
  it('reads money strictly', () => {
    expect(parseMoney('12.5')).toBe(1250);
    expect(parseMoney('0')).toBe(0);
    for (const bad of ['', '-1', '1.234', 'x', '1,5']) expect(() => parseMoney(bad)).toThrow(InstallmentError);
  });
});
