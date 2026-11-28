import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { CashVouchersService } from '../cash/cash-vouchers.service';
import { AccountMapService } from './account-map.service';
import { CostCentersService } from './cost-centers.service';
import { DocumentNumberService } from './document-number.service';
import { FiscalPeriodsService } from './fiscal-periods.service';
import { PostingService, type PostingRequest } from './posting.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const A = (n: number) => `a0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const AR = A(1);
const AP = A(2);
const CASH = A(3);
const BANK_USD_GL = A(4);
const SALES = A(5);
const EXPENSE = A(6);
const VAT_OUT = A(7);
const GROUP = A(8);
const BANK_USD = 'b0000000-0000-4000-8000-b00000000012';

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

/// More whole-ledger invariants on a real migrated PostgreSQL: period locks, number
/// sequences, reversals line by line, currency conversion. Synthetic data only.
(vmReady ? describe : describe.skip)('accounting invariants, second set (real schema)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let posting: PostingService;
  let vouchers: CashVouchersService;
  let periods: FiscalPeriodsService;
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (sql: string) => prisma.$queryRawUnsafe(sql) as Promise<Array<Record<string, any>>>;
  let seq = 0;
  const post = (lines: PostingRequest['lines'], extra: Partial<PostingRequest> = {}) =>
    prisma.$transaction((tx: never) =>
      posting.post(tx, {
        companyId: COMPANY,
        branchId: BRANCH,
        userId: USER,
        entryDate: new Date('2026-02-10T00:00:00Z'),
        description: 'Invariant scenario',
        lines,
        sourceType: 'MANUAL',
        sourceId: `d0000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
        sourceNumber: `INV-${seq}`,
        ...extra,
      }),
    ) as Promise<{ id: string; entryNumber: string }>;
  const balanceOf = async (accountId: string) =>
    (await query(`SELECT COALESCE(SUM(l.debit - l.credit),0)::text AS b FROM journal_lines l JOIN journal_entries e ON e.id=l."journalEntryId"
                   WHERE l."accountId"='${accountId}' AND e."companyId"='${COMPANY}' AND e.status IN ('POSTED','REVERSED')`))[0].b;

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','A','A','أ',now())`);
    await run(`INSERT INTO users(id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${USER}','${COMPANY}','inv','Inv','ش','x',now())`);
    await run(`INSERT INTO accounts(id,"companyId",code,"nameEn","nameAr",type,"updatedAt") VALUES
      ('${AR}','${COMPANY}','1103','Receivable','عملاء','ASSET',now()),
      ('${AP}','${COMPANY}','2101','Payable','موردون','LIABILITY',now()),
      ('${CASH}','${COMPANY}','1011','Cash','خزينة','ASSET',now()),
      ('${BANK_USD_GL}','${COMPANY}','1012','Dollar bank','بنك دولار','ASSET',now()),
      ('${SALES}','${COMPANY}','4101','Sales','مبيعات','REVENUE',now()),
      ('${EXPENSE}','${COMPANY}','5900','Expense','مصروف','EXPENSE',now()),
      ('${VAT_OUT}','${COMPANY}','2201','VAT output','ضريبة مخرجات','LIABILITY',now())`);
    await run(`INSERT INTO accounts(id,"companyId",code,"nameEn","nameAr",type,"isPostable","updatedAt") VALUES
      ('${GROUP}','${COMPANY}','1','Assets','الأصول','ASSET',false,now())`);
    await run(`INSERT INTO cash_accounts(id,"companyId","branchId",code,"nameEn","nameAr",kind,"accountId",currency,"updatedAt") VALUES
      ('${BANK_USD}','${COMPANY}','${BRANCH}','BKU','Dollar bank','بنك دولار','BANK','${BANK_USD_GL}','USD',now())`);
    await run(`INSERT INTO currencies(id,"companyId",code,"nameAr","nameEn") VALUES (gen_random_uuid(),'${COMPANY}','USD','دولار','Dollar')`);
    await run(`INSERT INTO exchange_rates(id,"companyId","currencyCode","rateDate",rate) VALUES (gen_random_uuid(),'${COMPANY}','USD','2026-02-01',48.5)`);
    const numbers = new DocumentNumberService();
    const audit: never = { record: async () => {}, recordRequired: async () => {} } as never;
    periods = new FiscalPeriodsService(prisma as never, audit);
    posting = new PostingService(numbers, periods, new CostCentersService(prisma as never, audit));
    vouchers = new CashVouchersService(prisma as never, numbers, posting, new AccountMapService(), audit);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('15 entry numbers are unique inside the company', async () => {
    for (let i = 0; i < 5; i++) await post([{ accountId: AR, debit: '1' }, { accountId: SALES, credit: '1' }]);
    const dup = await query(`SELECT "entryNumber" FROM journal_entries WHERE "companyId"='${COMPANY}' GROUP BY "entryNumber" HAVING count(*) > 1`);
    expect(dup).toEqual([]);
  });

  it('16 a closed period refuses a new entry dated inside it and nothing is saved', async () => {
    const p = await periods.create(COMPANY, USER, { code: 'P2025-03', nameEn: 'March 2025', nameAr: 'مارس 2025', startDate: '2025-03-01', endDate: '2025-03-31' } as never);
    await periods.close(COMPANY, USER, p.id);
    const before = (await query(`SELECT count(*)::int n FROM journal_entries`))[0].n;
    await expect(post([{ accountId: AR, debit: '10' }, { accountId: SALES, credit: '10' }], { entryDate: new Date('2025-03-10T00:00:00Z') })).rejects.toBeDefined();
    expect((await query(`SELECT count(*)::int n FROM journal_entries`))[0].n).toBe(before);
  });

  it('17 a period with an overlapping range cannot be created', async () => {
    await expect(periods.create(COMPANY, USER, { code: 'P2025-03B', nameEn: 'Overlap', nameAr: 'تداخل', startDate: '2025-03-15', endDate: '2025-04-15' } as never)).rejects.toMatchObject({ response: expect.anything() });
  });

  it('18 a reversal has the same lines with debit and credit swapped', async () => {
    const e = await post([{ accountId: AR, debit: '230.25' }, { accountId: SALES, credit: '200.00' }, { accountId: VAT_OUT, credit: '30.25' }]);
    const r = await prisma.$transaction((tx: never) => posting.reverse(tx, COMPANY, USER, e.id, 'mirror'));
    const net = await query(`SELECT "accountId", SUM(debit-credit)::text n FROM journal_lines WHERE "journalEntryId" IN ('${e.id}','${r.id}') GROUP BY "accountId"`);
    expect(net).toHaveLength(3);
    for (const row of net) expect(Number(row.n)).toBe(0);
  });

  it('19 a posted entry keeps its date, number and source after it is reversed', async () => {
    const e = await post([{ accountId: EXPENSE, debit: '12' }, { accountId: AP, credit: '12' }]);
    const before = (await query(`SELECT "entryNumber", "entryDate"::text d, "sourceId" FROM journal_entries WHERE id='${e.id}'`))[0];
    await prisma.$transaction((tx: never) => posting.reverse(tx, COMPANY, USER, e.id, 'keep'));
    const after = (await query(`SELECT "entryNumber", "entryDate"::text d, "sourceId" FROM journal_entries WHERE id='${e.id}'`))[0];
    expect(after).toEqual(before);
  });

  it('20 a foreign-currency voucher is converted at the dated rate and both sides agree', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v: any = await vouchers.create(COMPANY, BRANCH, USER, { kind: 'RECEIPT', cashAccountId: BANK_USD, voucherDate: '2026-02-10', amount: '33.33', counterAccountId: SALES } as never);
    await vouchers.post(COMPANY, USER, v.id);
    const lines = await query(`SELECT l.debit::text d, l.credit::text c FROM journal_lines l JOIN journal_entries e ON e.id=l."journalEntryId" WHERE e."sourceId"='${v.id}' ORDER BY l.debit DESC`);
    expect(lines).toHaveLength(2);
    expect(lines[0].d).toBe(lines[1].c);
    expect(Math.abs(Number(lines[0].d) - 1616.505)).toBeLessThan(0.01);
  });

  it('21 account balances over every account add up to zero', async () => {
    const [t] = await query(`SELECT COALESCE(SUM(l.debit - l.credit),0)::text s FROM journal_lines l JOIN journal_entries e ON e.id=l."journalEntryId" WHERE e."companyId"='${COMPANY}' AND e.status IN ('POSTED','REVERSED')`);
    expect(Number(t.s)).toBe(0);
  });

  it('22 no journal line points at an account of another company', async () => {
    const bad = await query(`SELECT l.id FROM journal_lines l JOIN journal_entries e ON e.id=l."journalEntryId" JOIN accounts a ON a.id=l."accountId" WHERE a."companyId" <> e."companyId"`);
    expect(bad).toEqual([]);
  });
});
