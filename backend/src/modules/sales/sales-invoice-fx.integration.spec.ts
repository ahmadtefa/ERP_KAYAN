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
    ledger, { assertCanPost: async () => undefined, assertPeriodCanPost: async () => undefined } as never,
    );
  return { service, prisma, ledger, batches };
}

const vmLacksDynamicImport = !(
  process.execArgv.includes('--experimental-vm-modules') ||
  (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules')
);


const q = async (db: PGlite, sql: string, params: unknown[] = []) => (await db.query<Record<string, string>>(sql, params)).rows;

const baseDto = (over: Record<string, unknown> = {}) => ({
  invoiceDate: '2026-11-07',
  customerId: CUSTOMER,
  warehouseId: WAREHOUSE,
  currency: 'USD',
  lines: [{ itemId: ITEM, quantity: '3', unitPrice: '10.00', taxRate: '14' }],
  ...over,
});

(vmLacksDynamicImport ? describe.skip : describe)('sales invoice in a foreign currency (real PostgreSQL engine)', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await freshDatabase();
    // A service item: no stock moves, so the journal is only receivable, revenue and VAT.
    await db.query(`UPDATE items SET "isStockTracked"=false, "requiresBatch"=false, "useFefo"=false WHERE id=$1`, [ITEM]);
    await db.query(`INSERT INTO currencies (id,"companyId",code,"nameAr","nameEn","isActive","updatedAt") VALUES (gen_random_uuid(),$1,'USD','دولار','US dollar',true,now())`, [COMPANY]);
    await db.query(`INSERT INTO currencies (id,"companyId",code,"nameAr","nameEn","isActive","updatedAt") VALUES (gen_random_uuid(),$1,'EUR','يورو','Euro',false,now())`, [COMPANY]);
  });
  afterEach(async () => { await db.close(); });

  it('stores the base-currency invoice at the typed rate and keeps the quoted foreign figures', async () => {
    const { service } = serviceWith(db);
    const created = await service.create(COMPANY, BRANCH, USER, baseDto({ exchangeRate: '50' }) as never);
    expect(Number(created.subTotal)).toBe(1500);
    expect(Number(created.taxAmount)).toBe(210);
    expect(Number(created.totalAmount)).toBe(1710);
    const [fx] = await q(db, `SELECT currency, rate::text AS rate, "rateSource" AS src, "foreignSubTotal"::text AS s, "foreignTaxAmount"::text AS t, "foreignTotal"::text AS total FROM sales_invoice_fx WHERE "invoiceId"=$1`, [created.id]);
    expect(fx.currency).toBe('USD');
    expect(Number(fx.rate)).toBe(50);
    expect(fx.src).toBe('TYPED');
    expect(Number(fx.s)).toBe(30);
    expect(Number(fx.t)).toBe(4.2);
    expect(Number(fx.total)).toBe(34.2);
  });

  it('uses the latest saved rate on or before the invoice date when none is typed', async () => {
    await db.query(`INSERT INTO exchange_rates (id,"companyId","currencyCode","rateDate",rate) VALUES (gen_random_uuid(),$1,'USD','2026-11-01',48),(gen_random_uuid(),$1,'USD','2026-11-05',49.5),(gen_random_uuid(),$1,'USD','2026-11-20',60)`, [COMPANY]);
    const { service } = serviceWith(db);
    const created = await service.create(COMPANY, BRANCH, USER, baseDto() as never);
    expect(Number(created.subTotal)).toBe(1485);
    const [fx] = await q(db, `SELECT rate::text AS rate, "rateSource" AS src FROM sales_invoice_fx WHERE "invoiceId"=$1`, [created.id]);
    expect(Number(fx.rate)).toBe(49.5);
    expect(fx.src).toBe('TABLE');
  });

  it('posts one balanced entry in company currency that equals the foreign total at the rate, and reverses it', async () => {
    const { service } = serviceWith(db);
    const created = await service.create(COMPANY, BRANCH, USER, baseDto({ exchangeRate: '50' }) as never);
    await service.post(COMPANY, USER, created.id);
    const entries = await q(db, `SELECT id, "totalDebit"::text AS d, "totalCredit"::text AS c FROM journal_entries WHERE "sourceId"=$1`, [created.id]);
    expect(entries).toHaveLength(1);
    expect(Number(entries[0].d)).toBe(1710);
    expect(Number(entries[0].c)).toBe(1710);
    const ar = await q(db, `SELECT l.debit::text AS debit FROM journal_lines l JOIN accounts a ON a.id=l."accountId" WHERE l."journalEntryId"=$1 AND a.code='1103'`, [entries[0].id]);
    expect(Number(ar[0].debit)).toBe(1710);
    const vat = await q(db, `SELECT l.credit::text AS credit FROM journal_lines l JOIN accounts a ON a.id=l."accountId" WHERE l."journalEntryId"=$1 AND a.code='2103'`, [entries[0].id]);
    expect(Number(vat[0].credit)).toBe(210);
    await service.reverse(COMPANY, USER, created.id);
    const [inv] = await q(db, `SELECT status FROM sales_invoices WHERE id=$1`, [created.id]);
    expect(inv.status).toBe('REVERSED');
  });

  it('an ordinary company-currency invoice has no foreign row and its figures do not change', async () => {
    const { service } = serviceWith(db);
    const created = await service.create(COMPANY, BRANCH, USER, baseDto({ currency: undefined }) as never);
    expect(Number(created.subTotal)).toBe(30);
    expect(await q(db, `SELECT 1 FROM sales_invoice_fx WHERE "invoiceId"=$1`, [created.id])).toHaveLength(0);
    const same = await service.create(COMPANY, BRANCH, USER, baseDto({ currency: 'EGP' }) as never);
    expect(Number(same.subTotal)).toBe(30);
  });

  it('refuses a missing rate, an unknown or inactive currency, a rate without a currency and a line without a typed price', async () => {
    const { service } = serviceWith(db);
    await expect(service.create(COMPANY, BRANCH, USER, baseDto() as never)).rejects.toMatchObject({ response: { code: 'FX_RATE_MISSING' } });
    await expect(service.create(COMPANY, BRANCH, USER, baseDto({ currency: 'EUR', exchangeRate: '55' }) as never)).rejects.toMatchObject({ response: { code: 'INVOICE_FX_CURRENCY_UNKNOWN' } });
    await expect(service.create(COMPANY, BRANCH, USER, baseDto({ currency: 'GBP', exchangeRate: '60' }) as never)).rejects.toMatchObject({ response: { code: 'INVOICE_FX_CURRENCY_UNKNOWN' } });
    await expect(service.create(COMPANY, BRANCH, USER, baseDto({ currency: undefined, exchangeRate: '50' }) as never)).rejects.toMatchObject({ response: { code: 'INVOICE_FX_RATE_WITHOUT_CURRENCY' } });
    await expect(service.create(COMPANY, BRANCH, USER, baseDto({ exchangeRate: '50', lines: [{ itemId: ITEM, quantity: '1', taxRate: '0' }] }) as never)).rejects.toMatchObject({ response: { code: 'INVOICE_FX_PRICE_REQUIRED' } });
    await expect(service.create(COMPANY, BRANCH, USER, baseDto({ exchangeRate: '0' }) as never)).rejects.toMatchObject({ response: { code: 'CURRENCY_RATE_BAD' } });
    expect(await q(db, `SELECT 1 FROM sales_invoices`)).toHaveLength(0);
  });

  it('editing a draft replaces the foreign figures, and switching back to company currency removes them', async () => {
    const { service } = serviceWith(db);
    const created = await service.create(COMPANY, BRANCH, USER, baseDto({ exchangeRate: '50' }) as never);
    await service.updateDraft(COMPANY, BRANCH, USER, created.id, baseDto({ exchangeRate: '40', lines: [{ itemId: ITEM, quantity: '2', unitPrice: '5', taxRate: '0' }] }) as never);
    const [fx] = await q(db, `SELECT rate::text AS rate, "foreignTotal"::text AS total FROM sales_invoice_fx WHERE "invoiceId"=$1`, [created.id]);
    expect(Number(fx.rate)).toBe(40);
    expect(Number(fx.total)).toBe(10);
    const [inv] = await q(db, `SELECT "totalAmount"::text AS total FROM sales_invoices WHERE id=$1`, [created.id]);
    expect(Number(inv.total)).toBe(400);
    await service.updateDraft(COMPANY, BRANCH, USER, created.id, baseDto({ currency: undefined, lines: [{ itemId: ITEM, quantity: '1', unitPrice: '7', taxRate: '0' }] }) as never);
    expect(await q(db, `SELECT 1 FROM sales_invoice_fx WHERE "invoiceId"=$1`, [created.id])).toHaveLength(0);
  });
});
