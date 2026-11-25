/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles over the PGlite adapter */
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { PGlite } from '@electric-sql/pglite';

import { EIGHT_DIGIT_STARTER_ACCOUNTS } from '../../../prisma/starter-chart';
import { AuditService } from '../../common/audit/audit.service';
import { pglitePrisma } from '../../testing/pglite-adapter';
import { AccountMapService, roleCodeSql } from './account-map.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { CostCentersService } from './cost-centers.service';
import { DocumentNumberService } from './document-number.service';
import { FiscalPeriodsService } from './fiscal-periods.service';
import { PostingService } from './posting.service';

/// The eight digit chart on a real PostgreSQL engine (PGlite) with the
/// project's own migrations: service rules, database triggers, role mapping,
/// posting, and the legacy/conversion boundary.

let EIGHT = '';
let LEGACY = '';
let BRANCH_E = '';
let BRANCH_L = '';
let USER = '';

const migrationsDir = join(process.cwd(), 'prisma', 'migrations');

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
  return db;
}

/// (The product allows one active company; the unique index ignores retired
/// rows, so the test companies are marked retired - the rules under test do
/// not look at that flag.)
/// One pair of companies per test inside the single migrated database (a new
/// PGlite per test exhausts memory).
async function seedCompanies(db: PGlite): Promise<void> {
  EIGHT = randomUUID(); LEGACY = randomUUID(); BRANCH_E = randomUUID(); BRANCH_L = randomUUID(); USER = randomUUID();
  await db.exec(`
    INSERT INTO companies (id, code, "nameEn", "nameAr", "accountCodeScheme", "deletedAt", "updatedAt")
    VALUES ('${EIGHT}', 'E8-${EIGHT}', 'Eight', 'ثمانية', 'EIGHT_DIGIT', now(), now()),
           ('${LEGACY}', 'LG-${LEGACY}', 'Legacy', 'قديم', 'LEGACY', now(), now());
    INSERT INTO branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt")
    VALUES ('${BRANCH_E}', '${EIGHT}', 'B', 'B', 'ف', now()),
           ('${BRANCH_L}', '${LEGACY}', 'B', 'B', 'ف', now());
    INSERT INTO users (id, "companyId", username, "fullNameEn", "fullNameAr", "passwordHash", "updatedAt")
    VALUES ('${USER}', '${EIGHT}', 'tester-${USER}', 'T', 'ت', 'x', now());
    INSERT INTO fiscal_periods (id, "companyId", code, "nameEn", "nameAr", "startDate", "endDate", status, "updatedAt")
    VALUES (gen_random_uuid(), '${EIGHT}', 'FY', 'FY', 'FY', '2026-01-01', '2026-12-31', 'OPEN', now()),
           (gen_random_uuid(), '${LEGACY}', 'FY', 'FY', 'FY', '2026-01-01', '2026-12-31', 'OPEN', now());
  `);
}

function wire(db: PGlite) {
  const prisma = pglitePrisma(db as never) as any;
  const audit = new AuditService(prisma as never);
  return {
    prisma,
    chart: new ChartOfAccountsService(prisma as never, audit as never),
    posting: new PostingService(
      new DocumentNumberService(),
      new FiscalPeriodsService(prisma as never, audit as never),
      new CostCentersService(prisma as never, audit as never),
    ),
    map: new AccountMapService(),
  };
}

async function seedStarter(db: PGlite, companyId: string) {
  const sorted = [...EIGHT_DIGIT_STARTER_ACCOUNTS].sort((a, b) => a.code.length - b.code.length);
  for (const a of sorted) {
    await db.query(
      `INSERT INTO accounts (id, "companyId", code, "nameEn", "nameAr", type, "isPostable", "isActive", "parentId", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::"AccountType", $6, true,
               (SELECT id FROM accounts WHERE "companyId" = $1 AND code = $7), now())`,
      [companyId, a.code, a.nameEn, a.nameAr, a.type, a.postable, a.parent ?? null],
    );
  }
}

async function idOf(db: PGlite, companyId: string, code: string): Promise<string> {
  const r = await db.query<{ id: string }>(`SELECT id FROM accounts WHERE "companyId" = $1 AND code = $2`, [companyId, code]);
  return r.rows[0].id;
}

describe('eight digit chart of accounts (PGlite, real migrations)', () => {
  let db: PGlite;
  beforeAll(async () => { db = await freshDatabase(); }, 60000);
  beforeEach(async () => { await seedCompanies(db); });
  afterAll(async () => { await db.close(); });

  it('builds the 2/4/6/8 chain through the service and only the 8-digit account is postable', async () => {
    const { chart } = wire(db);
    const l1 = await chart.create(EIGHT, USER, { nameEn: 'Assets', type: 'ASSET' });
    expect(l1.code).toBe('01');
    expect(l1.isPostable).toBe(false);
    const l2 = await chart.create(EIGHT, USER, { nameEn: 'Current', type: 'ASSET', parentId: l1.id });
    expect(l2.code).toBe('0101');
    expect(l2.isPostable).toBe(false);
    const l3 = await chart.create(EIGHT, USER, { nameEn: 'Cash group', type: 'ASSET', parentId: l2.id });
    expect(l3.code).toBe('010101');
    expect(l3.isPostable).toBe(false);
    const l4 = await chart.create(EIGHT, USER, { nameEn: 'Cash', type: 'ASSET', parentId: l3.id });
    expect(l4.code).toBe('01010101');
    expect(l4.isPostable).toBe(true);
    const l4b = await chart.create(EIGHT, USER, { nameEn: 'Bank', type: 'ASSET', parentId: l3.id });
    expect(l4b.code).toBe('01010102');
    // Arabic-Indic digits are normalised
    const l3b = await chart.create(EIGHT, USER, { nameEn: 'Recv', type: 'ASSET', parentId: l2.id, code: '٠١٠١٠٢' });
    expect(l3b.code).toBe('010102');
  });

  it('refuses codes, parents and posting flags that break the rule, and an 8-digit account takes no children', async () => {
    const { chart } = wire(db);
    const l1 = await chart.create(EIGHT, USER, { nameEn: 'Assets', type: 'ASSET' });
    const l2 = await chart.create(EIGHT, USER, { nameEn: 'Current', type: 'ASSET', parentId: l1.id });
    await expect(chart.create(EIGHT, USER, { nameEn: 'x', type: 'ASSET', code: '1' })).rejects.toThrow(/2, 4, 6 or 8/);
    await expect(chart.create(EIGHT, USER, { nameEn: 'x', type: 'ASSET', parentId: l2.id, code: '0201' })).rejects.toThrow();
    await expect(chart.create(EIGHT, USER, { nameEn: 'x', type: 'ASSET', parentId: l2.id, code: '01010101' })).rejects.toThrow(/start with its parent/);
    await expect(chart.create(EIGHT, USER, { nameEn: 'x', type: 'ASSET', parentId: l2.id, code: '010101', isPostable: true })).rejects.toThrow(/Only an 8-digit/);
    const l3 = await chart.create(EIGHT, USER, { nameEn: 'g', type: 'ASSET', parentId: l2.id });
    const l4 = await chart.create(EIGHT, USER, { nameEn: 'a', type: 'ASSET', parentId: l3.id });
    await expect(chart.create(EIGHT, USER, { nameEn: 'x', type: 'ASSET', parentId: l4.id })).rejects.toThrow(/last level/);
    await expect(chart.suggestCode(EIGHT, l4.id)).rejects.toThrow(/last level/);
    // updates: cannot make a total postable, cannot rename a parent that has children
    await expect(chart.update(EIGHT, USER, l3.id, { isPostable: true })).rejects.toThrow();
    await expect(chart.update(EIGHT, USER, l3.id, { code: '010199' })).rejects.toThrow(/sub-accounts/);
    // a childless 8-digit account may change code only inside its parent prefix
    await expect(chart.update(EIGHT, USER, l4.id, { code: '02020202' })).rejects.toThrow(/start with its parent/);
    const renamed = await chart.update(EIGHT, USER, l4.id, { code: '01010155' });
    expect(renamed.code).toBe('01010155');
  });

  it('the database itself refuses a chart that breaks the rule, whatever path wrote it', async () => {
    await seedStarter(db, EIGHT);
    const insert = (code: string, postable: boolean, parent: string | null) =>
      db.query(
        `INSERT INTO accounts (id, "companyId", code, "nameEn", "nameAr", type, "isPostable", "parentId", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, 'x', 'x', 'ASSET', $3, (SELECT id FROM accounts WHERE "companyId" = $1 AND code = $4), now())`,
        [EIGHT, code, postable, parent],
      );
    await expect(insert('1105', true, '0101')).rejects.toThrow(/Eight digit chart rule/);
    await expect(insert('010199', true, '0101')).rejects.toThrow(/only 8-digit/);
    await expect(insert('01019999', true, '0101')).rejects.toThrow(/extend its parent/);
    await expect(insert('01010199', true, '010101')).resolves.toBeDefined();
    // making an existing total postable is refused too
    await expect(db.query(`UPDATE accounts SET "isPostable" = true WHERE "companyId" = $1 AND code = '010101'`, [EIGHT])).rejects.toThrow(/only 8-digit/);
    // the legacy company is not affected
    await expect(
      db.query(`INSERT INTO accounts (id, "companyId", code, "nameEn", "nameAr", type, "isPostable", "updatedAt") VALUES (gen_random_uuid(), $1, '1101', 'Cash', 'x', 'ASSET', true, now())`, [LEGACY]),
    ).resolves.toBeDefined();
  });

  it('posting resolves roles by scheme, posts to 8-digit accounts, and refuses a total even if its flag were wrong', async () => {
    const { prisma, posting, map } = wire(db);
    await seedStarter(db, EIGHT);
    const roles = await prisma.$transaction((tx: any) => map.resolve(tx, EIGHT, ['accountsReceivable', 'salesRevenue', 'inventory', 'vatPayable']));
    expect(roles.accountsReceivable).toBe(await idOf(db, EIGHT, '01010201'));
    expect(roles.salesRevenue).toBe(await idOf(db, EIGHT, '04010101'));

    // Report SQL picks the same role code per company scheme.
    const eightCode = await prisma.$queryRaw(Prisma.sql`SELECT ${roleCodeSql('accountsReceivable', EIGHT)} AS code`);
    const legacyCode = await prisma.$queryRaw(Prisma.sql`SELECT ${roleCodeSql('accountsReceivable', LEGACY)} AS code`);
    expect([eightCode[0].code, legacyCode[0].code]).toEqual(['01010201', '1103']);

    const cash = await idOf(db, EIGHT, '01010101');
    const sales = await idOf(db, EIGHT, '04010101');
    const post = (debit: string, credit: string) =>
      prisma.$transaction((tx: any) => posting.post(tx, {
        companyId: EIGHT, branchId: BRANCH_E, userId: USER, entryDate: new Date('2026-11-07'),
        description: 'sale', sourceType: 'SALES_INVOICE', sourceId: randomUUID(), sourceNumber: 'T-1',
        lines: [{ accountId: debit, debit: '100' }, { accountId: credit, credit: '100' }],
      } as never));
    await expect(post(cash, sales)).resolves.toBeDefined();

    // a total
    const total = await idOf(db, EIGHT, '010101');
    await expect(post(total, sales)).rejects.toThrow(/cannot receive postings/);

    // Even if a total's flag were forced on behind the application's back
    // (trigger off), the line trigger still refuses the entry.
    await db.exec(`ALTER TABLE accounts DISABLE TRIGGER accounts_eight_digit_scheme`);
    await db.query(`UPDATE accounts SET "isPostable" = true WHERE id = $1`, [total]);
    await db.exec(`ALTER TABLE accounts ENABLE TRIGGER accounts_eight_digit_scheme`);
    await expect(post(total, sales)).rejects.toThrow(/only 8-digit accounts accept entries/);
    const count = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM journal_lines l JOIN accounts a ON a.id = l."accountId" WHERE a.id = $1`, [total]);
    expect(count.rows[0].n).toBe(0);
  });

  it('a legacy company keeps posting on its own four-digit codes (no lockout)', async () => {
    const { prisma, posting, map } = wire(db);
    for (const [code, type] of [['1101', 'ASSET'], ['4101', 'REVENUE'], ['1103', 'ASSET']] as const) {
      await db.query(`INSERT INTO accounts (id, "companyId", code, "nameEn", "nameAr", type, "isPostable", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'x', 'x', $3::"AccountType", true, now())`, [LEGACY, code, type]);
    }
    const roles = await prisma.$transaction((tx: any) => map.resolve(tx, LEGACY, ['accountsReceivable']));
    expect(roles.accountsReceivable).toBe(await idOf(db, LEGACY, '1103'));
    const a = await idOf(db, LEGACY, '1101');
    const b = await idOf(db, LEGACY, '4101');
    await expect(prisma.$transaction((tx: any) => posting.post(tx, {
      companyId: LEGACY, branchId: BRANCH_L, userId: USER, entryDate: new Date('2026-11-07'),
      description: 'legacy', sourceType: 'SALES_INVOICE', sourceId: randomUUID(), sourceNumber: 'T-1',
      lines: [{ accountId: a, debit: '5' }, { accountId: b, credit: '5' }],
    } as never))).resolves.toBeDefined();
  });

  it('switching a legacy company is all-or-nothing', async () => {
    for (const [code, type, postable] of [['1', 'ASSET', false], ['11', 'ASSET', false], ['1101', 'ASSET', true]] as const) {
      await db.query(`INSERT INTO accounts (id, "companyId", code, "nameEn", "nameAr", type, "isPostable", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'x', 'x', $3::"AccountType", $4, now())`, [LEGACY, code, type, postable]);
    }
    await expect(db.query(`UPDATE companies SET "accountCodeScheme" = 'EIGHT_DIGIT' WHERE id = $1`, [LEGACY])).rejects.toThrow(/does not follow the eight digit rule/);
    // a conforming chart converts
    await db.exec(`DELETE FROM accounts WHERE "companyId" = '${LEGACY}'`);
    await seedStarter(db, LEGACY);
    await expect(db.query(`UPDATE companies SET "accountCodeScheme" = 'EIGHT_DIGIT' WHERE id = $1`, [LEGACY])).resolves.toBeDefined();
    await expect(db.query(`UPDATE companies SET "accountCodeScheme" = 'LEGACY' WHERE id = $1`, [LEGACY])).resolves.toBeDefined();
  });

  it('refuses conversion while journal history uses non 8-digit accounts', async () => {
    const { prisma, posting } = wire(db);
    for (const [code, type] of [['1101', 'ASSET'], ['4101', 'REVENUE']] as const) {
      await db.query(`INSERT INTO accounts (id, "companyId", code, "nameEn", "nameAr", type, "isPostable", "updatedAt") VALUES (gen_random_uuid(), $1, $2, 'x', 'x', $3::"AccountType", true, now())`, [LEGACY, code, type]);
    }
    const cashId = await idOf(db, LEGACY, '1101');
    const salesId = await idOf(db, LEGACY, '4101');
    await prisma.$transaction((tx: any) => posting.post(tx, {
      companyId: LEGACY, branchId: BRANCH_L, userId: USER, entryDate: new Date('2026-11-07'),
      description: 'h', sourceType: 'SALES_INVOICE', sourceId: randomUUID(), sourceNumber: 'T-1',
      lines: [{ accountId: cashId, debit: '5' }, { accountId: salesId, credit: '5' }],
    } as never));
    await expect(db.query(`UPDATE companies SET "accountCodeScheme" = 'EIGHT_DIGIT' WHERE id = $1`, [LEGACY])).rejects.toThrow();
  });
});

