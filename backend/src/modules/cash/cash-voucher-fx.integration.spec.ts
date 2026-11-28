import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { AccountMapService } from '../accounting/account-map.service';
import { CostCentersService } from '../accounting/cost-centers.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { FiscalPeriodsService } from '../accounting/fiscal-periods.service';
import { PostingService } from '../accounting/posting.service';
import { CashVouchersService } from './cash-vouchers.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const GL_EGP = 'b0000000-0000-4000-8000-a00000000011';
const GL_USD = 'b0000000-0000-4000-8000-a00000000012';
const EXPENSE = 'b0000000-0000-4000-8000-c00000000003';
const INCOME = 'b0000000-0000-4000-8000-c00000000004';
const BANK_USD = 'b0000000-0000-4000-8000-b00000000012';
const CUST = 'c0000000-0000-4000-8000-000000000001';

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

/// Vouchers on a foreign-currency bank account, booked at a rate, against a real migrated PostgreSQL.
(vmReady ? describe : describe.skip)('foreign-currency cash vouchers (real schema)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let vouchers: CashVouchersService;
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (sql: string) => prisma.$queryRawUnsafe(sql) as Promise<Array<Record<string, any>>>;
  const mk = (kind: string, amount: string, extra: Record<string, unknown> = {}) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vouchers.create(COMPANY, BRANCH, USER, { kind, cashAccountId: BANK_USD, voucherDate: '2026-02-10', amount, counterAccountId: INCOME, ...extra } as never) as Promise<any>;
  const lines = (voucherId: string) =>
    query(`SELECT l."accountId", l.debit::text AS debit, l.credit::text AS credit
             FROM journal_lines l JOIN journal_entries e ON e.id = l."journalEntryId"
            WHERE e."sourceId" = '${voucherId}' AND e."sourceType" = 'CASH_VOUCHER' ORDER BY e."createdAt", l."lineNumber"`);

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','A','A','أ',now())`);
    await run(`INSERT INTO users(id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${USER}','${COMPANY}','fx','Fx','ش','x',now())`);
    await run(`INSERT INTO accounts(id,"companyId",code,"nameEn","nameAr",type,"updatedAt") VALUES
      ('${GL_EGP}','${COMPANY}','1011','Bank','بنك','ASSET',now()),
      ('${GL_USD}','${COMPANY}','1012','Dollar bank','بنك دولار','ASSET',now()),
      ('${EXPENSE}','${COMPANY}','5900','Expense','مصروف','EXPENSE',now()),
      ('${INCOME}','${COMPANY}','4900','Other income','إيراد آخر','REVENUE',now())`);
    await run(`INSERT INTO cash_accounts(id,"companyId","branchId",code,"nameEn","nameAr",kind,"accountId",currency,"updatedAt") VALUES
      ('${BANK_USD}','${COMPANY}','${BRANCH}','BKU','Dollar bank','بنك دولار','BANK','${GL_USD}','USD',now())`);
    await run(`INSERT INTO customers(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${CUST}','${COMPANY}','C','C','ع',now())`);
    await run(`INSERT INTO currencies(id,"companyId",code,"nameAr","nameEn") VALUES (gen_random_uuid(),'${COMPANY}','USD','دولار','Dollar')`);
    await run(`INSERT INTO exchange_rates(id,"companyId","currencyCode","rateDate",rate) VALUES
      (gen_random_uuid(),'${COMPANY}','USD','2026-02-01',48.5), (gen_random_uuid(),'${COMPANY}','USD','2026-03-01',50)`);
    const numbers = new DocumentNumberService();
    const audit: never = { record: async () => {}, recordRequired: async () => {} } as never;
    const posting = new PostingService(numbers, new FiscalPeriodsService(prisma as never, audit), new CostCentersService(prisma as never, audit));
    vouchers = new CashVouchersService(prisma as never, numbers, posting, new AccountMapService(), audit);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('a receipt takes the newest rate on or before its date and posts company-currency amounts', async () => {
    const v = await mk('RECEIPT', '100');
    await vouchers.post(COMPANY, USER, v.id);
    const rows = await lines(v.id);
    expect(rows.find((r) => r.accountId === GL_USD)?.debit).toBe('4850.0000');
    expect(rows.find((r) => r.accountId === INCOME)?.credit).toBe('4850.0000');
    const [row] = await query(`SELECT rate::text AS rate, "rateSource" FROM voucher_exchange_rates WHERE "voucherId" = '${v.id}'`);
    expect(row).toMatchObject({ rate: '48.50000000', rateSource: 'TABLE' });
  });

  it('a typed rate wins, and a later table rate never moves a booked voucher', async () => {
    const v = await mk('RECEIPT', '10', { exchangeRate: '49.25' });
    await vouchers.post(COMPANY, USER, v.id);
    expect((await lines(v.id)).find((r) => r.accountId === GL_USD)?.debit).toBe('492.5000');
    await run(`INSERT INTO exchange_rates(id,"companyId","currencyCode","rateDate",rate) VALUES (gen_random_uuid(),'${COMPANY}','USD','2026-02-05',99)`);
    expect((await lines(v.id)).find((r) => r.accountId === GL_USD)?.debit).toBe('492.5000');
  });

  it('a payment is checked against the balance in company currency', async () => {
    await expect(mk('PAYMENT', '10000', { counterAccountId: EXPENSE, exchangeRate: '50' })).rejects.toMatchObject({ response: { code: 'CASH_SAVE_BALANCE_SHORT' } });
    const ok = await mk('PAYMENT', '5', { counterAccountId: EXPENSE, exchangeRate: '50' });
    await vouchers.post(COMPANY, USER, ok.id);
    expect((await lines(ok.id)).find((r) => r.accountId === EXPENSE)?.debit).toBe('250.0000');
  });

  it('refuses a customer, an invoice settlement, a missing counter account and a date with no rate', async () => {
    await expect(mk('RECEIPT', '1', { customerId: CUST, counterAccountId: undefined })).rejects.toMatchObject({ response: { code: 'VOUCHER_FX_NO_PARTY' } });
    await expect(mk('RECEIPT', '1', { counterAccountId: undefined })).rejects.toMatchObject({ response: { code: 'VOUCHER_NEEDS_COUNTERPART' } });
    await expect(mk('RECEIPT', '1', { voucherDate: '2026-01-15' })).rejects.toMatchObject({ response: { code: 'FX_RATE_MISSING' } });
    await expect(mk('RECEIPT', '1', { exchangeRate: '0' })).rejects.toMatchObject({ response: { code: 'CURRENCY_RATE_BAD' } });
  });
});
