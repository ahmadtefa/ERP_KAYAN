import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/// How often the timer wakes up and asks every company to look at its shelves.
///
/// The *interval* a person cares about is the setting on each company's expiry
/// alert, so this number only decides how promptly a setting change is noticed.
/// Half an hour is deliberately much shorter than any sane reminder interval
/// and far longer than a scan takes.
const TICK_MINUTES = 30;

/// The switch that keeps the timer out of tests and one-off commands.
export const SCHEDULER_OFF_FLAG = 'KAYAN_DISABLE_EXPIRY_SCHEDULE';

/**
 * The automatic half of the expiry alerts.
 *
 * `NotificationsService.scanStock` already decided, correctly, *what* to tell a
 * person: one row per fact, keyed so the same lot cannot shout twice, closed
 * when it stops being true. What it did not have was a reason to run when
 * nobody was looking at a screen. A program that only warns about an expiring
 * lot when somebody happens to open the notification centre is not an alert,
 * it is a report.
 *
 * Three properties make this safe to leave running on a real installation:
 *
 *   * **one pass at a time.** A scan of a large catalogue can outlast the
 *     timer, and two concurrent passes would fight over the same rows. The
 *     `running` guard drops a tick that arrives while the previous one is still
 *     working rather than queueing it: the next tick is only half an hour away
 *     and the facts it would find have not changed in the meantime.
 *   * **a failure is logged, never thrown.** One company's broken row must not
 *     stop the others, and nothing here may take down the API the rest of the
 *     company is using. `scanStock` is read-only with respect to stock, so a
 *     failed pass leaves the shelves exactly as it found them.
 *   * **the timer does not hold the process open.** `unref` means a short-lived
 *     command that bootstraps the app still exits instead of waiting for the
 *     next tick.
 *
 * The first pass runs shortly after start-up - not during it - so a boot that is
 * still connecting does not race the scan, and a machine that was switched off
 * overnight still raises what it missed as soon as it is back.
 */
@Injectable()
export class ExpiryAlertScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExpiryAlertScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private startup: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (process.env[SCHEDULER_OFF_FLAG] === 'on') {
      this.logger.log('Automatic expiry scans are switched off by configuration.');
      return;
    }

    // Soon, but not inside onModuleInit: the connection pool may still be
    // warming up and the request that booted the process should not wait.
    this.startup = setTimeout(() => void this.tick(), 30_000);
    if (typeof this.startup.unref === 'function') this.startup.unref();

    this.timer = setInterval(() => void this.tick(), TICK_MINUTES * 60 * 1000);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.logger.log(
      `Expiry alerts are scanned every ${TICK_MINUTES} minutes, and once shortly after start-up.`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startup) clearTimeout(this.startup);
    this.timer = null;
    this.startup = null;
  }

  /// When the last completed pass finished, and what it found.
  ///
  /// Held in memory rather than the database on purpose: it answers "is the
  /// automatic scan alive in this process", which is exactly as long-lived as
  /// the process. What was actually raised is a row in the notification centre
  /// and does not need a second home.
  private lastRun: {
    finishedAt: Date;
    companies: number;
    raised: number;
    closed: number;
    failed: number;
  } | null = null;

  /// Whether a pass is in flight. Read by the status endpoint and the tests.
  get isRunning(): boolean {
    return this.running;
  }

  /// The interval, in minutes, the timer actually uses.
  get intervalMinutes(): number {
    return TICK_MINUTES;
  }

  /// True when the kill switch kept the timer from starting.
  get disabled(): boolean {
    return process.env[SCHEDULER_OFF_FLAG] === 'on';
  }

  status() {
    return {
      enabled: !this.disabled,
      intervalMinutes: TICK_MINUTES,
      running: this.running,
      lastRun: this.lastRun
        ? { ...this.lastRun, finishedAt: this.lastRun.finishedAt.toISOString() }
        : null,
    };
  }

  /**
   * One pass over every live company.
   *
   * Public because the tests drive it directly and because "scan now" should be
   * able to run exactly the code the timer runs. Returns what each company's
   * pass decided, and never throws: the whole point is that the caller cannot be
   * brought down by a scan.
   */
  async tick(
    now: Date = new Date(),
  ): Promise<{ companies: number; raised: number; closed: number; failed: number; skipped: boolean }> {
    if (this.running) {
      // A pass that outlasted its interval. Dropping the tick, not queueing it:
      // the facts have not changed and the next tick is half an hour away.
      this.logger.warn('An expiry scan is still running; this tick was skipped.');
      return { companies: 0, raised: 0, closed: 0, failed: 0, skipped: true };
    }
    this.running = true;
    let companies = 0;
    let raised = 0;
    let closed = 0;
    let failed = 0;
    try {
      const rows = await this.prisma.company.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      companies = rows.length;
      for (const company of rows) {
        try {
          const answer = await this.notifications.scanStock(company.id, now);
          raised += answer.raised;
          closed += answer.closed;
        } catch {
          // Deliberately no error text: a Prisma failure can carry a
          // connection string or a row value, and neither belongs in a log.
          failed += 1;
          this.logger.error('An expiry scan failed for one company; the rest continue.');
        }
      }
      if (failed > 0) {
        this.logger.warn(
          `Expiry scan finished with ${failed} of ${companies} companies failing.`,
        );
      }
    } catch {
      // The company list itself failed. Nothing ran; the next tick retries.
      failed += 1;
      this.logger.error('The expiry scan could not read the company list.');
    } finally {
      this.running = false;
      this.lastRun = { finishedAt: new Date(), companies, raised, closed, failed };
    }
    return { companies, raised, closed, failed, skipped: false };
  }
}
