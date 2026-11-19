import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A reset that does not clear a table is a reset that cannot run.
 *
 * The clearing phase deletes rows in foreign-key order and ends with the rows
 * everything else points at: accounts, branches, warehouses, items. A company
 * table left out of that order keeps its rows, and PostgreSQL then refuses to
 * delete the parent they point at:
 *
 *   update or delete on table "warehouses" violates foreign key constraint
 *   "warehouse_stock_balances_warehouseId_fkey" on table
 *   "warehouse_stock_balances"
 *
 * That is exactly what the sixteen inventory tables caused. The reset aborted
 * with P2003 *after* taking its safety backup, so "reset the data" - the one
 * operation a company uses to start over - simply stopped working.
 *
 * This spec reads schema.prisma so a table added later without a reset step is
 * a red build rather than a broken reset.
 */

const ROOT = join(__dirname, '..', '..', '..');
const SCHEMA = readFileSync(join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
const RESET = readFileSync(join(__dirname, 'reset.service.ts'), 'utf8');

interface Model {
  name: string;
  delegate: string;
  hasCompanyId: boolean;
}

function models(): Model[] {
  const found: Model[] = [];
  const pattern = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(SCHEMA)) !== null) {
    const name = match[1];
    found.push({
      name,
      delegate: name.charAt(0).toLowerCase() + name.slice(1),
      hasCompanyId: /^\s*companyId\s+String/m.test(match[2]),
    });
  }
  return found;
}

/**
 * Company tables the reset deliberately leaves alone, each with its reason.
 */
const KEPT_ON_PURPOSE: Record<string, string> = {
  // Soft-deleted by the reset, not removed: the first-run flow and the audit
  // trail both need the row to still say which company was reset.
  company: 'soft-deleted by the reset rather than removed',
  // The administrator who performs the reset keeps their account.
  user: 'every user except the administrator is deleted, by a filtered step',
  // Global application catalogues, not company data.
  permission: 'the application permission catalogue',
  // The audit trail is append-only in the database. The reset removes the
  // company's rows through AuditPurgeService, which announces the purge to a
  // trigger that refuses an ordinary DELETE, so it never calls deleteMany here.
  auditLog: 'purged through the guarded audit service, not a plain delete',
  // Licence records belong to the installation, not to the company's data.
  licenseInstallation: 'licence records belong to this installation',
  licenseKeyRecord: 'licence key material belongs to this installation',
  licenseSeatUsage: 'licence seat accounting belongs to this installation',
  licenseEvent: 'licence audit trail belongs to this installation',
};

describe('the company reset covers every table that belongs to a company', () => {
  const all = models();

  it('reads the files it is guarding', () => {
    expect(all.length).toBeGreaterThanOrEqual(70);
    expect(RESET).toContain('stockMovement');
  });

  it('clears every company-scoped table, or says why it is kept', () => {
    const missing = all
      .filter((model) => model.hasCompanyId && !(model.delegate in KEPT_ON_PURPOSE))
      // The reset reaches some tables through a relation filter rather than a
      // companyId of their own; `deleteMany` on the delegate is the signal.
      .filter((model) => !new RegExp(`tx\\.${model.delegate}\\.deleteMany`).test(RESET))
      .map((model) => `${model.delegate} (${model.name})`);

    expect(missing).toEqual([]);
  });

  it('keeps the inventory tables it was fixed to clear', () => {
    for (const model of [
      'itemBatch',
      'warehouseStockBalance',
      'storageLocation',
      'itemWarehouseSetting',
      'itemCostHistory',
      'userWarehouseAccess',
      'stockTakeSession',
      'stockTakeLine',
      'notification',
      'notificationSetting',
      'printPriceSetting',
      'budget',
      'quotationTermTemplate',
      'quotationColumnTemplate',
      'stockDocumentCreationRequest',
      'orderCreationRequest',
      'backupRun',
      'userProfilePhoto',
    ]) {
      expect(RESET).toContain(`tx.${model}.deleteMany`);
    }
  });

  it('clears children before the parents they point at', () => {
    // `warehouseStockBalance` and `itemBatch` point at warehouses, items and
    // branches; those parents are deleted further down the same transaction.
    const at = (delegate: string) => RESET.indexOf(`tx.${delegate}.deleteMany`);
    for (const child of ['itemBatch', 'warehouseStockBalance', 'itemCostHistory', 'storageLocation']) {
      expect(at(child)).toBeGreaterThan(-1);
      expect(at(child)).toBeLessThan(at('warehouse'));
      expect(at(child)).toBeLessThan(at('item'));
      expect(at(child)).toBeLessThan(at('branch'));
    }
  });
});
