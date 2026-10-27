import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { LicensingService } from './licensing.service';

/**
 * What an expired or suspended licence stops, and what it must not stop.
 *
 * It stops business: invoices, vouchers, journals, stock, reports - everything
 * that turns into the customer's books. It never stops:
 *
 *  * signing in, because the licence screen is behind the login;
 *  * the licence routes themselves, because that is where a renewal key is
 *    entered;
 *  * health, so the desktop shell can still see whether the server is up;
 *  * first-run setup, so a fresh installation can be prepared;
 *  * **backups and restores**, because turning an expired licence into a
 *    reason that the customer cannot save their data would be a much worse
 *    failure than the expiry itself.
 *
 * Only `LICENSE_ENFORCEMENT=enforce` blocks anything. `warn` reports the state
 * and lets the program run, which is what development and the test suites use;
 * `off` does not even report.
 */
@Injectable()
export class LicenseGuard implements CanActivate {
  /** Paths that stay reachable whatever the licence says. */
  private static readonly alwaysAllowed = [
    '/auth',
    '/license',
    '/health',
    '/setup',
    '/backup',
  ];

  constructor(private readonly licensing: LicensingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.licensing.isEnforced()) return true;

    const request = context.switchToHttp().getRequest<{
      path?: string;
      url?: string;
      route?: { path?: string };
    }>();
    const raw = request.route?.path ?? request.path ?? request.url ?? '';
    const rawPath = raw.split('?')[0];

    // Express/Nest can expose either the controller path (/health) or the
    // fully prefixed URL (/api/v1/health), depending on which request property
    // is populated. Normalize the known API prefix before checking the escape
    // routes. Otherwise the health probe can enter licence-status/database
    // work before the controller runs, defeating the repair tool's liveness
    // check when the database or licence store is slow.
    const path = rawPath.replace(/^\/api\/v1(?=\/|$)/, '') || '/';

    if (
      LicenseGuard.alwaysAllowed.some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`),
      )
    ) {
      return true;
    }

    if (!(await this.licensing.isBlocked())) return true;

    const status = await this.licensing.status();
    throw new ForbiddenException({
      detail: licenceMessage(status.state),
      code:
        status.state === 'EXPIRED'
          ? 'LICENSE_EXPIRED'
          : status.state === 'SUSPENDED'
            ? 'LICENSE_CLOCK_TAMPERED'
            : 'LICENSE_REQUIRED',
      license: {
        state: status.state,
        expiresAt: status.expiresAt,
        perpetual: status.perpetual,
      },
    });
  }
}

export function licenceMessage(state: string): string {
  if (state === 'EXPIRED') {
    return (
      'انتهت صلاحية ترخيص هذا البرنامج. البيانات محفوظة كما هي ولم يُحذف منها شيء. ' +
      'افتح شاشة الترخيص وأدخل مفتاح التجديد لمواصلة العمل. ' +
      '/ The licence for this program has expired. All data is intact; open the licence screen and enter a renewal key.'
    );
  }
  if (state === 'SUSPENDED') {
    return (
      'أوقف البرنامج العمل لأن تاريخ الجهاز يسبق آخر تشغيل مسجّل بفارق كبير، وهو ما يحدث عند إرجاع التاريخ للالتفاف على انتهاء الترخيص. ' +
      'صحّح التاريخ والوقت في ويندوز ثم أكّد الحالة من شاشة الترخيص. ' +
      '/ The program is suspended because the system date is earlier than the last recorded run. Correct the date and time in Windows, then confirm on the licence screen.'
    );
  }
  return (
    'هذا البرنامج غير مرخّص على هذا الجهاز بعد. افتح شاشة الترخيص وأدخل مفتاح التفعيل. ' +
    '/ This program is not licensed on this computer yet. Open the licence screen and enter an activation key.'
  );
}
