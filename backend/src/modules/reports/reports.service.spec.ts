import { BadRequestException } from '@nestjs/common';
import { ReportsService } from './reports.service';

describe('ReportsService date validation', () => {
  const service = new ReportsService({} as any);

  it('accepts a valid date-only value', () => {
    const parsed = (service as any).parseDate('2026-02-28', 'from') as Date;
    expect(parsed.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('rejects an impossible calendar date', () => {
    expect(() => (service as any).parseDate('2026-02-31', 'from')).toThrow(
      BadRequestException,
    );
  });

  it('rejects an unparseable date', () => {
    expect(() => (service as any).parseDate('not-a-date', 'asOf')).toThrow(
      BadRequestException,
    );
  });

  it('rejects a period whose start is after its end', () => {
    expect(() =>
      (service as any).period({ from: '2026-10-02', to: '2026-10-01' }),
    ).toThrow(BadRequestException);
  });
});
