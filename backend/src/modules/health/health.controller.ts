import { Controller, Get, Logger, Optional, Req } from '@nestjs/common';
import { Request } from 'express';
import { networkInterfaces } from 'node:os';
import { Public } from '../../common/decorators/public.decorator';
import { advertisedHost, tlsTerminatedByProxy } from '../../common/security/exposure';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LicensingService } from '../licensing/licensing.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    // Optional so the controller can still be built in a unit test that only
    // cares about the database half of the answer.
    @Optional() private readonly licensing?: LicensingService,
  ) {}

  /**
   * Liveness plus a real database round-trip.
   *
   * The setup/count and database-name details are deliberately bounded. A
   * health endpoint is itself used by the Windows repair runtime to prove that
   * the server is alive. A slow metadata query must never make that probe hang
   * for the entire repair timeout while the HTTP server is already listening.
   * A timeout is therefore treated as "database details unknown" rather than
   * inventing a first-run database or reporting a working database as dead.
   */
  @Public()
  @Get()
  async check() {
    let database = 'up';
    let needsSetup = false;
    try {
      await this.withTimeout(
        this.prisma.$queryRaw`SELECT 1`,
        HealthController.DATABASE_PROBE_TIMEOUT_MS,
        'database liveness query',
      );
      try {
        const counts = await this.withTimeout(
          Promise.all([
            this.prisma.company.count({ where: { deletedAt: null } }),
            this.prisma.user
              ? this.prisma.user.count({ where: { deletedAt: null } })
              : Promise.resolve(1),
          ]),
          HealthController.DATABASE_DETAILS_TIMEOUT_MS,
          'database setup-state query',
        );
        needsSetup = counts[0] === 0 || counts[1] === 0;
      } catch (error) {
        HealthController.logger.warn(
          `Database is reachable but setup-state details were not ready: ${(error as Error).message}`,
        );
        // Fail closed for first-run setup: an unknown state must never make an
        // existing database look empty and trigger another administrator setup.
        needsSetup = false;
      }
    } catch {
      database = 'down';
    }

    const databaseName = database === 'up' ? await this.readDatabaseName() : null;
    const license = this.licensing?.licenseSummary() ?? null;
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      databaseName,
      needsSetup,
      license,
      timestamp: new Date().toISOString(),
    };
  }

  /** The database this process is really connected to, or null if unreadable. */
  private async readDatabaseName(): Promise<string | null> {
    try {
      const rows = await this.withTimeout(
        this.prisma.$queryRaw<Array<{ name: string }>>`
          SELECT current_database()::text AS name
        `,
        HealthController.DATABASE_DETAILS_TIMEOUT_MS,
        'database-name query',
      );
      return rows.length > 0 && rows[0]?.name ? rows[0].name : null;
    } catch (error) {
      HealthController.logger.warn(
        `The database answered, but its name could not be read: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    label: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private static readonly DATABASE_PROBE_TIMEOUT_MS = 5000;
  private static readonly DATABASE_DETAILS_TIMEOUT_MS = 5000;

  /**
   * The same answer plus the facts a support call needs. It is not public:
   * the mode (production/development) and the exact uptime tell an outsider
   * which kind of installation this is, and they are never needed to render
   * any screen.
   */
  @RequirePermissions('reports.read')
  @Get('details')
  async details() {
    const base = await this.check();
    return {
      ...base,
      mode: process.env.NODE_ENV ?? 'development',
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      tlsTerminatedByProxy: tlsTerminatedByProxy(),
    };
  }

  /**
   * Discovers all available IPv4 LAN addresses and the active listening port
   * so other devices on the same local network can easily connect.
   */
  @Public()
  @Get('network')
  async network(@Req() request: Request) {
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
      await this.withTimeout(
        this.prisma.$queryRaw`SELECT 1`,
        HealthController.DATABASE_PROBE_TIMEOUT_MS,
        'network database liveness query',
      );
    } catch {
      database = 'down';
    }

    // The address this request actually arrived on. `0.0.0.0` is a wildcard,
    // not somewhere a browser can go, so reporting it as the host would show
    // a link that cannot open.
    const arrivedAt = advertisedHost(
      host,
      request.headers as unknown as Record<string, unknown>,
      request.socket?.localAddress,
    );
    // Only promise an address that is actually listening. A copy that binds to
    // 127.0.0.1 hands out the local address, because that is the one that
    // works; the reason is stated instead of silently hiding the interfaces.
    const bindAllInterfaces = host === '0.0.0.0' || host === '::';
    const lanAddresses = bindAllInterfaces ? addresses : [];
    const secure = request.secure || tlsTerminatedByProxy();
    const scheme = secure ? 'https' : 'http';
    const primary = lanAddresses[0]?.url ?? `${scheme}://localhost:${port}`;
    return {
      port,
      host,
      reachedAtHost: arrivedAt,
      bindAllInterfaces,
      secureContext: secure,
      sessionStorage:
        secure || isLoopbackHost(arrivedAt) ? 'durable' : 'memory-only',
      isLanAccessible: bindAllInterfaces && lanAddresses.length > 0,
      addresses: lanAddresses,
      interfaces: addresses,
      primaryUrl: primary,
      localUrl: `${scheme}://localhost:${port}`,
      apiBasePath: '/api/v1',
      database,
      serverTime: new Date().toISOString(),
    };
  }

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

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  return false;
}

function isLoopbackHost(host: string): boolean {
  const name = host.split(':')[0].toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]' || name === '::1';
}
