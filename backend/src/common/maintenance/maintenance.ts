import {
  CallHandler,
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { defer, finalize, Observable, switchMap } from 'rxjs';
import { DatabaseMaintenanceBarrier } from './database-barrier';

/**
 * The maintenance switch.
 *
 * A full restore replaces the database under the program's feet. This local
 * switch rejects business requests while data may be incomplete; only
 * diagnostics and access to already-created backup files remain available.
 *
 * The switch drains admitted HTTP business handlers in this process. Other
 * processes, background work and crash recovery require separate coordination.
 */
@Injectable()
export class MaintenanceService {
  constructor(@Optional() private readonly barrier?: DatabaseMaintenanceBarrier) {}

  get coordinatesProcesses(): boolean { return Boolean(this.barrier); }

  async admitBusinessRequest(): Promise<() => void> {
    if (this.active) throw new ServiceUnavailableException('The database is in maintenance mode.');
    const releaseDatabase = await this.barrier?.admit();
    if (this.active) {
      await releaseDatabase?.();
      throw new ServiceUnavailableException('The database is in maintenance mode.');
    }
    const releaseLocal = this.trackBusinessRequest();
    return () => {
      // Keep the distributed lease until the handler has finished, including
      // errors; releasing it is independent of the HTTP client's connection.
      releaseLocal();
      void releaseDatabase?.().catch(() => {});
    };
  }
  private active = false;
  private detail: string | null = null;
  private since: Date | null = null;
  private inFlight = 0;
  private readonly drained = new Set<() => void>();

  trackBusinessRequest(): () => void {
    this.inFlight++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight--;
      if (this.inFlight === 0) {
        for (const resolve of this.drained) resolve();
      }
    };
  }

  waitForBusinessRequests(timeoutMs = 30_000): Promise<void> {
    if (this.inFlight === 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timeout);
        this.drained.delete(finish);
        resolve();
      };
      const timeout = setTimeout(() => {
        this.drained.delete(finish);
        reject(new ServiceUnavailableException(
          'Existing business requests did not finish before the restore deadline. The database was not changed.',
        ));
      }, timeoutMs);
      this.drained.add(finish);
    });
  }

  get isActive(): boolean {
    return this.active;
  }

  get status() {
    return {
      maintenance: this.active,
      detail: this.detail,
      since: this.since?.toISOString() ?? null,
    };
  }

  begin(detail: string): void {
    this.active = true;
    this.detail = detail;
    this.since = new Date();
  }

  end(): void {
    this.active = false;
    this.detail = null;
    this.since = null;
  }
}

interface MaintenanceRequest {
  method: string;
  path: string;
  maintenanceLease?: () => void;
  maintenanceHandlerStarted?: boolean;
}

function bypassMaintenance(request: MaintenanceRequest): boolean {
  const method = request.method.toUpperCase();
  const path = request.path.replace(/^\/api\/v1(?=\/|$)/, '').replace(/\/+$/, '') || '/';
  if (method === 'POST' && [
    '/backup/restore', '/backup/full/restore', '/backup/complete/restore', '/backup/complete/recovery/resume',
  ].includes(path)) return true;
  if (method !== 'GET' && method !== 'HEAD') return false;
  return path === '/health' || path.startsWith('/health/') || [
    '/backup/full', '/backup/full/status', '/backup/full/capabilities',
    '/backup/complete/status', '/backup/complete/recovery',
  ].includes(path) || /^\/backup\/full\/[^/]+\/download\/?$/.test(path);
}

/** Runs before authentication so a principal cannot be read before a restore
 * and then admitted with stale session/permission data after it finishes. */
@Injectable()
export class MaintenanceAdmissionGuard implements CanActivate {
  constructor(private readonly maintenance: MaintenanceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<MaintenanceRequest>();
    if (bypassMaintenance(request)) return true;
    const release = await this.maintenance.admitBusinessRequest();
    request.maintenanceLease = release;
    // A later guard can reject before the interceptor starts. Finish is safe
    // then; a mere client disconnect is deliberately not a drain signal.
    const response = context.switchToHttp().getResponse<{ once: (name: string, callback: () => void) => void }>();
    response.once('finish', () => { if (!request.maintenanceHandlerStarted) release(); });
    return true;
  }
}

/**
 * Blocks business reads and writes while maintenance is on. Reporting an
 * incomplete database as real books is unsafe even when no row is changed.
 * A narrow set of diagnostics and pre-existing backup file reads remains.
 */
@Injectable()
export class MaintenanceInterceptor implements NestInterceptor {
  constructor(private readonly maintenance: MaintenanceService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const admitted = context.switchToHttp().getRequest<MaintenanceRequest>();
    if (admitted.maintenanceLease) {
      admitted.maintenanceHandlerStarted = true;
      return defer(() => next.handle()).pipe(finalize(admitted.maintenanceLease));
    }
    const request = context.switchToHttp().getRequest<{
      method: string;
      path: string;
    }>();
    const method = request.method.toUpperCase();
    const path = request.path.replace(/^\/api\/v1(?=\/|$)/, '').replace(/\/+$/, '') || '/';
    const isRead = method === 'GET' || method === 'HEAD';
    const safeDiagnostic = path === '/health' || path.startsWith('/health/');
    const safeBackup = path === '/backup/full' ||
      path === '/backup/full/status' || path === '/backup/full/capabilities' ||
      path === '/backup/complete/status' || path === '/backup/complete/recovery' ||
      /^\/backup\/full\/[^/]+\/download\/?$/.test(path);
    // The in-flight restore continues in its already-admitted request.
    // Any fresh attempt still goes through the service's own concurrency and
    // maintenance checks; admission here is not permission to mutate data.
    const isRestoreRequest = method === 'POST' && (
      path === '/backup/restore' || path === '/backup/full/restore' || path === '/backup/complete/restore' ||
      path === '/backup/complete/recovery/resume'
    );
    if ((isRead && (safeDiagnostic || safeBackup)) || isRestoreRequest) return next.handle();
    if (!this.maintenance.isActive) {
      if (this.maintenance.coordinatesProcesses) {
        return defer(() => this.maintenance.admitBusinessRequest()).pipe(
          switchMap((release) => defer(() => next.handle()).pipe(finalize(release))),
        );
      }
      const release = this.maintenance.trackBusinessRequest();
      try {
        return next.handle().pipe(finalize(release));
      } catch (error) {
        release();
        throw error;
      }
    }

    throw new ServiceUnavailableException(
      'The database is in maintenance mode. Business reads and writes are blocked; ' +
        'check the restore status before trying again.',
    );
  }
}
