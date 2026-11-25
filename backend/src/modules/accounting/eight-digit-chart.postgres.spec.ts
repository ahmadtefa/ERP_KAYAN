/* eslint-disable @typescript-eslint/no-explicit-any -- real client used through service doubles */
import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { createPgAdapter } from '../../common/prisma/prisma.service';
import { AccountMapService } from './account-map.service';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { CostCentersService } from './cost-centers.service';
import { DocumentNumberService } from './document-number.service';
import { FiscalPeriodsService } from './fiscal-periods.service';
import { PostingService } from './posting.service';

// Native PostgreSQL proof of the eight digit chart: real triggers, real row
// locks, real Prisma client. Needs a scratch database with every migration:
//   KAYAN_EIGHT_DIGIT_PG=1 DATABASE_URL=<scratch db> npx jest --runInBand <this file>
const run = process.env.KAYAN_EIGHT_DIGIT_PG === '1';
(run ? describe : describe.skip)('eight digit chart on native PostgreSQL', () => {
  let prisma: any;
  let chart: ChartOfAccountsService;
  let posting: PostingService;
  const map = new AccountMapService();
  const company = randomUUID();
  const branch = randomUUID();
  const user = randomUUID();
  const legacy = randomUUID();

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: createPgAdapter() });
    const audit = new AuditService(prisma);
    chart = new ChartOfAccountsService(prisma, audit as never);
    posting = new PostingService(
      new DocumentNumberService(),
      new FiscalPeriodsService(prisma, audit as never),
      new CostCentersService(prisma, audit as never),
    );
    await prisma.$executeRawUnsafe(`UPDATE companies SET "deletedAt" = now() WHERE "deletedAt" IS NULL`);
    await prisma.$executeRawUnsafe(`INSERT INTO companies (id, code, "nameEn", "nameAr", "accountCodeScheme", "updatedAt") VALUES ('${company}', 'E8-${company}', 'E', 'E', 'EIGHT_DIGIT', now())`);
    await prisma.$executeRawUnsafe(`INSERT INTO companies (id, code, "nameEn", "nameAr", "accountCodeScheme", "deletedAt", "updatedAt") VALUES ('${legacy}', 'LG-${legacy}', 'L', 'L', 'LEGACY', now(), now())`);
    await prisma.$executeRawUnsafe(`INSERT INTO branches (id, "companyId", code, "nameEn", "nameAr", "updatedAt") VALUES ('${branch}', '${company}', 'B', 'B', 'B', now())`);
    await prisma.$executeRawUnsafe(`INSERT INTO users (id, "companyId", username, "fullNameEn", "fullNameAr", "passwordHash", "updatedAt") VALUES ('${user}', '${company}', 'u-${user}', 'U', 'U', 'x', now())`);
    await prisma.$executeRawUnsafe(`INSERT INTO fiscal_periods (id, "companyId", code, "nameEn", "nameAr", "startDate", "endDate", status, "updatedAt") VALUES (gen_random_uuid(), '${company}', 'FY', 'FY', 'FY', '2026-01-01', '2026-12-31', 'OPEN', now())`);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('builds the chain, refuses breaches, and the triggers hold on any writer', async () => {
    const l1 = await chart.create(company, user, { nameEn: 'Assets', type: 'ASSET' });
    const l2 = await chart.create(company, user, { nameEn: 'Current', type: 'ASSET', parentId: l1.id });
    const l3 = await chart.create(company, user, { nameEn: 'Cash group', type: 'ASSET', parentId: l2.id });
    const cash = await chart.create(company, user, { nameEn: 'Cash', type: 'ASSET', parentId: l3.id });
    const bank = await chart.create(company, user, { nameEn: 'Bank', type: 'ASSET', parentId: l3.id });
    expect([l1.code, l2.code, l3.code, cash.code, bank.code]).toEqual(['01', '0101', '010101', '01010101', '01010102']);
    expect([l1, l2, l3].map((a) => a.isPostable)).toEqual([false, false, false]);
    await expect(chart.create(company, user, { nameEn: 'x', type: 'ASSET', parentId: l3.id, code: '010199', isPostable: true })).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE accounts SET "isPostable" = true WHERE id = '${l3.id}'`)).rejects.toThrow(/only 8-digit/);
    await expect(prisma.$executeRawUnsafe(`INSERT INTO accounts (id, "companyId", code, "nameEn", "nameAr", type, "isPostable", "updatedAt") VALUES (gen_random_uuid(), '${company}', '1101', 'x', 'x', 'ASSET', true, now())`)).rejects.toThrow(/Eight digit chart rule/);

    // posting: 8-digit account works, total refused, and even a forced flag is refused by the line trigger
    const rev = await chart.create(company, user, { nameEn: 'Rev', type: 'REVENUE' });
    const rev2 = await chart.create(company, user, { nameEn: 'Rev2', type: 'REVENUE', parentId: rev.id });
    const rev3 = await chart.create(company, user, { nameEn: 'Rev3', type: 'REVENUE', parentId: rev2.id });
    const sales = await chart.create(company, user, { nameEn: 'Sales', type: 'REVENUE', parentId: rev3.id });
    const post = (a: string, b: string) => prisma.$transaction((tx: any) => posting.post(tx, {
      companyId: company, branchId: branch, userId: user, entryDate: new Date('2026-11-07'),
      description: 'native', sourceType: 'SALES_INVOICE', sourceId: randomUUID(), sourceNumber: 'N-1',
      lines: [{ accountId: a, debit: '10' }, { accountId: b, credit: '10' }],
    }));
    await expect(post(cash.id, sales.id)).resolves.toBeDefined();
    await expect(post(l3.id, sales.id)).rejects.toThrow(/cannot receive postings/);
    await prisma.$executeRawUnsafe(`ALTER TABLE accounts DISABLE TRIGGER accounts_eight_digit_scheme`);
    await prisma.$executeRawUnsafe(`UPDATE accounts SET "isPostable" = true WHERE id = '${l3.id}'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE accounts ENABLE TRIGGER accounts_eight_digit_scheme`);
    await expect(post(l3.id, sales.id)).rejects.toThrow(/only 8-digit accounts accept entries/);
    await prisma.$executeRawUnsafe(`UPDATE accounts SET "isPostable" = false WHERE id = '${l3.id}'`);
    const lines = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM journal_lines WHERE "accountId" = '${l3.id}'`);
    expect(lines[0].n).toBe(0);

    // role mapping reads the scheme through the real client
    await expect(prisma.$transaction((tx: any) => map.resolve(tx, company, ['accountsReceivable']))).rejects.toThrow(/01010201/);
  });

  it('concurrent creates under one parent never produce a duplicate or a rule breach', async () => {
    const top = await chart.create(company, user, { nameEn: 'Exp', type: 'EXPENSE' });
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => chart.create(company, user, { nameEn: `Sub ${i}`, type: 'EXPENSE', parentId: top.id })),
    );
    const codes = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.code] : []));
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBe(6);
    expect(codes.every((c) => /^05[0-9]{2}$|^[0-9]{4}$/.test(c))).toBe(true);
  });
});
