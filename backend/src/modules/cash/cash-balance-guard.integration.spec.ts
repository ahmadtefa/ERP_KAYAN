import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { BadRequestException } from '@nestjs/common';

import { AccountMapService } from '../accounting/account-map.service';
import { CostCentersService } from '../accounting/cost-centers.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { FiscalPeriodsService } from '../accounting/fiscal-periods.service';
import { JournalEntriesService } from '../accounting/journal-entries.service';
import { PostingService } from '../accounting/posting.service';
import { CashTransfersService } from './cash-transfers.service';
import { CashVouchersService } from './cash-vouchers.service';

/**
 * The cash/bank invariant on a real migrated PostgreSQL: a box or a bank can
 * never go negative. This is not a mock suite - the vouchers, transfers and
 * manual journals are the production services, the schema is built from the
 * project's own migrations (the runner supplies DATABASE_URL), and the
 * concurrency case opens two genuine connections so the row lock under the
 * guard is exercised the way two users pressing "post" together exercise it.
 *
 * Each test funds its own box, so no test depends on another's leftovers.
 */

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const EXP = 'a0000000-0000-4000-8000-0000000000e1';
const AR = 'a0000000-0000-4000-8000-0000000000a1';
const AP = 'a0000000-0000-4000-8000-0000000000a2';

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') ||
    (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

(vmReady ? describe : describe.skip)('cash and bank balances can never go negative (real PG)', () => {
  let prisma: PrismaClient;
  let vouchers: CashVouchersService;
  let transfers: CashTransfersService;
  let journals: JournalEntriesService;
  let posting: PostingService;

  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  const query = (sql: string) => prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql);

  // glN/boxN hand out fresh account ids per test box (n = 1..9).
  const glId = (n: number) => `b0000000-0000-4000-8000-a000000000${10 + n}`;
  const boxId = (n: number) => `b0000000-0000-4000-8000-b000000000${10 + n}`;

  const balance = (n: number) =>
    posting.postedBalanceFor(prisma as never, COMPANY, glId(n));

  const journalCount = async () =>
    Number((await query(`SELECT count(*)::int AS n FROM journal_entries WHERE "companyId"='${COMPANY}'`))[0].n);

  const seedBox = (n: number, kind = 'CASH') =>
    run(`INSERT INTO accounts(id,"companyId",code,"nameEn","nameAr",type,"updatedAt")
           VALUES ('${glId(n)}','${COMPANY}','10${n}','Box ${n}','خزنة ${n}','ASSET',now());
         INSERT INTO cash_accounts(id,"companyId","branchId",code,"nameEn","nameAr",kind,"accountId","updatedAt")
           VALUES ('${boxId(n)}','${COMPANY}','${BRANCH}','CA${n}','Box ${n}','خزنة ${n}','${kind}','${glId(n)}',now())`);

  const receipt = (n: number, amount: string) =>
    vouchers.create(COMPANY, BRANCH, USER, {
      kind: 'RECEIPT',
      cashAccountId: boxId(n),
      voucherDate: '2026-01-10',
      amount,
      counterAccountId: EXP,
    });

  const payment = (n: number, amount: string) =>
    vouchers.create(COMPANY, BRANCH, USER, {
      kind: 'PAYMENT',
      cashAccountId: boxId(n),
      voucherDate: '2026-01-11',
      amount,
      counterAccountId: EXP,
    });

  const voucherState = (id: string) =>
    query(`SELECT "voucherNumber", status FROM cash_vouchers WHERE id='${id}'`);

  function buildServices(client: PrismaClient) {
    const numbers = new DocumentNumberService();
    const audit: never = { record: async () => {}, recordRequired: async () => {} } as never;
    const periods = new FiscalPeriodsService(client as never, audit);
    const costCenters = new CostCentersService(client as never, audit);
    const postingService = new PostingService(numbers, periods, costCenters);
    const settings = {
      get: async () => ({ approvalRequiredForJournal: false, segregationOfDuties: false }),
    };
    return {
      posting: postingService,
      vouchers: new CashVouchersService(client as never, numbers, postingService, new AccountMapService(), audit),
      transfers: new CashTransfersService(client as never, numbers, postingService, audit),
      journals: new JournalEntriesService(
        client as never,
        numbers,
        audit,
        periods,
        settings as never,
        costCenters,
        postingService,
      ),
    };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','A','A','أ',now())`);
    await run(`INSERT INTO users(id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${USER}','${COMPANY}','guardtester','Guard Tester','مختبر','x',now())`);
    await run(`INSERT INTO accounts(id,"companyId",code,"nameEn","nameAr",type,"updatedAt") VALUES
      ('${EXP}','${COMPANY}','5001','Expenses','مصروفات','EXPENSE',now()),
      ('${AR}','${COMPANY}','1103','Receivable','عملاء','ASSET',now()),
      ('${AP}','${COMPANY}','2101','Payable','موردون','LIABILITY',now())`);
    const services = buildServices(prisma);
    vouchers = services.vouchers;
    transfers = services.transfers;
    journals = services.journals;
    posting = services.posting;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('save refusal: a payment above the balance creates no voucher and consumes no number', async () => {
    await seedBox(1);
    const rc = await receipt(1, '100');
    await vouchers.post(COMPANY, USER, rc.id);
    expect((await balance(1)).toFixed(4)).toBe('100.0000');

    const failure = await payment(1, '150').catch((error) => error);
    expect(failure).toBeInstanceOf(BadRequestException);
    expect(failure.response).toMatchObject({
      code: 'CASH_SAVE_BALANCE_SHORT',
      errors: { cashAccountCode: 'CA1', requested: '150.0000', available: '100.0000' },
    });
    expect(failure.response.message).toMatch(/لم يُحفظ سند الصرف/);
    expect(failure.response.message).toMatch(/was not saved/);

    // Only the receipt exists, and the next payment takes the FIRST number:
    // the refusal did not burn a document number.
    expect((await query(`SELECT count(*)::int AS n FROM cash_vouchers WHERE "cashAccountId"='${boxId(1)}'`))[0].n).toBe(1);
    const ok = await payment(1, '100');
    expect(ok.voucherNumber).toBe('PV-000001');
    await vouchers.post(COMPANY, USER, ok.id);
    // Exactly covered: zero is not negative.
    expect((await balance(1)).toFixed(4)).toBe('0.0000');
  });

  it('post refusal: money that left between save and post keeps the voucher a draft and the ledger untouched', async () => {
    await seedBox(2);
    const rc = await receipt(2, '100');
    await vouchers.post(COMPANY, USER, rc.id);
    const p1 = await payment(2, '80');
    const p2 = await payment(2, '50');
    await vouchers.post(COMPANY, USER, p1.id);
    expect((await balance(2)).toFixed(4)).toBe('20.0000');

    const before = await journalCount();
    const failure = await vouchers.post(COMPANY, USER, p2.id).catch((error) => error);
    expect(failure).toBeInstanceOf(BadRequestException);
    expect(failure.response).toMatchObject({
      code: 'CASH_BALANCE_NEGATIVE',
      errors: { cashAccountCode: 'CA2', requested: '50.0000', available: '20.0000' },
    });
    expect(failure.response.message).toMatch(/بالسالب/);
    expect(failure.response.message).toMatch(/can never go negative/);

    // No partial effects: no journal, and the claim on the voucher rolled back.
    expect(await journalCount()).toBe(before);
    expect((await voucherState(p2.id))[0].status).toBe('DRAFT');

    // The draft can still be posted once the box is funded again.
    const topUp = await receipt(2, '40');
    await vouchers.post(COMPANY, USER, topUp.id);
    await vouchers.post(COMPANY, USER, p2.id);
    expect((await balance(2)).toFixed(4)).toBe('10.0000');
  });

  it('transfers: the source box is checked at save and at post', async () => {
    await seedBox(3, 'BANK');
    await seedBox(4);

    const refused = await transfers
      .create(COMPANY, BRANCH, USER, {
        fromCashAccountId: boxId(3),
        toCashAccountId: boxId(4),
        transferDate: '2026-01-12',
        amount: '30',
      })
      .catch((error) => error);
    expect(refused).toBeInstanceOf(BadRequestException);
    expect(refused.response).toMatchObject({ code: 'CASH_SAVE_BALANCE_SHORT' });

    const rc = await receipt(3, '50');
    await vouchers.post(COMPANY, USER, rc.id);
    const transfer = await transfers.create(COMPANY, BRANCH, USER, {
      fromCashAccountId: boxId(3),
      toCashAccountId: boxId(4),
      transferDate: '2026-01-12',
      amount: '50',
    });
    await transfers.post(COMPANY, USER, transfer.id);
    expect((await balance(3)).toFixed(4)).toBe('0.0000');
    expect((await balance(4)).toFixed(4)).toBe('50.0000');

    // A draft transfer can also be overtaken before it is posted.
    const transfer2 = await transfers.create(COMPANY, BRANCH, USER, {
      fromCashAccountId: boxId(4),
      toCashAccountId: boxId(3),
      transferDate: '2026-01-13',
      amount: '50',
    });
    const spend = await payment(4, '20');
    await vouchers.post(COMPANY, USER, spend.id);
    const failure = await transfers.post(COMPANY, USER, transfer2.id).catch((error) => error);
    expect(failure).toBeInstanceOf(BadRequestException);
    expect(failure.response).toMatchObject({
      code: 'CASH_BALANCE_NEGATIVE',
      errors: { requested: '50.0000', available: '30.0000' },
    });
    expect((await query(`SELECT status FROM cash_transfers WHERE id='${transfer2.id}'`))[0].status).toBe('DRAFT');
  });

  it('reversing a receipt whose money was spent is refused until the box can stand it', async () => {
    await seedBox(5);
    const rc = await receipt(5, '100');
    await vouchers.post(COMPANY, USER, rc.id);
    const spend = await payment(5, '60');
    await vouchers.post(COMPANY, USER, spend.id);
    expect((await balance(5)).toFixed(4)).toBe('40.0000');

    const failure = await vouchers.reverse(COMPANY, USER, rc.id).catch((error) => error);
    expect(failure).toBeInstanceOf(BadRequestException);
    expect(failure.response).toMatchObject({ code: 'CASH_BALANCE_NEGATIVE' });
    // The original entry is untouched: nothing claimed, nothing mirrored.
    expect(
      (await query(`SELECT e.status FROM journal_entries e JOIN cash_vouchers v ON v."journalEntryId" = e.id WHERE v.id='${rc.id}'`))[0].status,
    ).toBe('POSTED');

    // Reversing the payment returns money to the box; now the receipt reversal stands.
    await vouchers.reverse(COMPANY, USER, spend.id);
    expect((await balance(5)).toFixed(4)).toBe('100.0000');
    await vouchers.reverse(COMPANY, USER, rc.id);
    expect((await balance(5)).toFixed(4)).toBe('0.0000');
  });

  it('a manual journal that would overdraw a box is refused and stays unposted', async () => {
    await seedBox(6);
    const rc = await receipt(6, '30');
    await vouchers.post(COMPANY, USER, rc.id);

    const entry = await journals.create(COMPANY, BRANCH, USER, {
      entryDate: '2026-01-14',
      description: 'manual overdraft attempt',
      lines: [
        { accountId: EXP, debit: '50' },
        { accountId: glId(6), credit: '50' },
      ],
    } as never);
    const failure = await journals.post(COMPANY, USER, entry.id).catch((error) => error);
    expect(failure).toBeInstanceOf(BadRequestException);
    expect(failure.response).toMatchObject({
      code: 'CASH_BALANCE_NEGATIVE',
      errors: { requested: '50.0000', available: '30.0000' },
    });
    expect(
      (await query(`SELECT status FROM journal_entries WHERE id='${entry.id}'`))[0].status,
    ).toBe('DRAFT');

    // Within the balance it posts, and the balance lands exactly on zero.
    const ok = await journals.create(COMPANY, BRANCH, USER, {
      entryDate: '2026-01-14',
      description: 'within balance',
      lines: [
        { accountId: EXP, debit: '30' },
        { accountId: glId(6), credit: '30' },
      ],
    } as never);
    await journals.post(COMPANY, USER, ok.id);
    expect((await balance(6)).toFixed(4)).toBe('0.0000');
  });

  it('reversing a manual entry that funded a spent box is refused', async () => {
    await seedBox(7);
    const entry = await journals.create(COMPANY, BRANCH, USER, {
      entryDate: '2026-01-14',
      description: 'money in',
      lines: [
        { accountId: glId(7), debit: '100' },
        { accountId: EXP, credit: '100' },
      ],
    } as never);
    await journals.post(COMPANY, USER, entry.id);
    const spend = await payment(7, '60');
    await vouchers.post(COMPANY, USER, spend.id);

    const failure = await journals.reverse(COMPANY, USER, entry.id).catch((error) => error);
    expect(failure).toBeInstanceOf(BadRequestException);
    expect(failure.response).toMatchObject({ code: 'CASH_BALANCE_NEGATIVE' });
    expect(
      (await query(`SELECT status FROM journal_entries WHERE id='${entry.id}'`))[0].status,
    ).toBe('POSTED');
  });

  it('two payments posted at the same moment: exactly one succeeds and the balance never dips below zero', async () => {
    await seedBox(8);
    const rc = await receipt(8, '100');
    await vouchers.post(COMPANY, USER, rc.id);
    const d1 = await payment(8, '60');
    const d2 = await payment(8, '60');

    // Two independent connections, like two users pressing post together.
    const other = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    const services = buildServices(other);
    try {
      const [first, second] = await Promise.allSettled([
        vouchers.post(COMPANY, USER, d1.id),
        services.vouchers.post(COMPANY, USER, d2.id),
      ]);
      const outcomes = [first, second];
      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(BadRequestException);
      expect(rejected[0].reason.response).toMatchObject({
        code: 'CASH_BALANCE_NEGATIVE',
        errors: { requested: '60.0000', available: '40.0000' },
      });

      expect((await balance(8)).toFixed(4)).toBe('40.0000');
      // The loser never reached the ledger and can still be posted later.
      const loserId = first.status === 'rejected' ? d1.id : d2.id;
      expect((await voucherState(loserId))[0].status).toBe('DRAFT');
      expect(
        (await query(`SELECT count(*)::int AS n FROM journal_entries WHERE "sourceId"='${loserId}'`))[0].n,
      ).toBe(0);
    } finally {
      await other.$disconnect();
    }
  });
});
