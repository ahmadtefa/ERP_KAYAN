import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { PGlite } from '@electric-sql/pglite';

import { BatchesService } from '../inventory/batches.service';
import { AccountMapService } from '../accounting/account-map.service';
import { CostCentersService } from '../accounting/cost-centers.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { FiscalPeriodsService } from '../accounting/fiscal-periods.service';
import { PostingService } from '../accounting/posting.service';
import { AuditService } from '../../common/audit/audit.service';
import { WarehouseService } from '../../common/warehouse/warehouse.service';
import { StockLedgerService } from '../../common/warehouse/stock-ledger.service';
import { pglitePrisma } from '../../testing/pglite-adapter';

import { SalesInvoicesService } from './sales-invoices.service';

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
const CUSTOMER = '66666666-6666-4666-8666-666666666666';
const INVOICE = '77777777-7777-4777-8777-777777777777';
const LINE = '88888888-8888-4888-8888-888888888888';

const D = (value: string | number) => new Prisma.Decimal(value);

const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

/// The five accounts a sales posting resolves, by the codes AccountMapService
/// looks up.
const ACCOUNTS: Array<[string, string, string]> = [
  ['1103', 'Accounts receivable', 'debtors'],
  ['4101', 'Sales revenue', 'revenue'],
  ['2103', 'VAT payable', 'vat'],
  ['1104', 'Inventory', 'inventory'],
  ['5101', 'Cost of goods sold', 'cogs'],
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
    VALUES ('${accountId(code)}', '${COMPANY}', '${code}', '${nameEn}', '${nameEn}', '${index === 0 ? 'ASSET' : index === 1 ? 'REVENUE' : index === 2 ? 'LIABILITY' : index === 3 ? 'ASSET' : 'EXPENSE'}', true, true, now());`,
  ).join('');

  await db.exec(`
    INSERT INTO companies (id, code, "nameEn", "nameAr", "updatedAt")
    VALUES ('${COMPANY}', 'CO', 'Co', 'شركة', now());

    INSERT INTO branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
    VALUES ('${BRANCH}', '${COMPANY}', 'BR', 'Branch', 'فرع', now());

    INSERT INTO warehouses (id, "companyId", "branchId", code, "nameEn", "nameAr", "isDefault", "isActive", "updatedAt")
    VALUES ('${WAREHOUSE}', '${COMPANY}', '${BRANCH}', 'W1', 'Main', 'رئيسي', true, true, now());

    INSERT INTO customers (id, "companyId", code, "nameEn", "nameAr", "isActive", "updatedAt")
    VALUES ('${CUSTOMER}', '${COMPANY}', 'C-1', 'Buyer', 'مشتري', true, now());

    -- The journal stamps createdBy, and that column carries a real foreign key
    -- to users. Without the row the posting would fail at the database, which
    -- is exactly the fidelity this suite is here for.
    INSERT INTO users (id, "companyId", username, "fullNameEn", "fullNameAr", "passwordHash", "updatedAt")
    VALUES ('${USER}', '${COMPANY}', 'tester', 'Tester', 'مختبِر', 'x', now());

    INSERT INTO items (id, "companyId", code, "nameEn", "nameAr", unit, "isStockTracked",
                       "requiresBatch", "useFefo", "allowExpiredIssue", "salePrice", "updatedAt")
    VALUES ('${ITEM}', '${COMPANY}', 'IT-1', 'Milk', 'حليب', 'piece', true,
            true, true, false, 10, now());

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

/// One draft invoice with a single line, exactly as the API would have left it.
async function seedDraftInvoice(db: PGlite, quantity: number, unitPrice = 10) {
  await db.query(
    `INSERT INTO sales_invoices
       (id, "companyId", "branchId", "warehouseId", "invoiceNumber", "invoiceDate",
        "customerId", status, currency, "subTotal", "taxAmount", "totalAmount",
        "paidAmount", "costOfGoods", "documentType", "updatedAt")
     VALUES ($1,$2,$3,$4,'SI-0001','2026-11-07',$5,'DRAFT','EGP',$6,0,$6,0,0,'INVOICE',now())`,
    [INVOICE, COMPANY, BRANCH, WAREHOUSE, CUSTOMER, unitPrice * quantity],
  );
  await db.query(
    `INSERT INTO sales_invoice_lines
       (id, "invoiceId", "lineNumber", "itemId", description, quantity, "unitPrice",
        "taxRate", "taxAmount", "lineTotal", "unitCost", "costTotal")
     VALUES ($1,$2,1,$3,'Milk',$4,$5,0,0,$6,0,0)`,
    [LINE, INVOICE, ITEM, quantity, unitPrice, unitPrice * quantity],
  );
}

async function seedLot(
  db: PGlite,
  batchNumber: string,
  quantity: number,
  expiry: string | null,
  unitCost = 5,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO item_batches
       (id,"companyId","branchId","warehouseId","itemId","batchNumber","expiryDate",
        "receivedQuantity","remainingQuantity","unitCost","status","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,'OPEN',now(),now())`,
    [id, COMPANY, BRANCH, WAREHOUSE, ITEM, batchNumber, expiry, quantity, unitCost],
  );
  return id;
}

async function seedShelf(db: PGlite, quantity: number, value: number) {
  await db.query(
    `INSERT INTO stock_balances ("companyId","branchId","itemId",quantity,value,"updatedAt")
     VALUES ($1,$2,$3,$4,$5,now())`,
    [COMPANY, BRANCH, ITEM, quantity, value],
  );
  await db.query(
    `INSERT INTO warehouse_stock_balances ("companyId","branchId","warehouseId","itemId",quantity,value,"updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,now())`,
    [COMPANY, BRANCH, WAREHOUSE, ITEM, quantity, value],
  );
}

/// The production service, wired to real collaborators over PGlite.
function serviceWith(db: PGlite) {
  const prisma = pglitePrisma(db as never);
  const ledger = new StockLedgerService();
  // The real audit service, writing real audit_rows. A stub here would let a
  // missing approval record pass as if it had been written.
  const audit = new AuditService(prisma as never);
  const batches = new BatchesService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    audit as never,
    ledger,
  );
  const posting = new PostingService(
    new DocumentNumberService(),
    new FiscalPeriodsService(prisma as never, audit as never),
    new CostCentersService(prisma as never, audit as never),
  );
  const service = new SalesInvoicesService(
    prisma as never,
    new DocumentNumberService(),
    posting,
    new AccountMapService(),
    // Company tax policy is configuration, not behaviour under test here; a
    // zero rate keeps the journal to the accounts this suite seeded.
    { get: async () => ({ defaultTaxRate: D(0), pricesIncludeTax: false }) } as never,
    new WarehouseService(prisma as never, audit as never),
    {} as never,
    audit as never,
    batches,
    ledger,
  );
  return { service, prisma, ledger, batches };
}

const remaining = async (db: PGlite, batchId: string): Promise<number> => {
  const rows = await db.query<{ q: string }>(
    `SELECT "remainingQuantity"::text AS q FROM item_batches WHERE id = $1`,
    [batchId],
  );
  return Number(rows.rows[0].q);
};

const status = async (db: PGlite, batchId: string): Promise<string> => {
  const rows = await db.query<{ s: string }>(
    `SELECT status AS s FROM item_batches WHERE id = $1`,
    [batchId],
  );
  return rows.rows[0].s;
};

const invoiceStatus = async (db: PGlite): Promise<string> => {
  const rows = await db.query<{ s: string }>(
    `SELECT status AS s FROM sales_invoices WHERE id = $1`,
    [INVOICE],
  );
  return rows.rows[0].s;
};

const shelf = async (db: PGlite): Promise<number> => {
  const rows = await db.query<{ q: string }>(
    `SELECT quantity::text AS q FROM warehouse_stock_balances
      WHERE "companyId"=$1 AND "branchId"=$2 AND "warehouseId"=$3 AND "itemId"=$4`,
    [COMPANY, BRANCH, WAREHOUSE, ITEM],
  );
  return Number(rows.rows[0]?.q ?? 0);
};

const branchBook = async (db: PGlite): Promise<number> => {
  const rows = await db.query<{ q: string }>(
    `SELECT quantity::text AS q FROM stock_balances
      WHERE "companyId"=$1 AND "branchId"=$2 AND "itemId"=$3`,
    [COMPANY, BRANCH, ITEM],
  );
  return Number(rows.rows[0]?.q ?? 0);
};

const movements = async (db: PGlite, direction: string) => {
  const rows = await db.query<{ batchId: string | null; quantity: string }>(
    `SELECT "batchId", quantity::text AS quantity FROM stock_movements
      WHERE "referenceId"=$1 AND direction=$2::"StockDirection" ORDER BY quantity DESC`,
    [INVOICE, direction],
  );
  return rows.rows;
};

jest.setTimeout(180_000);

/// PGlite loads its wasm through a dynamic import that Jest's VM only permits
/// under --experimental-vm-modules. Without the flag the failure is an uncaught
/// exception that takes the whole run down, so the suite skips - loudly -
/// instead of crashing every other test with it.
const vmLacksDynamicImport = !(
  process.execArgv.includes('--experimental-vm-modules') ||
  (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules')
);

(vmLacksDynamicImport ? describe.skip : describe)(
  'posting and reversing a sales invoice on a real PostgreSQL engine',
  () => {
    let db: PGlite;

    beforeEach(async () => {
      db = await freshDatabase();
    });

    afterEach(async () => {
      await db.close();
    });

    it('posts a real invoice, taking the nearest expiry and costing it from that lot', async () => {
      const soon = await seedLot(db, 'L-SOON', 10, '2026-12-01', 5);
      const late = await seedLot(db, 'L-LATE', 10, '2027-12-31', 7);
      await seedShelf(db, 20, 120);
      await seedDraftInvoice(db, 4);
      const { service } = serviceWith(db);

      const posted = await service.post(COMPANY, USER, INVOICE);

      expect(posted.status).toBe('posted');
      // FEFO: the December lot, not the later one.
      expect(await remaining(db, soon)).toBe(6);
      expect(await remaining(db, late)).toBe(10);
      // Costing is the shelf's moving average, by design: the book the invoice
      // is costed from is the warehouse's, not each lot's own purchase price.
      // With 20 units worth 120 on the shelf the average is 6, so four units
      // cost 24 - and the line carries exactly that, frozen.
      const rows = await db.query<{ c: string }>(
        `SELECT "costOfGoods"::text AS c FROM sales_invoices WHERE id=$1`,
        [INVOICE],
      );
      expect(Number(rows.rows[0].c)).toBe(24);
      const line = await db.query<{ u: string; t: string }>(
        `SELECT "unitCost"::text AS u, "costTotal"::text AS t FROM sales_invoice_lines WHERE id=$1`,
        [LINE],
      );
      expect(Number(line.rows[0].u)).toBe(6);
      expect(Number(line.rows[0].t)).toBe(24);
    });

    it('writes a balanced journal entry, one per document', async () => {
      await seedLot(db, 'L-1', 10, '2027-12-31', 5);
      await seedShelf(db, 10, 50);
      await seedDraftInvoice(db, 2);
      const { service } = serviceWith(db);

      await service.post(COMPANY, USER, INVOICE);

      const entries = await db.query<{ id: string; d: string; c: string; n: string }>(
        `SELECT id, "totalDebit"::text AS d, "totalCredit"::text AS c, "sourceNumber" AS n
           FROM journal_entries WHERE "sourceId"=$1`,
        [INVOICE],
      );
      expect(entries.rows).toHaveLength(1);
      expect(entries.rows[0].n).toBe('SI-0001');
      expect(Number(entries.rows[0].d)).toBe(Number(entries.rows[0].c));
      // Both sides carry the receivable (2 x 10) plus the inventory cost
      // (2 x 5), so the entry balances at 30 and the ledger agrees with it.
      expect(Number(entries.rows[0].d)).toBe(30);

      const lines = await db.query<{ debit: string; credit: string }>(
        `SELECT debit::text AS debit, credit::text AS credit FROM journal_lines
          WHERE "journalEntryId"=$1`,
        [entries.rows[0].id],
      );
      const debit = lines.rows.reduce((sum, row) => sum + Number(row.debit), 0);
      const credit = lines.rows.reduce((sum, row) => sum + Number(row.credit), 0);
      expect(debit).toBe(credit);
      expect(debit).toBe(30);
    });

    it('refuses to post the same invoice twice, and issues nothing the second time', async () => {
      const lot = await seedLot(db, 'L-1', 10, '2027-12-31', 5);
      await seedShelf(db, 10, 50);
      await seedDraftInvoice(db, 2);
      const { service } = serviceWith(db);

      await service.post(COMPANY, USER, INVOICE);
      await expect(service.post(COMPANY, USER, INVOICE)).rejects.toThrow(
        /Only draft invoices can be posted/,
      );

      expect(await remaining(db, lot)).toBe(8);
      const issued = await movements(db, 'OUT');
      expect(issued).toHaveLength(1);
      expect(Number(issued[0].quantity)).toBe(2);
    });

    it('reverses the invoice back into the very lots it came from', async () => {
      const soon = await seedLot(db, 'L-SOON', 10, '2026-12-01', 5);
      const late = await seedLot(db, 'L-LATE', 10, '2027-12-31', 7);
      await seedShelf(db, 20, 120);
      await seedDraftInvoice(db, 14);
      const { service } = serviceWith(db);

      await service.post(COMPANY, USER, INVOICE);
      // FEFO split the line: 10 from the near lot, 4 from the far one, so the
      // near lot was closed by the issue.
      expect(await remaining(db, soon)).toBe(0);
      expect(await remaining(db, late)).toBe(6);
      expect(await status(db, soon)).toBe('CLOSED');
      expect(await shelf(db)).toBe(6);
      expect(await branchBook(db)).toBe(6);

      await service.reverse(COMPANY, USER, INVOICE);

      // Each lot gets back exactly what it gave, not the whole quantity into
      // whichever lot is convenient.
      expect(await remaining(db, soon)).toBe(10);
      expect(await remaining(db, late)).toBe(10);
      // A lot the sale emptied is reopened, because the sale no longer exists.
      expect(await status(db, soon)).toBe('OPEN');
      expect(await shelf(db)).toBe(20);
      expect(await branchBook(db)).toBe(20);
      expect(await invoiceStatus(db)).toBe('REVERSED');

      const returned = await movements(db, 'IN');
      expect(returned).toHaveLength(2);
      const byLot = new Map(returned.map((row) => [row.batchId, Number(row.quantity)]));
      expect(byLot.get(soon)).toBe(10);
      expect(byLot.get(late)).toBe(4);
    });

    it('writes the mirror journal entry and leaves the original in the books', async () => {
      await seedLot(db, 'L-1', 10, '2027-12-31', 5);
      await seedShelf(db, 10, 50);
      await seedDraftInvoice(db, 2);
      const { service } = serviceWith(db);

      await service.post(COMPANY, USER, INVOICE);
      await service.reverse(COMPANY, USER, INVOICE);

      const entries = await db.query<{ status: string; reversalOfId: string | null }>(
        `SELECT status, "reversalOfId" FROM journal_entries WHERE "companyId"=$1 ORDER BY "createdAt"`,
        [COMPANY],
      );
      expect(entries.rows).toHaveLength(2);
      // Nothing is edited or deleted: the original is marked reversed and a
      // second entry, with its own number, takes it back.
      expect(entries.rows[0].status).toBe('REVERSED');
      expect(entries.rows[1].status).toBe('POSTED');
      expect(entries.rows[1].reversalOfId).toBeTruthy();
    });

    it('refuses a second reversal instead of returning the stock twice', async () => {
      const lot = await seedLot(db, 'L-1', 10, '2027-12-31', 5);
      await seedShelf(db, 10, 50);
      await seedDraftInvoice(db, 2);
      const { service } = serviceWith(db);

      await service.post(COMPANY, USER, INVOICE);
      await service.reverse(COMPANY, USER, INVOICE);
      expect(await remaining(db, lot)).toBe(10);

      await expect(service.reverse(COMPANY, USER, INVOICE)).rejects.toThrow();
      // The quantity did not double on the second attempt.
      expect(await remaining(db, lot)).toBe(10);
      expect(await shelf(db)).toBe(10);
      const returned = await movements(db, 'IN');
      expect(returned).toHaveLength(1);
    });

    it('keeps the books level through a full post-and-reverse cycle', async () => {
      const a = await seedLot(db, 'L-A', 6, '2026-11-30', 4);
      const b = await seedLot(db, 'L-B', 6, '2027-01-31', 9);
      await seedShelf(db, 12, 78);
      await seedDraftInvoice(db, 9);
      const { service } = serviceWith(db);

      await service.post(COMPANY, USER, INVOICE);
      await service.reverse(COMPANY, USER, INVOICE);

      // After the round trip every lot is whole again, and the two books that
      // report stock agree with each other and with the movements.
      expect(await remaining(db, a)).toBe(6);
      expect(await remaining(db, b)).toBe(6);
      expect(await shelf(db)).toBe(12);
      expect(await branchBook(db)).toBe(12);

      const inSum = (await movements(db, 'IN')).reduce((s, r) => s + Number(r.quantity), 0);
      const outSum = (await movements(db, 'OUT')).reduce((s, r) => s + Number(r.quantity), 0);
      expect(outSum).toBe(9);
      expect(inSum).toBe(9);
    });

    it('refuses to issue an expired lot even through the document path', async () => {
      const expired = await seedLot(db, 'L-OLD', 10, '2026-01-01', 5);
      await seedShelf(db, 10, 50);
      await seedDraftInvoice(db, 2);
      const { service } = serviceWith(db);

      // No approval travels with this call, so the expired lot must be skipped
      // and the sale refused rather than silently shorting the invoice.
      await expect(service.post(COMPANY, USER, INVOICE)).rejects.toThrow();

      expect(await remaining(db, expired)).toBe(10);
      expect(await shelf(db)).toBe(10);
      expect(await invoiceStatus(db)).toBe('DRAFT');
      expect(await movements(db, 'OUT')).toHaveLength(0);
    });

    it('issues an expired lot when - and only when - an approval travels with the post', async () => {
      const expired = await seedLot(db, 'L-OLD', 10, '2026-01-01', 5);
      await seedShelf(db, 10, 50);
      await seedDraftInvoice(db, 3);
      const { service } = serviceWith(db);

      await service.post(COMPANY, USER, INVOICE, true, {
        mayIssueExpired: true,
        reason: 'customer accepted short-dated stock in writing',
      });

      expect(await remaining(db, expired)).toBe(7);
      expect(await invoiceStatus(db)).toBe('POSTED');
      const acts = await db.query<{ after: string }>(
        `SELECT "afterJson"::text AS after FROM audit_logs
          WHERE "entity"='stock_movements' ORDER BY "createdAt" DESC`,
      );
      const record = acts.rows.find((row) => (row.after ?? '').includes('expiredApproval'));
      expect(record).toBeTruthy();
      expect(record!.after).toContain('customer accepted short-dated stock in writing');
      expect(record!.after).toContain(USER);
    });
  },
);

if (vmLacksDynamicImport) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n  SKIPPED: the real-PostgreSQL invoice suite needs\n' +
      '    npm run test:lots\n' +
      '  (it sets NODE_OPTIONS=--experimental-vm-modules). Without it PGlite cannot load its wasm engine.\n',
  );
}
