import { Controller, Get } from '@nestjs/common';
import { networkInterfaces } from 'node:os';
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
      const userCount = this.prisma.user
        ? await this.prisma.user.count({ where: { deletedAt: null } })
        : 1;
      needsSetup = companyCount === 0 || userCount === 0;
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

  /**
   * Discovers all available IPv4 LAN addresses and the active listening port
   * so other devices on the same local network can easily connect.
   */
  @Public()
  @Get('network')
  network() {
    const port = Number(process.env.PORT ?? 3000);
    const host = process.env.HOST ?? '0.0.0.0';
    const interfaces = networkInterfaces();
    const addresses: { interface: string; address: string; url: string }[] = [];

    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name] ?? []) {
        if (net.family === 'IPv4' && !net.internal) {
          addresses.push({
            interface: name,
            address: net.address,
            url: `http://${net.address}:${port}`,
          });
        }
      }
    }

    return {
      port,
      host,
      isLanAccessible: host === '0.0.0.0',
      addresses,
      primaryUrl:
        addresses.length > 0 ? addresses[0].url : `http://localhost:${port}`,
    };
  }
}
