import { ExpiryAlertScheduler, SCHEDULER_OFF_FLAG } from './expiry-alert.scheduler';

const COMPANY_A = '11111111-1111-4111-8111-111111111111';
const COMPANY_B = '22222222-2222-4222-8222-222222222222';

/// The automatic half of the expiry alerts.
///
/// `scanStock` was already correct about *what* to raise; what it lacked was a
/// reason to run when nobody was looking at a screen. These tests are about
/// that reason being safe: it runs every company, a failure in one does not
/// stop the others, two passes never overlap, and nothing it does can escape as
/// an unhandled rejection and take the API with it.
describe('the expiry alert scheduler', () => {
  let release: (value: { raised: number; closed: number; types: number }) => void = () => {};

  function makeHarness(
    scans: Array<(
      companyId: string,
      today?: Date,
    ) => Promise<{ raised: number; closed: number; types: number }>>,
  ) {
    const order: string[] = [];
    const prisma = {
      company: {
        findMany: jest.fn(async () => [{ id: COMPANY_A }, { id: COMPANY_B }]),
      },
    };
    let call = 0;
    const scanStock = jest.fn(async (companyId: string, today?: Date) => {
      order.push(companyId);
      const handler = scans[Math.min(call, scans.length - 1)];
      call += 1;
      return handler(companyId, today);
    });
    const scheduler = new ExpiryAlertScheduler(
      prisma as never,
      { scanStock } as never,
    );
    return { scheduler, prisma, scanStock, order };
  }

  const ok = async () => ({ raised: 1, closed: 0, types: 6 });

  afterEach(() => {
    delete process.env[SCHEDULER_OFF_FLAG];
    jest.useRealTimers();
  });

  it('scans every live company and sums what each pass raised', async () => {
    const { scheduler, order } = makeHarness([ok]);

    const answer = await scheduler.tick(new Date('2026-03-01T00:00:00.000Z'));

    expect(order).toEqual([COMPANY_A, COMPANY_B]);
    expect(answer).toEqual({ companies: 2, raised: 2, closed: 0, failed: 0, skipped: false });
  });

  it('passes the same "today" to every company, so two stores agree', async () => {
    const today = new Date('2026-03-01T00:00:00.000Z');
    const seen: Array<Date | undefined> = [];
    const { scheduler } = makeHarness([
      async (_company, day) => {
        seen.push(day);
        return { raised: 0, closed: 0, types: 6 };
      },
    ]);

    await scheduler.tick(today);

    expect(seen).toHaveLength(2);
    expect(seen.every((day) => day?.getTime() === today.getTime())).toBe(true);
  });

  it('keeps going when one company fails, and reports it', async () => {
    const { scheduler, scanStock } = makeHarness([
      async (companyId) => {
        if (companyId === COMPANY_A) {
          throw new Error('company A has a broken row');
        }
        return { raised: 3, closed: 1, types: 6 };
      },
    ]);

    const answer = await scheduler.tick();

    // The failure was counted, not thrown: `tick` never rejects.
    expect(answer).toEqual({ companies: 2, raised: 3, closed: 1, failed: 1, skipped: false });
    // And the healthy company was still scanned.
    expect(scanStock).toHaveBeenCalledTimes(2);
    expect(answer.skipped).toBe(false);
  });

  it('does not reject when the failure is the company list itself', async () => {
    const prisma = {
      company: { findMany: jest.fn(async () => Promise.reject(new Error('connection lost'))) },
    };
    const scanStock = jest.fn();
    const scheduler = new ExpiryAlertScheduler(prisma as never, { scanStock } as never);

    await expect(scheduler.tick()).resolves.toEqual({
      companies: 0,
      raised: 0,
      closed: 0,
      failed: 1,
      skipped: false,
    });
    expect(scanStock).not.toHaveBeenCalled();
    // The guard was released, so the next tick runs rather than being skipped.
    expect(scheduler.isRunning).toBe(false);
  });

  it('drops a tick that arrives while a pass is still running', async () => {
    const gate = new Promise<{ raised: number; closed: number; types: number }>((resolve) => {
      release = resolve;
    });
    const { scheduler, scanStock } = makeHarness([async () => gate]);

    const first = scheduler.tick();
    // Let the first pass reach the awaiting scan.
    await Promise.resolve();
    await Promise.resolve();

    const second = await scheduler.tick();

    expect(second.skipped).toBe(true);
    expect(second.companies).toBe(0);
    // The whole point: the second tick did not start a competing pass.
    expect(scanStock).toHaveBeenCalledTimes(1);

    release?.({ raised: 1, closed: 0, types: 6 });
    await first;
    expect(scheduler.isRunning).toBe(false);
  });

  it('releases the guard after a failed pass, so the next tick is not skipped', async () => {
    let attempt = 0;
    const { scheduler } = makeHarness([
      async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('transient');
        return { raised: 0, closed: 0, types: 6 };
      },
      async () => ({ raised: 0, closed: 0, types: 6 }),
    ]);

    const first = await scheduler.tick();
    expect(first.failed).toBe(1);

    const second = await scheduler.tick();
    expect(second.skipped).toBe(false);
    expect(second.failed).toBe(0);
  });

  it('starts a timer shortly after boot and records what the last pass did', async () => {
    jest.useFakeTimers();
    const { scheduler, scanStock } = makeHarness([ok]);

    scheduler.onModuleInit();
    expect(scanStock).not.toHaveBeenCalled();

    // The first pass waits 30s rather than racing the connection pool.
    await jest.advanceTimersByTimeAsync(30_000);
    expect(scanStock).toHaveBeenCalled();

    const status = scheduler.status();
    expect(status.enabled).toBe(true);
    expect(status.intervalMinutes).toBe(30);
    expect(status.lastRun).not.toBeNull();
    expect(status.lastRun?.companies).toBe(2);

    scheduler.onModuleDestroy();
  });

  it('starts nothing at all when the kill switch is on', async () => {
    jest.useFakeTimers();
    process.env[SCHEDULER_OFF_FLAG] = 'on';
    const { scheduler, scanStock } = makeHarness([ok]);

    scheduler.onModuleInit();
    await jest.advanceTimersByTimeAsync(120 * 60_000);

    expect(scanStock).not.toHaveBeenCalled();
    expect(scheduler.status().enabled).toBe(false);

    scheduler.onModuleDestroy();
  });

  it('stops its timers on shutdown instead of leaving them behind', async () => {
    jest.useFakeTimers();
    const { scheduler, scanStock } = makeHarness([ok]);

    scheduler.onModuleInit();
    scheduler.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(120 * 60_000);

    expect(scanStock).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
