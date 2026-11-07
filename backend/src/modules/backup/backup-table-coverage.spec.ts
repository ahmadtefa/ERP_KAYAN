import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TABLES } from './backup.service';

/**
 * A company backup that omits a table is not a smaller backup - it is a
 * restore that either loses data or cannot run at all.
 *
 * Both happened. The inventory work added sixteen tables that carry a
 * companyId (`ItemBatch`, `WarehouseStockBalance`, `StorageLocation`, ...) and
 * never added them here, so:
 *
 *   * a downloaded file silently contained no batches, no expiry dates and no
 *     shelf balances; restoring it erased them, and
 *   * the restore transaction failed outright with P2003
 *     `update or delete on table "warehouses" violates foreign key constraint
 *     "warehouse_stock_balances_warehouseId_fkey"`, because the clearing phase
 *     deletes `warehouses` while rows in an unlisted table still point at them.
 *
 * The list is hand-maintained and will always be hand-maintained, because the
 * order matters (parents before dependants). This test is what makes forgetting
 * it a red build instead of a lost shop.
 */

const SCHEMA = readFileSync(join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma'), 'utf8');

interface Model {
  name: string;
  delegate: string;
  hasCompanyId: boolean;
  body: string;
}

function models(): Model[] {
  const found: Model[] = [];
  const pattern = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(SCHEMA)) !== null) {
    const name = match[1];
    const body = match[2];
    found.push({
      name,
      delegate: name.charAt(0).toLowerCase() + name.slice(1),
      hasCompanyId: /^\s*companyId\s+String/m.test(body),
      body,
    });
  }
  return found;
}

/**
 * Tables a company backup deliberately does not carry.
 *
 * Each entry names the reason, because "it is on the skip list" must never be
 * enough on its own.
 */
const NOT_PER_COMPANY_DATA: Record<string, string> = {
  // The installation itself: restoring one company's file must not rewrite the
  // identity or the code of the server it is restored into.
  company: 'the installation row; a backup restores a company, it does not replace it',
  // Global catalogues owned by the application, not by a company.
  permission: 'the application permission catalogue, recreated by the seed on every install',
  // Secrets. A backup file is a downloaded JSON document; it must never carry
  // refresh tokens or licence keys that could be replayed.
  refreshToken: 'live session secrets must never leave the database',
  licenseInstallation: 'the licence is bound to this machine, not to the company data',
  licenseKeyRecord: 'licence key material must never be written into a backup file',
  licenseSeatUsage: 'licence seat accounting belongs to this installation',
  licenseEvent: 'licence audit trail belongs to this installation',
};

describe('the company backup covers every table that belongs to a company', () => {
  const all = models();
  const listed = new Set(TABLES.map((spec) => spec.model));

  it('reads the schema it is guarding', () => {
    // A regex that quietly matches nothing would make every test below pass.
    expect(all.length).toBeGreaterThanOrEqual(70);
    expect(all.filter((model) => model.hasCompanyId).length).toBeGreaterThanOrEqual(45);
  });

  it('names only models that exist in the schema', () => {
    const known = new Set(all.map((model) => model.delegate));
    const invented = [...listed].filter((model) => !known.has(model));
    expect(invented).toEqual([]);
  });

  it('carries every company-scoped table, or says why not', () => {
    const missing = all
      .filter((model) => model.hasCompanyId && !listed.has(model.delegate))
      .filter((model) => !(model.delegate in NOT_PER_COMPANY_DATA))
      .map((model) => `${model.delegate} (${model.name})`);

    expect(missing).toEqual([]);
  });

  it('keeps the tables it was fixed to include', () => {
    // Named one by one: a reviewer reading this spec should be able to see the
    // data whose loss this file exists to prevent.
    for (const model of [
      'itemBatch', // expiry dates and per-lot cost
      'warehouseStockBalance', // the shelf book the reports read
      'storageLocation',
      'itemWarehouseSetting',
      'itemCostHistory',
      'userWarehouseAccess',
      'stockTakeSession',
      'stockTakeLine',
      'notification',
      'notificationSetting',
      'printPriceSetting',
      'quotationTermTemplate',
      'quotationColumnTemplate',
      'budget',
      'backupRun',
      'stockDocumentCreationRequest',
      'orderCreationRequest',
      'userProfilePhoto',
    ]) {
      expect(listed).toContain(model);
    }
  });

  it('lists a child table after the table it hangs from', () => {
    // Restore inserts in this order and clears in reverse, so a child listed
    // before its parent would be deleted after it - a foreign-key failure at
    // the end of a long restore.
    const position = new Map(TABLES.map((spec, index) => [spec.model, index]));
    for (const spec of TABLES) {
      if (spec.scope !== 'child' || !spec.parent) continue;
      const parentAt = position.get(spec.parent);
      const childAt = position.get(spec.model);
      expect(parentAt).toBeDefined();
      expect(childAt).toBeGreaterThan(parentAt as number);
    }
  });

  it('does not carry secrets', () => {
    for (const secret of ['refreshToken', 'licenseKeyRecord', 'licenseSeatUsage']) {
      expect(listed.has(secret)).toBe(false);
    }
  });
});
