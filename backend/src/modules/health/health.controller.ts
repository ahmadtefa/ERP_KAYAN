import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness plus a real database round-trip, so a broken DB is visible. */
  @Public()
  @Get()
  async check() {
    let database = 'up';
    let needsSetup = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const companyCount = await this.prisma.company.count({
        where: { deletedAt: null },
      });
      needsSetup = companyCount === 0;
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      needsSetup,
      mode: process.env.NODE_ENV ?? 'development',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
