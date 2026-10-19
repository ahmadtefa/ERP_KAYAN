import { Controller, Get, Logger } from '@nestjs/common';
import { networkInterfaces } from 'node:os';
import { Public } from '../../common/decorators/public.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
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
  async network() {
    const port = Number(process.env.PORT ?? 3000);
    const host = process.env.HOST ?? '0.0.0.0';
    const addresses: Array<{
      interface: string;
      address: string;
      url: string;
      isPrivate: boolean;
    }> = [];

    for (const name of Object.keys(networkInterfaces())) {
      for (const net of networkInterfaces()[name] ?? []) {
        // Loopback and internal interfaces are never offered as a way in: they
        // cannot be reached from another machine, and a link that cannot open
        // is worse than no link.
        if (net.family === 'IPv4' && !net.internal) {
          addresses.push({
            interface: name,
            address: net.address,
            url: `http://${net.address}:${port}`,
            isPrivate: isPrivateIpv4(net.address),
          });
        }
      }
    }

    let database = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }

    // Only promise an address that is actually listening. A copy that binds to
    // 127.0.0.1 hands out the local address, because that is the one that
    // works; the reason is stated instead of silently hiding the interfaces.
    const bindAllInterfaces = host === '0.0.0.0' || host === '::';
    const lanAddresses = bindAllInterfaces ? addresses : [];
    const primary = lanAddresses[0]?.url ?? `http://localhost:${port}`;
    return {
      port,
      host,
      bindAllInterfaces,
      isLanAccessible: bindAllInterfaces && lanAddresses.length > 0,
      addresses: lanAddresses,
      /// Every non-loopback interface, even when the server is local-only, so
      /// the screen can say which address *would* be used once it is enabled
      /// instead of presenting a guess as a working link.
      interfaces: addresses,
      primaryUrl: primary,
      localUrl: `http://localhost:${port}`,
      apiBasePath: '/api/v1',
      database,
      serverTime: new Date().toISOString(),
    };
  }

  /// Where this machine appears on the internet, asked for on purpose.
  ///
  /// It is a separate endpoint rather than part of the page load: a program
  /// that opens a silent HTTP call to a third party every time somebody looks
  /// at the settings screen is doing something the operator did not ask for.
  /// The call is short-lived and its failure is an answer, not an error page.
  @Get('public-ip')
  @RequirePermissions('reports.read')
  async publicIp(@CurrentUser() user: AuthUser) {
    const checkedAt = new Date().toISOString();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const response = await fetch('https://api.ipify.org?format=json', {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      clearTimeout(timer);
      if (!response.ok) {
        return {
          ok: false,
          checkedAt,
          publicIp: null,
          message: `The address service answered ${response.status}`,
        };
      }
      const body = (await response.json()) as { ip?: string };
      const ip = typeof body.ip === 'string' ? body.ip.trim() : '';
      if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) {
        return { ok: false, checkedAt, publicIp: null, message: 'The address service answered with something that is not an address' };
      }
      HealthController.logger.log(
        `Public address detected for company ${user.companyId}: ${ip}`,
      );
      return {
        ok: true,
        checkedAt,
        publicIp: ip,
        // An address alone does not mean this server can be reached from
        // outside: a router or the carrier may be between the two.
        message:
          'The address was detected. It does not by itself prove that incoming connections reach this computer.',
      };
    } catch {
      return {
        ok: false,
        checkedAt,
        publicIp: null,
        message: 'The public address could not be detected (no internet route or the service did not answer).',
      };
    }
  }

  private static readonly logger = new Logger('Health');
}

/// The private IPv4 ranges RFC 1918 sets aside, plus the link-local range used
/// by automatic addressing. A public address here would be unusual and is not
/// labelled as local.
function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  return false;
}
