import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { PGlite } from '@electric-sql/pglite';

import { AccountMapService } from '../accounting/account-map.service';
import { CostCentersService } from '../accounting/cost-centers.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { FiscalPeriodsService } from '../accounting/fiscal-periods.service';
import { PostingService } from '../accounting/posting.service';
import { AuditService } from '../../common/audit/audit.service';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { pglitePrisma } from '../../testing/pglite-adapter';

import { BatchesService } from '../inventory/batches.service';
import { PurchaseInvoicesService } from './purchase-invoices.service';

/// A whole sales invoice, posted and reversed, on a real PostgreSQL engine.
///
/// The sibling suite (`sales-batches.integration.spec.ts`) drives the lot engine
/// directly: it proves FEFO, splitting and the expiry guard against real rows,
/// but it never runs `SalesInvoicesService.post`. This one does. It seeds a
/// draft invoice and a chart of accounts in a schema built from the project's
/// own migration files, calls the production `post()`, then calls the
/// production `reverse()`, and reads the resulting rows back with plain SQL -
/// so what is asserted is what the database ended up holding, not what a mock
/// was told to say.
///
/// Posting reaches the journal, the cost centres, the document sequence and the
/// stock ledger, all of them real collaborators against real tables. Two things
/// still cannot be reproduced here: PGlite runs in a single process, so two
/// connections never contend for a row lock; and the company settings service is
/// replaced by a fixed tax policy, since tax configuration is not what this
/// suite is testing. Both limits are repeated in the report.

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const WAREHOUSE = '44444444-4444-4444-8444-444444444444';
const ITEM = '55555555-5555-4555-8555-555555555555';
const SHELF_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SHELF_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SHELF_OFF = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SHELF_W2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const WAREHOUSE_2 = '12121212-1212-4212-8212-121212121212';
const CUSTOMER = '66666666-6666-4666-8666-666666666666';
const INVOICE = '77777777-7777-4777-8777-777777777777';
const LINE = '88888888-8888-4888-8888-888888888888';

const D = (value: string | number) => new Prisma.Decimal(value);

const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

/// The five accounts a sales posting resolves, by the codes AccountMapService
/// looks up.
const ACCOUNTS: Array<[string, string, string]> = [
  ['2101', 'Accounts payable', 'ap'],
  ['1104', 'Inventory', 'inventory'],
  ['1105', 'VAT receivable', 'vat'],
];

async function freshDatabase(): Promise<PGlite> {
  const db = new PGlite();
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const dir of dirs) {
    let sql: string;
    try {
      sql = readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8');
    } catch {
      continue;
    }
    await db.exec(sql);
  }

  const accountRows = ACCOUNTS.map(
    ([code, nameEn], index) => `
    INSERT INTO accounts (id, "companyId", code, "nameEn", "nameAr", type, "isPostable", "isActive", "updatedAt")
    VALUES ('${accountId(code)}', '${COMPANY}', '${code}', '${nameEn}', '${nameEn}', '${index === 0 ? 'LIABILITY' : 'ASSET'}', true, true, now());`,
  ).join('');

  await db.exec(`
    INSERT INTO companies (id, code, "nameEn", "nameAr", "updatedAt")
    VALUES ('${COMPANY}', 'CO', 'Co', 'شركة', now());

    INSERT INTO branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
    VALUES ('${BRANCH}', '${COMPANY}', 'BR', 'Branch', 'فرع', now());

    INSERT INTO warehouses (id, "companyId", "branchId", code, "nameEn", "nameAr", "isDefault", "isActive", "updatedAt")
    VALUES ('${WAREHOUSE}', '${COMPANY}', '${BRANCH}', 'W1', 'Main', 'رئيسي', true, true, now());

    INSERT INTO suppliers (id, "companyId", code, "nameEn", "nameAr", "isActive", "updatedAt")
    VALUES ('${CUSTOMER}', '${COMPANY}', 'S-1', 'Seller', 'بائع', true, now());

    INSERT INTO storage_locations (id, "companyId", "branchId", "warehouseId", kind, code, "nameEn", "nameAr", "isActive", "updatedAt")
    VALUES ('${SHELF_A}', '${COMPANY}', '${BRANCH}', '${WAREHOUSE}', 'SHELF', 'A-01', 'A1', 'أ١', true, now()),
           ('${SHELF_B}', '${COMPANY}', '${BRANCH}', '${WAREHOUSE}', 'SHELF', 'B-01', 'B1', 'ب١', true, now()),
           ('${SHELF_OFF}', '${COMPANY}', '${BRANCH}', '${WAREHOUSE}', 'SHELF', 'X-01', 'X1', 'س١', false, now());
    INSERT INTO warehouses (id, "companyId", "branchId", code, "nameEn", "nameAr", "isDefault", "isActive", "updatedAt")
    VALUES ('${WAREHOUSE_2}', '${COMPANY}', '${BRANCH}', 'W2', 'Other', 'آخر', false, true, now());
    INSERT INTO storage_locations (id, "companyId", "branchId", "warehouseId", kind, code, "nameEn", "nameAr", "isActive", "updatedAt")
    VALUES ('${SHELF_W2}', '${COMPANY}', '${BRANCH}', '${WAREHOUSE_2}', 'SHELF', 'Z-01', 'Z1', 'ز١', true, now());

    -- The journal stamps createdBy, and that column carries a real foreign key
    -- to users. Without the row the posting would fail at the database, which
    -- is exactly the fidelity this suite is here for.
    INSERT INTO users (id, "companyId", username, "fullNameEn", "fullNameAr", "passwordHash", "updatedAt")
    VALUES ('${USER}', '${COMPANY}', 'tester', 'Tester', 'مختبِر', 'x', now());

    INSERT INTO items (id, "companyId", code, "nameEn", "nameAr", unit, "isStockTracked",
                       "requiresBatch", "useFefo", "allowExpiredIssue", "salePrice", "updatedAt")
    VALUES ('${ITEM}', '${COMPANY}', 'IT-1', 'Milk', 'حليب', 'piece', true,
            false, false, false, 10, now());

    ${accountRows}
  `);
  return db;
}

function accountId(code: string): string {
  // Deterministic test ids: readable when a failure prints one, and stable
  // enough that a second seeding attempt collides instead of hiding a bug.
  const suffix = code.padStart(12, '0');
  return `99999999-9999-4999-8999-${suffix}`;
}


function parts(db: PGlite) {
  const prisma = pglitePrisma(db as never);
  const ledger = new StockLedgerService();
  const audit = new AuditService(prisma as never);
  const posting = new PostingService(
    new DocumentNumberService(),
    new FiscalPeriodsService(prisma as never, audit as never),
    new CostCentersService(prisma as never, audit as never),
  );
  const batches = new BatchesService(prisma as never, {} as never, posting as never, new AccountMapService() as never, new DocumentNumberService() as never, audit as never, ledger);
  const service = new PurchaseInvoicesService(
    prisma as never,
    new DocumentNumberService(),
    posting,
    new AccountMapService(),
    { get: async () => ({ defaultTaxRate: D(0), taxRate: '0.0000', maxDiscountPercent: '100.0000', pricesIncludeTax: false }) } as never,
    new WarehouseService(prisma as never, audit as never),
    ledger,
    { resolvePrice: async () => null } as never,
    audit as never,
    batches,
  );
  return { service, batches };
}
const serviceWith = (db: PGlite) => parts(db).service;

jest.setTimeout(180_000);
const vmReady =
  process.execArgv.includes('--experimental-vm-modules') ||
  (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules');

(vmReady ? describe : describe.skip)('purchase invoice line shelf over a real engine', () => {
  let db: PGlite;
  beforeEach(async () => { db = await freshDatabase(); });
  afterEach(async () => { await db.close(); });

  const dto = (storageLocationId?: string, warehouseId: string | null = WAREHOUSE) => ({
    supplierId: CUSTOMER, invoiceDate: '2026-11-07', ...(warehouseId ? { warehouseId } : {}),
    lines: [{ itemId: ITEM, quantity: '5', unitPrice: '4', taxRate: '0', ...(storageLocationId ? { storageLocationId } : {}) }],
  }) as never;
  const fail = async (p: Promise<unknown>) => {
    try { await p; } catch (e) { return (e as { response?: { code?: string; message?: string } }).response ?? { message: String(e) }; }
    return null;
  };
  const inMovements = async () =>
    (await db.query<{ loc: string | null; q: string }>(
      `SELECT "storageLocationId" loc, quantity::text q FROM stock_movements WHERE direction='IN' AND "referenceType"='PURCHASE_INVOICE'`)).rows;

  it('keeps the line shelf through create and findOne, and posts the IN movement onto it', async () => {
    const service = serviceWith(db);
    const created = await service.create(COMPANY, BRANCH, USER, dto(SHELF_A)) as unknown as { id: string };
    const read = await service.findOne(COMPANY, created.id) as unknown as { lines: Array<{ storageLocationId: string | null }> };
    expect(read.lines[0].storageLocationId).toBe(SHELF_A);
    await service.post(COMPANY, USER, created.id);
    expect(await inMovements()).toEqual([{ loc: SHELF_A, q: '5.0000' }]);
  });

  it('posts with no shelf exactly as before (unlocated)', async () => {
    const service = serviceWith(db);
    const created = await service.create(COMPANY, BRANCH, USER, dto()) as unknown as { id: string };
    await service.post(COMPANY, USER, created.id);
    expect(await inMovements()).toEqual([{ loc: null, q: '5.0000' }]);
  });

  it('refuses a shelf of another warehouse with an actionable message and keeps no invoice', async () => {
    const service = serviceWith(db);
    const err = await fail(service.create(COMPANY, BRANCH, USER, dto(SHELF_W2)));
    expect(err?.code).toBe('PURCHASE_LOCATION_WRONG_WAREHOUSE');
    expect(err?.message).toContain('Z-01');
    expect((await db.query(`SELECT 1 FROM purchase_invoices`)).rows).toHaveLength(0);
  });

  it('refuses an inactive shelf', async () => {
    const err = await fail(serviceWith(db).create(COMPANY, BRANCH, USER, dto(SHELF_OFF)));
    expect(err?.code).toBe('PURCHASE_LOCATION_INACTIVE');
  });

  it('re-checks the shelf at posting when the invoice had no warehouse until then', async () => {
    const service = serviceWith(db);
    const created = await service.create(COMPANY, BRANCH, USER, dto(SHELF_W2, null)) as unknown as { id: string };
    const err = await fail(service.post(COMPANY, USER, created.id));
    expect(err?.code).toBe('PURCHASE_LOCATION_WRONG_WAREHOUSE');
    expect(await inMovements()).toEqual([]);
  });

  it('keeps a changed shelf through updateDraft and read, validated against the retained warehouse', async () => {
    const service = serviceWith(db);
    const created = await service.create(COMPANY, BRANCH, USER, dto(SHELF_A)) as unknown as { id: string };
    // the update names no warehouse: the retained one decides
    await service.updateDraft(COMPANY, BRANCH, USER, created.id, dto(SHELF_B, null));
    const read = await service.findOne(COMPANY, created.id) as unknown as { warehouseId: string; lines: Array<{ storageLocationId: string }> };
    expect(read.warehouseId).toBe(WAREHOUSE);
    expect(read.lines[0].storageLocationId).toBe(SHELF_B);
    const err = await fail(service.updateDraft(COMPANY, BRANCH, USER, created.id, dto(SHELF_W2, null)));
    expect(err?.code).toBe('PURCHASE_LOCATION_WRONG_WAREHOUSE');
    await service.post(COMPANY, USER, created.id);
    expect(await inMovements()).toEqual([{ loc: SHELF_B, q: '5.0000' }]);
  });

  describe('a lot-controlled item receives into a real lot', () => {
    const lotDto = (extra: Record<string, unknown>) => ({
      supplierId: CUSTOMER, invoiceDate: '2026-11-07', warehouseId: WAREHOUSE,
      lines: [{ itemId: ITEM, quantity: '5', unitPrice: '4', taxRate: '0', storageLocationId: SHELF_A, ...extra }],
    }) as never;
    beforeEach(async () => {
      await db.exec(`UPDATE items SET "requiresBatch"=true, "requiresExpiryDate"=true WHERE id='${ITEM}'`);
    });
    const lots = async () =>
      (await db.query<{ n: string; r: string; s: string }>(`SELECT "batchNumber" n, "remainingQuantity"::text r, status s FROM item_batches`)).rows;

    it('refuses to post without lot details, says what to enter, and writes nothing', async () => {
      const service = serviceWith(db);
      const created = await service.create(COMPANY, BRANCH, USER, lotDto({})) as unknown as { id: string };
      const err = await fail(service.post(COMPANY, USER, created.id));
      expect(err?.code).toBe('PURCHASE_LOT_DETAILS_REQUIRED');
      expect(err?.message).toContain('IT-1');
      expect(await inMovements()).toEqual([]);
      expect(await lots()).toEqual([]);
    });

    it('creates the lot on the shelf, and the stock can then be issued by the lot engine', async () => {
      const { service, batches } = parts(db);
      const created = await service.create(COMPANY, BRANCH, USER, lotDto({ batchNumber: 'P-1', batchExpiryDate: '2027-06-01' })) as unknown as { id: string };
      await service.post(COMPANY, USER, created.id);
      expect(await lots()).toEqual([{ n: 'P-1', r: '5.0000', s: 'OPEN' }]);
      const mv = (await db.query<{ b: string | null; loc: string | null }>(`SELECT "batchId" b, "storageLocationId" loc FROM stock_movements WHERE "referenceType"='PURCHASE_INVOICE'`)).rows;
      expect(mv[0].b).not.toBeNull();
      expect(mv[0].loc).toBe(SHELF_A);
      const issued = await batches.issue(COMPANY, USER, { branchId: BRANCH, warehouseId: WAREHOUSE, itemId: ITEM, quantity: 2, storageLocationId: SHELF_A });
      expect(issued.quantity).toBe('2.0000');
      expect(await lots()).toEqual([{ n: 'P-1', r: '3.0000', s: 'OPEN' }]);
    });

    it('reverses only this invoice contribution when two receipts share one numbered lot', async () => {
      const service = serviceWith(db);
      const first = await service.create(COMPANY, BRANCH, USER, lotDto({ batchNumber: 'SHARED', batchExpiryDate: '2027-06-01' })) as unknown as {id:string};
      const second = await service.create(COMPANY, BRANCH, USER, lotDto({ batchNumber: 'SHARED', batchExpiryDate: '2027-06-01', storageLocationId: SHELF_B })) as unknown as {id:string};
      await service.post(COMPANY, USER, first.id);
      await service.post(COMPANY, USER, second.id);
      expect(await lots()).toEqual([{n:'SHARED',r:'10.0000',s:'OPEN'}]);
      await service.reverse(COMPANY, USER, first.id);
      expect(await lots()).toEqual([{n:'SHARED',r:'5.0000',s:'OPEN'}]);
      const balances=(await db.query<{loc:string;q:string}>(`SELECT "storageLocationId" loc,SUM(CASE WHEN direction='IN' THEN quantity ELSE -quantity END)::text q FROM stock_movements GROUP BY "storageLocationId"`)).rows;
      expect(balances.find(r=>r.loc===SHELF_A)?.q).toBe('0.0000');
      expect(balances.find(r=>r.loc===SHELF_B)?.q).toBe('5.0000');
      expect((await service.findOne(COMPANY,second.id) as {status:string}).status).toBe('posted');
    });

    it('reverses a lot purchase out of the same lot and shelf, and refuses once part was issued', async () => {
      const { service, batches } = parts(db);
      const a = await service.create(COMPANY, BRANCH, USER, lotDto({ batchNumber: 'P-2', batchExpiryDate: '2027-06-01' })) as unknown as { id: string };
      await service.post(COMPANY, USER, a.id);
      await service.reverse(COMPANY, USER, a.id);
      expect((await lots()).find((l) => l.n === 'P-2')?.r).toBe('0.0000');
      const b = await service.create(COMPANY, BRANCH, USER, lotDto({ batchNumber: 'P-3', batchExpiryDate: '2027-05-01' })) as unknown as { id: string };
      await service.post(COMPANY, USER, b.id);
      // other stock on hand, so only the lot itself can say no
      const c = await service.create(COMPANY, BRANCH, USER, lotDto({ batchNumber: 'P-4', batchExpiryDate: '2027-06-01' })) as unknown as { id: string };
      await service.post(COMPANY, USER, c.id);
      await batches.issue(COMPANY, USER, { branchId: BRANCH, warehouseId: WAREHOUSE, itemId: ITEM, quantity: 1, storageLocationId: SHELF_A });
      const err = await fail(service.reverse(COMPANY, USER, b.id));
      expect(err?.code).toBe('PURCHASE_REVERSE_LOT_USED');
      expect((await lots()).find((l) => l.n === 'P-3')?.r).toBe('4.0000');
    });
  });
});
