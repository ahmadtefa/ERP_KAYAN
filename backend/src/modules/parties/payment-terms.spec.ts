import {
  computeDueSchedule,
  overdueMinor,
  PAYMENT_TERM_METHODS,
  PaymentTerm,
  PaymentTermError,
  penaltyMinor,
  splitAmount,
  validatePaymentTerm,
} from './payment-terms';

const due = (term: PaymentTerm, invoice: string, delivery?: string) => computeDueSchedule(term, invoice, delivery).lastDueDate;

describe('payment terms: the 12 methods on real dates', () => {
  it('lists exactly twelve methods', () => {
    expect(PAYMENT_TERM_METHODS).toHaveLength(12);
  });

  describe('1 from the invoice date', () => {
    it('adds the days', () => expect(due({ method: 'FROM_INVOICE_DATE', days: 30 }, '2026-01-15')).toBe('2026-02-14'));
    it('crosses a month end', () => expect(due({ method: 'FROM_INVOICE_DATE', days: 30 }, '2026-01-31')).toBe('2026-03-02'));
    it('crosses a leap February', () => expect(due({ method: 'FROM_INVOICE_DATE', days: 1 }, '2028-02-28')).toBe('2028-02-29'));
    it('crosses a non-leap February', () => expect(due({ method: 'FROM_INVOICE_DATE', days: 1 }, '2026-02-28')).toBe('2026-03-01'));
    it('zero days is the invoice day', () => expect(due({ method: 'FROM_INVOICE_DATE', days: 0 }, '2026-06-10')).toBe('2026-06-10'));
    it('crosses a year end', () => expect(due({ method: 'FROM_INVOICE_DATE', days: 15 }, '2026-12-25')).toBe('2027-01-09'));
  });

  describe('2 from the end of the invoice month', () => {
    const t = (days: number): PaymentTerm => ({ method: 'FROM_MONTH_END', days });
    it('31-day month', () => expect(due(t(30), '2026-01-10')).toBe('2026-03-02'));
    it('30-day month', () => expect(due(t(0), '2026-04-10')).toBe('2026-04-30'));
    it('February, non-leap', () => expect(due(t(0), '2026-02-03')).toBe('2026-02-28'));
    it('February, leap', () => expect(due(t(0), '2028-02-03')).toBe('2028-02-29'));
    it('invoice on the last day', () => expect(due(t(30), '2026-04-30')).toBe('2026-05-30'));
    it('December into the next year', () => expect(due(t(15), '2026-12-05')).toBe('2027-01-15'));
  });

  describe('3 from the start of the next month', () => {
    const t = (days: number): PaymentTerm => ({ method: 'FROM_NEXT_MONTH_START', days });
    it('ordinary', () => expect(due(t(0), '2026-03-17')).toBe('2026-04-01'));
    it('plus days', () => expect(due(t(30), '2026-03-17')).toBe('2026-05-01'));
    it('December', () => expect(due(t(0), '2026-12-31')).toBe('2027-01-01'));
    it('January 31 plus 30 days passes a short February', () => expect(due(t(30), '2026-01-31')).toBe('2026-03-03'));
  });

  describe('4 from the delivery or receipt date', () => {
    const t: PaymentTerm = { method: 'FROM_DELIVERY_DATE', days: 14 };
    it('counts from delivery', () => expect(due(t, '2026-03-01', '2026-03-10')).toBe('2026-03-24'));
    it('falls back to the invoice date without a delivery date', () => expect(due(t, '2026-03-01')).toBe('2026-03-15'));
    it('delivery in the next year', () => expect(due(t, '2026-12-28', '2027-01-03')).toBe('2027-01-17'));
    it('rejects an impossible delivery date', () => expect(() => due(t, '2026-03-01', '2026-02-30')).toThrow(PaymentTermError));
  });

  describe('5 fixed day of the next month', () => {
    const t = (day: number, days = 0): PaymentTerm => ({ method: 'FIXED_DAY_NEXT_MONTH', days, config: { dayOfMonth: day } });
    it('the 10th', () => expect(due(t(10), '2026-03-25')).toBe('2026-04-10'));
    it('day 31 in a 30-day month becomes the 30th', () => expect(due(t(31), '2026-03-25')).toBe('2026-04-30'));
    it('day 30 in a non-leap February becomes the 28th', () => expect(due(t(30), '2026-01-20')).toBe('2026-02-28'));
    it('day 30 in a leap February becomes the 29th', () => expect(due(t(30), '2028-01-20')).toBe('2028-02-29'));
    it('December goes to January', () => expect(due(t(5), '2026-12-20')).toBe('2027-01-05'));
    it('plus days', () => expect(due(t(10, 5), '2026-03-25')).toBe('2026-04-15'));
    it('needs the day', () => expect(() => validatePaymentTerm({ method: 'FIXED_DAY_NEXT_MONTH', days: 0 })).toThrow(PaymentTermError));
    it('rejects day 32', () => expect(() => validatePaymentTerm(t(32))).toThrow(PaymentTermError));
  });

  describe('6 early-payment discount (2/10 net 30)', () => {
    const t: PaymentTerm = { method: 'EARLY_DISCOUNT', days: 30, config: { discountPercent: 2, discountDays: 10 } };
    it('net date is the invoice date plus 30', () => expect(due(t, '2026-03-01')).toBe('2026-03-31'));
    it('discount runs to the invoice date plus 10', () => {
      expect(computeDueSchedule(t, '2026-03-01').discount).toEqual({ percent: 2, lastDay: '2026-03-11' });
    });
    it('discount window crossing a leap February', () => {
      expect(computeDueSchedule(t, '2028-02-25').discount?.lastDay).toBe('2028-03-06');
    });
    it('the discount period must be shorter than the net period', () => {
      expect(() => validatePaymentTerm({ ...t, config: { discountPercent: 2, discountDays: 30 } })).toThrow(PaymentTermError);
    });
    it('needs both numbers', () => expect(() => validatePaymentTerm({ method: 'EARLY_DISCOUNT', days: 30 })).toThrow(PaymentTermError));
  });

  describe('7 cash on delivery or in advance', () => {
    const t = (days: number): PaymentTerm => ({ method: 'COD_ADVANCE', days });
    it('due the invoice day', () => expect(due(t(0), '2026-03-01')).toBe('2026-03-01'));
    it('a few days of grace', () => expect(due(t(3), '2026-03-30')).toBe('2026-04-02'));
  });

  describe('8 percentage installments, advance plus balance', () => {
    const t: PaymentTerm = {
      method: 'INSTALLMENTS',
      days: 0,
      config: { installments: [{ percent: 30, afterDays: 0 }, { percent: 70, afterDays: 45 }] },
    };
    it('advance today, balance after 45 days', () => {
      const s = computeDueSchedule(t, '2026-01-20');
      expect(s.shares.map((x) => [x.dueDate, x.percent])).toEqual([['2026-01-20', 30], ['2026-03-06', 70]]);
      expect(s.firstDueDate).toBe('2026-01-20');
      expect(s.lastDueDate).toBe('2026-03-06');
    });
    it('days shifts every share', () => {
      const s = computeDueSchedule({ ...t, days: 5 }, '2026-01-20');
      expect(s.shares.map((x) => x.dueDate)).toEqual(['2026-01-25', '2026-03-11']);
    });
    it('three shares in a leap year', () => {
      const s = computeDueSchedule(
        { method: 'INSTALLMENTS', days: 0, config: { installments: [{ percent: 25, afterDays: 0 }, { percent: 25, afterDays: 30 }, { percent: 50, afterDays: 60 }] } },
        '2028-01-31',
      );
      expect(s.shares.map((x) => x.dueDate)).toEqual(['2028-01-31', '2028-03-01', '2028-03-31']);
    });
    it('shares must add up to 100', () => {
      expect(() => validatePaymentTerm({ ...t, config: { installments: [{ percent: 30, afterDays: 0 }, { percent: 60, afterDays: 45 }] } })).toThrow('exactly 100');
    });
    it('needs at least two shares', () => {
      expect(() => validatePaymentTerm({ ...t, config: { installments: [{ percent: 100, afterDays: 0 }] } })).toThrow(PaymentTermError);
    });
    it('1/3 splits add up to the total', () => {
      const parts = splitAmount(10000, [{ percent: 33.33 }, { percent: 33.33 }, { percent: 33.34 }]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(10000);
      expect(parts).toEqual([3333, 3333, 3334]);
    });
    it('an odd total still adds up', () => {
      const parts = splitAmount(10001, [{ percent: 30 }, { percent: 70 }]);
      expect(parts).toEqual([3000, 7001]);
    });
  });

  describe('9 day-of-month windows', () => {
    const t: PaymentTerm = {
      method: 'DAY_WINDOWS',
      days: 0,
      config: {
        windows: [
          { fromDay: 1, toDay: 10, payDay: 20, monthOffset: 0 },
          { fromDay: 11, toDay: 20, payDay: 5, monthOffset: 1 },
          { fromDay: 21, toDay: 31, payDay: 15, monthOffset: 1 },
        ],
      },
    };
    it('first window pays on the 20th of the same month', () => expect(due(t, '2026-03-04')).toBe('2026-03-20'));
    it('second window pays on the 5th of the next month', () => expect(due(t, '2026-03-11')).toBe('2026-04-05'));
    it('last day of the second window', () => expect(due(t, '2026-03-20')).toBe('2026-04-05'));
    it('third window on the 31st', () => expect(due(t, '2026-03-31')).toBe('2026-04-15'));
    it('third window in December rolls the year', () => expect(due(t, '2026-12-28')).toBe('2027-01-15'));
    it('a pay day beyond a short month is clamped', () => {
      const clamp: PaymentTerm = {
        method: 'DAY_WINDOWS',
        days: 0,
        config: { windows: [{ fromDay: 1, toDay: 31, payDay: 31, monthOffset: 1 }] },
      };
      expect(due(clamp, '2026-01-10')).toBe('2026-02-28');
    });
    it('plus days', () => expect(due({ ...t, days: 3 }, '2026-03-04')).toBe('2026-03-23'));
    it('windows must not overlap', () => {
      expect(() => validatePaymentTerm({ ...t, config: { windows: [{ fromDay: 1, toDay: 15, payDay: 1, monthOffset: 0 }, { fromDay: 15, toDay: 31, payDay: 1, monthOffset: 0 }] } })).toThrow('overlap');
    });
    it('windows must cover every day', () => {
      expect(() => validatePaymentTerm({ ...t, config: { windows: [{ fromDay: 1, toDay: 15, payDay: 1, monthOffset: 0 }] } })).toThrow('belong');
    });
  });

  describe('10 milestone (stage) payments', () => {
    const t: PaymentTerm = {
      method: 'MILESTONES',
      days: 0,
      config: {
        installments: [
          { percent: 40, afterDays: 0, label: 'On order' },
          { percent: 40, afterDays: 30, label: 'On delivery' },
          { percent: 20, afterDays: 90, label: 'On acceptance' },
        ],
      },
    };
    it('keeps the stage names and dates', () => {
      const s = computeDueSchedule(t, '2026-11-30');
      expect(s.shares).toEqual([
        { dueDate: '2026-11-30', percent: 40, label: 'On order' },
        { dueDate: '2026-12-30', percent: 40, label: 'On delivery' },
        { dueDate: '2027-02-28', percent: 20, label: 'On acceptance' },
      ]);
    });
    it('every stage needs a name', () => {
      expect(() => validatePaymentTerm({ ...t, config: { installments: [{ percent: 50, afterDays: 0 }, { percent: 50, afterDays: 5 }] } })).toThrow('name');
    });
  });

  describe('11 late-payment penalty (companion)', () => {
    const t: PaymentTerm = { method: 'LATE_PENALTY', days: 30, config: { penalty: { percent: 1, period: 'MONTH', graceDays: 5 } } };
    it('due date is a plain term', () => expect(due(t, '2026-01-31')).toBe('2026-03-02'));
    it('needs its rate', () => expect(() => validatePaymentTerm({ method: 'LATE_PENALTY', days: 30 })).toThrow('rate'));
    it('no penalty inside the grace days', () => expect(penaltyMinor(100000, '2026-03-02', '2026-03-07', t.config!.penalty!)).toBe(0));
    it('a started month is charged', () => expect(penaltyMinor(100000, '2026-03-02', '2026-03-08', t.config!.penalty!)).toBe(1000));
    it('64 late days after grace are three started months', () => expect(penaltyMinor(100000, '2026-03-02', '2026-05-10', t.config!.penalty!)).toBe(3000));
    it('per day', () => expect(penaltyMinor(200000, '2026-02-28', '2026-03-03', { percent: 0.5, period: 'DAY', graceDays: 0 })).toBe(3000));
    it('nothing owed, nothing charged', () => expect(penaltyMinor(0, '2026-02-28', '2026-03-30', { percent: 1, period: 'DAY', graceDays: 0 })).toBe(0));
    it('also usable as an add-on to another method', () => {
      const v = validatePaymentTerm({ method: 'FROM_MONTH_END', days: 10, config: { penalty: { percent: 2, period: 'DAY', graceDays: 0 } } });
      expect(v.config?.penalty?.percent).toBe(2);
    });
    it('rejects a bad period', () => {
      expect(() => validatePaymentTerm({ method: 'FROM_INVOICE_DATE', days: 1, config: { penalty: { percent: 1, period: 'YEAR' as never, graceDays: 0 } } })).toThrow(PaymentTermError);
    });
  });

  describe('12 weekly cutoff', () => {
    // 2026-03-01 is a Sunday.
    const t = (weekday: number, days: number): PaymentTerm => ({ method: 'WEEKLY_CUTOFF', days, config: { weekday } });
    it('a Sunday invoice with a Sunday cutoff is its own cutoff', () => expect(due(t(0, 0), '2026-03-01')).toBe('2026-03-01'));
    it('a Monday invoice goes to the Sunday cutoff', () => expect(due(t(0, 0), '2026-03-02')).toBe('2026-03-08'));
    it('the whole week shares one due date', () => {
      const dates = ['2026-03-02', '2026-03-04', '2026-03-07', '2026-03-08'].map((d) => due(t(0, 10), d));
      expect(new Set(dates)).toEqual(new Set(['2026-03-18']));
    });
    it('Thursday cutoff, invoice on Friday', () => expect(due(t(4, 0), '2026-03-06')).toBe('2026-03-12'));
    it('cutoff in the next month and year', () => expect(due(t(4, 7), '2026-12-29')).toBe('2027-01-07'));
    it('rejects weekday 7', () => expect(() => validatePaymentTerm(t(7, 0))).toThrow(PaymentTermError));
  });

  describe('overdue amount', () => {
    const plain = computeDueSchedule({ method: 'FROM_INVOICE_DATE', days: 30 }, '2026-01-01');
    it('not overdue on the due day', () => expect(overdueMinor(plain, 5000, 0, '2026-01-31')).toBe(0));
    it('overdue the day after', () => expect(overdueMinor(plain, 5000, 0, '2026-02-01')).toBe(5000));
    it('a part payment reduces it', () => expect(overdueMinor(plain, 5000, 2000, '2026-02-10')).toBe(3000));
    it('fully paid is never overdue', () => expect(overdueMinor(plain, 5000, 5000, '2026-06-01')).toBe(0));
    it('only the shares already due count', () => {
      const s = computeDueSchedule({ method: 'INSTALLMENTS', days: 0, config: { installments: [{ percent: 30, afterDays: 0 }, { percent: 70, afterDays: 45 }] } }, '2026-01-20');
      expect(overdueMinor(s, 10000, 0, '2026-02-01')).toBe(3000);
      expect(overdueMinor(s, 10000, 3000, '2026-02-01')).toBe(0);
      expect(overdueMinor(s, 10000, 3000, '2026-03-07')).toBe(7000);
    });
  });

  describe('validation', () => {
    it('rejects an unknown method', () => expect(() => validatePaymentTerm({ method: 'NOPE' as never, days: 0 })).toThrow(PaymentTermError));
    it('rejects negative days', () => expect(() => validatePaymentTerm({ method: 'FROM_INVOICE_DATE', days: -1 })).toThrow(PaymentTermError));
    it('rejects fractional days', () => expect(() => validatePaymentTerm({ method: 'FROM_INVOICE_DATE', days: 1.5 })).toThrow(PaymentTermError));
    it('rejects more than 3650 days', () => expect(() => validatePaymentTerm({ method: 'FROM_INVOICE_DATE', days: 3651 })).toThrow(PaymentTermError));
    it('rejects an impossible invoice date', () => expect(() => due({ method: 'FROM_INVOICE_DATE', days: 1 }, '2026-02-29')).toThrow(PaymentTermError));
  });
});
