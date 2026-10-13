import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * The maintenance switch.
 *
 * A full restore replaces the database under the program's feet. While it
 * runs, every request that would write — anything but a read, a sign-in, or a
 * backup operation itself — is turned away with a clear message instead of
 * being let loose on a database that is mid-replacement.
 *
 * The flag lives in memory of the process doing the restore. That is exactly
 * where it belongs for the supported single-server deployment. The in-flight
 * restore request is already admitted before maintenance starts; while it runs,
 * new write requests (including new backup/restore operations) are blocked.
 */
@Injectable()
export class MaintenanceService {
  private active = false;
  private detail: string | null = null;
  private since: Date | null = null;

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

/**
 * Blocks writes while maintenance is on. Reads keep working so the screens
 * can still show the state of the system — people can see what is happening,
 * they simply cannot change anything mid-restore.
 */
@Injectable()
export class MaintenanceInterceptor implements NestInterceptor {
  constructor(private readonly maintenance: MaintenanceService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.maintenance.isActive) return next.handle();

    const request = context.switchToHttp().getRequest<{
      method: string;
      path: string;
    }>();
    const method = request.method.toUpperCase();
    const isRead = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';

    // The in-flight restore continues in its already-admitted request.
    // Only the full-restore endpoint may start a recovery attempt while
    // maintenance is active; FullBackupService serializes those requests.
    const isRestoreRequest =
      method === 'POST' && /\/backup\/full\/restore\/?$/.test(request.path);
    if (isRead || isRestoreRequest) return next.handle();

    throw new ServiceUnavailableException(
      'The database is being restored right now. ' +
        'Try again in a moment — nothing was lost.',
    );
  }
}
