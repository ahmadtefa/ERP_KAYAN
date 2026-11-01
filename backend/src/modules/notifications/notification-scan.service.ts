import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/// The nightly walk.
///
/// An alert nobody raises is a screen nobody opens. This service asks the same
/// scanner the manual button asks, once an hour by default, for every active
/// company - and does nothing at all in a test run, so a test never wakes up
/// to alerts it did not create.
///
/// It is deliberately not a cron table: a KAYAN installation is one program on
/// one machine, and a drifted time zone in a scheduler table is a bug nobody
/// finds until the wrong morning. The interval is an environment setting, and
/// the work itself is deduplicated by the alert's own key, so running it twice
/// - or twenty times - says the same thing once.
@Injectable()
export class NotificationScanService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Notifications');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' && process.env.KAYAN_NOTIFICATION_SCAN !== '1') {
      return;
    }
    if (process.env.KAYAN_NOTIFICATION_SCAN === '0') return;
    const minutes = Number(process.env.KAYAN_NOTIFICATION_SCAN_MINUTES ?? 60);
    if (!Number.isFinite(minutes) || minutes <= 0) return;

    this.timer = setInterval(() => {
      void this.runOnce();
    }, minutes * 60_000);
    // Never keep the process alive just to wait for an alarm.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /// One pass over every active company. Returns what it found, so the manual
  /// button and the timer can both report rather than pretend.
  async runOnce(): Promise<{ companies: number; raised: number }> {
    if (this.running) return { companies: 0, raised: 0 };
    this.running = true;
    let companies = 0;
    let raised = 0;
    try {
      const rows = await this.prisma.company.findMany({
        where: { deletedAt: null },
        select: { id: true, code: true },
      });
      for (const company of rows) {
        try {
          const result = await this.notifications.scanStock(company.id);
          raised += result.raised;
          companies += 1;
        } catch (error) {
          // One company's bad data must not stop the others being told.
          this.logger.error(
            `Scanning notifications for ${company.code ?? company.id} failed`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    } finally {
      this.running = false;
    }
    return { companies, raised };
  }
}
