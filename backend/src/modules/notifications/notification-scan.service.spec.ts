import { NotificationScanService } from './notification-scan.service';

/// The nightly walk over every company.
///
/// One company's bad data must not stop the others being told, two overlapping
/// passes must not double the work, and a test run must never wake up to alarms
/// it did not create.
describe('notification scan timer', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    jest.useRealTimers();
    process.env = { ...originalEnv };
  });

  function makeHarness(companies: Array<{ id: string; code?: string }>) {
    const scans: string[] = [];
    const failures = new Set<string>();
    const prisma = {
      company: { findMany: jest.fn(async () => companies) },
    };
    const notifications = {
      scanStock: jest.fn(async (companyId: string) => {
        scans.push(companyId);
        if (failures.has(companyId)) throw new Error('bad data');
        return { raised: 2 };
      }),
    };
    const service = new NotificationScanService(prisma as never, notifications as never);
    const logger = service as unknown as { logger: { error: (...args: unknown[]) => void } };
    logger.logger.error = jest.fn();
    return { service, prisma, notifications, scans, failures, logger };
  }

  it('scans every active company and totals what it raised', async () => {
    const { service, scans } = makeHarness([{ id: 'company-a' }, { id: 'company-b', code: 'B' }]);

    const answer = await service.runOnce();

    expect(answer).toEqual({ companies: 2, raised: 4 });
    expect(scans).toEqual(['company-a', 'company-b']);
  });

  it('keeps going when one company fails, and says which one', async () => {
    const { service, failures, logger } = makeHarness([
      { id: 'company-a' },
      { id: 'company-b', code: 'BROKEN' },
      { id: 'company-c' },
    ]);
    failures.add('company-b');

    const answer = await service.runOnce();

    // Two of the three were scanned successfully; the broken one is named in
    // the log instead of silently dropping out of the count.
    expect(answer).toEqual({ companies: 2, raised: 4 });
    expect((logger.logger.error as jest.Mock).mock.calls[0][0]).toContain('BROKEN');
  });

  it('ignores a second pass that starts while the first is still running', async () => {
    const { service, scans } = makeHarness([{ id: 'company-a' }]);

    const [first, second] = await Promise.all([service.runOnce(), service.runOnce()]);

    expect(scans).toHaveLength(1);
    expect([first.raised, second.raised]).toEqual([2, 0]);

    // The lock is released afterwards, so the timer works next time.
    const third = await service.runOnce();
    expect(third).toEqual({ companies: 1, raised: 2 });
  });

  it('does not start a timer in a test run', () => {
    jest.useFakeTimers();
    process.env.NODE_ENV = 'test';
    delete process.env.KAYAN_NOTIFICATION_SCAN;
    const { service, scans } = makeHarness([{ id: 'company-a' }]);

    service.onModuleInit();
    jest.advanceTimersByTime(6 * 3_600_000);

    expect(scans).toHaveLength(0);
    service.onModuleDestroy();
  });

  it('walks on the configured interval when it is allowed to run', async () => {
    jest.useFakeTimers();
    process.env.NODE_ENV = 'test';
    process.env.KAYAN_NOTIFICATION_SCAN = '1';
    process.env.KAYAN_NOTIFICATION_SCAN_MINUTES = '1';
    const { service, scans } = makeHarness([{ id: 'company-a' }]);

    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(2 * 60_000);

    expect(scans.length).toBe(2);
    service.onModuleDestroy();
  });

  it('never arms a timer when the installation switched the scan off', () => {
    jest.useFakeTimers();
    process.env.NODE_ENV = 'test';
    process.env.KAYAN_NOTIFICATION_SCAN = '0';
    const { service, scans } = makeHarness([{ id: 'company-a' }]);

    service.onModuleInit();
    jest.advanceTimersByTime(6 * 3_600_000);

    expect(scans).toHaveLength(0);
    service.onModuleDestroy();
  });

  it('stops the timer when the module is torn down', () => {
    jest.useFakeTimers();
    process.env.NODE_ENV = 'test';
    process.env.KAYAN_NOTIFICATION_SCAN = '1';
    process.env.KAYAN_NOTIFICATION_SCAN_MINUTES = '1';
    const { service, scans } = makeHarness([{ id: 'company-a' }]);

    service.onModuleInit();
    service.onModuleDestroy();
    jest.advanceTimersByTime(5 * 60_000);

    expect(scans).toHaveLength(0);
  });
});
