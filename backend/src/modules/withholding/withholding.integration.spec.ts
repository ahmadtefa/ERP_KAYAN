import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { AccountMapService } from '../accounting/account-map.service';
import { CostCentersService } from '../accounting/cost-centers.service';
import { DocumentNumberService } from '../accounting/document-number.service';
import { FiscalPeriodsService } from '../accounting/fiscal-periods.service';
import { PostingService } from '../accounting/posting.service';
import { CashVouchersService } from '../cash/cash-vouchers.service';
import { WithholdingService } from './withholding.service';

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const AR = 'a0000000-0000-4000-8000-0000000000a1';
const AP = 'a0000000-0000-4000-8000-0000000000a2';
const GL = 'b0000000-0000-4000-8000-a00000000011';
const BANK = 'b0000000-0000-4000-8000-b00000000011';
const BANK_OFF = 'b0000000-0000-4000-8000-b00000000012';
const CUST = 'c0000000-0000-4000-8000-000000000001';
const SUPP = 'e0000000-0000-4000-8000-000000000001';
const INV = 'd0000000-0000-4000-8000-000000000001';

jest.setTimeout(120_000);
const vmReady =
  !!process.env.DATABASE_URL &&
  (process.execArgv.includes('--experimental-vm-modules') || (process.env.NODE_OPTIONS ?? '').includes('--experimental-vm-modules'));

/// Withholding tax against a real migrated PostgreSQL, with the production cash voucher engine.
(vmReady ? describe : describe.skip)('withholding tax (real schema)', () => {
  let prisma: any;
  let svc: WithholdingService;
  let vouchers: CashVouchersService;
  const run = (sql: string) => prisma.$executeRawUnsafe(sql);
  const query = (sql: string) => prisma.$queryRawUnsafe(sql) as Promise<Array<Record<string, any>>>;
  const WHT_PAY = 'b0000000-0000-4000-8000-c00000000001';
  const WHT_REC = 'b0000000-0000-4000-8000-c00000000002';
  const EXPENSE = 'b0000000-0000-4000-8000-c00000000003';
  const mk = (kind: string, party: Record<string, string>, amount: string, extra: Record<string, unknown> = {}) =>
    vouchers.create(COMPANY, BRANCH, USER, { kind, cashAccountId: BANK, voucherDate: '2026-02-01', amount, ...party, ...extra } as never) as Promise<any>;
  const lines = (voucherId: string) =>
    query(`SELECT l."accountId", l.debit::text AS debit, l.credit::text AS credit
             FROM journal_lines l JOIN journal_entries e ON e.id = l."journalEntryId"
            WHERE e."sourceId" = '${voucherId}' AND e."sourceType" = 'CASH_VOUCHER' ORDER BY e."createdAt", l."lineNumber"`);
  const money = (rows: Array<Record<string, any>>, account: string, side: 'debit' | 'credit') =>
    rows.filter((r) => r.accountId === account).reduce((a, r) => a + Number(r[side]), 0);
  let payRate: any;
  let recRate: any;

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    await run('TRUNCATE companies CASCADE');
    await run(`INSERT INTO companies(id,code,"nameEn","nameAr","updatedAt") VALUES ('${COMPANY}','CO','Company','شركة',now())`);
    await run(`INSERT INTO branches(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${BRANCH}','${COMPANY}','A','A','أ',now())`);
    await run(`INSERT INTO users(id,"companyId",username,"fullNameEn","fullNameAr","passwordHash","updatedAt") VALUES ('${USER}','${COMPANY}','chq','Chq','ش','x',now())`);
    await run(`INSERT INTO accounts(id,"companyId",code,"nameEn","nameAr",type,"updatedAt") VALUES
      ('${AR}','${COMPANY}','1103','Receivable','عملاء','ASSET',now()),
      ('${AP}','${COMPANY}','2101','Payable','موردون','LIABILITY',now()),
      ('${GL}','${COMPANY}','1011','Bank','بنك','ASSET',now()),
      ('${WHT_PAY}','${COMPANY}','2150','Withholding payable','ضريبة خصم مستحقة','LIABILITY',now()),
      ('${WHT_REC}','${COMPANY}','1150','Withholding receivable','ضريبة خصم مدينة','ASSET',now()),
      ('${EXPENSE}','${COMPANY}','5900','Expense','مصروف','EXPENSE',now())`);
    await run(`INSERT INTO cash_accounts(id,"companyId","branchId",code,"nameEn","nameAr",kind,"accountId","updatedAt") VALUES
      ('${BANK}','${COMPANY}','${BRANCH}','BK1','Bank','بنك','BANK','${GL}',now())`);
    await run(`INSERT INTO cash_accounts(id,"companyId","branchId",code,"nameEn","nameAr",kind,"accountId","isActive","updatedAt") VALUES
      ('${BANK_OFF}','${COMPANY}','${BRANCH}','BK2','Closed','مغلق','BANK','${GL}',false,now())`);
    await run(`INSERT INTO customers(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${CUST}','${COMPANY}','C','C','ع',now())`);
    await run(`INSERT INTO suppliers(id,"companyId",code,"nameEn","nameAr","updatedAt") VALUES ('${SUPP}','${COMPANY}','S','S','م',now())`);
    await run(`INSERT INTO sales_invoices(id,"companyId","branchId","invoiceNumber","invoiceDate","customerId","updatedAt",status,"documentType","subTotal","taxAmount","totalAmount","paidAmount")
               VALUES ('${INV}','${COMPANY}','${BRANCH}','SI-1','2026-01-15','${CUST}',now(),'POSTED','INVOICE',1000,0,1000,0)`);
    const numbers = new DocumentNumberService();
    const audit: never = { record: async () => {}, recordRequired: async () => {} } as never;
    const periods = new FiscalPeriodsService(prisma as never, audit);
    const posting = new PostingService(numbers, periods, new CostCentersService(prisma as never, audit));
    vouchers = new CashVouchersService(prisma as never, numbers, posting, new AccountMapService(), audit);
    svc = new WithholdingService(prisma as never, audit);
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('rates are validated: direction, percent, and an account of the right kind', async () => {
    const base = { code: 'X', nameAr: 'ن', nameEn: 'N', direction: 'PAYABLE', ratePercent: '1', accountId: WHT_PAY };
    await expect(svc.createRate(COMPANY, USER, { ...base, ratePercent: '0' })).rejects.toMatchObject({ response: { field: 'ratePercent' } });
    await expect(svc.createRate(COMPANY, USER, { ...base, direction: 'x' })).rejects.toMatchObject({ response: { field: 'direction' } });
    await expect(svc.createRate(COMPANY, USER, { ...base, accountId: WHT_REC })).rejects.toMatchObject({ response: { field: 'accountId' } });
    await expect(svc.createRate(COMPANY, USER, { ...base, direction: 'RECEIVABLE' })).rejects.toMatchObject({ response: { field: 'accountId' } });
    await expect(svc.createRate(COMPANY, USER, { ...base, accountId: undefined })).rejects.toMatchObject({ response: { field: 'accountId' } });
    payRate = await svc.createRate(COMPANY, USER, { ...base, code: 'WHT1', ratePercent: '1' });
    recRate = await svc.createRate(COMPANY, USER, { ...base, code: 'WHT5', direction: 'RECEIVABLE', ratePercent: '5', accountId: WHT_REC });
    expect(payRate.ratePercent).toBe('1.0000');
    await expect(svc.createRate(COMPANY, USER, { ...base, code: 'wht1' })).rejects.toMatchObject({ response: { code: 'WITHHOLDING_RATE_DUPLICATE' } });
  });

  it('a supplier payment pays the net from the bank, owes the tax, and settles the supplier gross', async () => {
    const fund: any = await mk('RECEIPT', { customerId: CUST }, '5000');
    await vouchers.post(COMPANY, USER, fund.id);
    const v: any = await mk('PAYMENT', { supplierId: SUPP }, '1000');
    const set: any = await svc.attach(COMPANY, USER, v.id, payRate.id);
    expect(set.withholding).toMatchObject({ amount: '10.0000', net: '990.0000', base: '1000.0000' });
    await vouchers.post(COMPANY, USER, v.id);
    const rows = await lines(v.id);
    expect(money(rows, GL, 'credit')).toBe(990);
    expect(money(rows, WHT_PAY, 'credit')).toBe(10);
    expect(money(rows, AP, 'debit')).toBe(1000);
    expect(rows.reduce((a, r) => a + Number(r.debit), 0)).toBe(rows.reduce((a, r) => a + Number(r.credit), 0));
  });

  it('a customer receipt receives the net, keeps the tax as a claim, and settles the invoice gross', async () => {
    const v: any = await mk('RECEIPT', { customerId: CUST }, '1000', { allocations: [{ salesInvoiceId: INV, amount: '1000' }] });
    await svc.attach(COMPANY, USER, v.id, recRate.id);
    await vouchers.post(COMPANY, USER, v.id);
    const rows = await lines(v.id);
    expect(money(rows, GL, 'debit')).toBe(950);
    expect(money(rows, WHT_REC, 'debit')).toBe(50);
    expect(money(rows, AR, 'credit')).toBe(1000);
    const [inv] = await query(`SELECT "paidAmount"::text AS paid FROM sales_invoices WHERE id = '${INV}'`);
    expect(Number(inv.paid)).toBe(1000);
  });

  it('a voucher without withholding posts exactly as before', async () => {
    const v: any = await mk('RECEIPT', { customerId: CUST }, '300');
    await vouchers.post(COMPANY, USER, v.id);
    const rows = await lines(v.id);
    expect(money(rows, GL, 'debit')).toBe(300);
    expect(rows.length).toBe(2);
  });

  it('refuses the wrong direction, a voucher with no customer or supplier, an inactive rate and a posted voucher', async () => {
    const pay: any = await mk('PAYMENT', { supplierId: SUPP }, '200');
    await expect(svc.attach(COMPANY, USER, pay.id, recRate.id)).rejects.toMatchObject({ response: { field: 'rateId' } });
    const expense: any = await mk('PAYMENT', { counterAccountId: EXPENSE }, '50');
    await expect(svc.attach(COMPANY, USER, expense.id, payRate.id)).rejects.toMatchObject({ response: { field: 'rateId' } });
    const off = await svc.createRate(COMPANY, USER, { code: 'OFF', nameAr: 'ن', nameEn: 'N', direction: 'PAYABLE', ratePercent: '2', accountId: WHT_PAY });
    await svc.updateRate(COMPANY, USER, off.id, { isActive: false });
    await expect(svc.attach(COMPANY, USER, pay.id, off.id)).rejects.toMatchObject({ response: { field: 'rateId' } });
    await expect(svc.attach(COMPANY, USER, pay.id, '99999999-9999-4999-8999-999999999999')).rejects.toMatchObject({ response: { field: 'rateId' } });
    const small: any = await mk('PAYMENT', { supplierId: SUPP }, '0.40');
    await expect(svc.attach(COMPANY, USER, small.id, payRate.id)).rejects.toMatchObject({ response: { field: 'rateId' } });
    await svc.attach(COMPANY, USER, pay.id, payRate.id);
    await vouchers.post(COMPANY, USER, pay.id);
    await expect(svc.attach(COMPANY, USER, pay.id, payRate.id)).rejects.toMatchObject({ response: { code: 'WITHHOLDING_VOUCHER_POSTED' } });
    await expect(svc.detach(COMPANY, USER, pay.id)).rejects.toMatchObject({ response: { code: 'WITHHOLDING_VOUCHER_POSTED' } });
  });

  it('replacing and clearing the withholding on a draft changes what posts', async () => {
    const v: any = await mk('PAYMENT', { supplierId: SUPP }, '400');
    const second = await svc.createRate(COMPANY, USER, { code: 'WHT3', nameAr: 'ن', nameEn: 'N', direction: 'PAYABLE', ratePercent: '3', accountId: WHT_PAY });
    await svc.attach(COMPANY, USER, v.id, payRate.id);
    const replaced: any = await svc.attach(COMPANY, USER, v.id, second.id);
    expect(replaced.withholding.amount).toBe('12.0000');
    const cleared: any = await svc.detach(COMPANY, USER, v.id);
    expect(cleared.withholding).toBeNull();
    await vouchers.post(COMPANY, USER, v.id);
    expect(money(await lines(v.id), GL, 'credit')).toBe(400);
  });

  it('a rate already used keeps its percent and account, but can be switched off', async () => {
    await expect(svc.updateRate(COMPANY, USER, payRate.id, { ratePercent: '9' })).rejects.toMatchObject({ response: { code: 'WITHHOLDING_RATE_IN_USE' } });
    const renamed = await svc.updateRate(COMPANY, USER, payRate.id, { nameEn: 'Supplier 1%' });
    expect(renamed.nameEn).toBe('Supplier 1%');
    expect(renamed.ratePercent).toBe('1.0000');
  });

  it('reversing a voucher takes its tax out of the report and the books', async () => {
    const before: any = await svc.report(COMPANY, { from: '2026-01-01', to: '2026-12-31' });
    const v: any = await mk('PAYMENT', { supplierId: SUPP }, '500');
    await svc.attach(COMPANY, USER, v.id, payRate.id);
    await vouchers.post(COMPANY, USER, v.id);
    const during: any = await svc.report(COMPANY, { from: '2026-01-01', to: '2026-12-31' });
    expect(Number(during.totals.payable) - Number(before.totals.payable)).toBe(5);
    await vouchers.reverse(COMPANY, USER, v.id, 'entered twice');
    const after: any = await svc.report(COMPANY, { from: '2026-01-01', to: '2026-12-31' });
    expect(after.totals.payable).toBe(before.totals.payable);
    const net = await query(`SELECT COALESCE(SUM(l.credit - l.debit),0)::text AS n FROM journal_lines l JOIN journal_entries e ON e.id = l."journalEntryId"
                              WHERE e."sourceId" = '${v.id}' AND l."accountId" = '${WHT_PAY}'`);
    expect(Number(net[0].n)).toBe(0);
  });

  it('the report totals by direction, filters by date and direction, and names the party', async () => {
    const all: any = await svc.report(COMPANY, { from: '2026-02-01', to: '2026-02-28' });
    expect(Number(all.totals.receivable)).toBe(50);
    expect(Number(all.totals.payable)).toBeGreaterThanOrEqual(10);
    expect(all.items.every((i: any) => i.partyEn)).toBe(true);
    const payOnly: any = await svc.report(COMPANY, { from: '2026-02-01', to: '2026-02-28', direction: 'payable' });
    expect(payOnly.items.every((i: any) => i.direction === 'PAYABLE')).toBe(true);
    const none: any = await svc.report(COMPANY, { from: '2027-01-01', to: '2027-01-31' });
    expect(none.items).toHaveLength(0);
    await expect(svc.report(COMPANY, { from: '2026-03-01', to: '2026-02-01' })).rejects.toMatchObject({ response: { field: 'from' } });
    await expect(svc.report(COMPANY, { from: 'x', to: '2026-02-01' })).rejects.toMatchObject({ response: { field: 'from' } });
  });
});
