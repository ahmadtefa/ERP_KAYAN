import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { LicensingService } from '../../modules/licensing/licensing.service';
import { RoleCatalogueBootstrap } from '../../modules/admin/role-catalogue.bootstrap';
import { MaintenanceService } from './maintenance';

/** Attach coordination before Nest invokes lifecycle hooks at app.listen().
 * Existing licence policy, reconciliation and protected storage are untouched.
 * If another process is restoring, startup may expose recovery/diagnostics but
 * must not run database-writing initializers against a half-replaced schema.
 * Licence initialization retains its existing lazy retry on business access.
 */
export function coordinateBusinessStartup(app: INestApplication): void {
  const maintenance = app.get(MaintenanceService);
  const licence = app.get(LicensingService);
  const roles = app.get(RoleCatalogueBootstrap);
  const logger = new Logger('StartupMaintenance');
  const initializeLicence = licence.onModuleInit.bind(licence);
  async function run(action: () => Promise<unknown>): Promise<void> {
    const release = await maintenance.admitBusinessRequest().catch(() => null);
    if (!release) {
      logger.warn('Business initialization deferred while restore or recovery is pending.');
      return;
    }
    try { await action(); } finally { release(); }
  }
  licence.onModuleInit = () => run(initializeLicence);
  // The original role hook starts a detached promise. Await the actual pass
  // here so its lease lasts until its last write, including errors.
  roles.onApplicationBootstrap = () => run(() => roles.ensureAllCompanies()).catch(() => {
    logger.warn('Role catalogue initialization did not finish.');
  });
}
