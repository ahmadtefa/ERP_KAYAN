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

/// Whole-ledger invariants against a real migrated PostgreSQL: whatever the
/// documents did, the books must agree with themselves. Synthetic data only.
(vmReady ? describe : describe.skip)('accounting invariants (real schema)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let posting: PostingService;
  let vouchers: CashVouchersService;
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
    posting = new PostingService(numbers, new FiscalPeriodsService(prisma as never, audit), new CostCentersService(prisma as never, audit));
    vouchers = new CashVouchersService(prisma as never, numbers, posting, new AccountMapService(), audit);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('01 a sale with VAT posts receivable = revenue + VAT, to the cent', async () => {
    const e = await post([
      { accountId: AR, debit: '1140.00' },
      { accountId: SALES, credit: '1000.00' },
      { accountId: VAT_OUT, credit: '140.00' },
    ]);
    const rows = await query(`SELECT "accountId", debit::text d, credit::text c FROM journal_lines WHERE "journalEntryId"='${e.id}'`);
    expect(rows).toHaveLength(3);
    expect(await balanceOf(AR)).toBe('1140.0000');
    expect(await balanceOf(SALES)).toBe('-1000.0000');
    expect(await balanceOf(VAT_OUT)).toBe('-140.0000');
  });

  it('02 an unbalanced entry is refused and leaves nothing behind', async () => {
    const before = (await query(`SELECT count(*)::int n FROM journal_entries`))[0].n;
    await expect(post([{ accountId: AR, debit: '100' }, { accountId: SALES, credit: '99.99' }])).rejects.toMatchObject({ response: { code: 'POSTING_UNBALANCED' } });
    expect((await query(`SELECT count(*)::int n FROM journal_entries`))[0].n).toBe(before);
  });

  it('03 an entry with only one side is refused', async () => {
    await expect(post([{ accountId: AR, debit: '100' }])).rejects.toMatchObject({ response: { code: 'POSTING_NEEDS_BOTH_SIDES' } });
  });

  it('04 negative and malformed amounts are refused', async () => {
    await expect(post([{ accountId: AR, debit: '-5' }, { accountId: SALES, credit: '-5' }])).rejects.toMatchObject({ response: { code: 'POSTING_AMOUNT_INVALID' } });
    await expect(post([{ accountId: AR, debit: 'abc' }, { accountId: SALES, credit: '1' }])).rejects.toMatchObject({ response: { code: 'POSTING_AMOUNT_INVALID' } });
  });

  it('05 a grouping (non-postable) account never receives a posting', async () => {
    await expect(post([{ accountId: GROUP, debit: '10' }, { accountId: SALES, credit: '10' }])).rejects.toMatchObject({ response: { code: 'JOURNAL_ACCOUNT_GROUPING' } });
  });

  it('06 an unknown account is refused', async () => {
    await expect(post([{ accountId: 'f0000000-0000-4000-8000-000000000001', debit: '10' }, { accountId: SALES, credit: '10' }])).rejects.toMatchObject({ response: { code: 'ACCOUNT_MISSING' } });
  });

  it('07 the same document cannot be posted twice', async () => {
    const id = 'e0000000-0000-4000-8000-000000000001';
    const lines = [{ accountId: AR, debit: '10' }, { accountId: SALES, credit: '10' }];
    await post(lines, { sourceId: id, sourceNumber: 'DUP-1' });
    await expect(post(lines, { sourceId: id, sourceNumber: 'DUP-1' })).rejects.toMatchObject({ response: { code: 'POSTING_ALREADY_POSTED' } });
  });

  it('08 a reversal mirrors the original: net zero per account, original marked reversed', async () => {
    const e = await post([{ accountId: EXPENSE, debit: '75.50' }, { accountId: AP, credit: '75.50' }]);
    const exp = await balanceOf(EXPENSE);
    const ap = await balanceOf(AP);
    const r = await prisma.$transaction((tx: never) => posting.reverse(tx, COMPANY, USER, e.id, 'Reverse invariant'));
    expect(r.id).not.toBe(e.id);
    expect(Number(await balanceOf(EXPENSE))).toBeCloseTo(Number(exp) - 75.5, 4);
    expect(Number(await balanceOf(AP))).toBeCloseTo(Number(ap) + 75.5, 4);
    expect((await query(`SELECT status::text s FROM journal_entries WHERE id='${e.id}'`))[0].s).toBe('REVERSED');
  });

  it('09 an entry cannot be reversed twice', async () => {
    const e = await post([{ accountId: EXPENSE, debit: '5' }, { accountId: AP, credit: '5' }]);
    await prisma.$transaction((tx: never) => posting.reverse(tx, COMPANY, USER, e.id, 'once'));
    await expect(prisma.$transaction((tx: never) => posting.reverse(tx, COMPANY, USER, e.id, 'twice'))).rejects.toMatchObject({ response: { code: 'ALREADY_REVERSED' } });
  });

  it('10 a foreign-currency voucher books company-currency amounts that balance', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v: any = await vouchers.create(COMPANY, BRANCH, USER, { kind: 'RECEIPT', cashAccountId: BANK_USD, voucherDate: '2026-02-10', amount: '100', counterAccountId: SALES } as never);
    await vouchers.post(COMPANY, USER, v.id);
    expect(await balanceOf(BANK_USD_GL)).toBe('4850.0000');
  });

  it('11 every posted or reversed journal entry balances to the piastre', async () => {
    const bad = await query(`SELECT e.id FROM journal_entries e JOIN journal_lines l ON l."journalEntryId"=e.id
                              WHERE e.status IN ('POSTED','REVERSED') GROUP BY e.id HAVING SUM(l.debit) <> SUM(l.credit)`);
    expect(bad).toEqual([]);
    const empty = await query(`SELECT e.id FROM journal_entries e LEFT JOIN journal_lines l ON l."journalEntryId"=e.id
                                WHERE e.status IN ('POSTED','REVERSED') GROUP BY e.id HAVING count(l.id)=0`);
    expect(empty).toEqual([]);
  });

  it('12 the trial balance foots: total debits equal total credits across all accounts', async () => {
    const [t] = await query(`SELECT COALESCE(SUM(l.debit),0)::text d, COALESCE(SUM(l.credit),0)::text c
                               FROM journal_lines l JOIN journal_entries e ON e.id=l."journalEntryId"
                              WHERE e."companyId"='${COMPANY}' AND e.status IN ('POSTED','REVERSED')`);
    expect(t.d).toBe(t.c);
    expect(Number(t.d)).toBeGreaterThan(0);
  });

  it('13 no line carries both a debit and a credit, or a negative amount', async () => {
    const bad = await query(`SELECT id FROM journal_lines WHERE (debit>0 AND credit>0) OR debit<0 OR credit<0 OR (debit=0 AND credit=0)`);
    expect(bad).toEqual([]);
  });

  it('14 no posted line sits on a grouping account', async () => {
    const bad = await query(`SELECT l.id FROM journal_lines l JOIN accounts a ON a.id=l."accountId" JOIN journal_entries e ON e.id=l."journalEntryId"
                              WHERE a."isPostable"=false AND e.status IN ('POSTED','REVERSED')`);
    expect(bad).toEqual([]);
  });
});
